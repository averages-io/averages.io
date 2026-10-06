/*
 * Averages.io service worker: browser notifications only (2026-10-05).
 *
 * Registered by public/js/averages-push.js when a student turns on Browser
 * Notifications in Settings. It does two things and nothing else:
 *   push               shows the notification the API sent (encrypted end to
 *                      end; the push service never sees the text)
 *   notificationclick  brings an open Averages tab forward and takes it to the
 *                      notification's page, or opens one
 *
 * Deliberately no fetch handler and no caching: the app keeps working exactly
 * as it does without a service worker, and nothing about the student is ever
 * stored here.
 */
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
    // "/..//evil.com" normalizes to "//evil.com": still ours, but a second
    // pass would read it as another host, so it's refused here (2026-10-06 review).
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
