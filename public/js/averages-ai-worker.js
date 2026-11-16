// A.I. search's model, in its own thread (2026-11-15). Started by averages-ai.js as a module worker.
//
// The model is Averages' fine-tune of IBM Granite 4.0 H 350M (Apache 2.0), run by transformers.js on the
// student's own device. It never sees anything but what the student typed and the names of their own classes
// and teachers; nothing leaves the device. Files: /vendor/transformers-4.3.2/ (the library), the model and the
// ONNX Runtime .wasm from /ai/ (our R2, through the app's own worker, so it's the same site).
//
// Messages in:  { t: 'load', id, model, dtype, files, device }   { t: 'ask', id, text, classes, teachers, lang }
// Messages out: { t: 'progress', id, loaded, total } { t: 'ready', id, device } { t: 'answer', id, ... } { t: 'error', id, error }

import { AutoTokenizer, AutoModelForCausalLM, LogitsProcessor, env } from '/vendor/transformers-4.3.2/transformers.min.js';
import { makeToolCallConstraint } from '/vendor/averages-ai-1/constrain.mjs';
import { Safety, REFUSE } from '/vendor/averages-ai-1/safety.mjs';

const CACHE = 'averages-ai-v1';
const WASM = '/ai/runtime/ort-1.31.0-dev.20260914/ort-wasm-simd-threaded.asyncify.wasm';
env.allowRemoteModels = false;        // never Hugging Face: only our own files
env.allowLocalModels = true;
env.localModelPath = '/ai/models/';
env.useBrowserCache = true;
env.cacheKey = CACHE;
env.backends.onnx.wasm.wasmPaths = {
  mjs: '/vendor/transformers-4.3.2/ort-wasm-simd-threaded.asyncify.mjs',
  wasm: WASM,
};

// what the model was trained with (spec.py in the training folder). Keep in step with it.
const SEARCH_SYSTEM = "You are the search box in Averages, a school app. Turn the student's message into one tool call. " +
  'Use class and teacher names only from the lists in the tools. ' +
  'If the message is only words to look for, call word_search. ' +
  "If it isn't about the student's classes, grades, work, posts, messages or files, don't call a tool: " +
  "reply with one short sentence saying you can only search those, in the student's language.";
const STATUS = ['due', 'missing', 'turned_in', 'graded', 'any'];
const WHEN = ['today', 'tomorrow', 'this_week', 'next_week', 'last_week', 'any'];
const KIND = ['test', 'quiz', 'homework', 'project', 'essay', 'lab', 'any'];
const FILE_KIND = ['pdf', 'slides', 'doc', 'sheet', 'image', 'any'];
const SINCE = ['today', 'this_week', 'any'];
const PAGES = ['home', 'grades', 'assignments', 'calendar', 'messages', 'files', 'contacts', 'settings', 'courses', 'class'];
const s = (en, desc) => { const d = { type: 'string' }; if (en) d.enum = [...en]; if (desc) d.description = desc; return d; };
const fn = (name, description, properties, required) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, ...(required ? { required } : {}) } } });
export function searchTools(classes, teachers) {
  const C = s(classes), T = s(teachers);
  return [
    fn('find_work', 'Assignments, tests and other work, with due dates and status.', { class: C, status: s(STATUS), when: s(WHEN), kind: s(KIND) }),
    fn('find_grades', "Grades: a class's grade, the GPA, or scores on graded work.", { class: C, sort: s(['lowest', 'highest', 'none']), show: s(['grade', 'gpa', 'scores']) }),
    fn('what_it_takes', 'The score needed on upcoming work to reach a target grade in a class.', { class: C, target: s(null, 'A letter like A- or a percent like 90%'), assignment: s(null, "The work it's for, if named") }, ['class', 'target']),
    fn('find_posts', 'Updates and posts from teachers in a class.', { class: C, teacher: T, when: s(SINCE) }),
    fn('find_messages', 'Messages, from a teacher or anyone.', { teacher: T, unread: { type: 'boolean' } }),
    fn('find_files', 'Files and materials from classes.', { class: C, kind: s(FILE_KIND), when: s(SINCE) }),
    fn('open_page', 'Open a page in Averages. Use page class with a class to open that class.', { page: s(PAGES), class: C }, ['page']),
    fn('word_search', 'Look for these exact words everywhere.', { text: s() }, ['text']),
  ];
}

let tok = null, model = null, safety = null, loading = null, device = '';
const post = (m) => self.postMessage(m);

async function load(m) {
  if (model) return device;
  if (loading) return loading;
  loading = (async () => {
    // one progress bar for every file: the sizes come from the app (it knows them), the bytes from each file
    const got = {};
    const progress_callback = (p) => {
      if (!p || p.status !== 'progress' || !p.file) return;
      got[p.file] = p.loaded || 0;
      post({ t: 'progress', id: m.id, loaded: Object.values(got).reduce((a, b) => a + b, 0), total: m.total || 0 });
    };
    const want = m.device === 'wasm' ? 'wasm' : 'webgpu';
    // Every file into the cache first, one request each, with our own progress. transformers.js would otherwise ask
    // for each file twice when it isn't saved yet (once just to read its size), and these are hundreds of MB.
    const cache = await caches.open(CACHE);
    const urls = [...(m.files || []).map((f) => '/ai/models/' + m.model + '/' + f), WASM].map((u) => new URL(u, self.location.origin).href);
    for (const url of urls) {
      // already saved (an earlier, unfinished download): counted at its real size, even without a Content-Length
      if (await cache.match(url)) { const r = await cache.match(url); got[url] = +r.headers.get('content-length') || (await r.blob()).size; progress_callback({ status: 'progress', file: url, loaded: got[url] }); continue; }
      const r = await fetch(url, { credentials: 'omit' });
      if (!r.ok || !r.body) throw new Error('download_failed_' + r.status);
      const [keep, count] = r.body.tee();
      const headers = { 'content-type': r.headers.get('content-type') || 'application/octet-stream' };
      if (r.headers.get('content-length')) headers['content-length'] = r.headers.get('content-length');
      const put = cache.put(url, new Response(keep, { headers }));
      const rd = count.getReader(); let n = 0;
      for (;;) { const { done, value } = await rd.read(); if (done) break; n += value.byteLength; progress_callback({ status: 'progress', file: url, loaded: n }); }
      await put;
    }
    // every file is here: the bar fills, and the page says it's getting it ready (starting the model takes a few seconds)
    post({ t: 'progress', id: m.id, loaded: m.total || 0, total: m.total || 0, phase: 'prepare' });
    tok = await AutoTokenizer.from_pretrained(m.model);
    model = await AutoModelForCausalLM.from_pretrained(m.model, { dtype: m.dtype, device: want });
    const sw = await cache.match(new URL('/ai/models/' + m.model + '/safety_words.json', self.location.origin).href);
    if (!sw) throw new Error('safety_words_missing');
    safety = new Safety(await sw.json());
    device = want;
    return device;
  })();
  try { return await loading; } finally { loading = null; }
}

// 1 to 4 plain words with no question in them: the student is looking for words (results.md suggestion 2)
const QUESTION = /[?¿？]|\b(what|when|where|who|why|how|which|is|are|am|do|does|did|can|could|should|will|would|qu[eé]|cu[aá]ndo|d[oó]nde|qui[eé]n|por qu[eé]|c[oó]mo|cu[aá]l|quoi|quand|o[uù]|qui|pourquoi|comment|quel|quelle|o que|quando|onde|quem|porque|como|qual|was|wann|wo|wer|warum|wie|welche)\b|什么|什麼|何时|哪|谁|为什么|怎么|吗|嗎/i;
// ...but not a request to do something ("tell me a joke", "write my essay"): those stay refused
const ASKING = /\b(me|my|you|your|i|tell|write|give|make|explain|say|sing|draw|create|generate|translate|solve|play|help|dime|dame|escribe|haz|cu[eé]ntame|dis|donne|[eé]cris|fais|raconte|diga|escreva|fa[cç]a|conte|sag|schreib|gib|erz[aä]hl|mach)\b|告诉|写|给我|讲/i;
const keywordsOnly = (t) => { const w = t.trim().split(/\s+/).filter(Boolean); return w.length >= 1 && w.length <= 4 && !QUESTION.test(t) && !ASKING.test(t); };

async function ask(m) {
  const lang = REFUSE[m.lang] ? m.lang : 'en';
  const text = String(m.text || '').trim().slice(0, 300);
  if (!text) return { kind: 'refuse', lang };
  if (safety.checkInput(text)) return { kind: 'refuse', lang, safety: true };    // never shown to the model
  const classes = [...new Set((m.classes || []).map(String).filter(Boolean))].slice(0, 40);
  const teachers = [...new Set((m.teachers || []).map(String).filter(Boolean))].slice(0, 40);
  const tools = searchTools(classes.length ? classes : ['None'], teachers.length ? teachers : ['None']);
  const messages = [{ role: 'system', content: SEARCH_SYSTEM }, { role: 'user', content: text }];
  const prompt = tok.apply_chat_template(messages, { tools, add_generation_prompt: true, tokenize: false });
  const inputs = tok(prompt, { add_special_tokens: false });
  const n = inputs.input_ids.dims[1];
  const constraint = makeToolCallConstraint(LogitsProcessor, tok, n, tools, 'search');
  const t0 = performance.now();
  const out = await model.generate({ ...inputs, max_new_tokens: 120, do_sample: false, logits_processor: [constraint] });
  const ms = Math.round(performance.now() - t0);
  const ids = Array.from(out.data ?? out.sequences.data).slice(n).map(Number);
  const raw = tok.decode(ids, { skip_special_tokens: false }).replace(/<\|end_of_text\|>[\s\S]*$/, '').trim();
  const clean = safety.checkOutput(raw, 'search', lang, [...classes, ...teachers]);
  const call = parseCall(clean, tools);
  if (call) return { kind: 'call', name: call.name, args: call.args, ms };
  // a refusal (or anything else: never shown as it is). Plain keywords the model refused are still a word search.
  if (!safety.checkInput(text) && keywordsOnly(text)) return { kind: 'call', name: 'word_search', args: { text }, ms, fallback: 'keywords' };
  return { kind: 'refuse', lang, ms };
}

// the reply as { name, args } when it's a valid call of a tool we offered, with only that tool's arguments and
// values from its lists (the constraint already makes sure of this; this is the second check the app must do)
function parseCall(reply, tools) {
  const m = /^<tool_call>\s*([\s\S]*?)\s*<\/tool_call>$/.exec(reply);
  if (!m) return null;
  let c; try { c = JSON.parse(m[1]); } catch { return null; }
  if (!c || typeof c.name !== 'string' || !c.arguments || typeof c.arguments !== 'object' || Array.isArray(c.arguments)) return null;
  const t = tools.find((x) => x.function.name === c.name); if (!t) return null;
  const P = t.function.parameters.properties, args = {};
  for (const [k, v] of Object.entries(c.arguments)) {
    const spec = P[k]; if (!spec) return null;
    if (spec.type === 'boolean') { if (typeof v !== 'boolean') return null; }
    else if (typeof v !== 'string' || !v.trim() || v.length > 300 || (spec.enum && !spec.enum.includes(v))) return null;
    args[k] = v;
  }
  for (const k of t.function.parameters.required || []) if (!(k in args)) return null;
  if ((args.class === 'None') || (args.teacher === 'None')) return null;
  return { name: c.name, args };
}

let queue = Promise.resolve();
self.onmessage = (e) => {
  const m = e.data || {};
  queue = queue.then(async () => {
    try {
      if (m.t === 'load') post({ t: 'ready', id: m.id, device: await load(m) });
      else if (m.t === 'ask') { if (!model) throw new Error('not_loaded'); post({ t: 'answer', id: m.id, ...(await ask(m)) }); }
    } catch (err) {
      post({ t: 'error', id: m.id, error: String(err && err.message || err).slice(0, 300) });
    }
  });
};
