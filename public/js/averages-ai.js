/* A.I. search (2026-11-15): ask in your own words in search anything ("what's missing in chem"), answered by a
 * small model that runs on this device. Averages' fine-tune of IBM Granite 4.0 H 350M (Apache 2.0) turns the
 * question into one read-only search ("find_work, class Chemistry, status missing"), and this file runs that search
 * on the data the page already has. Nothing the student types leaves the device; the model only ever sees the
 * question and the names of their own classes and teachers.
 *
 * - Off unless the "ai-search" switch says it's on for this student (/config/features; while it's off, only the
 *   Averages.io school), the browser has WebGPU, and Potato mode is off.
 * - Downloaded once, when the student turns it on in Settings > A.I. search (size shown first), from our R2 through
 *   the app's own /ai/ (worker/index.js). Kept in the browser's Cache Storage ("averages-ai-v1"); never a server.
 * - Two versions: Standard (4-bit) and Higher quality (8-bit, twice the download). Both round 6.
 * - The model runs in a Web Worker (averages-ai-worker.js), with constrained decoding and the explicit-word filter.
 *
 * window.AvAI: offered(), status(), download(v), remove(), ask(text), run(call), VARIANTS.
 */
(function () {
  'use strict';
  if (window.AvAI) return;
  var CACHE = 'averages-ai-v1', STORE = 'averages_ai';
  var RUNTIME = 26861777;   // ort-wasm-simd-threaded.asyncify.wasm
  var COMMON = 7153421 + 25054 + 2022 + 210724 + 13310;   // tokenizer.json, tokenizer_config.json, config.json, generation_config.json, safety_words.json
  var VARIANTS = {
    q4: { model: 'averages-search-q4-r6', dtype: 'q4f16', data: 'onnx/model_q4f16.onnx_data', files: ['config.json', 'generation_config.json', 'tokenizer.json', 'tokenizer_config.json', 'safety_words.json', 'onnx/model_q4f16.onnx', 'onnx/model_q4f16.onnx_data'], bytes: 1905888 + 236435712 + COMMON + RUNTIME, name: 'Standard' },
    q8: { model: 'averages-search-q8-r6', dtype: 'q8', data: 'onnx/model_quantized.onnx_data', files: ['config.json', 'generation_config.json', 'tokenizer.json', 'tokenizer_config.json', 'safety_words.json', 'onnx/model_quantized.onnx', 'onnx/model_quantized.onnx_data'], bytes: 1855514 + 472699392 + COMMON + RUNTIME, name: 'Higher quality' },
  };
  var LS = window.localStorage;
  function opts() { try { var o = JSON.parse(LS.getItem(STORE) || 'null'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
  function saveOpts(o) { try { LS.setItem(STORE, JSON.stringify(o)); } catch (e) { /* full or off */ } }
  function variantOf() { var v = opts().v; return VARIANTS[v] ? v : 'q4'; }
  var mb = function (b) { return Math.round(b / 1e6) + ' MB'; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var lang = function () { return (window.AvI18n && window.AvI18n.lang) || 'en'; };
  var t = function (s) { return window.AvI18n && window.AvI18n.t ? window.AvI18n.t(s) : s; };
  // a test switch for computers without WebGPU: localStorage averages_ai_dev = "wasm" (the processor runs it). The 4-bit
  // Standard model can't run there (onnxruntime-web has no CPU kernel for its GatherBlockQuantized), so test with Higher quality
  var DEV_WASM = (function () { try { return LS.getItem('averages_ai_dev') === 'wasm'; } catch (e) { return false; } })();

  // ---------- can this student use it here? ----------
  var gpuP = null, flagP = null;
  // WebGPU with 16-bit shaders: the model's graph needs them (a GPU without them fails on its first search)
  function gpuOk() {
    if (DEV_WASM) return Promise.resolve(true);
    // Computers only (phones haven't been tested, and the model needs the memory). Every browser with WebGPU may try:
    // the first run checks it can really search (selfTest below). Firefox 145's WebGPU can't yet: it turns down one of
    // ONNX Runtime's shaders ("Shader 'Pad' parsing error", Martin 2026-11-15), so there it says so and tries again
    // when the browser updates.
    var uad = navigator.userAgentData;
    if (uad ? uad.mobile : /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '')) return Promise.resolve(false);
    if (!gpuP) gpuP = !navigator.gpu || !navigator.gpu.requestAdapter ? Promise.resolve(false)
      : navigator.gpu.requestAdapter().then(function (a) { return !!a && !!a.features && a.features.has('shader-f16'); }).catch(function () { return false; });
    return gpuP;
  }
  function flagOk() {
    if (!flagP) flagP = !window.FSX || !window.FSX.api ? Promise.resolve(false)
      : window.FSX.api('/config/features').then(function (r) { return !!(r && r.features && r.features['ai-search']); }).catch(function () { return false; });
    return flagP;
  }
  var potato = function () { return document.body && document.body.classList.contains('potato-mode'); };
  /** { ok, why }: why is 'switch' (not for this school yet), 'gpu' (no WebGPU) or 'potato' */
  function offered() {
    return Promise.all([flagOk(), gpuOk()]).then(function (r) {
      if (!r[0]) return { ok: false, why: 'switch' };
      if (!r[1]) return { ok: false, why: 'gpu' };
      return { ok: true, potato: potato() };
    });
  }

  // ---------- what's saved ----------
  function cacheKeys() {
    if (!window.caches) return Promise.resolve([]);
    return caches.has(CACHE).then(function (h) { return h ? caches.open(CACHE).then(function (c) { return c.keys().then(function (ks) { return ks.map(function (k) { return { c: c, k: k }; }); }); }) : []; }).catch(function () { return []; });
  }
  /** { on, v, saved, bytes, busy, loaded, total, error } */
  function status() {
    return cacheKeys().then(function (ks) {
      var v = variantOf(), V = VARIANTS[v], saved = ks.some(function (x) { return x.k.url.indexOf('/ai/models/' + V.model + '/' + V.data) >= 0; });
      return Promise.all(ks.map(function (x) { return x.c.match(x.k).then(function (r) { return r ? +r.headers.get('content-length') || 0 : 0; }).catch(function () { return 0; }); }))
        .then(function (sizes) {
          var o = opts();
          // compressed files don't say their size: a saved version counts as its known size
          var measured = sizes.reduce(function (a, b) { return a + b; }, 0);
          var c = check();
          // works: tested fine in this browser; blocked: tested and this browser can't run it (yet)
          return { on: !!o.on, v: v, saved: saved, any: ks.length > 0, bytes: saved ? Math.max(measured, V.bytes) : measured, busy: !!DL || !!testing, testing: !!testing, loaded: DL ? DL.loaded : 0, total: DL ? DL.total : 0, error: LAST_ERR,
            works: !!(c && c.ok && c.v === v), blocked: !!(c && !c.ok) };
        });
    });
  }
  function changed() { window.dispatchEvent(new CustomEvent('avai:state')); }

  // ---------- can this browser really run it? ----------
  // averages_ai_check = { ua, v, ok }: one test search after each download, and again whenever the browser updates
  // (its user agent changes), so a browser that couldn't (Firefox, for now) starts working once it can.
  var CHECK = 'averages_ai_check', UA = String(navigator.userAgent || '').slice(0, 300);
  function check() { try { var c = JSON.parse(LS.getItem(CHECK) || 'null'); return c && c.ua === UA ? c : null; } catch (e) { return null; } }
  function setCheck(v, ok) { try { LS.setItem(CHECK, JSON.stringify({ ua: UA, v: v, ok: !!ok, at: Date.now() })); } catch (e) { /* full or off */ } }
  var GPU_ERR = /webgpu|shader|ortrun|compute pipeline|f16|device (was )?lost/i;
  var testing = null, TEST_MS = 90000;
  function selfTest(v) {
    if (testing) return testing;
    var my, timer = 0;
    // a browser whose graphics never answer (Firefox can hang instead of failing, Martin 2026-11-15) counts as can't
    var timeout = new Promise(function (_, no) { timer = setTimeout(function () { no(new Error('webgpu_test_timeout')); }, TEST_MS); });
    my = testing = Promise.race([load(v).then(function () { return call({ t: 'ask', text: 'my grades', classes: ['Biology'], teachers: ['Ms. Lee'], lang: 'en' }); }), timeout])
      .then(function () { setCheck(v, true); return true; }, function (e) {
        if (e && e.message === 'stopped') throw e;   // turned off meanwhile
        if (e && GPU_ERR.test(e.message || '')) { setCheck(v, false); stop(); return false; }
        throw e;   // something else (a network hiccup): not this browser's fault, so nothing is remembered
      }).then(function (ok) { clearTimeout(timer); if (testing === my) testing = null; changed(); return ok; },
        function (e) { clearTimeout(timer); if (testing === my) testing = null; if (e && e.message !== 'stopped') LAST_ERR = e.message || 'failed'; changed(); throw e; });
    LAST_ERR = '';
    changed();   // Settings shows "Checking…" right away, every time (it used to wait for some other change)
    return testing;
  }
  /** Stops the model's thread: anything waiting on it gives up ("stopped"), and the next use starts it again. */
  function stop() {
    if (W) { W.terminate(); W = null; }
    Object.keys(waits).forEach(function (k) { var w = waits[k]; delete waits[k]; w.no(new Error('stopped')); });
    ready = null; readyV = ''; testing = null;
  }

  // ---------- the worker ----------
  var W = null, seq = 0, waits = {}, ready = null, readyV = '', DL = null, LAST_ERR = '';
  function worker() {
    if (W) return W;
    var v = (window.AVG_JSV || {})['averages-ai-worker.js'];
    W = new Worker('/js/averages-ai-worker.js' + (v ? '?v=' + v : ''), { type: 'module', name: 'averages-ai' });
    W.onmessage = function (e) {
      var m = e.data || {}, w = waits[m.id]; if (!w) return;
      if (m.t === 'progress') { if (w.progress) w.progress(m); return; }
      delete waits[m.id];
      if (m.t === 'error') w.no(new Error(m.error || 'ai_failed')); else w.yes(m);
    };
    W.onerror = function (e) { Object.keys(waits).forEach(function (k) { waits[k].no(new Error((e && e.message) || 'worker_failed')); delete waits[k]; }); W = null; ready = null; };
    return W;
  }
  function call(msg, progress) {
    return new Promise(function (yes, no) { var id = ++seq; waits[id] = { yes: yes, no: no, progress: progress }; msg.id = id; worker().postMessage(msg); });
  }
  function load(v) {
    if (ready && readyV === v) return ready;
    if (W && readyV && readyV !== v) stop();
    var V = VARIANTS[v]; readyV = v;
    ready = call({ t: 'load', model: V.model, dtype: V.dtype, files: V.files, total: V.bytes, device: DEV_WASM ? 'wasm' : 'webgpu' }, function (p) {
      // the bar: a light event while bytes arrive (avai:progress, ~10 a second); avai:state only when something changes
      if (DL) { DL.loaded = Math.min(p.loaded || 0, DL.total); var n = Date.now(); if (n - (DL.shown || 0) > 100) { DL.shown = n; window.dispatchEvent(new CustomEvent('avai:progress', { detail: { loaded: DL.loaded, total: DL.total } })); } }
    }).catch(function (e) { ready = null; readyV = ''; throw e; });
    return ready;
  }

  /** Download the model (once) and check it runs here. v: 'q4' or 'q8'. */
  function download(v) {
    v = VARIANTS[v] ? v : variantOf();
    if (DL) return DL.p;
    var V = VARIANTS[v], prev = variantOf(), o = opts();
    LAST_ERR = '';
    var space = navigator.storage && navigator.storage.estimate ? navigator.storage.estimate().catch(function () { return null; }) : Promise.resolve(null);
    DL = { v: v, loaded: 0, total: V.bytes };
    DL.p = space.then(function (est) {
      if (est && est.quota && est.quota - (est.usage || 0) < V.bytes * 1.1) throw new Error('no_space');
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
      changed();
      return load(v);
    }).then(function () {
      o.on = true; o.v = v; saveOpts(o);
      // the other version, if there was one: deleted (only one is kept)
      return prev !== v ? removeModel(prev) : null;
    }).then(function () { DL = null; changed(); return selfTest(v); }).then(function (ok) {
      // the download is kept either way; a browser that can't run it is told so (and tries again when it updates)
      if (!ok) { LAST_ERR = 'browser_cant'; changed(); throw new Error('browser_cant'); }
      return true;
    }, function (e) {
      // the graphics can't even start it (some browsers fail here, not on the first search): same as a failed test
      if (e && e.message === 'stopped') { DL = null; changed(); throw e; }   // turned off while it downloaded or checked
      if (e && GPU_ERR.test(e.message || '')) { setCheck(v, false); o.on = true; o.v = v; saveOpts(o); e = new Error('browser_cant'); }
      DL = null; LAST_ERR = e && e.message || 'failed'; changed(); throw e;
    });
    changed();
    return DL.p;
  }
  function removeModel(v) {
    var V = VARIANTS[v];
    return cacheKeys().then(function (ks) { return Promise.all(ks.filter(function (x) { return x.k.url.indexOf('/ai/models/' + V.model + '/') >= 0; }).map(function (x) { return x.c.delete(x.k); })); });
  }
  /** Delete everything (model and runtime) and turn A.I. search off. */
  function remove() {
    stop(); DL = null; LAST_ERR = '';
    var o = opts(); o.on = false; saveOpts(o);
    return (window.caches ? caches.delete(CACHE).catch(function () {}) : Promise.resolve()).then(function () { changed(); });
  }

  // ---------- the student's own lists (the model may only pick from these) ----------
  function lists() {
    var D = window.FSD || {}, C = D.CLASSES || [], classes = [], teachers = [];
    C.forEach(function (c) { if (c.name && classes.indexOf(c.name) < 0) classes.push(c.name); if (c.teacher && teachers.indexOf(c.teacher) < 0) teachers.push(c.teacher); });
    return { classes: classes, teachers: teachers };
  }
  /** The model's answer for what the student typed: { kind: 'call', name, args } or { kind: 'refuse', lang }. */
  function ask(text) {
    var v = variantOf();
    return status().then(function (s) {
      if (!s.saved) { var e = new Error('not_saved'); throw e; }
      return load(v);
    }).then(function () { var L = lists(); return call({ t: 'ask', text: text, classes: L.classes, teachers: L.teachers, lang: lang() }); });
  }

  // ---------- running the search on what's on this device ----------
  var DAY = 864e5;
  function sod(ms) { var d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function weekStart(ms) { var s = sod(ms), d = new Date(s).getDay(); return s - ((d + 6) % 7) * DAY; }   // Monday
  function range(when, now) {
    var today = sod(now), ws = weekStart(now);
    return { today: [today, today + DAY], tomorrow: [today + DAY, today + 2 * DAY], this_week: [today, ws + 7 * DAY], next_week: [ws + 7 * DAY, ws + 14 * DAY], last_week: [ws - 7 * DAY, ws] }[when] || null;
  }
  var norm = function (s) { return String(s || '').toLowerCase().normalize('NFKD').replace(/\p{Mn}/gu, '').replace(/[^a-z0-9一-鿿]+/g, ' ').trim(); };
  var TITLES = /^(mr|mrs|ms|miss|mx|dr|prof|professor|sr|sra|srta|mme|mlle|m|herr|frau|coach|senor|senora|profe|profesor|profesora|teacher|老师)\s+/;
  function surname(n) { var w = norm(n).replace(TITLES, '').split(' ').filter(Boolean); return w.length ? w[w.length - 1] : ''; }
  function sameTeacher(want, who) { var a = surname(want); if (!a) return false; return (' ' + norm(who) + ' ').indexOf(' ' + a + ' ') >= 0; }
  function classesNamed(n) { var C = (window.FSD && window.FSD.CLASSES) || []; return C.filter(function (c) { return c.name === n || c.origName === n; }); }
  var CUTS = [[97, 'A+'], [93, 'A'], [90, 'A-'], [87, 'B+'], [83, 'B'], [80, 'B-'], [77, 'C+'], [73, 'C'], [70, 'C-'], [67, 'D+'], [63, 'D'], [60, 'D-'], [0, 'F']];
  var letterOf = function (p) { for (var i = 0; i < CUTS.length; i++) if (p >= CUTS[i][0]) return CUTS[i][1]; return 'F'; };
  function targetPct(s) {
    var m = /(\d{1,3}(?:[.,]\d+)?)\s*%?/.exec(String(s)); if (m) return Math.min(100, parseFloat(m[1].replace(',', '.')));
    var L = String(s).trim().toUpperCase().replace(/\s+/g, ''); for (var i = 0; i < CUTS.length; i++) if (CUTS[i][1] === L) return CUTS[i][0];
    return null;
  }
  var KIND_RE = { test: /\b(test|exam|midterm|final|assessment|examen|prueba|teste|prova|klausur|klassenarbeit|pr[üu]fung)\b|考试|测验/i, quiz: /\b(quiz|quizz?es|quizlet|cuestionario|interro)\b|小测/i,
    homework: /\b(homework|hw|worksheet|practice|tarea|deberes|devoirs?|exerc[ií]cios?|li[cç][aã]o|hausaufgaben?)\b|作业/i, project: /\b(project|proyecto|projet|projeto|projekt)\b|项目/i,
    essay: /\b(essay|paper|writing|ensayo|redacci[oó]n|dissertation|reda[cç][aã]o|aufsatz|essai)\b|作文|论文/i, lab: /\b(lab|labs|laboratory|laboratorio|laboratoire|labor)\b|实验/i };
  var FILE_EXT = { pdf: /^pdf$/, slides: /^(ppt|pptx|key|gslides|odp)$/, doc: /^(doc|docx|txt|rtf|gdoc|pages|odt)$/, sheet: /^(xls|xlsx|csv|gsheet|numbers|ods)$/, image: /^(png|jpe?g|gif|webp|heic|bmp|svg)$/ };
  function clsTile(c) {
    var ini = c ? (c.short || String(c.name || '?').slice(0, 2)) : '?';
    return '<span class="av-ai-cl" style="--c:' + esc((c && c.color) || '#6b7280') + '" aria-hidden="true">' + esc(String(ini).slice(0, 3)) + '</span>';
  }
  function row(o) {
    return '<button class="mi av-ai-r" data-go="' + esc(o.href) + '">' + (o.lead || '') + '<span class="tx"><b data-no-t>' + esc(o.t) + '</b>' + (o.sub ? '<small>' + esc(o.sub) + '</small>' : '') + '</span>' + (o.end ? '<span class="av-ai-end">' + o.end + '</span>' : '') + '</button>';
  }
  var dShort = function (ms) { var D = window.FSD; return ms ? (D && D.fmt && D.fmt.shortDate ? D.fmt.shortDate(ms) : new Date(ms).toLocaleDateString()) : ''; };
  var LABEL = {
    status: { due: 'Due', missing: 'Missing', turned_in: 'Turned in', graded: 'Graded' },
    when: { today: 'Today', tomorrow: 'Tomorrow', this_week: 'This week', next_week: 'Next week', last_week: 'Last week' },
    kind: { test: 'Tests', quiz: 'Quizzes', homework: 'Homework', project: 'Projects', essay: 'Essays', lab: 'Labs', pdf: 'PDFs', slides: 'Slides', doc: 'Documents', sheet: 'Spreadsheets', image: 'Images' },
    tool: { find_work: 'Work', find_grades: 'Grades', what_it_takes: 'What it takes', find_posts: 'Posts', find_messages: 'Messages', find_files: 'Files', open_page: 'Open', word_search: 'Words' },
  };
  /** What the model asked for, as short chips: Work · Missing · Chemistry */
  function chips(name, a) {
    var out = [LABEL.tool[name] || name];
    if (a.status && a.status !== 'any') out.push(LABEL.status[a.status]);
    if (a.kind && a.kind !== 'any') out.push(LABEL.kind[a.kind]);
    if (a.unread) out.push('Unread');
    if (name === 'find_grades' && a.show === 'gpa') out.push('GPA');
    if (name === 'find_grades' && a.show === 'scores') out.push('Scores');
    if (a.sort === 'lowest') out.push('Lowest first'); if (a.sort === 'highest') out.push('Highest first');
    if (a.when && a.when !== 'any') out.push(LABEL.when[a.when]);
    var named = [a['class'], a.teacher, a.target, a.assignment].filter(Boolean);
    return out.map(function (x) { return '<span class="av-ai-chip">' + esc(t(x)) + '</span>'; }).join('') + named.map(function (x) { return '<span class="av-ai-chip" data-no-t>' + esc(x) + '</span>'; }).join('');
  }

  /** { rows: html[], note, go, words } for a tool call */
  function run(c) {
    var D = window.FSD || {}, FSX = window.FSX, a = c.args || {}, now = Date.now(), C = D.C || {}, rows = [], note = '';
    var want = a['class'] ? classesNamed(a['class']).map(function (x) { return String(x.id); }) : null;
    var inClass = function (id) { return !want || want.indexOf(String(id)) >= 0; };
    if (c.name === 'word_search') return { words: a.text || '' };
    if (c.name === 'open_page') {
      var cl = want && want[0];
      if (a.page === 'class') return { go: cl ? FSX.hubUrl(cl) : FSX.url('courses') };
      if (cl && (a.page === 'grades' || a.page === 'assignments')) return { go: FSX.hubUrl(cl, a.page) };
      return { go: FSX.url(a.page || 'home') };
    }
    if (c.name === 'find_work') {
      var R = a.when && a.when !== 'any' ? range(a.when, now) : null, st = { due: 'due', missing: 'missing', turned_in: 'turned', graded: 'graded' }[a.status] || '';
      var W = (D.ASG || []).filter(function (x) {
        if (!inClass(x.c) || (st && x.st !== st)) return false;
        if (st === 'due' && x.dueAt && x.dueAt < now - 6e4 && !x.outside) return false;
        if (a.kind && a.kind !== 'any' && !(KIND_RE[a.kind].test(x.t) || (a.kind === 'test' && x.kind === 'test'))) return false;
        if (R) { var at = x.dueAt || x.gradedAt || x.turnedAt; if (!at || at < R[0] || at >= R[1]) return false; }
        return true;
      });
      W.sort(st === 'graded' ? function (x, y) { return (y.gradedAt || 0) - (x.gradedAt || 0); } : st === 'missing' ? function (x, y) { return (y.dueAt || 0) - (x.dueAt || 0); } : function (x, y) { return (x.dueAt || 9e15) - (y.dueAt || 9e15); });
      rows = W.slice(0, 30).map(function (x) {
        var cc = C[x.c], end = x.st === 'graded' && x.got != null ? esc(x.got + (x.pts ? '/' + x.pts : '')) : x.st === 'missing' ? '<span class="av-ai-tag bad">' + esc(t('Missing')) + '</span>' : x.st === 'turned' ? '<span class="av-ai-tag ok">' + esc(t('Turned in')) + '</span>' : '';
        return row({ href: FSX.hubUrl(x.c, '', { a: x.id }), lead: clsTile(cc), t: x.t, sub: (cc ? cc.name : '') + (x.dueAt ? ' · ' + t('Due') + ' ' + dShort(x.dueAt) + (x.time ? ', ' + x.time : '') : ''), end: end });
      });
      if (W.length > 30) note = W.length + ' found. Showing the first 30.';
    } else if (c.name === 'find_grades') {
      var list = (D.CLASSES || []).filter(function (x) { return !x.none && inClass(x.id); });
      if (a.show === 'gpa') {
        var G = window.AveragesGPA, g = G ? G.compute(list.map(function (x) { return { id: String(x.id), name: x.name, grade: letterOf(x.pct) }; })) : null;
        if (g && g.unweighted != null) rows = [row({ href: FSX.url('grades'), lead: '<span class="av-ai-cl" style="--c:#3e64b0" aria-hidden="true">GPA</span>', t: g.unweighted.toFixed(2) + ' GPA', sub: (g.weighted != null ? g.weighted.toFixed(2) + ' weighted · ' : '') + list.length + ' classes' })];
      } else if (a.show === 'scores') {
        var S = (D.WORK || []).filter(function (w) { return inClass(w.c) && w.got != null && w.of; });
        var pct = function (w) { return w.got / w.of * 100; };
        if (a.sort === 'lowest') S.sort(function (x, y) { return pct(x) - pct(y); }); else if (a.sort === 'highest') S.sort(function (x, y) { return pct(y) - pct(x); });
        rows = S.slice(0, 30).map(function (w) { var cc = C[w.c]; return row({ href: FSX.hubUrl(w.c, 'grades', { a: w.id }), lead: clsTile(cc), t: w.n, sub: (cc ? cc.name : '') + (w.on ? ' · ' + w.on : ''), end: esc(w.got + '/' + w.of) + ' <small>' + pct(w).toFixed(0) + '%</small>' }); });
      } else {
        if (a.sort === 'lowest') list.sort(function (x, y) { return x.pct - y.pct; }); else if (a.sort === 'highest') list.sort(function (x, y) { return y.pct - x.pct; });
        rows = list.map(function (x) { return row({ href: FSX.hubUrl(x.id, 'grades'), lead: clsTile(x), t: x.name, sub: x.teacher || '', end: esc(letterOf(x.pct)) + ' <small>' + x.pct.toFixed(1) + '%</small>' }); });
      }
    } else if (c.name === 'what_it_takes') {
      var k = want ? C[want[0]] : null, T = targetPct(a.target);
      if (!k || T == null) return { rows: [], note: "Couldn't tell which class or grade that's for." };
      var got = 0, of = 0; (D.WORK || []).forEach(function (w) { if (String(w.c) === String(k.id) && w.got != null && w.of) { got += w.got; of += w.of; } });
      var todo = (D.ASG || []).filter(function (x) { return String(x.c) === String(k.id) && (x.st === 'due' || x.st === 'missing') && x.pts; });
      if (a.assignment) {
        var an = norm(a.assignment), hit = todo.filter(function (x) { return norm(x.t).indexOf(an) >= 0 || an.indexOf(norm(x.t)) >= 0; });
        // "the next test": no title matches, so the soonest work of that kind
        if (!hit.length) { var kk = Object.keys(KIND_RE).filter(function (k2) { return KIND_RE[k2].test(a.assignment); })[0];
          if (kk) hit = todo.filter(function (x) { return KIND_RE[kk].test(x.t) || (kk === 'test' && x.kind === 'test'); }).sort(function (x, y) { return (x.dueAt || 9e15) - (y.dueAt || 9e15); }); }
        if (hit.length) todo = hit.slice(0, 1);
      }
      var rem = todo.reduce(function (s2, x) { return s2 + x.pts; }, 0), now2 = k.pct;
      var sub2 = [t('Goal: ' + a.target), t('Now: ' + now2.toFixed(1) + '%'), k.name].join(' · ');
      if (!rem || !of) rows = [row({ href: FSX.hubUrl(k.id, 'grades'), lead: clsTile(k), t: t('No points posted for upcoming work yet'), sub: sub2 })];
      else {
        var need = (T * (of + rem) - now2 * of) / rem, what = todo.length === 1 ? todo[0].t : t(todo.length + ' assignments still to come (' + rem + ' points)');
        var tt = need <= 0 ? t("You're already there") : need > 100 ? t('Not reachable with the points posted so far') : t('About ' + Math.ceil(need) + '% on ' + what);
        rows = [row({ href: todo.length === 1 ? FSX.hubUrl(k.id, '', { a: todo[0].id }) : FSX.hubUrl(k.id, 'grades'), lead: clsTile(k), t: tt, sub: (todo.length === 1 && need <= 100 && need > 0 ? '' : todo.length === 1 ? todo[0].t + ' · ' : '') + sub2 })];
        note = 'An estimate from points. Your teacher may weight categories differently.';
      }
    } else if (c.name === 'find_posts') {
      var since = a.when === 'today' ? sod(now) : a.when === 'this_week' ? now - 7 * DAY : 0;
      var P = (D.updates || []).filter(function (u) { return inClass(u.courseId) && (!a.teacher || sameTeacher(a.teacher, u.from)) && (!since || (u.at || 0) >= since); });
      P.sort(function (x, y) { return (y.at || 0) - (x.at || 0); });
      rows = P.slice(0, 30).map(function (u) { var cc = C[u.courseId], b = String(u.body || '').replace(/\s+/g, ' ').trim(); return row({ href: FSX.hubUrl(u.courseId, 'updates', { update: u.id }), lead: clsTile(cc), t: b.length > 90 ? b.slice(0, 88) + '…' : b, sub: (u.from || '') + (u.when ? ' · ' + u.when : '') + (cc ? ' · ' + cc.name : '') }); });
    } else if (c.name === 'find_messages') {
      var seen = FSX.seen, M = (D.messages || []).filter(function (m) { return (!a.teacher || sameTeacher(a.teacher, m.from)) && (!a.unread || (m.unread && !(seen && seen.has('m', m.id)))); });
      rows = M.slice(0, 30).map(function (m) { return row({ href: FSX.url('messages', { thread: m.id }), lead: FSX.personAv ? FSX.personAv({ name: m.from, teacher: true }) : '', t: m.subject || m.preview || t('(No subject)'), sub: (m.from || '') + (m.time ? ' · ' + m.time : ''), end: m.unread ? '<span class="unread" aria-label="Unread"></span>' : '' }); });
    } else if (c.name === 'find_files') {
      var since2 = a.when === 'today' ? sod(now) : a.when === 'this_week' ? now - 7 * DAY : 0, re = a.kind && a.kind !== 'any' ? FILE_EXT[a.kind] : null;
      var F = ((D.raw && D.raw.files && D.raw.files.files) || []).filter(function (f) { return f && inClass(f.course) && (!re || re.test(String(f.ext || '').toLowerCase())) && (!since2 || (f.at || 0) >= since2); });
      F.sort(function (x, y) { return (y.at || 0) - (x.at || 0); });
      rows = F.slice(0, 30).map(function (f) { var cc = C[f.course]; return row({ href: FSX.hubUrl(f.course, 'materials/x' + f.id), lead: clsTile(cc), t: f.name, sub: (cc ? cc.name : '') + (f.at ? ' · ' + dShort(f.at) : '') + (f.parentTitle ? ' · ' + f.parentTitle : '') }); });
    }
    return { rows: rows, note: note };
  }

  // ---------- search anything: the "Ask A.I." row and its answer ----------
  // the A.I. search mascot, "A buddy" (handoff/icons/mascot.svg, 2026-11-15): the Averages A with two eyes, one color.
  // The eyes are cut out with evenodd instead of the file's mask, so many copies on a page don't share a mask id.
  // the A.I. mascot, "A buddy" (handoff/icons/mascot.svg): the Averages A with two eyes, one color (currentColor)
  var AI_SVG = '<svg class="av-ai-ic" viewBox="0 0 24 24" aria-hidden="true"><mask id="avAiEyes"><rect width="24" height="24" fill="#fff"/><rect x="9.4" y="10.6" width="1.9" height="3.4" rx=".95" fill="#000"/><rect x="12.7" y="10.6" width="1.9" height="3.4" rx=".95" fill="#000"/></mask><path mask="url(#avAiEyes)" fill="currentColor" d="M12 2.5c.8 0 1.5.5 1.8 1.2l6.9 16.1a1.6 1.6 0 0 1-1.5 2.2h-2.4a1.6 1.6 0 0 1-1.5-1l-1-2.6H9.7l-1 2.6a1.6 1.6 0 0 1-1.5 1H4.8a1.6 1.6 0 0 1-1.5-2.2l6.9-16.1c.3-.7 1-1.2 1.8-1.2z"/></svg>';
  var QWORD = /[?¿？]|^(what|whats|what's|when|where|who|which|why|how|is|are|am|do|does|did|can|show|find|list|any|qu[eé]|cu[aá]ndo|d[oó]nde|qui[eé]n|cu[aá]l|c[oó]mo|tengo|hay|my|mis|mi|mes|mon|ma|meus|minhas|meu|minha|meine|mein|open|abrir|ouvrir|öffne|quoi|quand|o[uù]|qui|quel|quelle|est-ce|ai-je|o que|quando|onde|quem|qual|tenho|was|wann|wo|wer|welche|habe|gibt)\b|什么|什麼|哪|谁|吗|嗎|有没有|我的|打开/i;
  var looksAsked = function (q) { return QWORD.test(q.trim()) || q.trim().split(/\s+/).length >= 4; };
  var STATE = { ok: null, saved: false, skip: '' };   // skip: words the student chose to search as words
  var autoTried = false;
  function refresh() {
    if (!window.FSD || !window.FSD.me || !window.FSD.me.uid) return Promise.resolve();
    return offered().then(function (o) {
      STATE.ok = o.ok && !o.potato;
      if (!o.ok) return;
      return status().then(function (s) {
        STATE.saved = s.on && s.saved && !s.blocked;
        // turned on and saved, but not tested in this browser yet (it updated, or the test never ran): test it now
        // (once per page, so a check that fails for another reason doesn't keep starting over)
        if (s.on && s.saved && !s.works && !s.blocked && !s.busy && !autoTried) { autoTried = true; selfTest(s.v).catch(function () {}); }
      });
    }).catch(function () { STATE.ok = false; });
  }
  window.addEventListener('avai:state', function () { refresh(); });

  function boxes() {
    var out = [];
    var cm = document.querySelector('.cmdk .cmdk-res'); if (cm) out.push({ res: cm, input: document.querySelector('.cmdk input'), kind: 'cmdk' });
    var hp = document.querySelector('.pop.spop'), big = document.getElementById('bigInput'); if (hp && big) out.push({ res: hp, input: big, kind: 'home' });
    return out;
  }
  function inject() {
    if (!STATE.ok) return;
    boxes().forEach(function (b) {
      if (!b.input || b.res.querySelector('.av-ai-row, .av-ai-panel')) return;
      var q = (b.input.value || '').trim(); if (q.length < 2 || q === STATE.skip) return;
      var asked = looksAsked(q);
      var html = STATE.saved
        ? '<button class="mi s-cmd av-ai-row" data-avai="ask">' + AI_SVG + '<span class="tx"><b>' + esc(t('Ask A.I.')) + '</b><small data-no-t>“' + esc(q.slice(0, 120)) + '”</small></span></button>'
        : asked ? '<button class="mi s-cmd av-ai-row" data-go="' + esc(window.FSX.url('settings', { section: 'ai' })) + '">' + AI_SVG + '<span class="tx"><b>' + esc(t('Search with A.I.')) + '</b><small>' + esc(t('Set it up in Settings. It runs on this device.')) + '</small></span></button>' : '';
      if (!html) return;
      var foot = b.res.querySelector(':scope > .pop-foot'), first = asked && STATE.saved;
      var tmp = document.createElement('div'); tmp.innerHTML = html; var el = tmp.firstChild;
      if (first) {
        var lead = b.res.querySelector(':scope > .s-fix'); b.res.insertBefore(el, lead ? lead.nextSibling : b.res.firstChild);
        b.res.querySelectorAll('.mi.sel').forEach(function (x) { x.classList.remove('sel'); }); el.classList.add('sel');
      } else b.res.insertBefore(el, foot || null);
      var empty = b.res.querySelector(':scope > .cmdk-empty, :scope > .s-empty'); if (empty && STATE.saved) { empty.remove(); el.classList.add('sel'); }
    });
  }
  var injT = 0;
  function soon() { if (!injT) injT = requestAnimationFrame(function () { injT = 0; inject(); }); }
  new MutationObserver(soon).observe(document.documentElement, { childList: true, subtree: true });

  var turn = 0;
  function panel(b, html) {
    var foot = b.res.querySelector(':scope > .pop-foot');
    b.res.innerHTML = '<div class="av-ai-panel">' + html + '</div>' + (foot ? foot.outerHTML : '');
    var f = b.res.querySelector('.av-ai-panel .mi'); if (f) f.classList.add('sel');
  }
  function answer(b, q) {
    var my = ++turn;
    var still = function () { return my === turn && b.res.isConnected && (b.input.value || '').trim() === q; };
    panel(b, '<div class="av-ai-wait"><span class="av-ai-load" aria-hidden="true"></span><span>' + esc(t(ready ? 'Thinking on this device…' : 'Starting A.I. on this device…')) + '</span></div>');
    ask(q).then(function (r) {
      if (!still()) return;
      var words = '<button class="mi s-cmd av-ai-words" data-avai="words"><svg class="i"><use href="#i-search"/></svg><span class="tx"><b>' + esc(t('Search for the words instead')) + '</b><small data-no-t>“' + esc(q.slice(0, 120)) + '”</small></span></button>';
      var foot = '<p class="av-ai-note">' + esc(t('A.I. can be wrong. It ran on this device; nothing you typed was sent anywhere.')) + '</p>';
      if (r.kind !== 'call') { panel(b, '<div class="av-ai-say">' + AI_SVG + '<span>' + esc(t("I can only search your classes, grades, work, posts, messages and files.")) + '</span></div>' + words + foot); return; }
      var out = run(r);
      if (out.go) { window.location.href = out.go; return; }
      if (out.words != null) { STATE.skip = out.words; b.input.value = out.words; b.input.dispatchEvent(new Event('input', { bubbles: true })); return; }
      var head = '<div class="lbl av-ai-h">' + AI_SVG + chips(r.name, r.args || {}) + '</div>';
      var body = out.rows.length ? out.rows.join('') : '<div class="cmdk-empty">' + esc(t('Nothing found for that.')) + '</div>';
      panel(b, head + body + (out.note ? '<p class="av-ai-note">' + esc(t(out.note)) + '</p>' : '') + words + foot);
    }).catch(function (e) {
      if (!still()) return;
      var gpu = e && GPU_ERR.test(e.message || '');
      if (gpu) { setCheck(variantOf(), false); stop(); changed(); }
      var m = e && e.message === 'not_saved' ? 'A.I. search needs its download again. Turn it on in Settings.'
        : gpu ? "This browser can't run A.I. search yet. Try Chrome or Edge. It tries again when this browser updates." : "A.I. search didn't work just now. Try again, or search for the words.";
      panel(b, '<div class="av-ai-say">' + AI_SVG + '<span>' + esc(t(m)) + '</span></div><button class="mi s-cmd av-ai-words" data-avai="words"><svg class="i"><use href="#i-search"/></svg><span class="tx"><b>' + esc(t('Search for the words instead')) + '</b></span></button>');
      if (window.console) console.warn('[ai]', e);
    });
  }
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-avai]'); if (!el) return;
    var b = boxes().filter(function (x) { return x.res.contains(el); })[0]; if (!b) return;
    e.preventDefault(); e.stopImmediatePropagation();
    var q = (b.input.value || '').trim();
    if (el.dataset.avai === 'ask') { answer(b, q); b.input.focus({ preventScroll: true }); }
    else if (el.dataset.avai === 'words') { STATE.skip = q; turn++; b.input.dispatchEvent(new Event('input', { bubbles: true })); b.input.focus({ preventScroll: true }); }
  }, true);
  // typing again: back to the normal results (the page redraws them), and the A.I. row may come back
  document.addEventListener('input', function (e) { if (e.target && (e.target.id === 'bigInput' || e.target.id === 'cmdkInput') && (e.target.value || '').trim() !== STATE.skip) STATE.skip = ''; }, true);

  var css = document.createElement('style');
  css.textContent = [
    '.av-ai-ic{width:22px;height:22px;flex:none;margin:0 7px;color:var(--ink)}',
    '.av-ai-cl{flex:none;display:grid;place-items:center;width:30px;height:30px;border-radius:9px;background:var(--c);color:#fff;font-size:11px;font-weight:800;letter-spacing:.02em}',
    '.av-ai-panel{display:flex;flex-direction:column;gap:2px}',
    '.av-ai-h{display:flex!important;flex-wrap:wrap;align-items:center;gap:6px;text-transform:none!important;letter-spacing:0!important}',
    '.av-ai-h .av-ai-ic{width:18px;height:18px;margin:0 2px 0 0}',
    '.av-ai-chip{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:11px;background:var(--panel,#eef0f4);box-shadow:inset 0 0 0 1px var(--inner,#e2e4ea);color:var(--ink);font-size:12px;font-weight:700}',
    '.av-ai-end{flex:none;font-weight:800;color:var(--ink);white-space:nowrap}.av-ai-end small{color:var(--muted);font-weight:700;margin-left:4px}',
    '.av-ai-tag{display:inline-block;padding:2px 8px;border-radius:9px;font-size:12px;font-weight:800}.av-ai-tag.bad{background:color-mix(in srgb,#d0393e 14%,transparent);color:#b3261e}.av-ai-tag.ok{background:color-mix(in srgb,#2e7d4f 14%,transparent);color:#22653f}',
    '.av-ai-wait,.av-ai-say{display:flex;align-items:center;gap:6px;min-height:52px;padding:8px 12px;font-weight:700;color:var(--ink)}',
    // waiting: the mascot in the logo's colors (#E5484D, with the loading logo's #FF7A50 glow) sweeping up through it;
    // reduced motion blinks instead, Potato mode stays still
    '.av-ai-load{flex:none;width:22px;height:22px;margin:0 7px;background:linear-gradient(to top,#E5484D 0%,#E5484D 30%,#FF7A50 45%,#FFB08F 50%,#FF7A50 55%,#E5484D 70%,#E5484D 100%) 0 0/100% 300% no-repeat;' +
      "-webkit-mask:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill-rule='evenodd' d='M12 2.5c.8 0 1.5.5 1.8 1.2l6.9 16.1a1.6 1.6 0 0 1-1.5 2.2h-2.4a1.6 1.6 0 0 1-1.5-1l-1-2.6H9.7l-1 2.6a1.6 1.6 0 0 1-1.5 1H4.8a1.6 1.6 0 0 1-1.5-2.2l6.9-16.1c.3-.7 1-1.2 1.8-1.2zM10.35 10.6a.95.95 0 0 1 .95.95v1.5a.95.95 0 0 1-1.9 0v-1.5a.95.95 0 0 1 .95-.95zM13.65 10.6a.95.95 0 0 1 .95.95v1.5a.95.95 0 0 1-1.9 0v-1.5a.95.95 0 0 1 .95-.95z'/%3E%3C/svg%3E\") center/contain no-repeat;mask:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill-rule='evenodd' d='M12 2.5c.8 0 1.5.5 1.8 1.2l6.9 16.1a1.6 1.6 0 0 1-1.5 2.2h-2.4a1.6 1.6 0 0 1-1.5-1l-1-2.6H9.7l-1 2.6a1.6 1.6 0 0 1-1.5 1H4.8a1.6 1.6 0 0 1-1.5-2.2l6.9-16.1c.3-.7 1-1.2 1.8-1.2zM10.35 10.6a.95.95 0 0 1 .95.95v1.5a.95.95 0 0 1-1.9 0v-1.5a.95.95 0 0 1 .95-.95zM13.65 10.6a.95.95 0 0 1 .95.95v1.5a.95.95 0 0 1-1.9 0v-1.5a.95.95 0 0 1 .95-.95z'/%3E%3C/svg%3E\") center/contain no-repeat;animation:avAiUp 1.2s cubic-bezier(.45,0,.35,1) infinite}",
    '@keyframes avAiUp{from{background-position:0 0}to{background-position:0 100%}}',
    '@keyframes avAiBlink{0%,100%{opacity:1}50%{opacity:.35}}',
    '@media (prefers-reduced-motion:reduce){.av-ai-load{animation:avAiBlink 1.4s ease-in-out infinite;background:#E5484D}}',
    '.potato-mode .av-ai-load{animation:none;background:#E5484D}',
    '.av-ai-note{margin:4px 12px 6px;color:var(--muted);font-size:12px;font-weight:600}',
  ].join('');
  (document.head || document.documentElement).appendChild(css);

  window.AvAI = { retest: function () { try { LS.removeItem(CHECK); } catch (e) { /* off */ } return selfTest(variantOf()); }, VARIANTS: VARIANTS, mb: mb, offered: offered, status: status, download: download, remove: remove, ask: ask, run: run, variant: variantOf, lists: lists, _state: STATE };
  // only once the page has the student's data (never on the sign-in page: /config/features there would be a 401)
  if (window.FSD && window.FSD.me && window.FSD.me.uid) refresh();
  window.addEventListener('fs:ready', refresh);
})();
