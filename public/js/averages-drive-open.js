// "Open with → Averages.io" from Google Drive.
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

  const path = window.location.pathname.replace(/\.html$/, '').replace(/\/+$/, '') || '/';
  const p = pending();
  if (p && !p.bounced && path !== '/' && path !== '/files' && path !== '/settings' && !/^\/onboard/.test(path)) {
    try { sessionStorage.setItem(KEY, JSON.stringify(Object.assign({}, p, { bounced: true }))); } catch { /* storage off */ }
    window.location.replace('/files');
  }

  window.AveragesDriveOpen = { pending, clear };
})();
