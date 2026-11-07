// app.averages.io's front door.

const SESSION_COOKIE = "averages_session";
const LEGACY_SESSION_COOKIE = "schoolagy_session";
const BOUNCE_COOKIE = "averages_bounced";
const BOUNCE_SECONDS = 15;
/** Where "/" sends a signed-in student: set by the app's pages from the look and Open to they picked. */
const START_COOKIE = "averages_start";
const START_RE = /^\/(IS\/)?(home|courses|calendar|grades|messages|assignments|files|contacts)$/;

/** @param {string | null} header @param {string} name */
export function cookieValue(header, name) {
  if (!header) return "";
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return "";
}

/** Login-page addresses that carry something to show (a Google outcome, the hidden key form): never skipped. */
const KEEP_PARAMS = ["google", "keys", "demo", "signedout"];

/** @param {string | null} header @param {string} name */
export function hasCookie(header, name) {
  if (!header) return false;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name && part.slice(eq + 1).trim() !== "") return true;
  }
  return false;
}

/**
 * Where a request for "/" should go: the start page ("/home", "/IS/home", ...), or null for the login page.
 * @param {Request} request
 */
export function frontDoor(request) {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  if (url.pathname !== "/") return null;
  if (KEEP_PARAMS.some((p) => url.searchParams.has(p))) return null;
  const cookies = request.headers.get("Cookie");
  if (!(hasCookie(cookies, SESSION_COOKIE) || hasCookie(cookies, LEGACY_SESSION_COOKIE)) || hasCookie(cookies, BOUNCE_COOKIE)) return null;
  // Straight to the page they open to (Fullscreen's own address when that's their look), skipping /home's redirect
  let start = "";
  try { start = decodeURIComponent(cookieValue(cookies, START_COOKIE)); } catch { start = ""; }
  return START_RE.test(start) ? start : "/home";
}

/**
 * The sign-in page to show at "/": the new one (/IS/signin) while NEW_SIGNIN_PAGE is "1", otherwise the current one.
 * The address stays "/", so nothing flashes and links to "/" keep working.
 * @param {Request} request @param {{ ASSETS: { fetch: (r: Request) => Promise<Response> }, NEW_SIGNIN_PAGE?: string }} env
 */
function signinPage(request, env) {
  if (String(env.NEW_SIGNIN_PAGE || "0") !== "1") return env.ASSETS.fetch(request);
  const url = new URL(request.url);
  return env.ASSETS.fetch(new Request(new URL("/IS/signin", url).toString(), { method: request.method, headers: request.headers }));
}

export default {
  /** @param {Request} request @param {{ ASSETS: { fetch: (r: Request) => Promise<Response> }, NEW_SIGNIN_PAGE?: string }} env */
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/" && url.searchParams.has("signedout")) {
      const page = await signinPage(new Request(new URL("/", url).toString(), { headers: request.headers }), env);
      const res = new Response(page.body, page);
      res.headers.set("Clear-Site-Data", '"cookies", "storage"');
      res.headers.set("Cache-Control", "no-store");
      return res;
    }
    const to = frontDoor(request);
    if (to) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: to,
          "Set-Cookie": `${BOUNCE_COOKIE}=1; Path=/; Max-Age=${BOUNCE_SECONDS}; Secure; SameSite=Lax`,
          "Cache-Control": "no-store",
        },
      });
    }
    // The login page as usual. Its asset headers already make the browser
    // check back every time (max-age=0, must-revalidate), and that check comes
    // through here too, so a cached login page never skips the redirect.
    return url.pathname === "/" ? signinPage(request, env) : env.ASSETS.fetch(request);
  },
};
