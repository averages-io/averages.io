/*
 * Averages.io — Google Drive and OneDrive, in the browser (2026-10-05).
 *
 * Both connect straight from the student's browser: their Google / Microsoft
 * tokens never reach our servers. Our API only serves the public app IDs
 * (GET /config/cloud) and the assignment files (GET /data/attachment) that get
 * copied into their drive.
 *
 *   Google Drive  Google Identity Services token client, scope drive.file
 *                 (Averages.io only ever sees files it made or the student
 *                 picked), plus the Google Picker for "Add from Google Drive".
 *   OneDrive      Microsoft identity platform, authorization code + PKCE from
 *                 a popup that returns to /auth/microsoftgraph (single-page
 *                 app registration, no client secret), scope
 *                 Files.ReadWrite.AppFolder: only its own Apps/Averages.io
 *                 folder, never the rest of the student's OneDrive.
 *
 * Where things are kept (all on this device only):
 *   sessionStorage averages_cloud_tokens   access/refresh tokens. Gone when the
 *                                          tab closes, which matters on shared
 *                                          school Chromebooks.
 *   localStorage   averages_cloud_accounts which account is connected
 *                                          ("Connected as ...").
 *   localStorage   averages_drive_drafts   Edit in Google Drive drafts.
 * Signing out of Averages.io clears all three (app/lib/averages.ts).
 *
 * Shared by settings.html, assignment.html and files.html, which load it only
 * in a signed-in session. Popups must open inside the click that asked for
 * them, so googleToken / oneDriveToken / connect* are deliberately NOT async:
 * call them before any `await` in a click handler.
 */
(function () {
  'use strict';
  if (window.AveragesCloud) return;

  const API = window.location.hostname.endsWith('averages.io') ? 'https://api.averages.io' : 'http://localhost:8787';
  const ACCOUNTS_KEY = 'averages_cloud_accounts';
  const TOKENS_KEY = 'averages_cloud_tokens';
  const DRAFTS_KEY = 'averages_drive_drafts';
  const FOLDER = 'Averages.io';
  const MAX_COPY_BYTES = 250 * 1024 * 1024;

  const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const GOOGLE_SCOPES = DRIVE_SCOPE + ' openid email profile';
  const DRIVE = 'https://www.googleapis.com/drive/v3';
  const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
  const MS_AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0';
  const MS_SCOPES = 'openid profile offline_access User.Read Files.ReadWrite.AppFolder';
  const GRAPH = 'https://graph.microsoft.com/v1.0';

  class CloudError extends Error {
    constructor(code) {
      super(code);
      this.code = code;
    }
  }
  const fail = (code) => new CloudError(code);

  /* ── device storage ───────────────────────────────────────────────── */

  function store(kind) {
    try {
      return kind === 'session' ? window.sessionStorage : window.localStorage;
    } catch {
      return null;
    }
  }
  function readJSON(kind, key, fallback) {
    try {
      const s = store(kind);
      const v = s ? JSON.parse(s.getItem(key) || 'null') : null;
      return v && typeof v === 'object' ? v : fallback;
    } catch {
      return fallback;
    }
  }
  function writeJSON(kind, key, value) {
    try {
      const s = store(kind);
      if (s) s.setItem(key, JSON.stringify(value));
    } catch {}
  }
  const accounts = () => readJSON('local', ACCOUNTS_KEY, {});
  function setAccount(app, info) {
    const all = accounts();
    all[app] = info;
    writeJSON('local', ACCOUNTS_KEY, all);
  }
  function clearAccount(app) {
    const all = accounts();
    delete all[app];
    writeJSON('local', ACCOUNTS_KEY, all);
  }
  /*
   * Tokens are kept per tab (sessionStorage), but signing out, a different
   * student signing in, or Disconnect can happen in another tab. So every
   * read checks that the tokens still belong to the student this device says
   * is signed in (app/lib/averages.ts keeps averages_cloud_owner), and that
   * the app is still connected; otherwise this tab's copy is thrown away.
   */
  const OWNER_KEY = 'averages_cloud_owner';
  function owner() {
    try {
      const s = store('local');
      return (s && s.getItem(OWNER_KEY)) || '';
    } catch {
      return '';
    }
  }
  function dropAllTokens() {
    try {
      const s = store('session');
      if (s) s.removeItem(TOKENS_KEY);
    } catch {}
  }
  function tokens() {
    const raw = readJSON('session', TOKENS_KEY, {});
    if ((raw.owner || '') !== owner()) {
      dropAllTokens();
      return {};
    }
    const all = {};
    const acct = accounts();
    for (const app of ['gdrive', 'onedrive']) if (raw[app] && acct[app]) all[app] = raw[app];
    return all;
  }
  /** Tokens are written before "Connected as" is known, so writes don't filter by account. */
  function setToken(app, t) {
    const raw = readJSON('session', TOKENS_KEY, {});
    const all = (raw.owner || '') === owner() ? raw : {};
    all.owner = owner();
    all[app] = Object.assign({}, all[app] || {}, t);
    writeJSON('session', TOKENS_KEY, all);
  }
  function clearToken(app) {
    const raw = readJSON('session', TOKENS_KEY, {});
    delete raw[app];
    writeJSON('session', TOKENS_KEY, raw);
  }
  function rawToken(app) {
    const raw = readJSON('session', TOKENS_KEY, {});
    return (raw.owner || '') === owner() ? raw[app] || null : null;
  }
  // Another tab signed out, switched student or disconnected: forget this tab's tokens now.
  window.addEventListener('storage', (e) => {
    if (e.key === null || e.key === OWNER_KEY) dropAllTokens();
    else if (e.key === ACCOUNTS_KEY) tokens();
    if (e.key === null || e.key === OWNER_KEY || e.key === ACCOUNTS_KEY) window.dispatchEvent(new Event('averages-cloud-change'));
  });

  /* ── shared helpers ───────────────────────────────────────────────── */

  let configCache = null;
  /**
   * Public app IDs from our API: { google, microsoft }, each null when that
   * app isn't set up. `failed: true` when the API couldn't be reached; that
   * isn't cached, so the next call tries again.
   */
  function config() {
    if (configCache) return Promise.resolve(configCache);
    return fetch(API + '/config/cloud')
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (!c || typeof c !== 'object') return { google: null, microsoft: null, failed: true };
        configCache = { google: c.google || null, microsoft: c.microsoft || null };
        return configCache;
      })
      .catch(() => ({ google: null, microsoft: null, failed: true }));
  }

  const scripts = {};
  function loadScript(src) {
    if (!scripts[src]) {
      scripts[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => {
          delete scripts[src];
          reject(fail('network'));
        };
        document.head.appendChild(s);
      });
    }
    return scripts[src];
  }

  function b64url(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  const randomString = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));

  /**
   * A name both drives accept: characters they refuse become "_", no
   * trailing dots or spaces, and the names OneDrive reserves get a "_" in
   * front (CON, PRN, AUX, NUL, COM1-9, LPT1-9, desktop.ini, .lock, "~$..."
   * and anything containing "_vti_").
   */
  function safeName(name) {
    let n = String(name || 'File').replace(/[\\/:*?"<>|#%\u0000-\u001f]/g, '_').trim().slice(0, 200).replace(/[. ]+$/, '');
    if (!n) n = 'File';
    if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(n) || /^(desktop\.ini|\.lock)$/i.test(n) || n.startsWith('~$') || /_vti_/i.test(n)) n = '_' + n.replace(/_vti_/gi, '_vti');
    return n;
  }
  const stem = (name) => String(name || 'File').replace(/\.[A-Za-z0-9]{1,8}$/, '').trim() || 'File';
  const extOf = (name) => {
    const m = String(name || '').toLowerCase().match(/\.([a-z0-9]{1,8})$/);
    return m ? m[1] : '';
  };
  const MIME = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    txt: 'text/plain',
  };
  /** Office files become Google Docs, Slides or Sheets when they're uploaded for editing. */
  const GOOGLE_TYPE = {
    doc: 'application/vnd.google-apps.document',
    docx: 'application/vnd.google-apps.document',
    ppt: 'application/vnd.google-apps.presentation',
    pptx: 'application/vnd.google-apps.presentation',
    xls: 'application/vnd.google-apps.spreadsheet',
    xlsx: 'application/vnd.google-apps.spreadsheet',
  };

  /** Links we're willing to open: Google Docs/Drive and OneDrive file pages only. */
  function linkOk(url) {
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:' || u.username || u.password) return false;
      return /^(docs\.google\.com|drive\.google\.com|onedrive\.live\.com|1drv\.ms|[a-z0-9-]+-my\.sharepoint\.com)$/i.test(u.hostname);
    } catch {
      return false;
    }
  }

  /** One of the signed-in student's assignment files, from our API. */
  async function fetchAttachment(src) {
    const q = `section=${encodeURIComponent(src.section)}&assignment=${encodeURIComponent(src.assignment)}&file=${encodeURIComponent(src.fileId)}`;
    let r;
    try {
      r = await fetch(`${API}/data/attachment?${q}`, { credentials: 'include' });
    } catch {
      throw fail('network');
    }
    if (r.status === 401) throw fail('signed_out');
    if (!r.ok) throw fail('download_failed');
    if (Number(r.headers.get('Content-Length') || 0) > MAX_COPY_BYTES) throw fail('too_large');
    const blob = await r.blob();
    if (blob.size > MAX_COPY_BYTES) throw fail('too_large');
    const ext = extOf(src.name);
    return MIME[ext] && blob.type !== MIME[ext] ? new Blob([blob], { type: MIME[ext] }) : blob;
  }

  /* ── Google Drive ─────────────────────────────────────────────────── */

  let gClient = null;
  let gPending = null;
  let gConfig = null;

  /** Loads Google's sign-in script and readies the token client. Call on page load. */
  async function prepareGoogle() {
    const c = await config();
    if (c.failed) throw fail('network');
    if (!c.google || !c.google.clientId) throw fail('not_configured');
    gConfig = c.google;
    await loadScript('https://accounts.google.com/gsi/client');
    if (!gClient) {
      gClient = window.google.accounts.oauth2.initTokenClient({
        client_id: c.google.clientId,
        scope: GOOGLE_SCOPES,
        callback: (resp) => {
          const p = gPending;
          gPending = null;
          if (!p) return;
          if (!resp || resp.error || !resp.access_token) return p.reject(fail('denied'));
          // Google lets people untick individual permissions on the consent screen.
          if (!window.google.accounts.oauth2.hasGrantedAllScopes(resp, DRIVE_SCOPE)) return p.reject(fail('drive_not_allowed'));
          // A new sign-in may be a different Google account: its folder is looked up again.
          setToken('gdrive', { token: resp.access_token, exp: Date.now() + (Number(resp.expires_in) || 3600) * 1000, folder: '' });
          p.resolve(resp.access_token);
        },
        error_callback: (err) => {
          const p = gPending;
          gPending = null;
          if (p) p.reject(fail(err && err.type === 'popup_failed_to_open' ? 'popup_blocked' : 'popup_closed'));
        },
      });
    }
    return gConfig;
  }

  /**
   * A Google access token. Uses this tab's token while it's fresh; otherwise,
   * with `interactive`, asks Google (a popup, so call it inside a click and
   * before any await). Not async on purpose.
   */
  function googleToken(opts) {
    opts = opts || {};
    const t = tokens().gdrive;
    if (!opts.prompt && t && t.token && t.exp - 60000 > Date.now()) return Promise.resolve(t.token);
    if (!opts.interactive) return Promise.reject(fail('needs_click'));
    if (!gClient) return Promise.reject(fail('not_ready'));
    if (gPending) gPending.reject(fail('popup_closed'));
    return new Promise((resolve, reject) => {
      gPending = { resolve, reject };
      const acct = accounts().gdrive;
      // Nobody connected on this device yet: always show Google's account
      // chooser, so a browser still signed in to someone else's Google
      // account can't be used without the student seeing it.
      const ask = { prompt: opts.prompt || (acct ? '' : 'select_account') };
      if (acct && acct.email) ask.login_hint = acct.email;
      gClient.requestAccessToken(ask);
    });
  }

  async function gfetch(token, url, init) {
    init = init || {};
    let r;
    try {
      r = await fetch(url, Object.assign({}, init, { headers: Object.assign({ Authorization: 'Bearer ' + token }, init.headers || {}) }));
    } catch {
      throw fail('network');
    }
    if (r.status === 401) {
      clearToken('gdrive');
      throw fail('needs_click');
    }
    return r;
  }

  async function rememberGoogle(token) {
    let info = {};
    try {
      const r = await gfetch(token, 'https://openidconnect.googleapis.com/v1/userinfo');
      if (r.ok) info = await r.json();
    } catch {}
    const acct = { email: String(info.email || ''), name: String(info.name || '') };
    setAccount('gdrive', acct);
    return acct;
  }

  /** Connect from Settings: consent (account chooser), then remember who it is. */
  function connectGoogle() {
    return googleToken({ interactive: true, prompt: 'select_account' }).then(rememberGoogle);
  }

  /**
   * A token for Save / Edit / Files. Clicking one of those before connecting
   * in Settings connects too (same Google window), so it remembers the account
   * the first time. Not async: see googleToken.
   */
  function googleSession(opts) {
    const before = rawToken('gdrive');
    return googleToken(opts).then(async (token) => {
      // A sign-in window ran (new token), or nothing is remembered: check who it is.
      if (!accounts().gdrive || !before || before.token !== token) await rememberGoogle(token);
      return token;
    });
  }

  /** Forget Google here, and withdraw this token's access at Google when we still have one. */
  function disconnectGoogle() {
    const t = tokens().gdrive;
    try {
      if (t && t.token && window.google && window.google.accounts && window.google.accounts.oauth2) {
        window.google.accounts.oauth2.revoke(t.token, () => {});
      }
    } catch {}
    clearToken('gdrive');
    clearAccount('gdrive');
    writeJSON('local', DRAFTS_KEY, []);
  }

  /** The "Averages.io" folder in their Drive (drive.file only sees folders we made). */
  async function googleFolder(token) {
    const cached = tokens().gdrive;
    if (cached && cached.folder) return cached.folder;
    const q = encodeURIComponent(`name='${FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const found = await gfetch(token, `${DRIVE}/files?q=${q}&fields=files(id)&pageSize=1`);
    let id = found.ok ? ((await found.json()).files || [])[0]?.id : null;
    if (!id) {
      const made = await gfetch(token, `${DRIVE}/files?fields=id`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: FOLDER, mimeType: 'application/vnd.google-apps.folder' }),
      });
      if (!made.ok) throw fail('upload_failed');
      id = (await made.json()).id;
    }
    setToken('gdrive', { folder: id });
    return id;
  }

  const DRIVE_FIELDS = 'id,name,mimeType,webViewLink,modifiedTime';

  /** Uploads into the Averages.io folder. `convertTo` turns an Office file into a Google Doc/Slides/Sheet. */
  async function googleUpload(token, file) {
    try {
      return await googleUploadOnce(token, file);
    } catch (e) {
      // The remembered folder was deleted since: find or make it again, once.
      if (!e || e.code !== 'folder_gone') throw e;
      const t = tokens().gdrive;
      if (t) setToken('gdrive', { folder: '' });
      return googleUploadOnce(token, file);
    }
  }

  async function googleUploadOnce(token, file) {
    const folder = await googleFolder(token);
    const meta = { name: safeName(file.name), parents: [folder] };
    if (file.convertTo) meta.mimeType = file.convertTo;
    if (file.appProperties) meta.appProperties = file.appProperties;
    const type = file.blob.type || 'application/octet-stream';
    let res;
    if (file.blob.size <= 5 * 1024 * 1024) {
      const boundary = 'averages' + randomString(12);
      const body = new Blob([
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
        `--${boundary}\r\nContent-Type: ${type}\r\n\r\n`,
        file.blob,
        `\r\n--${boundary}--`,
      ]);
      res = await gfetch(token, `${DRIVE_UPLOAD}/files?uploadType=multipart&fields=${DRIVE_FIELDS}`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      });
    } else {
      // Bigger files: a resumable session, then the bytes in one PUT.
      const start = await gfetch(token, `${DRIVE_UPLOAD}/files?uploadType=resumable&fields=${DRIVE_FIELDS}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': type },
        body: JSON.stringify(meta),
      });
      if (start.status === 404) throw fail('folder_gone');
      const session = start.headers.get('Location');
      if (!start.ok || !session) throw fail('upload_failed');
      try {
        res = await fetch(session, { method: 'PUT', headers: { 'Content-Type': type }, body: file.blob });
      } catch {
        throw fail('network');
      }
    }
    if (res.status === 404) throw fail('folder_gone');
    if (!res.ok) throw fail(res.status === 403 ? 'drive_full_or_blocked' : 'upload_failed');
    return res.json();
  }

  /** One file we can see, or null when it's gone (deleted, or in the trash). */
  async function googleFile(token, id) {
    const r = await gfetch(token, `${DRIVE}/files/${encodeURIComponent(id)}?fields=${DRIVE_FIELDS},trashed`);
    if (r.status === 404) return null;
    if (!r.ok) throw fail('network');
    const f = await r.json();
    return f.trashed ? null : f;
  }

  /** Files Averages.io can see in their Drive (drive.file: ones it made or they picked), newest first. */
  async function googleList(token) {
    const q = encodeURIComponent("trashed=false and mimeType != 'application/vnd.google-apps.folder'");
    const r = await gfetch(token, `${DRIVE}/files?q=${q}&orderBy=modifiedTime desc&pageSize=50&fields=files(${DRIVE_FIELDS})`);
    if (!r.ok) throw fail('network');
    return ((await r.json()).files || []).filter((f) => f && f.id);
  }

  /** Google Picker: the student picks files, which drive.file then lets us see. */
  async function googlePick(token) {
    const c = gConfig || (await prepareGoogle());
    if (!c.apiKey || !c.appId) throw fail('not_configured');
    await loadScript('https://apis.google.com/js/api.js');
    await new Promise((resolve, reject) => window.gapi.load('picker', { callback: resolve, onerror: () => reject(fail('network')) }));
    const P = window.google.picker;
    return new Promise((resolve) => {
      const view = new P.DocsView(P.ViewId.DOCS).setIncludeFolders(false);
      const picker = new P.PickerBuilder()
        .addView(view)
        .enableFeature(P.Feature.MULTISELECT_ENABLED)
        .setOAuthToken(token)
        .setDeveloperKey(c.apiKey)
        .setAppId(c.appId)
        .setCallback((data) => {
          const action = data[P.Response.ACTION];
          if (action === P.Action.PICKED) resolve(data[P.Response.DOCUMENTS] || []);
          else if (action === P.Action.CANCEL) resolve([]);
        })
        .build();
      picker.setVisible(true);
    });
  }

  /* Edit in Google Drive drafts, kept on this device. */
  const allDrafts = () => {
    const v = readJSON('local', DRAFTS_KEY, []);
    return Array.isArray(v) ? v.filter((d) => d && d.fileId) : [];
  };
  function listDriveDrafts(section, assignment) {
    return allDrafts()
      .filter((d) => d.section === String(section) && d.assignment === String(assignment))
      .sort((a, b) => (b.modifiedTime || b.createdAt || 0) - (a.modifiedTime || a.createdAt || 0));
  }
  function saveDriveDraft(d) {
    const all = allDrafts().filter((x) => x.fileId !== d.fileId);
    all.push(d);
    writeJSON('local', DRAFTS_KEY, all.slice(-200));
  }
  function removeDriveDraft(fileId) {
    writeJSON('local', DRAFTS_KEY, allDrafts().filter((d) => d.fileId !== fileId));
  }

  /**
   * Brings this assignment's Drive drafts up to date with their Drive: new
   * names and edit times, and drafts whose file was deleted are dropped.
   * Only with a token this tab already has (no sign-in window).
   */
  async function refreshDriveDrafts(section, assignment) {
    const t = tokens().gdrive;
    if (!t || !t.token || t.exp - 60000 <= Date.now()) return false;
    let changed = false;
    for (const d of listDriveDrafts(section, assignment)) {
      let f;
      try {
        f = await googleFile(t.token, d.fileId);
      } catch {
        return changed;
      }
      if (!f) {
        removeDriveDraft(d.fileId);
        changed = true;
        continue;
      }
      const modifiedTime = Date.parse(f.modifiedTime) || d.modifiedTime;
      if (f.name !== d.name || modifiedTime !== d.modifiedTime || f.webViewLink !== d.webViewLink) {
        saveDriveDraft(Object.assign({}, d, { name: f.name, modifiedTime, webViewLink: f.webViewLink }));
        changed = true;
      }
    }
    return changed;
  }

  /**
   * Edit in Google Drive: copies the assignment file into their Drive as a
   * Google Doc / Slides / Sheet and records it as a draft. A file already in
   * Drafts is reused while it still exists in their Drive.
   */
  async function editInGoogleDrive(token, src) {
    const ext = extOf(src.name);
    if (!GOOGLE_TYPE[ext]) throw fail('not_editable');
    const existing = allDrafts().find(
      (d) => d.section === String(src.section) && d.assignment === String(src.assignment) && d.sourceFileId === String(src.fileId),
    );
    if (existing) {
      const f = await googleFile(token, existing.fileId);
      if (f) {
        const d = Object.assign({}, existing, { name: f.name, webViewLink: f.webViewLink, modifiedTime: Date.parse(f.modifiedTime) || existing.modifiedTime });
        saveDriveDraft(d);
        return Object.assign({ reused: true }, d);
      }
      removeDriveDraft(existing.fileId);
    }
    const blob = await fetchAttachment(src);
    const f = await googleUpload(token, {
      name: stem(src.name),
      blob,
      convertTo: GOOGLE_TYPE[ext],
      appProperties: { averagesSection: String(src.section), averagesAssignment: String(src.assignment), averagesFile: String(src.fileId) },
    });
    const d = {
      fileId: f.id,
      name: f.name,
      webViewLink: f.webViewLink,
      ext,
      section: String(src.section),
      assignment: String(src.assignment),
      sourceFileId: String(src.fileId),
      createdAt: Date.now(),
      modifiedTime: Date.parse(f.modifiedTime) || Date.now(),
    };
    saveDriveDraft(d);
    return Object.assign({ reused: false }, d);
  }

  /* ── OneDrive (Microsoft) ─────────────────────────────────────────── */

  /*
   * Microsoft's sign-in pages send a Cross-Origin-Opener-Policy header, which
   * cuts the popup off from this page: in the popup window.opener is null,
   * and here popup.closed reads true while it's still open. So the redirect
   * page (/auth/microsoftgraph) answers on a BroadcastChannel, which only
   * reaches pages on our own origin, with window.opener as a fallback, and an
   * answer is matched to its sign-in by that sign-in's random state.
   */
  const msRedirect = () => window.location.origin + '/auth/microsoftgraph';
  const msWaits = new Map(); // state -> handler(params)
  function msAnswer(d) {
    if (!d || d.type !== 'averages-ms-auth' || typeof d.params !== 'string') return;
    const st = new URLSearchParams(d.params.replace(/^[?#]/, '')).get('state') || '';
    const handler = st && msWaits.get(st);
    if (handler) handler(d.params);
  }
  window.addEventListener('message', (e) => {
    if (e.origin === window.location.origin) msAnswer(e.data);
  });
  try {
    const ch = new BroadcastChannel('averages-ms-auth');
    ch.onmessage = (e) => msAnswer(e.data);
  } catch {}

  function openAuthPopup() {
    const w = window.open('', 'averages-ms-auth', 'width=520,height=680');
    if (!w) throw fail('popup_blocked');
    try {
      w.document.title = 'Connecting OneDrive';
      w.document.body.style.font = '15px system-ui, sans-serif';
      w.document.body.textContent = 'Connecting to Microsoft…';
    } catch {}
    return w;
  }

  /** The claims of a Microsoft id_token, for showing who's connected. Not a security check. */
  function claimsOf(idToken) {
    try {
      const part = String(idToken).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(
        atob(part + '='.repeat((4 - (part.length % 4)) % 4))
          .split('')
          .map((ch) => '%' + ch.charCodeAt(0).toString(16).padStart(2, '0'))
          .join(''),
      );
      return JSON.parse(json);
    } catch {
      return {};
    }
  }

  async function msTokenRequest(clientId, fields) {
    let r;
    try {
      r = await fetch(`${MS_AUTH}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(Object.assign({ client_id: clientId, scope: MS_SCOPES }, fields)).toString(),
      });
    } catch {
      throw fail('network');
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw fail(j.error === 'invalid_grant' ? 'needs_click' : 'denied');
    const t = { access: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
    if (j.refresh_token) t.refresh = j.refresh_token;
    setToken('onedrive', t);
    if (j.id_token) {
      const c = claimsOf(j.id_token);
      setAccount('onedrive', { username: String(c.preferred_username || c.email || ''), name: String(c.name || '') });
    } else if (!accounts().onedrive) {
      setAccount('onedrive', { username: '', name: '' });
    }
    return t.access;
  }

  function msExchange(clientId, params, state, verifier) {
    const got = new URLSearchParams(String(params).replace(/^[?#]/, ''));
    if (got.get('state') !== state || got.get('error') || !got.get('code')) return Promise.reject(fail('denied'));
    return msTokenRequest(clientId, {
      grant_type: 'authorization_code',
      code: got.get('code'),
      redirect_uri: msRedirect(),
      code_verifier: verifier,
    });
  }

  let msCancel = null; // ends the sign-in in progress when a new one starts

  /**
   * Waits for the redirect page's answer. Because popup.closed can't be
   * trusted (see above), "the student closed it" is: the window reads as
   * closed AND this page has had the focus back for a moment. If the student
   * then finishes in a window we gave up on, the late answer still connects
   * OneDrive (pages hear 'averages-cloud-change').
   */
  function msWait(popup, state, late) {
    return new Promise((resolve, reject) => {
      let focusSince = 0;
      const timer = setInterval(() => {
        let closed = true;
        try {
          closed = popup.closed;
        } catch {}
        if (!closed || !document.hasFocus()) {
          focusSince = 0;
          return;
        }
        if (!focusSince) focusSince = Date.now();
        else if (Date.now() - focusSince > 1500) giveUp();
      }, 300);
      const finish = () => {
        clearInterval(timer);
        if (msCancel === giveUp) msCancel = null;
      };
      function giveUp() {
        finish();
        msWaits.set(state, (p) => {
          msWaits.delete(state);
          late(p);
        });
        setTimeout(() => msWaits.delete(state), 10 * 60 * 1000);
        reject(fail('popup_closed'));
      }
      msWaits.set(state, (p) => {
        msWaits.delete(state);
        finish();
        resolve(p);
      });
      msCancel = giveUp;
    });
  }

  async function msLogin(popup, prompt) {
    if (msCancel) msCancel();
    try {
      const c = await config();
      if (c.failed) throw fail('network');
      if (!c.microsoft || !c.microsoft.clientId) throw fail('not_configured');
      const clientId = c.microsoft.clientId;
      const verifier = randomString(48);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
      const state = randomString(24);
      const q = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: msRedirect(),
        response_mode: 'query',
        scope: MS_SCOPES,
        state,
        code_challenge: b64url(new Uint8Array(digest)),
        code_challenge_method: 'S256',
      });
      const acct = accounts().onedrive;
      if (prompt) q.set('prompt', prompt);
      else if (acct && acct.username) q.set('login_hint', acct.username);
      else q.set('prompt', 'select_account'); // nobody connected here yet: never pick an account silently
      popup.location.href = `${MS_AUTH}/authorize?${q}`;
      const params = await msWait(popup, state, (p) =>
        msExchange(clientId, p, state, verifier)
          .then(() => window.dispatchEvent(new Event('averages-cloud-change')))
          .catch(() => {}),
      );
      return await msExchange(clientId, params, state, verifier);
    } finally {
      try {
        if (!popup.closed) popup.close();
      } catch {}
    }
  }

  /**
   * A Microsoft Graph access token: this tab's while fresh, else a refresh
   * (no click needed), else, with `interactive`, the sign-in popup. Not async
   * on purpose: the popup has to open inside the click.
   */
  function oneDriveToken(opts) {
    opts = opts || {};
    const t = tokens().onedrive;
    if (!opts.prompt && t && t.access && t.exp - 60000 > Date.now()) return Promise.resolve(t.access);
    if (!opts.prompt && t && t.refresh) {
      return config().then((c) => {
        if (c.failed) throw fail('network');
        if (!c.microsoft) throw fail('not_configured');
        return msTokenRequest(c.microsoft.clientId, { grant_type: 'refresh_token', refresh_token: t.refresh }).catch((e) => {
          clearToken('onedrive');
          throw e.code === 'network' ? e : fail('needs_click');
        });
      });
    }
    if (!opts.interactive) return Promise.reject(fail('needs_click'));
    let popup;
    try {
      popup = openAuthPopup();
    } catch (e) {
      return Promise.reject(e);
    }
    return msLogin(popup, opts.prompt);
  }

  function connectOneDrive() {
    return oneDriveToken({ interactive: true, prompt: 'select_account' }).then(() => accounts().onedrive || { username: '', name: '' });
  }

  /** Forget Microsoft here. (A single-page app can't revoke; its refresh token dies within a day.) */
  function disconnectOneDrive() {
    clearToken('onedrive');
    clearAccount('onedrive');
  }

  async function mfetch(token, url, init) {
    init = init || {};
    let r;
    try {
      r = await fetch(url, Object.assign({}, init, { headers: Object.assign({ Authorization: 'Bearer ' + token }, init.headers || {}) }));
    } catch {
      throw fail('network');
    }
    if (r.status === 401) {
      if (rawToken('onedrive')) setToken('onedrive', { access: '', exp: 0 });
      throw fail('needs_click');
    }
    return r;
  }

  /*
   * OneDrive's app folder: Files.ReadWrite.AppFolder only reaches
   * Apps/Averages.io (named after the Microsoft app), never the rest of the
   * student's OneDrive. Works for school and personal accounts. Microsoft
   * makes the folder the first time it's used.
   */
  const APPROOT = '/me/drive/special/approot';
  const ONEDRIVE_SELECT = 'id,name,webUrl,lastModifiedDateTime,file,size';

  /** Uploads into Apps/Averages.io. Same name already there: OneDrive adds a number. */
  async function oneDriveUpload(token, file) {
    const path = `${APPROOT}:/${encodeURIComponent(safeName(file.name))}:`;
    let res;
    if (file.blob.size <= 4 * 1024 * 1024) {
      res = await mfetch(token, `${GRAPH}${path}/content?@microsoft.graph.conflictBehavior=rename`, {
        method: 'PUT',
        headers: { 'Content-Type': file.blob.type || 'application/octet-stream' },
        body: file.blob,
      });
    } else {
      const s = await mfetch(token, `${GRAPH}${path}/createUploadSession`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'rename' } }),
      });
      const uploadUrl = s.ok ? (await s.json()).uploadUrl : '';
      if (!uploadUrl || !/^https:\/\//i.test(uploadUrl)) throw fail('upload_failed');
      // Pieces must be multiples of 320 KiB; 16 of them is 5 MiB. The upload URL authorises itself.
      const CHUNK = 320 * 1024 * 16;
      for (let start = 0; start < file.blob.size; start += CHUNK) {
        const end = Math.min(start + CHUNK, file.blob.size);
        try {
          res = await fetch(uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Range': `bytes ${start}-${end - 1}/${file.blob.size}` },
            body: file.blob.slice(start, end),
          });
        } catch {
          throw fail('network');
        }
        if (!res.ok) throw fail('upload_failed');
      }
    }
    if (!res.ok) throw fail(res.status === 507 ? 'drive_full_or_blocked' : 'upload_failed');
    const item = await res.json();
    return { id: item.id, name: item.name, webUrl: item.webUrl, modified: item.lastModifiedDateTime };
  }

  /** What's in Apps/Averages.io, newest first. */
  async function oneDriveList(token) {
    const r = await mfetch(token, `${GRAPH}${APPROOT}/children?$top=100&$select=${ONEDRIVE_SELECT}`);
    if (r.status === 404) return [];
    if (!r.ok) throw fail('network');
    return ((await r.json()).value || [])
      .filter((i) => i && i.file)
      .sort((a, b) => Date.parse(b.lastModifiedDateTime || 0) - Date.parse(a.lastModifiedDateTime || 0));
  }

  /* ── messages ─────────────────────────────────────────────────────── */

  const MESSAGES = {
    not_configured: 'This isn’t switched on yet.',
    not_ready: 'Google sign-in is still loading. Try again in a second.',
    network: 'Couldn’t connect right now. Check your internet and try again.',
    needs_click: 'Your sign-in ran out. Click again to sign back in.',
    popup_blocked: 'Your browser blocked the sign-in window. Allow pop-ups for this site, then try again.',
    popup_closed: 'The sign-in window closed before it finished. If it said your school blocks Averages.io, your school’s IT team has to allow it first.',
    denied: 'Access wasn’t allowed, so nothing was changed.',
    drive_not_allowed: 'Google Drive access wasn’t ticked. Connect again and leave “See, edit, create, and delete only the specific Google Drive files you use with this app” ticked.',
    too_large: 'This file is too big to copy (250 MB max).',
    not_editable: 'Only Word, PowerPoint and Excel files open in Google Docs, Slides and Sheets.',
    drive_full_or_blocked: 'Your drive refused the file. It may be full, or your school may block uploads.',
    signed_out: 'You’ve been signed out of Averages.io. Sign in again.',
    download_failed: 'Couldn’t get the file from your school. Try again.',
  };
  function messageFor(error) {
    const code = error && error.code ? error.code : String(error && error.message ? error.message : error || '');
    return MESSAGES[code] || 'Something went wrong. Try again in a moment.';
  }

  window.AveragesCloud = {
    // shared
    config,
    accounts,
    hasToken: (app) => {
      const t = tokens()[app];
      return !!(t && ((t.token && t.exp - 60000 > Date.now()) || (t.access && t.exp - 60000 > Date.now()) || t.refresh));
    },
    fetchAttachment,
    linkOk,
    messageFor,
    extOf,
    GOOGLE_TYPE,
    // Google Drive
    prepareGoogle,
    googleReady: () => !!gClient,
    googleToken,
    googleSession,
    connectGoogle,
    disconnectGoogle,
    googleUpload,
    googleFile,
    googleList,
    googlePick,
    editInGoogleDrive,
    listDriveDrafts,
    removeDriveDraft,
    refreshDriveDrafts,
    // OneDrive
    oneDriveToken,
    connectOneDrive,
    disconnectOneDrive,
    oneDriveUpload,
    oneDriveList,
  };
  window.dispatchEvent(new Event('averages-cloud-ready'));
})();
