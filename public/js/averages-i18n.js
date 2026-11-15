/* Averages in other languages (2026-11-15).
 *
 * 1. The app's own words. Pick a language in Settings > Language. Every page loads
 *    /i18n/<lang>.json, a list of the app's English text and its translation, and puts the
 *    translation in place of that text as the page draws, including attributes like
 *    placeholder, title and aria-label. Text with numbers in it is matched with each number
 *    as "#" ("3 due today" uses "# due today"). Anything not on the list stays in English.
 *    A place that shows the student's own words or a file name can opt out with data-no-t.
 * 2. Advanced translation (Averages Plus). This translates class names, assignment and test
 *    titles, teacher posts and messages: the school's words, not the app's. File names never.
 *    It uses the browser's own translator, on the device (Chrome and Edge on a computer).
 *    Where there isn't one, it can use our server instead, but only if the student turns
 *    that on (Settings > Language). Hovering a translated name shows the original.
 *
 * Kept on this device: averages_lang (auto | en | es | fr | pt | de | zh), averages_tr_items,
 * averages_tr_server, the word list (averages_i18n_<lang>) and the translations made so far
 * (averages_trc_<lang>). They all start with averages_, so signing out clears them.
 */
(function () {
  'use strict';
  if (window.AvI18n) return;
  var LANGS = { en: 'English', es: 'Español', fr: 'Français', pt: 'Português', de: 'Deutsch', zh: '中文' };
  var LOCALE = { en: 'en-US', es: 'es', fr: 'fr', pt: 'pt-BR', de: 'de', zh: 'zh-CN' };
  var API = location.hostname.endsWith('averages.io') ? 'https://api.averages.io' : 'http://localhost:8787';
  var ls = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage full or off */ } },
  };

  function fromDevice() {
    var list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en'];
    for (var i = 0; i < list.length; i++) { var b = String(list[i] || '').toLowerCase().split('-')[0]; if (LANGS[b]) return b; }
    return 'en';
  }
  var choice = ls.get('averages_lang') || 'auto';
  var lang = choice === 'auto' ? fromDevice() : (LANGS[choice] ? choice : 'en');
  document.documentElement.lang = lang === 'zh' ? 'zh-Hans' : lang;

  // ---------- 1. the app's own words ----------
  var DICT = null, done = new WeakMap();   // text node -> the text we put there (so our own change isn't redone)
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'data-tip'];
  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1, PRE: 1, NOSCRIPT: 1, svg: 1 };
  var collect = ls.get('averages_i18n_collect') === '1', missing = collect ? new Map() : null;

  function look(s) {
    if (!DICT) return null;
    var k = s.trim();
    if (!k || k.length > 400 || !/[A-Za-z]/.test(k)) return null;
    if (ITEM_ORIG.has(k)) return null;   // the school's words (a title like "Homework") are never treated as the app's
    var hit = DICT[k];
    if (hit != null) return s.replace(k, hit);
    var nums = k.match(/\d+(?:[.,:]\d+)*/g);
    if (nums) {
      var p = DICT[k.replace(/\d+(?:[.,:]\d+)*/g, '#')];
      if (p != null) { var i = 0; return s.replace(k, p.replace(/#/g, function () { return nums[i++] || ''; })); }
    }
    // "{x}" stands for a name or title that stays as it is: "Turn in {x}" -> "Entregar {x}"
    var P = pats();
    for (var j = 0; j < P.length; j++) {
      var mm = P[j].re.exec(k);
      if (mm) {
        // each "#" and each "{x}" keeps its own order, so a language can put the name first ("{x} 有 # 项到期")
        var by = { '#': [], '{x}': [] };
        P[j].order.forEach(function (t, i) { by[t].push(mm[i + 1]); });
        var out = P[j].v.replace(/\{x\}|#/g, function (t) { return by[t].shift() || ''; });
        return s.replace(k, out);
      }
    }
    if (missing) missing.set(k, (missing.get(k) || 0) + 1);
    return null;
  }
  var PATS = null, PATS_OF = null;
  function pats() {
    if (PATS_OF === DICT) return PATS;
    PATS_OF = DICT; PATS = [];
    Object.keys(DICT || {}).filter(function (k) { return k.indexOf('{x}') >= 0; }).sort(function (a, b) { return b.length - a.length; }).forEach(function (k) {
      var order = [], src = k.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{x\}|#/g, function (t) { order.push(t); return t === '#' ? '(\\d+(?:[.,:]\\d+)*)' : '(.+?)'; });
      PATS.push({ re: new RegExp('^' + src + '$'), v: DICT[k], order: order });
    });
    return PATS;
  }
  function optedOut(el) {
    for (var e = el; e && e !== document.documentElement; e = e.parentElement) {
      if (SKIP[e.nodeName] || (e.hasAttribute && (e.hasAttribute('data-no-t') || e.isContentEditable))) return true;
    }
    return false;
  }
  function doText(n) {
    var v = n.nodeValue;
    if (!v || done.get(n) === v) return;
    if (optedOut(n.parentElement)) return;
    var t = TR_ON ? item(v, n.parentElement) : null;
    if (t == null) t = look(v);
    // "U.S. History · Discussion · 20 points": each part on its own
    if (t == null && v.indexOf(' · ') > 0) {
      var parts = v.split(' · '), hit = false;
      parts = parts.map(function (p) { var r = (TR_ON ? item(p, null) : null); if (r == null) r = look(p); if (r != null) { hit = true; return r; } return p; });
      if (hit) t = parts.join(' · ');
    }
    if (t != null && t !== v) { done.set(n, t); n.nodeValue = t; }
  }
  function doAttrs(el) {
    if (!el.getAttribute || optedOut(el)) return;
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i], v = el.getAttribute(a);
      if (!v || el['__t_' + a] === v) continue;
      var t = look(v);
      if (t != null && t !== v) { el['__t_' + a] = t; el.setAttribute(a, t); }
    }
  }
  function walk(root) {
    if (!root || (!DICT && !TR_ON)) return;
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1 || SKIP[root.nodeName]) return;
    if (DICT) doAttrs(root);
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: function (n) { return n.nodeType === 1 && SKIP[n.nodeName] ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; },
    });
    for (var n = w.nextNode(); n; n = w.nextNode()) { if (n.nodeType === 3) doText(n); else if (DICT) doAttrs(n); }
  }
  var mo = new MutationObserver(function (list) {
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (m.type === 'childList') { for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]); }
      else if (m.type === 'characterData') doText(m.target);
      else if (m.type === 'attributes' && DICT) doAttrs(m.target);
    }
  });
  function start() {
    if (lang === 'en') return;   // English is the app's own words: nothing to do
    walk(document.body);
    mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    document.title = look(document.title) || document.title;
  }
  function whenBody(f) { if (document.body) f(); else document.addEventListener('DOMContentLoaded', f); }

  if (lang !== 'en') {
    var key = 'averages_i18n_' + lang, ver = (window.AVG_I18NV && window.AVG_I18NV[lang]) || '';
    try { var kept = JSON.parse(ls.get(key) || 'null'); if (kept && kept.t) DICT = kept.t; } catch (e) { /* none kept */ }
    if (!DICT || !kept || kept.v !== ver || !ver) {
      fetch('/i18n/' + lang + '.json' + (ver ? '?v=' + ver : ''), { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (!j || !j.t) return;
          DICT = j.t; ls.set(key, JSON.stringify({ v: ver, t: j.t }));
          whenBody(function () { walk(document.body); });
        })
        .catch(function () { /* stays English */ });
    }
  }

  // ---------- 2. Advanced translation: the school's words ----------
  var TR_ON = lang !== 'en' && ls.get('averages_tr_items') === '1';
  var SERVER_OK = ls.get('averages_tr_server') === '1';
  var ITEM_ORIG = new Set(), TRC = {}, trKey = 'averages_trc_' + lang, queue = [], queued = new Set(), busy = false;
  var device = null;          // the browser's translator, once made
  var plusOk = null;          // null = not known yet
  try { TRC = JSON.parse(ls.get(trKey) || '{}') || {}; } catch (e) { TRC = {}; }

  // the browser's translator can take its time (or never answer, in some builds): don't wait on it forever
  function within(p, ms, fallback) { return Promise.race([p, new Promise(function (r) { setTimeout(function () { r(fallback); }, ms); })]); }
  function hasDevice() { return typeof window.Translator !== 'undefined' && typeof window.Translator.create === 'function'; }
  function item(v, el) {
    var k = v.trim();
    if (!k || !ITEM_ORIG.has(k)) return null;
    var hit = TRC[k];
    if (hit == null) { want(k); return null; }
    if (el && !el.hasAttribute('title')) el.setAttribute('title', (DICT && DICT['Original: #'] ? DICT['Original: #'].replace('#', '') : 'Original: ') + k);
    return v.replace(k, hit);
  }
  function want(k) { if (queued.has(k)) return; queued.add(k); queue.push(k); pump(); }
  function saveTRC() {
    var keys = Object.keys(TRC);
    if (keys.length > 3000) keys.slice(0, keys.length - 3000).forEach(function (k) { delete TRC[k]; });
    ls.set(trKey, JSON.stringify(TRC));
  }
  var redrawT = 0;
  function redraw() { clearTimeout(redrawT); redrawT = setTimeout(function () { saveTRC(); walk(document.body); }, 250); }

  function checkPlus() {
    if (plusOk !== null) return Promise.resolve(plusOk);
    try { var kept = JSON.parse(sessionStorage.getItem('averages_plus_member') || 'null'); if (kept && typeof kept.plus === 'boolean' && Date.now() - kept.at < 600000) { plusOk = kept.plus; return Promise.resolve(plusOk); } } catch (e) { /* none */ }
    return fetch(API + '/billing/status', { credentials: 'include', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (b) {
        plusOk = !!(b && (b.plus === true || b.enabled === false));   // billing off = everything is free
        try { sessionStorage.setItem('averages_plus_member', JSON.stringify({ plus: plusOk, at: Date.now() })); } catch (e) { /* storage off */ }
        return plusOk;
      })
      .catch(function () { plusOk = false; return false; });
  }
  function makeDevice(gesture) {
    if (device) return Promise.resolve(device);
    if (!hasDevice()) return Promise.resolve(null);
    var to = lang === 'zh' ? 'zh' : lang;
    return within(window.Translator.availability({ sourceLanguage: 'en', targetLanguage: to }), 4000, 'unavailable').then(function (a) {
      if (a === 'unavailable') return null;
      if (a !== 'available' && !gesture && !(navigator.userActivation && navigator.userActivation.isActive)) return null;   // a download needs a click first
      return within(window.Translator.create({ sourceLanguage: 'en', targetLanguage: to }), gesture ? 180000 : 8000, null).then(function (t) { if (t) device = t; return t || null; });
    }).catch(function () { return null; });
  }
  function pump() {
    if (busy || !queue.length || !TR_ON) return;
    busy = true;
    checkPlus().then(function (ok) {
      if (!ok) { queue.length = 0; busy = false; return; }
      return makeDevice(false).then(function (t) {
        if (t) return byDevice(t);
        if (SERVER_OK) return byServer();
        queue.length = 0;   // nothing can translate here: leave the originals
      });
    }).catch(function () { /* leave the originals */ }).then(function () { busy = false; if (queue.length) setTimeout(pump, 50); });
  }
  function byDevice(t) {
    var batch = queue.splice(0, 20);
    return batch.reduce(function (p, k) {
      return p.then(function () { return within(t.translate(k), 10000, null).then(function (out) { if (out) TRC[k] = out; }).catch(function () { /* left as it is */ }); });
    }, Promise.resolve()).then(redraw);
  }
  function byServer() {
    var batch = queue.splice(0, 40);
    return fetch(API + '/translate', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to: lang, texts: batch }) })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !Array.isArray(j.texts)) return;
        batch.forEach(function (k, i) { var o = j.texts[i]; if (typeof o === 'string' && o) TRC[k] = o; });
        redraw();
      });
  }

  /* The school's words to translate, from the data the pages get (averages-fs-data.js calls this):
     class names (not ones the student renamed), assignment and test titles, teacher posts and
     messages. Long text is also split by line, since a page draws each line on its own. */
  function items(list) {
    if (lang === 'en' || !list) return;   // collected in every other language, so the app's words never replace them; translated only with Advanced translation
    var added = 0;
    list.forEach(function (s) {
      if (typeof s !== 'string') return;
      var parts = [s.trim()].concat(s.indexOf('\n') >= 0 ? s.split(/\n+/) : []);
      parts.forEach(function (p) {
        p = p.trim();
        if (p.length < 2 || p.length > 2000 || !/[A-Za-z]/.test(p) || ITEM_ORIG.has(p)) return;
        if (/\.[A-Za-z0-9]{2,5}$/.test(p) && !/\s/.test(p)) return;   // looks like a file name
        if (/^(https?:|www\.)\S+$/.test(p)) return;
        ITEM_ORIG.add(p); added++;
      });
    });
    if (added && TR_ON) whenBody(function () { walk(document.body); });
  }

  /* Finds the school's words in data from our API: titles, subjects, previews, post and message
     text, and class names. Skips files (anything with a size or file type) and people. */
  var TEXT_KEYS = { title: 1, subject: 1, preview: 1, body: 1, message: 1, text: 1, description: 1 };
  var PEOPLE_KEYS = { people: 1, classmates: 1, CLASSMATES: 1, TEACHERS: 1, members: 1, from: 1, author: 1, me: 1, profile: 1, files: 1, attachments: 1, FILES: 1 };
  function harvest(data) {
    if (lang === 'en' || !data) return;
    var out = [], seen = 0;
    (function go(v, depth) {
      if (!v || depth > 7 || seen > 8000) return;
      if (Array.isArray(v)) { for (var i = 0; i < v.length; i++) go(v[i], depth + 1); return; }
      if (typeof v !== 'object') return;
      seen++;
      if ('ext' in v || 'filesize' in v || 'size' in v || 'mime' in v || 'download_path' in v || 'filename' in v) return;   // a file
      var course = ('grade' in v || 'pct' in v || 'section' in v || 'teacher' in v) && typeof v.name === 'string';
      for (var k in v) {
        if (!Object.prototype.hasOwnProperty.call(v, k) || PEOPLE_KEYS[k]) continue;
        var x = v[k];
        if (typeof x === 'string') { if (TEXT_KEYS[k] || (k === 'name' && course)) out.push(x); }
        else if (x && typeof x === 'object') go(x, depth + 1);
      }
    })(data, 0);
    items(out);
  }

  /* Short dates in the student's language ("14 nov."), for averages-fs-data.js's shortDate. */
  var dateFmt = null;
  function shortDate(ms) {
    if (lang === 'en') return null;
    try { dateFmt = dateFmt || new Intl.DateTimeFormat(LOCALE[lang], { month: 'short', day: 'numeric' }); return dateFmt.format(new Date(ms)); } catch (e) { return null; }
  }

  /* Month and weekday names in the student's language, or null in English. */
  var NAMES = null;
  function names() {
    if (lang === 'en') return null;
    if (NAMES) return NAMES;
    try {
      var L = LOCALE[lang], m = function (o) { return new Intl.DateTimeFormat(L, o); }, trim = function (x) { return x.replace(/\.$/, ''); };
      var mon = [], mon3 = [], wd = [], wdl = [];
      for (var i = 0; i < 12; i++) { var d = new Date(2026, i, 15); mon.push(m({ month: 'long' }).format(d)); mon3.push(trim(m({ month: 'short' }).format(d))); }
      for (var j = 0; j < 7; j++) { var w = new Date(2026, 10, 15 + j); wd.push(trim(m({ weekday: 'short' }).format(w))); wdl.push(m({ weekday: 'long' }).format(w)); }   // Nov 15, 2026 is a Sunday
      var cap = function (x) { return x.charAt(0).toUpperCase() + x.slice(1); };
      NAMES = { mon: mon.map(cap), mon3: mon3.map(cap), wd: wd.map(cap), wdl: wdl.map(cap) };
    } catch (e) { NAMES = null; }
    return NAMES;
  }

  window.AvI18n = {
    LANGS: LANGS, lang: lang, choice: choice, locale: LOCALE[lang],
    t: function (s) { var r = look(String(s)); return r == null ? String(s) : r; },
    set: function (code) { ls.set('averages_lang', LANGS[code] || code === 'auto' ? code : 'auto'); },
    items: items, harvest: harvest, shortDate: shortDate, names: names,
    timeOf: function (ms) { if (lang === 'en') return null; try { return new Date(ms).toLocaleTimeString(LOCALE[lang], { hour: 'numeric', minute: '2-digit' }); } catch (e) { return null; } },
    // Advanced translation
    trOn: function () { return TR_ON; },
    setItems: function (on) {
      ls.set('averages_tr_items', on ? '1' : '0'); TR_ON = on && lang !== 'en';
      if (TR_ON) return makeDevice(true).then(function (t) { pump(); return { device: !!t }; });   // the click lets the browser download its translator
      return Promise.resolve({ device: false });
    },
    setServer: function (on) { ls.set('averages_tr_server', on ? '1' : '0'); SERVER_OK = !!on; if (on) pump(); },
    serverOn: function () { return SERVER_OK; },
    deviceCan: function () {
      if (!hasDevice() || lang === 'en') return Promise.resolve(false);
      return within(window.Translator.availability({ sourceLanguage: 'en', targetLanguage: lang }), 4000, 'unavailable').then(function (a) { return a !== 'unavailable'; }).catch(function () { return false; });
    },
    forget: function () { TRC = {}; try { localStorage.removeItem(trKey); } catch (e) { /* none */ } },
    _state: function () { return { items: ITEM_ORIG.size, cached: Object.keys(TRC).length, queue: queue.length, busy: busy, plus: plusOk, device: !!device, server: SERVER_OK, on: TR_ON }; },
    missing: function () { return missing ? Array.from(missing.entries()).sort(function (a, b) { return b[1] - a[1]; }) : []; },
  };
  whenBody(start);
})();
