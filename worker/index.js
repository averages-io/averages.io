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

/** Sign-in page addresses that carry something to show (a Google outcome, the hidden key form): never skipped. */
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
 * Where a request for "/" should go: the start page ("/home", "/IS/home", ...), or null for the sign-in page.
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
 * The sign-in page, shown at "/" (fs-src/signin.html, built to /IS/signin). The address stays "/", so nothing
 * flashes and links to "/" keep working.
 * @param {Request} request @param {{ ASSETS: { fetch: (r: Request) => Promise<Response> } }} env
 */
function signinPage(request, env) {
  const url = new URL(request.url);
  return env.ASSETS.fetch(new Request(new URL("/IS/signin", url).toString(), { method: request.method, headers: request.headers }));
}

/**
 * A.I. search's files (2026-11-15, public/js/averages-ai.js): the model and the ONNX Runtime .wasm are too big for
 * static assets (25 MiB a file), so they live in R2 (bucket "averages-ai", binding AI_FILES) and come through here,
 * on the app's own site: no other site, no CORS. Only GET/HEAD of a fixed set of paths under /ai/. Each version
 * has its own folder name, so they never change in place and browsers can keep them for a year.
 */
const AI_PATH = /^\/ai\/((?:models\/averages-search-(?:q4|q8)-r[0-9]+\/(?:onnx\/)?|runtime\/ort-[0-9a-z.\-]+\/)[A-Za-z0-9_.\-]+)$/;
const AI_TYPES = { json: "application/json", onnx: "application/octet-stream", onnx_data: "application/octet-stream", wasm: "application/wasm", txt: "text/plain; charset=utf-8" };
/** @param {Request} request @param {any} env */
export async function aiFile(request, env) {
  const url = new URL(request.url);
  const m = AI_PATH.exec(url.pathname);
  if (!m || m[1].includes("..")) return new Response("Not found", { status: 404 });
  if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  if (!env.AI_FILES) return new Response("A.I. files aren't set up", { status: 503, headers: { "Cache-Control": "no-store" } });
  const obj = request.method === "HEAD" ? await env.AI_FILES.head(m[1]) : await env.AI_FILES.get(m[1]);
  if (!obj) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const ext = (m[1].match(/\.([a-z_]+)$/) || [, ""])[1];
  const headers = new Headers({
    "Content-Type": AI_TYPES[ext] || "application/octet-stream",
    "Content-Length": String(obj.size),
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  });
  if (obj.httpEtag) headers.set("ETag", obj.httpEtag);
  return new Response(request.method === "HEAD" ? null : obj.body, { status: 200, headers });
}

export default {
  /** @param {Request} request @param {{ ASSETS: { fetch: (r: Request) => Promise<Response> }, AI_FILES?: any }} env */
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/ai/")) return aiFile(request, env);
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
    // The sign-in page as usual. Its asset headers already make the browser
    // check back every time (max-age=0, must-revalidate), and that check comes
    // through here too, so a cached sign-in page never skips the redirect.
    return url.pathname === "/" ? signinPage(request, env) : env.ASSETS.fetch(request);
  },
};
