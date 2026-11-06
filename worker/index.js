// app.averages.io's front door.

const SESSION_COOKIE = "averages_session";
const LEGACY_SESSION_COOKIE = "schoolagy_session";
const BOUNCE_COOKIE = "averages_bounced";
const BOUNCE_SECONDS = 15;

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
 * Where a request for "/" should go: "/home", or null for the login page.
 * @param {Request} request
 */
export function frontDoor(request) {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  if (url.pathname !== "/") return null;
  if (KEEP_PARAMS.some((p) => url.searchParams.has(p))) return null;
  const cookies = request.headers.get("Cookie");
  if (!(hasCookie(cookies, SESSION_COOKIE) || hasCookie(cookies, LEGACY_SESSION_COOKIE)) || hasCookie(cookies, BOUNCE_COOKIE)) return null;
  return "/home";
}

export default {
  /** @param {Request} request @param {{ ASSETS: { fetch: (r: Request) => Promise<Response> } }} env */
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/" && url.searchParams.has("signedout")) {
      const page = await env.ASSETS.fetch(new Request(new URL("/", url).toString(), { headers: request.headers }));
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
    return env.ASSETS.fetch(request);
  },
};
