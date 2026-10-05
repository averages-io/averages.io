/**
 * Verifies every generated page.
 *
 * Run: node scripts/verify-pages.mjs
 *
 * `next build` type-checks the TSX around each page, but it does NOT parse the
 * legacy JavaScript inside them — that's just a string literal as far as the
 * bundler is concerned, and a transform that produced broken JS would sail
 * through the build and only explode in the browser at runtime.
 *
 * So this pulls the embedded script back out of each generated page, parses it,
 * and asserts the wiring landed. It's the check that makes the port script
 * safe to re-run.
 */

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, "../app");

let failures = 0;
let checks = 0;

function fail(message) {
  console.log(`  FAIL  ${message}`);
  failures++;
}
function pass(message) {
  console.log(`  ok    ${message}`);
  checks++;
}

/** Pulls a `const NAME = "...";` JSON string literal back out of a page file. */
function readEmbedded(source, name) {
  const marker = `const ${name} = `;
  const start = source.indexOf(marker);
  if (start === -1) return null;
  const valueStart = start + marker.length;
  const end = source.indexOf(";\n", valueStart);
  if (end === -1) return null;
  try {
    return JSON.parse(source.slice(valueStart, end));
  } catch {
    return null;
  }
}

const pageFiles = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name === "page.tsx" || entry.name === "not-found.tsx") {
      pageFiles.push(full);
    }
  }
})(APP_DIR);

pageFiles.sort();
console.log(`\nVerifying ${pageFiles.length} generated pages\n`);

const wiring = {
  nsfw: [],
  liveData: [],
  signIn: [],
};

for (const file of pageFiles) {
  const rel = path.relative(APP_DIR, file);
  const source = fs.readFileSync(file, "utf8");

  const script = readEmbedded(source, "SCRIPT_JS");
  const body = readEmbedded(source, "BODY_HTML");

  if (script === null) {
    fail(`${rel}: could not read back SCRIPT_JS`);
    continue;
  }
  if (body === null) {
    fail(`${rel}: could not read back BODY_HTML`);
    continue;
  }

  // The real check: does the legacy JS still parse after being transformed?
  try {
    new vm.Script(script, { filename: rel });
  } catch (error) {
    fail(`${rel}: embedded script has a syntax error — ${error.message}`);
    continue;
  }

  // Body markup must not contain stylesheet text. onboarding.html and
  // settings.html each have a CSS comment containing the literal string
  // "<body>", which a naive regex matched as the real tag — so the extracted
  // markup began mid-stylesheet and rendered tens of KB of CSS onto the page
  // as visible text. Cheap to check, catastrophic to miss.
  const cssLeak = [
    /!important\s*[;}]/,
    /@media\s*\(/,
    /\bbody\.[a-z-]+\s*\{/,
  ].find((re) => re.test(body));
  if (cssLeak) {
    fail(`${rel}: stylesheet text leaked into the body markup (matched ${cssLeak})`);
    continue;
  }

  // No page should still be pointing at a bare .html file; those links would
  // 404 now that each page is a route.
  const staleLinks = [...script.matchAll(/["'`]([a-z0-9-]+\.html)/gi)].map((m) => m[1]);
  if (staleLinks.length) {
    fail(`${rel}: still links to ${[...new Set(staleLinks)].join(", ")}`);
    continue;
  }

  if (script.includes("__averagesScanImage")) wiring.nsfw.push(rel);
  if (script.includes("window.__AVERAGES__")) wiring.liveData.push(rel);
  if (script.includes("__averagesSignIn")) wiring.signIn.push(rel);

  // Placeholders that are supposed to be gone. If any survives, a transform
  // silently no-opped and a feature is quietly missing.
  for (const [placeholder, feature] of [
    ["mock scan delay", "NSFW screening"],
    ["const shouldFail", "real sign-in"],
  ]) {
    if (script.includes(placeholder)) {
      fail(`${rel}: still contains the "${placeholder}" placeholder — ${feature} did not get wired`);
    }
  }

  // SECURITY: nothing may log the user's Schoology credentials. Harmless while
  // they were mock values, a credential leak now that they're real — so it's
  // checked on every build rather than trusted to review.
  const credentialLogging = [
    /console\.(log|warn|info|debug|error)\([^)]*\bsecret\b/,
    /console\.(log|warn|info|debug|error)\([^)]*\bapiSecret\b/,
    /console\.(log|warn|info|debug|error)\([^)]*\bpassword\b/,
  ];
  for (const pattern of credentialLogging) {
    const match = script.match(pattern);
    if (match) {
      fail(`${rel}: logs credentials to the console — "${match[0].slice(0, 60)}"`);
    }
  }

  pass(`${rel} (${(script.length / 1024).toFixed(0)}KB script parses clean)`);
}

console.log("\nFeature wiring");

function expect(label, actual, expected) {
  const a = [...actual].sort().join(", ");
  const e = [...expected].sort().join(", ");
  if (a === e) {
    pass(`${label}: ${a || "(none)"}`);
  } else {
    fail(`${label}\n        expected: ${e}\n        actual:   ${a}`);
  }
}

// Uploads only exist on these two pages, so screening belongs on exactly these
// two — no more (dead weight) and no fewer (an unscreened upload path).
expect("NSFW screening", wiring.nsfw, ["onboard/page.tsx", "settings/page.tsx"]);

// Sign-in belongs only on the login page.
expect("Real sign-in", wiring.signIn, ["page.tsx"]);

// Every page that renders student data should accept live data. Login,
// onboarding, settings and 404 have none to render.
expect("Live-data hooks", wiring.liveData, [
  "assignment/page.tsx",
  "assignments/page.tsx",
  "calendar/page.tsx",
  "contacts/page.tsx",
  "course-home/page.tsx",
  "course-materials/page.tsx",
  "courses/page.tsx",
  "gradebook/page.tsx",
  "grades/page.tsx",
  "home/page.tsx",
  "messages/page.tsx",
]);

// ── Skeleton selectors ───────────────────────────────────────────────────
// PageSkeleton.tsx injects shimmer rows into each page's real data containers
// using that page's own ids and classes. That is what makes the placeholders
// land in the right place — and it means a renamed container silently turns
// the loading state into nothing. Fail the build instead, the same way
// port-pages.mjs's assertReplaced does for the other transforms.
{
  const skelSrc = fs.readFileSync(
    path.join(APP_DIR, "components/PageSkeleton.tsx"), "utf8");
  const specBody = skelSrc.slice(skelSrc.indexOf("const SPECS"));
  const pages = [...specBody.matchAll(/^  "?([a-z-]+)"?:\s*\[/gm)];
  let missing = [];
  pages.forEach((m, idx) => {
    const page = m[1];
    const end = idx + 1 < pages.length ? pages[idx + 1].index : specBody.length;
    const block = specBody.slice(m.index, end);
    const srcPath = path.resolve(APP_DIR, `../pages-src/${page}.html`);
    if (!fs.existsSync(srcPath)) { missing.push(`${page}: no such page`); return; }
    const html = fs.readFileSync(srcPath, "utf8");
    for (const sm of block.matchAll(/sel:\s*"#([A-Za-z0-9_-]+)"/g)) {
      if (!html.includes(`id="${sm[1]}"`)) missing.push(`${page}: #${sm[1]}`);
    }
  });
  if (missing.length) {
    fail(`Skeleton selectors: container(s) no longer in the page — ${missing.join(", ")}`);
  } else {
    pass(`Skeleton selectors: ${pages.length} pages wired`);
  }
}

console.log(`\n${checks} checks passed, ${failures} failed\n`);
process.exit(failures > 0 ? 1 : 0);
