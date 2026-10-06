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
 *                 Files.ReadWrite.AppFolder: saving only ever goes into its
 *                 own Apps/Averages.io folder.
 *                 Add from OneDrive (2026-10-06) also needs Files.Read
 *                 (read-only), asked for the first time Add from OneDrive is
 *                 clicked and nowhere else (incremental consent). It's a
 *                 separate token ("onedriveRead"); everything else keeps the
 *                 app-folder token. Our own picker (oneDrivePick) browses
 *                 their OneDrive with it, and only the files they pick are
 *                 listed. Nothing is ever written outside Apps/Averages.io.
 *
 * Where things are kept (all on this device only):
 *   sessionStorage averages_cloud_tokens    access/refresh tokens, per app:
 *                                           gdrive, onedrive (app folder) and
 *                                           onedriveRead (+ Files.Read). Gone
 *                                           when the tab closes, which matters
 *                                           on shared school Chromebooks.
 *   localStorage   averages_cloud_accounts  which account is connected
 *                                           ("Connected as ...").
 *   localStorage   averages_drive_drafts    Edit in Google Drive drafts.
 *   localStorage   averages_onedrive_picked files picked with Add from
 *                                           OneDrive: [{ id, name }], newest
 *                                           first, at most 200. Only ids and
 *                                           names; each is looked up again.
 * Signing out of Averages.io clears all four (app/lib/averages.ts); a
 * different Microsoft account or Disconnect forgets the picked files too.
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
  const PICKED_KEY = 'averages_onedrive_picked';
  const MAX_PICKED = 200;
  const FOLDER = 'Averages.io';
  const MAX_COPY_BYTES = 250 * 1024 * 1024;
  // Turning in (2026-10-06): Schoology takes files up to 95 MB, so a file
  // fetched from a drive to attach stops there instead of downloading for nothing.
  const MAX_ATTACH_BYTES = 95 * 1024 * 1024;

  const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const GOOGLE_SCOPES = DRIVE_SCOPE + ' openid email profile';
  const DRIVE = 'https://www.googleapis.com/drive/v3';
  const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
  const MS_AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0';
  const MS_SCOPES = 'openid profile offline_access User.Read Files.ReadWrite.AppFolder';
  // The read token (Add from OneDrive) asks for everything above plus Files.Read.
  const MS_READ_SCOPES = MS_SCOPES + ' Files.Read';
  const MS_SLOT_SCOPES = { onedrive: MS_SCOPES, onedriveRead: MS_READ_SCOPES };
  const GRAPH = 'https://graph.microsoft.com/v1.0';
  // OneDrive item ids: "ABC123!456" (personal) or "01ABC..." (school).
  const ITEM_ID = /^[A-Za-z0-9!_.-]{1,200}$/;

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
    // The read token (2026-10-06) belongs to the same connected Microsoft account.
    if (raw.onedriveRead && acct.onedrive) all.onedriveRead = raw.onedriveRead;
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
  /*
   * Files picked with Add from OneDrive (2026-10-06), newest first. Ids and
   * names only: the rest is asked of Microsoft Graph again whenever they're
   * listed, so a file renamed or deleted in OneDrive shows that here too.
   */
  function pickedList() {
    const v = readJSON('local', PICKED_KEY, []);
    if (!Array.isArray(v)) return [];
    const seen = new Set();
    return v
      .filter((p) => p && typeof p.id === 'string' && ITEM_ID.test(p.id) && !seen.has(p.id) && seen.add(p.id))
      .map((p) => ({ id: p.id, name: String(p.name || '').slice(0, 300) }));
  }
  function rememberPicked(items) {
    const fresh = items.filter((i) => i && ITEM_ID.test(String(i.id || ''))).map((i) => ({ id: String(i.id), name: String(i.name || '').slice(0, 300) }));
    const ids = new Set(fresh.map((i) => i.id));
    writeJSON('local', PICKED_KEY, fresh.concat(pickedList().filter((p) => !ids.has(p.id))).slice(0, MAX_PICKED));
  }
  function forgetPicked(ids) {
    const gone = new Set(ids);
    writeJSON('local', PICKED_KEY, pickedList().filter((p) => !gone.has(p.id)));
  }
  function clearPicked() {
    try {
      const s = store('local');
      if (s) s.removeItem(PICKED_KEY);
    } catch {}
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

  /**
   * One of the signed-in student's course files, from our API: attached to an
   * assignment (`src.assignment`) or to a Materials document (`src.document`).
   */
  async function fetchAttachment(src) {
    const parent = src.document ? `document=${encodeURIComponent(src.document)}` : `assignment=${encodeURIComponent(src.assignment)}`;
    const q = `section=${encodeURIComponent(src.section)}&${parent}&file=${encodeURIComponent(src.fileId)}`;
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

  // size (2026-10-06): the Files page adds up its files' sizes. Google Docs, Sheets and Slides have none.
  const DRIVE_FIELDS = 'id,name,mimeType,webViewLink,modifiedTime,size';

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

  /** A file name that's safe to hand on: no path separators or control characters. */
  function plainName(name) {
    return String(name || '').replace(/[\\/\u0000-\u001f\u007f]/g, '_').trim().slice(0, 200) || 'File';
  }
  // Google's own formats have no bytes to download: they're exported as a PDF.
  const GOOGLE_EXPORTS = new Set([
    'application/vnd.google-apps.document',
    'application/vnd.google-apps.spreadsheet',
    'application/vnd.google-apps.presentation',
    'application/vnd.google-apps.drawing',
  ]);

  /**
   * One of their Google Drive files as bytes, for turning in (2026-10-06):
   * { blob, name, mimeType }. Docs, Sheets, Slides and Drawings come as a PDF
   * named "<name>.pdf". drive.file only reaches files Averages.io made or
   * they picked, which are the ones Files shows. Stops at 95 MB.
   */
  async function googleDownload(token, fileId) {
    const id = String(fileId || '');
    if (!/^[A-Za-z0-9_-]{10,200}$/.test(id)) throw fail('file_gone');
    const meta = await gfetch(token, `${DRIVE}/files/${encodeURIComponent(id)}?fields=id,name,mimeType,size,trashed`);
    if (meta.status === 404) throw fail('file_gone');
    if (!meta.ok) throw fail(meta.status === 403 ? 'download_blocked' : 'cloud_download_failed');
    const f = await meta.json().catch(() => ({}));
    if (f.trashed) throw fail('file_gone');
    const mime = String(f.mimeType || '');
    let name = plainName(f.name);
    let type;
    let r;
    if (GOOGLE_EXPORTS.has(mime)) {
      r = await gfetch(token, `${DRIVE}/files/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent('application/pdf')}`);
      if (r.status === 403) {
        // Google only exports files up to 10 MB.
        const j = await r.json().catch(() => ({}));
        const reason = j && j.error && Array.isArray(j.error.errors) && j.error.errors[0] ? j.error.errors[0].reason : '';
        throw fail(reason === 'exportSizeLimitExceeded' ? 'export_too_large' : 'download_blocked');
      }
      if (!/\.pdf$/i.test(name)) name += '.pdf';
      type = 'application/pdf';
    } else if (mime.startsWith('application/vnd.google-apps.')) {
      throw fail('not_downloadable'); // Forms, Sites, folders, shortcuts...
    } else {
      if (Number(f.size) > MAX_ATTACH_BYTES) throw fail('file_too_large');
      r = await gfetch(token, `${DRIVE}/files/${encodeURIComponent(id)}?alt=media`);
      if (r.status === 403) throw fail('download_blocked');
      type = mime || MIME[extOf(name)] || 'application/octet-stream';
    }
    if (r.status === 404) throw fail('file_gone');
    if (!r.ok) throw fail('cloud_download_failed');
    if (Number(r.headers.get('Content-Length') || 0) > MAX_ATTACH_BYTES) throw fail('file_too_large');
    let blob;
    try {
      blob = await r.blob();
    } catch {
      throw fail('network');
    }
    if (blob.size > MAX_ATTACH_BYTES) throw fail('file_too_large');
    return { blob: blob.type === type ? blob : new Blob([blob], { type }), name, mimeType: type };
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

  /**
   * `slot` (2026-10-06): 'onedrive' is the app-folder token everything uses;
   * 'onedriveRead' is the one with Files.Read too, for Add from OneDrive.
   */
  async function msTokenRequest(clientId, fields, slot) {
    slot = slot || 'onedrive';
    let r;
    try {
      r = await fetch(`${MS_AUTH}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(Object.assign({ client_id: clientId, scope: MS_SLOT_SCOPES[slot] }, fields)).toString(),
      });
    } catch {
      throw fail('network');
    }
    const j = await r.json().catch(() => ({}));
    // A quiet try at the read token without consent answers invalid_grant
    // (consent_required); interaction_required is the same "needs the window".
    const again = j.error === 'invalid_grant' || (slot === 'onedriveRead' && (j.error === 'interaction_required' || j.error === 'consent_required'));
    if (!r.ok || !j.access_token) throw fail(again ? 'needs_click' : 'denied');
    const t = { access: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
    if (j.refresh_token) t.refresh = j.refresh_token;
    setToken(slot, t);
    if (j.id_token) {
      const c = claimsOf(j.id_token);
      const username = String(c.preferred_username || c.email || '');
      const before = accounts().onedrive;
      // A different Microsoft account: the other token and the picked files were the last one's.
      if (before && before.username && username && before.username.toLowerCase() !== username.toLowerCase()) {
        clearToken(slot === 'onedrive' ? 'onedriveRead' : 'onedrive');
        clearPicked();
      }
      setAccount('onedrive', { username, name: String(c.name || '') });
    } else if (!accounts().onedrive) {
      setAccount('onedrive', { username: '', name: '' });
    }
    if (slot === 'onedriveRead') readQuietFailed = false;
    return t.access;
  }

  function msExchange(clientId, params, state, verifier, slot) {
    const got = new URLSearchParams(String(params).replace(/^[?#]/, ''));
    if (got.get('state') !== state || got.get('error') || !got.get('code')) return Promise.reject(fail('denied'));
    return msTokenRequest(
      clientId,
      {
        grant_type: 'authorization_code',
        code: got.get('code'),
        redirect_uri: msRedirect(),
        code_verifier: verifier,
      },
      slot,
    );
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

  async function msLogin(popup, prompt, slot) {
    slot = slot || 'onedrive';
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
        scope: MS_SLOT_SCOPES[slot],
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
        msExchange(clientId, p, state, verifier, slot)
          .then(() => window.dispatchEvent(new Event('averages-cloud-change')))
          .catch(() => {}),
      );
      return await msExchange(clientId, params, state, verifier, slot);
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
    if (opts.read) return oneDriveReadToken(opts);
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
    // This tab only signed in for Add from OneDrive (2026-10-06): the same
    // sign-in gives the app-folder token too, without a window. Tried once.
    const rd = tokens().onedriveRead;
    if (!opts.prompt && rd && rd.refresh && !baseFromReadFailed) {
      return config().then((c) => {
        if (c.failed) throw fail('network');
        if (!c.microsoft) throw fail('not_configured');
        return msTokenRequest(c.microsoft.clientId, { grant_type: 'refresh_token', refresh_token: rd.refresh }, 'onedrive').catch((e) => {
          if (e.code !== 'network') baseFromReadFailed = true;
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

  /*
   * The read token (Add from OneDrive, 2026-10-06). Incremental consent: the
   * first time, Microsoft's window asks for read access on top of what the
   * student already allowed. After that a refresh token gets it quietly: the
   * read token's own, or the app-folder one (Microsoft's refresh tokens work
   * for any permission the student has allowed this app). Without
   * `interactive` it never opens a window; Files uses that to look up the
   * picked files.
   */
  let readQuietFailed = false; // the quiet try failed (read access never allowed): don't keep asking
  let baseFromReadFailed = false;
  function quietReadToken() {
    const rd = tokens().onedriveRead;
    const base = tokens().onedrive;
    return config().then((c) => {
      if (c.failed) throw fail('network');
      if (!c.microsoft) throw fail('not_configured');
      const id = c.microsoft.clientId;
      const viaBase = () => {
        if (!base || !base.refresh || readQuietFailed) throw fail('needs_click');
        return msTokenRequest(id, { grant_type: 'refresh_token', refresh_token: base.refresh }, 'onedriveRead');
      };
      const first = rd && rd.refresh
        ? msTokenRequest(id, { grant_type: 'refresh_token', refresh_token: rd.refresh }, 'onedriveRead').catch((e) => {
            if (e.code === 'network') throw e;
            clearToken('onedriveRead');
            return viaBase();
          })
        : Promise.resolve().then(viaBase);
      return first.catch((e) => {
        if (e.code === 'network') throw e;
        readQuietFailed = true;
        throw fail('needs_click');
      });
    });
  }
  function oneDriveReadToken(opts) {
    const rd = tokens().onedriveRead;
    if (!opts.prompt && rd && rd.access && rd.exp - 60000 > Date.now()) return Promise.resolve(rd.access);
    const base = tokens().onedrive;
    const canQuiet = !opts.prompt && ((rd && rd.refresh) || (base && base.refresh && !readQuietFailed));
    if (!opts.interactive) return canQuiet ? quietReadToken() : Promise.reject(fail('needs_click'));
    // Same as the app-folder token: its own refresh token is used without a window.
    if (!opts.prompt && rd && rd.refresh) return quietReadToken();
    // The window opens now, inside the click. When read access was allowed
    // before (in another tab, say), the quiet way works and it just closes.
    let popup;
    try {
      popup = openAuthPopup();
    } catch (e) {
      return Promise.reject(e);
    }
    if (!canQuiet) return msLogin(popup, opts.prompt, 'onedriveRead');
    return quietReadToken().then(
      (token) => {
        try {
          popup.close();
        } catch {}
        return token;
      },
      (e) => {
        if (e.code !== 'network') return msLogin(popup, opts.prompt, 'onedriveRead');
        try {
          popup.close();
        } catch {}
        throw e;
      },
    );
  }

  function connectOneDrive() {
    return oneDriveToken({ interactive: true, prompt: 'select_account' }).then(() => accounts().onedrive || { username: '', name: '' });
  }

  /** Forget Microsoft here. (A single-page app can't revoke; its refresh token dies within a day.) */
  function disconnectOneDrive() {
    clearToken('onedrive');
    clearToken('onedriveRead');
    clearAccount('onedrive');
    clearPicked();
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
      const rd = rawToken('onedriveRead');
      if (rd && rd.access === token) setToken('onedriveRead', { access: '', exp: 0 });
      else if (rawToken('onedrive')) setToken('onedrive', { access: '', exp: 0 });
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

  /**
   * What's in Apps/Averages.io plus the files picked with Add from OneDrive
   * (2026-10-06, `picked: true`), newest first.
   */
  async function oneDriveList(token) {
    const r = await mfetch(token, `${GRAPH}${APPROOT}/children?$top=100&$select=${ONEDRIVE_SELECT}`);
    let own = [];
    if (r.status !== 404) {
      if (!r.ok) throw fail('network');
      own = ((await r.json()).value || []).filter((i) => i && i.file);
    }
    const ids = new Set(own.map((i) => i.id));
    const picked = (await pickedFiles()).filter((i) => !ids.has(i.id));
    return own.concat(picked).sort((a, b) => Date.parse(b.lastModifiedDateTime || 0) - Date.parse(a.lastModifiedDateTime || 0));
  }

  /*
   * The picked files, looked up again by id with the read token, 20 to a
   * Graph $batch request. Only when this tab can get a read token without a
   * window; otherwise none are listed (never names Microsoft hasn't
   * confirmed, so a shared device can't show someone else's). A file that's
   * gone (deleted, or not this account's) is forgotten.
   */
  async function pickedFiles() {
    const list = pickedList();
    if (!list.length) return [];
    let token;
    try {
      token = await oneDriveToken({ read: true });
    } catch {
      return [];
    }
    const found = [];
    const gone = [];
    const renamed = new Map();
    for (let i = 0; i < list.length; i += 20) {
      const part = list.slice(i, i + 20);
      let answers;
      try {
        const r = await mfetch(token, `${GRAPH}/$batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requests: part.map((p, k) => ({ id: String(k), method: 'GET', url: `/me/drive/items/${encodeURIComponent(p.id)}?$select=${ONEDRIVE_SELECT}` })) }),
        });
        if (!r.ok) break;
        answers = (await r.json()).responses;
      } catch {
        break;
      }
      for (const a of Array.isArray(answers) ? answers : []) {
        const p = a && part[Number(a.id)];
        if (!p) continue;
        const item = a.body || {};
        if (a.status === 200 && item.file && item.id === p.id) {
          found.push(Object.assign({}, item, { picked: true }));
          if (item.name && item.name !== p.name) renamed.set(p.id, String(item.name));
        } else if (a.status === 404 || a.status === 410 || (a.status === 200 && !item.file)) {
          gone.push(p.id);
        }
      }
    }
    if (gone.length) forgetPicked(gone);
    if (renamed.size) writeJSON('local', PICKED_KEY, pickedList().map((p) => (renamed.has(p.id) ? { id: p.id, name: renamed.get(p.id) } : p)));
    return found;
  }

  /**
   * One OneDrive file as bytes, for turning in (2026-10-06): { blob, name,
   * mimeType }. Works with the app-folder token for files in Apps/Averages.io
   * and needs the read token for picked ones. Stops at 95 MB.
   *
   * Graph's /content answers with a redirect, which browsers won't follow on
   * a request that carries an Authorization header from another site, so the
   * file's own short-lived download link (@microsoft.graph.downloadUrl, which
   * needs no header) is used first, and /content only when there isn't one.
   */
  async function oneDriveDownload(token, id) {
    id = String(id || '');
    if (!ITEM_ID.test(id)) throw fail('file_gone');
    const meta = await mfetch(token, `${GRAPH}/me/drive/items/${encodeURIComponent(id)}`);
    if (meta.status === 404) {
      forgetPicked([id]);
      throw fail('file_gone');
    }
    if (meta.status === 403) throw fail('read_access_needed');
    if (!meta.ok) throw fail('cloud_download_failed');
    const item = await meta.json().catch(() => ({}));
    if (!item.file) throw fail('not_downloadable');
    if (Number(item.size) > MAX_ATTACH_BYTES) throw fail('file_too_large');
    const direct = String(item['@microsoft.graph.downloadUrl'] || '');
    let r = null;
    if (/^https:\/\//i.test(direct)) {
      try {
        r = await fetch(direct, { credentials: 'omit', referrerPolicy: 'no-referrer' });
      } catch {
        r = null;
      }
    }
    if (!r || !r.ok) r = await mfetch(token, `${GRAPH}/me/drive/items/${encodeURIComponent(id)}/content`);
    if (r.status === 404) throw fail('file_gone');
    if (!r.ok) throw fail('cloud_download_failed');
    if (Number(r.headers.get('Content-Length') || 0) > MAX_ATTACH_BYTES) throw fail('file_too_large');
    let blob;
    try {
      blob = await r.blob();
    } catch {
      throw fail('network');
    }
    if (blob.size > MAX_ATTACH_BYTES) throw fail('file_too_large');
    const name = plainName(item.name);
    const type = String((item.file && item.file.mimeType) || '') || MIME[extOf(name)] || blob.type || 'application/octet-stream';
    return { blob: blob.type === type ? blob : new Blob([blob], { type }), name, mimeType: type };
  }

  /* ── Add from OneDrive: our own picker (2026-10-06) ───────────────── */

  /*
   * Microsoft's own File Picker is a whole page from Microsoft in a frame,
   * with its own look and its own sign-in. This is a plain window in the
   * app's style over Microsoft Graph, with the read token: browse folders
   * (breadcrumbs to go back up), search the whole OneDrive, tick files (not
   * folders) in any folder, then Add. Keyboard: Tab, arrow keys between
   * rows, Space/Enter ticks a file or opens a folder, Escape cancels.
   * Resolves with [{ id, name, size, mimeType, webUrl }] ([] when cancelled)
   * and remembers the picks (averages_onedrive_picked). The page's own
   * colour tokens (--panel-bg, --accent...) theme it, with light fallbacks.
   */
  const PICK_SELECT = 'id,name,size,file,folder,webUrl,lastModifiedDateTime,package,remoteItem';
  const PICK_BADGE = {
    pdf: ['PDF', '#c1443a'], doc: ['DOC', '#3b6fd1'], docx: ['DOCX', '#3b6fd1'], ppt: ['PPT', '#d1852f'], pptx: ['PPTX', '#d1852f'],
    xls: ['XLS', '#2f7d54'], xlsx: ['XLSX', '#2f7d54'], csv: ['CSV', '#2f7d54'], png: ['PNG', '#7a5ba6'], jpg: ['JPG', '#7a5ba6'],
    jpeg: ['JPG', '#7a5ba6'], gif: ['GIF', '#7a5ba6'], heic: ['HEIC', '#7a5ba6'], txt: ['TXT', '#83849a'], zip: ['ZIP', '#83849a'],
  };
  const PICK_CSS = `
.avod-overlay{position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(10,8,6,.55);font-family:inherit;color:var(--text-dark,#14151f)}
.avod-box{display:flex;flex-direction:column;width:min(560px,100%);height:min(640px,100%);background:var(--panel-bg,#eaeaec);border-radius:var(--window-radius-lg,22px);box-shadow:0 30px 70px -20px rgba(0,0,0,.6);overflow:hidden}
.avod-head{display:flex;align-items:center;gap:12px;padding:20px 20px 12px}
.avod-head h2{flex:1;margin:0;font-size:1.1rem;font-weight:900;color:var(--text-dark,#14151f)}
.avod-x{flex:none;width:32px;height:32px;border:none;border-radius:50%;background:var(--panel-inner,#dcdce0);color:var(--text-muted,#4b4d63);font:inherit;font-size:.9rem;line-height:1;cursor:pointer}
.avod-x:hover{color:var(--text-dark,#14151f)}
.avod-search{display:flex;align-items:center;gap:8px;margin:0 20px;padding:0 16px;border-radius:999px;background:var(--panel-inner,#dcdce0);color:var(--text-faint,#83849a)}
.avod-search svg{flex:none;width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round}
.avod-search input{flex:1;min-width:0;padding:10px 0;border:none;background:none;outline:none;font:inherit;font-size:.86rem;font-weight:600;color:var(--text-dark,#14151f)}
.avod-search input::placeholder{color:var(--text-faint,#83849a)}
.avod-search:focus-within{box-shadow:0 0 0 2px var(--accent-ring,rgba(217,74,43,.35))}
.avod-crumbs{display:flex;flex-wrap:wrap;align-items:center;gap:4px;min-height:44px;padding:8px 16px;font-size:.8rem;font-weight:800;color:var(--text-muted,#4b4d63)}
.avod-crumbs button{max-width:200px;padding:4px 8px;border:none;border-radius:8px;background:none;font:inherit;color:var(--text-muted,#4b4d63);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
.avod-crumbs button:hover{background:var(--panel-inner,#dcdce0);color:var(--text-dark,#14151f)}
.avod-crumbs [aria-current]{max-width:240px;padding:4px 8px;color:var(--text-dark,#14151f);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.avod-crumbs svg{flex:none;width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round;opacity:.6}
.avod-list{flex:1;min-height:0;margin:0 8px;padding:0 4px 8px;overflow-y:auto;outline:none}
.avod-row{display:flex;align-items:center;gap:12px;width:100%;min-height:52px;margin:0;padding:8px;border:none;border-radius:12px;background:none;font:inherit;text-align:left;color:var(--text-dark,#14151f);cursor:pointer;box-sizing:border-box}
.avod-row:hover{background:var(--panel-inner,#dcdce0)}
.avod-row.on{background:color-mix(in srgb,var(--accent,#d94a2b) 14%,transparent)}
.avod-row input{flex:none;appearance:none;-webkit-appearance:none;display:grid;place-items:center;width:20px;height:20px;margin:0;border:2px solid var(--text-faint,#83849a);border-radius:6px;background:var(--panel-bg,#eaeaec);cursor:pointer}
.avod-row input:checked{border-color:var(--accent,#d94a2b);background:var(--accent,#d94a2b) center/14px 14px no-repeat url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23fff' stroke-width='3.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 12.5l4.5 4.5L19 7.5'/%3E%3C/svg%3E")}
.avod-row:focus-visible,.avod-row:has(input:focus-visible),.avod-crumbs button:focus-visible,.avod-x:focus-visible,.avod-btn:focus-visible,.avod-more:focus-visible{outline:none;box-shadow:0 0 0 2px var(--accent-ring,rgba(217,74,43,.35))}
.avod-row input:focus-visible{outline:none}
.avod-ico{flex:none;display:grid;place-items:center;width:34px;height:34px;border-radius:8px;color:#fff;font-size:.5rem;font-weight:900;letter-spacing:.02em}
.avod-ico.avod-folder{background:var(--panel-inner,#dcdce0)}
.avod-ico.avod-folder svg{width:22px;height:22px;fill:var(--accent,#d94a2b)}
.avod-name{flex:1;min-width:0}
.avod-name b{display:block;font-size:.86rem;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.avod-name small{display:block;margin-top:2px;font-size:.72rem;font-weight:700;color:var(--text-faint,#83849a)}
.avod-chev{flex:none;display:flex;color:var(--text-faint,#83849a)}
.avod-chev svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.avod-msg{margin:0;padding:32px 16px;text-align:center;font-size:.86rem;font-weight:600;color:var(--text-muted,#4b4d63)}
.avod-msg .avod-btn{margin-top:12px}
.avod-more{display:block;margin:8px auto 4px;padding:8px 16px;border:1px solid var(--border,#cfcfd6);border-radius:999px;background:var(--panel-bg,#eaeaec);font:inherit;font-size:.8rem;font-weight:800;color:var(--text-dark,#14151f);cursor:pointer}
.avod-more:disabled{opacity:.6;cursor:progress}
.avod-foot{display:flex;align-items:center;gap:8px;padding:12px 20px 20px;border-top:1px solid var(--border,#cfcfd6)}
.avod-count{flex:1;min-width:0;font-size:.8rem;font-weight:700;color:var(--text-muted,#4b4d63)}
.avod-btn{flex:none;padding:10px 20px;border:none;border-radius:999px;font:inherit;font-size:.84rem;font-weight:800;cursor:pointer}
.avod-btn.primary{background:var(--accent,#d94a2b);color:#fff}
.avod-btn.primary:hover{background:var(--accent-dark,#a8331a)}
.avod-btn.primary:disabled{opacity:.5;cursor:default;background:var(--accent,#d94a2b)}
.avod-btn.secondary{background:var(--panel-inner,#dcdce0);color:var(--text-dark,#14151f)}
.avod-btn.secondary:hover{background:var(--border,#cfcfd6)}
.avod-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
@media (max-width:520px){
.avod-overlay{padding:16px;align-items:stretch}
.avod-box{height:100%}
.avod-head{padding:16px 16px 12px}
.avod-search{margin:0 16px}
.avod-crumbs{padding:8px 12px}
.avod-foot{padding:12px 16px 16px}
.avod-btn{padding:10px 16px}
}`;
  const PICK_CHEV = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
  const PICK_FOLDER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l2 2h8.4A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/></svg>';
  const pickEsc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  function pickSize(n) {
    n = Number(n) || 0;
    if (n < 1024) return n ? `${n} B` : '';
    if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
    return `${(n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0)} MB`;
  }
  function pickDay(s) {
    const t = Date.parse(s || '');
    if (!t) return '';
    const d = new Date(t);
    return d.toLocaleDateString('en-US', d.getFullYear() === new Date().getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
  }

  let pickerOpen = null; // closes the picker that's open (a second one replaces it)

  function oneDrivePick(token) {
    if (pickerOpen) pickerOpen([]);
    return new Promise((resolve) => {
      if (!document.getElementById('avod-style')) {
        const st = document.createElement('style');
        st.id = 'avod-style';
        st.textContent = PICK_CSS;
        document.head.appendChild(st);
      }
      const opener = document.activeElement;
      const ov = document.createElement('div');
      ov.className = 'avod-overlay';
      ov.innerHTML = `
        <div class="avod-box" role="dialog" aria-modal="true" aria-labelledby="avodTitle">
          <div class="avod-head"><h2 id="avodTitle">Add from OneDrive</h2><button class="avod-x" type="button" data-avod-close aria-label="Close">✕</button></div>
          <label class="avod-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg><input type="search" placeholder="Search your OneDrive" aria-label="Search your OneDrive" autocomplete="off" maxlength="200"></label>
          <nav class="avod-crumbs" aria-label="Folders"></nav>
          <div class="avod-list" tabindex="-1" aria-label="Files and folders"></div>
          <p class="avod-sr" role="status"></p>
          <div class="avod-foot"><span class="avod-count" aria-live="polite"></span><button class="avod-btn secondary" type="button" data-avod-close>Cancel</button><button class="avod-btn primary" type="button" data-avod-add disabled>Add</button></div>
        </div>`;
      document.body.appendChild(ov);
      const box = ov.querySelector('.avod-box');
      const search = ov.querySelector('.avod-search input');
      const crumbs = ov.querySelector('.avod-crumbs');
      const list = ov.querySelector('.avod-list');
      const status = ov.querySelector('.avod-sr');
      const count = ov.querySelector('.avod-count');
      const addBtn = ov.querySelector('[data-avod-add]');

      const picked = new Map(); // id -> { id, name, size, mimeType, webUrl }, kept across folders and searches
      let trail = [{ id: 'root', name: 'My files' }];
      let query = '';
      let shown = [];
      let next = '';
      let loading = false;
      let failed = '';
      let seq = 0;
      let focusAfter = null; // 'first' | index: where focus goes once the list is drawn
      let timer = 0;

      function finish(result) {
        if (pickerOpen !== finish) return;
        pickerOpen = null;
        clearTimeout(timer);
        seq++;
        document.removeEventListener('keydown', onKey, true);
        ov.remove();
        try {
          if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
        } catch {}
        if (result.length) rememberPicked(result);
        resolve(result);
      }
      pickerOpen = finish;

      const byName = (a, b) => (b.folder ? 1 : 0) - (a.folder ? 1 : 0) || String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: 'base' });
      async function load(more) {
        const my = ++seq;
        let url;
        if (more) url = next;
        else if (query) url = `${GRAPH}/me/drive/root/search(q='${encodeURIComponent(query.replace(/'/g, "''"))}')?$top=100&$select=${PICK_SELECT}`;
        else {
          const at = trail[trail.length - 1];
          url = at.id === 'root' ? `${GRAPH}/me/drive/root/children?$top=200&$select=${PICK_SELECT}` : `${GRAPH}/me/drive/items/${encodeURIComponent(at.id)}/children?$top=200&$select=${PICK_SELECT}`;
        }
        if (!more) {
          shown = [];
          next = '';
        }
        loading = true;
        failed = '';
        draw();
        try {
          const r = await mfetch(token, url);
          if (my !== seq) return;
          if (!r.ok) throw fail(r.status === 403 ? 'denied' : 'network');
          const j = await r.json();
          if (my !== seq) return;
          // Files and folders of their own drive; shared shortcuts and OneNote notebooks are left out.
          const got = (Array.isArray(j.value) ? j.value : []).filter((i) => i && typeof i.id === 'string' && ITEM_ID.test(i.id) && (i.folder || i.file) && !i.remoteItem && !i.package);
          const before = shown.length;
          shown = more ? shown.concat(got) : got;
          if (!query) shown.sort(byName);
          const link = String(j['@odata.nextLink'] || '');
          next = link.startsWith(GRAPH + '/') ? link : '';
          if (more && focusAfter === 'more') focusAfter = Math.min(before, shown.length - 1);
        } catch (e) {
          if (my !== seq) return;
          failed =
            e && e.code === 'needs_click'
              ? 'Your sign-in ran out. Close this, then click Add from OneDrive again.'
              : e && e.code === 'denied'
                ? 'OneDrive didn’t let Averages.io read your files. Close this, then click Add from OneDrive and allow it.'
                : 'Couldn’t load your OneDrive. Check your internet and try again.';
        }
        loading = false;
        draw();
      }

      function rowHTML(i, idx) {
        if (i.folder) {
          const n = Number(i.folder.childCount) || 0;
          return `<button type="button" class="avod-row" data-avod-folder="${idx}"><span class="avod-ico avod-folder" aria-hidden="true">${PICK_FOLDER}</span><span class="avod-name"><b>${pickEsc(i.name)}</b><small>Folder · ${n} item${n === 1 ? '' : 's'}</small></span><span class="avod-chev" aria-hidden="true">${PICK_CHEV}</span></button>`;
        }
        const ext = extOf(i.name);
        const badge = (Object.prototype.hasOwnProperty.call(PICK_BADGE, ext) && PICK_BADGE[ext]) || [(ext || 'file').toUpperCase().slice(0, 4), '#83849a'];
        const meta = [pickSize(i.size), pickDay(i.lastModifiedDateTime)].filter(Boolean).join(' · ');
        const on = picked.has(i.id);
        return `<label class="avod-row${on ? ' on' : ''}"><input type="checkbox" data-avod-file="${idx}"${on ? ' checked' : ''}><span class="avod-ico" aria-hidden="true" style="background:${badge[1]}">${pickEsc(badge[0])}</span><span class="avod-name"><b>${pickEsc(i.name)}</b>${meta ? `<small>${pickEsc(meta)}</small>` : ''}</span></label>`;
      }

      function drawCount() {
        const n = picked.size;
        count.textContent = n ? `${n} file${n === 1 ? '' : 's'} picked` : 'Tick the files to add';
        addBtn.disabled = !n;
      }

      function draw() {
        const here = trail[trail.length - 1];
        crumbs.innerHTML = query
          ? `<button type="button" data-avod-clear>${pickEsc(here.name)}</button>${PICK_CHEV}<span aria-current="page">Results for “${pickEsc(query)}”</span>`
          : trail.map((t, k) => (k === trail.length - 1 ? `<span aria-current="page">${pickEsc(t.name)}</span>` : `<button type="button" data-avod-crumb="${k}">${pickEsc(t.name)}</button>${PICK_CHEV}`)).join('');
        if (loading && !shown.length) list.innerHTML = '<p class="avod-msg">Loading…</p>';
        else if (failed && !shown.length) list.innerHTML = `<div class="avod-msg">${pickEsc(failed)}<br><button class="avod-btn secondary" type="button" data-avod-retry>Try again</button></div>`;
        else if (!shown.length) list.innerHTML = `<p class="avod-msg">${query ? `Nothing in your OneDrive matches “${pickEsc(query)}”.` : 'This folder is empty.'}</p>`;
        else {
          list.innerHTML =
            shown.map(rowHTML).join('') +
            (next ? `<button class="avod-more" type="button" data-avod-more${loading ? ' disabled' : ''}>${loading ? 'Loading…' : 'Show more'}</button>` : '') +
            (failed ? `<p class="avod-msg">${pickEsc(failed)}</p>` : '');
        }
        list.setAttribute('aria-busy', loading ? 'true' : 'false');
        status.textContent = loading ? 'Loading' : failed || (query ? `${shown.length} result${shown.length === 1 ? '' : 's'}` : `${here.name}, ${shown.length} item${shown.length === 1 ? '' : 's'}`);
        drawCount();
        if (!loading && focusAfter !== null) {
          const rows = rowsIn();
          const target = typeof focusAfter === 'number' ? rows[focusAfter] : rows[0] || list.querySelector('[data-avod-retry]') || list;
          focusAfter = null;
          if (target) target.focus();
        }
      }

      // The focusable thing in each row: a folder's button or a file's checkbox.
      const rowsIn = () => Array.from(list.querySelectorAll('button.avod-row, .avod-row input'));

      function openFolder(i) {
        if (query) {
          query = '';
          search.value = '';
          trail = [trail[0]];
        }
        trail = trail.concat({ id: i.id, name: String(i.name || 'Folder') });
        focusAfter = 'first';
        load(false);
      }

      let downOnBackdrop = false;
      ov.addEventListener('pointerdown', (e) => {
        downOnBackdrop = e.target === ov;
      });
      ov.addEventListener('click', (e) => {
        if (e.target === ov) {
          if (downOnBackdrop) finish([]);
          return;
        }
        if (e.target.closest('[data-avod-close]')) return finish([]);
        if (e.target.closest('[data-avod-add]')) return finish(Array.from(picked.values()));
        const folder = e.target.closest('[data-avod-folder]');
        if (folder) {
          const i = shown[Number(folder.dataset.avodFolder)];
          if (i) openFolder(i);
          return;
        }
        const crumb = e.target.closest('[data-avod-crumb]');
        if (crumb) {
          trail = trail.slice(0, Number(crumb.dataset.avodCrumb) + 1);
          focusAfter = 'first';
          load(false);
          return;
        }
        if (e.target.closest('[data-avod-clear]')) {
          query = '';
          search.value = '';
          focusAfter = 'first';
          load(false);
          return;
        }
        if (e.target.closest('[data-avod-more]')) {
          focusAfter = 'more';
          load(true);
          return;
        }
        if (e.target.closest('[data-avod-retry]')) {
          focusAfter = 'first';
          load(false);
        }
      });
      list.addEventListener('change', (e) => {
        const tick = e.target.closest('[data-avod-file]');
        const i = tick && shown[Number(tick.dataset.avodFile)];
        if (!i) return;
        if (tick.checked) {
          picked.set(i.id, {
            id: i.id,
            name: String(i.name || 'File'),
            size: Number(i.size) || 0,
            mimeType: String((i.file && i.file.mimeType) || '') || MIME[extOf(i.name)] || 'application/octet-stream',
            webUrl: String(i.webUrl || ''),
          });
        } else picked.delete(i.id);
        tick.closest('.avod-row').classList.toggle('on', tick.checked);
        drawCount();
      });
      function runSearch() {
        clearTimeout(timer);
        const q = search.value.trim().slice(0, 200);
        if (q === query) return;
        query = q;
        load(false);
      }
      search.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(runSearch, 350);
      });

      function onKey(e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finish([]);
          return;
        }
        const active = document.activeElement;
        if (e.key === 'Enter' && active === search) {
          e.preventDefault();
          runSearch();
          return;
        }
        // Enter ticks a file too (a checkbox only answers Space on its own).
        if (e.key === 'Enter' && active && active.matches && active.matches('[data-avod-file]')) {
          e.preventDefault();
          active.click();
          return;
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          const rows = rowsIn();
          if (!rows.length) return;
          if (active === search && e.key === 'ArrowDown') {
            e.preventDefault();
            rows[0].focus();
            return;
          }
          const k = rows.indexOf(active);
          if (k === -1) return;
          e.preventDefault();
          if (e.key === 'ArrowUp' && k === 0) search.focus();
          else rows[Math.max(0, Math.min(rows.length - 1, k + (e.key === 'ArrowDown' ? 1 : -1)))].focus();
          return;
        }
        if (e.key === 'Tab') {
          // Focus stays inside the window.
          const all = Array.from(box.querySelectorAll('button:not([disabled]), input:not([disabled])')).filter((el) => el.offsetParent !== null);
          if (!all.length) return;
          const first = all[0];
          const last = all[all.length - 1];
          if (e.shiftKey && (active === first || !box.contains(active))) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && (active === last || !box.contains(active))) {
            e.preventDefault();
            first.focus();
          }
        }
      }
      document.addEventListener('keydown', onKey, true);

      draw();
      search.focus();
      load(false);
    });
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
    // Getting a drive file to turn in (2026-10-06)
    file_too_large: 'This file is too big to attach (95 MB max).',
    file_gone: 'That file isn’t there anymore. It may have been moved or deleted.',
    cloud_download_failed: 'Couldn’t download the file from your drive. Try again.',
    download_blocked: 'That file can’t be downloaded. Its owner may have turned downloading off.',
    not_downloadable: 'This kind of file can’t be attached. Try a document, slides, a spreadsheet, a PDF or a picture.',
    export_too_large: 'Google only turns files up to 10 MB into a PDF. Download it as a PDF in Google Drive, then attach that.',
    read_access_needed: 'Averages.io needs permission to read that file. Use Add from OneDrive on the Files tab, then try again.',
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
    googleDownload,
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
    oneDrivePick,
    oneDriveDownload,
    /** True for a file picked with Add from OneDrive: downloading it needs `oneDriveToken({ read: true })`. */
    oneDrivePicked: (id) => pickedList().some((p) => p.id === String(id)),
  };
  window.dispatchEvent(new Event('averages-cloud-ready'));
})();
