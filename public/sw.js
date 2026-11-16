// Averages.io service worker: browser notifications only.
'use strict';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

/*
 * Only our own pages, as a path: "/grades", "/assignments?x=1". Anything else
 * (another site, "//host", "javascript:", a backslash trick) becomes /home,
 * so a notification can never send the student off Averages.
 */
function safePath(value) {
  if (typeof value !== 'string' || value.length > 200 || !/^\/(?![\/\\])/.test(value)) return '/home';
  try {
    const url = new URL(value, self.location.origin);
    if (url.origin !== self.location.origin) return '/home';
    if (/^\/[\/\\]/.test(url.pathname)) return '/home';
    return url.pathname + url.search + url.hash;
  } catch (e) {
    return '/home';
  }
}

function text(value, fallback, max) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : fallback;
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  if (!data || typeof data !== 'object') data = {};
  const tag = typeof data.tag === 'string' && /^[a-z0-9-]{1,40}$/.test(data.tag) ? data.tag : 'averages';
  // Every push must show a notification (userVisibleOnly), so a malformed one
  // still shows something plain rather than the browser's own generic text.
  event.waitUntil(
    self.registration.showNotification(text(data.title, 'Averages', 60), {
      body: text(data.body, 'Something changed. Open Averages to see it.', 200),
      tag,
      // A newer notification of the same kind replaces the older one, and still alerts.
      renotify: true,
      icon: '/icon.png',
      data: { url: safePath(data.url) },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = safePath(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const target = new URL(path, self.location.origin).href;
      const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const ours = tabs.filter((c) => {
        try {
          return new URL(c.url).origin === self.location.origin;
        } catch (e) {
          return false;
        }
      });
      // The tab the student last used, if any (focused first).
      const tab = ours.find((c) => c.focused) || ours[0];
      if (tab) {
        try {
          const focused = await tab.focus();
          if (focused.url !== target && 'navigate' in focused) await focused.navigate(target);
          return;
        } catch (e) {
          // A tab this worker doesn't control can't be navigated: open a new one instead.
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(target);
    })()
  );
});

/*
 * A.I. search's model download (2026-11-16, public/js/averages-ai.js). The page asks the browser for a Background
 * Fetch, so the download keeps going when the student opens another page or closes the tab. When it finishes, each
 * file goes into the cache the page reads ("averages-ai-v1"), under its own address. Only files from our own /ai/.
 */
const AI_CACHE = 'averages-ai-v1';
const isAi = (bg) => bg && typeof bg.id === 'string' && bg.id.indexOf('averages-ai-') === 0;
async function aiKeep(bg) {
  const cache = await caches.open(AI_CACHE);
  const records = await bg.matchAll();
  for (const record of records) {
    try {
      const url = new URL(record.request.url);
      if (url.origin !== self.location.origin || url.pathname.indexOf('/ai/') !== 0) continue;
      const res = await record.responseReady;
      if (res && res.ok) await cache.put(url.href, res);
    } catch (e) {
      // that file didn't come: the page asks for whatever is still missing next time
    }
  }
}
async function aiTell(msg) {
  const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  tabs.forEach((c) => c.postMessage(msg));
}
self.addEventListener('backgroundfetchsuccess', (event) => {
  if (!isAi(event.registration)) return;
  event.waitUntil((async () => {
    await aiKeep(event.registration);
    try { await event.updateUI({ title: 'A.I. search is downloaded' }); } catch (e) { /* no UI to update */ }
    await aiTell({ t: 'avai-downloaded' });
  })());
});
self.addEventListener('backgroundfetchfail', (event) => {
  if (!isAi(event.registration)) return;
  // keep what did arrive, so the next try only fetches the rest
  event.waitUntil((async () => { await aiKeep(event.registration); await aiTell({ t: 'avai-download-failed' }); })());
});
self.addEventListener('backgroundfetchclick', (event) => {
  if (!isAi(event.registration)) return;
  event.waitUntil(self.clients.openWindow ? self.clients.openWindow('/IS/settings?section=ai') : Promise.resolve());
});
