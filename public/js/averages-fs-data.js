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

  // ---------- loading screen ----------
  root.classList.add('fs-wait');
  var css = document.createElement('style');
  css.textContent = 'html.fs-wait body{visibility:hidden}html.fs-wait::before{content:"";position:fixed;inset:0;z-index:99;background:var(--fs-load-bg,#f4f4f7)}'
    + 'html[data-theme="dark"].fs-wait::before{background:#16171d}'
    + 'html.fs-wait::after{content:"";position:fixed;z-index:100;left:50%;top:50%;width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:50%;border:3px solid rgba(110,112,130,.25);border-top-color:var(--accent,#b8352f);animation:fsSpin .8s linear infinite}'
    + '@keyframes fsSpin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){html.fs-wait::after{animation-duration:2.4s}}'
    + '.fs-fail{position:fixed;inset:0;z-index:101;display:grid;place-items:center;padding:24px;font:600 15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:#f4f4f7;color:#17181c;text-align:center}'
    + 'html[data-theme="dark"] .fs-fail{background:#16171d;color:#ecedf5}.fs-fail b{display:block;font-size:20px;margin-bottom:8px}.fs-fail button{margin-top:16px;font:inherit;padding:8px 16px;border-radius:12px;border:0;background:var(--accent,#b8352f);color:#fff;cursor:pointer}';
  (document.head || root).appendChild(css);

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
  function extrasFor(who) {
    var now = new Date(), tz = zone(), zq = tz ? '&tz=' + encodeURIComponent(tz) : '';
    var x = { people: ['/data/people', 'people'], updates: ['/data/updates', 'updates'] };
    if (page === 'calendar' || page === 'home') {
      var s = ymd(addDays(now, -120)), e = ymd(addDays(now, 240));
      x.events = ['/data/events?start=' + s + '&end=' + e + zq, 'events_' + s + '_' + e];
    }
    if (page === 'messages' || page === 'home' || page === 'contacts') x.messages = ['/messages', 'messages'];
    if (page === 'files' || page === 'home' || page === 'course-hub' || page === 'assignments') x.files = ['/data/files', 'fs_files']; // assignments: Contains attachment
    // what's been turned in (files), so finished work isn't called missing
    if (page === 'assignments' || page === 'home' || page === 'course-hub' || page === 'files' || page === 'calendar') x.submissions = ['/data/submissions', 'fs_submissions'];
    if (page === 'contacts' || page === 'course-hub' || page === 'messages') x.classmates = ['/data/classmates', 'fs_classmates'];
    if (page === 'course-hub' && courseQ) {
      x.folders = ['/data/folders?course=' + encodeURIComponent(courseQ), 'folders_' + courseQ];
      x.gradebook = ['/data/gradebook?course=' + encodeURIComponent(courseQ), 'gradebook_' + courseQ];
      var hs = ymd(addDays(now, -60)), he = ymd(addDays(now, 120));
      x.hubEvents = ['/data/events?start=' + hs + '&end=' + he + '&course=' + encodeURIComponent(courseQ) + zq, 'events_' + hs + '_' + he + '_' + courseQ];
    }
    var out = {};
    Object.keys(x).forEach(function (k) { out[k] = extra(k, x[k][0], x[k][1], who); });
    return out;
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
    var held = document.querySelectorAll('script[type="text/fs-wait"]');
    for (var i = 0; i < held.length; i++) {
      var old = held[i], s = document.createElement('script');
      if (old.id) s.id = old.id;
      s.textContent = old.textContent;
      old.parentNode.replaceChild(s, old);
    }
    root.classList.remove('fs-wait');
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

  var started = session().then(function (me) {
    if (!me || me.mode !== 'live' || !me.uid) { window.location.replace('/'); return null; }
    var who = me.uid, xs = extrasFor(who), names = Object.keys(xs);
    return Promise.all([bundle()].concat(names.map(function (n) { return settle(xs[n], 8000); }))).then(function (all) {
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
    /** Schoology messages: a conversation, a reply, a new message (teachers only, in the app). */
    thread: function (id) { var z = zone(); return FSX.api('/messages/thread?id=' + encodeURIComponent(id) + (z ? '&tz=' + encodeURIComponent(z) : '')); },
    reply: function (id, message) { return FSX.api('/messages/reply', { method: 'POST', json: { id: String(id), message: message } }).then(function (r) { sdel('averages_extras_messages'); return r; }); },
    send: function (recipientIds, subject, message) { return FSX.api('/messages', { method: 'POST', json: { recipientIds: recipientIds, subject: subject, message: message } }).then(function (r) { sdel('averages_extras_messages'); return r; }); },
    /** Friendly words for a messages error. */
    msgError: function (e) {
      var c = e && e.message;
      return c === 'recipient_not_allowed' ? 'Schoology doesn\u2019t let you message this person.' : c === 'too_long' || c === 'message_too_long' ? 'That message is too long.' : c === 'empty_subject' ? 'Add a subject first.' : c === 'empty_message' ? 'Write a message first.' : c === 'rate_limited' ? 'Too many messages at once. Wait a minute and try again.' : 'Couldn\u2019t send it. Try again in a moment.';
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
        trend: trend, due: due.length, missing: miss.length, updates: ups.length, next: next, code: c.code || '', section: c.section || '',
        predicted: c.predicted || '', predictedPct: typeof c.predictedPct === 'number' ? c.predictedPct : c.pct, dir: c.trend || 'flat', updated: c.updated || '',
        points: points, dates: arr(hist.dates), titles: arr(hist.titles), emoji: s[1], color: s[2], lmsColor: c.color || '', order: i,
      };
    });
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
        id: String(a.id), c: c, t: a.title || g.title || 'Assignment', type: type, kind: type === 'assessment' ? 'test' : 'assignment', disc: type === 'discussion', outside: outside,
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
    var canTurnIn = function (a) { return a.kind === 'assignment' && !a.disc && !a.outside; };

    // The sidebar's counts: work that's late or due in the next 7 days, and messages not opened yet.
    var counts = {
      assign: overdue.filter(function (a) { return !a.outside; }).length + upcoming.filter(function (a) { return Date.parse(a.dueAt) - now < 7 * DAY; }).length,
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
