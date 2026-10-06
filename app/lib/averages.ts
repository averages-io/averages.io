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

export type Mode = "live" | "demo" | "out";

/** Short-lived cache of the API's answer, so navigating doesn't re-ask every time. */
const SESSION_CACHE = "schoolagy_session_state";
const SESSION_CACHE_MS = 60 * 1000;

const BUNDLE_CACHE = "schoolagy_bundle_cache";
/** The Files page's course-file list (pages-src/files.html keeps it 5 minutes). */
const FILES_CACHE = "averages_files_cache";

export const API_BASE =
  typeof window !== "undefined" &&
  window.location.hostname.endsWith("averages.io")   // app.averages.io (schoolagy.io until 2026-10-05)
    ? "https://api.averages.io"
    : "http://localhost:8787";

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

/**
 * Drops every page extra (people, updates, events...) cached in this tab.
 * Called wherever the bundle cache is dropped (2026-10-06): they're the same
 * student's data and go stale together.
 */
/**
 * Bumped by clearExtras(). An extra that's still in flight when the student
 * signs out (it ran past the 4 s wait) lands after the wipe; it's only cached
 * if this hasn't moved since it started (2026-10-06 review).
 */
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
  /** Which sign-in this is: Schoology, or Google (for Google Classroom, 2026-10-05). */
  provider?: "schoology" | "google";
  /**
   * The account id (2026-10-06). Page extras are cached under it, so one
   * student's cached teachers or events are never shown to another.
   */
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
export async function getSession(): Promise<SessionState> {
  const cached = cacheGet(SESSION_CACHE);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (Date.now() - parsed.at < SESSION_CACHE_MS) {
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

/**
 * Sign in with Google, for schools on Google Classroom (2026-10-05). The
 * browser goes to the API, which sends it on to Google's consent screen and,
 * once the student agrees, back to the login page with ?google=ok (or a
 * reason it didn't work). The Google tokens never reach the browser: the API
 * seals them into the same httpOnly session cookie as a Schoology sign-in.
 *
 * Forgets the cached "signed out" answer first: coming back from Google within
 * a minute would otherwise read it and stay on the login page.
 */
export function googleSignInUrl(): string {
  forgetSession();
  return `${API_BASE}/auth/google/start?under13=${under13() ? "1" : "0"}`;
}

/** Drops every cached answer about who's signed in and their data. */
export function forgetSession(): void {
  cacheClear(SESSION_CACHE);
  cacheClear(BUNDLE_CACHE);
  cacheClear(FILES_CACHE);
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
    clearExtras();
    return { ok: true, demo: !!data?.demo };
  } catch {
    return { ok: false, error: "network_error" };
  }
}

/**
 * Google Drive and OneDrive connect in the browser (public/js/averages-cloud.js),
 * so their tokens, "Connected as" markers and Edit in Google Drive drafts live
 * on this device. Signing out forgets all of it, so the next person on a shared
 * Chromebook can't reach this student's drive. (Added 2026-10-05.)
 */
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
    // Files picked from OneDrive (names and ids) for Add from OneDrive (2026-10-06).
    window.localStorage.removeItem("averages_onedrive_picked");
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
    window.localStorage.setItem(CLOUD_OWNER_KEY, uid);
  } catch {
    /* storage blocked: nothing can be connected on this device anyway */
  }
}

/** Browser notifications' notes on this device (public/js/averages-push.js). */
const PUSH_KEYS = ["averages_push_endpoint", "averages_push_touched", "averages_push_pending_delete"];

/**
 * Sign-out stops browser notifications on this device (2026-10-06). The API
 * deletes the stored sign-in itself when DELETE /auth/session lands; this
 * unsubscribes the browser and forgets it was on, so the next person on a
 * shared Chromebook doesn't get this student's notifications.
 *
 * averages-push.js has forgetLocal() for exactly this, but it's only loaded
 * on some pages; without it, the same steps inline. Never throws, and never
 * makes sign-out wait more than its own 3 seconds.
 */
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

export async function signOut(): Promise<void> {
  cacheClear(SESSION_CACHE);
  cacheClear(BUNDLE_CACHE);
  cacheClear(FILES_CACHE);
  clearExtras();
  clearCloudConnections();
  const pushForgotten = forgetPushOnThisDevice();
  // The DELETE below is what actually clears the httpOnly session cookie —
  // the API responds with a Set-Cookie that expires it; nothing on this side
  // can touch that cookie directly (that's the point of httpOnly). It has to
  // be allowed to finish on its own terms.
  //
  // Fixed 2026-09-08 (per Martin: "signing out should clear all your
  // cookies" — it wasn't reliably doing that). The previous version wrapped
  // this fetch in an AbortController that hard-cancelled it after 3 seconds
  // "so the button never feels stuck." That's a real UX goal, but
  // `controller.abort()` doesn't just stop waiting — it tears down the
  // in-flight connection, so whenever the request hadn't finished by the 3s
  // mark (a Workers cold start alone can eat a meaningful chunk of that),
  // the server's clearing Set-Cookie was never received or processed, and
  // the session cookie was silently left behind even though the app itself
  // had already moved on as if signed out. The fix: race a timeout against
  // how long THIS FUNCTION waits, not against the request itself — the
  // fetch keeps running in the background and still gets to clear the
  // cookie whenever its response actually lands, however long that takes.
  const deleteRequest = fetch(`${API_BASE}/auth/session`, {
    method: "DELETE",
    credentials: "include",
  }).catch(() => {
    /* the cookie expires on its own in 30 days either way */
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
    // The device's time zone, so Google Classroom's UTC due dates show on the
    // right day (Schoology's bundle ignores it).
    let tz = "";
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
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

/**
 * Drops expired extras (2026-10-06 review). Event keys carry their date
 * window, so yesterday's never get read again; without this a tab left open
 * for weeks would fill sessionStorage and every later save would fail.
 */
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
      if (!(Date.now() - at < EXTRAS_CACHE_MS && at <= Date.now())) stale.push(key);
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
   * Answers by extra, filled in as each one lands. loadExtras() resolves at
   * the 4 s mark at the latest; anything that lands after that but before
   * the bundle does is still here when LegacyPage merges, and anything later
   * still fills the cache for the next page.
   */
  answers: Partial<Record<ExtraName, unknown>>;
  /** An extra got a 401: the session died, same as loadBundle's "signed_out". */
  signedOut: boolean;
}

/**
 * Loads one page's extras (2026-10-06; which ones: EXTRAS_BY_PAGE in
 * ./extras.ts). Live sessions only: demo pages run on sample data and the
 * API answers these with 403 there anyway.
 *
 *   - All in parallel, each cached in sessionStorage for 5 minutes under a
 *     key starting "averages_extras_", tagged with the student (`who`): a
 *     cached answer from another account is ignored.
 *   - Waits at most EXTRAS_WAIT_MS (4 s). A slow extra doesn't hold the page:
 *     it renders without that one (its signed-in empty state), and the call
 *     keeps going and fills the cache, so the next page has it.
 *   - A failed call (network, 5xx, 403, 404) is simply absent. Never cached.
 */
export async function loadExtras(pageId: string, search: string, who = ""): Promise<ExtrasResult> {
  sweepExtras();
  const generation = extrasGeneration;
  const requests = extrasFor(pageId, search, new Date());
  const result: ExtrasResult = { requests, answers: {}, signedOut: false };
  const pending: Promise<void>[] = [];

  for (const req of requests) {
    const cached = cacheGet(req.cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        const fresh = Date.now() - parsed.at < EXTRAS_CACHE_MS && parsed.at <= Date.now();
        if (fresh && parsed.who === who && "data" in parsed) {
          result.answers[req.name] = parsed.data;
          continue;
        }
      } catch {
        /* unreadable: ask again */
      }
      cacheClear(req.cacheKey);
    }

    pending.push(
      (async () => {
        try {
          const response = await fetch(`${API_BASE}${req.path}`, { credentials: "include" });
          if (response.status === 401) {
            cacheClear(SESSION_CACHE);
            result.signedOut = true;
            return;
          }
          if (!response.ok) return;
          const data = await response.json();
          // Signed out (or in as someone else) while this was in flight: don't cache it.
          if (generation === extrasGeneration) cacheSet(req.cacheKey, JSON.stringify({ at: Date.now(), who, data }));
          result.answers[req.name] = data;
        } catch {
          /* network or JSON error: this extra is just absent */
        }
      })()
    );
  }

  if (pending.length) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.all(pending),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, EXTRAS_WAIT_MS);
      }),
    ]);
    if (timer !== undefined) clearTimeout(timer);
  }
  return result;
}
