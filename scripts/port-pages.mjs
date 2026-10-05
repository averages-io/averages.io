/**
 * Build step: turns Schoolagy's self-contained HTML mockup pages into Next.js
 * routes, and wires them to real data, real image screening and real auth.
 *
 * Run with:  node scripts/port-pages.mjs
 *
 * SOURCE OF TRUTH IS pages-src/*.html — the same self-contained pages that have
 * always been the design artifact. This script never edits them; it reads them
 * and generates app/**\/page.tsx, which are build artifacts and NOT committed
 * (see .gitignore).
 *
 * That means the workflow stays what it has always been: edit the HTML, push,
 * and the deploy regenerates the routes around it. It also means the generated
 * TSX never shows up as 2MB of noise in a diff.
 *
 * IMPORTANT: every transform below asserts that it actually matched. If a
 * source page changes shape, the build fails loudly instead of silently
 * shipping an app whose NSFW filter or live-data wiring quietly did nothing.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(HERE, "../pages-src");
const APP_DIR = path.resolve(HERE, "../app");

/** filename (no .html) -> route path ("" = root) */
const ROUTES = {
  login: "",
  onboarding: "onboard",
  home: "home",
  courses: "courses",
  "course-home": "course-home",
  "course-materials": "course-materials",
  gradebook: "gradebook",
  grades: "grades",
  assignments: "assignments",
  assignment: "assignment",
  calendar: "calendar",
  messages: "messages",
  contacts: "contacts",
  files: "files",
  settings: "settings",
};

/**
 * Sample-data constants that live data can override.
 *
 * Hooking a name here is harmless even when the backend doesn't supply it yet —
 * the generated code falls back to the page's own literal — so the list is
 * intentionally broader than what /data/bundle currently returns.
 */
const OVERRIDABLE = [
  "COURSES",
  "HISTORY",
  "OVERDUE",
  "UPCOMING",
  "TODAY",
  "MESSAGES",
  "GRADEBOOK",
  "SUBMITTED",
  "CONVERSATIONS",
  "TEACHERS",
  "CONTACTS",
];

class TransformError extends Error {}

function assertReplaced(before, after, label, file) {
  if (before === after) {
    throw new TransformError(
      `Transform "${label}" matched nothing in ${file}.\n` +
        `The source page has changed shape. Fix the pattern in scripts/port-pages.mjs — ` +
        `do not ship this, or that feature will silently do nothing.`
    );
  }
  return after;
}

/**
 * Replaces every <style>/<script> region with same-length filler, so index
 * positions still line up with the original string but nothing inside those
 * blocks can be mistaken for markup.
 *
 * This exists because of a real bug: onboarding.html and settings.html each
 * contain a CSS comment with the literal text "<body>" in it —
 *
 *     transition/animation on the page. Applied on <body> so it covers
 *
 * — and a plain /<body[^>]*>/ match found THAT first. The extracted "body"
 * then began in the middle of the stylesheet, which dumped the rest of the CSS
 * onto the page as visible text and left the real markup malformed. Masking
 * first means <body> is only ever found where it's actually a tag.
 */
function maskEmbeddedBlocks(html) {
  return html.replace(
    /<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi,
    (block) => " ".repeat(block.length)
  );
}

function extract(srcPath) {
  const html = fs.readFileSync(srcPath, "utf8");
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
  const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

  // Find the real <body>/</body> boundaries against the masked copy, then slice
  // the ORIGINAL at those offsets so the markup itself is untouched.
  const masked = maskEmbeddedBlocks(html);
  const open = masked.match(/<body[^>]*>/i);
  const closeIndex = masked.search(/<\/body>/i);

  let body = "";
  if (open && closeIndex !== -1) {
    const start = open.index + open[0].length;
    body = html.slice(start, closeIndex);
  } else {
    throw new TransformError(
      `Could not locate <body> in ${path.basename(srcPath)} — the page may be malformed.`
    );
  }

  return {
    title: title ? title[1].trim() : path.basename(srcPath),
    style: styles.join("\n\n"),
    // Strip the raw <script> text out of the markup — it's extracted
    // separately and re-injected as a real executable script by LegacyPage.
    // Leaving it inline would put an inert duplicate of the whole (sometimes
    // 300KB) script into the DOM as text.
    body: body.replace(/<script(?![^>]*src=)[^>]*>[\s\S]*?<\/script>/gi, ""),
    script: scripts.join("\n\n"),
  };
}

/** `courses.html?course=x` -> `/courses?course=x`, everywhere. */
function rewriteLinks(text) {
  let out = text;
  for (const [name, route] of Object.entries(ROUTES)) {
    const target = route === "" ? "/" : `/${route}`;
    out = out.replace(new RegExp(`(?<![\\w-])${name}\\.html`, "g"), target);
  }
  return out;
}

/**
 * Replaces the upload gate's placeholder scan with the real NSFW check.
 *
 * onboarding.html and settings.html already ship the entire gate UI — consent
 * pane, scanning pane, error pane — with the scan itself stubbed as a fixed
 * delay marked `// mock scan delay`. Both files run uploads through one shared
 * `wireUploadInput`, so this single replacement covers profile photos AND
 * wallpapers in both places.
 */
function wireNsfwScan(script, file) {
  const MOCK_SCAN =
    "setTimeout(() => { onAccepted(file); closeUploadGate(); }, 1400); // mock scan delay";

  const REAL_SCAN = `
        // Real NSFW screening, replacing the old fixed-delay placeholder.
        // Runs entirely in this browser against a self-hosted model (see
        // app/lib/nsfw.ts) — the image is never uploaded anywhere to be
        // checked. Reuses the gate's existing scanning/error panes, so the
        // UI here is exactly what was already designed for it.
        window.__schoolagyScanImage(file).then((verdict) => {
          if (verdict.allowed) {
            onAccepted(file);
            closeUploadGate();
          } else {
            uploadGateErrorText.textContent = verdict.reason || "That image can't be used here.";
            showUploadGatePane(uploadGateError);
          }
        }).catch(() => {
          // Fail closed: an image we couldn't screen doesn't get through.
          uploadGateErrorText.textContent = "We couldn't check that image. Please try again.";
          showUploadGatePane(uploadGateError);
        });`.trim();

  return assertReplaced(script, script.replace(MOCK_SCAN, REAL_SCAN), "nsfw-scan", file);
}

/**
 * Lets live Schoology data replace a page's built-in sample data.
 *
 * `const COURSES = [...]` becomes
 * `const COURSES = (window.__SCHOOLAGY__?.data?.COURSES) || [...]`
 *
 * The literal stays as the fallback, so mock mode and any not-yet-adapted feed
 * keep working untouched. LegacyPage guarantees `__SCHOOLAGY__` is populated
 * before this script runs.
 */
function wireDataOverrides(script, file) {
  let out = script;
  let hits = 0;
  for (const name of OVERRIDABLE) {
    const pattern = new RegExp(`(^\\s*)const ${name} = ([\\[{])`, "m");
    if (pattern.test(out)) {
      out = out.replace(
        pattern,
        `$1const ${name} = (window.__SCHOOLAGY__ && window.__SCHOOLAGY__.data && window.__SCHOOLAGY__.data.${name}) || $2`
      );
      hits++;
    }
  }
  if (hits === 0) {
    throw new TransformError(
      `Transform "data-overrides" found none of [${OVERRIDABLE.join(", ")}] in ${file}.`
    );
  }
  return out;
}

/**
 * Pages that legitimately carry no student sample data, and so are exempt from
 * the data-override transform:
 *   login/onboarding — pre-account screens
 *   settings         — its only data is theme swatch palettes (verified), not
 *                      courses or grades
 *   files            — sample files for the preview only; signed in it shows a
 *                      "coming soon" note until the API lists course files,
 *                      Drive files and Canva designs (2026-10-04)
 * Anything NOT listed here must have overridable data, or the build fails.
 */
const NO_DATA_PAGES = new Set(["login", "onboarding", "settings", "files"]);

/**
 * Replaces login's simulated credential check with the real one.
 *
 * The placeholder faked a round trip and treated the literal string "fail" as a
 * failed login. This swaps in a real call to api.averages.io, which verifies
 * the key/secret by calling Schoology as that user before issuing a session.
 */
function wireLoginSubmit(script, file) {
  let out = script;

  // SECURITY: the placeholder logged the submitted key and secret to the
  // console. That was harmless when they were make-believe; now they're the
  // user's real Schoology credentials, and printing a secret to a console
  // anyone can open is a credential leak. It goes before anything else.
  const CREDENTIAL_LOG = "console.log('Connect requested', { key, secret });";
  out = assertReplaced(
    out,
    out.replace(CREDENTIAL_LOG, "// (credential logging deliberately removed — never log a secret)"),
    "strip-credential-logging",
    file
  );

  // Comments describing the mock as the current state are now wrong, and a
  // wrong comment is worse than none.
  out = out.replace(
    /\s*\/\/ Front-end only placeholder — real submit will POST to the backend,\n\s*\/\/ which signs the OAuth1 request and resolves the Schoology user ID\./,
    ""
  );
  out = out.replace(
    /\s*\/\/ Mock "API check"[\s\S]*?\/\/ can be demoed without a real backend to actually reject it\./,
    ""
  );

  const start = out.indexOf("const shouldFail");
  const endMarker = "}, 900);";
  const end = out.indexOf(endMarker, start);
  if (start === -1 || end === -1) {
    throw new TransformError(
      `Transform "login-submit" could not locate the mock connect block in ${file}.`
    );
  }
  const script_ = out;

  const replacement = `
      // Real sign-in. The key + secret go straight to api.averages.io, which
      // verifies them against Schoology and seals them into an httpOnly
      // session cookie — the secret is never kept in browser-readable storage.
      window.__schoolagySignIn(key, secret).then((result) => {
        if (result.ok) {
          window.location.href = result.next;
          return;
        }

        connectBtn.classList.remove('loading');
        connectBtn.classList.add('error');
        connectBtn.setAttribute('aria-label', result.message);

        // A red button alone can't say WHY sign-in failed — a wrong key and a
        // dropped connection need different fixes, so say which it was.
        let errorNote = document.getElementById('signInError');
        if (!errorNote) {
          errorNote = document.createElement('div');
          errorNote.id = 'signInError';
          errorNote.setAttribute('role', 'alert');
          errorNote.style.cssText = 'margin-top:10px;font-size:0.78rem;font-weight:700;color:#b3261e;line-height:1.35;';
          connectBtn.insertAdjacentElement('afterend', errorNote);
        }
        errorNote.textContent = result.message;

        window.setTimeout(() => {
          connectBtn.classList.remove('error');
          connectBtn.removeAttribute('aria-label');
          setConnectBusy(false);
        }, 1600);
      });`;

  return script_.slice(0, start) + replacement.trim() + script_.slice(end + endMarker.length);
}

/**
 * Makes onboarding actually finish.
 *
 * The completion screen already promised "redirecting to your Homepage next"
 * but nothing ever redirected — it was the end of the front-end-only flow.
 * Now it records that onboarding is done (so returning users skip straight to
 * Home next time) and goes there.
 */
function wireOnboardingComplete(script, file) {
  const MOCK_COMPLETE = `      setTimeout(() => {
        updateCompletionRecap();
        profileForm.style.display = 'none';
        completeState.classList.add('show');
      }, 650);`;

  const REAL_COMPLETE = `      setTimeout(() => {
        updateCompletionRecap();
        profileForm.style.display = 'none';
        completeState.classList.add('show');

        // Remember that onboarding is done so a returning user goes straight
        // to Home instead of being walked through setup again.
        try {
          window.localStorage.setItem('schoolagy_onboarded', '1');
          window.localStorage.setItem('schoolagy_profile_name', nameInput.value.trim());
        } catch (e) { /* private browsing — non-fatal, they just redo setup */ }

        // Long enough to read "You're all set!", short enough not to strand
        // them on a screen whose whole message is that it's about to move on.
        setTimeout(() => { window.location.href = '/home'; }, 1800);
      }, 650);`;

  return assertReplaced(
    script,
    script.replace(MOCK_COMPLETE, REAL_COMPLETE),
    "onboarding-complete",
    file
  );
}

/** The only two pages with a file input, and so the only two that need the model. */
const UPLOAD_PAGES = new Set(["onboarding", "settings"]);

/**
 * Page-specific external <script src="…"> tags that must actually load in the
 * real app.
 *
 * The extract() step below only ever pulls <title>, <style> and inline
 * <script> (no src=) out of a source page — the same gap documented on
 * layout.tsx's Typekit <link>. A <link rel="stylesheet"> silently missing
 * just breaks a font; a <script src> silently missing breaks a FEATURE with
 * no visible error — course-materials.html's "Download Folder" checked
 * `typeof JSZip === 'undefined'` and, since the CDN tag never made it into
 * the built app at all, always showed its "you're offline" fallback message
 * regardless of the user's actual connection (found and fixed 2026-09-08).
 *
 * Unlike Typekit (every page, so it lives once in layout.tsx), each of these
 * is needed by exactly one page — loading a .zip library app-wide for pages
 * that never zip anything would be pure waste, so they're wired per-page via
 * LegacyPage's `externalScripts` prop instead.
 */
const EXTERNAL_SCRIPTS = {
  "course-materials": ["https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"],
};

function generatePage(name, route, data) {
  const isLogin = name === "login";
  const outDir = route === "" ? APP_DIR : path.join(APP_DIR, route);
  const importPath = route === "" ? "./components/LegacyPage" : "../components/LegacyPage";

  fs.mkdirSync(outDir, { recursive: true });

  const loginExtras = isLogin
    ? `
import { getSession, signIn } from "./lib/schoolagy";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: "That API key and secret didn't work. Double-check you copied both from your school's Schoology /api page.",
  missing_credentials: "Please enter both your API key and secret.",
  network_error: "Couldn't reach Averages. Check your connection and try again.",
  schoology_error: "Schoology isn't responding right now. Try again in a moment.",
  server_misconfigured: "The Averages server isn't set up correctly yet. Please let us know.",
};
`
    : "";

  const loginEffect = isLogin
    ? `
  useEffect(() => {
    // NOTE: there is deliberately no keyboard shortcut here any more.
    //
    // Escape used to drop straight into sample-data mode by setting a
    // localStorage flag. That made the demo reachable to anyone who knew the
    // key, and — worse — made every app page reachable by editing browser
    // storage or just typing a URL. Demo mode is now a real sign-in
    // ("demo" as both the key and the secret) that the API grants, so the
    // server decides who gets in and there is nothing local to forge.

    // The legacy login script calls this; it must exist before that runs.
    (window as any).__schoolagySignIn = async (key: string, secret: string) => {
      const result = await signIn(key, secret);
      if (result.ok) {
        let onboarded = false;
        try {
          onboarded = window.localStorage.getItem("schoolagy_onboarded") === "1";
        } catch {}
        // Demo always starts at onboarding so a tester sees the whole flow;
        // a returning real user skips straight to Home.
        return { ok: true, next: result.demo || !onboarded ? "/onboard" : "/home" };
      }
      return {
        ok: false,
        message: ERROR_MESSAGES[result.error ?? ""] ?? "Something went wrong signing in. Please try again.",
      };
    };

    // Already signed in? Don't make them do it again.
    let cancelled = false;
    getSession().then((session) => {
      if (cancelled || session.mode === "out") return;
      let onboarded = false;
      try {
        onboarded = window.localStorage.getItem("schoolagy_onboarded") === "1";
      } catch {}
      window.location.href = onboarded ? "/home" : "/onboard";
    });
    return () => { cancelled = true; };
  }, []);
`
    : "";

  // Only the login page runs an effect of its own; importing useEffect
  // everywhere would leave an unused import on 14 of the 15 pages.
  const reactImport = isLogin ? `import { useEffect } from "react";\n` : "";

  const content = `"use client";
${reactImport}import LegacyPage from "${importPath}";${loginExtras}

const TITLE = ${JSON.stringify(data.title)};
const STYLE_CSS = ${JSON.stringify(data.style)};
const BODY_HTML = ${JSON.stringify(data.body)};
const SCRIPT_JS = ${JSON.stringify(data.script)};

export default function Page() {${loginEffect}
  return (
    <LegacyPage
      title={TITLE}
      styleCss={STYLE_CSS}
      bodyHtml={BODY_HTML}
      scriptJs={SCRIPT_JS}
      requiresAuth={${!isLogin}}
      usesSavedTheme={${!isLogin}}
      hasUploads={${UPLOAD_PAGES.has(name)}}
      externalScripts={${JSON.stringify(EXTERNAL_SCRIPTS[name] || [])}}
      pageId={${JSON.stringify(name)}}
    />
  );
}
`;

  fs.writeFileSync(path.join(outDir, "page.tsx"), content);
  return content.length;
}

// ---------------------------------------------------------------- run

let failures = 0;
for (const [name, route] of Object.entries(ROUTES)) {
  const srcPath = path.join(SRC_DIR, `${name}.html`);
  if (!fs.existsSync(srcPath)) {
    console.error(`  MISSING SOURCE: ${srcPath}`);
    failures++;
    continue;
  }

  try {
    const data = extract(srcPath);

    data.style = rewriteLinks(data.style);
    data.body = rewriteLinks(data.body);
    let script = rewriteLinks(data.script);

    if (name === "onboarding" || name === "settings") {
      script = wireNsfwScan(script, `${name}.html`);
    }
    if (name === "login") {
      script = wireLoginSubmit(script, "login.html");
    }
    if (name === "onboarding") {
      script = wireOnboardingComplete(script, "onboarding.html");
    }
    if (!NO_DATA_PAGES.has(name)) {
      script = wireDataOverrides(script, `${name}.html`);
    }

    data.script = script;
    const size = generatePage(name, route, data);
    console.log(`  ok  ${(route === "" ? "/" : "/" + route).padEnd(20)} ${String(size).padStart(8)} chars`);
  } catch (error) {
    console.error(`  FAIL ${name}.html — ${error.message}`);
    failures++;
  }
}

// 404 has no route segment — Next.js renders app/not-found.tsx for unmatched paths.
try {
  const data = extract(path.join(SRC_DIR, "404.html"));
  data.style = rewriteLinks(data.style);
  data.body = rewriteLinks(data.body);
  data.script = rewriteLinks(data.script);
  const content = `"use client";
import LegacyPage from "./components/LegacyPage";

const TITLE = ${JSON.stringify(data.title)};
const STYLE_CSS = ${JSON.stringify(data.style)};
const BODY_HTML = ${JSON.stringify(data.body)};
const SCRIPT_JS = ${JSON.stringify(data.script)};

export default function NotFound() {
  return (
    <LegacyPage
      title={TITLE}
      styleCss={STYLE_CSS}
      bodyHtml={BODY_HTML}
      scriptJs={SCRIPT_JS}
      requiresAuth={false}
    />
  );
}
`;
  fs.writeFileSync(path.join(APP_DIR, "not-found.tsx"), content);
  console.log(`  ok  ${"(404)".padEnd(20)} ${String(content.length).padStart(8)} chars`);
} catch (error) {
  console.error(`  FAIL 404.html — ${error.message}`);
  failures++;
}

if (failures > 0) {
  console.error(`\n${failures} page(s) failed to port.`);
  process.exit(1);
}
console.log("\nAll pages ported.");
