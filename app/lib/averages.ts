/**
 * Session + data layer shared by every page.
 *
 * Averages.io runs in one of three states:
 *
 *   "live" — signed in with a real Schoology personal API key. Pages render
 *            the student's actual courses, grades and assignments.
 *   "demo" — signed in with "demo" as both the key and the secret. Every page
 *            runs on its own built-in sample data, so a beta tester with no
 *            Schoology account can use the whole app.
 *   "out"  — not signed in. App pages bounce back to the login screen.
 *
 * IMPORTANT: the server decides which of those you are, not the browser.
 *
 * An earlier version kept the mode in localStorage and let Escape on the login
 * screen set it, which meant anyone could type a URL or edit browser storage
 * and walk straight into any page. Now the only way in is a session cookie
 * issued by api.averages.io after it accepted your credentials — httpOnly, so
 * page JS can't read or forge it — and every page asks the API who you are
 * before it renders anything.
 */

import {
  EXTRAS_CACHE_MS,
  EXTRAS_PREFIX,
  EXTRAS_WAIT_MS,
  extrasFor,
  type ExtraName,
  type ExtraRequest,
} from "./extras";
import { SPLASH_KEY } from "./splash";

export type Mode = "live" | "demo" | "out";

/** Short-lived cache of the API's answer, so navigating doesn't re-ask every time. */
const SESSION_CACHE = "schoolagy_session_state";
const SESSION_CACHE_MS = 60 * 1000;

const BUNDLE_CACHE = "schoolagy_bundle_cache";
/** The Files page's course-file list (pages-src/files.html keeps it 5 minutes). */
const FILES_CACHE = "averages_files_cache";
const SUBS_CACHE = "averages_subs_cache";

export const API_BASE =
  typeof window !== "undefined" &&
  window.location.hostname.endsWith("averages.io")
    ? "https://api.averages.io"
    : "http://localhost:8787";

export const SIGNED_IN_HINT = "averages_signed_in";
export function setSignedInHint(on: boolean): void {
  try {
    window.localStorage.setItem(SIGNED_IN_HINT, on ? "1" : "0");
  } catch {
    /* private browsing — the login page just checks with the screen black */
  }
}

function cacheGet(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function cacheSet(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    /* private browsing — we just re-ask the API each time */
  }
}
function cacheClear(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    /* non-fatal */
  }
}

let extrasGeneration = 0;

export function clearExtras(): void {
  extrasGeneration++;
  try {
    const store = window.sessionStorage;
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key && key.startsWith(EXTRAS_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => store.removeItem(key));
  } catch {
    /* storage blocked: nothing was cached either */
  }
}

export interface SessionState {
  mode: Mode;
  name?: string;
  /** Signed in as under 13: Incognito only (sealed into the session by the API). */
  incognito?: boolean;
  provider?: "schoology" | "google";
  uid?: string;
}

/**
 * Asks the API who this visitor is.
 *
 * This is the authorization check for the whole app. The cache below is only a
 * latency optimization with a one-minute life — it can make a page render a
 * moment sooner, never let someone in who shouldn't be. Anything that gets a
 * 401 from the API clears it immediately.
 */
export async function getSession(opts?: { fresh?: boolean }): Promise<SessionState> {
  const cached = opts && opts.fresh ? null : cacheGet(SESSION_CACHE);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (Date.now() - parsed.at < SESSION_CACHE_MS && parsed.state && parsed.state.mode !== "out") {
        return parsed.state as SessionState;
      }
    } catch {
      cacheClear(SESSION_CACHE);
    }
  }

  let state: SessionState = { mode: "out" };
  try {
    const response = await fetch(`${API_BASE}/auth/me`, { credentials: "include" });
    if (response.ok) {
      const data = (await response.json()) as any;
      state = {
        mode: data?.demo ? "demo" : "live",
        name: data?.name,
        incognito: data?.incognito === true,
        provider: data?.provider === "google" ? "google" : "schoology",
        uid: data?.uid != null ? String(data.uid) : undefined,
      };
      if (!data?.demo && data?.uid != null) claimCloudConnections(String(data.uid));
    }
    // Only a real answer changes the hint: yes, or the API saying no (401).
    // An unreachable API or a school platform that's down (502) says nothing
    // about whether the cookie is there.
    if (response.ok) setSignedInHint(true);
    else if (response.status === 401) setSignedInHint(false);
  } catch {
    // Network failure is not authorization. Treat it as signed-out rather than
    // letting someone in because the API happened to be unreachable.
    state = { mode: "out" };
  }

  cacheSet(SESSION_CACHE, JSON.stringify({ at: Date.now(), state }));
  return state;
}

export interface SignInResult {
  ok: boolean;
  error?: string;
  demo?: boolean;
}

/**
 * Signs in with a Schoology personal API key — or with "demo"/"demo", which is
 * the one and only way into sample-data mode.
 */
function under13(): boolean {
  try {
    return window.localStorage.getItem("schoolagy_13plus") !== "yes";
  } catch {
    return true;
  }
}

/** Drops every cached answer about who's signed in and their data. */
export function forgetSession(): void {
  cacheClear(SESSION_CACHE);
  cacheClear(SPLASH_KEY);
  cacheClear(BUNDLE_CACHE);
  cacheClear(FILES_CACHE);
  cacheClear(SUBS_CACHE);
  clearExtras();
}

export async function signIn(key: string, secret: string): Promise<SignInResult> {
  try {
    const response = await fetch(`${API_BASE}/auth/session`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      // The login page's "I'm 13 or older" box (saved just before this runs).
      // Unticked means under 13: the API seals Incognito into the session.
      body: JSON.stringify({ key, secret, under13: under13() }),
    });
    const data = (await response.json().catch(() => ({}))) as any;
    if (!response.ok) {
      return { ok: false, error: data?.error ?? `http_${response.status}` };
    }
    // A fresh sign-in invalidates whatever we thought before.
    cacheClear(SESSION_CACHE);
    cacheClear(BUNDLE_CACHE);
    cacheClear(FILES_CACHE);
    cacheClear(SUBS_CACHE);
    clearExtras();
    // The next page picks up the logo the sign-in screen put up (splash.ts).
    cacheClear(SPLASH_KEY);
    setSignedInHint(true);
    return { ok: true, demo: !!data?.demo };
  } catch {
    return { ok: false, error: "network_error" };
  }
}

const CLOUD_OWNER_KEY = "averages_cloud_owner";

export function clearCloudConnections(): void {
  try {
    window.sessionStorage.removeItem("averages_cloud_tokens");
  } catch {
    /* storage blocked: nothing was saved there either */
  }
  try {
    window.localStorage.removeItem("averages_cloud_accounts");
    window.localStorage.removeItem("averages_drive_drafts");
    window.localStorage.removeItem("averages_onedrive_picked");
    window.localStorage.removeItem("averages_drive_opened");
    window.localStorage.removeItem(CLOUD_OWNER_KEY);
  } catch {
    /* same */
  }
}

/**
 * Session expiry doesn't run signOut(), so a different student could sign in
 * on a browser that still has someone else's drive connected. The device
 * remembers whose connections these are and drops them when that changes.
 */
function claimCloudConnections(uid: string): void {
  try {
    if (window.localStorage.getItem(CLOUD_OWNER_KEY) === uid) return;
    clearCloudConnections();
    cacheClear(FILES_CACHE);
    cacheClear(SUBS_CACHE);
    window.localStorage.setItem(CLOUD_OWNER_KEY, uid);
  } catch {
    /* storage blocked: nothing can be connected on this device anyway */
  }
}

/** Browser notifications' notes on this device (public/js/averages-push.js). */
const PUSH_KEYS = ["averages_push_endpoint", "averages_push_touched", "averages_push_pending_delete"];

function forgetPushOnThisDevice(): Promise<void> {
  // The notes go first and synchronously: they're what the next page load
  // reads, and navigating away can cut the async part off.
  try {
    PUSH_KEYS.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    /* storage blocked: nothing was saved there either */
  }
  return (async () => {
    try {
      const push = (window as unknown as { AveragesPush?: { forgetLocal?: () => Promise<unknown> } }).AveragesPush;
      if (push && typeof push.forgetLocal === "function") {
        await push.forgetLocal();
        return;
      }
      if (!("serviceWorker" in navigator)) return;
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = registration ? await registration.pushManager.getSubscription() : null;
      if (subscription) await subscription.unsubscribe();
    } catch {
      /* best effort: the API has already stopped sending to it */
    }
  })();
}

const OUR_STORAGE_KEY = /^(schoolagy_|averages_|fs|wi_|av_help_)/;

/** Whether this device was syncing settings to the account when signing out. */
function forgetEverythingOnThisDevice(): void {
  void OUR_STORAGE_KEY;
  for (const store of [window.localStorage, window.sessionStorage]) {
    try {
      store.clear();
    } catch {
      /* storage blocked: nothing was saved there either */
    }
  }
}

/** The app's own cookie (worker/index.js's loop guard), the only one page code can reach. */
function clearAppCookies(): void {
  try {
    const host = window.location.hostname, parent = host.split(".").slice(-2).join(".");
    document.cookie.split(";").map((c) => c.split("=")[0].trim()).filter(Boolean).forEach((name) => {
      for (const domain of ["", `; Domain=${host}`, `; Domain=.${parent}`]) {
        document.cookie = `${name}=; Path=/; Max-Age=0${domain}; SameSite=Lax`;
        document.cookie = `${name}=; Path=/; Max-Age=0${domain}; Secure; SameSite=Lax`;
      }
    });
  } catch {
    /* nothing to clear */
  }
  try {
    // With and without Secure: a page on plain http (local testing) can't set
    // a Secure cookie, even an expired one.
    document.cookie = "averages_bounced=; Path=/; Max-Age=0; Secure; SameSite=Lax";
    document.cookie = "averages_bounced=; Path=/; Max-Age=0; SameSite=Lax";
  } catch {
    /* nothing to clear */
  }
}

export async function signOut(): Promise<void> {
  const forgetOnServer = true;
  setSignedInHint(false);
  cacheClear(SESSION_CACHE);
  cacheClear(BUNDLE_CACHE);
  // The next sign-in in this tab gets the first-open logo again (app/lib/splash.ts).
  cacheClear(SPLASH_KEY);
  cacheClear(FILES_CACHE);
  cacheClear(SUBS_CACHE);
  clearExtras();
  clearCloudConnections();
  const pushForgotten = forgetPushOnThisDevice();
  // Synchronously, before the caller navigates away. The push notes above go
  // first because forgetPushOnThisDevice reads nothing else from storage.
  forgetEverythingOnThisDevice();
  clearAppCookies();
  // The one note kept: the login page shows its buttons straight away.
  setSignedInHint(false);
  const deleteRequest = fetch(`${API_BASE}/auth/session${forgetOnServer ? "?forget=1" : ""}`, {
    method: "DELETE",
    credentials: "include",
  }).catch(() => {
    /* the cookie expires on its own in 15 days either way */
  });
  await Promise.race([
    Promise.all([deleteRequest, pushForgotten]),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
}

export interface Bundle {
  generatedAt?: string;
  demo?: boolean;
  COURSES?: unknown[];
  HISTORY?: Record<string, unknown>;
  OVERDUE?: unknown[];
  UPCOMING?: unknown[];
  TODAY?: unknown[];
  MESSAGES?: unknown[];
}

export function studentTimeZone(): string {
  const w = window as unknown as { averagesTimeZone?: () => string };
  if (typeof w.averagesTimeZone === "function") return w.averagesTimeZone() || "";
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
}

/**
 * Fetches the adapted data bundle.
 *
 * In demo mode the API returns an empty bundle on purpose, which is the signal
 * for each page to fall through to the sample data in its own markup.
 *
 * Returns "signed_out" when the session died (401), and null when the data
 * could not be loaded for any other reason (network error, timeout, 5xx).
 * In live mode the caller must treat null as an error, never as "use the
 * sample data": sample grades would look like the student's real ones.
 */
export async function loadBundle(): Promise<Bundle | null | "signed_out"> {
  const cached = cacheGet(BUNDLE_CACHE);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (Date.now() - parsed.at < 5 * 60 * 1000) return parsed.bundle as Bundle;
    } catch {
      cacheClear(BUNDLE_CACHE);
    }
  }

  try {
    // The student's time zone (Settings > Time Zone, else this device's), so
    // Schoology's local due times and Classroom's UTC ones land on the right day.
    let tz = "";
    try {
      tz = studentTimeZone();
    } catch {
      /* the API falls back to its own guess */
    }
    const response = await fetch(`${API_BASE}/data/bundle${tz ? `?tz=${encodeURIComponent(tz)}` : ""}`, { credentials: "include" });
    if (response.status === 401) {
      // Session died underneath us — drop the cached "you're signed in" answer
      // so the next guard check sends them back to sign in.
      cacheClear(SESSION_CACHE);
      return "signed_out";
    }
    if (!response.ok) return null;
    const bundle = (await response.json()) as Bundle;
    cacheSet(BUNDLE_CACHE, JSON.stringify({ at: Date.now(), bundle }));
    return bundle;
  } catch {
    return null;
  }
}

export function invalidateBundle(): void {
  cacheClear(BUNDLE_CACHE);
  clearExtras();
}

function sweepExtras(): void {
  try {
    const store = window.sessionStorage;
    const stale: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (!key || !key.startsWith(EXTRAS_PREFIX)) continue;
      let at = 0;
      try {
        at = Number(JSON.parse(store.getItem(key) || "{}").at) || 0;
      } catch {
        /* unreadable: stale */
      }
      const keep = key.startsWith(EXTRAS_PREFIX + "updates") ? BELL_UPDATES_MAX_AGE_MS : EXTRAS_CACHE_MS;
      if (!(Date.now() - at < keep && at <= Date.now())) stale.push(key);
    }
    stale.forEach((key) => store.removeItem(key));
  } catch {
    /* storage blocked: nothing to sweep */
  }
}

export interface ExtrasResult {
  /** The calls this page made (or found cached). */
  requests: ExtraRequest[];
  /**
   * Answers by extra, filled in as each one lands: the cached ones at once,
   * the rest as their calls answer. A failed call never gets an entry.
   */
  answers: Partial<Record<ExtraName, unknown>>;
  /** An extra got a 401: the session died, same as loadBundle's "signed_out". */
  signedOut: boolean;
}

/** What each extra's call came to: "ok" (in answers), "failed", or "signed_out" (401). */
export type ExtraOutcome = "ok" | "failed" | "signed_out";

export interface ExtrasRun extends ExtrasResult {
  /** Settles when that extra's answer is in (at once for a cached one). Never rejects. */
  settled: Partial<Record<ExtraName, Promise<ExtraOutcome>>>;
}

export const BELL_UPDATES_MAX_AGE_MS = 15 * 60 * 1000;

export function startExtras(pageId: string, search: string, who = "", opts: { maxAgeMs?: number } = {}): ExtrasRun {
  sweepExtras();
  const generation = extrasGeneration;
  const maxAge = opts.maxAgeMs ?? EXTRAS_CACHE_MS;
  const requests = extrasFor(pageId, search, new Date());
  const run: ExtrasRun = { requests, answers: {}, signedOut: false, settled: {} };

  for (const req of requests) {
    const cached = cacheGet(req.cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        const fresh = Date.now() - parsed.at < maxAge && parsed.at <= Date.now();
        if (fresh && parsed.who === who && "data" in parsed) {
          run.answers[req.name] = parsed.data;
          run.settled[req.name] = Promise.resolve("ok");
          continue;
        }
      } catch {
        /* unreadable: ask again */
      }
      cacheClear(req.cacheKey);
    }

    run.settled[req.name] = (async (): Promise<ExtraOutcome> => {
      try {
        const response = await fetch(`${API_BASE}${req.path}`, { credentials: "include" });
        if (response.status === 401) {
          cacheClear(SESSION_CACHE);
          run.signedOut = true;
          return "signed_out";
        }
        if (!response.ok) return "failed";
        const data = await response.json();
        // Signed out (or in as someone else) while this was in flight: don't cache it.
        if (generation === extrasGeneration) cacheSet(req.cacheKey, JSON.stringify({ at: Date.now(), who, data }));
        run.answers[req.name] = data;
        return "ok";
      } catch {
        /* network or JSON error: this extra is just absent */
        return "failed";
      }
    })();
  }
  return run;
}

/**
 * Waits for the given extras of a run, at most `ms` (EXTRAS_WAIT_MS by default).
 * Anything that lands later still shows up in run.answers and the cache.
 */
export async function waitForExtras(run: ExtrasRun, names: readonly ExtraName[], ms = EXTRAS_WAIT_MS): Promise<void> {
  const pending = names.map((name) => run.settled[name]).filter((p): p is Promise<ExtraOutcome> => !!p);
  if (!pending.length) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all(pending),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms);
    }),
  ]);
  if (timer !== undefined) clearTimeout(timer);
}

/**
 * Starts a page's extras and waits for all of them (at most EXTRAS_WAIT_MS).
 * Used by the bell's background check; pages use startExtras().
 */
export async function loadExtras(pageId: string, search: string, who = "", opts: { maxAgeMs?: number } = {}): Promise<ExtrasResult> {
  const run = startExtras(pageId, search, who, opts);
  await waitForExtras(run, run.requests.map((r) => r.name));
  return run;
}

async function adoptSyncedRecord(remote: any, stamp: string, ask: (path: string) => Promise<Response>): Promise<string[]> {
  const ls = window.localStorage;
  const readJson = (k: string) => {
    try {
      return JSON.parse(ls.getItem(k) || "null");
    } catch {
      return null;
    }
  };
  const MEDIA_REF = /^r2:(photo|background):([A-Za-z0-9._-]{1,128})$/;
  const known: Record<string, { v?: string; h?: string; pending?: boolean }> = readJson("averages_sync_media") || {};
  const media: Record<string, unknown> = { ...known };
  const isImage = (v: unknown) => typeof v === "string" && /^data:image\//.test(v);
  const hashOf = async (text: string) => {
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(d).slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
  };
  const toDataUrl = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  // undefined = leave this device's picture as it is.
  const picture = async (kind: "photo" | "background", ref: unknown, local: unknown): Promise<unknown> => {
    if (typeof ref !== "string" || !ref.startsWith("r2:")) return ref;
    const m = MEDIA_REF.exec(ref);
    if (!m || m[1] !== kind) return undefined;
    const have = known[kind];
    if (have && have.v === m[2] && !have.pending && isImage(local)) return local;
    try {
      const r = await ask(`/media/${kind}`);
      if (!r.ok) return undefined;
      const url = await toDataUrl(await r.blob());
      if (!isImage(url)) return undefined;
      media[kind] = { v: (r.headers.get("X-Media-Version") || m[2]).replace(/"/g, ""), h: await hashOf(url) };
      return url;
    } catch {
      return undefined;
    }
  };
  const localAppearance = readJson("schoolagy_appearance");
  const localProfile = readJson("schoolagy_profile");
  const next: Record<string, string> = {};
  if (remote.settingsOptions && typeof remote.settingsOptions === "object") {
    // Notifications on/off belongs to each browser, not the account.
    const options = { ...remote.settingsOptions };
    delete options.browserNotifications;
    const mine = (readJson("schoolagy_settings_options") || {}).browserNotifications;
    if (mine !== undefined) options.browserNotifications = mine;
    next.schoolagy_settings_options = JSON.stringify(options);
  }
  if (remote.appearance && typeof remote.appearance === "object") {
    const appearance = { ...remote.appearance };
    const bg = await picture("background", appearance.background, localAppearance && localAppearance.background);
    if (bg === undefined) {
      if (localAppearance && localAppearance.background != null) appearance.background = localAppearance.background;
      else delete appearance.background;
    } else appearance.background = bg;
    next.schoolagy_appearance = JSON.stringify(appearance);
  }
  if (remote.darkMode === "dark" || remote.darkMode === "light") next.schoolagy_dark_mode = remote.darkMode;
  if (remote.profile && typeof remote.profile === "object") {
    const profile = { ...remote.profile };
    const photo = await picture("photo", profile.photo, localProfile && localProfile.photo);
    if (photo === undefined) {
      if (localProfile && localProfile.photo) profile.photo = localProfile.photo;
      else delete profile.photo;
    } else profile.photo = photo;
    next.schoolagy_profile = JSON.stringify(profile);
    if (typeof profile.name === "string" && profile.name.trim()) next.schoolagy_profile_name = profile.name.trim();
  }
  const changed: string[] = [];
  for (const [k, v] of Object.entries(next)) {
    if (ls.getItem(k) !== v) {
      ls.setItem(k, v);
      changed.push(k);
    }
  }
  ls.setItem("averages_sync_media", JSON.stringify(media));
  ls.setItem("schoolagy_sync_meta", JSON.stringify({ settingsUpdatedAt: stamp }));
  return changed;
}

function apiAsk(ms: number) {
  return async (path: string) => {
    const ctrl = new AbortController();
    const t = window.setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(`${API_BASE}${path}`, { credentials: "include", signal: ctrl.signal });
    } finally {
      window.clearTimeout(t);
    }
  };
}

/** The account's synced copy, or null (none yet, Incognito, an error). */
async function fetchSyncedRecord(ask: (path: string) => Promise<Response>): Promise<{ settings: any; stamp: string } | null> {
  const res = await ask("/sync/settings");
  if (!res.ok) return null;
  const record = await res.json();
  const settings = record && record.settings;
  const stamp = record && typeof record.settingsUpdatedAt === "string" ? record.settingsUpdatedAt : "";
  return settings && typeof settings === "object" && stamp ? { settings, stamp } : null;
}

export async function restoreSyncedSetup(): Promise<boolean> {
  try {
    const ask = apiAsk(4000);
    const record = await fetchSyncedRecord(ask);
    if (!record) return false;
    await adoptSyncedRecord(record.settings, record.stamp, ask);
    window.localStorage.setItem("schoolagy_onboarded", "1");
    return true;
  } catch {
    return false;
  }
}

export const SYNC_PULL_EVERY_MS = 5 * 60 * 1000;
const SYNC_PULLED_AT = "averages_sync_pulled_at";
export async function pullSyncedSettings(): Promise<string[]> {
  try {
    const last = Number(cacheGet(SYNC_PULLED_AT) || 0);
    if (Date.now() - last < SYNC_PULL_EVERY_MS) return [];
    cacheSet(SYNC_PULLED_AT, String(Date.now()));
    const ask = apiAsk(8000);
    const record = await fetchSyncedRecord(ask);
    if (!record) return [];
    let meta = "";
    try {
      meta = (JSON.parse(window.localStorage.getItem("schoolagy_sync_meta") || "null") || {}).settingsUpdatedAt || "";
    } catch {}
    if (meta === record.stamp) return [];
    return await adoptSyncedRecord(record.settings, record.stamp, ask);
  } catch {
    return [];
  }
}
