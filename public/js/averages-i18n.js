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
  // the choice syncs across devices with the other settings (schoolagy_settings_options.language, 2026-11-14)
  function synced() { try { var o = JSON.parse(ls.get('schoolagy_settings_options') || '{}') || {}; return typeof o.language === 'string' ? o.language : null; } catch (e) { return null; } }
  var choice = synced() || ls.get('averages_lang') || 'auto';
  if (choice !== 'auto' && !LANGS[choice]) choice = 'auto';
  var deviceLang = fromDevice();
  var lang = choice === 'auto' ? deviceLang : choice;
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
    if (lang === 'en' && !TR_ON) return;   // English is the app's own words: nothing to do
    if (document.body.__avObs) return;
    document.body.__avObs = true;
    if (TR_ON) addCss();
    walk(document.body);
    mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    document.title = look(document.title) || document.title;
  }
  // a blue band sweeping across the text (the text keeps its own color, --av-tr-c, everywhere else)
  var CSS = '.av-tr-wait{background-image:linear-gradient(100deg,var(--av-tr-c) 0,var(--av-tr-c) 38%,#4c9aff 50%,var(--av-tr-c) 62%,var(--av-tr-c) 100%);background-size:300% 100%;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;animation:avTrWait 1.4s linear infinite}' +
    '@keyframes avTrWait{from{background-position:100% 0}to{background-position:0 0}}' +
    '.potato-mode .av-tr-wait{animation:none;background:none;-webkit-text-fill-color:#4c9aff}@media (prefers-reduced-motion:reduce){.av-tr-wait{animation:none;background:none;-webkit-text-fill-color:#4c9aff}}';
  function addCss() { if (document.getElementById('avTrCss')) return; var st = document.createElement('style'); st.id = 'avTrCss'; st.textContent = CSS; (document.head || document.documentElement).appendChild(st); }
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
  // Works in every language, English too (2026-11-14): each name, title, post or message is checked for
  // the language it's written in, and only translated when that isn't the app's language. In English
  // that means a Spanish teacher's posts or a French class's titles come out in English.
  var TR_ON = ls.get('averages_tr_items') === '1';
  var SERVER_OK = ls.get('averages_tr_server') === '1';
  var ITEM_ORIG = new Set(), TRC = {}, trKey = 'averages_trc_' + lang, queue = [], queued = new Set(), busy = false;
  var devices = {};           // the browser's translators, by source language
  var detector = null, detectorTried = false;   // the browser's language detector, once made
  var plusOk = null;          // null = not known yet
  try { TRC = JSON.parse(ls.get(trKey) || '{}') || {}; } catch (e) { TRC = {}; }

  // the browser's translator can take its time (or never answer, in some builds): don't wait on it forever
  function within(p, ms, fallback) { return Promise.race([p, new Promise(function (r) { setTimeout(function () { r(fallback); }, ms); })]); }
  function hasDevice() { return typeof window.Translator !== 'undefined' && typeof window.Translator.create === 'function'; }
  function hasDetector() { return typeof window.LanguageDetector !== 'undefined' && typeof window.LanguageDetector.create === 'function'; }
  // a name waiting for its translation shimmers (a soft band sweeping across it), so it's clearly not the
  // sync spinner; it stops when the translation comes in, or when nothing here can translate it
  var WAIT = new Set(), failed = new Set();
  function waiting(el, on) {
    if (!el || !el.classList) return;
    if (on) { if (WAIT.has(el)) return; try { el.style.setProperty('--av-tr-c', getComputedStyle(el).color); } catch (e) { /* keeps the fallback */ } el.classList.add('av-tr-wait'); WAIT.add(el); }
    else if (WAIT.has(el)) { el.classList.remove('av-tr-wait'); el.style.removeProperty('--av-tr-c'); WAIT.delete(el); }
  }
  function settleWaits() { WAIT.forEach(function (el) { if (!el.isConnected) { WAIT.delete(el); return; } var t = el.textContent.trim(); if (!ITEM_ORIG.has(t) || TRC[t] != null || failed.has(t)) waiting(el, false); }); }
  function item(v, el) {
    var k = v.trim();
    if (!k || !ITEM_ORIG.has(k)) return null;
    var hit = TRC[k];
    if (hit == null) { if (!failed.has(k)) { want(k); waiting(el, true); } return null; }
    waiting(el, false);
    if (hit === '' || hit === k) return null;   // already in the app's language
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
  function redraw() { clearTimeout(redrawT); redrawT = setTimeout(function () { saveTRC(); walk(document.body); settleWaits(); }, 250); }
  function giveUp(list) { list.forEach(function (k) { failed.add(k); }); redraw(); }

  /* Which of the 6 languages a text is in, or null when it can't tell (short titles like "Lab 3").
     The browser's detector when there is one; otherwise a quick guess from the script and common words. */
  var WORDS = {
    en: 'the and of to is for on with your you this are be will by at from your please due today',
    es: 'el la los las de del que y en un una para por con es su sus tu tus se al lo tarea examen clase mañana hoy',
    fr: 'le la les des de du et en un une pour par avec est sur vos votre ton ta au aux devoir demain aujourd',
    pt: 'o a os as de do da dos das que e em um uma para por com no na é seu sua você tarefa prova amanhã hoje',
    de: 'der die das und ist nicht mit für auf den dem ein eine zu im von bitte heute morgen aufgabe',
  };
  var WORDSET = {}; Object.keys(WORDS).forEach(function (l) { WORDSET[l] = {}; WORDS[l].split(' ').forEach(function (w) { WORDSET[l][w] = 1; }); });
  function guess(t) {
    var cjk = (t.match(/[㐀-鿿]/g) || []).length;
    if (cjk >= 2 && cjk >= t.replace(/\s/g, '').length * 0.3) return 'zh';
    var low = t.toLowerCase(), ws = low.match(/[a-zà-ÿß]+/g) || [], score = { en: 0, es: 0, fr: 0, pt: 0, de: 0 };
    ws.forEach(function (w) { for (var l in WORDSET) if (WORDSET[l][w]) score[l]++; });
    if (/[ñ¿¡]/.test(low)) score.es += 2;
    if (/[ãõ]|ção|ções/.test(low)) score.pt += 2;
    if (/[ß]|[äöü]/.test(low)) score.de += 2;
    if (/[èêëœ]|ç(?!ão)/.test(low)) score.fr += 1;
    var best = null, top = 0, second = 0;
    for (var l in score) { if (score[l] > top) { second = top; top = score[l]; best = l; } else if (score[l] > second) second = score[l]; }
    return top >= 2 && top > second ? best : null;
  }
  function makeDetector(gesture) {
    if (detector || !hasDetector() || (detectorTried && !gesture)) return Promise.resolve(detector);
    detectorTried = true;
    return within(window.LanguageDetector.availability(), 4000, 'unavailable').then(function (a) {
      if (a === 'unavailable') return null;
      if (a !== 'available' && !gesture && !(navigator.userActivation && navigator.userActivation.isActive)) return null;
      return within(window.LanguageDetector.create(), gesture ? 120000 : 8000, null).then(function (d) { if (d) detector = d; return d || null; });
    }).catch(function () { return null; });
  }
  function sourceOf(t) {
    var g = guess(t);
    if (!detector) return Promise.resolve(g);
    return within(detector.detect(t), 3000, null).then(function (r) {
      var top = r && r[0];
      if (!top || top.confidence < 0.6) return g;
      var base = String(top.detectedLanguage || '').toLowerCase().split('-')[0];
      return LANGS[base] ? base : null;
    }).catch(function () { return g; });
  }
  // a short text the app can't place: assume English when translating into another language, leave it in English
  function fromOf(src) { return src || (lang === 'en' ? null : 'en'); }

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
  function makeDevice(from, gesture) {
    if (from in devices && !gesture) return Promise.resolve(devices[from]);   // asked already (a translator, or null for none): don't wait again
    if (!hasDevice() || from === lang) return Promise.resolve(null);
    devices[from] = null;
    return within(window.Translator.availability({ sourceLanguage: from, targetLanguage: lang }), 4000, 'unavailable').then(function (a) {
      if (a === 'unavailable') return null;
      if (a !== 'available' && !gesture && !(navigator.userActivation && navigator.userActivation.isActive)) return null;   // a download needs a click first
      return within(window.Translator.create({ sourceLanguage: from, targetLanguage: lang }), gesture ? 180000 : 8000, null).then(function (t) { if (t) devices[from] = t; return t || null; });
    }).catch(function () { return null; });
  }
  function pump() {
    if (busy || !queue.length || !TR_ON) return;
    busy = true;
    checkPlus().then(function (ok) {
      if (!ok) { giveUp(queue.splice(0)); return; }
      return makeDetector(false).then(work);
    }).catch(function () { /* leave the originals */ }).then(function () { busy = false; if (queue.length) setTimeout(pump, 50); });
  }
  // a batch: find each text's language, translate on the device where it can, the rest on our server if that's on
  function work() {
    var batch = queue.splice(0, 30), server = [];
    return batch.reduce(function (p, k) {
      return p.then(function () {
        return sourceOf(k).then(function (src) {
          var from = fromOf(src);
          if (!from || from === lang) { TRC[k] = ''; return; }   // already in the app's language, or can't tell
          return makeDevice(from, false).then(function (t) {
            if (t) return within(t.translate(k), 10000, null).then(function (out) { if (out) TRC[k] = out; }).catch(function () { /* left as it is */ });
            if (SERVER_OK) server.push([k, from]); else failed.add(k);   // nothing here can translate it
          });
        });
      });
    }, Promise.resolve()).then(function () { redraw(); if (server.length) return byServer(server); });
  }
  function byServer(list) {
    return fetch(API + '/translate', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to: lang, texts: list.map(function (x) { return x[0]; }), from: list.map(function (x) { return x[1]; }) }) })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        list.forEach(function (x, i) { var o = j && Array.isArray(j.texts) ? j.texts[i] : null; if (typeof o === 'string' && o) TRC[x[0]] = o; else failed.add(x[0]); });
        redraw();
      }).catch(function () { giveUp(list.map(function (x) { return x[0]; })); });
  }

  /* The school's words to translate, from the data the pages get (averages-fs-data.js calls this):
     class names (not ones the student renamed), assignment and test titles, teacher posts and
     messages. Long text is also split by line, since a page draws each line on its own. */
  function items(list) {
    if (!list || (lang === 'en' && !TR_ON)) return;   // collected in every other language, so the app's words never replace them; translated only with Advanced translation
    var added = 0;
    list.forEach(function (s) {
      if (typeof s !== 'string') return;
      var parts = [s.trim()].concat(s.indexOf('\n') >= 0 ? s.split(/\n+/) : []);
      parts.forEach(function (p) {
        p = p.trim();
        if (p.length < 2 || p.length > 2000 || !/[A-Za-zÀ-ÿ\u3400-\u9fff]/.test(p) || ITEM_ORIG.has(p)) return;
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
    if (!data || (lang === 'en' && !TR_ON)) return;
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
    deviceLang: deviceLang,
    set: function (code) {
      code = LANGS[code] || code === 'auto' ? code : 'auto';
      ls.set('averages_lang', code);
      try { var o = JSON.parse(ls.get('schoolagy_settings_options') || '{}') || {}; o.language = code; ls.set('schoolagy_settings_options', JSON.stringify(o)); } catch (e) { /* storage off */ }
      if (window.FSX && typeof window.FSX.syncPush === 'function') window.FSX.syncPush();   // to your other devices
    },
    switchTo: function (code) {
      var api = this, next = code === 'auto' ? deviceLang : code;
      var S = window.__averagesSplash; if (S && S.show) S.show(12000);
      try { sessionStorage.setItem('averages_fs_logo', String(Date.now())); } catch (e) { /* the logo just won't wait */ }
      api.set(code);
      var ver = (window.AVG_I18NV && window.AVG_I18NV[next]) || '';
      var get = next === 'en' ? Promise.resolve() : fetch('/i18n/' + next + '.json' + (ver ? '?v=' + ver : ''), { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { if (j && j.t) ls.set('averages_i18n_' + next, JSON.stringify({ v: ver, t: j.t })); })
        .catch(function () { /* the next page fetches it */ });
      return within(get, 4000).then(function () { setTimeout(function () { location.reload(); }, 300); });
    },
    items: items, harvest: harvest, shortDate: shortDate, names: names,
    timeOf: function (ms) { if (lang === 'en') return null; try { return new Date(ms).toLocaleTimeString(LOCALE[lang], { hour: 'numeric', minute: '2-digit' }); } catch (e) { return null; } },
    // Advanced translation
    trOn: function () { return TR_ON; },
    setItems: function (on) {
      ls.set('averages_tr_items', on ? '1' : '0'); TR_ON = !!on;
      // the click lets the browser download its detector and the likeliest translator (English into the app's language; Spanish into English)
      if (TR_ON) addCss();
      if (!TR_ON) { WAIT.forEach(function (el) { waiting(el, false); }); }
      if (TR_ON) return Promise.all([makeDetector(true), makeDevice(lang === 'en' ? 'es' : 'en', true)]).then(function (r) { if (!document.body.__avObs) start(); pump(); return { device: !!r[1] }; });
      return Promise.resolve({ device: false });
    },
    setServer: function (on) { ls.set('averages_tr_server', on ? '1' : '0'); SERVER_OK = !!on; if (on) pump(); },
    serverOn: function () { return SERVER_OK; },
    deviceCan: function () {
      if (!hasDevice()) return Promise.resolve(false);
      return within(window.Translator.availability({ sourceLanguage: lang === 'en' ? 'es' : 'en', targetLanguage: lang }), 4000, 'unavailable').then(function (a) { return a !== 'unavailable'; }).catch(function () { return false; });
    },
    forget: function () { TRC = {}; try { localStorage.removeItem(trKey); } catch (e) { /* none */ } },
    _state: function () { return { items: ITEM_ORIG.size, cached: Object.keys(TRC).length, queue: queue.length, busy: busy, plus: plusOk, devices: Object.keys(devices), detector: !!detector, server: SERVER_OK, on: TR_ON }; },
    missing: function () { return missing ? Array.from(missing.entries()).sort(function (a, b) { return b[1] - a[1]; }) : []; },
  };
  whenBody(start);
})();
