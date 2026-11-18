// Constrained decoding for the Averages search model in transformers.js (same logic as constrain.py).
//
// While generating, only text that can still become a valid answer is allowed: a tool call in exactly the trained
// format (real tool name, real argument names in schema order, required ones present, enum values incl. the
// student's own class/teacher names, true/false, non-empty free text), or one of the allowed plain replies (the six
// refusal sentences for search, "No date found." for teacher posts). Greedy: the best-scoring valid token is kept.
//
//   import { AutoTokenizer, AutoModelForCausalLM, LogitsProcessor } from "@huggingface/transformers";
//   import { makeToolCallConstraint } from "./constrain.mjs";
//   const inputs = tokenizer(prompt, { add_special_tokens: false });
//   const constraint = makeToolCallConstraint(LogitsProcessor, tokenizer, inputs.input_ids.dims[1], tools, "search");
//   const out = await model.generate({ ...inputs, max_new_tokens: 120, do_sample: false, logits_processor: [constraint] });

const HEAD = '<tool_call>\n{"name": "';
const MID = '", "arguments": {';
const CLOSE = "}}\n</tool_call>";
export const REFUSE = [
  "I can only search your classes, grades, work, posts, messages and files.",
  "Solo puedo buscar en tus clases, notas, tareas, publicaciones, mensajes y archivos.",
  "Je peux seulement chercher dans tes cours, notes, devoirs, publications, messages et fichiers.",
  "Só posso pesquisar suas aulas, notas, tarefas, publicações, mensagens e arquivos.",
  "Ich kann nur in deinen Kursen, Noten, Aufgaben, Beiträgen, Nachrichten und Dateien suchen.",
  "我只能搜索你的课程、成绩、作业、帖子、消息和文件。",
];
export const NO_DATE = "No date found.";
export const allowedPlain = (task) => (task === "search" ? REFUSE : [NO_DATE]);

export function toolSpecs(tools) {
  return tools.map((t) => {
    const f = t.function;
    return { name: f.name, props: Object.entries(f.parameters.properties), required: new Set(f.parameters.required || []) };
  });
}

function value(v, spec) {
  const rests = [];
  let partial = false;
  if (spec.type === "boolean") {
    for (const lit of ["true", "false"]) {
      if (lit.startsWith(v)) partial = true;
      else if (v.startsWith(lit)) rests.push(v.slice(lit.length));
    }
    return [partial, rests];
  }
  if (spec.enum) {
    for (const e of spec.enum) {
      const lit = JSON.stringify(e);
      if (lit.startsWith(v)) partial = true;
      else if (v.startsWith(lit)) rests.push(v.slice(lit.length));
    }
    return [partial, rests];
  }
  if (v === "") return [true, rests];
  if (v[0] !== '"') return [false, rests];
  let esc = false;
  for (let i = 1; i < v.length; i++) {
    const c = v[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === "\n") return [false, rests];
    if (c === '"') {
      if (i === 1) return [false, rests];
      rests.push(v.slice(i + 1));
      return [false, rests];
    }
  }
  return [true, rests];
}

function args(r, props, start, first, used, required) {
  let ok = false, complete = false;
  if ([...required].every((k) => used.has(k)) && CLOSE.startsWith(r)) { ok = true; complete = complete || r === CLOSE; }
  const sep = first ? "" : ", ";
  for (let i = start; i < props.length; i++) {
    const [key, spec] = props[i];
    const kh = `${sep}"${key}": `;
    if (kh.startsWith(r)) { ok = true; continue; }
    if (!r.startsWith(kh)) continue;
    const [partial, rests] = value(r.slice(kh.length), spec);
    ok = ok || partial;
    for (const rem of rests) {
      const [o, c] = args(rem, props, i + 1, false, new Set([...used, key]), required);
      ok = ok || o; complete = complete || c;
    }
  }
  return [ok, complete];
}

// [is s a valid prefix?, is s a complete valid answer?]
export const MAX_CALLS = Number(globalThis.process?.env?.AVG_MAX_CALLS ?? 3); // round 8+: up to 3 calls, one per question
const SEP = CLOSE + "\n"; // round 8: several calls back to back, one per question

export function check(s, specs, plain) {
  if (!s.includes(SEP) || MAX_CALLS === 1) return checkOne(s, specs, plain);
  const parts = s.split(SEP);
  const done = parts.slice(0, -1).map((x) => x + CLOSE), last = parts[parts.length - 1];
  // ship check Nov 17: a repeated call is allowed (the app drops duplicates); rejecting it at its last character got stuck
  if (parts.length > MAX_CALLS) return [false, false];
  for (const d of done) if (!d.startsWith(HEAD) || !checkOne(d, specs, [])[1]) return [false, false];
  if (last === "") return [true, false];
  return checkOne(last, specs, []);
}

// Non-ASCII characters that could ever be valid here: those in the names/enums and refusal sentences, plus one
// stand-in for free text (where any character is fine). Same as constrain.py _probes.
const PROBES = new WeakMap();
function probes(specs, plain) {
  let byPlain = PROBES.get(specs);
  if (!byPlain) { byPlain = new WeakMap(); PROBES.set(specs, byPlain); }
  let p = byPlain.get(plain);
  if (!p) {
    const set = new Set(["é"]);
    for (const c of JSON.stringify(specs) + plain.join("")) if (c.codePointAt(0) > 127) set.add(c);
    p = [...set]; byPlain.set(plain, p);
  }
  return p;
}

export function checkOne(s, specs, plain) {
  const t = s.replace(/�+$/, "");      // a character still being built from byte tokens
  if (t !== s) {
    // ship check Nov 17: a half-built character is only OK where some non-ASCII character can come next (free text,
    // a non-ASCII class/teacher name, a refusal sentence), never inside "this_week". At most 3 bytes are pending.
    if (s.length - t.length > 3) return [false, false];
    return [probes(specs, plain).some((c) => checkOne(t + c, specs, plain)[0]), false];
  }
  let ok = false, complete = false;
  for (const p of plain) if (p.startsWith(t)) { ok = true; complete = complete || (t === p && t === s); }
  if (HEAD.startsWith(t)) return [true, complete];
  if (!t.startsWith(HEAD)) return [ok, complete];
  const rest = t.slice(HEAD.length);
  for (const { name, props, required } of specs) {
    if (name.startsWith(rest)) { ok = true; continue; }
    if (!rest.startsWith(name)) continue;
    const r = rest.slice(name.length);
    if (MID.startsWith(r)) { ok = true; continue; }
    if (!r.startsWith(MID)) continue;
    const a = r.slice(MID.length);
    // round 7: find_grades.letter only after "show": "scores" (show comes first in the schema order)
    const p2 = a.includes('"show": "scores"') ? props : props.filter(p => p[0] !== "letter");
    const [o, c] = args(a, p2, 0, true, new Set(), required);
    ok = ok || o; complete = complete || (c && t === s);
  }
  return [ok, complete];
}

// a transformers.js LogitsProcessor (pass the library's LogitsProcessor class so this file has no import path)
export function makeToolCallConstraint(LogitsProcessor, tokenizer, promptLen, tools, task, eosId = 100257) {
  const specs = toolSpecs(tools), plain = allowedPlain(task);
  class ToolCallConstraint extends LogitsProcessor {
    constructor() { super(); this.forced = 0; }
    _call(input_ids, logits) {
      for (let b = 0; b < input_ids.length; b++) {
        const gen = input_ids[b].slice(promptLen).map(Number);
        const s = gen.length ? tokenizer.decode(gen, { skip_special_tokens: false }) : "";
        const data = logits[b].data;
        const valid = (cand) => (cand === eosId ? check(s, specs, plain)[1]
          : check(tokenizer.decode([...gen, cand], { skip_special_tokens: false }), specs, plain)[0]);
        let best = 0;
        for (let i = 1; i < data.length; i++) if (data[i] > data[best]) best = i;
        let pick = valid(best) ? best : null;
        if (pick === null) {
          const order = Array.from(data.keys()).sort((x, y) => data[y] - data[x]);
          // ship check Nov 17: no cap (was 4097: "leave this step alone" let invalid text in, and then every later step
          // failed too). The whole vocabulary is searched; this is rare and only slow then.
          for (let r = 1; r < order.length; r++) if (valid(order[r])) { pick = order[r]; this.forced++; break; }
        }
        if (pick === null && check(s, specs, plain)[1]) pick = eosId;   // nothing else fits but the answer is complete
        if (pick === null) continue;
        const keep = data[pick];
        data.fill(-Infinity);
        data[pick] = keep;
      }
      return logits;
    }
  }
  return new ToolCallConstraint();
}
