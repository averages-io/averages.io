// Builds the Fullscreen pages.
import * as SHARED from "./signin-shared.mjs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../fs-src");
const OUT = path.resolve(HERE, "../public/IS");
const OLD = path.resolve(HERE, "../public/fs");
const JS_FILE = path.resolve(HERE, "../public/js/averages-fs.js");
const DATA_FILE = path.resolve(HERE, "../public/js/averages-fs-data.js");
const TURNIN_FILE = path.resolve(HERE, "../public/js/averages-fs-turnin.js");
const EMAIL_FILE = path.resolve(HERE, "../public/js/averages-email.js");
const LIVE_FILE = path.resolve(HERE, "../public/js/averages-live.js");
const GPA_FILE = path.resolve(HERE, "../public/js/averages-gpa.js");
const PREVIEW_FILE = path.resolve(HERE, "../public/js/averages-preview.js");
const NOTE_FILE = path.resolve(HERE, "../public/js/averages-note.js");
const AVATAR_FILE = path.resolve(HERE, "../public/js/averages-avatar.js");
const SPLASH_FILE = path.resolve(HERE, "../app/lib/splash.ts");
function splashTag() {
  const src = fs.readFileSync(SPLASH_FILE, "utf8").replace(/^export /gm, "");
  const { SPLASH_CSS, SPLASH_JS } = new Function(src + "\nreturn { SPLASH_CSS, SPLASH_JS };")();
  const js = SPLASH_JS.replace(/try\{var m=\+sessionStorage[\s\S]*?start\(\);\}\)\(\);$/, "})();");
  if (js === SPLASH_JS) throw new Error("splash.ts changed: couldn't take out its first-open start");
  const handoff = "(function(){var t=0;try{t=+sessionStorage.getItem('averages_fs_logo')||0;sessionStorage.removeItem('averages_fs_logo');}catch(e){}" +
    // a clean start (nothing loaded in this tab yet): the logo stays up until the page has its data, not a skeleton
    "if(!window.__averagesSplash)return;if(!t||Date.now()-t>15000){var fresh=false;try{fresh=!sessionStorage.getItem('schoolagy_bundle_cache');}catch(e){}if(!fresh)return;t=Date.now();}" +
    "var S=window.__averagesSplash,ready=false,up=false;S.show(12000);" +
    "function go(){if(ready&&up)S.hide();}setTimeout(function(){up=true;go();},Math.max(0,1000-(Date.now()-t)));" +
    "window.addEventListener('fs:ready',function(){ready=true;go();});})();";
  return `<style id="avSplash">${SPLASH_CSS}</style>\n<script>${js}${handoff}</script>`;
}
const SPLASH_TAG = splashTag();
// pages with the Turn in popup: they also get the turning-in code (averages-fs-turnin.js)
// The version line in Settings > About, the same as the Windowed pages' (scripts/port-pages.mjs):
// Beta <package.json version> (Build <first 7 of the commit Cloudflare is building>), "local" elsewhere.
import { execFileSync } from "node:child_process";
function buildVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(HERE, "../package.json"), "utf8"));
  const base = String(pkg.version || "0.0.0");
  const stage = typeof pkg.versionName === "string" ? pkg.versionName.trim().slice(0, 40) : "Beta";
  if (!process.env.WORKERS_CI) return { base, stage, sha: "local", when: "Built on this computer" };
  let sha = String(process.env.WORKERS_CI_COMMIT_SHA || "").trim();
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
    try { sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: path.resolve(HERE, ".."), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { sha = ""; }
  }
  const when = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return /^[0-9a-f]{7,40}$/i.test(sha) ? { base, stage, sha: sha.toLowerCase(), when: `Commit ${sha.toLowerCase()}, built ${when} Pacific` } : { base, stage, sha: "unknown", when: `Built ${when} Pacific` };
}
const VERSION = buildVersion();
const TURNIN_PAGES = new Set(["home.html", "assignments.html", "course-hub.html", "files.html", "settings.html"]);

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

function darkDecl(prop, value, sel = "") {
  const p = prop.trim().toLowerCase();
  if (p.startsWith("--")) return null;
  const v = value.trim();
  const imp = v.includes("!important") ? " !important" : "";
  if (TEXT_PROPS.has(p)) {
    // the accent stays the color picked in Settings (Martin, 2026-11-09: the 50%-white tint read as pink, not his red).
    // Icons get it exactly; text gets only a touch lighter so small words stay readable on the dark panels.
    if (/^var\(--accent\)\s*(!important)?$/.test(v)) return (/\bsvg\b|\.i\b|\.ico\b/.test(sel) ? "var(--accent)" : "color-mix(in srgb, var(--accent) 88%, #ffffff)") + imp;
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
    if (/--keep-dark\s*:/.test(n.body)) continue; // a rule whose colors are already right in dark (a dark backdrop): left alone
    if (/data-theme=["']?dark/.test(n.sel)) continue; // already written for dark mode by hand (2026-10-30): leave it as it is
    const decls = [];
    for (const d of splitTop(n.body, ";")) {
      const k = d.indexOf(":");
      if (k < 0) continue;
      const prop = d.slice(0, k), val = d.slice(k + 1);
      if (/#2b1d00/i.test(val)) continue; // sticker ink on yellow: stays dark in dark mode too
      const dv = darkDecl(prop, val, n.sel);
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
  fs.rmSync(OLD, { recursive: true, force: true });
  fs.mkdirSync(OLD, { recursive: true });
  const ver = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex").slice(0, 10);
  const tag = `${SPLASH_TAG}\n<script src="/js/averages-avatar.js?v=${ver(AVATAR_FILE)}"></script>\n<script src="/js/averages-note.js?v=${ver(NOTE_FILE)}"></script>\n<script src="/js/averages-fs.js?v=${ver(JS_FILE)}"></script>\n<script src="/js/averages-fs-data.js?v=${ver(DATA_FILE)}"></script>\n<script src="/js/averages-live.js?v=${ver(LIVE_FILE)}" defer></script>\n<script src="/js/averages-gpa.js?v=${ver(GPA_FILE)}" defer></script>\n<script src="/js/averages-preview.js?v=${ver(PREVIEW_FILE)}" defer></script>`;
  let n = 0;
  const LIGHT_CSS = [
    ".sum-view{transition:opacity 150ms ease!important}.sum-view.switching{filter:none!important}",
    // the sidebar: its width still slides; the shadow and the labels' spacing switch at once instead of
    // re-drawing a big soft shadow over the page every frame
  ].join("");
  const EASE = ".25s cubic-bezier(.77,0,.175,1)";
  const CLOSED = ".app:not(.pinned):not(.menu) #side:not(:hover):not(.hold):not(:has(:focus-visible))";
  const SIDE_CSS = [
    ".app{--rail:56px;--side-open:260px}",
    "#side [hidden]{display:none!important}",
    "a.brand{color:inherit;text-decoration:none;border-radius:12px;cursor:pointer}a.brand:focus-visible{outline:2px solid var(--accent);outline-offset:-4px}",
    "#side{display:flex;flex-direction:column;overflow:hidden!important;padding:0;border-radius:0!important}",
    "@media (min-width:681px){#side{transition:width " + EASE + ",box-shadow .25s ease!important}#side:is(:hover,.hold,:has(:focus-visible)){transition-delay:.06s,0s!important}" +
      ".app:not(.pinned) #side:is(:hover,.hold,:has(:focus-visible)){z-index:65;box-shadow:1px 0 0 var(--inner),12px 0 32px -12px rgba(20,21,31,.2)}}",
    "#side .divider,#side .side-h{display:none!important}",
    // the list scrolls under a fixed footer and fades out at an edge while there's more that way
    "#side .side-scroll{flex:1 1 auto;min-height:0;overflow:hidden auto;overscroll-behavior:contain;scrollbar-width:none;padding:12px 10px;scroll-padding:24px 0;--ft:0px;--fb:0px;" +
      "-webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 var(--ft),#000 calc(100% - var(--fb)),transparent 100%);mask-image:linear-gradient(to bottom,transparent 0,#000 var(--ft),#000 calc(100% - var(--fb)),transparent 100%)}",
    "#side .side-scroll::-webkit-scrollbar{display:none}#side .side-scroll.side-up{--ft:24px}#side .side-scroll.side-more{--fb:24px}",
    // rows
    "#side .nav,#side .cls{display:flex;flex-direction:column;gap:1px;padding:0;margin:0;width:auto;flex:none}",
    "#side .nav a,#side .cls a{display:flex;align-items:center;gap:12px;height:auto;min-height:34px;padding:0 9px;border-radius:10px;font-size:14px;font-weight:700;color:var(--ink-2);background:none;overflow:hidden;white-space:nowrap;position:relative;transition:background-color .12s ease!important}",
    "#side .nav a:hover,#side .cls a:hover{background:var(--inner);color:var(--ink)}",
    "#side .nav a.on,#side .cls a.here,#side .cls a[aria-current]{background:var(--sheet);color:var(--ink);font-weight:800}#side .nav a.on svg.i{color:var(--accent)}",
    // classes: their tile in place of an icon, the name, the grade at the end
    "#side .cls a{gap:9px;padding:0 6px}#side .cls a>.badge{width:24px;height:24px;border-radius:7px;margin:0}",
    "#side .side-cl>a>span.fade:not(.g){flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}#side .side-cl>a>.g{flex:none;margin-left:auto;font-size:13px}",
    // the search box
    "#side #sideSearch{min-height:34px;height:34px;margin:0 0 12px;gap:12px;font-weight:700;color:var(--muted);background:var(--field);box-shadow:inset 0 0 0 2px var(--inner);transition:margin " + EASE + ",box-shadow .12s ease,background-color .12s ease!important}",
    "#side #sideSearch:hover{background:color-mix(in srgb,var(--inner) 35%,var(--field));color:var(--ink-2)}",
    "#side #sideSearch .side-kbd{margin-left:auto;padding:0 6px;border-radius:6px;background:var(--panel);font-size:11px;font-weight:800;line-height:20px;color:var(--muted)}",
    CLOSED + " #sideSearch{margin-bottom:0;background:none;box-shadow:none}",
    // group labels: a grey label open, a thin line closed
    "#side .side-sec{display:block;flex:none;box-sizing:border-box;height:40px;margin:0;padding:16px 12px 8px 8px;overflow:hidden;font-size:12px;line-height:16px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);white-space:nowrap;background:none;border-bottom:1px solid transparent;" +
      "transition:height " + EASE + ",margin " + EASE + ",padding " + EASE + ",border-color " + EASE + "}",
    CLOSED + " .side-sec{height:0;padding:0;margin:12px 0;border-bottom-color:var(--inner);color:transparent}",
    // what only makes sense open: counts, grades, the arrow, the shortcut; on the rail a dot on the icon says there's a count
    "#side :is(.side-chev,.count,.g,.side-kbd){transition:opacity .15s ease}",
    CLOSED + " :is(.side-chev,.count,.g,.side-kbd){opacity:0}",
    "#side .nav a .pip{left:21px;top:6px}",
    // a folder (Recents): the arrow turns, its rows slide open, hanging off a line under the folder's icon
    "#side .side-chev{display:inline-flex;width:16px;height:16px;flex:none;margin-left:auto;color:var(--muted);transition:transform " + EASE + ",opacity .15s ease}#side .side-chev svg{display:block;width:100%;height:100%}",
    "#side #sideRec[aria-expanded=true] .side-chev{transform:rotate(90deg)}",
    "#side .side-subw{display:grid;grid-template-rows:0fr;transition:grid-template-rows " + EASE + "}#side .side-subw.on{grid-template-rows:1fr}" + CLOSED + " .side-subw.on{grid-template-rows:0fr}",
    "#side .side-subw>.side-sub{min-height:0;overflow:hidden}",
    "#side .side-sub{position:relative;display:flex;flex-direction:column;gap:1px;margin:0;padding:0 0 0 28px;border:0;height:auto}",
    "#side .side-sub::before{content:'';position:absolute;left:18px;top:1px;bottom:1px;width:1px;background:var(--inner)}",
    "#side .nav a.side-recl{display:flex;flex-direction:column;align-items:stretch;justify-content:center;gap:1px;min-height:34px;padding:8px 12px 8px 11px;text-align:left;border-radius:8px;color:var(--ink);white-space:nowrap;overflow:hidden}",
    "#side .nav a.side-recl:hover{background:var(--inner)}",
    "#side .side-recl b{font-size:14px;line-height:18px;font-weight:800;overflow:hidden;text-overflow:ellipsis}#side .side-recl small{font-size:12px;line-height:16px;font-weight:700;color:var(--muted);overflow:hidden;text-overflow:ellipsis}",
    "#side .side-none{margin:0;padding:8px 12px 8px 11px;font-size:13px;font-weight:700;color:var(--muted);white-space:normal}",
    // the footer: just the open/close button, under a line
    "#side .foot{flex:none;position:static;margin:0;width:100%;height:48px;padding:0 11px;display:flex;align-items:center;gap:12px;border-top:1px solid var(--inner);background:var(--frame);box-shadow:none}",
    "#side .foot .ibtn{width:34px;height:34px;border-radius:10px;flex:none;background:none;color:var(--muted)}#side .foot .ibtn:hover{background:var(--inner);color:var(--ink)}#side .foot #pinLabel{font-size:13px;font-weight:700;color:var(--muted);white-space:nowrap}",
    "@media (max-width:1020px){#side .foot{display:none}}",
    "body.potato-mode #side,body.potato-mode #side *{transition:none!important}@media (prefers-reduced-motion:reduce){#side,#side *{transition:none!important}}",
  ].join("");
  const CHROME_JS = `(function(){var d=document,r=d.documentElement,a=d.getElementById('app'),s=d.getElementById('side');if(!a||!s)return;r.classList.add('fs-boot');try{window.__fsSide&&window.__fsSide()}catch(e){}
try{var pin=false;try{pin=JSON.parse(localStorage.getItem('fsmock_pinned'))===true}catch(e){}if(pin)a.classList.add('pinned');
var j=JSON.parse(sessionStorage.getItem('averages_fs_chrome')||'null');if(j&&Date.now()-j.at<15000&&Date.now()>=j.at){
var c=d.getElementById('sideClasses');if(c&&!c.children.length&&j.cls){c.innerHTML=j.cls;[].forEach.call(c.querySelectorAll('.here,[aria-current]'),function(x){x.classList.remove('here');x.removeAttribute('aria-current')})}
if(j.av)[].forEach.call(d.querySelectorAll('.top [data-av]'),function(v){v.className=j.av.c;if(j.av.s)v.setAttribute('style',j.av.s);v.textContent=j.av.t;v.setAttribute('data-avk','')});
for(var k in j.ct){var e=d.getElementById(k);if(e){e.textContent=j.ct[k].n;e.hidden=j.ct[k].h}}
if(j.st>0){var st=j.st,sc=d.getElementById('sideScroll')||s;sc.scrollTop=st;requestAnimationFrame(function(){sc.scrollTop=st})}if(j.hold&&!pin){s.classList.add('hold');var drop=function(ev){var q=s.getBoundingClientRect();if(ev.clientX>q.right||ev.clientX<q.left||ev.clientY<q.top||ev.clientY>q.bottom){s.classList.remove('hold');d.removeEventListener('pointermove',drop)}};d.addEventListener('pointermove',drop)}}}catch(e){}
requestAnimationFrame(function(){requestAnimationFrame(function(){r.classList.remove('fs-boot')})})})();`;
  for (const file of fs.readdirSync(SRC).filter((f) => f.endsWith(".html")).sort()) {
    if (file === "signin.html") { buildSignin(); continue; }
    let s = fs.readFileSync(path.join(SRC, file), "utf8");
    const styles = [...s.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
    // 1. the link to the app, first thing in <head>
    if (!/<head>/.test(s)) throw new Error(`${file}: no <head>`);
    s = s.replace(/const VER = "[^"]*", SHA = "[^"]*", WHEN = "[^"]*", STAGE = "[^"]*";/, `const VER = ${JSON.stringify(VERSION.base)}, SHA = ${JSON.stringify(VERSION.sha)}, WHEN = ${JSON.stringify(VERSION.when)}, STAGE = ${JSON.stringify(VERSION.stage ? VERSION.stage + " " : "")};`);
    s = s.replace(/<head>/, `<head>\n${tag}${TURNIN_PAGES.has(file) ? `\n<script src="/js/averages-fs-turnin.js?v=${ver(TURNIN_FILE)}"></script>` : ""}${file === "settings.html" ? `\n<script src="/js/averages-email.js?v=${ver(EMAIL_FILE)}" defer></script>` : ""}`);
    // 2. "In the app, this opens ..." moves for real
    const before = s;
    s = s.replace(/function toast\((\w+)\) \{/, (m, a) => `${m} if (window.__fsNav && window.__fsNav(${a})) return;`);
    if (s === before) throw new Error(`${file}: no toast() to route`);
    // 3. the page's own scripts wait for its real data (averages-fs-data.js runs them)
    const at = s.indexOf("<body");
    if (at < 0) throw new Error(`${file}: no <body>`);
    const held = s.slice(at).replace(/<script(\s+id="[^"]*")?>/g, (m, id) => `<script type="text/fs-wait"${id || ""}>`);
    s = s.slice(0, at) + held;
    {
      const sideAt = s.indexOf('<aside class="side" id="side"'), end = sideAt < 0 ? -1 : s.indexOf("</aside>", sideAt);
      if (end < 0) throw new Error(`${file}: no sidebar`);
      s = s.slice(0, end + 8) + `\n<script>${CHROME_JS}</script>` + s.slice(end + 8);
    }
    // 3c. the page skeleton, drawn as soon as the page's frame is there (averages-fs-data.js's __fsSkel)
    s = s.replace(/(<div class="wrap[^"]*">)/, '$1<script>window.__fsSkel&&window.__fsSkel()</script>');
    // 4. dark theme, after the page's own styles
    s = s.replace(/<\/head>/, `<style id="fsDark">\n${darkCss(styles)}</style>\n</head>`);
    s = s.replace(/<\/head>/, `<style id="fsLight">${LIGHT_CSS}</style>\n</head>`);
    s = s.replace(/<\/head>/, `<style id="fsSide">${SIDE_CSS}</style>\n</head>`);
    s = s.replace(/<title>([^<]*?)\s*Mock<\/title>/, "<title>$1</title>");
    fs.writeFileSync(path.join(OUT, file), s);
    // the old address moves here
    const page = file.replace(/\.html$/, "");
    fs.writeFileSync(path.join(OLD, file), `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Averages.io</title><script>location.replace("/IS/${page}" + location.search + location.hash)</script><noscript><meta http-equiv="refresh" content="0; url=/IS/${page}"></noscript>\n`);
    n++;
  }
  console.log(`  ok  ${n} Fullscreen pages -> public/IS/ (old /fs/ addresses move there)`);
}


// The new sign-in page (/IS/signin, shown at "/" while the app's NEW_SIGNIN_PAGE switch is 1). Signed out, so none of
// the app's data scripts: just its version line, the theme, the checking logo and the error messages.
function buildSignin() {
  let s = fs.readFileSync(path.join(SRC, "signin.html"), "utf8");
  const styles = [...s.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
  const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  s = s.replaceAll("__AVERAGES_STAGE__ ", VERSION.stage ? esc(VERSION.stage) + " " : "").replaceAll("__AVERAGES_BASE__", esc(VERSION.base))
    .replaceAll("__AVERAGES_COMMIT__", esc(VERSION.when)).replaceAll("__AVERAGES_BUILD__", esc(VERSION.sha.slice(0, 7)));
  s = s.replace("__SIGNIN_ERRORS__", JSON.stringify(SHARED.ERROR_MESSAGES)).replace("__SCHOOLOGY_ERRORS__", JSON.stringify(SHARED.SCHOOLOGY_SIGNIN_ERRORS));
  const theme = "(function(){try{var v=localStorage.getItem('schoolagy_dark_mode'),d=v==='dark'||(v!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches),r=document.documentElement;r.setAttribute('data-theme',d?'dark':'light');r.style.colorScheme=d?'dark':'light'}catch(e){}})();";
  s = s.replace(/<head>/, `<head>\n<script>${theme}</script>\n<style>${SHARED.CHECKING_CSS}</style>\n<script>${SHARED.CHECKING_JS}</script>`);
  s = s.replace(/<\/head>/, `<style id="fsDark">\n${darkCss(styles)}</style>\n</head>`);
  if (/__AVERAGES_|__SIGNIN_ERRORS__|__SCHOOLOGY_ERRORS__/.test(s)) throw new Error("signin.html: a placeholder was left");
  fs.writeFileSync(path.join(OUT, "signin.html"), s);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) build();
