/**
 * Builds the Fullscreen pages (2026-10-28, behind the `fullscreen` switch).
 *
 *   fs-src/<page>.html  ->  public/fs/<page>.html
 *
 * fs-src/ holds Martin's Fullscreen designs (whole, self-contained pages with
 * their own sample data). Each one gets, at build time:
 *   1. /js/averages-fs.js in <head> (versioned), which joins it to the app:
 *      the switch, sign-in, theme, accent, name and photo, and moving
 *      between pages (see that file);
 *   2. its "In the app, this opens ..." messages routed through that file,
 *      so they move between pages instead of only saying so;
 *   3. a dark theme: the design is light only, so every rule with a color in
 *      it gets a dark twin under html[data-theme="dark"] (see darkCss below).
 * The title drops the word "Mock". public/fs/ is generated (gitignored): edit
 * fs-src/ and rebuild. Runs from `npm run port`.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../fs-src");
const OUT = path.resolve(HERE, "../public/fs");
const JS_FILE = path.resolve(HERE, "../public/js/averages-fs.js");

// ---------- colors ----------
function parseColor(s) {
  s = s.trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map((x) => (x.endsWith("%") ? (parseFloat(x) / 100) * 255 : parseFloat(x)));
    if (p.length < 3 || p.some((x) => Number.isNaN(x))) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? (m[1].includes("%") && p[3] > 1 ? p[3] / 255 : p[3]) : 1 };
  }
  if (s === "white") return { r: 255, g: 255, b: 255, a: 1 };
  if (s === "black") return { r: 0, g: 0, b: 0, a: 1 };
  return null;
}
const hex2 = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
function fmt(c) {
  if (c.a >= 1) return "#" + hex2(c.r) + hex2(c.g) + hex2(c.b);
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${Math.round(c.a * 1000) / 1000})`;
}
const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
const sat = (c) => { const mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b); return mx === 0 ? 0 : (mx - mn) / mx; };
const mix = (a, b, t) => ({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t, a: a.a });
const WHITE = { r: 255, g: 255, b: 255, a: 1 };
const PANEL_DARK = { r: 28, g: 29, b: 38, a: 1 };
// a neutral gray in the dark theme's blue-gray family
const gray = (v, a = 1) => ({ r: v, g: v + 1, b: v + 10, a });

/** A light-theme color used as a surface (background, border, fill) -> its dark twin. */
function darkSurface(c) {
  if (c.a < 1) {
    if (lum(c) < 0.2 && c.a >= 0.45) return { r: 236, g: 237, b: 245, a: c.a };           // strong ink (dots, marks) -> light ink
    if (lum(c) < 0.2) return { r: 255, g: 255, b: 255, a: Math.min(0.5, c.a * 1.1) };    // dark wash on light -> light wash on dark
    return null;                                                                          // white or colored washes stay
  }
  const v = (c.r + c.g + c.b) / 3;
  if (sat(c) < 0.12) {
    if (v >= 252) return gray(38);                  // white cards and fields
    if (v >= 150) return gray(Math.max(14, 262 - v));
    if (v < 60) return gray(Math.min(240, 250 - v * 0.85));   // ink-colored fills (tooltips, dark chips) go light
    return null;
  }
  if (lum(c) > 0.55) return mix(c, PANEL_DARK, 0.78);   // light tints
  return null;                                           // real colors (accents, status) stay
}
/** A light-theme text color -> its dark twin. */
function darkText(c) {
  if (c.a < 1 && lum(c) > 0.8) return null;
  const v = (c.r + c.g + c.b) / 3;
  if (sat(c) < 0.12) {
    if (v < 120) return gray(Math.min(240, 250 - v * 0.85), c.a);
    if (v < 200) return gray(Math.max(110, 290 - v), c.a);
    return null;                                     // white text sits on colors: stays
  }
  if (lum(c) < 0.3) return mix(c, WHITE, 0.45);      // dark colored text (status, accents) lightens
  return null;
}
function darkShadow(c) {
  if (c.a < 1 && lum(c) < 0.2) return { r: 0, g: 0, b: 0, a: Math.min(0.6, c.a * 2) };
  return darkSurface(c);
}

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^()]*\)|\bwhite\b|\bblack\b/g;
function mapColors(value, fn) {
  // never inside url(...)
  let out = "", i = 0, changed = false;
  const re = /url\((?:[^()"']|"[^"]*"|'[^']*')*\)/g;
  let m;
  const seg = (txt) => txt.replace(COLOR_RE, (c) => {
    const p = parseColor(c);
    if (!p) return c;
    const d = fn(p);
    if (!d) return c;
    changed = true;
    return fmt(d);
  });
  while ((m = re.exec(value))) { out += seg(value.slice(i, m.index)) + m[0]; i = m.index + m[0].length; }
  out += seg(value.slice(i));
  return changed ? out : null;
}

const TEXT_PROPS = new Set(["color", "-webkit-text-fill-color", "caret-color", "text-decoration-color"]);
const SHADOW_PROPS = new Set(["box-shadow", "text-shadow", "filter"]);
const SURFACE_PROPS = /^(background(-color|-image)?|border(-(top|right|bottom|left))?(-color)?|outline(-color)?|fill|stroke|column-rule(-color)?|accent-color|scrollbar-color)$/;
// tokens that are used as text get lighter in dark; as a solid background behind white text they keep the light-theme color
const SOLID_KEEP = { "--good": "#2e7d4f", "--bad": "#b8352f", "--warn": "#8f6200", "--today": "#2f5fb3", "--focus": "#2f5fb3", "--series": "#3e64b0" };

function darkDecl(prop, value) {
  const p = prop.trim().toLowerCase();
  if (p.startsWith("--")) return null;
  const v = value.trim();
  const imp = v.includes("!important") ? " !important" : "";
  if (TEXT_PROPS.has(p)) {
    if (/^var\(--accent\)\s*(!important)?$/.test(v)) return "color-mix(in srgb, var(--accent) 50%, #ffffff)" + imp;
    // text in a surface color sits on an ink-colored fill (pills, toasts, avatars): white in dark
    if (/^var\(--(field|sheet|frame|panel)\)\s*(!important)?$/.test(v)) return "#ffffff" + imp;
    return mapColors(v, darkText);
  }
  if (SHADOW_PROPS.has(p)) return mapColors(v, darkShadow);
  if (SURFACE_PROPS.test(p)) {
    // an ink-colored fill (selected pills, toasts, tooltips, avatars) behind white text: a lighter gray in dark
    if (/^background(-color)?$/.test(p) && /^var\(--ink\)\s*(!important)?$/.test(v)) return "#454757" + imp;
    const solid = v.match(/^var\((--good|--bad|--warn|--today|--focus|--series)\)\s*(!important)?$/);
    if (solid && /^background(-color)?$/.test(p)) return SOLID_KEEP[solid[1]] + (solid[2] ? " !important" : "");
    return mapColors(v, darkSurface);
  }
  return null;
}

// ---------- a small CSS reader: rules and at-rule blocks ----------
function splitTop(s, sep) {
  const out = []; let depth = 0, cur = "", q = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { cur += ch; if (ch === q && s[i - 1] !== "\\") q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
function parse(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const nodes = []; let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open < 0) break;
    const prelude = css.slice(i, open).trim();
    // find the matching close, skipping strings
    let depth = 1, j = open + 1, q = null;
    for (; j < css.length && depth; j++) {
      const ch = css[j];
      if (q) { if (ch === q && css[j - 1] !== "\\") q = null; continue; }
      if (ch === '"' || ch === "'") q = ch;
      else if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    const inner = css.slice(open + 1, j - 1);
    if (prelude.startsWith("@")) {
      if (/^@(media|supports|container|layer)\b/.test(prelude)) nodes.push({ at: prelude, children: parse(inner) });
      // @keyframes, @font-face and the rest: left alone
    } else {
      nodes.push({ sel: prelude.replace(/^[;\s]+/, ""), body: inner });
    }
    i = j;
  }
  return nodes;
}
function darkSelector(sel) {
  return splitTop(sel, ",").map((s) => {
    s = s.trim();
    if (/^(html|:root)\b/.test(s)) return s.replace(/^(html|:root)/, 'html[data-theme="dark"]');
    return 'html[data-theme="dark"] ' + s;
  }).join(", ");
}
function emit(nodes) {
  let out = "";
  for (const n of nodes) {
    if (n.at) { const inner = emit(n.children); if (inner) out += `${n.at} {\n${inner}}\n`; continue; }
    if (!n.sel || n.sel.startsWith("@")) continue;
    const decls = [];
    for (const d of splitTop(n.body, ";")) {
      const k = d.indexOf(":");
      if (k < 0) continue;
      const prop = d.slice(0, k), val = d.slice(k + 1);
      const dv = darkDecl(prop, val);
      if (dv) decls.push(`${prop.trim()}: ${dv.trim()}`);
    }
    if (decls.length) out += `${darkSelector(n.sel)} { ${decls.join("; ")}; }\n`;
  }
  return out;
}

const TOKENS = `html[data-theme="dark"] {
  color-scheme: dark;
  --frame: #16171d; --sheet: #111218; --panel: #1c1d26; --inner: #2c2e3c; --field: #262733;
  --ink: #f0f0f5; --ink-2: #c9cad6; --muted: #a3a5bd;
  --accent-hover: color-mix(in srgb, var(--accent) 82%, #ffffff);
  --today: #8fb0ff; --focus: #8fb0ff; --good: #6fd39a; --warn: #f0c160; --bad: #ff8a80;
  --series: #8fb0ff; --series-soft: rgba(143, 176, 255, 0.18); --mark: rgba(229, 72, 77, 0.3);
  --pop-shadow: 0 16px 40px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.3);
  --scrim: rgba(0, 0, 0, 0.55);
  --card-shadow: 0 0 0 1px rgba(255, 255, 255, 0.05), 0 8px 24px -6px rgba(0, 0, 0, 0.5);
}
html[data-theme="dark"] img:not([src^="data:image/svg"]) { filter: none; }
`;

export function darkCss(pageCss) {
  return TOKENS + emit(parse(pageCss));
}

// ---------- build ----------
function build() {
  if (!fs.existsSync(SRC)) { console.log("  fs-src/ missing: no Fullscreen pages"); return; }
  fs.mkdirSync(OUT, { recursive: true });
  const v = crypto.createHash("sha256").update(fs.readFileSync(JS_FILE)).digest("hex").slice(0, 10);
  const tag = `<script src="/js/averages-fs.js?v=${v}"></script>`;
  let n = 0;
  for (const file of fs.readdirSync(SRC).filter((f) => f.endsWith(".html")).sort()) {
    let s = fs.readFileSync(path.join(SRC, file), "utf8");
    const styles = [...s.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
    // 1. the link to the app, first thing in <head>
    if (!/<head>/.test(s)) throw new Error(`${file}: no <head>`);
    s = s.replace(/<head>/, `<head>\n${tag}`);
    // 2. "In the app, this opens ..." moves for real
    const before = s;
    s = s.replace(/function toast\((\w+)\) \{/, (m, a) => `${m} if (window.__fsNav && window.__fsNav(${a})) return;`);
    if (s === before) throw new Error(`${file}: no toast() to route`);
    // 3. dark theme, after the page's own styles
    s = s.replace(/<\/head>/, `<style id="fsDark">\n${darkCss(styles)}</style>\n</head>`);
    s = s.replace(/<title>([^<]*?)\s*Mock<\/title>/, "<title>$1</title>");
    fs.writeFileSync(path.join(OUT, file), s);
    n++;
  }
  console.log(`  ok  ${n} Fullscreen pages -> public/fs/`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) build();
