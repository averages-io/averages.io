// The Fullscreen pages' link to the real app.
(function () {
  'use strict';
  var API = window.location.hostname.endsWith('averages.io') ? 'https://api.averages.io' : 'http://localhost:8787';
  var root = document.documentElement;
  var LS = window.localStorage;
  var rawSet = Storage.prototype.setItem;
  function get(k) { try { return LS.getItem(k); } catch (e) { return null; } }
  function put(k, v) { try { rawSet.call(LS, k, v); } catch (e) { /* storage off */ } }
  function drop(k) { try { LS.removeItem(k); } catch (e) { /* storage off */ } }
  function json(k) { try { return JSON.parse(get(k) || 'null'); } catch (e) { return null; } }
  var page = (window.location.pathname.match(/\/(?:IS|fs)\/([a-z0-9-]+)(?:\.html)?\/?$/) || [])[1] || 'home';
  var FROM = page === '404' ? new URLSearchParams(window.location.search).get('from') : null;

  // ---------- back to Windowed ----------
  var WINDOWED = { home: '/home', courses: '/courses', grades: '/grades', assignments: '/assignments', files: '/files', calendar: '/calendar', messages: '/messages', contacts: '/contacts', settings: '/settings' };
  var HUB = { '#materials': '/course-materials', '#grades': '/gradebook', '#assignments': '/assignment' };
  function windowedPath() {
    var q = window.location.search;
    if (page === '404') return FROM && FROM.charAt(0) === '/' ? FROM : '/home';
    if (page === 'course-hub') { var h = (window.location.hash.match(/^#[a-z]+/) || [''])[0]; return (HUB[h] || '/course-home') + q; }
    return (WINDOWED[page] || '/home') + q;
  }
  // Where app.averages.io opens next time (the app worker reads it at "/"): kept up to date on every page.
  function avStart() {
    try {
      var o = JSON.parse(localStorage.getItem("schoolagy_settings_options") || "{}") || {};
      var pages = ["courses", "calendar", "grades", "messages", "assignments", "files", "contacts"];
      var to = pages.indexOf(o.openTo) >= 0 ? o.openTo : "home";
      var fs = o.windowType === "fullscreen" && sessionStorage.getItem("averages_fs_off") !== "1";
      var c = JSON.parse(sessionStorage.getItem("averages_features") || "null");
      if (c && c.features && c.features.fullscreen === false) fs = false;
      return (fs ? "/IS/" : "/") + to;
    } catch (e) { return "/home"; }
  }
  try { document.cookie = "averages_start=" + avStart() + "; Path=/; Max-Age=31536000; SameSite=Lax" + (location.protocol === "https:" ? "; Secure" : ""); } catch (e) { /* cookies off */ }
  function goWindowed(save) {
    if (save) {
      var o = json('schoolagy_settings_options') || {};
      o.windowType = 'windowed';
      put('schoolagy_settings_options', JSON.stringify(o));
    }
    try { document.cookie = 'averages_start=/home; Path=/; Max-Age=31536000; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : ''); } catch (e) { /* cookies off */ }
    window.location.replace(page === 'settings' && save ? '/settings?section=general' : windowedPath());
  }
  var opts = json('schoolagy_settings_options') || {};
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    var o = json('schoolagy_settings_options') || {};
    if (o.windowType !== 'fullscreen') { goWindowed(false); return; }
    if (window.__averagesSplash && window.__averagesSplash.hide) window.__averagesSplash.hide();
  });
  if (opts.windowType !== 'fullscreen') { goWindowed(false); return; }

  // ---------- theme ----------
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function themeChoice() { var v = get('schoolagy_dark_mode'); return v === 'dark' || v === 'light' ? v : 'auto'; }
  function applyTheme() {
    var t = themeChoice(), dark = t === 'dark' || (t === 'auto' && !!(mq && mq.matches));
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    root.style.colorScheme = dark ? 'dark' : 'light';
  }
  applyTheme();
  if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (themeChoice() === 'auto') applyTheme(); });

  // ---------- accent ----------
  var ACCENTS = { punch: ['#b8352f', '#9c2b26'], blue: ['#2f5fb3', '#264d93'], green: ['#2e7d4f', '#246340'], plum: ['#7a3fa0', '#663486'], orange: ['#b25600', '#964800'], teal: ['#0f7470', '#0b5e5b'], graphite: ['#44465a', '#33354a'] };
  function savedAccent() { var a = String((json('schoolagy_appearance') || {}).accent || '').toLowerCase(); return /^#[0-9a-f]{6}$/.test(a) ? a : ''; }
  function accentKey() {
    var a = savedAccent();
    for (var k in ACCENTS) if (ACCENTS[k][0] === a) return k;
    return a ? 'custom' : 'punch';
  }
  // A color that isn't one of Fullscreen's seven (one picked from a background in Windowed) is used as it is,
  // darkened just enough for white text on it (AA), with a hover a step darker.
  function shade(hex, f) { var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255; return '#' + [r, g, b].map(function (v) { return Math.round(v * f).toString(16).padStart(2, '0'); }).join(''); }
  function lumOf(hex) { var n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255].map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }).reduce(function (t, v, i) { return t + v * [0.2126, 0.7152, 0.0722][i]; }, 0); }
  function readable(hex) { var h = hex, i = 0; while (1.05 / (lumOf(h) + 0.05) < 4.5 && i++ < 40) h = shade(h, 0.94); return h; }
  function applyAccent(k) {
    var c = ACCENTS[k];
    if (!c) { var a = savedAccent(); c = a ? [readable(a), shade(readable(a), 0.85)] : ACCENTS.punch; }
    root.style.setProperty('--accent', c[0]);
    root.style.setProperty('--accent-hover', c[1]);
  }
  // One of Fullscreen's seven colors, or its default red: a Windowed color (from a background, say) showed on some
  // pages and not others (2026-11-09, Martin: "force choose the default red"). Saved, so every page agrees.
  if (accentKey() === 'custom') {
    var apx = json('schoolagy_appearance') || {};
    apx.accent = ACCENTS.punch[0];
    put('schoolagy_appearance', JSON.stringify(apx));
    var fsx = json('fsset') || {}; fsx.accent = 'punch'; put('fsset', JSON.stringify(fsx));
    window.__fsAccentReset = true;   // averages-fs-data.js sends it to Sync once the page is ready
  }
  applyAccent(accentKey());

  // ---------- the student's own choices, in the keys the pages read ----------
  var fsset = json('fsset') || {};
  fsset.theme = themeChoice();
  fsset.accent = accentKey();
  fsset.layout = 'full';
  var mode = get('schoolagy_account_mode');
  if (mode === 'incognito' || mode === 'classic') fsset.mode = mode;
  put('fsset', JSON.stringify(fsset));
  put('fsmock_potato', JSON.stringify(opts.potatoMode === true));
  var prof = json('schoolagy_profile') || {};
  var name = (typeof prof.name === 'string' && prof.name.trim()) || (get('schoolagy_profile_name') || '').trim();
  if (name) {
    var photo = typeof prof.photo === 'string' && /^data:image\//.test(prof.photo) ? prof.photo : '';
    put('fsmock_profile2', JSON.stringify({ name: name, photo: photo }));
  }

  // ...and back again when the Fullscreen pages change them.
  function saveOption(k, v) { var o = json('schoolagy_settings_options') || {}; o[k] = v; put('schoolagy_settings_options', JSON.stringify(o)); }
  var lastSig = {};
  Storage.prototype.setItem = function (k, v) {
    rawSet.call(this, k, v);
    if (this !== LS) return;
    try {
      if (k === 'fsset') {
        var s = JSON.parse(v) || {};
        if (s.theme === 'dark' || s.theme === 'light') put('schoolagy_dark_mode', s.theme);
        else if (s.theme === 'auto') drop('schoolagy_dark_mode');
        applyTheme();
        if (s.accent && ACCENTS[s.accent]) {
          var ap = json('schoolagy_appearance') || {};
          ap.accent = ACCENTS[s.accent][0];
          put('schoolagy_appearance', JSON.stringify(ap));
          applyAccent(s.accent);
        }
      } else if (k === 'fsmock_potato') {
        saveOption('potatoMode', JSON.parse(v) === true);
      } else if (k === 'fsmock_profile2') {
        var p = JSON.parse(v) || {}, cur = json('schoolagy_profile') || {};
        if (typeof p.name === 'string' && p.name.trim()) cur.name = p.name.trim();
        if (typeof p.photo === 'string') cur.photo = /^data:image\//.test(p.photo) ? p.photo : null;
        put('schoolagy_profile', JSON.stringify(cur));
      }
      var sig = k === 'fsset' ? (function (o) { return (o.theme || '') + '|' + (o.accent || ''); })(JSON.parse(v) || {}) : k + v;
      if ((k === 'fsset' || k === 'fsmock_potato' || k === 'fsmock_profile2') && sig !== lastSig[k] && window.FSX && window.FSX.syncPush) { var first = !(k in lastSig); lastSig[k] = sig; if (!first) window.FSX.syncPush(); }   // the account's copy follows real changes
    } catch (e) { /* not JSON: leave it */ }
  };

  // ---------- "In the app, this opens ..." ----------
  var PAGES = { Grades: 'grades', Courses: 'courses', Calendar: 'calendar', Messages: 'messages', Files: 'files', Contacts: 'contacts', Assignments: 'assignments' };
  function go(p, hash) { window.location.href = '/IS/' + p + (hash || ''); }
  function openTab(url) { window.open(url, '_blank', 'noopener'); }
  function schoology() {
    var host = '';
    try { var s = (JSON.parse(get('averages_login_school') || 'null') || {}).schoology; host = s && s.domain || ''; } catch (e) { /* none saved */ }
    host = String(host).replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    return 'https://' + (/^[a-z0-9.-]+\.schoology\.com$/i.test(host) ? host : 'app.schoology.com');
  }
  // Only the sign-in page's "In the app, this opens …" notes move you somewhere. Every other toast is just a toast:
  // words like "in Schoology" or "new message" in an ordinary message used to open Schoology or reload Messages.
  window.__fsNav = function (text) {
    var t = String(text || '');
    if (!/^In the app\b/i.test(t)) return false;
    if (/every page switches to dark colors|pages follow your device/i.test(t)) return true;   // done by applyTheme
    if (/classic windowed look/i.test(t)) { goWindowed(true); return true; }
    if (/signs you out/i.test(t)) { window.location.href = '/signout'; return true; }
    if (/takes you back to the page you were on/i.test(t)) { if (window.history.length > 1) window.history.back(); else go('home'); return true; }
    if (/Help Center/i.test(t)) { openTab('https://averages.io/support'); return true; }
    if (/Privacy Policy|Terms of Use/i.test(t)) { openTab('https://averages.io/privacy-policy'); return true; }
    if (/form to send us feedback/i.test(t)) { openTab('https://github.com/averages-io/averages.io/discussions'); return true; }
    if (/opens Google Drive/i.test(t)) { openTab('https://drive.google.com/'); return true; }
    if (/in Schoology|Schoology, in a new tab|on Schoology/i.test(t)) { openTab(schoology()); return true; }
    if (/\bin a new tab\b/i.test(t)) return false;
    if (/opens Customize Home|opens Home\b/i.test(t)) { go('home'); return true; }
    if (/course hub/i.test(t)) { go('course-hub'); return true; }
    if (/assignment page in /i.test(t)) { go('course-hub', '#assignments'); return true; }
    var m = t.match(/(?:opens|on) the (Grades|Courses|Calendar|Messages|Files|Contacts|Assignments)\b/);
    if (m) { go(PAGES[m[1]]); return true; }
    if (/new message|on the Messages page/i.test(t)) { go('messages'); return true; }
    if (/opens Settings|Edit profile|your plan in Settings|your profile settings|payment page|your receipts/i.test(t)) { go('settings'); return true; }
    return false;
  };

  // ---------- the switch and the sign-in ----------
  function off() { try { sessionStorage.setItem('averages_fs_off', '1'); } catch (e) { /* storage off */ } goWindowed(false); }
  var fchk = 0; try { fchk = +sessionStorage.getItem('averages_fs_featchk') || 0; } catch (e) {}
  if (!(Date.now() - fchk < 300000 && Date.now() >= fchk)) fetch(API + '/config/features', { credentials: 'include', cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      if (j && j.features) {
        try { sessionStorage.setItem('averages_fs_featchk', String(Date.now())); } catch (e) {}
        var msg = j.maintenance && typeof j.maintenance.message === 'string' ? j.maintenance.message.trim().slice(0, 300) : '';
        try { sessionStorage.setItem('averages_fs_maint', msg); } catch (e) {}
        maintBanner(msg);
      }
      if (j && j.features && j.features.fullscreen === false) off();
    })
    .catch(function () { /* API unreachable: stay */ });

  // ---------- the maintenance banner (Martin's design, 2026-11-09): along the bottom of every page while the
  // maintenance-banner switch is on, with the API's message and a link to api.averages.io/status. × hides it for this
  // tab (until the message changes); the same choice as Windowed's banner (averages_banner_x:<message>).
  function maintBanner(msg) {
    var run = function () {
      if (msg !== maintWant) return;   // a newer answer came in while this one waited for the page
      var old = document.getElementById('fsMaint'), gone = false;
      try { gone = !!msg && sessionStorage.getItem('averages_banner_x:' + msg) === '1'; } catch (e) { /* storage off */ }
      if (!msg || gone) { maintWant = ''; if (old) old.remove(); return; }
      if (old && old.dataset.text === msg) return;
      if (old) old.remove();
      if (!document.getElementById('fsMaintCss')) {
        var st = document.createElement('style'); st.id = 'fsMaintCss';
        st.textContent = '#fsMaint{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;display:flex;align-items:center;gap:18px;min-height:76px;padding:14px 20px 14px 112px;background:rgba(176,121,24,.9);color:#fff;font:600 15px/1.35 var(--font,system-ui),system-ui,sans-serif;box-shadow:0 -10px 30px rgba(0,0,0,.25);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);animation:fsMaintIn .35s cubic-bezier(.2,.8,.2,1) both}'
          + '#fsMaint .fm-ic{position:absolute;left:16px;bottom:10px;width:82px;height:74px;filter:drop-shadow(0 4px 10px rgba(0,0,0,.25))}'
          + '#fsMaint .fm-tx{flex:1;min-width:0}#fsMaint .fm-tx b{display:block;font-weight:700}#fsMaint .fm-tx a{color:#fff;text-decoration:underline;text-underline-offset:2px}'
          + '#fsMaint button{flex:none;width:40px;height:40px;border:0;border-radius:10px;background:rgba(255,255,255,.14);color:#fff;font:700 20px/1 system-ui,sans-serif;cursor:pointer}#fsMaint button:hover{background:rgba(255,255,255,.24)}'
          + '#fsMaint button:focus-visible,#fsMaint a:focus-visible{outline:2px solid #fff;outline-offset:2px}'
          + '@keyframes fsMaintIn{from{transform:translateY(100%)}}'
          + '@media (max-width:640px){#fsMaint{padding-left:76px;font-size:14px}#fsMaint .fm-ic{width:52px;height:47px;left:12px;bottom:14px}}'
          + 'body.potato-mode #fsMaint{animation:none;-webkit-backdrop-filter:none;backdrop-filter:none;background:rgb(176,121,24)}@media (prefers-reduced-motion:reduce){#fsMaint{animation:none}}';
        document.head.appendChild(st);
      }
      var el = document.createElement('div');
      el.id = 'fsMaint'; el.setAttribute('role', 'status'); el.dataset.text = msg;
      el.innerHTML = '<svg class="fm-ic" viewBox="0 0 88 80" aria-hidden="true"><path d="M38.3 6.6a6.6 6.6 0 0 1 11.4 0l35.6 61.6A6.6 6.6 0 0 1 79.6 78H8.4a6.6 6.6 0 0 1-5.7-9.8z" fill="#ffc21a"/><rect x="39.5" y="24" width="9" height="30" rx="4.5" fill="#14151f"/><circle cx="44" cy="64" r="5.2" fill="#14151f"/></svg>'
        + '<div class="fm-tx"><b></b>See <a href="https://api.averages.io/status" target="_blank" rel="noopener">api.averages.io/status</a> for more info.</div>'
        + '<button type="button" aria-label="Hide this message">×</button>';
      el.querySelector('b').textContent = msg;
      el.querySelector('button').addEventListener('click', function () {
        try { sessionStorage.setItem('averages_banner_x:' + msg, '1'); } catch (e) { /* storage off */ }
        maintWant = '';
        el.remove();
      });
      document.body.appendChild(el);
    };
    maintWant = msg;
    if (document.body) run(); else document.addEventListener('DOMContentLoaded', run, { once: true });
    // a page that redraws its body as it starts took the banner with it: put it back (cheap: one lookup per change)
    if (!maintMo && window.MutationObserver) {
      var t = 0;
      maintMo = new MutationObserver(function () {
        if (!maintWant || t || document.getElementById('fsMaint')) return;
        t = requestAnimationFrame(function () { t = 0; if (maintWant && !document.getElementById('fsMaint')) maintBanner(maintWant); });
      });
      maintMo.observe(document.documentElement, { childList: true, subtree: true });
    }
  }
  var maintWant = '', maintMo = null;
  try { maintBanner(sessionStorage.getItem('averages_fs_maint') || ''); } catch (e) { /* storage off */ }
  // Sign-in is checked by averages-fs-data.js, which loads the page's data.

  function avName() { var p = json('fsmock_profile2') || {}; return (typeof p.name === 'string' && p.name.trim()) || (window.FSD && window.FSD.me && window.FSD.me.name) || ''; }
  function paintAvs() {
    var A = window.AveragesAvatar; if (!A) return;
    var name = avName(), bg = A.background(name), ini = A.initials(name) || '?';
    var els = document.querySelectorAll('[data-av]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.classList.contains('photo')) continue;
      // already painted for this name (the browser rewrites the gradient as rgb(), so it can't be compared as text)
      if (el.dataset.avn === name && el.style.backgroundImage && el.textContent === ini) continue;
      el.style.backgroundImage = bg; el.style.backgroundColor = A.color(name); el.textContent = ini; el.dataset.avn = name;
    }
  }
  var avQueued = false;
  function avSoon() { if (avQueued) return; avQueued = true; (window.requestAnimationFrame || setTimeout)(function () { avQueued = false; paintAvs(); }); }
  window.addEventListener('fs:ready', function () {
    paintAvs();
    var touches = function (m) {
      var el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      if (el && el.closest && el.closest('[data-av]')) return true; // a picture was redrawn
      for (var j = 0; j < m.addedNodes.length; j++) { var n = m.addedNodes[j]; if (n.nodeType === 1 && (n.matches('[data-av]') || n.querySelector('[data-av]'))) return true; } // a menu with a picture opened
      return false;
    };
    if (window.MutationObserver) new MutationObserver(function (ms) { for (var i = 0; i < ms.length; i++) if (touches(ms[i])) { avSoon(); return; } }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style', 'class'] });
  });
  window.addEventListener('storage', function (e) { if (e.key === 'fsmock_profile2' || e.key === 'schoolagy_profile') avSoon(); });


  // ---------- keyboard shortcuts the student changed (Settings > About) ----------
  // averages_shortcuts: { search: combo, find: combo }, combo = { k: 'j', mod: true, shift: false, alt: false }.
  // A changed one replaces the default: its keys are passed to the page as the default's, and the default's do nothing.
  var IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  var KB_DEFAULT = { search: { k: 'k', mod: true, shift: false, alt: false }, find: { k: '/', mod: false, shift: false, alt: false } };
  function kbAll() { var s = json('averages_shortcuts') || {}, out = {}; for (var a in KB_DEFAULT) out[a] = s[a] && typeof s[a].k === 'string' && s[a].k ? s[a] : null; return out; }
  function kbMatch(e, c) {
    var k = (e.key || '').toLowerCase(), mod = IS_MAC ? e.metaKey || e.ctrlKey : e.ctrlKey;
    return k === c.k && !!mod === !!c.mod && !!e.shiftKey === !!c.shift && !!e.altKey === !!c.alt;
  }
  var kbSynth = false;
  document.addEventListener('keydown', function (e) {
    if (kbSynth || e.defaultPrevented) return;
    var mine = kbAll(), typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '') || (document.activeElement && document.activeElement.isContentEditable);
    for (var a in mine) {
      var c = mine[a]; if (!c) continue;
      if (kbMatch(e, c)) {
        if (typing && !c.mod) return;   // a plain key while typing is just typing
        e.preventDefault(); e.stopImmediatePropagation();
        var d = KB_DEFAULT[a];
        kbSynth = true;
        try { document.dispatchEvent(new KeyboardEvent('keydown', { key: d.k, code: d.k === '/' ? 'Slash' : 'Key' + d.k.toUpperCase(), ctrlKey: d.mod && !IS_MAC, metaKey: d.mod && IS_MAC, bubbles: true, cancelable: true })); }
        finally { kbSynth = false; }
        return;
      }
      if (kbMatch(e, KB_DEFAULT[a])) { e.stopImmediatePropagation(); return; }   // the old keys are off while changed
    }
  }, true);
  window.AveragesShortcuts = {
    defaults: KB_DEFAULT,
    get: function (a) { return kbAll()[a] || KB_DEFAULT[a]; },
    changed: function (a) { return !!kbAll()[a]; },
    set: function (a, c) { var s = json('averages_shortcuts') || {}; if (c) s[a] = c; else delete s[a]; try { localStorage.setItem('averages_shortcuts', JSON.stringify(s)); } catch (e) { /* storage off */ } },
    label: function (c) { var out = []; if (c.mod) out.push(IS_MAC ? '⌘' : 'Ctrl'); if (c.alt) out.push(IS_MAC ? '⌥' : 'Alt'); if (c.shift) out.push('Shift'); out.push(c.k === ' ' ? 'Space' : c.k.length === 1 ? c.k.toUpperCase() : c.k); return out; },
  };

  // The address of a page that wasn't found, so the 404 page shows the real one.
  if (FROM && FROM.charAt(0) === '/') { try { window.history.replaceState(null, '', FROM); } catch (e) { /* keep /IS/404 */ } }
})();
