/*
 * File type icons (2026-10-09, Martin; design in the project doc claude/file-icons.md).
 *
 * A see-through page with a line in the type's color around it and a folded
 * corner. The label (PDF, DOC, ZIP…, Fredoka Bold, same color) runs across
 * the page and cuts through the outline; a small drawing for the type sits
 * above it, cut off by the fold along the crease's own curve.
 *   - At rest only the drawing shows; hovering the file's row or tile (or
 *     focusing it) slides the drawing up, opens the outline and fades the
 *     label in. Devices without hover always show the label.
 *   - The outline glows only in dark mode (body.dark-mode).
 *   - Below 34 px (list rows) there's no label: the drawing alone, outline whole.
 *
 * Loaded in <head> by app/layout.tsx. Pages call
 *   AveragesFileIcons.html(extOrName, { mime, size })  -> <span class="avfi">…</span>
 *   AveragesFileIcons.svg(extOrName, { mime, size, small }) -> <svg>…</svg> (fills its box when size is left out)
 *   AveragesFileIcons.key(extOrName, mime)            -> 'pdf' | 'doc' | … | 'file'
 *   AveragesFileIcons.color(extOrName, mime)          -> '#E5484D' …
 * Pages keep their old badge when this script isn't there, so nothing breaks.
 */
(function () {
  'use strict';
  if (window.AveragesFileIcons) return;

  // key: [label, color, name]
  const T = {
    pdf: ['PDF', '#E5484D', 'PDF'],
    doc: ['DOC', '#2F6FDB', 'Word document'],
    ppt: ['PPT', '#D9682B', 'PowerPoint'],
    xls: ['XLS', '#23864F', 'Excel spreadsheet'],
    csv: ['CSV', '#23864F', 'CSV'],
    gdoc: ['DOC', '#1A73E8', 'Google Docs'],
    gsheet: ['SHT', '#188038', 'Google Sheets'],
    gslide: ['SLD', '#E37400', 'Google Slides'],
    canva: ['CNV', '#7D2AE8', 'Canva design'],
    img: ['IMG', '#8B4FD8', 'Image'],
    vid: ['VID', '#D02670', 'Video'],
    aud: ['AUD', '#0F8A80', 'Audio'],
    txt: ['TXT', '#5F6372', 'Text'],
    code: ['CODE', '#4B4FD1', 'Code'],
    zip: ['ZIP', '#7A6A58', 'Archive'],
    link: ['URL', '#0B7FB8', 'Link'],
    pages: ['PGS', '#E8781E', 'Pages'],
    key: ['KEY', '#1F7BEA', 'Keynote'],
    num: ['NUM', '#2A9D4B', 'Numbers'],
    gform: ['FORM', '#673AB7', 'Google Forms'],
    gdraw: ['DRW', '#D93025', 'Google Drawings'],
    svg: ['SVG', '#D9480F', 'Vector image'],
    html: ['HTML', '#D9411E', 'Web page'],
    json: ['JSON', '#56687A', 'Data'],
    py: ['PY', '#3572A5', 'Python'],
    sb3: ['SB3', '#E69500', 'Scratch project'],
    epub: ['BOOK', '#8A5A2B', 'E-book'],
    ics: ['ICS', '#C2410C', 'Calendar event'],
    font: ['FONT', '#3F4152', 'Font'],
    file: ['FILE', '#6E7088', 'File'],
  };

  // Extensions (and the names pages already use) to keys.
  const EXT = {};
  const add = (key, list) => list.split(' ').forEach((e) => { EXT[e] = key; });
  add('pdf', 'pdf');
  add('doc', 'doc docx rtf odt dot dotx');
  add('ppt', 'ppt pptx odp pps ppsx');
  add('xls', 'xls xlsx ods xlsm');
  add('csv', 'csv tsv');
  add('gdoc', 'gdoc');
  add('gsheet', 'gsheet sheet sheets');
  add('gslide', 'gslide gslides slides');
  add('gform', 'gform form forms');
  add('gdraw', 'gdraw draw drawing');
  add('canva', 'canva');
  add('img', 'png jpg jpeg gif heic heif webp bmp tif tiff avif image');
  add('svg', 'svg ai eps');
  add('vid', 'mp4 mov webm avi m4v mkv video youtube');
  add('aud', 'mp3 m4a wav ogg aac flac audio');
  add('txt', 'txt md text');
  add('code', 'js ts jsx tsx java c cpp h cs go rb swift kt rs php sh');
  add('py', 'py ipynb');
  add('html', 'html htm css');
  add('json', 'json xml yaml yml');
  add('zip', 'zip rar 7z tar gz tgz');
  add('pages', 'pages');
  add('key', 'key');
  add('num', 'numbers');
  add('epub', 'epub mobi');
  add('ics', 'ics');
  add('font', 'ttf otf woff woff2');
  add('sb3', 'sb3 sb2');
  add('link', 'link url');
  const MIME = {
    'application/vnd.google-apps.document': 'gdoc',
    'application/vnd.google-apps.spreadsheet': 'gsheet',
    'application/vnd.google-apps.presentation': 'gslide',
    'application/vnd.google-apps.form': 'gform',
    'application/vnd.google-apps.drawing': 'gdraw',
    'application/pdf': 'pdf',
  };

  function key(extOrName, mime) {
    if (mime && MIME[mime]) return MIME[mime];
    let s = String(extOrName == null ? '' : extOrName).trim().toLowerCase();
    if (T[s] && !EXT[s]) return s;
    const m = s.match(/\.([a-z0-9]{1,8})$/);
    if (m) s = m[1];
    if (EXT[s]) return EXT[s];
    if (mime) {
      if (/^image\//.test(mime)) return 'img';
      if (/^video\//.test(mime)) return 'vid';
      if (/^audio\//.test(mime)) return 'aud';
      if (/^text\//.test(mime)) return 'txt';
    }
    return 'file';
  }

  // The drawings, on a 40 x 48 page, in white (recolored when drawn).
  const SANS = "font-family=\"-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif\"";
  const ST = 'fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round"';
  const lines = `<path ${ST} stroke-width="2.2" d="M8 11h12M8 16.5h20M8 22h15"/>`;
  const slide = `<rect ${ST} stroke-width="2" x="7.5" y="9.5" width="25" height="15" rx="2.5"/><path ${ST} stroke-width="2" d="M12 15h9M12 19.5h13"/>`;
  const grid = `<g ${ST} stroke-width="1.7"><rect x="7.5" y="8.5" width="25" height="18" rx="2.5"/><path d="M7.5 14.5h25M7.5 20.5h25M16 8.5v18M24.5 8.5v18"/></g>`;
  let teeth = '';
  for (let y = 0; y <= 20; y += 4) teeth += `<rect x="16.6" y="${y}" width="3.4" height="2" rx=".6" fill="#fff"/><rect x="20" y="${y + 2}" width="3.4" height="2" rx=".6" fill="#fff"/>`;
  const G = {
    pdf: `${lines}<path ${ST} stroke-width="2.2" d="M8 11h8"/>`,
    doc: lines,
    gdoc: lines,
    pages: lines,
    file: `<path ${ST} stroke-width="2.2" d="M8 12h14M8 18h18"/>`,
    ppt: slide,
    gslide: slide,
    key: slide,
    xls: grid,
    gsheet: grid,
    num: grid,
    csv: `<path ${ST} stroke-width="2" d="M8 11h24M8 17h24M8 23h24"/><g fill="#fff"><circle cx="16" cy="11" r="1.6"/><circle cx="24" cy="11" r="1.6"/><circle cx="16" cy="17" r="1.6"/><circle cx="24" cy="17" r="1.6"/><circle cx="16" cy="23" r="1.6"/><circle cx="24" cy="23" r="1.6"/></g>`,
    canva: `<path ${ST} stroke-width="2" d="M20 8.5a9 9 0 1 0 0 18c1.6 0 2-1.4 1.2-2.4-.9-1.1-.3-2.6 1.2-2.6h2.6a4.5 4.5 0 0 0 4.5-4.5c0-4.7-4.3-8.5-9.5-8.5z"/><g fill="#fff"><circle cx="15" cy="15" r="1.6"/><circle cx="19.5" cy="12.5" r="1.6"/><circle cx="15.5" cy="20.5" r="1.6"/></g>`,
    img: '<circle cx="13" cy="12" r="3" fill="#fff"/><path d="M6.5 26l8-9 5.5 6 4-4.5 9.5 7.5z" fill="#fff"/>',
    vid: `<rect ${ST} stroke-width="2" x="7.5" y="8.5" width="25" height="18" rx="3"/><path d="M17 12.5v10l8-5z" fill="#fff"/>`,
    aud: `<path ${ST} stroke-width="2.4" d="M9 15v5M14 11v13M19 13v9M24 9v17M29 14v7"/>`,
    txt: `<text x="20" y="23" text-anchor="middle" ${SANS} font-size="12" font-weight="800" fill="#fff">Abc</text>`,
    code: `<path ${ST} stroke-width="2.4" d="M13 11.5l-5.5 5.5 5.5 5.5M27 11.5l5.5 5.5-5.5 5.5M22.5 9.5l-5 15"/>`,
    zip: `${teeth}<rect x="16.2" y="23.5" width="7.6" height="6" rx="1.8" fill="#fff"/>`,
    gform: `<g fill="#fff"><circle cx="10" cy="10.5" r="1.9"/><circle cx="10" cy="17" r="1.9"/><circle cx="10" cy="23.5" r="1.9"/></g><path ${ST} stroke-width="2.2" d="M15 10.5h15M15 17h15M15 23.5h11"/>`,
    gdraw: `<g ${ST} stroke-width="2"><circle cx="13" cy="14" r="5"/><rect x="18.5" y="16" width="13" height="10" rx="1.5"/></g>`,
    svg: `<path ${ST} stroke-width="2" d="M7.5 25C10 8 27 8 29.5 25"/><path ${ST} stroke-width="1.4" d="M12.5 12.25h12"/><g fill="#fff"><rect x="5.5" y="23" width="4" height="4" rx=".8"/><rect x="27.5" y="23" width="4" height="4" rx=".8"/><rect x="16.6" y="10.35" width="3.8" height="3.8" rx=".8"/><circle cx="12.5" cy="12.25" r="1.7"/><circle cx="24.5" cy="12.25" r="1.7"/></g>`,
    html: `<g ${ST} stroke-width="2"><circle cx="20" cy="17" r="8.5"/><path d="M11.5 17h17"/><ellipse cx="20" cy="17" rx="3.6" ry="8.5"/></g>`,
    json: `<path ${ST} stroke-width="2.3" d="M15 9.5c-3 0-3 2-3 4s-1 3.5-3 3.5c2 0 3 1.5 3 3.5s0 4 3 4M25 9.5c3 0 3 2 3 4s1 3.5 3 3.5c-2 0-3 1.5-3 3.5s0 4-3 4"/>`,
    py: `<path ${ST} stroke-width="2.4" d="M9 11.5l5.5 5.5L9 22.5M17.5 23.5h12"/>`,
    sb3: '<g fill="#fff"><path d="M8 9h7l1.5 1.5h3L21 9h4a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2z"/><path d="M14 18h7l1.5 1.5h3L27 18h4a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2z"/></g>',
    epub: `<path ${ST} stroke-width="2" d="M20 12v14M20 12c-3-2-8-2-11 0v14c3-2 8-2 11 0M20 12c3-2 8-2 11 0v14c-3-2-8-2-11 0"/>`,
    ics: `<g ${ST} stroke-width="2"><rect x="8.5" y="10" width="23" height="16" rx="3"/><path d="M8.5 15h23M14 8v4M26 8v4"/></g><rect x="13" y="18.5" width="4" height="4" rx="1" fill="#fff"/>`,
    font: '<text x="20" y="24" text-anchor="middle" font-family="Georgia,\'Times New Roman\',serif" font-size="15" font-weight="700" fill="#fff">Aa</text>',
    link: `<g ${ST} stroke-width="2.4"><path d="M18.3 19.7a4.2 4.2 0 0 0 6 0l4-4a4.2 4.2 0 0 0-6-6l-1.6 1.6"/><path d="M21.7 15.3a4.2 4.2 0 0 0-6 0l-4 4a4.2 4.2 0 0 0 6 6l1.6-1.6"/></g>`,
  };

  const CSS = `
@font-face { font-family: 'AvFredoka'; font-style: normal; font-weight: 700; font-display: swap; src: url('/fonts/fredoka-700.woff2') format('woff2'); }
.avfi { display: inline-flex; flex: none; align-items: center; justify-content: center; line-height: 0; }
.avfi svg { overflow: visible; }
.avfi-sym { transform: translateY(6px); transition: transform .28s cubic-bezier(.2,.8,.2,1); }
.avfi-label { opacity: 0; transform: translateY(3px); transition: opacity .2s ease, transform .28s cubic-bezier(.2,.8,.2,1); }
.avfi-gap { opacity: 0; transition: opacity .2s ease; }
:is(.avfi, .avfi-host, .material-row, .fx-row, .fx-tile, .item-tile, tr, .upload-picked-row):is(:hover, :focus-within) .avfi-sym,
.avfi:hover .avfi-sym { transform: none; }
:is(.avfi, .avfi-host, .material-row, .fx-row, .fx-tile, .item-tile, tr, .upload-picked-row):is(:hover, :focus-within) .avfi-label,
.avfi:hover .avfi-label { opacity: 1; transform: none; }
:is(.avfi, .avfi-host, .material-row, .fx-row, .fx-tile, .item-tile, tr, .upload-picked-row):is(:hover, :focus-within) .avfi-gap,
.avfi:hover .avfi-gap { opacity: 1; }
.avfi-glow { filter: none; }
body.dark-mode .avfi-glow { filter: url(#avfiGlow); }
@media (hover: none) { .avfi-sym, .avfi-label { transform: none; } .avfi-label, .avfi-gap { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .avfi-sym, .avfi-label, .avfi-gap { transition: none; } }
body.potato-mode .avfi-sym, body.potato-mode .avfi-label { transform: none; }
body.potato-mode .avfi-label, body.potato-mode .avfi-gap { opacity: 1; }
`;
  const GLOW = '<svg id="avfiDefs" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><filter id="avfiGlow" filterUnits="userSpaceOnUse" x="-6" y="-4" width="52" height="56"><feGaussianBlur in="SourceGraphic" stdDeviation="1.5" result="b"/><feComponentTransfer in="b" result="b2"><feFuncA type="linear" slope="1.4"/></feComponentTransfer><feMerge><feMergeNode in="b2"/><feMergeNode in="SourceGraphic"/></feMerge></filter></svg>';

  function setup() {
    if (!document.documentElement) return;   // too early (no page yet): DOMContentLoaded tries again
    if (!document.getElementById('avfiStyle')) {
      const st = document.createElement('style');
      st.id = 'avfiStyle';
      st.textContent = CSS;
      (document.head || document.documentElement).appendChild(st);
    }
    if (document.body && !document.getElementById('avfiDefs')) document.body.insertAdjacentHTML('beforeend', GLOW);
  }
  setup();
  if (!document.body) document.addEventListener('DOMContentLoaded', setup, { once: true });

  let n = 0;
  /** The icon as an <svg>. size = the square box in px; left out, it fills its container. */
  function svg(extOrName, opts) {
    setup();
    const o = opts || {};
    const k = T[o.key] ? o.key : key(extOrName, o.mime);
    const [label, c] = T[k];
    const small = o.small === true || (typeof o.size === 'number' && o.size < 34);
    const text = small ? '' : label;
    const id = 'avfi' + (++n);
    const sw = small ? 3 : 2.4;
    const fs = { 1: 17, 2: 17, 3: 15.5, 4: 12.5 }[text.length] || 11;
    const base = 37;
    const top = base - fs * 0.74 - 2.2;
    const bottom = base + 2.4;
    const gap = text ? `<mask id="${id}m" maskUnits="userSpaceOnUse" x="-4" y="0" width="48" height="48"><rect x="-4" y="0" width="48" height="48" fill="#fff"/><rect class="avfi-gap" x="-4" y="${top.toFixed(2)}" width="48" height="${(bottom - top).toFixed(2)}" fill="#000"/></mask>` : '';
    // The fold cuts the drawing off along the crease's own curve.
    const crease = `<mask id="${id}c" maskUnits="userSpaceOnUse" x="-4" y="0" width="48" height="48"><rect x="-4" y="0" width="48" height="48" fill="#fff"/><path d="M24.4 -2V8.1a7.5 7.5 0 0 0 7.5 7.5H46V-2z" fill="#000"/></mask>`;
    const drawn = (G[k] || '').split('#fff').join(c);
    const art = `<g mask="url(#${id}c)"><g${small ? '' : ' class="avfi-sym"'}><g transform="${small ? 'translate(0 6)' : 'translate(3.4 0.6) scale(0.84)'}">${drawn}</g></g></g>`;
    const label2 = text ? `<text class="avfi-label" x="20" y="${base}" text-anchor="middle" font-family="AvFredoka, ${SANS.slice(13, -1)}" font-size="${fs}" font-weight="700" textLength="41" lengthAdjust="${text.length <= 2 ? 'spacing' : 'spacingAndGlyphs'}" fill="${c}">${text}</text>` : '';
    const dims = typeof o.size === 'number' ? ` width="${o.size}" height="${o.size}"` : '';
    return `<svg${dims} viewBox="-4 0 48 48" aria-hidden="true" focusable="false"><defs>${gap}${crease}</defs>`
      + `<g class="avfi-glow"><g${gap ? ` mask="url(#${id}m)"` : ''} fill="none" stroke="${c}" stroke-width="${sw}" stroke-linejoin="round">`
      + '<path d="M8.5 1.5h17.4L38.5 14.1V39.5a7 7 0 0 1-7 7h-23a7 7 0 0 1-7-7V8.5a7 7 0 0 1 7-7z"/><path d="M25.9 1.5v6.6a6 6 0 0 0 6 6h6.6"/></g></g>'
      + art + label2 + '</svg>';
  }

  /** The icon in a sized box, for rows and chips. */
  function html(extOrName, opts) {
    const o = opts || {};
    const size = typeof o.size === 'number' ? o.size : 34;
    const k = T[o.key] ? o.key : key(extOrName, o.mime);
    return `<span class="avfi${o.className ? ' ' + o.className : ''}" style="width:${size}px;height:${size}px" data-type="${k}" aria-hidden="true">${svg(extOrName, Object.assign({}, o, { size, key: k }))}</span>`;
  }

  window.AveragesFileIcons = {
    key,
    svg,
    html,
    color: (extOrName, mime) => T[key(extOrName, mime)][1],
    name: (extOrName, mime) => T[key(extOrName, mime)][2],
    label: (extOrName, mime) => T[key(extOrName, mime)][0],
  };
})();
