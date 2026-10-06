/*
 * Averages.io: browser notifications, the browser half (2026-10-05).
 *
 * The API half is averages-api's /push routes: a student who turns this on
 * gets their sign-in stored there, encrypted with a separate key, so it can
 * check their classes about every 20 minutes and send a notification that
 * only says what kind of thing changed. This file registers the service
 * worker (/sw.js), subscribes this browser with the API's VAPID key, and
 * tells the API about it.
 *
 *   window.AveragesPush = {
 *     supported()        this browser can do push at all
 *     config()           { publicKey } (null until the API is set up), or { failed: true }
 *     status()           { ok, on, here, types } for this student and this browser
 *     enable(types)      subscribe this browser and turn notifications on
 *     disable()          unsubscribe this browser; the API deletes everything
 *                        once no browser is left
 *     setTypes(types)    which kinds of notification
 *     test()             a test notification to this browser
 *     touchIfDue()       at most once a day: keep the stored sign-in in step
 *                        with this session (the app shell calls it on load)
 *     forgetLocal()      sign-out: unsubscribe and forget, on this device only
 *   }
 * Every call resolves (never rejects); a failure is { ok: false, code }.
 *
 * Kept on this device (localStorage):
 *   averages_push_endpoint        this browser's subscription, while it's on
 *   averages_push_touched         when /push/touch last ran (ms)
 *   averages_push_pending_delete  a turn-off the API hasn't heard about yet
 *                                 (offline): retried by touchIfDue()
 *
 * Loaded by settings.html (signed in only). Notification.requestPermission()
 * must run inside the click that asked for it, so callers ask for permission
 * themselves before calling enable().
 */
(function () {
  'use strict';
  if (window.AveragesPush) return;

  const API = window.location.hostname.endsWith('averages.io') ? 'https://api.averages.io' : 'http://localhost:8787';
  const ENDPOINT_KEY = 'averages_push_endpoint';
  const TOUCHED_KEY = 'averages_push_touched';
  const PENDING_KEY = 'averages_push_pending_delete';
  const DAY_MS = 24 * 60 * 60 * 1000;
  const TYPES = ['grades', 'assignments', 'due', 'messages', 'announcements'];

  function getLocal(key) {
    try {
      return window.localStorage.getItem(key) || '';
    } catch (e) {
      return '';
    }
  }
  function setLocal(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (e) {}
  }
  function removeLocal(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (e) {}
  }
  const fail = (code) => ({ ok: false, code: code || 'failed' });

  function supported() {
    return !!(window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);
  }

  /** Only the five known switches, as booleans. */
  function cleanTypes(types) {
    const out = {};
    TYPES.forEach((t) => {
      if (types && typeof types[t] === 'boolean') out[t] = types[t];
    });
    return out;
  }

  /** One API call: { ok, status, data }, or { ok: false, status: 0 } when the API couldn't be reached. */
  async function api(method, path, body) {
    const init = { method, credentials: 'include' };
    if (body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    try {
      const res = await fetch(API + path, init);
      let data = null;
      try {
        data = await res.json();
      } catch (e) {}
      return { ok: res.ok, status: res.status, data };
    } catch (e) {
      return { ok: false, status: 0, data: null };
    }
  }
  const codeOf = (r) => (r && r.data && typeof r.data.error === 'string' ? r.data.error : r && r.status === 0 ? 'network' : 'failed');

  let configCache = null;
  /** { publicKey } (null when the API isn't set up for notifications), or { publicKey: null, failed: true }. Not cached on failure. */
  async function config() {
    if (configCache) return configCache;
    const r = await api('GET', '/push/config');
    if (!r.ok || !r.data || typeof r.data !== 'object') return { publicKey: null, failed: true };
    configCache = { publicKey: typeof r.data.publicKey === 'string' && r.data.publicKey ? r.data.publicKey : null };
    return configCache;
  }

  function keyBytes(b64url) {
    const s = b64url.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function sameKey(buffer, b64url) {
    if (!buffer) return false;
    const a = new Uint8Array(buffer);
    const b = keyBytes(b64url);
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  /** This browser's push subscription, or null. Never registers anything. */
  async function currentSubscription() {
    if (!supported()) return null;
    try {
      const reg = await navigator.serviceWorker.getRegistration('/');
      return reg ? await reg.pushManager.getSubscription() : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Whether notifications are on for this student, and in this browser.
   * The API is the truth (it may have stopped them: sign-in expired, or every
   * browser turned off); this device's note is brought in line with it.
   */
  async function status() {
    if (!supported()) return { ok: true, on: false, here: false, types: null };
    const sub = await currentSubscription();
    const endpoint = sub ? sub.endpoint : '';
    const r = await api('POST', '/push/status', endpoint ? { endpoint } : {});
    if (!r.ok || !r.data) {
      // Couldn't ask: go by this device (subscribed, and the subscription is the one we told the API about).
      const local = getLocal(ENDPOINT_KEY);
      return { ok: false, code: codeOf(r), on: !!endpoint && endpoint === local, here: !!endpoint && endpoint === local, types: null };
    }
    const here = !!r.data.here;
    if (here) setLocal(ENDPOINT_KEY, endpoint);
    else removeLocal(ENDPOINT_KEY);
    return { ok: true, on: !!r.data.on, here, types: r.data.types || null, configured: r.data.configured !== false };
  }

  /**
   * Turns notifications on for this browser. Permission must already be
   * granted (ask inside the click). On any failure this browser is left
   * unsubscribed, so the toggle can simply go back to off.
   */
  async function enable(types) {
    if (!supported()) return fail('unsupported');
    const c = await config();
    if (c.failed) return fail('network');
    if (!c.publicKey) return fail('push_not_configured');
    let reg;
    try {
      await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      reg = await navigator.serviceWorker.ready;
    } catch (e) {
      return fail('service_worker');
    }
    // Push's own permission answer, which is the one subscribe() goes by.
    // (Notification.permission can disagree, e.g. in headless Chromium.)
    let permission = Notification.permission;
    try {
      if (reg.pushManager.permissionState) permission = await reg.pushManager.permissionState({ userVisibleOnly: true });
    } catch (e) {}
    if (permission === 'denied') return fail('blocked');
    if (permission !== 'granted') return fail('permission');
    let sub;
    try {
      sub = await reg.pushManager.getSubscription();
      // A subscription made for a different server key can't be sent to: start over.
      if (sub && !sameKey(sub.options && sub.options.applicationServerKey, c.publicKey)) {
        await sub.unsubscribe();
        sub = null;
      }
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(c.publicKey) });
    } catch (e) {
      return fail(e && e.name === 'NotAllowedError' ? 'blocked' : 'subscribe_failed');
    }
    const json = sub.toJSON();
    const r = await api('POST', '/push/subscribe', { subscription: { endpoint: json.endpoint, keys: json.keys }, types: cleanTypes(types) });
    if (!r.ok) {
      try {
        await sub.unsubscribe();
      } catch (e) {}
      return fail(codeOf(r));
    }
    setLocal(ENDPOINT_KEY, json.endpoint);
    setLocal(TOUCHED_KEY, String(Date.now()));
    if (getLocal(PENDING_KEY) === json.endpoint) removeLocal(PENDING_KEY);
    return { ok: true, types: (r.data && r.data.types) || null };
  }

  /**
   * Tells the API this browser is off. `done` when it heard, or when there's
   * nothing it could still be keeping: 401 is signed out (sign-out deleted
   * everything already), 403 is the demo or Incognito (never stored anything).
   */
  async function tellApiOff(endpoint) {
    const r = await api('DELETE', '/push/subscribe', { endpoint });
    return { done: r.ok || r.status === 401 || r.status === 403 || r.status === 404, r };
  }

  /**
   * Turns notifications off for this browser. The browser's subscription goes
   * first, so nothing more can arrive even if the API can't be reached; then
   * the API is told (and, with no browser left, deletes the stored sign-in).
   * Offline, the API call is retried by touchIfDue() on the next page load.
   */
  async function disable() {
    const sub = await currentSubscription();
    const endpoint = (sub && sub.endpoint) || getLocal(ENDPOINT_KEY);
    if (sub) {
      try {
        await sub.unsubscribe();
      } catch (e) {}
    }
    removeLocal(ENDPOINT_KEY);
    removeLocal(TOUCHED_KEY);
    if (!endpoint) return { ok: true };
    const told = await tellApiOff(endpoint);
    if (told.done) {
      if (getLocal(PENDING_KEY) === endpoint) removeLocal(PENDING_KEY);
      return { ok: true };
    }
    setLocal(PENDING_KEY, endpoint);
    return fail(codeOf(told.r));
  }

  async function setTypes(types) {
    const r = await api('PUT', '/push/types', { types: cleanTypes(types) });
    return r.ok ? { ok: true, types: (r.data && r.data.types) || null } : fail(codeOf(r));
  }

  async function test() {
    const sub = await currentSubscription();
    const endpoint = (sub && sub.endpoint) || getLocal(ENDPOINT_KEY);
    if (!endpoint) return fail('not_subscribed');
    const r = await api('POST', '/push/test', { endpoint });
    return r.ok ? { ok: true } : fail(codeOf(r));
  }

  /**
   * Called on every page load by the app shell; does something at most once a
   * day. First retries a turn-off the API never heard about. Then, while
   * notifications are on here, sends this session to the API so the stored
   * sign-in keeps up with it. If the API says they're off (the stored sign-in
   * ran out, or they were turned off elsewhere), this browser stops too.
   */
  async function touchIfDue() {
    const pending = getLocal(PENDING_KEY);
    if (pending && (await tellApiOff(pending)).done) removeLocal(PENDING_KEY);
    if (!getLocal(ENDPOINT_KEY)) return { ok: true, touched: false };
    const last = Number(getLocal(TOUCHED_KEY)) || 0;
    if (Date.now() - last < DAY_MS && last <= Date.now()) return { ok: true, touched: false };
    // Noted first, so several tabs opening at once don't all post.
    setLocal(TOUCHED_KEY, String(Date.now()));
    const r = await api('POST', '/push/touch', {});
    if (!r.ok) return fail(codeOf(r));
    if (r.data && r.data.on === false) {
      const sub = await currentSubscription();
      if (sub) {
        try {
          await sub.unsubscribe();
        } catch (e) {}
      }
      removeLocal(ENDPOINT_KEY);
      removeLocal(TOUCHED_KEY);
      return { ok: true, touched: false, on: false };
    }
    return { ok: true, touched: true };
  }

  /**
   * Sign-out: this browser stops receiving and forgets it was on. (The API
   * side is deleted by DELETE /auth/session itself.)
   */
  async function forgetLocal() {
    const sub = await currentSubscription();
    if (sub) {
      try {
        await sub.unsubscribe();
      } catch (e) {}
    }
    removeLocal(ENDPOINT_KEY);
    removeLocal(TOUCHED_KEY);
    removeLocal(PENDING_KEY);
    return { ok: true };
  }

  window.AveragesPush = { supported, config, status, enable, disable, setTypes, test, touchIfDue, forgetLocal };
  window.dispatchEvent(new Event('averages-push-ready'));
})();
