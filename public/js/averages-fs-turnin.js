/*
 * Turning in work from the Fullscreen pages (2026-10-28): what the Turn in
 * popup (Home, Assignments, the course hub) does for real. The pages keep
 * their own look; every step here is the Windowed app's own code:
 *   - files from this device: public/js/averages-submit.js (MD5, upload slot,
 *     bytes through our API, then the turn-in);
 *   - Google Drive and OneDrive: public/js/averages-cloud.js (the student's
 *     own sign-in, the file list, downloading or a view link);
 *   - Canva: our API's /canva/designs and averages-submit.js's export;
 *   - a written answer: averages-submit.js's submitText.
 * Loaded by build-fs only on pages that turn things in. window.FST.
 */
(function () {
  'use strict';
  if (window.FST) return;
  var API = window.location.hostname.endsWith('averages.io') ? 'https://api.averages.io' : 'http://localhost:8787';
  function script(src, name) {
    return new Promise(function (resolve, reject) {
      if (window[name]) { resolve(window[name]); return; }
      var s = document.createElement('script'); s.src = src; s.async = true;
      s.onload = function () { window[name] ? resolve(window[name]) : reject({ code: 'not_configured' }); };
      s.onerror = function () { reject({ code: 'network' }); };
      document.head.appendChild(s);
    });
  }
  var submitP = null, cloudP = null, cfg = null;
  function S() { return submitP || (submitP = script('/js/averages-submit.js', 'AveragesSubmit')); }
  function Cl() {
    return cloudP || (cloudP = script('/js/averages-cloud.js', 'AveragesCloud').then(function (C) {
      return C.config().then(function (c) { cfg = c || {}; if (cfg.google) C.prepareGoogle().catch(function () {}); return C; });
    }));
  }
  // start loading right away: a sign-in window has to open inside a click, so the scripts must already be here by then
  S().catch(function () {}); Cl().catch(function () {});
  var C = function () { return window.AveragesCloud || null; };
  var GDOC = { 'application/vnd.google-apps.document': 'gdoc', 'application/vnd.google-apps.spreadsheet': 'gsheet', 'application/vnd.google-apps.presentation': 'gslides', 'application/vnd.google-apps.drawing': 'gdraw' };
  function extOf(name) { var m = String(name || '').toLowerCase().match(/\.([a-z0-9]{1,8})$/); return m ? m[1] : ''; }
  function ago(ms) {
    if (!ms) return '';
    var d = Math.round((Date.now() - ms) / 86400000);
    if (d <= 0) return 'Edited today'; if (d === 1) return 'Edited yesterday'; if (d < 7) return 'Edited ' + d + ' days ago';
    return 'Edited ' + new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  function size(b) { return !b ? '' : b < 1048576 ? Math.max(1, Math.round(b / 1024)) + ' KB' : (b / 1048576).toFixed(1) + ' MB'; }
  function tz() { try { return (window.averagesTimeZone && window.averagesTimeZone()) || Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; } }
  function get(path) {
    return fetch(API + path, { credentials: 'include', cache: 'no-store' }).then(function (r) {
      if (r.status === 401) { window.location.replace('/'); throw { code: 'signed_out' }; }
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw { code: (j && j.error) || 'http_' + r.status }; return j; });
    });
  }
  // Tokens: asked for inside the click (a sign-in window may open), before anything is awaited.
  function driveToken() {
    var c = C(); if (!c) return Promise.reject({ code: 'not_ready' });
    if (!c.googleReady()) { c.prepareGoogle().catch(function () {}); return Promise.reject({ code: 'not_ready' }); }
    return c.googleSession({ interactive: true });
  }
  var CANVA_URL = /^https:\/\/(www\.)?canva\.com\//i;
  function here() { var u = new URL(window.location.href); u.searchParams.delete('canva'); return u.pathname + u.search + u.hash; }
  function post(path, body) {
    return fetch(API + path, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).catch(function () { throw { code: 'network' }; }).then(function (r) {
      if (r.status === 401) { window.location.replace('/'); throw { code: 'signed_out' }; }
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw { code: (j && j.error) || 'http_' + r.status }; return j; });
    });
  }
  function oneDriveToken(write) { var c = C(); if (!c) return Promise.reject({ code: 'not_ready' }); return c.oneDriveToken(write ? { interactive: true, write: true } : { interactive: true, read: true }); }

  var FST = window.FST = {
    ready: function () { return Promise.all([S(), Cl()]); },
    size: size,
    /** The assignment's description, points, attachments and the student's turn-ins (newest first). */
    load: function (section, id) {
      var z = tz();
      return Promise.all([
        get('/data/assignment?section=' + encodeURIComponent(section) + '&id=' + encodeURIComponent(id) + (z ? '&tz=' + encodeURIComponent(z) : '')).catch(function () { return null; }),
        S().then(function (s) { return s.history({ section: section, assignment: id }); }).catch(function () { return []; }),
      ]).then(function (r) { return { detail: r[0], revisions: r[1] || [] }; });
    },
    /** Is this app connected (for the picker's empty state)? */
    connected: function (src) {
      if (src === 'canva') return null;   // the designs call says
      var c = C(); if (!c) return false;
      var a = c.accounts() || {};
      return src === 'drive' ? !!a.gdrive && !(c.lost && c.lost('gdrive')) : !!a.onedrive && !(c.lost && c.lost('onedrive'));
    },
    configured: function (src) { return src === 'canva' ? true : src === 'drive' ? !!(cfg && cfg.google) : !!(cfg && cfg.microsoft); },
    connect: function (src) {
      if (src === 'canva') { window.location.href = API + '/canva/connect?return_to=' + encodeURIComponent(window.location.pathname + window.location.search); return Promise.resolve(); }
      var c = C(); if (!c) return Promise.reject({ code: 'not_ready' });
      return Promise.resolve(src === 'drive' ? c.connectGoogle() : c.connectOneDrive());
    },
    /**
     * An app's files for the picker: [{ id, name, kind, sub, mime, designId }]. Call it inside the click (a
     * sign-in window may open). kind: gdoc / gsheet / gslides / gdraw / design, or the file's extension.
     */
    list: function (src) {
      if (src === 'canva') {
        return get('/canva/designs').then(function (j) {
          if (j.connected === false) throw { code: 'canva_not_connected' };
          return (Array.isArray(j.items) ? j.items : []).filter(function (d) { return d && /^[A-Za-z0-9_-]{1,64}$/.test(String(d.id || '')); })
            .map(function (d) { return { id: String(d.id), designId: String(d.id), name: String(d.title || 'Untitled design').slice(0, 200), kind: 'design', sub: ago(Number(d.updatedAt) || 0) || 'Canva design', at: Number(d.updatedAt) || 0, bytes: 0, url: '' }; });
        }).catch(function (e) { if (e && (e.code === 'canva_not_connected' || e.code === 'canva_reconnect_needed')) throw { code: 'not_connected' }; throw e; });
      }
      if (!FST.connected(src)) return Promise.reject({ code: 'not_connected' });
      var c = C();
      if (src === 'drive') {
        return driveToken().then(function (t) { return c.googleList(t); }).then(function (l) {
          return (l || []).filter(function (f) { return f && f.id && f.mimeType !== 'application/vnd.google-apps.folder'; }).map(function (f) {
            var kind = GDOC[f.mimeType] || extOf(f.name) || 'file';
            return { id: String(f.id), name: String(f.name || 'Google Drive file').slice(0, 200), kind: kind, mime: String(f.mimeType || ''), sub: ago(Date.parse(f.modifiedTime || '')), at: Date.parse(f.modifiedTime || '') || 0, bytes: Number(f.size) || 0, url: /^https:\/\/(docs|drive)\.google\.com\//.test(String(f.webViewLink || '')) ? String(f.webViewLink) : '' };
          });
        });
      }
      return oneDriveToken(false).then(function (t) { return c.oneDriveList(t); }).then(function (l) {
        return (l || []).filter(function (f) { return f && f.id && !f.folder; }).map(function (f) {
          return { id: String(f.id), name: String(f.name || 'OneDrive file').slice(0, 200), kind: extOf(f.name) || 'file', mime: String((f.file && f.file.mimeType) || f.mimeType || ''), sub: [size(f.size), ago(Date.parse(f.lastModifiedDateTime || ''))].filter(Boolean).join(' · '), at: Date.parse(f.lastModifiedDateTime || '') || 0, bytes: Number(f.size) || 0, url: /^https:\/\/[a-z0-9.-]+\.(live\.com|sharepoint\.com|1drv\.ms)\//i.test(String(f.webUrl || '')) ? String(f.webUrl) : '' };
        });
      });
    },
    /** Disconnect an app (Google Drive, OneDrive or Canva): the sign-in kept for it is removed. */
    disconnect: function (src) {
      if (src === 'canva') return fetch(API + '/canva/connection', { method: 'DELETE', credentials: 'include' }).then(function (r) { if (!r.ok) throw { code: 'http_' + r.status }; });
      var c = C(); if (!c) return Promise.reject({ code: 'not_ready' });
      return Promise.resolve(src === 'drive' ? c.disconnectGoogle() : c.disconnectOneDrive());
    },
    /** OneDrive's own file picker (any file in their OneDrive). */
    pickOneDrive: function () {
      var c = C();
      return oneDriveToken(false).then(function (t) { return c.oneDrivePick(t); }).then(function (l) {
        return (l || []).map(function (f) { return { id: String(f.id || ''), name: String(f.name || 'OneDrive file').slice(0, 200), kind: extOf(f.name) || 'file', mime: String(f.mimeType || ''), sub: size(Number(f.size) || 0) }; });
      });
    },
    /** What a picked file can be sent as: [[ext, label]]. Google files convert; Canva exports; others go as they are. */
    formats: function (item) {
      var NAMES = { pdf: 'PDF', docx: 'Word', xlsx: 'Excel', pptx: 'PowerPoint', png: 'PNG', jpg: 'JPG', csv: 'CSV' };
      if (item.src === 'canva' || item.kind === 'design') return [['pdf', 'PDF'], ['png', 'PNG'], ['jpg', 'JPG']];
      if (GDOC[item.mime]) {
        var c = C(), types = c && c.googleExportTypes ? c.googleExportTypes(item.mime) : ['pdf'];
        return (types && types.length ? types : ['pdf']).map(function (t) { return [t, NAMES[t] || t.toUpperCase()]; });
      }
      var e = extOf(item.name) || item.kind || 'file';
      return [[e, NAMES[e] || e.toUpperCase()]];
    },
    /** Tokens for the picks about to be sent: call inside the Turn in click. */
    tokensFor: function (picks) {
      var t = {};
      if (picks.some(function (p) { return p.src === 'drive'; })) t.drive = driveToken();
      if (picks.some(function (p) { return p.src === 'onedrive' && p.mode === 'link'; })) t.onedriveWrite = oneDriveToken(true);
      if (picks.some(function (p) { return p.src === 'onedrive' && p.mode !== 'link'; })) t.onedrive = oneDriveToken(false);
      Object.keys(t).forEach(function (k) { t[k].catch(function () {}); });
      return t;
    },
    /** A picked file as what will be uploaded: [{ blob, name }] (a Canva PNG can be several pages). */
    fetch: function (p, tokens, signal) {
      return S().then(function (s) {
        var c = C();
        if (p.mode === 'link') {
          var from = p.src === 'drive' ? 'Google Drive' : 'OneDrive';
          var link = p.src === 'drive' ? tokens.drive.then(function (t) { return c.googleShareLink(t, p.id, 'reader'); }) : tokens.onedriveWrite.then(function (t) { return c.oneDriveShareLink(t, p.id); });
          return link.then(function (r) { return [s.linkFile(p.name, r.url, from)]; });
        }
        if (p.src === 'canva') return s.exportCanvaFiles(p.designId || p.id, { title: p.name, signal: signal, format: p.fmt || 'pdf' });
        if (p.src === 'drive') return tokens.drive.then(function (t) { return c.googleDownload(t, p.id, { as: p.fmt || 'pdf' }); }).then(function (r) { return [{ blob: r.blob, name: String(r.name || p.name) }]; });
        return tokens.onedrive.then(function (t) { return c.oneDriveDownload(t, p.id); }).then(function (r) { return [{ blob: r.blob, name: String(r.name || p.name) }]; });
      });
    },
    /** One file up to Schoology (not turned in yet): { fileId }. onProgress(0..1). */
    upload: function (section, id, blob, name, onProgress, signal) {
      return S().then(function (s) {
        return s.uploadFile({ section: section, assignment: id, blob: blob, name: name, signal: signal, onProgress: function (x) { if (onProgress) onProgress(x.phase === 'hashing' ? x.fraction * 0.15 : 0.15 + x.fraction * 0.85); } });
      });
    },
    turnIn: function (section, id, fileIds, note) { return S().then(function (s) { return s.turnInFiles({ section: section, assignment: id, fileIds: fileIds, description: note || '' }); }); },
    write: function (section, id, html) { return S().then(function (s) { return s.submitText({ section: section, assignment: id, html: html }); }); },
    history: function (section, id) { return S().then(function (s) { return s.history({ section: section, assignment: id }); }); },
    /**
     * Edit in Canva: Schoology's file becomes a design in the student's Canva (POST /canva/edit).
     * Resolves to { editUrl, draft }. Canva opens in this tab and its Return button comes back here.
     */
    canvaEdit: function (section, id, fileId) {
      return post('/canva/edit', { section: String(section), assignment: String(id), fileId: String(fileId), returnTo: here() }).then(function (j) {
        if (typeof j.editUrl !== 'string' || !CANVA_URL.test(j.editUrl)) throw { code: 'canva' };
        return j;
      });
    },
    /** The student's Canva drafts for one assignment: [{ designId, title, updatedAt, sourceName }]. */
    canvaDrafts: function (section, id) {
      return get('/canva/drafts?section=' + encodeURIComponent(section) + '&assignment=' + encodeURIComponent(id)).then(function (j) { return (Array.isArray(j.drafts) ? j.drafts : []).filter(function (d) { return d && d.designId; }); }).catch(function () { return []; });
    },
    canvaOpen: function (designId) {
      return post('/canva/designs/' + encodeURIComponent(designId) + '/open', { returnTo: here() }).then(function (j) {
        if (typeof j.editUrl !== 'string' || !CANVA_URL.test(j.editUrl)) throw { code: 'canva' };
        return j.editUrl;
      });
    },
    /** Forgets a draft here (the design stays in their Canva). */
    canvaForget: function (designId) {
      return fetch(API + '/canva/drafts/' + encodeURIComponent(designId), { method: 'DELETE', credentials: 'include' }).then(function (r) { if (!r.ok) throw { code: 'http_' + r.status }; });
    },
    /** Edit in Google Drive: the file goes from Schoology into their Drive as a Google file. Call inside the click. */
    driveEdit: function (section, id, fileId, name) {
      var c = C(); if (!c) return Promise.reject({ code: 'not_ready' });
      return driveToken().then(function (t) { return c.editInGoogleDrive(t, { section: String(section), assignment: String(id), fileId: String(fileId), name: name || 'File' }); });
    },
    /** Google Drive drafts for one assignment (remembered in this browser): [{ fileId, name, ext, webViewLink, modifiedTime }]. */
    driveDrafts: function (section, id) { var c = C(); return c && c.listDriveDrafts ? c.listDriveDrafts(String(section), String(id)) : []; },
    driveForget: function (fileId) { var c = C(); if (c && c.removeDriveDraft) c.removeDriveDraft(fileId); },
    /**
     * Save to Google Drive or OneDrive: Schoology files ({ id, name, course, kind, parent }) copied into the
     * Averages.io folder there, one at a time. Call inside the click (a sign-in window may open).
     */
    saveTo: function (src, files, onEach) {
      var c = C(); if (!c) return Promise.reject({ code: 'not_ready' });
      var tok = src === 'drive' ? driveToken() : c.oneDriveToken({ interactive: true });
      return tok.then(function (t) {
        var out = [], n = 0;
        return files.reduce(function (p, f) {
          return p.then(function () {
            var doc = f.kind === 'document';
            return c.fetchAttachment({ section: f.course, assignment: doc ? undefined : f.parent, document: doc ? f.parent : undefined, fileId: f.id, name: f.name })
              .then(function (blob) { return src === 'drive' ? c.googleUpload(t, { name: f.name, blob: blob }) : c.oneDriveUpload(t, { name: f.name, blob: blob }); })
              .then(function (r) { out.push(r); if (onEach) onEach(++n); });
          });
        }, Promise.resolve()).then(function () { return out; });
      });
    },
    cloudMessage: function (err) { var c = C(); return c ? c.messageFor(err) : 'Something went wrong. Try again in a moment.'; },
    canvaMessage: function (code) {
      return ({
        canva_not_connected: 'Connect Canva first, in Settings.', canva_reconnect_needed: 'Your Canva connection ran out. Connect it again in Settings.',
        canva_not_configured: 'Editing in Canva isn’t switched on yet.', canva_missing_permission: 'Reconnect Canva in Settings and allow access when asked.',
        canva_duplicate_import: 'That file is already in your Canva.', canva_rate_limited: 'Canva is busy. Try again in a minute.',
        canva_invalid_file: 'Canva can’t open this file. Download it instead.', file_too_large: 'Files over 25 MB can’t open in Canva.',
        file_not_found: 'That file was removed. Reload to see what’s attached.', canva_design_gone: 'That design was deleted in Canva.',
      })[code] || 'Couldn’t open this in Canva. Try again in a moment.';
    },
    message: function (err) {
      var code = err && err.code ? err.code : String(err || '');
      if (code === 'not_connected') return 'Connect it first.';
      if (code === 'not_ready') return 'Still getting ready. Try again in a moment.';
      if (window.AveragesSubmit) return window.AveragesSubmit.messageFor(err);
      if (window.AveragesCloud) return window.AveragesCloud.messageFor(err);
      return 'Something went wrong. Try again in a moment.';
    },
  };
})();
