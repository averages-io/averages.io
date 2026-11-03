/*
 * The Fullscreen pages' real data (2026-10-28, Martin: "nothing is wired
 * inside the fs theme ... make sure everything works"). Loaded in <head>
 * right after averages-fs.js.
 *
 * Each page in /IS/ is built (scripts/build-fs.mjs) with its own scripts
 * held back (<script type="text/fs-wait">). This file:
 *   1. asks the API who's signed in and loads what the page shows: the
 *      shared bundle (/data/bundle) plus the page's extras (teachers,
 *      course updates, events, files, messages, folders, classmates), using
 *      the same sessionStorage caches as the Windowed pages, so switching
 *      looks costs nothing;
 *   2. turns the API's answers into window.FSD, in the shapes the pages
 *      draw from (see FSA below);
 *   3. runs the page's scripts, in order, once that's in.
 * A loading screen covers the page meanwhile. Signed out goes to sign-in; if
 * the grades can't load, the page says so with Try again (never sample data).
 *
 * window.FSX has what the pages need to act for real: moving between pages
 * (FSX.go / FSX.hub), calling the API (FSX.api), opening Schoology, the
 * notifications seen-list (shared with Windowed's AveragesSeen), sign-out.
 */
(function () {
  'use strict';
  var API = window.location.hostname.endsWith('averages.io') ? 'https://api.averages.io' : 'http://localhost:8787';
  var root = document.documentElement;
  var SS = window.sessionStorage, LS = window.localStorage;
  var page = (window.location.pathname.match(/\/(?:IS|fs)\/([a-z0-9-]+)(?:\.html)?\/?$/) || [])[1] || 'home';
  var Q = new URLSearchParams(window.location.search);
  function sget(k) { try { return SS.getItem(k); } catch (e) { return null; } }
  function sset(k, v) { try { SS.setItem(k, v); } catch (e) { /* storage full or off */ } }
  function sdel(k) { try { SS.removeItem(k); } catch (e) { /* off */ } }
  function lget(k) { try { return JSON.parse(LS.getItem(k) || 'null'); } catch (e) { return null; } }
  function lset(k, v) { try { LS.setItem(k, JSON.stringify(v)); } catch (e) { /* off */ } }
  function zone() { try { return (window.averagesTimeZone && window.averagesTimeZone()) || Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; } }
  function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  var ID = /^[A-Za-z0-9_-]{1,64}$/;
  var courseQ = ID.test(Q.get('course') || '') ? Q.get('course') : '';

  // ---------- lighter motion (2026-11-01, Martin: "very choppy and heavy on my computer") ----------
  // The pages' own scripted animations (Element.animate) only move what the graphics card can move by itself, the way
  // CSS transform and opacity animations do. A box that grew or shrank in height (re-laying out the page every frame)
  // now fades in place; a bar that filled by width now fills with a scale from the left. Same timing, same callbacks.
  (function () {
    var E = window.Element && window.Element.prototype;
    if (!E || typeof E.animate !== 'function' || E.animate.__light) return;
    var orig = E.animate;
    var HEAVY = /^(height|width|min(Height|Width)|max(Height|Width)|padding(Top|Right|Bottom|Left)?|margin(Top|Right|Bottom|Left)?|top|right|bottom|left|filter|gridTemplate(Rows|Columns)|flexBasis|overflow)$/;
    var only = function (f, k) { var ks = Object.keys(f).filter(function (x) { return x !== 'offset' && x !== 'easing'; }); return ks.length === 1 && ks[0] === k; };
    function lighten(el, frames) {
      if (!Array.isArray(frames) || !frames.length) return frames;
      if (frames.length === 2 && only(frames[0], 'width') && only(frames[1], 'width') && /^0(%|px)?$/.test(String(frames[0].width)) && String(frames[1].width) === '100%') {
        el.style.width = '100%'; el.style.transformOrigin = 'left center';
        return [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }];
      }
      if (!frames.some(function (f) { return f && Object.keys(f).some(function (k) { return HEAVY.test(k); }); })) return frames;
      return frames.map(function (f) { var g = {}; Object.keys(f || {}).forEach(function (k) { if (!HEAVY.test(k)) g[k] = f[k]; }); return g; });
    }
    // a box marked data-anim-size keeps its own size animation (2026-11-03, Martin: a Grades card should close as a box,
    // not just fade its insides)
    var light = function (frames, opts) { return orig.call(this, this.hasAttribute && this.hasAttribute('data-anim-size') ? frames : lighten(this, frames), opts); };
    light.__light = true;
    E.animate = light;
  })();

  // ---------- loading screen ----------
  root.classList.add('fs-wait');
  var css = document.createElement('style');
  // While the data loads (2026-10-30, Martin: no whole-screen loading icon between pages): the top bar and the sidebar
  // stay, and only the page's own content waits; it then opens with its placeholders and lands (FSX.sync(true)).
  // Anything that would show this page's sample text until then is hidden too (the class name in the top bar).
  // The sidebar and top bar come up already drawn (2026-10-30, Martin: "like it is built into the page"): each page
  // keeps a copy of them as you leave (the classes list, counts, your picture), the next page paints that copy before
  // its data arrives (the small script build-fs puts after the sidebar), and the browser holds both still while only
  // the content changes (a view transition between the pages, where the browser has them).
  // The page skeleton (2026-10-30, Martin: "re-add the page skeleton, tweaked for the new theme"): the page's own
  // header shows right away, and where its data will go there are shimmer placeholders in the theme's panels
  // (build-fs puts a call to __fsSkel at the top of each page's .wrap). The real content is laid out but not shown
  // until it's ready, then the placeholders go and it lands with the page's own animation (syncRun(true)).
  css.textContent = (page === 'course-hub' ? 'html.fs-wait .crumb strong,html.fs-wait .hub-t h1,' : '') + 'html.fs-wait #syncLabel,html.fs-wait [data-av]:not([data-avk]){visibility:hidden}'
    + 'html.fs-wait #scroller .wrap>:not(.fs-skel):not(.hub-h){display:none!important}'
    + 'html:not(.fs-wait) .fs-skel{display:none}'
    + '.fs-skel{grid-column:1/-1;order:9;display:grid;gap:24px;align-items:start;min-width:0;pointer-events:none;user-select:none}'
    + '.fs-skel.k-split{grid-template-columns:minmax(0,1fr) clamp(360px,26vw,480px)}'
    + '.fs-skel.k-nav{grid-template-columns:var(--kw,300px) minmax(0,1fr)}'
    + '.fs-skel .k-col{display:flex;flex-direction:column;gap:24px;min-width:0}'
    + '.fs-skel .k-p{display:flex;flex-direction:column;gap:16px;padding:24px;border-radius:24px;background:var(--panel);min-width:0}'
    + '.fs-skel .k-p.k-tall{min-height:560px}'
    + '.fs-skel .k-row{display:flex;align-items:center;gap:12px;min-width:0}'
    + '.fs-skel .k-row.k-line{padding:8px 0;border-top:1px solid color-mix(in srgb,var(--inner) 60%,transparent)}'
    + '.fs-skel .k-row.k-line:first-of-type{border-top:0}'
    + '.fs-skel .k-tx{display:flex;flex-direction:column;gap:8px;flex:1;min-width:0}'
    + '.fs-skel .k-grid{display:grid;gap:12px}'
    + '.fs-skel .skel-bar{display:block;max-width:100%}'
    // the placeholders in the theme's own ink (the old bar was a fixed gray band that split into two tones on wide
    // bars, and looked heavy in dark mode)
    // (2026-11-01) a soft pulse in opacity: the graphics card does it alone, where a moving light re-drew every
    // placeholder on every frame, which was heavy on slower computers
    + ':root:root .skel-bar,html.fs-wait .hub-meta:empty::before,html.fs-wait .hub-logo:empty{background-color:color-mix(in srgb,var(--ink) 10%,transparent)!important;background-image:none!important;animation:fsPulse 1.6s ease-in-out infinite!important}'
    + '@keyframes fsPulse{0%,100%{opacity:1}50%{opacity:.5}}'
    + '@media (prefers-reduced-motion:reduce){:root:root .skel-bar{animation:none!important}}'
    + '@media (max-width:1280px){.fs-skel.k-split{grid-template-columns:minmax(0,1fr)}}'
    + '@media (max-width:900px){.fs-skel.k-nav{grid-template-columns:minmax(0,1fr)}}'
    + 'html.fs-wait .hub-meta:empty::before{content:"";display:block}'
    + 'html.fs-wait .hub-meta:empty::before{width:min(440px,100%);height:16px;margin-top:12px;border-radius:999px}'

    + 'html.fs-boot .app,html.fs-boot .side,html.fs-boot .side *{transition:none!important}'
    // the shared popups from the Windowed scripts (Add from OneDrive, the Google sign-in notes) read the Windowed
    // names for colors; here they get this page's, so they follow dark mode and the accent (2026-10-30)
    + 'html{--panel-bg:var(--field);--panel-inner:var(--panel);--text-dark:var(--ink);--text-muted:var(--ink-2);--text-faint:var(--muted);--border:var(--inner);--accent-dark:var(--accent-hover);--accent-ring:color-mix(in srgb,var(--accent) 35%,transparent)}'
    + '@view-transition{navigation:auto}'
    + '::view-transition-old(fs-top),::view-transition-old(fs-side){display:none}'
    + '::view-transition-new(fs-top),::view-transition-new(fs-side){animation:none}'
    + '::view-transition-group(fs-top),::view-transition-group(fs-side){animation:none}'
    + '::view-transition-old(root),::view-transition-new(root){animation-duration:.16s}'
    + '@media (prefers-reduced-motion:reduce){@view-transition{navigation:none}}'
    + '.fs-fail{position:fixed;inset:0;z-index:101;display:grid;place-items:center;padding:24px;font:600 15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:#f4f4f7;color:#17181c;text-align:center}'
    + 'html[data-theme="dark"] .fs-fail{background:#16171d;color:#ecedf5}.fs-fail b{display:block;font-size:20px;margin-bottom:8px}.fs-fail button{margin-top:16px;font:inherit;padding:8px 16px;border-radius:12px;border:0;background:var(--accent,#b8352f);color:#fff;cursor:pointer}';
  (document.head || root).appendChild(css);

  // ---------- the page skeleton ----------
  window.__fsSkel = function () {
    var wrap = document.currentScript && document.currentScript.parentNode;
    if (!wrap || !root.classList.contains('fs-wait') || wrap.querySelector('.fs-skel')) return;
    var bar = function (w, h, r) { return '<span class="skel-bar" style="width:' + w + ';height:' + (h || 10) + 'px' + (r ? ';border-radius:' + r : '') + '"></span>'; };
    var fill = function (h, r) { return '<span class="skel-bar" style="flex:1 1 0;min-width:0;height:' + h + 'px;border-radius:' + r + '"></span>'; };
    var times = function (n, f) { var o = ''; for (var i = 0; i < n; i++) o += f(i); return o; };
    var W = ['62%', '48%', '70%', '40%', '56%', '66%', '44%', '58%'];
    var tile = function (n) { return bar(n + 'px', n, Math.round(n / 3.4) + 'px'); };
    var lines = function (i, a, b) { return '<span class="k-tx">' + bar(a || W[i % 8], 14) + bar(b || W[(i + 3) % 8].replace(/\d+/, function (x) { return Math.round(x * .7); }), 10) + '</span>'; };
    var row = function (i, right, t) { return '<div class="k-row k-line">' + tile(t || 36) + lines(i) + (right || '') + '</div>'; };
    var title = function (w) { return bar(w || '180px', 24, '8px'); };
    var panel = function (inner, cls) { return '<div class="k-p' + (cls ? ' ' + cls : '') + '">' + inner + '</div>'; };
    var search = function (h) { return bar('100%', h || 40, '14px'); };
    var col = function (inner) { return '<div class="k-col">' + inner + '</div>'; };
    var K = {
      home: ['split', col('<div class="k-tx" style="gap:12px">' + bar('min(420px,80%)', 48, '12px') + bar('160px', 16) + '</div>' + search(52)
          + '<div class="k-row" style="justify-content:center;flex-wrap:wrap;gap:8px">' + times(5, function (i) { return bar(['110px', '150px', '180px', '140px', '76px'][i], 44, '14px'); }) + '</div>'
          + panel(title('120px') + times(6, function (i) { return row(i, bar('72px', 16) + bar('76px', 28, '10px') + bar('52px', 12)); })))
        + col(panel(title('160px') + bar('100%', 88, '16px') + times(8, function (i) { return row(i, bar('48px', 22, '11px')); })))],
      grades: ['split', col(panel(title('200px') + '<div class="k-row" style="align-items:stretch;gap:24px">' + '<div class="k-tx" style="flex:0 0 240px;gap:16px">' + bar('140px', 64, '14px') + bar('120px', 22, '11px') + '<div class="k-row">' + bar('50%', 72, '16px') + bar('50%', 72, '16px') + '</div></div>' + '<div style="flex:1;min-width:0">' + bar('100%', 240, '16px') + '</div></div>')
          + panel(title('170px') + search() + times(6, function (i) { return row(i, bar('72px', 16) + bar('52px', 24, '12px') + bar('110px', 28, '8px')); })))
        + col(panel(title('190px') + times(6, function (i) { return row(i, bar('44px', 28, '8px')); })) + panel(title('190px') + times(3, function (i) { return row(i, bar('52px', 24, '12px')); })))],
      assignments: ['split', col(panel(title('200px') + '<div class="k-row">' + fill(40, '14px') + bar('120px', 40, '12px') + bar('180px', 40, '12px') + '</div>' + bar('min(480px,100%)', 40, '12px')
          + times(7, function (i) { return row(i, bar('96px', 32) + bar('84px', 28, '14px') + bar('92px', 36, '12px'), 40); })))
        + col(panel(title('150px') + '<div class="k-grid" style="grid-template-columns:repeat(5,1fr)">' + times(5, function () { return bar('100%', 104, '16px'); }) + '</div>' + bar('80%', 12))
          + panel(title('120px') + times(6, function (i) { return row(i, bar('24px', 24, '50%'), 28); })))],
      calendar: ['split', col(panel('<div class="k-row">' + bar('40px', 40, '12px') + bar('40px', 40, '12px') + bar('180px', 28, '8px') + '<span style="flex:1"></span>' + bar('200px', 40, '12px') + '</div>'
          + '<div class="k-row">' + fill(40, '14px') + bar('150px', 40, '12px') + bar('340px', 40, '12px') + '</div>'
          + '<div class="k-grid" style="grid-template-columns:repeat(7,minmax(0,1fr))">' + times(35, function () { return bar('100%', 112, '16px'); }) + '</div>'))
        + col(panel(title('150px') + times(9, function (i) { return row(i, bar('52px', 12)); })))],
      courses: ['one', col('<div class="k-row">' + fill(40, '14px') + bar('120px', 40, '12px') + bar('160px', 40, '12px') + '</div>'
          + panel(bar('100%', 12) + times(6, function (i) { return '<div class="k-row k-line">' + bar('20px', 20, '50%') + tile(28) + lines(i) + bar('72px', 16) + bar('160px', 28, '8px') + bar('120px', 22, '11px') + bar('64px', 22, '11px') + '</div>'; })))],
      files: ['nav', col(panel(times(3, function (i) { return '<div class="k-row">' + tile(26) + bar(W[i], 12) + '</div>'; }) + bar('100%', 1) + times(7, function (i) { return '<div class="k-row">' + tile(26) + bar(W[i + 2], 12) + '</div>'; })))
        + col(search(56) + title('140px') + '<div class="k-grid" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr))">' + times(5, function (i) { return '<div class="k-tx">' + bar('100%', 124, '14px') + bar(W[i], 12) + bar('60%', 10) + '</div>'; }) + '</div>'
          + title('140px') + '<div class="k-grid" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr))">' + times(4, function (i) { return '<div class="k-tx">' + bar('100%', 172, '16px') + bar(W[i + 1], 12) + bar('60%', 10) + '</div>'; }) + '</div>'), '248px'],
      messages: ['nav', col(panel(search() + bar('220px', 40, '12px') + times(5, function (i) { return row(i, bar('48px', 10), 44); }), 'k-tall')) + col(panel('<div class="k-row">' + tile(44) + lines(0, '140px', '100px') + '</div>' + bar('100%', 1) + times(3, function (i) { return '<div class="k-row" style="justify-content:' + (i === 1 ? 'flex-end' : 'flex-start') + '">' + bar(['56%', '48%', '60%'][i], 56, '18px') + '</div>'; }), 'k-tall')), '380px'],
      contacts: ['nav', col(panel(search() + bar('320px', 40, '12px') + times(7, function (i) { return row(i, '', 40); }), 'k-tall')) + col(panel('<div class="k-tx" style="align-items:center;gap:12px">' + tile(96) + bar('160px', 24, '8px') + bar('200px', 12) + '<div class="k-row">' + bar('88px', 60, '12px') + bar('88px', 60, '12px') + '</div></div>' + bar('100%', 56, '12px') + bar('100%', 112, '12px'), 'k-tall')), '380px'],
      settings: ['nav', col(panel(search() + times(7, function (i) { return '<div class="k-row" style="padding:8px 4px">' + tile(24) + lines(i, '96px', '64px') + '</div>'; })))
        + col(panel(title('160px') + bar('220px', 12) + bar('100%', 104, '16px') + times(4, function (i) { return row(i, bar('120px', 12)); }), 'k-tall')), '300px'],
      'course-hub': ['split', col(bar('min(560px,100%)', 44, '12px') + panel(title('170px') + times(6, function (i) { return row(i, bar('64px', 22, '11px')); }))) + col(panel(title('150px') + times(5, function (i) { return row(i, ''); })))],
    };
    var k = K[page]; if (!k) return;
    var el = document.createElement('div');
    el.className = 'fs-skel k-' + k[0]; el.setAttribute('aria-hidden', 'true');
    if (k[2]) el.style.setProperty('--kw', k[2]);
    el.innerHTML = k[0] === 'one' ? k[1].replace(/^<div class="k-col">/, '<div class="k-col" style="grid-column:1/-1">') : k[1];
    wrap.insertBefore(el, wrap.firstChild);
  };

  // ---------- the sidebar, set up like Cloudflare's (2026-11-03, from Martin's saved dash.cloudflare.com page) ----------
  // Cloudflare's own build: a 57/260 px rail; a 32 px "Quick search" box; 34 px rows 1 px apart with 12 px between
  // icon and name; groups headed by a small grey label that becomes a thin line when the rail is closed; folders
  // (Recents) that slide open, their rows hanging off a line under the folder's icon; the list fading out at its top
  // and bottom edges while there's more to scroll; a 48 px footer with just the open/close button. Built from the
  // sidebar each page already has (its ids and links stay, so the pages' own scripts keep working); build-fs calls
  // this right after the sidebar, before anything is drawn. The styles are build-fs's fsSide block.
  var SIDE_OPEN_KEY = 'averages_fs_side_open', RECENT_KEY = 'averages_fs_recents';
  // a clock with an arrow going back, at the same weight as the other icons (svg.i's own stroke)
  var CLOCK = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.6 12.6A8.5 8.5 0 1 0 5.6 6.2"/><path d="M4.4 3.6v3.4h3.4"/><path d="M12 7.6V12l3 2"/></svg>';
  var CHEV = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.75"/></svg>';
  var PAGE_NAME = { courses: 'Courses', grades: 'Grades', assignments: 'Assignments', calendar: 'Calendar', files: 'Files', messages: 'Messages', contacts: 'Contacts', settings: 'Settings' };
  function sideOpen() { var v = lget(SIDE_OPEN_KEY); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
  function sideSet(k, on) { var v = sideOpen(); if (on) v[k] = true; else delete v[k]; lset(SIDE_OPEN_KEY, v); }
  function esc0(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function recentsHTML() {
    var l = lget(RECENT_KEY); l = Array.isArray(l) ? l.slice(0, 5) : [];
    if (!l.length) return '<p class="side-none">Classes and pages you open show up here.</p>';
    return l.map(function (r) { return '<a class="side-recl" href="' + esc0(r.u) + '"><b>' + esc0(r.t) + '</b><small>' + esc0(r.s) + '</small></a>'; }).join('');
  }
  function recOpen() { var w = document.getElementById('sideRecW'); return !!(w && w.classList.contains('on')); }
  function classId(a) {
    var o = a.getAttribute('data-open') || '', m = o.match(/^class:(.+)$/);
    if (m) return m[1];
    var h = a.getAttribute('data-go') || a.getAttribute('href') || '', q = h.match(/[?&]course=([^&#]+)/);
    return q ? decodeURIComponent(q[1]) : '';
  }
  // no browser tooltips in the sidebar: it opens when you point at it, so its words are already showing,
  // and a tooltip only covered the row under it (2026-11-02). The name stays as data-title.
  function untitle(root) { [].forEach.call(root.querySelectorAll('[title]'), function (x) { x.setAttribute('data-title', x.getAttribute('title')); x.removeAttribute('title'); }); }
  // classes are plain links (2026-11-03, Martin: no drop-downs or folding for classes; the class page has its tabs)
  function decorateClasses(box) {
    if (!box) return; untitle(box);
    [].slice.call(box.children).forEach(function (a) {
      if (a.tagName !== 'A' || !classId(a)) return;
      var w = document.createElement('div'); w.className = 'side-cl'; box.insertBefore(w, a); w.appendChild(a);
    });
  }
  window.__fsSide = function () {
    var side = document.getElementById('side'); if (!side || side.dataset.cf) return; side.dataset.cf = '1';
    // the logo in the top bar goes Home (2026-11-03, Martin): a real link, so it also opens in a new tab
    var brand = document.querySelector('.top .brand, .app > .top > .brand, div.brand');
    if (brand && brand.tagName !== 'A') {
      var home = document.createElement('a'); home.className = brand.className; home.href = '/IS/home'; home.setAttribute('aria-label', 'Averages.io, go to Home');
      while (brand.firstChild) home.appendChild(brand.firstChild);
      brand.replaceWith(home);
    }
    untitle(side);
    var nav = side.querySelector('.nav'), foot = side.querySelector('.foot');
    // everything but the footer scrolls together (Cloudflare's viewport), so the footer never covers a row
    var sc = document.createElement('div'); sc.className = 'side-scroll'; sc.id = 'sideScroll';
    [].slice.call(side.children).forEach(function (x) { if (x !== foot) sc.appendChild(x); });
    side.insertBefore(sc, foot || null);
    var label = function (t, cls) { var h = document.createElement('div'); h.className = 'side-sec' + (cls ? ' ' + cls : ''); h.innerHTML = '<span>' + esc0(t) + '</span>'; h.setAttribute('aria-hidden', 'true'); return h; };
    if (nav) {
      var srch = document.getElementById('sideSearch'), lab = srch && srch.querySelector('.fade');
      if (lab) lab.textContent = 'Quick search…';
      var links = [].slice.call(nav.querySelectorAll('a')), by = function (t) { return links.filter(function (x) { return (x.getAttribute('data-title') || x.getAttribute('title')) === t; })[0]; };
      var home = by('Home');
      if (home) {
        var rec = document.createElement('a'); rec.href = '#'; rec.id = 'sideRec'; rec.className = 'side-rec'; rec.setAttribute('role', 'button');
        rec.innerHTML = CLOCK + '<span class="fade">Recents</span><span class="side-chev">' + CHEV + '</span>';
        // the folder's rows: a grid row that grows from 0 to their height (Cloudflare's 0fr to 1fr)
        var rw = document.createElement('div'); rw.className = 'side-subw'; rw.id = 'sideRecW';
        rw.innerHTML = '<div class="side-sub" id="sideRecList">' + recentsHTML() + '</div>';
        var on = !!sideOpen().rec; rec.setAttribute('aria-expanded', on ? 'true' : 'false'); rw.classList.toggle('on', on); if (!on) rw.inert = true;
        home.after(rec); rec.after(rw);
      }
      [['Courses', 'School'], ['Files', 'Your stuff']].forEach(function (g) { var a = by(g[0]); if (a) a.before(label(g[1])); });
    }
    var sh = side.querySelector('.side-h'), cls = document.getElementById('sideClasses');
    if (sh && cls) {
      sh.hidden = true; cls.hidden = false; cls.before(label(sh.textContent.trim() || 'Your classes', 'side-clsh'));
      decorateClasses(cls);
      new MutationObserver(function () { if ([].some.call(cls.children, function (x) { return x.tagName === 'A'; })) decorateClasses(cls); }).observe(cls, { childList: true });
    }
    // whether the pointer is over the sidebar, kept by hand: :hover can already be gone by the time the page is left
    // (a click that starts the next page), and the next page should open with the sidebar still out
    side.addEventListener('pointerenter', function () { side.dataset.in = '1'; });
    side.addEventListener('pointerleave', function () { delete side.dataset.in; });
    side.addEventListener('pointerdown', function () { side.dataset.hit = String(Date.now()); }, true);
    // the list fades out at an edge while there's more to scroll that way
    var edges = function () { sc.classList.toggle('side-up', sc.scrollTop > 1); sc.classList.toggle('side-more', sc.scrollTop + sc.clientHeight < sc.scrollHeight - 2); };
    sc.addEventListener('scroll', edges, { passive: true });
    side.addEventListener('transitionend', edges);
    window.addEventListener('resize', edges);
    if (window.ResizeObserver) { var ro = new ResizeObserver(edges); ro.observe(sc); [].forEach.call(sc.children, function (x) { ro.observe(x); }); }
    setTimeout(edges, 0);
    side.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('#sideRec'); if (!t) return;
      e.preventDefault(); e.stopPropagation();
      var w = document.getElementById('sideRecW'), on = !w.classList.contains('on');
      sideSet('rec', on);
      if (on) document.getElementById('sideRecList').innerHTML = recentsHTML();
      t.setAttribute('aria-expanded', on ? 'true' : 'false'); w.classList.toggle('on', on); w.inert = !on;
    }, true);
  };
  // Recents: the classes, their pages and the assignments you open (newest first, 5 kept on this device)
  function noteRecent() {
    if (!window.FSD || page === 'home' || page === '404') return;
    var t, s, k, u = location.pathname + location.search + location.hash;
    if (page === 'course-hub') {
      if (!courseQ || !window.FSD.C[courseQ]) return;
      var c = window.FSD.C[courseQ], h = location.hash.replace(/^#/, ''), tab = (h.match(/^[a-z]+/) || [''])[0], item = (h.match(/^materials\/([^/?#]+)/) || [, ''])[1];
      t = c.name; s = 'Course'; k = 'course';
      if (item) {
        var a = (window.FSD.ASG || []).filter(function (x) { return String(x.id) === item; })[0];
        if (a) { t = a.n || a.t || a.title || t; s = c.name + ' · Assignment'; k = 'assignment'; }
        else { var f = ((window.FSD.raw.files && window.FSD.raw.files.files) || []).filter(function (x) { return 'x' + x.id === item || String(x.id) === item; })[0]; if (!f) return; t = f.name; s = c.name + ' · Material'; k = 'material'; }
      } else if (tab && tab !== 'overview') {
        t = { assignments: 'Assignments', grades: 'Grades', materials: 'Materials', updates: 'Updates', members: 'Members' }[tab]; if (!t) return; s = c.name; k = tab;
      }
    } else {
      // the other pages (2026-11-02, Martin: everything but Home); one entry per page, wherever you were on it
      if (!PAGE_NAME[page]) return; t = PAGE_NAME[page]; s = 'Page'; k = page; u = location.pathname;
    }
    var l = lget(RECENT_KEY); l = Array.isArray(l) ? l : [];
    l = [{ t: String(t).slice(0, 120), s: s, u: u, k: k }].concat(l.filter(function (r) { return r && r.u !== u; })).slice(0, 8);
    lset(RECENT_KEY, l);
    var rl = document.getElementById('sideRecList'); if (rl && recOpen()) rl.innerHTML = recentsHTML();
  }
  /*
   * Notifications keep coming in (2026-11-03, Martin: "the notification counter won't change"): once the page's
   * own sync is done, and then every 5 minutes while the tab is showing (and when it comes back into view after
   * that long), the bundle and course updates are read again in the background. New grades, updates and messages
   * join the bell (the pages listen for 'fs:notis') without reloading the page. The fresh answers also go in this
   * tab's cache, so the next page opens with them.
   */
  var NOTIS_EVERY = 5 * 60 * 1000, notisAt = Date.now(), notisBusy = false;
  function notisCheck() {
    if (notisBusy || !window.FSD || !window.FSA || document.visibilityState !== 'visible') return;
    var me = window.FSD.me || {}; if (!me.uid) return;
    notisBusy = true; notisAt = Date.now();
    var tz = zone();
    Promise.all([getJSON('/data/bundle' + (tz ? '?tz=' + encodeURIComponent(tz) : '')), getJSON('/data/updates').catch(function () { return null; })]).then(function (got) {
      var b = got[0], u = got[1];
      sset('schoolagy_bundle_cache', JSON.stringify({ at: Date.now(), bundle: b }));
      if (u) sset('averages_extras_updates', JSON.stringify({ at: Date.now(), who: me.uid, data: u }));
      var raw = Object.assign({}, window.FSD.raw, { bundle: b }); if (u) raw.updates = u;
      var fresh = window.FSA.adapt(raw), have = {};
      window.FSD.NT.forEach(function (it) { have[it.id] = true; });
      var added = fresh.NT.filter(function (it) { return !have[it.id]; });
      if (!added.length) return;
      added.forEach(function (it) { window.FSD.NT.push(it); });
      window.dispatchEvent(new CustomEvent('fs:notis', { detail: { added: added } }));
    }).catch(function () { /* try again next time */ }).then(function () { notisBusy = false; });
  }
  window.addEventListener('fs:ready', function () {
    if (window.FSX) window.FSX.notisCheck = notisCheck;   // also: check now
    // after the page's first sync has had its turn (it asks Schoology for everything once)
    setTimeout(function () { notisAt = Date.now(); setInterval(function () { if (Date.now() - notisAt >= NOTIS_EVERY) notisCheck(); }, 30000); }, 1000);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && Date.now() - notisAt >= NOTIS_EVERY) notisCheck(); });
  });
  window.addEventListener('fs:ready', function () { setTimeout(noteRecent, 50); setTimeout(function () { if (window.FSX && FSX.syncWindowType) FSX.syncWindowType(); }, 1200); });
  window.addEventListener('hashchange', function () { setTimeout(noteRecent, 50); });

  // ---------- the sidebar and top bar between pages ----------
  var potato = function () { try { return JSON.parse(localStorage.getItem('fsmock_potato')) === true; } catch (e) { return false; } };
  // the two pieces that stay put get their names only while the pages swap (a name all the time would change how the
  // top bar's popups stack over the sidebar)
  function vtNames(vt) {
    var top = document.querySelector('.app > .top'), side = document.getElementById('side');
    if (!vt || !top || !side) return;
    if (potato()) { vt.skipTransition(); return; }
    top.style.viewTransitionName = 'fs-top'; side.style.viewTransitionName = 'fs-side';
    var off = function () { top.style.viewTransitionName = ''; side.style.viewTransitionName = ''; };
    vt.finished.then(off, off);
  }
  window.addEventListener('pageswap', function (e) { vtNames(e.viewTransition); });
  window.addEventListener('pagereveal', function (e) { vtNames(e.viewTransition); });
  // a copy of them as you leave, for the next page (15 seconds; build-fs's script after the sidebar reads it)
  window.addEventListener('pagehide', function () {
    try {
      var app = document.getElementById('app'), side = document.getElementById('side'), cls = document.getElementById('sideClasses');
      if (!app || !side || root.classList.contains('fs-wait')) return;
      var av = document.querySelector('.top [data-av]'), ct = {};
      ['cntAssign', 'cntMsg', 'ntCt'].forEach(function (id) {
        var el = document.getElementById(id); if (!el) return;
        ct[id] = { n: el.querySelector('canvas.ink') ? (el.dataset.n || '') : el.textContent.trim(), h: !!el.hidden };
      });
      sessionStorage.setItem('averages_fs_chrome', JSON.stringify({
        at: Date.now(), cls: cls ? cls.innerHTML : '', ct: ct, st: (document.getElementById('sideScroll') || side).scrollTop || 0,
        hold: !app.classList.contains('pinned') && (side.matches(':hover') || side.dataset.in === '1' || Date.now() - (+side.dataset.hit || 0) < 4000 || side.classList.contains('hold')),
        av: av ? { c: av.className, s: av.getAttribute('style') || '', t: av.textContent } : null,
      }));
    } catch (e) { /* storage off: the next page draws them itself */ }
  });

  // the file previews' pdf.js (FSX.prev): the same self-hosted copy the calendar import uses
  var PREV_DOCS = {}, PREV_ORDER = [], PREV_Q = Promise.resolve(), PREV_IO = null, PREV_LIB = null, PDFJS_DIR = '/vendor/pdfjs-4.10.38/';
  function prevPdfjs() {
    return PREV_LIB || (PREV_LIB = import(PDFJS_DIR + 'pdf.min.mjs').then(function (lib) { lib.GlobalWorkerOptions.workerSrc = PDFJS_DIR + 'pdf.worker.min.mjs'; return lib; }, function (e) { PREV_LIB = null; throw e; }));
  }
  // thumbnails anywhere on the page, whenever a page draws some
  if (window.MutationObserver) new MutationObserver(function (ms) { for (var i = 0; i < ms.length; i++) if (ms[i].addedNodes.length) { clearTimeout(PREV_IO_T); PREV_IO_T = setTimeout(function () { if (window.FSX) FSX.prev.thumbs(document); }, 60); return; } }).observe(document.documentElement, { childList: true, subtree: true });
  var PREV_IO_T = 0;

  // ---------- caches (the Windowed pages' own, so both looks share them) ----------
  var FIVE_MIN = 5 * 60 * 1000;
  function cacheRead(key, field, who) {
    var raw = sget(key); if (!raw) return undefined;
    try {
      var p = JSON.parse(raw);
      if (Date.now() - p.at < FIVE_MIN && p.at <= Date.now() && (who === undefined || p.who === who)) return p[field];
    } catch (e) { /* unreadable */ }
    sdel(key); return undefined;
  }
  function getJSON(path) {
    return fetch(API + path, { credentials: 'include', cache: 'no-store' }).then(function (r) {
      if (r.status === 401) { sdel('schoolagy_session_state'); throw { signedOut: true }; }
      if (!r.ok) throw { status: r.status };
      return r.json();
    });
  }
  function session() {
    var raw = sget('schoolagy_session_state');
    if (raw) { try { var p = JSON.parse(raw); if (Date.now() - p.at < 60000 && p.state && p.state.mode === 'live' && p.state.uid) return Promise.resolve(p.state); } catch (e) { /* ask */ } }
    return getJSON('/auth/me').then(function (d) {
      var state = { mode: d && d.demo ? 'demo' : 'live', name: d && d.name, incognito: !!(d && d.incognito), provider: d && d.provider === 'google' ? 'google' : 'schoology', uid: d && d.uid != null ? String(d.uid) : undefined, email: d && d.email || '', picture: d && d.pictureUrl || '' };
      sset('schoolagy_session_state', JSON.stringify({ at: Date.now(), state: state }));
      return state;
    });
  }
  function bundle() {
    var hit = cacheRead('schoolagy_bundle_cache', 'bundle');
    if (hit) return Promise.resolve(hit);
    var tz = zone();
    return getJSON('/data/bundle' + (tz ? '?tz=' + encodeURIComponent(tz) : '')).then(function (b) {
      sset('schoolagy_bundle_cache', JSON.stringify({ at: Date.now(), bundle: b }));
      return b;
    });
  }
  function extra(name, path, key, who) {
    var hit = cacheRead('averages_extras_' + key, 'data', who);
    if (hit !== undefined) return Promise.resolve(hit);
    return getJSON(path).then(function (d) {
      sset('averages_extras_' + key, JSON.stringify({ at: Date.now(), who: who, data: d }));
      return d;
    });
  }
  // What each page shows beyond the bundle. Same paths and cache keys as app/lib/extras.ts where they overlap.
  function extrasFor(who, bundleP) {
    var x = extrasPlan(), out = {};
    Object.keys(x).forEach(function (k) {
      // '@after' (2026-11-03): asked once the bundle is in, so the first calls to Schoology aren't all at once
      if (x[k][0] === '@for') out[k] = bundleP.then(function (b) { var q = turnedInFor(b); return q ? extra(k, '/data/submissions?for=' + q, 'fs_subs_' + q.length + '_' + q.slice(-24), who) : { files: [] }; });
      else if (x[k][2] === '@after') out[k] = bundleP.then(function () { return extra(k, x[k][0], x[k][1], who); });
      else out[k] = extra(k, x[k][0], x[k][1], who);
    });
    return out;
  }
  /** The work whose turn-ins the page shows (overdue, today, due soon), as "section:assignment,..." (at most 10). */
  function turnedInFor(b) {
    var out = [];
    var L = function (v) { return Array.isArray(v) ? v : []; };
    L(b && b.OVERDUE).concat(L(b && b.TODAY), L(b && b.UPCOMING)).forEach(function (a) {
      var k = String(a.courseId) + ':' + String(a.id);
      if (/^\d+:\d+$/.test(k) && out.indexOf(k) < 0 && !a.outside && a.type !== 'discussion' && a.type !== 'assessment') out.push(k);
    });
    return out.slice(0, 10).join(',');   // overdue and today first; 10 keeps a page open under Schoology's limit
  }
  function extrasPlan() {
    var now = new Date(), tz = zone(), zq = tz ? '&tz=' + encodeURIComponent(tz) : '';
    var x = { people: ['/data/people', 'people'], updates: ['/data/updates', 'updates'] };
    if (page === 'calendar' || page === 'home') {
      var s = ymd(addDays(now, -120)), e = ymd(addDays(now, 240));
      x.events = ['/data/events?start=' + s + '&end=' + e + zq, 'events_' + s + '_' + e];
    }
    if (page === 'messages' || page === 'home' || page === 'contacts') x.messages = ['/messages', 'messages', page === 'home' ? '@after' : '']; // Home: after the bundle, which has just read the inbox
    if (page === 'files' || page === 'home' || page === 'course-hub' || page === 'assignments') x.files = ['/data/files', 'fs_files', page === 'files' ? '' : '@after']; // assignments: Contains attachment
    // what's been turned in (files), so finished work isn't called missing
    if (page === 'assignments' || page === 'home' || page === 'course-hub' || page === 'files' || page === 'calendar') x.submissions = page === 'files' ? ['/data/submissions', 'fs_submissions'] : ['@for']; // 2026-11-03: only the work the page shows, except on Files
    if (page === 'contacts' || page === 'course-hub' || page === 'messages') x.classmates = ['/data/classmates', 'fs_classmates'];
    if (page === 'course-hub' && courseQ) {
      x.folders = ['/data/folders?course=' + encodeURIComponent(courseQ), 'folders_' + courseQ];
      x.gradebook = ['/data/gradebook?course=' + encodeURIComponent(courseQ), 'gradebook_' + courseQ];
      var hs = ymd(addDays(now, -60)), he = ymd(addDays(now, 120));
      x.hubEvents = ['/data/events?start=' + hs + '&end=' + he + '&course=' + encodeURIComponent(courseQ) + zq, 'events_' + hs + '_' + he + '_' + courseQ];
    }
    return x;
  }
  function settle(p, ms) {
    return new Promise(function (resolve) {
      var done = false, t = setTimeout(function () { if (!done) { done = true; resolve(undefined); } }, ms);
      p.then(function (v) { if (!done) { done = true; clearTimeout(t); resolve(v); } }, function (err) { if (!done) { done = true; clearTimeout(t); resolve(err && err.signedOut ? { __signedOut: true } : undefined); } });
    });
  }

  // ---------- running the page ----------
  var domReady = new Promise(function (r) { if (document.readyState !== 'loading') r(); else document.addEventListener('DOMContentLoaded', r, { once: true }); });
  function runPage() {
    // the real page goes back into the layout first, so the page's scripts measure it as it will be shown
    // (nothing paints in between: this all runs in one go)
    root.classList.remove('fs-wait');
    var sk = document.querySelectorAll('.fs-skel'); for (var j = 0; j < sk.length; j++) sk[j].remove();
    var held = document.querySelectorAll('script[type="text/fs-wait"]');
    for (var i = 0; i < held.length; i++) {
      var old = held[i], s = document.createElement('script');
      if (old.id) s.id = old.id;
      s.textContent = old.textContent;
      old.parentNode.replaceChild(s, old);
    }
    window.dispatchEvent(new CustomEvent('fs:ready'));
    var said = sget('averages_fs_toast'); if (said) { sdel('averages_fs_toast'); setTimeout(function () { if (typeof window.toast === 'function') window.toast(said); }, 400); }
    setTimeout(touchPush, 1500);
  }
  // Browser notifications keep working (2026-10-30): the Windowed pages keep the stored sign-in in step with this
  // session once a day (LegacyPage's touchPushIfOn); the Fullscreen pages never did, so after a while the API's copy went
  // stale and notifications stopped. Same rule here: only when this device has them on (or a turn-off still to send).
  function touchPush() {
    if (!lget0('averages_push_endpoint') && !lget0('averages_push_pending_delete')) return;
    var go = function () { try { var r = window.AveragesPush && window.AveragesPush.touchIfDue && window.AveragesPush.touchIfDue(); if (r && r.catch) r.catch(function () {}); } catch (e) {} };
    if (window.AveragesPush) { go(); return; }
    var sc = document.createElement('script'); sc.src = '/js/averages-push.js'; sc.onload = go; document.head.appendChild(sc);
  }
  function lget0(k) { try { return window.localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function fail(text) {
    domReady.then(function () {
      root.classList.remove('fs-wait');
      var d = document.createElement('div'); d.className = 'fs-fail'; d.setAttribute('role', 'alert');
      d.innerHTML = '<div><b>We couldn’t load your classes</b>' + text + '<br><button type="button">Try again</button></div>';
      d.querySelector('button').addEventListener('click', function () { sdel('schoolagy_bundle_cache'); window.location.reload(); });
      document.body.appendChild(d);
    });
  }

  // The bundle is asked for at once, alongside the sign-in check (2026-11-03: one round trip sooner); if
  // the check says signed out, the page leaves before it's used.
  var earlyBundle = bundle(); earlyBundle.catch(function () {});
  var started = session().then(function (me) {
    if (!me || me.mode !== 'live' || !me.uid) { window.location.replace('/'); return null; }
    var who = me.uid, bP = earlyBundle, xs = extrasFor(who, bP), names = Object.keys(xs);
    return Promise.all([bP].concat(names.map(function (n) { return settle(xs[n], 8000); }))).then(function (all) {
      var raw = { me: me, bundle: all[0] };
      names.forEach(function (n, i) { raw[n] = all[i + 1] && all[i + 1].__signedOut ? undefined : all[i + 1]; });
      return raw;
    });
  });
  started.then(function (raw) {
    if (!raw) return;
    window.FSD = window.FSA.adapt(raw);
    // a course hub needs one of the student's classes; anything else goes to Courses
    if (page === 'course-hub' && !window.FSD.C[courseQ]) {
      // From a Windowed address (/course-home?id=<class>, /assignment?id=<assignment>): find the class, then go there
      var qid = Q.get('id') || '', F = window.FSD, cid = F.C[qid] ? qid : '';
      if (!cid && qid) { var a = F.ASG.filter(function (x) { return x.id === qid; })[0]; if (a) cid = a.c; }
      if (!cid && qid) Object.keys(F.gradebook).forEach(function (c) { if (!cid && F.C[c] && ((F.gradebook[c] || {}).categories || []).some(function (k) { return (k.assignments || []).some(function (x) { return String(x.id) === qid; }); })) cid = c; });
      window.location.replace(cid ? '/IS/course-hub?course=' + encodeURIComponent(cid) + (cid !== qid ? '#materials/' + encodeURIComponent(qid) : (location.hash || '')) : '/IS/courses');
      return;
    }
    return domReady.then(runPage);
  }).catch(function (err) {
    if (err && err.signedOut) { window.location.replace('/'); return; }
    if (window.console) console.error('[fs] load failed', err);
    fail('Schoology didn’t answer, or the connection dropped.');
  });

  // ---------- acting for real ----------
  var WINDOWED = { home: '/home', courses: '/courses', grades: '/grades', assignments: '/assignments', files: '/files', calendar: '/calendar', messages: '/messages', contacts: '/contacts', settings: '/settings' };
  function schoologyHost() {
    var host = '';
    try { var s = (JSON.parse(LS.getItem('averages_login_school') || 'null') || {}).schoology; host = s && s.domain || ''; } catch (e) { /* none saved */ }
    host = String(host).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    return /^[a-z0-9.-]+\.schoology\.com$/i.test(host) ? host : 'app.schoology.com';
  }
  var FSX = window.FSX = {
    API: API,
    page: page,
    course: courseQ,
    q: Q,
    url: function (p, params, hash) {
      var u = '/IS/' + p, qs = [];
      Object.keys(params || {}).forEach(function (k) { if (params[k] != null && params[k] !== '') qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k])); });
      return u + (qs.length ? '?' + qs.join('&') : '') + (hash ? '#' + String(hash).replace(/^#/, '') : '');
    },
    go: function (p, params, hash) { window.location.href = FSX.url(p, params, hash); },
    hub: function (course, tab, params) { FSX.go('course-hub', Object.assign({ course: course }, params || {}), tab || ''); },
    hubUrl: function (course, tab, params) { return FSX.url('course-hub', Object.assign({ course: course }, params || {}), tab || ''); },
    newTab: function (u) { var w = window.open(u, '_blank', 'noopener'); if (w) w.opener = null; },
    apiBase: API,
    /**
     * Sync across devices (Classic only): the same record the Windowed Settings pushes (PUT /sync/settings:
     * settingsOptions, appearance, darkMode, profile). Pictures go as their stored references; a picture
     * changed on this device and not uploaded yet is left to the Windowed Settings, so nothing is lost.
     */
    /**
     * Fullscreen in the account's synced copy (2026-11-02, Martin: "when I sign out then back in it defaults to
     * windowed even when I am on fs"). Signing in on a cleared device takes the account's copy; Fullscreen picked
     * in onboarding, or in Settings just before the page changed, never reached it. Once a tab: if the account's
     * copy says Windowed, only its window type is changed (everything else in it stays as it is).
     */
    syncWindowType: function () {
      var me = window.FSD && window.FSD.me, LSs = window.sessionStorage;
      try { if (LSs.getItem('averages_fs_wt') === '1') return; LSs.setItem('averages_fs_wt', '1'); } catch (e) { return; }
      var opts = FSX.lget('schoolagy_settings_options') || {};
      if (!me || me.incognito || opts.syncAcrossDevices === false || opts.windowType !== 'fullscreen') return;
      try { if (LS.getItem('schoolagy_account_mode') === 'incognito') return; } catch (e) { return; }
      FSX.api('/sync/settings').then(function (rec) {
        var st = rec && rec.settings; if (!st || typeof st !== 'object' || typeof rec.settingsUpdatedAt !== 'string') return;
        var so = st.settingsOptions && typeof st.settingsOptions === 'object' ? st.settingsOptions : {};
        if (so.windowType === 'fullscreen') return;
        var mine = (FSX.lget('schoolagy_sync_meta') || {}).settingsUpdatedAt === rec.settingsUpdatedAt;
        var next = Object.assign({}, st, { settingsOptions: Object.assign({}, so, { windowType: 'fullscreen', fsTheme: opts.fsTheme || 'is' }) });
        return FSX.api('/sync/settings', { method: 'PUT', json: { settings: next } }).then(function (r) {
          // this device agreed with the account's copy before: it still does
          if (mine && r && typeof r.settingsUpdatedAt === 'string') FSX.lset('schoolagy_sync_meta', { settingsUpdatedAt: r.settingsUpdatedAt });
        });
      }).catch(function () {});
    },
    syncPush: function () {
      clearTimeout(FSX._syncT);
      FSX._syncT = setTimeout(function () {
        var me = window.FSD && window.FSD.me;
        var raw = function (k) { try { return LS.getItem(k); } catch (e) { return null; } };
        if (!me || me.incognito || raw('schoolagy_account_mode') === 'incognito') return;
        var opts = FSX.lget('schoolagy_settings_options') || {}; delete opts.browserNotifications;
        var media = FSX.lget('averages_sync_media') || {}, ok = true;
        var ref = function (kind, v) {
          if (typeof v !== 'string' || !/^data:image\//.test(v)) return v;
          var k = media[kind]; if (k && k.v) return 'r2:' + kind + ':' + k.v;
          ok = false; return v;
        };
        var ap = FSX.lget('schoolagy_appearance'), pr = FSX.lget('schoolagy_profile');
        if (ap && typeof ap === 'object') ap = Object.assign({}, ap, { background: ref('background', ap.background) });
        if (pr && typeof pr === 'object') pr = Object.assign({}, pr, { photo: ref('photo', pr.photo) });
        if (!ok) return;
        var settings = { settingsOptions: opts, appearance: ap, darkMode: raw('schoolagy_dark_mode'), profile: pr };
        FSX.api('/sync/settings', { method: 'PUT', json: { settings: settings } }).then(function (r) {
          if (r && typeof r.settingsUpdatedAt === 'string') FSX.lset('schoolagy_sync_meta', { settingsUpdatedAt: r.settingsUpdatedAt });
        }).catch(function () {});
      }, 800);
    },
    schoology: function (path) { return 'https://' + schoologyHost() + (path || ''); },
    schoologyHost: schoologyHost,
    windowedPath: function (p) { return WINDOWED[p] || '/home'; },
    api: function (path, opts) {
      opts = opts || {};
      var init = { method: opts.method || 'GET', credentials: 'include', cache: 'no-store', headers: {} };
      if (opts.json !== undefined) { init.body = JSON.stringify(opts.json); init.headers['content-type'] = 'application/json'; }
      else if (opts.body !== undefined) init.body = opts.body;
      if (opts.headers) Object.keys(opts.headers).forEach(function (k) { init.headers[k] = opts.headers[k]; });
      return fetch(API + path, init).then(function (r) {
        if (r.status === 401) { sdel('schoolagy_session_state'); window.location.replace('/'); throw new Error('signed_out'); }
        return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j && j.error || 'http_' + r.status); e.status = r.status; e.body = j; throw e; } return j; });
      });
    },
    /** Drops the cached answers so the next load asks Schoology again (Refresh buttons). */
    refresh: function () {
      sdel('schoolagy_bundle_cache');
      try { for (var i = SS.length - 1; i >= 0; i--) { var k = SS.key(i); if (k && k.indexOf('averages_extras_') === 0) SS.removeItem(k); } } catch (e) { /* off */ }
    },
    reload: function () { FSX.refresh(); window.location.reload(); },
    /**
     * Sync buttons and the page-open animation (2026-10-30, Martin's sync animations: "it is meant to play the
     * loading line animation not reload the page"). FSX.sync() asks Schoology again for everything this page shows,
     * one request each, without reloading. sync.wait(keys) resolves when those requests are back ('bundle', or an
     * extra: 'files', 'messages', 'updates', 'events', 'people', 'classmates', 'submissions', ...); then that part of
     * the page lands. The page's drawing code can't take new data in place, so if an answer comes back different from
     * what's on screen, its part stays as placeholders and, once every request is back, the page reloads into the new
     * data and opens with the same animation. FSX.sync(true) is the page opening: nothing is asked again, and the parts
     * land one after another after a short beat, like the Windowed pages. sync.say(text) is the closing toast, or
     * why it couldn't sync.
     */
    sync: function (first) {
      var S = { first: !!first, changed: false, failed: false };
      if (first) {
        var n = 0;
        S.wait = function () { var d = 260 + Math.min(n++, 8) * 90; return new Promise(function (r) { setTimeout(r, d); }); };
        S.say = function (t) { return t; };
        return S;
      }
      var me = window.FSD && window.FSD.me, old = (window.FSD && window.FSD.raw) || {}, plan = extrasPlan(), tz = zone(), P = {};
      // what counts as different: anything but when it was asked, and times only to the hour (answers carry times
      // worked out when they're asked, so two answers seconds apart never match to the second)
      var norm = function (v) { try { return JSON.stringify(v, function (k, x) {
        if (k === 'generatedAt') return undefined;
        if (typeof x === 'number' && x > 1e12 && x < 1e13) return Math.round(x / 36e5);
        if (typeof x === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(x)) return x.slice(0, 13);
        return x;
      }); } catch (e) { return ''; } };
      var ask = function (key, path, store) {
        P[key] = getJSON(path).then(function (d) { store(d); var same = norm(d) === norm(old[key]); if (!same) { S.changed = true; (S.which = S.which || []).push(key); try { sset('averages_fs_sync_changed', key); } catch (e) {} } return same; },
          function (err) { if (err && err.signedOut) { window.location.replace('/'); return new Promise(function () {}); } S.failed = true; return true; });
      };
      ask('bundle', '/data/bundle' + (tz ? '?tz=' + encodeURIComponent(tz) : ''), function (b) { sset('schoolagy_bundle_cache', JSON.stringify({ at: Date.now(), bundle: b })); });
      Object.keys(plan).forEach(function (k) {
        var path = plan[k][0], key = plan[k][1];
        if (path === '@for') { var q = turnedInFor(old.bundle); if (!q) return; path = '/data/submissions?for=' + q; key = 'fs_subs_' + q.length + '_' + q.slice(-24); }
        ask(k, path, function (d) { sset('averages_extras_' + key, JSON.stringify({ at: Date.now(), who: me && me.uid, data: d })); });
      });
      S.wait = function (keys) {
        var ks = keys === 'all' || !keys ? Object.keys(P) : [].concat(keys).filter(function (k) { return P[k]; });
        if (!ks.length) ks = ['bundle'];
        return Promise.all(ks.map(function (k) { return P[k]; })).then(function (same) { return same.every(Boolean) ? undefined : new Promise(function () {}); });
      };
      S.say = function (t) { return S.failed ? 'Couldn\u2019t reach Schoology just now. This is what you had.' : t; };
      S.done = Promise.all(Object.keys(P).map(function (k) { return P[k]; })).then(function () {
        if (!S.changed) return;
        sset('averages_fs_toast', 'Up to date. New things came in.');
        window.location.reload();
      });
      return S;
    },
    /** Refresh buttons: ask Schoology again, then say so on the reloaded page. */
    reloadFresh: function (msg) { sset('averages_fs_toast', msg || 'Up to date.'); FSX.refresh(); window.location.reload(); },
    /** "Synced 3 min ago", from when the API built the bundle. */
    synced: function () {
      var at = Date.parse((window.FSD && window.FSD.generatedAt) || ''); if (!isFinite(at)) return 'Synced';
      var m = Math.round((Date.now() - at) / 60000);
      return m < 1 ? 'Synced just now' : m < 60 ? 'Synced ' + m + ' min ago' : 'Synced ' + Math.round(m / 60) + ' h ago';
    },
    signOut: function () { window.location.href = '/signout'; },
    /** Notifications already opened (the Windowed bell's list, averages_seen). kind: 'u' update, 'g' grade, 'm' message. */
    /** The student's course order (shared with Windowed): ids, or [] for the school's. set() saves it for both looks. */
    courseOrder: {
      get: function () { var v = lget('schoolagy_course_order'); return Array.isArray(v) ? v.map(String) : []; },
      set: function (ids) { lset('schoolagy_course_order', ids.map(String)); },
      clear: function () { try { LS.removeItem('schoolagy_course_order'); } catch (e) {} },
    },
    seen: {
      read: function () { var v = lget('averages_seen'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; },
      has: function (kind, id) { var l = FSX.seen.read()[kind]; return Array.isArray(l) && l.indexOf(String(id)) >= 0; },
      mark: function (kind, ids) {
        var v = FSX.seen.read(), l = Array.isArray(v[kind]) ? v[kind].map(String) : [];
        [].concat(ids).forEach(function (id) { var s = String(id == null ? '' : id); if (s && l.indexOf(s) < 0) l.push(s); });
        v[kind] = l.slice(-300); lset('averages_seen', v);
      },
    },
    lget: lget,
    lset: lset,
    zone: zone,
    /** A class file's address on our API (a Materials document's or an assignment's); view: open it in the browser. */
    fileUrl: function (f, view) {
      return API + '/data/attachment?section=' + encodeURIComponent(f.course) + '&' + (f.kind === 'document' ? 'document' : 'assignment') + '=' + encodeURIComponent(f.parent) + '&file=' + encodeURIComponent(f.id) + (view ? '&view=1' : '');
    },
    /**
     * File previews (2026-11-03, Martin: "add back file previews/popups"). The class's own files are drawn right in
     * the page: PDFs page by page with pdf.js (the app's own copy, loaded only when a PDF shows up), text as text,
     * pictures, sound and video in the browser's own players. Files are fetched with the session cookie from
     * /data/attachment?view=1 and kept in memory only (the last 8 PDFs), never stored.
     */
    prev: {
      kind: function (name) {
        var x = (String(name || '').match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
        return x === 'pdf' ? 'pdf' : /^(png|jpe?g|gif|webp)$/.test(x) ? 'image' : /^(txt|csv|md|json)$/.test(x) ? 'text' : /^(mp3|m4a|wav|ogg)$/.test(x) ? 'audio' : /^(mp4|webm|mov)$/.test(x) ? 'video' : '';
      },
      pdf: function (url) {
        if (PREV_DOCS[url]) return PREV_DOCS[url];
        var p = Promise.all([prevPdfjs(), fetch(url, { credentials: 'include' }).then(function (r) { if (!r.ok) throw new Error('http_' + r.status); return r.arrayBuffer(); })])
          .then(function (v) { return v[0].getDocument({ data: new Uint8Array(v[1]), isEvalSupported: false }).promise; });
        PREV_DOCS[url] = p; PREV_ORDER.push(url);
        p.catch(function () { delete PREV_DOCS[url]; });
        while (PREV_ORDER.length > 8) { var old = PREV_ORDER.shift(), d = PREV_DOCS[old]; delete PREV_DOCS[old]; if (d) d.then(function (doc) { doc.destroy(); }, function () {}); }
        return p;
      },
      /** Page n (0 first) of a PDF into a canvas, sized for a box cssWidth wide. Resolves { pages, ratio }. */
      page: function (url, n, canvas, cssWidth) {
        return FSX.prev.pdf(url).then(function (doc) {
          var k = Math.max(0, Math.min(doc.numPages - 1, n));
          return doc.getPage(k + 1).then(function (pg) {
            var v1 = pg.getViewport({ scale: 1 }), dpr = Math.min(2, window.devicePixelRatio || 1), vp = pg.getViewport({ scale: Math.max(.2, cssWidth / v1.width) * dpr });
            var c2 = document.createElement('canvas'); c2.width = Math.round(vp.width); c2.height = Math.round(vp.height);
            return pg.render({ canvasContext: c2.getContext('2d'), viewport: vp }).promise.then(function () {
              canvas.width = c2.width; canvas.height = c2.height; canvas.getContext('2d').drawImage(c2, 0, 0); canvas.style.aspectRatio = v1.width + ' / ' + v1.height;
              return { pages: doc.numPages, ratio: v1.width / v1.height };
            });
          });
        });
      },
      text: function (url) {
        return fetch(url, { credentials: 'include' }).then(function (r) { if (!r.ok) throw new Error('http_' + r.status); return r.text(); }).then(function (t) { return t.length > 200000 ? t.slice(0, 200000) + '\n…' : t; });
      },
      /** Small first-page pictures for [data-pthumb="<url>"] boxes as they come into view, two at a time. */
      thumbs: function (root) {
        var els = (root || document).querySelectorAll('[data-pthumb]:not([data-pthumbed])'); if (!els.length) return;
        var draw = function (el) {
          el.setAttribute('data-pthumbed', '1');
          PREV_Q = PREV_Q.then(function () {
            var c = document.createElement('canvas'), w = +el.getAttribute('data-pthumb-w') || Math.max(80, Math.min(480, el.clientWidth || 160));
            return FSX.prev.page(el.getAttribute('data-pthumb'), 0, c, w).then(function () { c.className = 'pthumb'; el.textContent = ''; el.appendChild(c); el.classList.add('has-pthumb'); }, function () {});
          });
        };
        if (!window.IntersectionObserver) { [].forEach.call(els, draw); return; }
        if (!PREV_IO) PREV_IO = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { PREV_IO.unobserve(e.target); draw(e.target); } }); }, { rootMargin: '200px' });
        [].forEach.call(els, function (el) { el.setAttribute('data-pthumbed', ''); PREV_IO.observe(el); });
      },
    },
    /** Schoology messages: a conversation, a reply, a new message (teachers only, in the app). */
    thread: function (id) { var z = zone(); return FSX.api('/messages/thread?id=' + encodeURIComponent(id) + (z ? '&tz=' + encodeURIComponent(z) : '')); },
    reply: function (id, message, fileIds) { return FSX.api('/messages/reply', { method: 'POST', json: { id: String(id), message: message, fileIds: fileIds || [] } }).then(function (r) { sdel('averages_extras_messages'); return r; }); },
    send: function (recipientIds, subject, message, fileIds) { return FSX.api('/messages', { method: 'POST', json: { recipientIds: recipientIds, subject: subject, message: message, fileIds: fileIds || [] } }).then(function (r) { sdel('averages_extras_messages'); return r; }); },
    /** A file for a message, up to Schoology now (2026-11-03): resolves its file id to send with the message. */
    msgUpload: function (file, onProgress) {
      var load = window.AveragesSubmit ? Promise.resolve(window.AveragesSubmit) : new Promise(function (ok, no) {
        var sc = document.createElement('script'); sc.src = '/js/averages-submit.js'; sc.onload = function () { window.AveragesSubmit ? ok(window.AveragesSubmit) : no({ code: 'not_configured' }); }; sc.onerror = function () { no({ code: 'network' }); }; document.head.appendChild(sc);
      });
      return load.then(function (S) { return S.uploadFile({ purpose: 'message', blob: file, name: file.name, onProgress: function (x) { if (onProgress) onProgress(x.phase === 'hashing' ? x.fraction * 0.15 : 0.15 + x.fraction * 0.85); } }); }).then(function (r) { return r.fileId; });
    },
    /** Friendly words for a messages error. */
    msgError: function (e) {
      var c = e && e.message;
      return c === 'school_blocks_new_messages' ? 'Your school\u2019s Schoology settings don\u2019t let students start a new message to them. You can still reply when they message you.' : c === 'recipient_not_allowed' ? 'Schoology doesn\u2019t let you message this person.' : c === 'too_long' || c === 'message_too_long' ? 'That message is too long.' : c === 'empty_subject' ? 'Add a subject first.' : c === 'empty_message' ? 'Write a message first.' : c === 'rate_limited' ? 'Too many messages at once. Wait a minute and try again.' : 'Couldn\u2019t send it. Try again in a moment.';
    },
    /** "Thursday at 8:12 PM": when the student was last here before this visit (a visit ends after 30 minutes away). */
    lastVisit: function () {
      var v = lget('averages_fs_visit') || {}, now = Date.now();
      if (!v.at || now - v.at > 30 * 60000) { v.prev = v.at || 0; }
      v.at = now; lset('averages_fs_visit', v);
      if (!v.prev) return 'your first visit';
      var d = new Date(v.prev), days = Math.round((new Date(new Date().toDateString()) - new Date(d.toDateString())) / 86400000);
      var t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      return (days === 0 ? 'today' : days === 1 ? 'yesterday' : days < 7 ? d.toLocaleDateString('en-US', { weekday: 'long' }) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })) + ' at ' + t;
    },
    /** A class by its name ("AP Chemistry"), for the few places a page only has the name. */
    classNamed: function (name) {
      var n = String(name || '').trim().toLowerCase(), l = (window.FSD && window.FSD.CLASSES) || [];
      for (var i = 0; i < l.length; i++) if (l[i].name.toLowerCase() === n) return l[i];
      return null;
    },
    /**
     * The pages' plain "where this goes" labels (data-toast="the Grades page", "the AP Chemistry course hub",
     * "your grades in Schoology, in a new tab" ...) as real moves. True when it went somewhere.
     */
    open: function (text) {
      var t = String(text || '').trim(), low = t.toLowerCase(), m, c;
      var PAGES = ['home', 'courses', 'grades', 'assignments', 'calendar', 'files', 'messages', 'contacts', 'settings'];
      if ((m = low.match(/^(?:the )?(home|courses|grades|assignments|calendar|files|messages|contacts|settings)(?: page)?$/))) { FSX.go(m[1]); return true; }
      if (/^the sign-in page$|^log in$/.test(low)) { window.location.href = '/'; return true; }
      if ((m = t.match(/^the (.+) course hub$/)) && (c = FSX.classNamed(m[1]))) { FSX.hub(c.id); return true; }
      if ((m = t.match(/^the (.+) page$/)) && (c = FSX.classNamed(m[1]))) { FSX.hub(c.id); return true; }
      if ((c = FSX.classNamed(t))) { FSX.hub(c.id); return true; }
      if ((m = t.match(/^the calendar, showing (.+) only$/i)) && (c = FSX.classNamed(m[1]))) { FSX.go('calendar', { course: c.id }); return true; }
      if (/^turn in, on the assignments page$/i.test(t)) { FSX.go('assignments', { turnin: 1 }); return true; }
      if (/your profile settings|edit profile/i.test(t)) { FSX.go('settings', { section: 'account' }); return true; }
      if (/in schoology|schoology, in a new tab|schoology account/i.test(t)) {
        var path = /grades|report card/i.test(t) ? '/grades/grades' : /calendar/i.test(t) ? '/calendar' : /messages/i.test(t) ? '/messages' : /courses|members/i.test(t) ? '/courses' : /account settings/i.test(t) ? '/settings' : '/home';
        if (FSX.course && /this course|this update/i.test(t)) path = '/course/' + FSX.course + (/update/i.test(t) ? '/updates' : '/materials');
        FSX.newTab(FSX.schoology(path)); return true;
      }
      for (var i = 0; i < PAGES.length; i++) if (new RegExp('on the ' + PAGES[i] + ' page$', 'i').test(t)) { FSX.go(PAGES[i]); return true; }
      if (window.console) console.warn('[fs] nothing wired for', t);
      return false;
    },
  };
  // Anything with data-go="<address>" moves there (the pages use it for real links built from data).
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('[data-go]');
    if (!a || e.defaultPrevented) return;
    var to = a.getAttribute('data-go');
    if (!/^\/(?!\/)/.test(to)) return;
    e.preventDefault();
    if (e.metaKey || e.ctrlKey) FSX.newTab(to); else window.location.href = to;
  });
})();

/* ===================== FSA: the API's answers -> the pages' shapes ===================== */
(function () {
  'use strict';
  var SUBJECTS = [
    [/\bchem/, '\u{1F9EA}', '#1b7f67'], [/\bbio|anatom|physiolog/, '\u{1F9EA}', '#387f33'], [/\bphysical ed|(^|[^a-z])p\.?e\.?($|[^a-z])|fitness|\bweight/, '\u{1F3C3}', '#c2562b'],
    [/\bhealth/, '\u{1FA7A}', '#c0404a'], [/\bphysics/, '⚛️', '#4a56b8'], [/astronom/, '\u{1F52D}', '#3b3f8f'], [/environment|\bearth|geolog/, '\u{1F30D}', '#2f7f63'],
    [/robotic/, '\u{1F916}', '#55697d'], [/computer|programming|coding|\bcs[ap]?\b|software/, '\u{1F4BB}', '#2d6f8f'], [/engineer/, '⚙️', '#6a6478'],
    [/government|civics|politic/, '\u{1F3DB}️', '#2f4f8a'], [/econ/, '\u{1F4C8}', '#2e7d4f'], [/psych/, '\u{1F9E0}', '#9a4583'], [/geog/, '\u{1F5FA}️', '#4c7a5a'],
    [/histor/, '\u{1F4DC}', '#9a5a2a'], [/statistic|\bstats?\b/, '\u{1F4CA}', '#2f72a8'], [/geometr|\btrig/, '\u{1F4D0}', '#3e64b0'], [/calc|algebra|\bmath/, '\u{1F9EE}', '#2f5fb3'],
    [/english|literature|\blit\b|writing|composition|language arts|reading/, '\u{1F4D6}', '#a63a4f'], [/spanish|french|german|chinese|mandarin|japanese|korean|latin|italian|\basl\b|sign language|language/, '\u{1F5E3}️', '#7a4fae'],
    [/theat|drama/, '\u{1F3AD}', '#a3364b'], [/music|band|choir|orchestra|chorus/, '\u{1F3B5}', '#6b48a8'], [/photo/, '\u{1F4F7}', '#4f5d6e'], [/culinary|cooking|\bfoods?\b|nutrition/, '\u{1F373}', '#b05a26'],
    [/\barts?\b|drawing|painting|ceramic|sculpt|design/, '\u{1F3A8}', '#b03f7a'], [/business|marketing|accounting|financ/, '\u{1F4BC}', '#3d5f6e'], [/journalism|yearbook|newspaper/, '\u{1F4F0}', '#5c5c6e'], [/science/, '\u{1F52C}', '#2b7b8c'],
  ];
  function subject(name) { var n = String(name || '').toLowerCase(); for (var i = 0; i < SUBJECTS.length; i++) if (SUBJECTS[i][0].test(n)) return SUBJECTS[i]; return [null, '\u{1F4DA}', '#55697d']; }
  var arr = function (v) { return Array.isArray(v) ? v : []; };
  var obj = function (v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; };
  var DAY = 86400000;
  var WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function startOfDay(t) { var d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
  function dayLabel(ms, now) {
    var diff = Math.round((startOfDay(ms) - startOfDay(now)) / DAY), d = new Date(ms);
    if (diff === 0) return 'Today'; if (diff === 1) return 'Tomorrow'; if (diff === -1) return 'Yesterday';
    if (diff > 1 && diff < 7) return WD[d.getDay()];
    return MON[d.getMonth()] + ' ' + d.getDate();
  }
  function shortDate(ms) { var d = new Date(ms); return MON[d.getMonth()] + ' ' + d.getDate(); }
  function timeOf(ms) { return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
  function initials(n) { return String(n || '').replace(/^(Dr|Mr|Mrs|Ms|Mx|Sra|Sr|Srta|Prof)\.?\s+/i, '').split(/\s+/).filter(Boolean).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase() || '?'; }
  /** "45/50" -> [45, 50]. */
  function pts(s) { var m = String(s || '').match(/^\s*([\d.]+)\s*\/\s*([\d.]+)\s*$/); return m ? [Number(m[1]), Number(m[2])] : [null, null]; }
  /** "6h ago", "1d ago", "Just now" -> minutes ago (rough, for ordering). */
  function agoMin(s) {
    var t = String(s || '').toLowerCase(), m;
    if (!t || /just now|now/.test(t)) return 0;
    if ((m = t.match(/(\d+)\s*m/)) && !/mo/.test(t)) return +m[1];
    if ((m = t.match(/(\d+)\s*h/))) return +m[1] * 60;
    if ((m = t.match(/(\d+)\s*d/))) return +m[1] * 1440;
    if ((m = t.match(/(\d+)\s*w/))) return +m[1] * 10080;
    if (/yesterday/.test(t)) return 1440;
    var d = Date.parse(t + ' ' + new Date().getFullYear()); if (isFinite(d)) return Math.max(0, Math.round((Date.now() - d) / 60000));
    return 99999;
  }

  /**
   * A class's grade as it stood at time `t`, worked out from its gradebook: each weighted category's
   * points so far, weighted (categories with nothing graded yet left out, the rest scaled up), or total
   * points when the class has no weights. Work with no graded time counts from the start. null: nothing yet.
   */
  function gradeAt(cats, t) {
    var tw = 0, tv = 0, pe = 0, pp = 0, weighted = cats.some(function (c) { return c.weight > 0; });
    cats.forEach(function (c) {
      var e = 0, p = 0;
      arr(c.assignments).forEach(function (a) { if (a.graded && typeof a.score === 'number' && a.points > 0 && (!a.gradedAt || a.gradedAt <= t)) { e += a.score; p += a.points; } });
      pe += e; pp += p;
      if (p > 0 && c.weight > 0) { tw += c.weight; tv += c.weight * (e / p * 100); }
    });
    if (weighted) return tw > 0 ? tv / tw : null;
    return pp > 0 ? pe / pp * 100 : null;
  }
  /** Monday of this week and the 7 before it, oldest first: [ms, "Aug 24"]. */
  function weekStarts(now) {
    var d = new Date(now), back = (d.getDay() + 6) % 7, mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - back), out = [];
    for (var i = 7; i >= 0; i--) { var w = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() - i * 7); out.push([w.getTime(), MON[w.getMonth()] + ' ' + w.getDate()]); }
    return out;
  }
  /**
   * Each class's grade at the end of each of the last 8 weeks (this week: now), from its gradebook, lined
   * up with the grade Schoology reports today (the gap, if any, is spread back over every week evenly, so
   * the line ends on the real grade). Weeks before anything was graded repeat the first real value.
   */
  function weeklyTrend(cats, pct, weeks, now) {
    var vals = weeks.map(function (w, i) { return gradeAt(cats, i === weeks.length - 1 ? now : w[0] + 7 * DAY - 1); });
    var last = vals[vals.length - 1];
    if (last == null) return weeks.map(function () { return pct; });
    var off = pct - last, first = null;
    vals = vals.map(function (v) { return v == null ? null : Math.max(0, Math.min(110, v + off)); });
    vals.forEach(function (v) { if (first == null && v != null) first = v; });
    return vals.map(function (v) { return v == null ? first : Math.round(v * 10) / 10; });
  }

  /** The student's grade in each class, one value per day it was seen (this device), for the trend charts. */
  /**
   * Which of those weeks the class really had grades for (2026-11-03, Martin: the chart showed points for
   * weeks with no grades). has[i]: something was graded by the end of week i (before that, weeklyTrend
   * only repeats the first real value). posted[i]: a grade was entered during week i. Work with no graded
   * time counts from the start.
   */
  function weeklyHas(cats, weeks, now) {
    var times = [];
    cats.forEach(function (c) { arr(c.assignments).forEach(function (a) { if (a.graded && typeof a.score === 'number' && a.points > 0) times.push(a.gradedAt || 0); }); });
    var has = weeks.map(function (w, i) { var end = i === weeks.length - 1 ? now : w[0] + 7 * DAY - 1; return times.some(function (t) { return t <= end; }); });
    var posted = weeks.map(function (w, i) { var end = i === weeks.length - 1 ? now : w[0] + 7 * DAY - 1; return times.some(function (t) { return t && t >= w[0] && t <= end; }) || (i === 0 && times.some(function (t) { return t && t < w[0]; })); });
    return { has: has, posted: posted };
  }

  function gradeHistory(courses) {
    var key = 'averages_fs_grade_days', h = window.FSX.lget(key) || {}, today = new Date(), dk = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
    courses.forEach(function (c) {
      if (typeof c.pct !== 'number' || !isFinite(c.pct)) return;
      var l = Array.isArray(h[c.id]) ? h[c.id] : [];
      if (l.length && l[l.length - 1][0] === dk) l[l.length - 1][1] = c.pct; else l.push([dk, c.pct, Date.now()]);
      h[c.id] = l.slice(-120);
    });
    window.FSX.lset(key, h);
    return h;
  }

  function adapt(raw) {
    var now = Date.now();
    var b = obj(raw.bundle), people = obj(raw.people), me = raw.me || {};
    var courses = arr(b.COURSES), history = obj(b.HISTORY), gradebook = obj(b.GRADEBOOK);
    var ct = obj(people.courseTeachers), T = obj(people.TEACHERS);
    var teacherOf = function (id) {
      var n = typeof ct[id] === 'string' ? ct[id].trim() : '';
      if (!n) Object.keys(T).forEach(function (k) { if (!n && T[k] && T[k].course === id) n = T[k].name; });
      return n;
    };
    var updates = raw.updates && Array.isArray(raw.updates.COURSE_UPDATES) ? raw.updates.COURSE_UPDATES : arr(b.COURSE_UPDATES);
    var overdue = arr(b.OVERDUE), upcoming = arr(b.UPCOMING), today = arr(b.TODAY);
    var mates = obj(raw.classmates && raw.classmates.CLASSMATES);
    var days = gradeHistory(courses);
    var WEEKS = weekStarts(now);
    var seen = window.FSX.seen;

    // ---------- profile ----------
    var prof = window.FSX.lget('schoolagy_profile') || {};
    var name = (typeof prof.name === 'string' && prof.name.trim()) || (me.name || '').trim() || 'You';
    var photo = typeof prof.photo === 'string' && /^data:image\//.test(prof.photo) ? prof.photo : '';
    var schoolSaved = ((window.FSX.lget('averages_login_school') || {})[me.provider === 'google' ? 'classroom' : 'schoology']) || {};
    var school = typeof schoolSaved.name === 'string' && schoolSaved.name.trim() && schoolSaved.name !== 'Your school' ? schoolSaved.name.trim().slice(0, 120) : '';

    // ---------- classes ----------
    var CLASSES = courses.map(function (c, i) {
      var id = String(c.id), s = subject(c.name), hist = obj(history[id]), points = arr(hist.points).filter(function (v) { return typeof v === 'number'; });
      var cats = arr(obj(gradebook[id]).categories);
      var trend = weeklyTrend(cats, typeof c.pct === 'number' ? c.pct : 0, WEEKS, now);
      var wk = weeklyHas(cats, WEEKS, now);
      var due = upcoming.filter(function (a) { return a.courseId === id && Date.parse(a.dueAt) - now < 7 * DAY; });
      var nextUp = upcoming.filter(function (a) { return a.courseId === id; });
      var miss = overdue.filter(function (a) { return a.courseId === id && !a.outside; });
      var ups = updates.filter(function (u) { return u.courseId === id && u.unread && !seen.has('u', u.id); });
      var next = nextUp[0] ? [nextUp[0].title, dayLabel(Date.parse(nextUp[0].dueAt), now)] : null;
      var m = arr(mates[id]);
      var tids = arr(people.CONTACTS).filter(function (p) { return arr(p.courses).indexOf(id) >= 0; }).map(function (p) { return String(p.id); });
      return {
        id: id, name: c.name || 'Class', short: initials(c.name), teacher: teacherOf(id), teacherIds: tids, period: typeof c.period === 'number' ? c.period : i + 1,
        hasPeriod: typeof c.period === 'number', room: '', students: m.length ? m.length + 1 : 0, pct: typeof c.pct === 'number' ? c.pct : 0, grade: c.grade || '',
        trend: trend, trendHas: wk.has, trendPosted: wk.posted, due: due.length, missing: miss.length, updates: ups.length, next: next, code: c.code || '', section: c.section || '',
        predicted: c.predicted || '', predictedPct: typeof c.predictedPct === 'number' ? c.predictedPct : c.pct, dir: c.trend || 'flat', updated: c.updated || '',
        points: points, dates: arr(hist.dates), titles: arr(hist.titles), emoji: s[1], color: s[2], lmsColor: c.color || '', order: i,
      };
    });
    // the student's own course order (2026-11-01): the same saved order Windowed's Courses page writes
    // (schoolagy_course_order, course ids), so both looks list classes the same way; new classes go at the end
    var saved = arr(window.FSX.lget('schoolagy_course_order')).map(String);
    if (saved.length) CLASSES.sort(function (x, y) { var a = saved.indexOf(String(x.id)), b = saved.indexOf(String(y.id)); return (a < 0 ? 1e6 : a) - (b < 0 ? 1e6 : b); });
    var C = {}; CLASSES.forEach(function (c) { C[c.id] = c; });

    // ---------- notifications (the bell): grades, course updates, messages ----------
    var NT = [];
    arr(b.RECENT_GRADES).forEach(function (g) {
      if (!C[g.courseId] || !g.id) return;
      var p = pts(g.pts);
      NT.push({ id: 'g:' + g.id, kind: 'g', raw: g.id, ago: agoMin(g.when), c: g.courseId, k: 'graded', t: g.title || 'Assignment', got: p[0] != null ? p[0] : g.pct, of: p[1] != null ? p[1] : 100, d: 'Graded ' + (g.when || ''), unread: !!g.isNew, aid: g.id });
    });
    updates.forEach(function (u) {
      if (!C[u.courseId] || !u.id) return;
      NT.push({ id: 'u:' + u.id, kind: 'u', raw: u.id, ago: agoMin(u.when), c: u.courseId, k: 'ann', t: String(u.body || '').slice(0, 220), d: (u.from || 'Your teacher') + ' · ' + (u.when || ''), unread: !!u.unread });
    });
    arr(b.MESSAGES).forEach(function (m) {
      if (!m.id) return;
      // The sender by id among the student's teachers (2026-11-03): the API may only know "Teacher".
      var who = m.authorId ? arr(people.CONTACTS).filter(function (p) { return String(p.id) === String(m.authorId); })[0] : null;
      if (who && who.name && (!m.from || m.from === 'Teacher')) m = Object.assign({}, m, { from: who.name, courseId: m.courseId || (arr(who.courses).filter(function (c) { return C[c]; })[0] || '') });
      var cid = m.courseId && C[m.courseId] ? m.courseId : (CLASSES.filter(function (c) { return c.teacher && c.teacher === m.from; })[0] || {}).id;
      NT.push({ id: 'm:' + m.id, kind: 'm', raw: m.id, ago: agoMin(m.time), c: cid || '', k: 'msg', t: (m.from || 'Someone') + ': ' + (m.subject || 'Message'), d: (m.preview || '') + (m.time ? ' · ' + m.time : ''), unread: !!m.unread, thread: m.id });
    });
    // Only what's new to the student counts; seen ones (here or in Windowed) are already "seen".
    var NT_SEEN_IDS = NT.filter(function (it) { return !it.unread || seen.has(it.kind, it.raw); }).map(function (it) { return it.id; });

    // ---------- every graded (or missing) piece of work, newest first ----------
    var fresh = {}; arr(b.RECENT_GRADES).forEach(function (g) { if (g.isNew && g.id && !seen.has('g', g.id)) fresh[g.id] = true; });
    var WORK = [];
    CLASSES.forEach(function (c) {
      arr(obj(gradebook[c.id]).categories).forEach(function (cat) {
        arr(cat.assignments).forEach(function (a) {
          if (a.missing) { WORK.push({ c: c.id, n: a.title, got: null, of: a.points, on: a.due ? 'Due ' + shortDate(a.due) : 'Missing', ago: a.due ? Math.max(0, Math.round((now - a.due) / DAY)) : 0, at: a.due || 0, missing: true, id: a.id, cat: cat.name }); return; }
          if (!a.graded || typeof a.score !== 'number') return;
          var at = a.gradedAt || 0, ago = at ? Math.max(0, Math.round((startOfDay(now) - startOfDay(at)) / DAY)) : 999;
          WORK.push({ c: c.id, n: a.title, got: a.score, of: a.points, on: at ? dayLabel(at, now) : '', ago: ago, at: at, fresh: !!fresh[a.id], note: a.comment || '', id: a.id, cat: cat.name });
        });
      });
    });
    WORK.sort(function (x, y) { return (y.at || 0) - (x.at || 0); });

    // ---------- each class's grading categories: [name, weight %, your % so far (null: nothing graded), points graded] ----------
    var CATS = {};
    CLASSES.forEach(function (c) {
      var cats = arr(obj(gradebook[c.id]).categories), weighted = cats.some(function (k) { return k.weight > 0; });
      CATS[c.id] = cats.filter(function (k) { return weighted ? k.weight > 0 : true; }).map(function (k) {
        var e = 0, pp = 0;
        arr(k.assignments).forEach(function (a) { if (a.graded && typeof a.score === 'number' && a.points > 0) { e += a.score; pp += a.points; } });
        return [k.name, weighted ? k.weight : Math.round(100 / Math.max(1, cats.length)), pp > 0 ? Math.round(e / pp * 1000) / 10 : null, pp];
      });
      if (!CATS[c.id].length) CATS[c.id] = [['All work', 100, null, 0]];
    });

    // ---------- every assignment we know about, one shape for Home, Assignments and the course hub ----------
    // st: 'missing' (past due, nothing turned in, not graded), 'due', 'turned' (files turned in, no grade yet)
    // or 'graded'. Discussions, tests and outside-tool work are done on Schoology (canTurnIn false).
    var subs = {};
    arr(raw.submissions && raw.submissions.files).forEach(function (f) {
      var k = f.course + ':' + f.assignment, s = subs[k] || (subs[k] = { at: 0, files: [] });
      if (f.at > s.at) s.at = f.at;
      if (s.files.length < 20) s.files.push({ name: f.name, size: f.size ? (f.size < 1048576 ? Math.max(1, Math.round(f.size / 1024)) + ' KB' : (f.size / 1048576).toFixed(1) + ' MB') : 'File', rev: f.revision });
    });
    var gbById = {};
    CLASSES.forEach(function (c) { arr(obj(gradebook[c.id]).categories).forEach(function (cat) { arr(cat.assignments).forEach(function (a) { gbById[c.id + ':' + a.id] = a; }); }); });
    var today0 = startOfDay(now);
    var offOf = function (ms) { return ms == null ? null : Math.round((startOfDay(ms) - today0) / DAY); };
    var WORK_ALL = [], seenW = {};
    function addWork(c, a, dueMs, base) {
      var key = c + ':' + a.id; if (!C[c] || !a.id || seenW[key]) return; seenW[key] = true;
      var g = gbById[key] || {}, sub = subs[key], graded = g.graded && typeof g.score === 'number';
      var type = base.type || 'assignment', outside = !!base.outside;
      var st = graded ? 'graded' : sub ? 'turned' : dueMs != null && dueMs < now ? (outside ? 'due' : 'missing') : 'due';
      if (g.missing && !graded && !sub) st = 'missing';
      WORK_ALL.push({
        id: String(a.id), c: c, t: a.title || g.title || 'Assignment', type: type, kind: type === 'assessment' ? 'test' : 'assignment', disc: type === 'discussion', outside: outside, noDrop: !!base.noDropbox,
        dueAt: dueMs, off: offOf(dueMs), day: dueMs != null ? WD[new Date(dueMs).getDay()] : '', time: dueMs != null ? (base.time || timeOf(dueMs)) : '',
        pts: typeof g.points === 'number' && g.points > 0 ? g.points : null, st: st,
        turnedAt: sub ? sub.at : 0, turned: sub ? (sub.at ? dayLabel(sub.at, now) : 'earlier') : null, sent: sub ? sub.files : undefined,
        got: graded ? g.score : undefined, gradedAt: graded ? g.gradedAt || 0 : 0, graded: graded ? (g.gradedAt ? dayLabel(g.gradedAt, now) : 'earlier') : null, note: g.comment || '',
      });
    }
    overdue.concat(upcoming).forEach(function (a) { addWork(a.courseId, a, Date.parse(a.dueAt) || null, a); });
    Object.keys(subs).forEach(function (k) { var p = k.split(':'), f = arr(raw.submissions && raw.submissions.files).filter(function (x) { return x.course === p[0] && x.assignment === p[1]; })[0]; if (f) addWork(p[0], { id: p[1], title: f.assignmentTitle }, null, {}); });
    CLASSES.forEach(function (c) { arr(obj(gradebook[c.id]).categories).forEach(function (cat) { arr(cat.assignments).forEach(function (a) {
      if (a.graded && a.gradedAt && now - a.gradedAt < 21 * DAY) addWork(c.id, a, a.due || null, {});
      else if (!a.graded && a.due && a.due > now - 14 * DAY) addWork(c.id, a, a.due, {});
    }); }); });
    // Not on Schoology's turn-in (2026-11-03): discussions, tests, outside tools, and work that takes no turn-ins (paper, in class)
    var canTurnIn = function (a) { return a.kind === 'assignment' && !a.disc && !a.outside && !a.noDrop; };

    // The sidebar's counts: work still to do (missing or due, with a due date: the same list Home shows, so
    // the number is the same on every page; 2026-11-03, Martin: Home said 14, Settings 34), and messages not opened yet.
    var counts = {
      assign: WORK_ALL.filter(function (a) { return (a.st === 'missing' || a.st === 'due') && a.dueAt; }).length,
      msg: arr(b.MESSAGES).filter(function (m) { return m.unread && !seen.has('m', m.id); }).length,
    };

    return {
      exampleTeacher: (CLASSES.filter(function (c) { return c.teacher; })[0] || {}).teacher || 'your teacher',
      counts: counts, WORK: WORK, CATS: CATS, ASG: WORK_ALL, canTurnIn: canTurnIn, subs: subs, WEEKS: WEEKS.map(function (w) { return w[1]; }), weekStarts: WEEKS.map(function (w) { return w[0]; }), gradeAt: gradeAt,
      raw: raw, now: now, me: { uid: me.uid, name: name, first: name.split(/\s+/)[0] || name, photo: photo, email: me.email || '', provider: me.provider || 'schoology', incognito: !!me.incognito, school: school },
      CLASSES: CLASSES, C: C, overdue: overdue, upcoming: upcoming, today: today, updates: updates, recentGrades: arr(b.RECENT_GRADES), messages: arr(b.MESSAGES),
      gradebook: gradebook, history: history, projectedGPA: typeof b.projectedGPA === 'number' ? b.projectedGPA : null, days: days, classmates: mates,
      people: people, NT: NT, NT_SEEN_IDS: NT_SEEN_IDS, generatedAt: b.generatedAt || '',
      fmt: { dayLabel: dayLabel, shortDate: shortDate, timeOf: timeOf, initials: initials, pts: pts, agoMin: agoMin, subject: subject, startOfDay: startOfDay },
    };
  }
  window.FSA = { adapt: adapt, subject: subject };
})();
