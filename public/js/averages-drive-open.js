/*
 * "Open with → Averages.io" from Google Drive (2026-10-09, replacing the Google Picker).
 *
 * Google Drive sends the student to our Open URL (https://app.averages.io/files?drive=open)
 * with ?state={"ids":[...],"action":"open","userId":"..."} (Google Docs, Sheets and
 * Slides come as "exportIds"). Opening a file that way grants drive.file for it.
 *
 * Loaded in <head> by app/layout.tsx, so it runs before anything else:
 *   1. Keeps the file IDs for this tab (sessionStorage, 15 minutes) and takes
 *      ?state off the address, so a reload or a shared link doesn't repeat it.
 *   2. If the student had to sign in first (Files sends signed-out visitors to
 *      the sign-in page, which then opens Home), the next signed-in page sends
 *      them back to Files to finish.
 * The Files page does the rest: AveragesDriveOpen.pending() / .clear().
 * Only file IDs are kept, never anything from inside the file.
 */
(function () {
  'use strict';
  const KEY = 'averages_drive_open';
  const TTL = 15 * 60 * 1000;
  const ID_OK = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{10,128}$/.test(v);

  function pending() {
    try {
      const v = JSON.parse(sessionStorage.getItem(KEY) || 'null');
      if (v && Array.isArray(v.ids) && v.ids.length && Date.now() - Number(v.at) < TTL) return v;
      sessionStorage.removeItem(KEY);
    } catch { /* storage off */ }
    return null;
  }
  function clear() {
    try { sessionStorage.removeItem(KEY); } catch { /* storage off */ }
  }

  // 1. Arriving from Google Drive.
  try {
    const u = new URL(window.location.href);
    const raw = u.searchParams.get('state');
    if (raw !== null) {
      let st = null;
      try { st = JSON.parse(raw); } catch { st = null; }
      const ids = st && st.action === 'open'
        ? [].concat(Array.isArray(st.ids) ? st.ids : [], Array.isArray(st.exportIds) ? st.exportIds : []).filter(ID_OK).slice(0, 10)
        : [];
      if (ids.length) {
        sessionStorage.setItem(KEY, JSON.stringify({ ids: [...new Set(ids)], userId: String((st && st.userId) || '').slice(0, 64), at: Date.now() }));
      }
      u.searchParams.delete('state');
      u.searchParams.delete('drive');
      history.replaceState(history.state, '', u.pathname + u.search + u.hash);
    }
  } catch { /* nothing to keep */ }

  // 2. Finish on Files. The sign-in page ("/"), onboarding, Settings and Files
  //    itself stay put. Only once per file (2026-10-09, Martin: "it traps you
  //    on the files page"): before, every other page sent the student back to
  //    Files for 15 minutes, so leaving Files to connect Google Drive or to do
  //    anything else bounced them straight back.
  const path = window.location.pathname.replace(/\.html$/, '').replace(/\/+$/, '') || '/';
  const p = pending();
  if (p && !p.bounced && path !== '/' && path !== '/files' && path !== '/settings' && !/^\/onboard/.test(path)) {
    try { sessionStorage.setItem(KEY, JSON.stringify(Object.assign({}, p, { bounced: true }))); } catch { /* storage off */ }
    window.location.replace('/files');
  }

  window.AveragesDriveOpen = { pending, clear };
})();
