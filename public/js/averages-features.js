/*
 * Feature switches in the app (2026-10-09). The API says what's on at
 * GET /config/features (Cloudflare Flagship behind it, see the API's
 * src/flags.ts); this hides what's off, shows the maintenance banner, and
 * puts a notice over a page that's switched off (Messages, the school form).
 *
 * Loaded in <head> by app/layout.tsx, before the page draws: the last answer
 * (kept for this tab in sessionStorage) is applied at once, so a switched-off
 * button doesn't flash, then the fresh answer replaces it. If the API can't
 * be reached, everything stays as it is (all on, no banner).
 *
 * How things get hidden: <html data-feature-off="key key ..."> plus the CSS
 * below. Anything marked data-feature="key" hides when that key is off, and
 * RULES lists the app's existing buttons and rows for each key, so most pages
 * needed no changes. Pages can also ask: AveragesFeatures.on('turnin-feature'),
 * and listen for the "averages:features" event.
 *
 * The API refuses a switched-off feature anyway (503 feature_off); hiding is
 * only so nobody is offered something that won't work.
 */
(function () {
  'use strict';
  const KEYS = [
    'canva-integration', 'onedrive-integration', 'drive-integration',
    'schoology-signin', 'gclassroom-signin', 'canvas-signin', 'test-signin',
    'maintenance-banner', 'schoolsform-page', 'coursematerialpreview-feature',
    'turnin-feature', 'messaging-features', 'notifications-features',
  ];
  const DEFAULTS = { 'maintenance-banner': false, 'coursematerialpreview-feature': false };
  const NAMES = {
    'canva-integration': 'Canva is', 'onedrive-integration': 'OneDrive is', 'drive-integration': 'Google Drive is',
    'schoology-signin': 'Signing in with Schoology is', 'gclassroom-signin': 'Signing in with Google Classroom is',
    'canvas-signin': 'Signing in with Canvas is', 'test-signin': 'The reviewer account is',
    'schoolsform-page': 'The school application form is', 'coursematerialpreview-feature': 'Previews are',
    'turnin-feature': 'Turning in work is', 'messaging-features': 'Messages is', 'notifications-features': 'Notifications are',
  };
  // Existing parts of the app, per switch (a selector each; all of them are hidden while it's off).
  const RULES = {
    'canva-integration': [
      '[data-source="canva"]', '[data-file-action="canva"]', '.pick-opt[data-value="canva"]',
      '.integ-row[data-app="canva"]', '#fxNav [data-filter="canva"]', '.fx-chip[data-filter="canva"]', '#canvaPick',
    ],
    'drive-integration': [
      '[data-source="gdrive"]', '[data-file-action="gdrive"]', '[data-save="gdrive"]', '.pick-opt[data-value="gdrive"]',
      '.integ-row[data-app="gdrive"]', '#fxNav [data-filter="gdrive"]', '.fx-chip[data-filter="gdrive"]',
    ],
    'onedrive-integration': [
      '[data-source="onedrive"]', '[data-save="onedrive"]', '.integ-row[data-app="onedrive"]',
      '#fxNav [data-filter="onedrive"]', '.fx-chip[data-filter="onedrive"]',
    ],
    'schoology-signin': ['[data-lms="schoology"]'],
    'gclassroom-signin': ['[data-lms="google"]'],
    'canvas-signin': ['[data-lms="canvas"]'],
    'turnin-feature': ['#addSubmissionBtn', '.submit-dropzone.live-drop', '[data-draft-action="submit"]'],
    'messaging-features': [
      '.nav-link[data-page="messages"]', '[data-href^="messages.html"]', '[href^="messages.html"]', '[href^="/messages"]',
      '#block-messages', '#modalMessageBtn', '#tcMessage',
    ],
    'notifications-features': ['.settings-nav-item[data-section="notifications"]', '.settings-section[data-section="notifications"]'],
  };
  // Pages that are a feature on their own: a notice goes over them while it's off.
  const PAGES = [
    { path: /^\/messages(\.html)?\/?$/, key: 'messaging-features', title: 'Messages is turned off right now', text: 'You can still message your teachers on Schoology. Check back here later.', back: ['/home', 'Back to Home'] },
    { path: /^\/schools\/apply(\.html)?\/?$|^\/schools-apply(\.html)?$/, key: 'schoolsform-page', title: 'Applications are closed right now', text: 'You can still email schools@averages.io and we’ll get back to you.', back: ['mailto:schools@averages.io', 'Email us'] },
  ];
  const CACHE = 'averages_features';
  const API = window.location.hostname.endsWith('averages.io') ? 'https://api.averages.io' : 'http://localhost:8787';
  const root = document.documentElement;

  let state = { features: null, maintenance: null };
  const on = (k) => {
    const f = state.features;
    if (f && typeof f[k] === 'boolean') return f[k];
    return k in DEFAULTS ? DEFAULTS[k] : true;
  };

  function css() {
    const out = [];
    KEYS.forEach((k) => {
      const sels = ['[data-feature~="' + k + '"]'].concat(RULES[k] || []);
      out.push(sels.map((s) => 'html[data-feature-off~="' + k + '"] ' + s).join(',\n'));
    });
    // The API-key form serves Schoology keys and the reviewer account: gone only when both are off.
    // (It only shows with ?keys on the sign-in page.)
    out.push('html[data-feature-off~="schoology-signin"][data-feature-off~="test-signin"] #devKeys');
    // "Save to cloud" with neither cloud.
    out.push('html[data-feature-off~="drive-integration"][data-feature-off~="onedrive-integration"] [data-file-action="cloud"]');
    return out.join(' { display: none !important; }\n') + ' { display: none !important; }\n'
      + '.avf-banner{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483000;display:flex;align-items:center;gap:12px;max-width:min(640px,calc(100vw - 32px));padding:10px 10px 10px 16px;border-radius:14px;background:#14151f;color:#fff;font:700 13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.3)}'
      + '.avf-banner svg{flex:none;width:18px;height:18px}'
      + '.avf-banner button{flex:none;width:28px;height:28px;border:0;border-radius:8px;background:rgba(255,255,255,.12);color:#fff;font:700 16px/1 sans-serif;cursor:pointer}'
      + '.avf-banner.toast{bottom:auto;top:16px}'
      + '.avf-page{position:fixed;inset:0;z-index:2147482000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(20,21,31,.55);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}'
      + '.avf-card{max-width:420px;width:100%;padding:28px 24px;border-radius:20px;background:#fff;color:#14151f;text-align:center;font:600 14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;box-shadow:0 20px 50px rgba(0,0,0,.3)}'
      + '.avf-card h2{margin:0 0 8px;font-size:19px;font-weight:800}'
      + '.avf-card p{margin:0 0 18px;color:#4b4d63}'
      + '.avf-card a{display:inline-block;padding:10px 18px;border-radius:999px;background:#3d3f9e;color:#fff;font-weight:800;text-decoration:none}';
  }

  function apply() {
    const off = KEYS.filter((k) => !on(k));
    if (off.length) root.setAttribute('data-feature-off', off.join(' '));
    else root.removeAttribute('data-feature-off');
    whenBody(() => { banner(); pageNotice(); });
    try { window.dispatchEvent(new CustomEvent('averages:features', { detail: { on } })); } catch { /* old browser */ }
  }

  function whenBody(fn) {
    if (document.body) fn();
    else document.addEventListener('DOMContentLoaded', fn, { once: true });
  }

  const WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l9.5 17h-19z"/><path d="M12 10v4.5M12 17.5v.01"/></svg>';
  function dismissedKey(text) { return 'averages_banner_x:' + text; }
  function banner() {
    const old = document.getElementById('avfBanner');
    const msg = state.maintenance && on('maintenance-banner') ? String(state.maintenance.message || '') : '';
    let gone = false;
    try { gone = !!msg && sessionStorage.getItem(dismissedKey(msg)) === '1'; } catch { /* storage off */ }
    if (!msg || gone) { if (old) old.remove(); return; }
    if (old && old.dataset.text === msg) return;
    if (old) old.remove();
    const el = document.createElement('div');
    el.id = 'avfBanner';
    el.className = 'avf-banner';
    el.setAttribute('role', 'status');
    el.dataset.text = msg;
    el.innerHTML = WARN + '<span></span><button type="button" aria-label="Dismiss">×</button>';
    el.querySelector('span').textContent = msg;
    el.querySelector('button').addEventListener('click', () => {
      try { sessionStorage.setItem(dismissedKey(msg), '1'); } catch { /* storage off */ }
      el.remove();
    });
    document.body.appendChild(el);
  }

  function pageNotice() {
    const old = document.getElementById('avfPage');
    const page = PAGES.find((p) => p.path.test(window.location.pathname));
    if (!page || on(page.key)) { if (old) old.remove(); return; }
    if (old) return;
    const el = document.createElement('div');
    el.id = 'avfPage';
    el.className = 'avf-page';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'avfPageTitle');
    el.innerHTML = '<div class="avf-card"><h2 id="avfPageTitle"></h2><p></p><a></a></div>';
    el.querySelector('h2').textContent = page.title;
    el.querySelector('p').textContent = page.text;
    const a = el.querySelector('a');
    a.href = page.back[0];
    a.textContent = page.back[1];
    document.body.appendChild(el);
  }

  // ?feature_off=<key>: the API sent someone back here from something that's off.
  function cameBackFromOff() {
    let key = '';
    try {
      const u = new URL(window.location.href);
      key = u.searchParams.get('feature_off') || '';
      if (!key) return;
      u.searchParams.delete('feature_off');
      history.replaceState(history.state, '', u.pathname + u.search + u.hash);
    } catch { return; }
    if (!NAMES[key]) return;
    whenBody(() => {
      const el = document.createElement('div');
      el.className = 'avf-banner toast';
      el.setAttribute('role', 'status');
      el.innerHTML = WARN + '<span></span><button type="button" aria-label="Dismiss">×</button>';
      el.querySelector('span').textContent = NAMES[key] + ' turned off right now.';
      el.querySelector('button').addEventListener('click', () => el.remove());
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 8000);
    });
  }

  function clean(j) {
    if (!j || typeof j !== 'object' || !j.features || typeof j.features !== 'object') return null;
    const features = {};
    KEYS.forEach((k) => { if (typeof j.features[k] === 'boolean') features[k] = j.features[k]; });
    const m = j.maintenance && typeof j.maintenance.message === 'string' ? { message: j.maintenance.message.slice(0, 300) } : null;
    return { features, maintenance: m };
  }

  // 1. The last answer this tab had, right away.
  try {
    const c = clean(JSON.parse(sessionStorage.getItem(CACHE) || 'null'));
    if (c) state = c;
  } catch { /* nothing kept */ }
  const style = document.createElement('style');
  style.id = 'avfStyle';
  style.textContent = css();
  (document.head || root).appendChild(style);
  apply();
  cameBackFromOff();

  // 2. The fresh answer.
  const ready = fetch(API + '/config/features', { credentials: 'omit' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      const c = clean(j);
      if (!c) return;
      state = c;
      try { sessionStorage.setItem(CACHE, JSON.stringify(c)); } catch { /* storage off */ }
      apply();
    })
    .catch(() => { /* API unreachable: keep what we have */ });

  // Client-side navigation (Next.js): page notices follow the address.
  let last = window.location.pathname;
  setInterval(() => {
    if (window.location.pathname !== last) { last = window.location.pathname; whenBody(pageNotice); }
  }, 500);

  window.AveragesFeatures = { on, ready, keys: KEYS.slice() };
})();
