/*
 * Live grades (2026-10-27, Martin: "can it be the refresh animation that we
 * already made that's on the landing page, the scrolling numbers").
 *
 * While a signed-in page is open and on screen, this asks the API for each
 * class's grade every few minutes (GET /data/grades: one Schoology call). When
 * one moved, the page redraws its grades and every number or letter that
 * changed rolls to its new value like the landing page's tiles: the old value
 * slides out and the new one slides in, up when the grade went up and down
 * when it went down (560 ms, the landing page's curve).
 *
 * How often: the API says, in `next` (5 minutes, 2 with Averages Plus). The
 * time of the last check is kept for this tab (averages_live_at), and a fresh
 * load of the grades counts as one, so moving between pages never adds
 * checks. Nothing is checked while the tab is hidden; coming back checks
 * right away if one is due. Stops for demo and Google Classroom sign-ins
 * (COURSES: null), and when the live-grades switch is off.
 *
 * When something changed it also reloads the full grades in the background
 * (the same GET /data/bundle a page load makes) and keeps them for this tab,
 * so the next page shows the new assignment rows and Recent grades too.
 *
 * Pages take part with two things:
 *   - data-live="<class id>:<field>" on the element holding a value (grade,
 *     pct, predicted, predictedPct), with nothing else inside it;
 *   - window.__averagesLiveGrades(changedIds), which redraws the page's
 *     grades from COURSES (already updated in place when it's called).
 * Pages without the hook still get their data and the tab's cache updated.
 *
 * Potato mode and reduced motion: the values change without rolling.
 */
(function () {
  'use strict';
  if (window.AveragesLive) return;

  var API = window.location.hostname.endsWith('averages.io') ? 'https://api.averages.io' : 'http://localhost:8787';
  var BUNDLE_CACHE = 'schoolagy_bundle_cache';
  var AT_KEY = 'averages_live_at';
  var EVERY_KEY = 'averages_live_every';
  var DEFAULT_EVERY_S = 300;
  var TICK_MS = 15000;
  var ROLL_MS = 560;
  var EASE = 'cubic-bezier(.22,.9,.28,1)';
  var FIELDS = ['grade', 'pct', 'predicted', 'predictedPct', 'trend'];

  var stopped = false;
  var busy = false;
  var rollingUntil = 0;

  function ssGet(k) { try { return window.sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { window.sessionStorage.setItem(k, String(v)); } catch (e) { /* storage off */ } }

  function everyMs() {
    var n = Number(ssGet(EVERY_KEY));
    return (n >= 60 ? n : DEFAULT_EVERY_S) * 1000;
  }
  function lastAt() {
    var t = Number(ssGet(AT_KEY)) || 0;
    try {
      var cached = JSON.parse(ssGet(BUNDLE_CACHE) || 'null');
      if (cached && typeof cached.at === 'number' && cached.at > t) t = cached.at;
    } catch (e) { /* nothing cached */ }
    return t;
  }

  /** The page's live data, or null when there's nothing to keep fresh here. */
  function liveData() {
    var av = window.__AVERAGES__;
    if (!av || av.mode !== 'live' || !av.data || !Array.isArray(av.data.COURSES)) return null;
    if (window.__AVERAGES_PROVIDER__ === 'google' || av.data.platform === 'classroom') return null;
    return av.data;
  }
  function switchedOn() {
    var F = window.AveragesFeatures;
    try { return !F || typeof F.on !== 'function' || F.on('live-grades') !== false; } catch (e) { return true; }
  }
  function calm() {
    try {
      if (document.body && document.body.classList.contains('potato-mode')) return true;
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) { return false; }
  }

  // ---------- Rolling one value ----------

  /*
   * The element keeps its place and size in the line: the new value is an
   * inline-block (so it can move) in the normal flow, the old one sits on top
   * of it, and the wrapper clips both to the line's height. clip-path rather
   * than overflow:hidden, so the wrapper keeps the text's baseline.
   */
  function roll(el, from, to, up) {
    if (calm() || typeof el.animate !== 'function') return;
    var wrap = document.createElement('span');
    wrap.className = 'av-roll';
    wrap.style.cssText = 'display:inline-block;position:relative;clip-path:inset(0 -2em);white-space:nowrap';
    var next = document.createElement('span');
    next.style.cssText = 'display:inline-block';
    next.textContent = to;
    var prev = document.createElement('span');
    prev.setAttribute('aria-hidden', 'true');
    prev.style.cssText = 'position:absolute;left:0;top:0;white-space:nowrap';
    prev.textContent = from;
    wrap.appendChild(next);
    wrap.appendChild(prev);
    el.textContent = '';
    el.appendChild(wrap);
    rollingUntil = Math.max(rollingUntil, Date.now() + ROLL_MS + 60);
    var d = up ? 1 : -1;
    var opts = { duration: ROLL_MS, easing: EASE };
    var a = next.animate([{ transform: 'translateY(' + (100 * d) + '%)' }, { transform: 'translateY(0)' }], opts);
    prev.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(' + (-100 * d) + '%)' }], opts);
    var done = false;
    function settle() {
      if (done) return;
      done = true;
      if (wrap.parentNode === el) el.textContent = to;
    }
    a.onfinish = settle;
    a.oncancel = settle;
    // A hidden tab can hold an animation back; never leave the two values up.
    setTimeout(settle, ROLL_MS + 200);
  }

  /** What an element shows: mid-roll, that's the incoming value, not both. */
  function shown(el) {
    var w = el.querySelector('.av-roll');
    return w && w.firstChild ? w.firstChild.textContent : el.textContent;
  }
  function snapshot() {
    var seen = {};
    document.querySelectorAll('[data-live]').forEach(function (el) {
      var k = el.getAttribute('data-live');
      (seen[k] = seen[k] || []).push(shown(el));
    });
    return seen;
  }

  function rollChanged(before, ups) {
    var idx = {};
    document.querySelectorAll('[data-live]').forEach(function (el) {
      var k = el.getAttribute('data-live');
      var i = idx[k] = (idx[k] || 0);
      idx[k]++;
      var was = before[k] && before[k][i];
      var now = shown(el);
      if (was === undefined || was === now) return;
      var id = k.slice(0, k.lastIndexOf(':'));
      var a = parseFloat(was), b = parseFloat(now);
      var up = !isNaN(a) && !isNaN(b) ? b > a : ups[id] !== false;
      roll(el, was, now, up);
    });
  }

  /** Whatever had focus in a redrawn list gets it back. */
  function focusKey() {
    var el = document.activeElement;
    if (!el || el === document.body) return null;
    for (var n = el; n && n !== document.body; n = n.parentElement) {
      var attrs = ['data-id', 'data-href', 'data-course'];
      for (var j = 0; j < attrs.length; j++) {
        if (n.hasAttribute && n.hasAttribute(attrs[j])) {
          return { el: el, sel: '[' + attrs[j] + '="' + String(n.getAttribute(attrs[j])).replace(/["\\]/g, '\\$&') + '"]', same: n === el };
        }
      }
    }
    return { el: el };
  }
  function restoreFocus(k) {
    if (!k || document.contains(k.el) || !k.sel) return;
    var host = document.querySelector(k.sel);
    if (!host) return;
    var target = k.same ? host : host.querySelector('[tabindex],a,button') || host;
    try { target.focus({ preventScroll: true }); } catch (e) { /* not focusable */ }
  }

  // ---------- Applying new grades ----------

  /**
   * Copies the new values onto the page's own class objects (the page's
   * COURSES is the same array), redraws, rolls what changed. Returns the ids
   * that changed. Only classes the page already shows are touched.
   */
  function apply(data, fresh) {
    var byId = {};
    fresh.forEach(function (c) { if (c && c.id != null) byId[String(c.id)] = c; });
    var changed = [];
    var ups = {};
    data.COURSES.forEach(function (c) {
      var n = byId[String(c.id)];
      if (!n) return;
      var moved = FIELDS.some(function (f) { return n[f] !== undefined && n[f] !== c[f]; });
      if (moved) {
        changed.push(String(c.id));
        ups[String(c.id)] = Number(n.pct) >= Number(c.pct);
      }
      FIELDS.concat(['updated']).forEach(function (f) { if (n[f] !== undefined) c[f] = n[f]; });
    });
    if (changed.length) redraw(changed, ups);
    return changed;
  }

  function redraw(changed, ups) {
    var hook = window.__averagesLiveGrades;
    if (typeof hook !== 'function') return;
    var before = snapshot();
    var focus = focusKey();
    try { hook(changed.slice()); } catch (e) { /* a page's redraw never stops the checks */ }
    restoreFocus(focus);
    rollChanged(before, ups);
  }

  /** The grades in this tab's cache follow the check, so the next page agrees with this one. */
  function updateCache(fresh) {
    try {
      var cached = JSON.parse(ssGet(BUNDLE_CACHE) || 'null');
      if (!cached || !cached.bundle || !Array.isArray(cached.bundle.COURSES)) return;
      var byId = {};
      fresh.forEach(function (c) { byId[String(c.id)] = c; });
      cached.bundle.COURSES.forEach(function (c) {
        var n = byId[String(c.id)];
        if (n) FIELDS.concat(['updated']).forEach(function (f) { if (n[f] !== undefined) c[f] = n[f]; });
      });
      ssSet(BUNDLE_CACHE, JSON.stringify(cached));
    } catch (e) { /* storage full or off */ }
  }

  /**
   * Something changed: the whole bundle again, for the assignment rows,
   * Recent grades and the trend charts. Swapped into the page's data in
   * place (pages hold the same arrays), then one more redraw, which rolls
   * nothing since the numbers already moved.
   */
  function refreshBundle(data) {
    var tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* the API guesses */ }
    return fetch(API + '/data/bundle' + (tz ? '?tz=' + encodeURIComponent(tz) : ''), { credentials: 'include', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (bundle) {
        if (!bundle || !Array.isArray(bundle.COURSES)) return;
        ssSet(BUNDLE_CACHE, JSON.stringify({ at: Date.now(), bundle: bundle }));
        ['RECENT_GRADES', 'OVERDUE', 'UPCOMING', 'TODAY'].forEach(function (k) {
          if (Array.isArray(data[k]) && Array.isArray(bundle[k])) data[k].splice.apply(data[k], [0, data[k].length].concat(bundle[k]));
        });
        ['HISTORY', 'GRADEBOOK'].forEach(function (k) {
          if (data[k] && typeof data[k] === 'object' && bundle[k] && typeof bundle[k] === 'object') {
            Object.keys(bundle[k]).forEach(function (id) { data[k][id] = bundle[k][id]; });
          }
        });
        if (typeof bundle.projectedGPA === 'number') data.projectedGPA = bundle.projectedGPA;
        // After any roll still running, so redrawing doesn't cut it short.
        setTimeout(function () {
          var changed = apply(data, bundle.COURSES);
          if (!changed.length) redraw(data.COURSES.map(function (c) { return String(c.id); }), {});
        }, Math.max(0, rollingUntil - Date.now()));
      })
      .catch(function () { /* the next page load gets it */ });
  }

  function check(force) {
    if (stopped || busy || document.hidden || !switchedOn()) return Promise.resolve(null);
    var data = liveData();
    if (!data) return Promise.resolve(null);
    if (!force && Date.now() - lastAt() < everyMs()) return Promise.resolve(null);
    busy = true;
    ssSet(AT_KEY, Date.now());
    return fetch(API + '/data/grades', { credentials: 'include', cache: 'no-store' })
      .then(function (r) {
        return r.json().catch(function () { return null; }).then(function (j) { return { status: r.status, body: j }; });
      })
      .then(function (res) {
        var j = res.body || {};
        if (typeof j.next === 'number' && j.next >= 60) ssSet(EVERY_KEY, j.next);
        if (res.status === 401 || (res.status === 503 && j.error === 'feature_off')) { stopped = true; return []; }
        if (res.status !== 200) return [];
        if (j.COURSES === null) { stopped = true; return []; }
        if (!Array.isArray(j.COURSES)) return [];
        var changed = apply(data, j.COURSES);
        updateCache(j.COURSES);
        if (changed.length) refreshBundle(data);
        return changed;
      })
      .catch(function () { return []; })
      .then(function (changed) { busy = false; return changed; });
  }

  setInterval(function () { check(false); }, TICK_MS);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) check(false); });

  window.AveragesLive = {
    check: check,
    roll: roll,
    // For tests and Settings: when the next check is due.
    dueIn: function () { return Math.max(0, lastAt() + everyMs() - Date.now()); },
  };
})();
