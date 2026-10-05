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

export interface SessionState {
  mode: Mode;
  name?: string;
  /** Signed in as under 13: Incognito only (sealed into the session by the API). */
  incognito?: boolean;
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
      state = { mode: data?.demo ? "demo" : "live", name: data?.name, incognito: data?.incognito === true };
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

export async function signOut(): Promise<void> {
  cacheClear(SESSION_CACHE);
  cacheClear(BUNDLE_CACHE);
  cacheClear(FILES_CACHE);
  clearCloudConnections();
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
    deleteRequest,
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
    const response = await fetch(`${API_BASE}/data/bundle`, { credentials: "include" });
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
}
