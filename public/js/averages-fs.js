/*
 * The Fullscreen pages' link to the real app (2026-10-28, Martin; behind the
 * `fullscreen` switch). The pages in /fs/ are Martin's Fullscreen designs,
 * built from fs-src/ by scripts/build-fs.mjs. They still run on their own
 * sample data (for testing with the tester account); this file joins them to
 * the app around that:
 *
 *   - checks the switch and the sign-in; switch off (or Windowed picked
 *     somewhere else) goes back to the Windowed page, signed out to sign-in;
 *   - light, dark or the device's choice (schoolagy_dark_mode, the same key
 *     as Windowed), before anything paints;
 *   - the accent color, if it's one of Fullscreen's (else Punch);
 *   - the student's own name and photo, and Potato mode, in place of the
 *     sample ones;
 *   - what's changed on the Fullscreen Settings page (theme, accent, Potato,
 *     name, photo) is saved where the rest of the app reads it;
 *   - the pages' "In the app, this opens ..." messages become real moves:
 *     between the Fullscreen pages, back to Windowed, signing out, Help and
 *     legal pages, Schoology in a new tab.
 *
 * Loaded in <head>, before the page's own script.
 */
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
  var page = (window.location.pathname.match(/\/fs\/([a-z0-9-]+)(?:\.html)?\/?$/) || [])[1] || 'home';
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
  function goWindowed(save) {
    if (save) {
      var o = json('schoolagy_settings_options') || {};
      o.windowType = 'windowed';
      put('schoolagy_settings_options', JSON.stringify(o));
    }
    window.location.replace(page === 'settings' && save ? '/settings?section=general' : windowedPath());
  }
  var opts = json('schoolagy_settings_options') || {};
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
  function go(p, hash) { window.location.href = '/fs/' + p + '.html' + (hash || ''); }
  function openTab(url) { window.open(url, '_blank', 'noopener'); }
  function schoology() {
    var host = '';
    try { var s = (JSON.parse(get('averages_login_school') || 'null') || {}).schoology; host = s && s.domain || ''; } catch (e) { /* none saved */ }
    host = String(host).replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    return 'https://' + (/^[a-z0-9.-]+\.schoology\.com$/i.test(host) ? host : 'app.schoology.com');
  }
  window.__fsNav = function (text) {
    var t = String(text || '');
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
  fetch(API + '/config/features', { credentials: 'omit', cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) { if (j && j.features && j.features.fullscreen === false) off(); })
    .catch(function () { /* API unreachable: stay */ });
  // Sign-in is checked by averages-fs-data.js, which loads the page's data.

  // The address of a page that wasn't found, so the 404 page shows the real one.
  if (FROM && FROM.charAt(0) === '/') { try { window.history.replaceState(null, '', FROM); } catch (e) { /* keep /fs/404.html */ } }
})();
