/**
 * app.averages.io's front door (2026-10-13).
 *
 * Everything else on app.averages.io is static files from ./out, served by
 * Cloudflare straight from the assets without running this. Only "/" (the
 * login page) comes through here; see run_worker_first in wrangler.jsonc.
 *
 * Why: the login page used to load, start the app, ask the API whether you're
 * signed in, and only then send you to Home. Signed in, that meant staring at
 * the sign-in buttons (later a black screen) for a few seconds. The browser
 * already sends the session cookie with the request for this page, because
 * the API sets it for all of .averages.io, so the answer is here before any
 * page is sent: a cookie means Home, no cookie means the login page.
 *
 * This only looks for the cookie, it can't open it (the secret lives in the
 * API, not here). That's enough for choosing a page. It is not a security
 * check: Home asks the API for real, and a dead cookie gets a 401 there, which
 * also deletes it, so the next visit lands on the login page.
 *
 * The bounce cookie is the loop guard. If Home can't use the session for any
 * reason (API down, school platform refusing, a 401 that didn't clear the
 * cookie), it sends you back to "/"; without the guard this would send you
 * straight back to Home, forever. After one redirect, "/" serves the login
 * page for the next 15 seconds whatever the cookies say, and the login page's
 * own check takes over from there.
 *
 * Plain JavaScript on purpose: Next type-checks every .ts file in the repo and
 * doesn't know Cloudflare's Worker types.
 */

const SESSION_COOKIE = "schoolagy_session";
const BOUNCE_COOKIE = "averages_bounced";
const BOUNCE_SECONDS = 15;

/** Login-page addresses that carry something to show (a Google outcome, the hidden key form): never skipped. */
const KEEP_PARAMS = ["google", "keys", "demo"];

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
 * Where a request for "/" should go: "/home", or null for the login page.
 * @param {Request} request
 */
export function frontDoor(request) {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  if (url.pathname !== "/") return null;
  if (KEEP_PARAMS.some((p) => url.searchParams.has(p))) return null;
  const cookies = request.headers.get("Cookie");
  if (!hasCookie(cookies, SESSION_COOKIE) || hasCookie(cookies, BOUNCE_COOKIE)) return null;
  return "/home";
}

export default {
  /** @param {Request} request @param {{ ASSETS: { fetch: (r: Request) => Promise<Response> } }} env */
  async fetch(request, env) {
    const to = frontDoor(request);
    if (to) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: to,
          // Not HttpOnly: it holds nothing ("1"), and sign-out clears it from the page (2026-10-14).
          "Set-Cookie": `${BOUNCE_COOKIE}=1; Path=/; Max-Age=${BOUNCE_SECONDS}; Secure; SameSite=Lax`,
          "Cache-Control": "no-store",
        },
      });
    }
    // The login page as usual. Its asset headers already make the browser
    // check back every time (max-age=0, must-revalidate), and that check comes
    // through here too, so a cached login page never skips the redirect.
    return env.ASSETS.fetch(request);
  },
};
