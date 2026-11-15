// The word lists for other languages (2026-11-15): i18n/keys.txt holds the app's English text, one per line
// as "N|text"; i18n/<lang>.txt holds the same line numbers with the translation. This writes public/i18n/<lang>.json,
// which public/js/averages-i18n.js loads. "#" stands for a number (in the same order in both), and "{x}" for
// a name or title that stays as it is ("Turn in {x}"). Run: node scripts/i18n-build.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../i18n"), OUT = path.resolve(HERE, "../public/i18n");
const LANGS = ["es", "fr", "pt", "de", "zh"];
const read = (f) => new Map(fs.readFileSync(path.join(SRC, f), "utf8").split(/\r?\n/).filter((l) => l.trim()).map((l) => {
  const i = l.indexOf("|");
  if (i < 1) throw new Error(`${f}: no "N|" in: ${l}`);
  return [Number(l.slice(0, i)), l.slice(i + 1)];
}));
const keys = read("keys.txt");
const count = (s, t) => s.split(t).length - 1;
let bad = 0;
fs.mkdirSync(OUT, { recursive: true });
for (const lang of LANGS) {
  const tr = read(`${lang}.txt`), t = {};
  for (const [n, en] of keys) {
    const v = tr.get(n);
    if (v == null || !v.trim()) { console.log(`  ${lang} ${n}: missing (${en})`); bad++; continue; }
    if (count(v, "#") !== count(en, "#") || count(v, "{x}") !== count(en, "{x}")) { console.log(`  ${lang} ${n}: "#" or "{x}" don't match: ${en} -> ${v}`); bad++; continue; }
    t[en] = v;
  }
  for (const n of tr.keys()) if (!keys.has(n)) { console.log(`  ${lang} ${n}: no English line`); bad++; }
  fs.writeFileSync(path.join(OUT, `${lang}.json`), JSON.stringify({ lang, t }) + "\n");
  console.log(`  ${lang}: ${Object.keys(t).length} of ${keys.size}`);
}
if (bad) { console.log(`${bad} problems`); process.exit(1); }
