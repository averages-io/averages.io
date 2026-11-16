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
    // the page's own class badge (its emoji on the class color), the same as everywhere else in search; every page
    // defines badge() at the top level of its script. The initials tile is only for a page without one.
    try { if (c && typeof badge === 'function') return badge(c); } catch (e) { /* fall back */ }
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
    if (a.status && a.status !== 'any') out.push(a.status === 'missing' && a.late ? 'Late' : LABEL.status[a.status]);
    if (a.kind && a.kind !== 'any') out.push(LABEL.kind[a.kind]);
    if (a.unread) out.push('Unread');
    if (name === 'find_grades' && a.show === 'gpa') out.push('GPA');
    if (name === 'find_grades' && a.show === 'scores') out.push('Scores');
    if (a.sort === 'lowest') out.push('Lowest first'); if (a.sort === 'highest') out.push('Highest first');
    if (a.when && a.when !== 'any') out.push(LABEL.when[a.when]);
    var named = [a.letter ? a.letter + 's' : '', a['class'], a.teacher, a.target, a.assignment].filter(Boolean);
    return out.map(function (x) { return '<span class="av-ai-chip">' + esc(t(x)) + '</span>'; }).join('') + named.map(function (x) { return '<span class="av-ai-chip" data-no-t>' + esc(x) + '</span>'; }).join('');
  }

  /** { rows: html[], note, go, words } for a tool call */
  // ---------- second checks on the model's choice, with what the student actually typed ----------
  // A class or teacher the student never named is dropped (results get wider, never wrong): the model sometimes
  // fills one in from the list ("how many assignments have a B" came back as AP Human Geog A, Martin 2026-11-15).
  var GENERIC = { the: 1, and: 1, ap: 1, ib: 1, honors: 1, hon: 1, i: 1, ii: 1, iii: 1, iv: 1, v: 1, period: 1, class: 1, course: 1, intro: 1, introduction: 1, to: 1, of: 1, advanced: 1, placement: 1, a: 1, b: 1, c: 1, sem: 1, semester: 1, s1: 1, s2: 1 };
  // the same subject in the app's other languages (the class is usually named in English)
  var SUBJ = [
    [/chem/, /qu[ií]mic|chimi|chemie|化学/], [/bio/, /biolog|生物/], [/physic/, /f[ií]sic|physik|physique|物理/],
    [/math|algebra|geometr|calcul|statist|precal|trig/, /matem|math[eé]|mathe|[aá]lgebra|alg[eè]bre|geometr|g[eé]om[eé]tr|c[aá]lculo|calcul|estad[ií]stic|statisti|数学|代数|几何|微积分|统计/],
    [/hist/, /histori|histoire|geschicht|历史/], [/english|literat|lang/, /ingl[eé]s|anglais|englisch|literat|英语|英文|语文/],
    [/spanish/, /espa[nñ]ol|espagnol|espanhol|spanisch|西班牙/], [/french/, /franc[eé]s|fran[cç]ais|franc[eê]s|franz[oö]sisch|法语/],
    [/german/, /alem[aã]n|allemand|deutsch|德语/], [/chinese|mandarin/, /chino|chinois|chin[eê]s|chinesisch|中文|汉语/],
    [/geog/, /geogra|g[eé]ograph|地理/], [/gov|civic|politic/, /gobierno|gouvernement|governo|regierung|c[ií]vic|politi|政府|政治/],
    [/econ/, /econom|[eé]conom|ökonom|wirtschaft|经济/], [/psych/, /psicolog|psycholog|心理/], [/art|draw|paint|design/, /arte|art|kunst|dibujo|dessin|desenho|美术|艺术/],
    [/music|band|choir|orchestra/, /m[uú]sic|musique|musik|banda|coro|chorale|chor|orquest|orchest|音乐|乐队|合唱/],
    [/\bpe\b|physical ed|fitness|gym|health/, /educaci[oó]n f[ií]sica|[eé]ducation physique|eps|educa[cç][aã]o f[ií]sica|sport|turnen|salud|sant[eé]|sa[uú]de|gesundheit|体育|健康/],
    [/computer|programming|coding|\bcs\b/, /inform[aá]tic|computaci|programaci|programma|informatique|computa[cç]|informatik|计算机|编程/],
  ];
  function named(name, q) {
    var qn = norm(q), qw = qn.split(' ').filter(function (w) { return w.length >= 3; });
    var nw = norm(name).split(' ').filter(function (w) { return w.length >= 2 && !GENERIC[w]; });
    if (!nw.length) return true;   // nothing to check it by
    if (nw.some(function (w) { return qw.some(function (x) { return w.indexOf(x) === 0 || x.indexOf(w.slice(0, 4)) === 0; }); })) return true;
    var ln = String(name).toLowerCase(), lq = String(q).toLowerCase();
    return SUBJ.some(function (p) { return p[0].test(ln) && p[1].test(lq); });
  }
  // a letter grade the student asked about: "have a B", "how many As", "any A's", "B+ grades", "with an A-"
  function letterAsked(q) {
    var m = /(?:\b(?:a|an|any|many|all|my|got|get|have|has|had|with|earned|of|gotten|un|una|des|um|uma|eine?n?)\s+|^)([ABCDF][+-]?)(?:'?s)?(?=$|[\s?.,!])/.exec(q) || /(?:^|\s)([ABCDF][+-]?)(?:'?s)?\s+(?:[Gg]rades?|as a grade|[Nn]otas?|[Nn]otes?|[Nn]oten?|成绩)/.exec(q);
    if (!m) return '';
    var L = m[1];
    // "A list of..." at the start is a word, not a grade
    if (L === 'A' && m.index === 0 && !/^A'?s\b|^A\s+(grade|grades)\b/.test(q)) return '';
    return L;
  }
  function letterIs(L, pct) { var got = letterOf(pct); return L.length === 2 ? got === L : got.charAt(0) === L; }
  function sanitize(c, q) {
    var a = Object.assign({}, c.args || {});
    if (a['class'] && q && !named(a['class'], q)) delete a['class'];
    if (a.teacher && q && !named(a.teacher, q)) delete a.teacher;
    // filters the student never asked for: "what have my teachers texted me" came back as unread only (Martin 2026-11-15)
    if (a.unread && q && !/unread|\bnew\b|haven'?t (read|seen|opened)|not (read|seen|opened)|didn'?t (read|see|open)|sin leer|no le[ií]d|nuev[oa]s?|non lus?|nouveaux?|nouvelles?|n[aã]o lid|nov[oa]s?|ungelesen|neue?n?|未读|新/i.test(q)) delete a.unread;
    if (a.when && a.when !== 'any' && q && !/today|tonight|tomorrow|week|yesterday|\bnow\b|soon|hoy|ma[nñ]ana|semana|esta noche|aujourd|demain|semaine|ce soir|hoje|amanh[aã]|heute|morgen|woche|今天|明天|昨天|本周|这周|下周|上周|星期|礼拜|今晚/i.test(q)) delete a.when;
    var name = c.name, L = q ? letterAsked(q) : '';
    // "assignment with the highest grade" is about pieces of work, not classes (the model answered with classes)
    if (name === 'find_grades' && (!a.show || a.show === 'grade') && q && /\b(assignments?|tests?|quiz(z?es)?|homework|essays?|labs?|projects?|scores?|tareas?|trabajos?|ex[aá]men(es)?|devoirs?|contr[oô]les?|tarefas?|provas?|aufgaben?|arbeiten?|klausuren?)\b|作业|考试|测验/i.test(q) && !/\b(class|classes|course|courses|clase|clases|cours|aula|aulas|kurs|kurse)\b|课/i.test(q)) a.show = 'scores';
    // the model has one status for both; the words tell them apart
    if (name === 'find_work' && a.status === 'missing') a.late = /\b(late|overdue|past due|behind|tarde|atrasad[oa]s?|vencid[oa]s?|retard|en retard|verspätet|überfällig|zu spät)\b|逾期|迟交|过期/i.test(q || '');
    // grades by letter aren't something the model can ask for: answered here, from the scores
    // only for questions about pieces of work ("do I have an A in chem" is the class's grade, and stays that)
    var aboutWork = (name === 'find_grades' && a.show === 'scores') || /assignments?|scores?|tests?|quiz|homework|how many|which|tareas?|trabajos?|ex[aá]men|devoirs?|contr[oô]les?|tarefas?|trabalhos?|provas?|aufgaben|arbeiten|tests|作业|考试|测验|哪些|多少/i.test(q || '');
    if (L && aboutWork && (name === 'find_grades' || (name === 'find_work' && (!a.status || a.status === 'graded' || a.status === 'any')))) { name = 'find_grades'; a = { 'class': a['class'], show: 'scores', sort: a.sort }; if (!a['class']) delete a['class']; if (!a.sort) delete a.sort; a.letter = L; }
    return { name: name, args: a };
  }

  // ---------- data a page didn't load (Messages and Files only load on some pages) ----------
  // The same answers the pages keep (sessionStorage averages_extras_<key>, 5 minutes), so it's asked for once.
  var EXTRA = { messages: ['/messages', 'messages'], files: ['/data/files', 'fs_files'] };
  function extraData(kind) {
    var D = window.FSD || {}, me = D.me && D.me.uid, E = EXTRA[kind];
    if (kind === 'messages' && D.raw && D.raw.messages && Array.isArray(D.raw.messages.CONVERSATIONS)) return Promise.resolve(D.raw.messages);
    if (kind === 'files' && D.raw && D.raw.files && Array.isArray(D.raw.files.files)) return Promise.resolve(D.raw.files);
    if (!E || !window.FSX) return Promise.resolve(null);
    try { var c = JSON.parse(sessionStorage.getItem('averages_extras_' + E[1]) || 'null'); if (c && c.data && c.who === me && Date.now() - (c.at || 0) < 5 * 6e4) return Promise.resolve(c.data); } catch (e) { /* unreadable */ }
    return window.FSX.api(E[0]).then(function (d) {
      try { sessionStorage.setItem('averages_extras_' + E[1], JSON.stringify({ at: Date.now(), who: me, data: d })); } catch (e) { /* full */ }
      return d;
    }).catch(function () { return null; });
  }
  var NEEDS = { find_messages: 'messages', find_files: 'files' };

  function run(c, q, extra) {
    c = sanitize(c, q);
    var D = window.FSD || {}, FSX = window.FSX, a = c.args || {}, now = Date.now(), C = D.C || {}, rows = [], note = '', lead = '';
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
        // "missing" is what the teacher marked missing; work that's only past due is "late" (asked for by name)
        if (st === 'missing' && a.late !== undefined && (a.late ? x.marked : !x.marked)) return false;
        if (st === 'due' && x.dueAt && x.dueAt < now - 6e4 && !x.outside) return false;
        if (a.kind && a.kind !== 'any' && !(KIND_RE[a.kind].test(x.t) || (a.kind === 'test' && x.kind === 'test'))) return false;
        if (R) { var at = x.dueAt || x.gradedAt || x.turnedAt; if (!at || at < R[0] || at >= R[1]) return false; }
        return true;
      });
      W.sort(st === 'graded' ? function (x, y) { return (y.gradedAt || 0) - (x.gradedAt || 0); } : st === 'missing' ? function (x, y) { return (y.dueAt || 0) - (x.dueAt || 0); } : function (x, y) { return (x.dueAt || 9e15) - (y.dueAt || 9e15); });
      rows = W.slice(0, 30).map(function (x) {
        var cc = C[x.c], end = x.st === 'graded' && x.got != null ? esc(x.got + (x.pts ? '/' + x.pts : '')) : x.st === 'missing' ? '<span class="av-ai-tag bad">' + esc(t(x.marked ? 'Missing' : 'Late')) + '</span>' : x.st === 'turned' ? '<span class="av-ai-tag ok">' + esc(t('Turned in')) + '</span>' : '';
        return row({ href: FSX.hubUrl(x.c, '', { a: x.id }), lead: clsTile(cc), t: x.t, sub: (cc ? cc.name : '') + (x.dueAt ? ' · ' + t('Due') + ' ' + dShort(x.dueAt) + (x.time ? ', ' + x.time : '') : ''), end: end });
      });
      if (W.length > 30) note = W.length + ' found. Showing the first 30.';
      // nothing marked missing, but some work is past due: say so (the student may mean that)
      if (st === 'missing' && !a.late && !W.length) {
        var late = (D.ASG || []).filter(function (x) { return inClass(x.c) && x.st === 'missing' && !x.marked; }).length;
        if (late) lead = late === 1 ? 'Nothing is marked missing. 1 assignment is late (past due and not turned in). Ask for late work to see it.' : 'Nothing is marked missing. ' + late + ' assignments are late (past due and not turned in). Ask for late work to see them.';
      }
    } else if (c.name === 'find_grades') {
      var list = (D.CLASSES || []).filter(function (x) { return !x.none && inClass(x.id); });
      if (a.show === 'gpa') {
        var G = window.AveragesGPA, g = G ? G.compute(list.map(function (x) { return { id: String(x.id), name: x.name, grade: letterOf(x.pct) }; })) : null;
        if (g && g.unweighted != null) rows = [row({ href: FSX.url('grades'), lead: '<span class="av-ai-cl" style="--c:#3e64b0" aria-hidden="true">GPA</span>', t: g.unweighted.toFixed(2) + ' GPA', sub: (g.weighted != null ? g.weighted.toFixed(2) + ' weighted · ' : '') + list.length + ' classes' })];
      } else if (a.show === 'scores') {
        var pct = function (w) { return w.got / w.of * 100; };
        var S = (D.WORK || []).filter(function (w) { return inClass(w.c) && w.got != null && w.of && (!a.letter || letterIs(a.letter, pct(w))); });
        var count = S.length;
        if (a.sort === 'lowest') S.sort(function (x, y) { return pct(x) - pct(y); }); else if (a.sort === 'highest') S.sort(function (x, y) { return pct(y) - pct(x); });
        rows = S.slice(0, 30).map(function (w) { var cc = C[w.c]; return row({ href: FSX.hubUrl(w.c, 'grades', { a: w.id }), lead: clsTile(cc), t: w.n, sub: (cc ? cc.name : '') + (w.on ? ' · ' + w.on : ''), end: esc(w.got + '/' + w.of) + ' <small>' + pct(w).toFixed(0) + '% ' + esc(letterOf(pct(w))) + '</small>' }); });
        if (a.letter) lead = count === 1 ? '1 graded assignment with ' + (a.letter.charAt(0) === 'A' || a.letter.charAt(0) === 'F' ? 'an ' : 'a ') + a.letter + '.' : count + ' graded assignments with ' + (a.letter.charAt(0) === 'A' || a.letter.charAt(0) === 'F' ? 'an ' : 'a ') + a.letter + '.';
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
      var seen = FSX.seen, M;
      if (extra && Array.isArray(extra.CONVERSATIONS)) {
        // Schoology's conversations (the same list the Messages page shows): who it's with, by name
        var PPL = extra.PEOPLE || {}, me = String(extra.me || '');
        M = extra.CONVERSATIONS.filter(function (x) { return x && x.id; }).map(function (x) {
          var ids = (x.participants || []).map(String).filter(function (id) { return id && id !== me; }); if (!ids.length && x.personId) ids = [String(x.personId)];
          var names = ids.map(function (id) { return (PPL[id] || {}).name || ''; }).filter(Boolean);
          return { id: String(x.id), from: names.join(', ') || 'Someone in Schoology', subject: x.subject || '', preview: x.preview || '', unread: !!x.unread, time: x.at ? dShort(x.at) : '', at: x.at || 0 };
        });
      } else M = D.messages || [];
      M = M.filter(function (m) { return (!a.teacher || sameTeacher(a.teacher, m.from)) && (!a.unread || (m.unread && !(seen && seen.has('m', m.id)))); });
      M.sort(function (x, y) { return (y.at || 0) - (x.at || 0); });
      rows = M.slice(0, 30).map(function (m) { return row({ href: FSX.url('messages', { thread: m.id }), lead: FSX.personAv ? FSX.personAv({ name: m.from, teacher: true }) : '', t: m.subject || m.preview || t('(No subject)'), sub: (m.from || '') + (m.time ? ' · ' + m.time : ''), end: m.unread ? '<span class="unread" aria-label="Unread"></span>' : '' }); });
    } else if (c.name === 'find_files') {
      var since2 = a.when === 'today' ? sod(now) : a.when === 'this_week' ? now - 7 * DAY : 0, re = a.kind && a.kind !== 'any' ? FILE_EXT[a.kind] : null;
      var F = ((extra && extra.files) || (D.raw && D.raw.files && D.raw.files.files) || []).filter(function (f) { return f && inClass(f.course) && (!re || re.test(String(f.ext || '').toLowerCase())) && (!since2 || (f.at || 0) >= since2); });
      F.sort(function (x, y) { return (y.at || 0) - (x.at || 0); });
      rows = F.slice(0, 30).map(function (f) { var cc = C[f.course]; return row({ href: FSX.hubUrl(f.course, 'materials/x' + f.id), lead: clsTile(cc), t: f.name, sub: (cc ? cc.name : '') + (f.at ? ' · ' + dShort(f.at) : '') + (f.parentTitle ? ' · ' + f.parentTitle : '') }); });
    }
    return { rows: rows, note: note, lead: lead, call: c };
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
      // Home with no results: the tabs are all 0, so they go too (they left an empty band under the A.I. row)
      var tabs = b.res.querySelector(':scope > .s-tabs');
      if (tabs && STATE.saved && ![].some.call(tabs.querySelectorAll('.ct'), function (x) { return +x.textContent > 0; })) tabs.remove();
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
  // what each search finds, for the line at the top: "6 assignments"
  var NOUN = { find_work: ['assignment', 'assignments'], scores: ['graded assignment', 'graded assignments'], grade: ['class', 'classes'], gpa: ['GPA', 'GPA'],
    what_it_takes: ['estimate', 'estimates'], find_posts: ['post', 'posts'], find_messages: ['conversation', 'conversations'], find_files: ['file', 'files'] };
  var calmNow = function () { return potato() || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); };
  // While it works (like Siri's "Working… Searching events… Reviewing results", Martin 2026-11-15): the results
  // shrink to a small dark pill with a spinning ring of dots and a status that shimmers and changes as it goes.
  // When the answer is ready the pill opens out into it.
  var SEARCHING = { find_work: 'Searching assignments', find_grades: 'Searching grades', what_it_takes: 'Working out your grade',
    find_posts: 'Searching posts', find_messages: 'Searching messages', find_files: 'Searching files', open_page: 'Opening it', word_search: 'Searching' };
  // the search box's dropdown (or the Ctrl K window around the field) steps back while it works, so only the pill shows
  function floatBox(b, on) {
    var box = b.kind === 'cmdk' ? b.res.closest('.cmdk') : b.res;
    if (box) box.classList.toggle('av-ai-float', !!on);
    if (on) dim(b, box);
  }
  // everything but the search field greys out while it works: a dark layer with a hole where the field is (a big
  // shadow around a box the field's size), under the pill. Ctrl K already darkens the page behind its window.
  function dim(b, box) {
    if (b.kind !== 'home' || document.querySelector('.av-ai-dim')) return;
    var field = b.input.closest('label') || b.input, d = document.createElement('div');
    d.className = 'av-ai-dim'; d.setAttribute('aria-hidden', 'true');
    var place = function () { var r = field.getBoundingClientRect(), cs = getComputedStyle(field);
      d.style.left = r.left + 'px'; d.style.top = r.top + 'px'; d.style.width = r.width + 'px'; d.style.height = r.height + 'px'; d.style.borderRadius = cs.borderRadius; };
    place(); document.body.appendChild(d);
    if (d.animate && !calmNow()) d.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
    // follows the field, and goes once the box is back (the answer, typing again, Escape, a click away)
    var tick = setInterval(function () {
      if (!box.isConnected || !box.classList.contains('av-ai-float')) {
        clearInterval(tick);
        if (d.animate && !calmNow()) d.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease-in' }).onfinish = function () { d.remove(); }; else d.remove();
        return;
      }
      place();
    }, 60);
  }
  function wait(b, starting) {
    floatBox(b, true);
    var dots = ''; for (var d = 0; d < 8; d++) dots += '<i style="transform:rotate(' + (d * 45) + 'deg);animation-delay:' + (-0.8 + d * 0.1).toFixed(1) + 's"></i>';
    panel(b, '<div class="av-ai-pillwrap"><div class="av-ai-pill" role="status"><span class="av-ai-dots" aria-hidden="true">' + dots + '</span><span class="av-ai-step">' + esc(t(starting ? 'Starting A.I.' : 'Working')) + '</span></div></div>');
    var pill = b.res.querySelector('.av-ai-pill');
    if (pill && pill.animate && !calmNow()) pill.animate([{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'none' }], { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)' });
    // still working after a moment: say so
    var el = b.res.querySelector('.av-ai-step');
    setTimeout(function () { if (el && el.isConnected && el.dataset.step === undefined) step(b, 'Reading your question'); }, starting ? 1800 : 900);
  }
  // the status line moves on: the old words slide up and out, the new ones in. Resolves when it's on screen.
  function step(b, text) {
    var el = b.res.querySelector('.av-ai-step');
    if (!el) return Promise.resolve();
    el.dataset.step = text;
    if (calmNow() || !el.animate) { el.textContent = t(text); return Promise.resolve(); }
    return new Promise(function (done) {
      el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-5px)' }], { duration: 130, easing: 'ease-in' }).onfinish = function () {
        if (!el.isConnected) { done(); return; }
        el.textContent = t(text);
        el.animate([{ opacity: 0, transform: 'translateY(5px)' }, { opacity: 1, transform: 'none' }], { duration: 170, easing: 'ease-out' }).onfinish = done;
      };
    });
  }
  var pause = function (ms) { return new Promise(function (r) { setTimeout(r, calmNow() ? 0 : ms); }); };
  // the answer replaces the pill: the box grows from the pill's height to the answer's, then the rows come in
  function open(b, html) {
    var h0 = b.res.offsetHeight;
    floatBox(b, false);
    panel(b, html);
    if (calmNow() || !b.res.animate) return;
    var h1 = b.res.offsetHeight;
    if (Math.abs(h1 - h0) > 4) {
      var ov = b.res.style.overflow; b.res.style.overflow = 'hidden';
      b.res.animate([{ height: h0 + 'px' }, { height: h1 + 'px' }], { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' }).onfinish = function () { b.res.style.overflow = ov; };
    }
    reveal(b);
  }
  // the answer comes in: the count line, then each row, 40 ms apart, rising a little (not in Potato mode or reduced motion)
  function reveal(b) {
    if (calmNow()) return;
    var els = b.res.querySelectorAll('.av-ai-panel > *');
    for (var k = 0; k < els.length && k < 14; k++) {
      if (!els[k].animate) break;
      els[k].animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 260, delay: 60 + Math.min(k, 10) * 40, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
    }
  }
  function answer(b, q) {
    var my = ++turn;
    var still = function () { return my === turn && b.res.isConnected && (b.input.value || '').trim() === q; };
    wait(b, !ready);
    ask(q).then(function (r) {
      if (!still()) return;
      var words = '<button class="mi s-cmd av-ai-words" data-avai="words"><svg class="i"><use href="#i-search"/></svg><span class="tx"><b>' + esc(t('Search for the words instead')) + '</b><small data-no-t>“' + esc(q.slice(0, 120)) + '”</small></span></button>';
      var foot = '<p class="av-ai-note">' + esc(t('A.I. can be wrong. It ran on this device; nothing you typed was sent anywhere.')) + '</p>';
      if (r.kind !== 'call') { open(b, '<div class="av-ai-say">' + AI_SVG + '<span>' + esc(t("I can only search your classes, grades, work, posts, messages and files.")) + '</span></div>' + words + foot); return; }
      var need = NEEDS[r.name], got = null;
      // what it's doing now, then the data it needs, then "Reviewing results" for a moment before the answer opens
      return step(b, SEARCHING[r.name] || 'Searching').then(function () { return Promise.all([need ? extraData(need) : null, pause(350)]); })
        .then(function (x) { got = x[0]; if (!still()) return; return step(b, 'Reviewing results').then(function () { return pause(250); }); })
        .then(function () { var extra = got;
      if (!still()) return;
      var out = run(r, q, extra); r = out.call || r;
      if (out.go) { window.location.href = out.go; return; }
      if (out.words != null) { STATE.skip = out.words; b.input.value = out.words; b.input.dispatchEvent(new Event('input', { bubbles: true })); return; }
      // the answer first (how many, or the count line), then the rows, then what the A.I. searched for, big enough to read
      var n = out.rows.length, noun = NOUN[r.name === 'find_grades' ? (r.args && r.args.show === 'scores' ? 'scores' : r.args && r.args.show === 'gpa' ? 'gpa' : 'grade') : r.name] || ['result', 'results'];
      // a count only where one means something (not for the GPA or a what-it-takes estimate, which are one row)
      var counted = n && noun[0] !== 'GPA' && noun[0] !== 'estimate';
      var line = out.lead || (counted ? (n === 1 ? '1 ' + noun[0] : n + ' ' + noun[1]) : n ? '' : 'Nothing found for that.');
      var top = line ? '<p class="av-ai-lead">' + esc(t(line)) + '</p>' : '';
      var by = '<div class="av-ai-by"><span class="av-ai-by-h">' + AI_SVG + esc(t('Searched for')) + '</span><span class="av-ai-chips">' + chips(r.name, r.args || {}) + '</span></div>';
      open(b, top + out.rows.join('') + (out.note ? '<p class="av-ai-note">' + esc(t(out.note)) + '</p>' : '') + by + words + foot);
      });
    }).catch(function (e) {
      if (!still()) return;
      var gpu = e && GPU_ERR.test(e.message || '');
      if (gpu) { setCheck(variantOf(), false); stop(); changed(); }
      var m = e && e.message === 'not_saved' ? 'A.I. search needs its download again. Turn it on in Settings.'
        : gpu ? "This browser can't run A.I. search yet. Try Chrome or Edge. It tries again when this browser updates." : "A.I. search didn't work just now. Try again, or search for the words.";
      open(b, '<div class="av-ai-say">' + AI_SVG + '<span>' + esc(t(m)) + '</span></div><button class="mi s-cmd av-ai-words" data-avai="words"><svg class="i"><use href="#i-search"/></svg><span class="tx"><b>' + esc(t('Search for the words instead')) + '</b></span></button>');
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
  document.addEventListener('input', function (e) {
    if (!e.target || (e.target.id !== 'bigInput' && e.target.id !== 'cmdkInput')) return;
    if ((e.target.value || '').trim() !== STATE.skip) STATE.skip = '';
    document.querySelectorAll('.av-ai-float').forEach(function (x) { x.classList.remove('av-ai-float'); });   // typing again: the box is back
  }, true);

  var css = document.createElement('style');
  css.textContent = [
    '.av-ai-ic{width:22px;height:22px;flex:none;margin:0 7px;color:var(--ink)}',
    '.av-ai-row + .s-tabs{margin-top:6px}',
    // Home's dropdown has no top padding (its first row is a label with its own): room above the A.I. row and the answer
    '.pop.spop > .av-ai-row:first-child{margin-top:8px}.pop.spop > .av-ai-panel{padding-top:8px}',
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
    '.av-ai-lead{margin:6px 12px 6px;color:var(--ink);font-size:16px;font-weight:800}',
    // waiting: the dark pill, its ring of 8 dots fading round, and the status shimmering
    '.av-ai-pillwrap{display:flex;justify-content:center;padding:24px 0 22px}',
    '.av-ai-dim{position:fixed;z-index:59;pointer-events:none;box-shadow:0 0 0 200vmax rgba(8,9,12,.55)}',
    // while the pill shows, the box behind it goes (Home: the dropdown; Ctrl K: the window, leaving just its search field)
    '.pop.spop,.cmdk{transition:background-color .2s ease,box-shadow .2s ease}',
    '.pop.spop.av-ai-float{background:transparent;box-shadow:none}.pop.spop.av-ai-float > .pop-foot{display:none}',
    '.cmdk.av-ai-float{background:transparent;box-shadow:none;overflow:visible}.cmdk.av-ai-float .cmdk-foot{display:none}',
    '.cmdk-scrim{transition:background-color .2s ease}.cmdk-scrim:has(.cmdk.av-ai-float){background:rgba(8,9,12,.55)}',
    '.cmdk.av-ai-float .cmdk-in{background:var(--field);border-radius:20px;border-bottom-color:transparent;box-shadow:var(--pop-shadow)}',
    '.av-ai-pill{display:inline-flex;align-items:center;gap:14px;height:58px;padding:0 28px 0 22px;border-radius:29px;background:#121318;color:#f4f4f7;box-shadow:0 12px 36px rgba(0,0,0,.35),inset 0 0 0 1px rgba(255,255,255,.08);font-size:18px;font-weight:700;white-space:nowrap}',
    '.av-ai-dots{position:relative;flex:none;width:24px;height:24px}.av-ai-dots i{position:absolute;left:10.2px;top:0;width:3.6px;height:3.6px;border-radius:50%;background:#fff;transform-origin:1.8px 12px;animation:avAiDot .8s linear infinite}',
    '@keyframes avAiDot{0%{opacity:1}100%{opacity:.15}}',
    '.av-ai-step{display:inline-block;background:linear-gradient(90deg,#8e909b 0%,#8e909b 38%,#ffffff 50%,#8e909b 62%,#8e909b 100%) 0 0/260% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:avAiText 1.7s linear infinite}',
    '@keyframes avAiText{from{background-position:100% 0}to{background-position:0 0}}',
    '.potato-mode .av-ai-dots i,.potato-mode .av-ai-step{animation:none}.potato-mode .av-ai-step{color:#f4f4f7;background:none}',
    '@media (prefers-reduced-motion:reduce){.av-ai-dots i{animation:none;opacity:.7}.av-ai-step{animation:none;color:#f4f4f7;background:none}}',
    // after the answer: what it searched for, at the bottom, in readable chips
    '.av-ai-by{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:8px 4px 2px;padding:10px 12px;border-radius:14px;background:var(--panel,#f2f3f6)}',
    '.av-ai-by-h{display:inline-flex;align-items:center;gap:6px;color:var(--muted);font-size:13px;font-weight:700}.av-ai-by-h .av-ai-ic{width:18px;height:18px;margin:0}',
    '.av-ai-chips{display:flex;flex-wrap:wrap;gap:6px}.av-ai-by .av-ai-chip{height:28px;padding:0 12px;border-radius:14px;font-size:13.5px;background:var(--frame,var(--card,#fff))}',
    '.av-ai-note{margin:4px 12px 6px;color:var(--muted);font-size:12px;font-weight:600}',
  ].join('');
  (document.head || document.documentElement).appendChild(css);

  window.AvAI = { retest: function () { try { LS.removeItem(CHECK); } catch (e) { /* off */ } return selfTest(variantOf()); }, VARIANTS: VARIANTS, mb: mb, offered: offered, status: status, download: download, remove: remove, ask: ask, run: run, variant: variantOf, lists: lists, _state: STATE };
  // only once the page has the student's data (never on the sign-in page: /config/features there would be a 401)
  if (window.FSD && window.FSD.me && window.FSD.me.uid) refresh();
  window.addEventListener('fs:ready', refresh);
})();
