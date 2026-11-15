// Explicit-word filter for the Averages search box: the same logic as safety.py, for the app (browser or Node).
//
//   import { loadSafety } from "./safety.mjs";
//   const safety = await loadSafety("/models/averages-search-350m-web/safety_words.json");
//   if (safety.checkInput(message)) return safety.refusal(lang);          // never send it to the model
//   const reply = safety.checkOutput(modelReply, "search", lang);          // or "extract" for teacher posts
//
// Word lists: LDNOOBW (CC-BY-4.0, via the naughty-words npm package) for en/es/fr/pt/de/zh, minus the allowlist
// (classroom anatomy/health words, everyday words that are slang in another language). Edit safety_allow.txt and
// re-run build_safety.py to change them.

export const REFUSE = {
  en: "I can only search your classes, grades, work, posts, messages and files.",
  es: "Solo puedo buscar en tus clases, notas, tareas, publicaciones, mensajes y archivos.",
  fr: "Je peux seulement chercher dans tes cours, notes, devoirs, publications, messages et fichiers.",
  pt: "Só posso pesquisar suas aulas, notas, tarefas, publicações, mensagens e arquivos.",
  de: "Ich kann nur in deinen Kursen, Noten, Aufgaben, Beiträgen, Nachrichten und Dateien suchen.",
  zh: "我只能搜索你的课程、成绩、作业、帖子、消息和文件。",
};
export const NO_DATE = "No date found.";
const LEET = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i" };

export function norm(s) {
  s = s.toLowerCase().normalize("NFKD").replace(/\p{Mn}/gu, "");
  s = s.replace(/[013457@$!]/g, (c) => LEET[c]);
  s = s.replace(/(?<![a-z])((?:[a-z][\s.\-_*+]){2,}[a-z])(?![a-z])/g, (m, g) => g.replace(/[\s.\-_*+]/g, ""));
  s = s.replace(/([a-z])\1{2,}/g, "$1$1");
  return s;
}
const squeeze = (s) => s.replace(/([a-z])\1+/g, "$1");
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export class Safety {
  constructor(d) {
    this.words = new Set(d.words);
    this.squeezed = new Set(d.words.map(squeeze).filter((w) => w.length >= 4));
    this.cjk = d.cjk;
    this.allow = new Set(d.allow);
    this.allowSq = new Set(d.allow.map(squeeze));
    this.allowPhrases = d.allow.filter((w) => w.includes(" ")).sort((a, b) => b.length - a.length)
      .map((p) => new RegExp("(?<![a-z])" + esc(p) + "(?![a-z])", "g"));
    this.maxN = Math.max(...d.words.map((w) => w.split(" ").length));
    this.byLen = new Map();
    for (const w of d.words) if (!w.includes(" ")) { if (!this.byLen.has(w.length)) this.byLen.set(w.length, []); this.byLen.get(w.length).push(w); }
  }
  hits(text) {
    const out = [];
    for (const w of this.cjk) if (text.includes(w)) out.push(w);
    const raw = norm(text).match(/[a-z*]+/g) || [];
    for (const tk of raw) {                       // "f*ck": a star standing in for a letter
      if (tk.includes("*") && tk.replace(/[^a-z]/g, "").length >= 2 && tk.length >= 3) {
        const pat = new RegExp("^" + tk.replace(/\*/g, "[a-z]") + "$");
        if ((this.byLen.get(tk.length) || []).some((w) => pat.test(w))) out.push(tk);
      }
    }
    let t = raw.map((tk) => tk.replace(/\*/g, "")).filter(Boolean).join(" ");
    for (const re of this.allowPhrases) t = t.replace(re, " ");
    const toks = t.split(/\s+/).filter(Boolean);
    for (let n = 1; n <= this.maxN; n++) {
      for (let i = 0; i + n <= toks.length; i++) {
        const g = toks.slice(i, i + n).join(" ");
        if (this.allow.has(g) || (n === 1 && this.allowSq.has(squeeze(g)))) continue;
        if (this.words.has(g) || (n === 1 && g.length >= 4 && this.squeezed.has(squeeze(g)))) out.push(g);
      }
    }
    return out;
  }
  checkInput(message) { return this.hits(message).length > 0; }
  refusal(lang) { return REFUSE[lang] || REFUSE.en; }
  // the reply the app should use: every string in a tool call (any tool, any argument, even made-up ones) and any
  // non-tool reply must be clean. known: the student's own class/teacher names, which are trusted.
  checkOutput(reply, task, lang, known = []) {
    const safe = task === "search" ? this.refusal(lang) : NO_DATE;
    const trusted = new Set(known);
    const m = reply.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/);
    if (m || reply.includes("<tool_call>")) {
      let call;
      try { call = m ? JSON.parse(m[1]) : null; } catch (e) { return safe; }
      if (!call || typeof call !== "object" || Array.isArray(call)) return safe;
      for (const v of strings(call)) if (!trusted.has(v) && this.hits(v).length) return safe;
      return reply;
    }
    const t = reply.trim();
    if (Object.values(REFUSE).includes(t) || t === NO_DATE) return reply;
    return this.hits(reply).length ? safe : reply;
  }
}

function* strings(x) {
  if (typeof x === "string") yield x;
  else if (Array.isArray(x)) for (const v of x) yield* strings(v);
  else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) { yield k; yield* strings(v); }
}

export async function loadSafety(url) {
  if (typeof fetch === "function" && /^(https?:)?\//.test(url)) return new Safety(await (await fetch(url)).json());
  const fs = await import("fs");
  return new Safety(JSON.parse(fs.readFileSync(url, "utf8")));
}
