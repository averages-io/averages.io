// A.I. search's model, in its own thread (2026-11-15). Started by averages-ai.js as a module worker.
//
// The model is Averages' fine-tune of IBM Granite 4.0 H 350M (Apache 2.0), run by transformers.js on the
// student's own device. It never sees anything but what the student typed and the names of their own classes
// and teachers; nothing leaves the device. Files: /vendor/transformers-4.3.2/ (the library), the model and the
// ONNX Runtime .wasm from /ai/ (our R2, through the app's own worker, so it's the same site).
//
// Messages in:  { t: 'load', id, model, dtype, files, device, schema }   { t: 'ask', id, text, classes, teachers, lang }
// Messages out: { t: 'progress', id, loaded, total, phase? ('prepare', 'warmup') } { t: 'ready', id, device }
//               { t: 'answer', id, kind: 'call', name, args, calls: [{ name, args }, ...] | kind: 'refuse' } { t: 'error', id, error }

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
// Round 7+ tools (spec.py, AVG_SCHEMA unset = "16"): every model from Round 10 on. Round 17 options (AVG_SCHEMA=17) are
// added only for the Higher quality 70/30 model (it's the only one that learned them): new arguments go at the END of
// each tool, so the order matches spec.py exactly. Keep this in step with spec.py.
const STATUS = ['due', 'missing', 'late', 'turned_in', 'turned_in_late', 'graded', 'any'];
const WHEN = ['today', 'tomorrow', 'this_week', 'next_week', 'last_week', 'this_month', 'this_year', 'any'];
const LETTER = ['A', 'B', 'C', 'D', 'F', 'A+', 'A-', 'B+', 'B-', 'C+', 'C-', 'D+', 'D-'];
const FROM = ['teachers', 'classmates', 'anyone'];
const KIND = ['test', 'quiz', 'homework', 'project', 'essay', 'lab', 'any'];
const FILE_KIND = ['pdf', 'slides', 'doc', 'sheet', 'image', 'any'];
const SINCE = ['today', 'this_week', 'any'];
const PAGES = ['home', 'grades', 'assignments', 'calendar', 'messages', 'files', 'contacts', 'settings', 'courses', 'class'];
const WORK_SORT = ['earliest_due', 'latest_due', 'most_points'];
const s = (en, desc) => { const d = { type: 'string' }; if (en) d.enum = [...en]; if (desc) d.description = desc; return d; };
const fn = (name, description, properties, required) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, ...(required ? { required } : {}) } } });
export function searchTools(classes, teachers, schema = 16) {
  const C = s(classes), T = s(teachers);
  const tools = [
    fn('find_work', 'Assignments, tests and other work, with due dates and status.', { class: C,
      status: s(STATUS, 'late: past due and not turned in; missing: marked missing by the teacher'),
      when: s(WHEN), kind: s(KIND), commented: { type: 'boolean', description: 'Only work a teacher commented on' } }),
    fn('find_grades', "Grades: a class's grade, the GPA, or scores on graded work.", { class: C, sort: s(['lowest', 'highest', 'none']),
      show: s(['grade', 'gpa', 'scores'], 'scores for assignments, tests and quizzes; grade for classes'),
      letter: s(LETTER, 'Only scores with this letter grade; B means B+, B and B-') }),
    fn('what_it_takes', 'The score needed on upcoming work to reach a target grade in a class.', { class: C, target: s(null, 'A letter like A- or a percent like 90%'), assignment: s(null, "The work it's for, if named") }, ['class', 'target']),
    fn('find_posts', 'Updates and posts from teachers in a class.', { class: C, teacher: T, when: s(SINCE) }),
    fn('find_messages', 'Messages, from a teacher or anyone.', { teacher: T, class: s(classes, "Messages from this class's teacher"), from: s(FROM), unread: { type: 'boolean' } }),
    fn('find_files', 'Files and materials from classes.', { class: C, kind: s(FILE_KIND), when: s(SINCE) }),
    fn('open_page', 'Open a page in Averages. Use page class with a class to open that class.', { page: s(PAGES), class: C }, ['page']),
    fn('word_search', 'Look for these exact words everywhere.', { text: s() }, ['text']),
  ];
  if (schema >= 17) {
    const by = Object.fromEntries(tools.map((x) => [x.function.name, x.function]));
    const g = by.find_grades.parameters.properties;
    g.kind = s(KIND, 'Only scores on this kind of work');
    g.below = s(null, 'A percent like 80%: only grades or scores under it');
    g.above = s(null, 'A percent like 90%: only grades or scores at or over it');
    by.find_work.parameters.properties.sort = s(WORK_SORT, 'Order: earliest or latest due date first, or most points first');
    by.what_it_takes.description = 'The score needed on upcoming work to reach a target grade, in one class or (no class) every class.';
    by.what_it_takes.parameters.required = ['target'];
  }
  return tools;
}

let tok = null, model = null, safety = null, loading = null, device = '', schema = 16, firstAsk = true, loaded = '';
// One copy of the model for every page of the site (2026-11-17): the app starts this as a SharedWorker when it can,
// so going to another page in the same tab keeps the model ready instead of starting it again (Firefox and Safari
// keep a shared worker across same-site page changes; Chrome does with extendedLifetime, about 30 s). Each page talks
// through its own port; replies go to the page whose message is being handled (one message at a time, below).
const SHARED = typeof SharedWorkerGlobalScope !== 'undefined' && self instanceof SharedWorkerGlobalScope;
let port = null;
const post = (m) => (port || self).postMessage(m);

async function load(m) {
  if (model && loaded === m.model) return device;
  if (loading) return loading;
  // a shared worker without WebGPU (some browsers only have it in pages and dedicated workers): the page uses its own
  if (SHARED && m.device !== 'wasm' && !(self.navigator && self.navigator.gpu)) throw new Error('shared_no_gpu');
  // another page switched versions (Standard / Higher quality): the old model goes first
  if (model) { try { await model.dispose(); } catch { /* gone anyway */ } model = null; tok = null; loaded = ''; }
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
    schema = m.schema === 17 ? 17 : 16;
    // warm-up: one throwaway search, the same path as a real one, so the browser compiles its GPU programs now, while
    // the page says "Getting A.I. ready", and not during the student's first search (Firefox: 25-31 s otherwise,
    // Chrome a few seconds; averages-ai NOTE_FOR_CLAUDE_CHAT.md). Every load, also from the cache. Its answer is dropped;
    // a search typed meanwhile waits in the queue below and runs right after.
    post({ t: 'progress', id: m.id, loaded: m.total || 0, total: m.total || 0, phase: 'warmup' });
    const w0 = performance.now();
    // a graphics failure fails the load (the page may then try a worker of its own); anything else, the real searches will say
    try { await ask({ text: 'what is due tomorrow', classes: ['Math'], teachers: ['Ms. Lee'], lang: 'en', warm: true }); }
    catch (e) { if (/webgpu|shader|ortrun|compute pipeline|f16|device (was )?lost/i.test(String(e && e.message || e))) { model = null; throw e; } }
    console.info('[ai] warm-up ' + Math.round(performance.now() - w0) + ' ms (' + want + ', ' + m.model + ')');
    device = want; loaded = m.model; fresh = true;
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
  const tools = searchTools(classes.length ? classes : ['None'], teachers.length ? teachers : ['None'], schema);
  const messages = [{ role: 'system', content: SEARCH_SYSTEM }, { role: 'user', content: text }];
  const prompt = tok.apply_chat_template(messages, { tools, add_generation_prompt: true, tokenize: false });
  const inputs = tok(prompt, { add_special_tokens: false });
  const n = inputs.input_ids.dims[1];
  const constraint = makeToolCallConstraint(LogitsProcessor, tok, n, tools, 'search');
  const t0 = performance.now();
  const out = await model.generate({ ...inputs, max_new_tokens: 200, do_sample: false, logits_processor: [constraint] });
  const ms = Math.round(performance.now() - t0);
  const ids = Array.from(out.data ?? out.sequences.data).slice(n).map(Number);
  const raw = tok.decode(ids, { skip_special_tokens: false }).replace(/<\|end_of_text\|>[\s\S]*$/, '').trim();
  const clean = safety.checkOutput(raw, 'search', lang, [...classes, ...teachers]);
  const calls = parseCalls(clean, tools);
  if (!m.warm && firstAsk) { firstAsk = false; console.info('[ai] first search after warm-up ' + ms + ' ms'); }
  // up to 3 searches, one per question asked ("what's due and my bio grade"); the first is also name/args as before
  if (calls.length) return { kind: 'call', name: calls[0].name, args: calls[0].args, calls, ms, schema };
  // a refusal (or anything else: never shown as it is). Plain keywords the model refused are still a word search.
  if (!safety.checkInput(text) && keywordsOnly(text)) return { kind: 'call', name: 'word_search', args: { text }, ms, fallback: 'keywords' };
  return { kind: 'refuse', lang, ms };
}

// the reply's searches: models since Round 8 answer a two- or three-part question with one <tool_call> block per part,
// joined by a newline. Each is checked on its own; the complete ones are kept (a last one cut off at the token limit
// is dropped), repeats are dropped (the constraint lets one through), and at most 3.
function parseCalls(reply, tools) {
  const out = [], seen = new Set();
  const re = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  // only tool calls: a refusal sentence (or anything else) around them means it isn't a search. After a complete call,
  // the start of another one that ran out of room is all right (it's dropped).
  const rest = reply.replace(re, '').trim();
  if (rest && !(rest.startsWith('<tool') && /<\/tool_call>\s*<tool/.test(reply) && reply.trim().endsWith(rest))) return out;
  for (const m of reply.matchAll(re)) {
    const c = parseCall(m[1], tools); if (!c) continue;
    const key = c.name + JSON.stringify(c.args);
    if (seen.has(key)) continue;
    seen.add(key); out.push(c);
    if (out.length === 3) break;
  }
  return out;
}

// one call as { name, args } when it's a valid call of a tool we offered, with only that tool's arguments and
// values from its lists (the constraint already makes sure of this; this is the second check the app must do)
function parseCall(json, tools) {
  let c; try { c = JSON.parse(json); } catch { return null; }
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

let queue = Promise.resolve(), fresh = false;
function handle(m, from) {
  queue = queue.then(async () => {
    port = from;
    try {
      if (m.t === 'quit') { self.close(); return; }
      if (m.t === 'state') { post({ t: 'state', id: m.id, loaded: model ? loaded : '' }); return; }
      // fresh: this page's load really started the model (not one another page had started already)
      if (m.t === 'load') { fresh = false; const d = await load(m); post({ t: 'ready', id: m.id, device: d, fresh }); }
      else if (m.t === 'ask') { if (!model) throw new Error('not_loaded'); post({ t: 'answer', id: m.id, ...(await ask(m)) }); }
    } catch (err) {
      post({ t: 'error', id: m.id, error: String(err && err.message || err).slice(0, 300) });
    }
  });
}
self.onmessage = (e) => handle(e.data || {}, null);
// shared: every page that connects gets a port
self.onconnect = (e) => { const p = e.ports[0]; p.onmessage = (ev) => handle(ev.data || {}, p); p.start(); };
