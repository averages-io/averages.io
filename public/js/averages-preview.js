/*
 * The file previewer, everywhere (both looks): a dark full-window popup with the file's name on top, Open in a new
 * tab and Download, and arrows at the sides that go page by page through a PDF, then on to the next file.
 * AveragesPreview.open(files, at) with files = [{ name, url, download?, sub? }] (url: the address that shows it).
 * AveragesPreview.kind(name): 'pdf' | 'image' | 'text' | 'audio' | 'video' | '' (no preview).
 * PDFs draw with the app's own pdf.js (/vendor), like the Messages previewer.
 */
(function () {
  'use strict';
  if (window.AveragesPreview) return;
  var PDFJS_DIR = '/vendor/pdfjs-4.10.38/', LIB = null, DOCS = {}, ORDER = [];
  function lib() { return LIB || (LIB = import(PDFJS_DIR + 'pdf.min.mjs').then(function (l) { l.GlobalWorkerOptions.workerSrc = PDFJS_DIR + 'pdf.worker.min.mjs'; return l; }, function (e) { LIB = null; throw e; })); }
  function kind(name) {
    var x = (String(name || '').match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
    return x === 'pdf' ? 'pdf' : /^(png|jpe?g|gif|webp)$/.test(x) ? 'image' : /^(txt|csv|md|json)$/.test(x) ? 'text' : /^(mp3|m4a|wav|ogg)$/.test(x) ? 'audio' : /^(mp4|webm|mov)$/.test(x) ? 'video' : '';
  }
  function pdf(url) {
    if (DOCS[url]) return DOCS[url];
    var p = Promise.all([lib(), fetch(url, { credentials: 'include' }).then(function (r) { if (!r.ok) throw new Error('http_' + r.status); return r.arrayBuffer(); })])
      .then(function (v) { return v[0].getDocument({ data: new Uint8Array(v[1]), isEvalSupported: false }).promise; });
    DOCS[url] = p; ORDER.push(url); p.catch(function () { delete DOCS[url]; });
    while (ORDER.length > 6) { var old = ORDER.shift(), d = DOCS[old]; delete DOCS[old]; if (d) d.then(function (doc) { doc.destroy(); }, function () {}); }
    return p;
  }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function calm() { try { return document.body.classList.contains('potato-mode') || matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  var ICON = {
    x: '<path d="M6 6l12 12M18 6 6 18"/>', l: '<path d="M14.5 6 8.5 12l6 6"/>', r: '<path d="m9.5 6 6 6-6 6"/>',
    tab: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>', dl: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  };
  function ico(k) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[k] + '</svg>'; }
  var CSS = '.avp{position:fixed;inset:0;z-index:2147482000;display:flex;flex-direction:column;background:rgba(14,15,20,.97);color:#fff;font-family:inherit}'
    + '.avp.in{animation:avpIn .2s ease backwards}@keyframes avpIn{from{opacity:0}}'
    + '.avp svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}'
    + '.avp-top{display:flex;align-items:center;gap:12px;padding:16px 16px 16px 24px}.avp-tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}'
    + '.avp-tx b{font-size:16px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.avp-tx small{font-size:13px;font-weight:700;color:rgba(255,255,255,.64);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.avp-ct{flex:none;font-size:13px;font-weight:800;color:rgba(255,255,255,.64);font-variant-numeric:tabular-nums}'
    + '.avp-b{display:inline-flex;align-items:center;gap:8px;height:40px;padding:0 14px;border:0;border-radius:12px;background:rgba(255,255,255,.12);color:#fff;font:inherit;font-size:14px;font-weight:800;cursor:pointer;text-decoration:none}'
    + '.avp-b:hover{background:rgba(255,255,255,.22)}.avp-x,.avp-nav{flex:none;width:44px;height:44px;display:grid;place-items:center;border:0;border-radius:12px;background:rgba(255,255,255,.12);color:#fff;cursor:pointer}'
    + '.avp-x:hover,.avp-nav:not([disabled]):hover{background:rgba(255,255,255,.22)}.avp-nav[disabled]{background:rgba(255,255,255,.04);color:rgba(255,255,255,.28);cursor:default}'
    + '.avp-stage{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;gap:16px;padding:0 16px 24px}'
    + '.avp-fig{margin:0;flex:1;min-width:0;height:100%;max-width:1200px;position:relative;display:flex;align-items:center;justify-content:center}'
    + '.avp-pg{display:block;flex:none;max-width:100%;max-height:100%;border-radius:8px;box-shadow:0 12px 40px rgba(0,0,0,.45);background:#fff}'
    + '.avp img.avp-pg,.avp video.avp-pg{width:auto;height:auto;object-fit:contain;background:transparent}.avp-fig.loading .avp-pg{visibility:hidden}'
    + '.avp-wait{position:absolute;inset:0;margin:auto;height:fit-content;display:flex;align-items:center;justify-content:center;gap:10px;font-size:14px;font-weight:700;color:rgba(255,255,255,.8)}'
    + '.avp-spin{width:22px;height:22px;border-radius:50%;border:3px solid rgba(255,255,255,.2);border-top-color:#fff;animation:avpSpin .8s linear infinite}@keyframes avpSpin{to{transform:rotate(360deg)}}'
    + '.avp-txt{margin:0;width:min(960px,100%);max-height:100%;overflow:auto;padding:32px;border-radius:8px;background:#fff;color:#14151f;white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.5 ui-monospace,Menlo,Consolas,monospace}'
    + '.avp-none{display:flex;flex-direction:column;align-items:center;gap:10px;max-width:360px;text-align:center}.avp-none b{font-size:16px;font-weight:900}.avp-none p{margin:0;font-size:14px;font-weight:600;color:rgba(255,255,255,.72)}'
    + '@media (max-width:640px){.avp-top{flex-wrap:wrap;padding:12px}.avp-tx{flex:1 1 calc(100% - 56px)}.avp-lbl{display:none}.avp-stage{padding:0 4px 12px;gap:4px}}'
    + 'canvas.avp-pg,img.avp-pg{cursor:pointer}'
    + '.potato-mode .avp.in{animation:none}';
  var L = null;
  function top() {
    var f = L.list[L.at], pn = L.pages[L.at], pg = pn > 1 ? 'Page ' + (L.page + 1) + ' of ' + pn : '';
    var ct = [pg, L.list.length > 1 ? (L.at + 1) + ' of ' + L.list.length : ''].filter(Boolean).join(' · ');
    return '<div class="avp-tx"><b id="avpT">' + esc(f.name) + '</b>' + (f.sub ? '<small>' + esc(f.sub) + '</small>' : '') + '</div>' + (ct ? '<span class="avp-ct" aria-live="polite">' + ct + '</span>' : '')
      + '<a class="avp-b" href="' + esc(f.url) + '" target="_blank" rel="noopener noreferrer">' + ico('tab') + '<span class="avp-lbl">Open in a new tab</span></a>'
      + '<a class="avp-b" href="' + esc(f.download || f.url) + '" download="' + esc(f.name) + '">' + ico('dl') + '<span class="avp-lbl">Download</span></a>'
      + '<button class="avp-x" type="button" data-avp="x" aria-label="Close">' + ico('x') + '</button>';
  }
  function nav() {
    var pn = L.pages[L.at] || 1, prev = L.at > 0 || L.page > 0, next = L.at < L.list.length - 1 || L.page < pn - 1;
    var p = L.el.querySelector('[data-go="-1"]'), n = L.el.querySelector('[data-go="1"]');
    p.disabled = !prev; p.setAttribute('aria-label', L.page > 0 ? 'Previous page' : 'Previous file');
    n.disabled = !next; n.setAttribute('aria-label', L.page < pn - 1 ? 'Next page' : 'Next file');
  }
  function draw(d) {
    var f = L.list[L.at], k = kind(f.name), my = ++L.n;
    var had = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.go;
    var fig = k === 'image' ? '<img class="avp-pg" src="' + esc(f.url) + '" alt="' + esc(f.name) + '" title="Open in a new tab">' : k === 'video' ? '<video class="avp-pg" controls src="' + esc(f.url) + '"></video>'
      : k === 'audio' ? '<div class="avp-none"><b>' + esc(f.name) + '</b><audio controls src="' + esc(f.url) + '"></audio></div>'
      : k === 'text' ? '<pre class="avp-txt">Loading…</pre>' : k === 'pdf' ? '<canvas class="avp-pg" role="img" title="Open in a new tab"></canvas>'
      : '<div class="avp-none"><b>' + esc(f.name) + '</b><p>There\'s no preview for this kind of file. Open it in a new tab, or download it.</p></div>';
    L.el.innerHTML = '<div class="avp-top">' + top() + '</div><div class="avp-stage"><button class="avp-nav" type="button" data-go="-1">' + ico('l') + '</button><figure class="avp-fig" aria-label="Preview of ' + esc(f.name) + '">' + fig
      + '<p class="avp-wait" hidden><span class="avp-spin" aria-hidden="true"></span><span>Getting this file…</span></p></figure><button class="avp-nav" type="button" data-go="1">' + ico('r') + '</button></div>';
    nav();
    var box = L.el.querySelector('.avp-fig'), wait = box.querySelector('.avp-wait'), slow = 0;
    var loading = function (on) { wait.hidden = !on; box.classList.toggle('loading', on); };
    var startWait = function () { loading(true); slow = setTimeout(function () { if (L && L.n === my) wait.lastChild.textContent = 'Still getting this file from Schoology. New uploads can take a few minutes.'; }, 8000); };
    var mine = L;
    if (k === 'pdf') {
      startWait();
      var c = box.querySelector('canvas');
      pdf(f.url).then(function (doc) {
        if (L !== mine || L.n !== my) return;
        L.pages[L.at] = doc.numPages;
        if (L.page < 0 || L.page >= doc.numPages) L.page = doc.numPages - 1;
        L.el.querySelector('.avp-top').innerHTML = top(); nav();
        c.setAttribute('aria-label', f.name + ', page ' + (L.page + 1) + ' of ' + doc.numPages);
        return doc.getPage(L.page + 1).then(function (pg) {
          var v1 = pg.getViewport({ scale: 1 }), r = v1.width / v1.height, W = box.clientWidth, H = box.clientHeight, w = Math.max(120, Math.min(W, H * r));
          var dpr = Math.min(2, window.devicePixelRatio || 1), vp = pg.getViewport({ scale: (w / v1.width) * dpr });
          c.width = Math.round(vp.width); c.height = Math.round(vp.height);
          return pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise.then(function () {
            if (L !== mine || L.n !== my) return; c.style.width = w + 'px'; c.style.height = (w / r) + 'px'; clearTimeout(slow); loading(false);
          });
        });
      }).catch(function () {
        if (L !== mine || L.n !== my) return; clearTimeout(slow); loading(false);
        c.outerHTML = '<div class="avp-none"><b>Couldn\'t show this PDF here</b><p>Open it in a new tab, or download it.</p></div>'; L.pages[L.at] = 1; L.page = 0; nav();
      });
    } else if (k === 'image') {
      var img = box.querySelector('img'); L.page = 0; L.pages[L.at] = 1;
      if (!img.complete) { startWait(); var done = function () { clearTimeout(slow); if (L === mine && L.n === my) loading(false); }; img.addEventListener('load', done); img.addEventListener('error', done); }
    } else if (k === 'text') {
      L.page = 0; L.pages[L.at] = 1; var pre = box.querySelector('pre');
      fetch(f.url, { credentials: 'include' }).then(function (r) { if (!r.ok) throw 0; return r.text(); }).then(function (t) { pre.textContent = t.length > 200000 ? t.slice(0, 200000) + '\n…' : t; }, function () { pre.textContent = 'Couldn\'t load this file. Try downloading it.'; });
    } else { L.page = 0; L.pages[L.at] = 1; }
    if (d && !calm() && box.animate) box.animate([{ opacity: 0, transform: 'translateX(' + (d * 16) + 'px)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
    var fb = had ? L.el.querySelector('[data-go="' + had + '"]:not([disabled])') : null;
    (fb || L.el.querySelector('.avp-x')).focus({ preventScroll: true });
  }
  function go(d) {
    var pn = L.pages[L.at] || 1;
    if (d > 0 && L.page < pn - 1) L.page++;
    else if (d < 0 && L.page > 0) L.page--;
    else { var j = L.at + d; if (j < 0 || j >= L.list.length) return; L.at = j; L.page = d > 0 ? 0 : (L.pages[j] ? L.pages[j] - 1 : -1); }
    draw(d);
  }
  function close() {
    if (!L) return; var el = L.el, from = L.from; L = null;
    document.removeEventListener('keydown', key, true); window.removeEventListener('resize', resize);
    el.remove(); document.documentElement.style.overflow = '';
    if (from && from.isConnected && from.focus) from.focus({ preventScroll: true });
  }
  function key(e) {
    if (!L) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !(e.target.closest && e.target.closest('video, audio'))) { e.preventDefault(); e.stopImmediatePropagation(); go(e.key === 'ArrowLeft' ? -1 : 1); return; }
    if (e.key === 'Tab') {
      var f = [].slice.call(L.el.querySelectorAll('a, button:not([disabled]), video, audio')); if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  }
  var rt = 0;
  function resize() { clearTimeout(rt); rt = setTimeout(function () { if (L && kind(L.list[L.at].name) === 'pdf') draw(0); }, 150); }
  function open(files, at) {
    var list = (files || []).filter(function (f) { return f && f.name && f.url; });
    if (!list.length) return false;
    if (!document.getElementById('avpCss')) { var st = document.createElement('style'); st.id = 'avpCss'; st.textContent = CSS; document.head.appendChild(st); }
    if (L) close();
    var el = document.createElement('div');
    el.className = 'avp' + (calm() ? '' : ' in'); el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'avpT');
    document.body.appendChild(el); document.documentElement.style.overflow = 'hidden';
    L = { el: el, from: document.activeElement, list: list, at: Math.max(0, Math.min(list.length - 1, at || 0)), page: 0, pages: {}, n: 0 };
    el.addEventListener('click', function (e) {
      if (e.target.closest('[data-avp="x"]') || e.target === el || e.target.classList.contains('avp-stage') || e.target.classList.contains('avp-fig')) { close(); return; }
      var g = e.target.closest('[data-go]'); if (g && !g.disabled) { go(+g.dataset.go); return; }
      // clicking the page itself (a PDF page, a picture, a text file) opens the file in a new browser tab
      var pg = e.target.closest('canvas.avp-pg, img.avp-pg, .avp-txt');
      if (pg && L) { var f = L.list[L.at]; if (f && f.url) window.open(f.url, '_blank', 'noopener'); }
    });
    document.addEventListener('keydown', key, true); window.addEventListener('resize', resize);
    draw(0);
    return true;
  }
  window.AveragesPreview = { open: open, close: close, kind: kind };
})();
