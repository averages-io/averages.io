/*
 * Averages.io: turning in work on Schoology from the assignment page
 * (2026-10-06).
 *
 * The browser does the heavy lifting so our Worker never has to hold a file:
 *   1. The file's MD5, worked out here in 2 MB pieces with a pause between
 *      pieces, so even a big file never freezes the page. (Schoology's upload
 *      API wants the checksum before the bytes.)
 *   2. POST /submit/upload: our API asks Schoology for an upload slot and
 *      hands back a sealed token. The real upload address never reaches the
 *      browser.
 *   3. PUT /submit/upload/<token> with the raw bytes, which the Worker streams
 *      on to Schoology. XMLHttpRequest rather than fetch, because only it can
 *      report upload progress.
 *   4. One POST /submit/file with every file id: that's the actual turn-in.
 * Since 2026-10-12 the Add Submission popup does 1-3 as soon as a file is
 * added (uploadFile) and 4 when Turn in is pressed (turnInFiles); submitFiles
 * still does all four in one go. A link the student shares (Google Drive,
 * OneDrive, Canva) is turned in as a small web page that opens it (linkFile),
 * so files and links are one turn-in.
 * A written answer is one POST /submit/text. A Canva design is turned into a
 * PDF by our API (POST /canva/designs/<id>/export, polled) and then goes
 * through the same four steps.
 *
 * Loaded by assignment.html only in a signed-in Schoology session (Google
 * Classroom work is turned in on Classroom). It doesn't need `window`, so the
 * MD5 can be unit tested in Node.
 */
(function (root) {
  'use strict';
  if (root.AveragesSubmit) return;

  const loc = root.location;
  const API = loc && /averages\.io$/.test(loc.hostname || '') ? 'https://api.averages.io' : 'http://localhost:8787';
  const MAX_BYTES = 95 * 1024 * 1024;   // the API's limit per file
  const MAX_FILES = 20;                  // and per turn-in
  const MAX_TEXT_BYTES = 100 * 1024;     // a written answer, as UTF-8
  const CHUNK = 2 * 1024 * 1024;        // MD5 piece size: a few ms of work each
  const ID_OK = (v) => /^\d{1,20}$/.test(String(v || ''));
  const DESIGN_OK = (v) => /^[A-Za-z0-9_-]{1,64}$/.test(String(v || ''));

  class SubmitError extends Error {
    constructor(code, extra) {
      super(code);
      this.code = code;
      if (extra) Object.assign(this, extra);
    }
  }
  const fail = (code, extra) => new SubmitError(code, extra);

  /* ── MD5 (RFC 1321), fed a piece at a time ─────────────────────────── */

  // floor(abs(sin(i + 1)) * 2^32), written out: Math.sin's last digits aren't
  // the same in every browser, and one wrong constant means every upload fails.
  const K = new Int32Array([
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
  ]);
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];

  /** One 64-byte block of `b` at `o`, into the state `h` (x is scratch). */
  function block(h, x, b, o) {
    for (let i = 0; i < 16; i++, o += 4) x[i] = b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);
    let a = h[0], bb = h[1], c = h[2], d = h[3], f = 0, s = 0, i = 0;
    // Four rounds of 16 steps; each loop is one round, so there's no per-step branching.
    for (; i < 16; i++) { f = a + (d ^ (bb & (c ^ d))) + K[i] + x[i]; s = S[i & 3]; a = d; d = c; c = bb; bb = (bb + ((f << s) | (f >>> (32 - s)))) | 0; }
    for (; i < 32; i++) { f = a + (c ^ (d & (bb ^ c))) + K[i] + x[(5 * i + 1) & 15]; s = S[4 + (i & 3)]; a = d; d = c; c = bb; bb = (bb + ((f << s) | (f >>> (32 - s)))) | 0; }
    for (; i < 48; i++) { f = a + (bb ^ c ^ d) + K[i] + x[(3 * i + 5) & 15]; s = S[8 + (i & 3)]; a = d; d = c; c = bb; bb = (bb + ((f << s) | (f >>> (32 - s)))) | 0; }
    for (; i < 64; i++) { f = a + (c ^ (bb | ~d)) + K[i] + x[(7 * i) & 15]; s = S[12 + (i & 3)]; a = d; d = c; c = bb; bb = (bb + ((f << s) | (f >>> (32 - s)))) | 0; }
    h[0] += a; h[1] += bb; h[2] += c; h[3] += d;   // Int32Array wraps for us
  }

  /** Incremental MD5: `update(bytes)` as often as needed, then `hex()` once. */
  function Md5() {
    this.h = new Int32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]);
    this.x = new Int32Array(16);
    this.tail = new Uint8Array(64);
    this.tailLen = 0;
    this.length = 0;
  }
  Md5.prototype.update = function (bytes) {
    const n = bytes.length;
    let o = 0;
    this.length += n;
    if (this.tailLen) {
      const take = Math.min(64 - this.tailLen, n);
      this.tail.set(bytes.subarray(0, take), this.tailLen);
      this.tailLen += take;
      o = take;
      if (this.tailLen < 64) return this;
      block(this.h, this.x, this.tail, 0);
      this.tailLen = 0;
    }
    for (; o + 64 <= n; o += 64) block(this.h, this.x, bytes, o);
    if (o < n) {
      this.tail.set(bytes.subarray(o), 0);
      this.tailLen = n - o;
    }
    return this;
  };
  Md5.prototype.hex = function () {
    const bits = this.length * 8;
    const pad = new Uint8Array((this.tailLen < 56 ? 56 : 120) - this.tailLen + 8);
    pad[0] = 0x80;
    const lo = bits % 4294967296, hi = Math.floor(bits / 4294967296);
    for (let j = 0; j < 4; j++) {
      pad[pad.length - 8 + j] = (lo >>> (8 * j)) & 255;
      pad[pad.length - 4 + j] = (hi >>> (8 * j)) & 255;
    }
    this.update(pad);
    let out = '';
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) out += ((this.h[i] >>> (8 * j)) & 255).toString(16).padStart(2, '0');
    return out;
  };

  /** MD5 of a string (UTF-8) or bytes, all at once. For small things and tests. */
  function md5(input) {
    const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input instanceof Uint8Array ? input : new Uint8Array(input);
    return new Md5().update(bytes).hex();
  }

  /** Gives the page a turn: paints, clicks and typing happen between MD5 pieces. */
  function pause() {
    if (root.scheduler && typeof root.scheduler.yield === 'function') return root.scheduler.yield();
    // A message, not setTimeout: background tabs slow timers down to once a second.
    if (typeof MessageChannel === 'function') {
      return new Promise((resolve) => {
        const ch = new MessageChannel();
        ch.port1.onmessage = () => { ch.port1.close(); resolve(); };
        ch.port2.postMessage(0);
      });
    }
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  function readPiece(blob) {
    if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsArrayBuffer(blob);
    });
  }

  /** MD5 of a Blob/File in 2 MB pieces. onProgress(0..1) after each piece. */
  async function md5Blob(blob, opts) {
    opts = opts || {};
    const md = new Md5();
    const size = blob.size;
    for (let o = 0; o < size; o += CHUNK) {
      if (opts.signal && opts.signal.aborted) throw fail('aborted');
      let buf;
      try {
        buf = await readPiece(blob.slice(o, Math.min(size, o + CHUNK)));
      } catch {
        throw fail('read_failed');
      }
      md.update(new Uint8Array(buf));
      if (opts.onProgress) opts.onProgress(Math.min(size, o + CHUNK) / size);
      await pause();
    }
    return md.hex();
  }

  /* ── talking to our API ────────────────────────────────────────────── */

  const isBlob = (b) => !!b && typeof b.size === 'number' && typeof b.slice === 'function';
  const enc = encodeURIComponent;

  /** Our API's answer to a failed request, as one of the codes messageFor knows. */
  function codeFor(status, error) {
    const e = typeof error === 'string' && /^[a-z0-9_]{1,64}$/.test(error) ? error : '';
    if (status === 401 || e === 'not_authenticated') return 'signed_out';
    if (status === 429 || /rate_limit/.test(e)) return 'rate_limited';
    if (e === 'too_large') return 'file_too_large';
    if (e) return e;   // file_too_large and text_too_large are both 413s: the code says which
    if (status === 413) return 'file_too_large';
    if (status === 502 || status === 503 || status === 504) return 'schoology_error';
    return 'failed';
  }
  /** The student's time zone, so "when" in a revision reads in their own time (as /data/bundle). */
  function tzQuery(first) {
    let tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch {}
    return tz ? `${first ? '?' : '&'}tz=${enc(tz)}` : '';
  }

  /*
   * Request log (2026-10-12): setLogger(fn) gets { kind: 'req', method, url,
   * body } before each request and { kind: 'res', status, body } after, for the
   * popup's "what's being sent" box. The page hides ids and tokens in it.
   */
  let LOGGER = null;
  function setLogger(fn) { LOGGER = typeof fn === 'function' ? fn : null; }
  function log(entry) {
    if (!LOGGER) return;
    try { LOGGER(entry); } catch {}
  }

  async function call(method, path, body, signal) {
    log({ kind: 'req', method, url: API + path, body: body || null });
    let res;
    try {
      res = await fetch(API + path, {
        method,
        credentials: 'include',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal,
      });
    } catch (e) {
      log({ kind: 'res', status: 0, note: e && e.name === 'AbortError' ? 'stopped' : 'no connection' });
      throw fail(e && e.name === 'AbortError' ? 'aborted' : 'network');
    }
    let j = null;
    try {
      j = await res.json();
    } catch {
      if (signal && signal.aborted) throw fail('aborted');
    }
    log({ kind: 'res', status: res.status, body: j });
    if (!res.ok) throw fail(codeFor(res.status, j && j.error), { status: res.status });
    return j && typeof j === 'object' ? j : {};
  }

  const MIME = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    txt: 'text/plain',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    mp3: 'audio/mpeg',
    zip: 'application/zip',
  };
  const extOf = (name) => (String(name || '').toLowerCase().match(/\.([a-z0-9]{1,8})$/) || [])[1] || '';
  /** The file's own type when the browser knows it, else one from its extension. */
  function typeOf(blob, name) {
    const t = String(blob.type || '').split(';')[0].trim();
    if (/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(t)) return t;
    return MIME[extOf(name)] || 'application/octet-stream';
  }
  /** A file name Schoology will take: no control characters or slashes, 200 characters at most. */
  function cleanName(name) {
    let n = String(name || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/[\\/]/g, '_').trim();
    if (n.length > 200) {
      const ext = extOf(n);
      n = ext ? n.slice(0, 199 - ext.length).trim() + '.' + ext : n.slice(0, 200);
    }
    return n || 'File';
  }

  /** Raw bytes to our API, which streams them to Schoology. Progress via XHR. */
  function putBytes(token, blob, type, onProgress, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) return reject(fail('aborted'));
      const xhr = new XMLHttpRequest();
      log({ kind: 'req', method: 'PUT', url: `${API}/submit/upload/${enc(token)}`, size: blob.size });
      xhr.open('PUT', `${API}/submit/upload/${enc(token)}`);
      xhr.withCredentials = true;
      xhr.setRequestHeader('Content-Type', type);
      if (onProgress && xhr.upload) {
        xhr.upload.onprogress = (e) => { if (e.lengthComputable && e.total) onProgress(e.loaded / e.total); };
      }
      xhr.onload = () => {
        let j = null;
        try { j = JSON.parse(xhr.responseText || 'null'); } catch {}
        log({ kind: 'res', status: xhr.status, body: j });
        if (xhr.status >= 200 && xhr.status < 300) resolve(j && typeof j === 'object' ? j : {});
        else reject(fail(codeFor(xhr.status, j && j.error), { status: xhr.status }));
      };
      xhr.onerror = () => reject(fail('network'));
      xhr.onabort = () => reject(fail('aborted'));
      if (signal) signal.addEventListener('abort', () => xhr.abort(), { once: true });
      xhr.send(blob);
    });
  }

  /** A file's name and checks, as submitFiles and uploadFile want them. */
  function checkedFile(f, index) {
    if (!f || !isBlob(f.blob)) throw fail('bad_request', { index });
    const name = cleanName(f.name || f.blob.name);
    if (f.blob.size > MAX_BYTES) throw fail('file_too_large', { index, name });
    if (!f.blob.size) throw fail('empty_file', { index, name });
    return { blob: f.blob, name };
  }

  /**
   * Uploads one file to Schoology without turning it in yet (2026-10-12): the
   * MD5, an upload slot, the bytes. Resolves { fileId, name, size }; give the
   * ids to turnInFiles. onProgress({ phase: 'hashing' | 'uploading', fraction }).
   */
  async function uploadFile(o) {
    o = o || {};
    const section = String(o.section || ''), assignment = String(o.assignment || ''), signal = o.signal;
    if (!ID_OK(section) || !ID_OK(assignment)) throw fail('bad_request');
    const f = checkedFile({ blob: o.blob, name: o.name });
    const report = (phase, fraction) => { if (o.onProgress) try { o.onProgress({ phase, fraction }); } catch {} };
    report('hashing', 0);
    const sum = await md5Blob(f.blob, { signal, onProgress: (x) => report('hashing', x) });
    const slot = await call('POST', '/submit/upload', { section, assignment, filename: f.name, filesize: f.blob.size, md5: sum }, signal);
    if (typeof slot.upload !== 'string' || !slot.upload) throw fail('failed');
    report('uploading', 0);
    const put = await putBytes(slot.upload, f.blob, typeOf(f.blob, f.name), (x) => report('uploading', x), signal);
    const id = String((put && put.fileId) || slot.fileId || '');
    if (!ID_OK(id)) throw fail('failed');
    return { fileId: id, name: f.name, size: f.blob.size };
  }

  /** The turn-in itself, for files already uploaded with uploadFile. Resolves { ok, revision }. */
  async function turnInFiles(o) {
    o = o || {};
    const section = String(o.section || ''), assignment = String(o.assignment || '');
    if (!ID_OK(section) || !ID_OK(assignment)) throw fail('bad_request');
    const fileIds = (Array.isArray(o.fileIds) ? o.fileIds : []).map(String);
    if (!fileIds.length) throw fail('no_files');
    if (fileIds.length > MAX_FILES) throw fail('too_many_files');
    if (!fileIds.every(ID_OK)) throw fail('bad_request');
    const done = await call('POST', '/submit/file' + tzQuery(true), { section, assignment, fileIds }, o.signal);
    // revision is null when Schoology's answer had none to show; the history reload fills in.
    return { ok: true, revision: done.revision && typeof done.revision === 'object' ? done.revision : null, fileIds };
  }

  /**
   * Turns in files: [{ blob, name }]. onProgress({ index, name, phase, fraction })
   * with phase 'hashing' | 'uploading' | 'done', then { index: -1, phase:
   * 'finishing' } just before the turn-in itself. A failure carries the
   * failing file's `index`.
   */
  async function submitFiles(o) {
    o = o || {};
    const section = String(o.section || ''), assignment = String(o.assignment || ''), signal = o.signal;
    if (!ID_OK(section) || !ID_OK(assignment)) throw fail('bad_request');
    const files = Array.isArray(o.files) ? o.files : [];
    if (!files.length) throw fail('no_files');
    if (files.length > MAX_FILES) throw fail('too_many_files');
    const named = files.map((f, index) => checkedFile(f, index));
    const report = (index, phase, fraction) => {
      if (!o.onProgress) return;
      try { o.onProgress({ index, name: index >= 0 ? named[index].name : '', phase, fraction }); } catch {}
    };
    const fileIds = [];
    for (let i = 0; i < named.length; i++) {
      const f = named[i];
      try {
        const up = await uploadFile({ section, assignment, blob: f.blob, name: f.name, signal, onProgress: (p) => report(i, p.phase, p.fraction) });
        fileIds.push(up.fileId);
        report(i, 'done', 1);
      } catch (e) {
        throw e instanceof SubmitError ? Object.assign(e, { index: i, name: f.name }) : fail('failed', { index: i, name: f.name });
      }
    }
    report(-1, 'finishing', 1);
    return turnInFiles({ section, assignment, fileIds, signal });
  }

  /**
   * A shared link as a small web page (2026-10-12, Martin: links go in as
   * files, so files and links are one turn-in). Opening it goes straight to
   * the link; it also shows the link to click, for when that doesn't happen.
   * Only https links. Resolves { blob, name } named "<title> (link).html".
   */
  function linkFile(title, url, from) {
    const u = String(url || '').trim();
    if (!/^https:\/\/[^\s"'<>]{1,2000}$/i.test(u)) throw fail('bad_request');
    const t = String(title || 'Link').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\.[a-z0-9]{1,5}$/i, '').trim().slice(0, 150) || 'Link';
    const esc = (v) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const where = from ? ` in ${esc(String(from).slice(0, 40))}` : '';
    const html = '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">'
      + `<meta http-equiv="refresh" content="0; url=${esc(u)}">`
      + `<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(t)}</title></head>`
      + '<body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;padding:32px;line-height:1.5">'
      + `<p>Opening <strong>${esc(t)}</strong>${where}…</p>`
      + `<p><a href="${esc(u)}">${esc(u)}</a></p>`
      + '<p style="color:#666;font-size:14px">Turned in as a link with Averages.io.</p></body></html>\n';
    return { blob: new Blob([html], { type: 'text/html' }), name: cleanName(`${t} (link).html`) };
  }

  /** Turns in a written answer (HTML from the Create tab; our API cleans it). */
  async function submitText(o) {
    o = o || {};
    const section = String(o.section || ''), assignment = String(o.assignment || '');
    if (!ID_OK(section) || !ID_OK(assignment)) throw fail('bad_request');
    const html = String(o.html || '');
    if (!html.replace(/<[^>]*>/g, '').replace(/&nbsp;| /g, ' ').trim()) throw fail('empty_text');
    if (new TextEncoder().encode(html).length > MAX_TEXT_BYTES) throw fail('text_too_large');
    const j = await call('POST', '/submit/text' + tzQuery(true), { section, assignment, body: html }, o.signal);
    return { ok: true, revision: j.revision && typeof j.revision === 'object' ? j.revision : null };
  }

  /** This student's turn-ins for one assignment, newest first. */
  async function history(o) {
    o = o || {};
    if (!ID_OK(o.section) || !ID_OK(o.assignment)) throw fail('bad_request');
    const j = await call('GET', `/submit/history?section=${enc(o.section)}&assignment=${enc(o.assignment)}${tzQuery(false)}`, null, o.signal);
    return Array.isArray(j.revisions) ? j.revisions.filter((r) => r && typeof r === 'object') : [];
  }

  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(fail('aborted')); }, { once: true });
    });
  }

  /** "attachment; filename*=UTF-8''Lab%20Report.pdf" -> "Lab Report.pdf" (only if our API exposes the header). */
  function nameFromDisposition(h) {
    const s = String(h || '');
    const star = s.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
    if (star) {
      try { return decodeURIComponent(star[1].trim()); } catch {}
    }
    const plain = s.match(/filename\s*=\s*"([^"]*)"/i) || s.match(/filename\s*=\s*([^;]+)/i);
    return plain ? plain[1].trim() : '';
  }

  /**
   * A Canva design as a PDF: start the export, check every 1.5 s for up to two
   * minutes, then fetch the file. onStatus('starting' | 'exporting' | 'downloading').
   * Resolves { blob, name }.
   */
  /** What the type pill can offer, a turn-in type, and its file's MIME type (2026-10-15). */
  const CANVA_TYPES = ['pdf', 'docx', 'pptx', 'png'];
  const TYPE_MIME = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    png: 'image/png',
  };

  /**
   * What a Canva design can be turned in as: ['pdf', 'pptx', 'png'], or with
   * 'docx' for a Canva Doc (GET /canva/designs/:id/formats). Anything that
   * goes wrong reads as just PDF, which every design can be.
   */
  async function canvaFormats(designId, signal) {
    if (!DESIGN_OK(designId)) return ['pdf'];
    try {
      const j = await call('GET', `/canva/designs/${enc(designId)}/formats`, null, signal);
      const list = Array.isArray(j.formats) ? j.formats.filter((f) => CANVA_TYPES.includes(f)) : [];
      return list.length ? CANVA_TYPES.filter((f) => list.includes(f)) : ['pdf'];
    } catch (e) {
      if (e && (e.code === 'aborted' || e.code === 'signed_out' || e.code === 'canva_design_gone')) throw e;
      return ['pdf'];
    }
  }

  /**
   * A Canva design as the type picked (`opts.format`: pdf, docx, pptx or png;
   * PDF when left out): Canva makes it, the API passes it on (Word goes
   * through the converter on the way). PNG is one file per page. Returns
   * [{ blob, name }].
   */
  async function exportCanvaFiles(designId, opts) {
    opts = opts || {};
    const signal = opts.signal;
    const format = CANVA_TYPES.includes(opts.format) ? opts.format : 'pdf';
    if (!DESIGN_OK(designId)) throw fail('bad_request');
    const status = (s) => { if (opts.onStatus) try { opts.onStatus(s); } catch {} };
    status('starting');
    const started = Date.now();
    // Word takes longer: Canva's PDF, then the converter (which may have to wake up).
    const limit = format === 'docx' ? 240000 : 120000;
    const start = await call('POST', `/canva/designs/${enc(designId)}/export`, format === 'pdf' ? {} : { format }, signal);
    const job = String(start.job || '');
    // The API's job token is sealed: "<iv>.<data>", a few hundred characters. (Until 2026-10-15 this
    // check allowed no dot and 128 characters at most, so every Canva turn-in stopped here.)
    if (!/^[A-Za-z0-9_-]{8,64}\.[A-Za-z0-9_-]{16,3000}$/.test(job)) throw fail('canva_export_failed');
    status('exporting');
    let files = 1;
    for (;;) {
      if (Date.now() - started > limit) throw fail('canva_export_timeout');
      await sleep(1500, signal);
      const s = await call('GET', `/canva/exports/${enc(job)}`, null, signal);
      if (s.status === 'success') { files = Math.max(1, Math.min(MAX_FILES, Number(s.files) || 1)); break; }
      // { status: 'failed', error }: license_required / approval_required are the student's to sort out in Canva.
      if (s.status === 'failed') throw fail(/^canva_export_[a-z_]{1,40}$/.test(String(s.error || '')) ? s.error : 'canva_export_failed');
    }
    status(format === 'docx' ? 'converting' : 'downloading');
    const out = [];
    for (let page = 1; page <= files; page++) {
      const url = `${API}/canva/exports/${enc(job)}/file?design=${enc(designId)}${files > 1 ? `&page=${page}` : ''}`;
      let res;
      for (;;) {
        log({ kind: 'req', method: 'GET', url });
        try {
          res = await fetch(url, { credentials: 'include', signal });
        } catch (e) {
          log({ kind: 'res', status: 0, note: 'no connection' });
          throw fail(e && e.name === 'AbortError' ? 'aborted' : 'network');
        }
        log({ kind: 'res', status: res.status, size: Number(res.headers.get('Content-Length') || 0) || null });
        if (res.ok) break;
        const j = await res.json().catch(() => null);
        const code = codeFor(res.status, j && j.error);
        // Canva said done but the file isn't quite there yet: wait a moment, within the same time limit.
        if (code !== 'canva_export_not_ready' || Date.now() - started > limit) throw fail(code === 'canva_export_not_ready' ? 'canva_export_timeout' : code, { status: res.status });
        await sleep(1500, signal);
      }
      const blob = await res.blob();
      if (blob.size > MAX_BYTES) throw fail('file_too_large');
      let name = cleanName(nameFromDisposition(res.headers.get('Content-Disposition')) || `${opts.title || 'Canva design'}${files > 1 ? ` (page ${page} of ${files})` : ''}.${format}`);
      if (extOf(name) !== format) name += '.' + format;
      out.push({ blob: blob.type === TYPE_MIME[format] ? blob : new Blob([blob], { type: TYPE_MIME[format] }), name });
    }
    return out;
  }

  /** A Canva design as one PDF (before the type pill; kept for anything still calling it). */
  async function exportCanva(designId, opts) {
    const files = await exportCanvaFiles(designId, Object.assign({}, opts, { format: 'pdf' }));
    return files[0];
  }

  /**
   * One of the student's course files (GET /data/attachment), attached to an
   * assignment (`src.assignment`) or to a Materials document (`src.document`).
   */
  async function courseFile(src, signal) {
    src = src || {};
    const parentOk = src.document ? ID_OK(src.document) : ID_OK(src.assignment);
    if (!ID_OK(src.section) || !ID_OK(src.fileId) || !parentOk) throw fail('bad_request');
    const parent = src.document ? `document=${enc(src.document)}` : `assignment=${enc(src.assignment)}`;
    let res;
    log({ kind: 'req', method: 'GET', url: `${API}/data/attachment?section=${enc(src.section)}&${parent}&file=${enc(src.fileId)}` });
    try {
      res = await fetch(`${API}/data/attachment?section=${enc(src.section)}&${parent}&file=${enc(src.fileId)}`, { credentials: 'include', signal });
    } catch (e) {
      log({ kind: 'res', status: 0, note: 'no connection' });
      throw fail(e && e.name === 'AbortError' ? 'aborted' : 'network');
    }
    log({ kind: 'res', status: res.status, size: Number(res.headers.get('Content-Length') || 0) || null });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      throw fail(res.status === 404 ? 'file_not_found' : codeFor(res.status, j && j.error), { status: res.status });
    }
    if (Number(res.headers.get('Content-Length') || 0) > MAX_BYTES) throw fail('file_too_large');
    const blob = await res.blob();
    if (blob.size > MAX_BYTES) throw fail('file_too_large');
    const want = MIME[extOf(src.name)];
    return want && blob.type !== want ? new Blob([blob], { type: want }) : blob;
  }

  /* ── what to tell the student ──────────────────────────────────────── */

  const MESSAGES = {
    feature_off: 'That’s turned off right now. Try again later.',
    file_too_large: 'This file is too big to turn in. Files can be up to 95 MB.',
    empty_file: 'This file is empty. Pick another one.',
    read_failed: 'Couldn’t read this file. Pick it again.',
    no_files: 'Choose at least one file before submitting.',
    too_many_files: 'You can turn in up to 20 files at once.',
    empty_text: 'Write your answer before submitting.',
    empty_submission: 'Write your answer before submitting.',
    text_too_large: 'Your answer is too long to turn in here. Turn it in as a file instead.',
    upload_expired: 'That took too long, so the upload ran out. Try again.',
    upload_not_yours: 'This upload was started by a different sign-in. Reload the page and try again.',
    length_required: 'Your browser didn’t say how big the file is. Try again, or try another browser.',
    size_mismatch: 'The file changed while it was uploading. Pick it again, then try again.',
    upload_rejected: 'Schoology didn’t accept this file. Check that it opens, then try again.',
    upload_redirected: 'Schoology didn’t take the file. Try again in a moment.',
    upload_mismatch: 'Schoology didn’t take the file. Try again in a moment.',
    canva_reconnect_needed: 'Reconnect Canva in Settings to turn in Canva designs.',
    canva_not_connected: 'Connect Canva in Settings to turn in Canva designs.',
    canva_not_configured: 'Turning in Canva designs isn’t switched on yet.',
    canva_design_gone: 'This design isn’t in your Canva account anymore.',
    canva_export_failed: 'Canva couldn’t make a file of this design. Try again in a moment.',
    canva_export_timeout: 'Canva is taking too long to make the file. Try again in a moment.',
    canva_export_not_ready: 'Canva is still making the file. Try again in a moment.',
    canva_export_not_found: 'Canva lost track of that file. Try again.',
    canva_export_unavailable: 'Canva couldn’t hand over the file right now. Try again in a moment.',
    canva_export_license_required: 'This design uses paid Canva elements, so Canva won’t make a file of it. Remove them in Canva, then try again.',
    canva_export_too_many_pages: 'This design has more than 20 pages, too many to turn in as images. Turn it in as a PDF instead.',
    convert_failed: 'Couldn’t turn this into a Word document. Turn it in as a PDF instead.',
    convert_unavailable: 'Word isn’t available right now. Turn it in as a PDF instead, or try again in a minute.',
    canva_export_approval_required: 'Your school’s Canva needs to approve this design before it can be turned in. Try again once it’s approved.',
    file_not_found: 'This file isn’t in your class anymore.',
    download_failed: 'Couldn’t get the file from your school. Try again.',
    rate_limited: 'Schoology is busy right now. Wait a minute, then try again.',
    schoology_error: 'Schoology didn’t take the file. Try again in a moment.',
    network: 'Couldn’t connect right now. Check your internet and try again.',
    signed_out: 'You’ve been signed out of Averages.io. Sign in again.',
    turn_in_on_classroom: 'Turn this in on Google Classroom.',
    not_available_in_demo: 'Turning in work isn’t available in the demo.',
    incognito_mode: 'Canva is off in Incognito mode.',
    bad_request: 'Something about this didn’t look right. Reload the page and try again.',
  };
  /** Friendly words for an error from this file, or from averages-cloud.js when it knows better. */
  function messageFor(err) {
    const code = err && err.code ? err.code : String(err || '');
    if (MESSAGES[code]) return MESSAGES[code];
    const C = root.AveragesCloud;
    if (C && typeof C.messageFor === 'function') return C.messageFor(err);
    return 'Something went wrong. Try again in a moment.';
  }

  root.AveragesSubmit = {
    MAX_BYTES,
    MAX_FILES,
    CHUNK,
    Md5,
    md5,
    md5Blob,
    submitFiles,
    uploadFile,
    turnInFiles,
    linkFile,
    setLogger,
    submitText,
    history,
    exportCanva,
    exportCanvaFiles,
    canvaFormats,
    courseFile,
    messageFor,
    nameFromDisposition,
    SubmitError,
  };
  if (typeof root.dispatchEvent === 'function' && typeof Event === 'function') {
    try { root.dispatchEvent(new Event('averages-submit-ready')); } catch {}
  }
})(typeof window !== 'undefined' ? window : globalThis);
