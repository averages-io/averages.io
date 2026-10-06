/**
 * Tests for the per-page extras (2026-10-06).
 *
 * Run: node --experimental-strip-types --no-warnings scripts/extras.test.mjs
 * (--no-warnings only hides Node's notes about loading .ts files.)
 *
 * app/lib/extras.ts is pure (which calls a page makes, cache keys, how each
 * answer lands in the page's data) and is tested directly. loadExtras() and
 * the cache clearing in app/lib/averages.ts are tested against a fake
 * window, fetch and sessionStorage; averages.ts imports "./extras" without an
 * extension (the app's bundler resolves it), so a small resolve hook adds the
 * ".ts" for Node.
 */
import assert from "node:assert/strict";
import { register } from "node:module";

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok    ${name}`);
  } catch (error) {
    console.log(`  FAIL  ${name}\n${String(error && error.stack || error).replace(/^/gm, "        ")}`);
    process.exitCode = 1;
  }
}

const extras = await import("../app/lib/extras.ts");
const { extrasFor, mergeExtras, mergeExtra, courseParam, EXTRAS_PREFIX, EXTRAS_BY_PAGE } = extras;

// A fixed "today" (local time): Tue Oct 6 2026.
const NOW = new Date(2026, 9, 6, 9, 30);

console.log("\nextrasFor");

await test("each page asks for what the contract lists", () => {
  const names = (page, search = "") => extrasFor(page, search, NOW).map((r) => r.name);
  assert.deepEqual(names("home"), ["people", "updates"]);
  assert.deepEqual(names("courses"), ["people"]);
  assert.deepEqual(names("grades"), ["people"]);
  assert.deepEqual(names("assignments"), ["people"]);
  assert.deepEqual(names("course-home", "?course=123"), ["people", "updates", "events"]);
  assert.deepEqual(names("gradebook", "?course=123"), ["people", "gradebook"]);
  assert.deepEqual(names("course-materials", "?course=123"), ["people", "folders"]);
  assert.deepEqual(names("calendar"), ["events"]);
  assert.deepEqual(names("messages"), ["people", "messages"]);
  assert.deepEqual(names("contacts"), ["people"]);
  assert.deepEqual(names("settings"), []);
  assert.deepEqual(names("assignment", "?course=1&id=2"), []);
  assert.deepEqual(names("nope"), []);
});

await test("paths and cache keys", () => {
  const byName = (page, search) => Object.fromEntries(extrasFor(page, search, NOW).map((r) => [r.name, r]));
  const home = byName("home", "");
  assert.equal(home.people.path, "/data/people");
  assert.equal(home.people.cacheKey, "averages_extras_people");
  assert.equal(home.updates.path, "/data/updates");
  assert.equal(home.updates.cacheKey, "averages_extras_updates");
  const msg = byName("messages", "");
  assert.equal(msg.messages.path, "/messages");
  const gb = byName("gradebook", "?course=4455");
  assert.equal(gb.gradebook.path, "/data/gradebook?course=4455");
  assert.equal(gb.gradebook.cacheKey, "averages_extras_gradebook_4455");
  assert.equal(gb.gradebook.course, "4455");
  const mat = byName("course-materials", "?course=4455&show=x");
  assert.equal(mat.folders.path, "/data/folders?course=4455");
  assert.equal(mat.folders.cacheKey, "averages_extras_folders_4455");
  for (const page of Object.keys(EXTRAS_BY_PAGE)) {
    for (const r of extrasFor(page, "?course=9", NOW)) assert.ok(r.cacheKey.startsWith(EXTRAS_PREFIX), r.cacheKey);
  }
});

await test("calendar events: today minus 120 days to plus 240, all classes", () => {
  const [ev] = extrasFor("calendar", "?course=4455", NOW);
  assert.equal(ev.path, "/data/events?start=2026-06-08&end=2027-06-03");
  assert.equal(ev.cacheKey, "averages_extras_events_2026-06-08_2027-06-03");
  assert.equal(ev.course, "");
});

await test("class hub events: this class, 60 days back and 120 ahead", () => {
  const ev = extrasFor("course-home", "?course=4455", NOW).find((r) => r.name === "events");
  assert.equal(ev.path, "/data/events?start=2026-08-07&end=2027-02-03&course=4455");
  assert.equal(ev.cacheKey, "averages_extras_events_2026-08-07_2027-02-03_4455");
  // No ?course=: all classes (the hub picks one itself), its own cache key.
  const bare = extrasFor("course-home", "", NOW).find((r) => r.name === "events");
  assert.equal(bare.path, "/data/events?start=2026-08-07&end=2027-02-03");
  assert.equal(bare.cacheKey, "averages_extras_events_2026-08-07_2027-02-03");
});

await test("windows stay within the API's 400 days", () => {
  for (const page of ["calendar", "course-home"]) {
    const ev = extrasFor(page, "?course=1", NOW).find((r) => r.name === "events");
    const q = new URLSearchParams(ev.path.split("?")[1]);
    const days = (Date.parse(q.get("end")) - Date.parse(q.get("start"))) / 86400000;
    assert.ok(days > 0 && days <= 400, `${page}: ${days} days`);
  }
});

await test("a class page without a usable ?course= skips that class's extra", () => {
  assert.deepEqual(extrasFor("gradebook", "", NOW).map((r) => r.name), ["people"]);
  assert.deepEqual(extrasFor("course-materials", "?course=", NOW).map((r) => r.name), ["people"]);
  assert.deepEqual(extrasFor("gradebook", "?course=../x", NOW).map((r) => r.name), ["people"]);
  assert.deepEqual(extrasFor("gradebook", "?course=a%26b", NOW).map((r) => r.name), ["people"]);
  assert.equal(courseParam("?course=12%3Cs"), "");
  assert.equal(courseParam("?course=" + "9".repeat(65)), "");
  assert.equal(courseParam("?course=123456789012345678901234"), "123456789012345678901234");
});

console.log("\nmergeExtras");

const BUNDLE = () => ({
  COURSES: [
    { id: "101", name: "Chemistry", teacher: "", code: "CH-1", period: 3, section: "" },
    { id: "102", name: "English", teacher: "Ms. Already", code: "", period: "", section: "" },
    { id: "103", name: "PE", teacher: "", code: "", period: "", section: "" },
  ],
  GRADEBOOK: {
    "101": { categories: [{ name: "All work", weight: 100, assignments: [] }] },
    "102": { categories: [{ name: "Essays", weight: 60, assignments: [] }] },
  },
  COURSE_UPDATES: [{ from: "Announcement", courseId: "101", body: "bundle one" }],
  MESSAGES: [],
});
const PEOPLE = {
  platform: "schoology",
  TEACHERS: { "555": { name: "Mr. Cho", course: "101", color: "#6b8f5e" } },
  CONTACTS: [{ id: "555", name: "Mr. Cho", role: "Teacher", dept: "Chemistry", category: "myTeachers", courses: ["101"] }],
  courseTeachers: { "101": "Mr. Cho", "102": "Mr. Other", "999": "Nobody" },
  partial: false,
};
const reqs = (page, search = "?course=101") => extrasFor(page, search, NOW);

await test("people: TEACHERS, CONTACTS, COURSE_TEACHERS, PEOPLE_PLATFORM, PEOPLE_NEEDS_PERMISSION", () => {
  const data = mergeExtras(BUNDLE(), reqs("home"), { people: PEOPLE });
  assert.deepEqual(data.TEACHERS, PEOPLE.TEACHERS);
  assert.deepEqual(data.CONTACTS, PEOPLE.CONTACTS);
  assert.deepEqual(data.COURSE_TEACHERS, PEOPLE.courseTeachers);
  assert.equal(data.PEOPLE_PLATFORM, "schoology");
  assert.equal(data.PEOPLE_NEEDS_PERMISSION, false);
  const classroom = mergeExtras(BUNDLE(), reqs("home"), { people: { platform: "classroom", TEACHERS: {}, CONTACTS: [], courseTeachers: {}, needsPermission: true } });
  assert.equal(classroom.PEOPLE_PLATFORM, "classroom");
  assert.equal(classroom.PEOPLE_NEEDS_PERMISSION, true);
  assert.deepEqual(classroom.CONTACTS, []);
});

await test("people fills COURSES[i].teacher only when it's empty, without touching the bundle", () => {
  const bundle = BUNDLE();
  const data = mergeExtras(bundle, reqs("courses"), { people: PEOPLE });
  assert.deepEqual(data.COURSES.map((c) => c.teacher), ["Mr. Cho", "Ms. Already", ""]);
  assert.deepEqual(bundle.COURSES.map((c) => c.teacher), ["", "Ms. Already", ""], "cached bundle unchanged");
  assert.equal(data.COURSES[0].code, "CH-1");
  assert.equal(data.COURSES[0].period, 3);
  // Whitespace-only teacher counts as empty; a non-string name is ignored.
  const odd = mergeExtras({ COURSES: [{ id: "1", teacher: "  " }, { id: "2" }, null] }, reqs("courses"), { people: { CONTACTS: [], courseTeachers: { "1": " Dr. Ray ", "2": 7 } } });
  assert.deepEqual(odd.COURSES, [{ id: "1", teacher: "Dr. Ray" }, { id: "2" }, null]);
});

await test("updates: replaces COURSE_UPDATES; Classroom's null keeps the bundle's", () => {
  const ups = [{ from: "Mr. Cho", courseId: "101", body: "hi", when: "2h ago", unread: true, id: "9", at: 1 }];
  assert.deepEqual(mergeExtras(BUNDLE(), reqs("home"), { updates: { COURSE_UPDATES: ups, partial: false } }).COURSE_UPDATES, ups);
  assert.equal(mergeExtras(BUNDLE(), reqs("home"), { updates: { COURSE_UPDATES: null } }).COURSE_UPDATES[0].body, "bundle one");
  assert.equal(mergeExtras({}, reqs("home"), { updates: { COURSE_UPDATES: null } }).COURSE_UPDATES, undefined);
});

await test("events: EVENTS (and EVENTS_PARTIAL when some classes failed)", () => {
  const evs = [{ id: "s-1", title: "Lab", date: "2026-10-09", source: "101", type: "assignment" }];
  const data = mergeExtras(BUNDLE(), reqs("calendar"), { events: { EVENTS: evs, partial: false } });
  assert.deepEqual(data.EVENTS, evs);
  assert.equal("EVENTS_PARTIAL" in data, false);
  assert.equal(mergeExtras({}, reqs("calendar"), { events: { EVENTS: [], partial: true } }).EVENTS_PARTIAL, true);
});

await test("gradebook: replaces that class's entry, keeps the others; Classroom's null keeps the bundle's", () => {
  const exact = { categories: [{ name: "Tests", weight: 40, assignments: [{ title: "T1", score: 9, points: 10, graded: true, id: "1" }] }, { name: "Homework", weight: 60, assignments: [] }] };
  const bundle = BUNDLE();
  const data = mergeExtras(bundle, reqs("gradebook"), { gradebook: { GRADEBOOK: { "101": exact } } });
  assert.deepEqual(data.GRADEBOOK["101"], exact);
  assert.deepEqual(data.GRADEBOOK["102"], bundle.GRADEBOOK["102"]);
  assert.equal(bundle.GRADEBOOK["101"].categories[0].name, "All work", "cached bundle unchanged");
  const kept = mergeExtras(BUNDLE(), reqs("gradebook"), { gradebook: { GRADEBOOK: null } });
  assert.equal(kept.GRADEBOOK["101"].categories[0].name, "All work");
  // A bundle without GRADEBOOK (older API) still gets the class's entry.
  assert.deepEqual(mergeExtras({ COURSES: [] }, reqs("gradebook"), { gradebook: { GRADEBOOK: { "101": exact } } }).GRADEBOOK, { "101": exact });
  // A malformed entry is skipped.
  assert.deepEqual(mergeExtras({}, reqs("gradebook"), { gradebook: { GRADEBOOK: { "101": { categories: "x" } } } }).GRADEBOOK, {});
});

await test("folders: FOLDERS = { course, folders, placement, partial }", () => {
  const data = mergeExtras({}, reqs("course-materials", "?course=4455"), { folders: { folders: [{ id: "77", title: "Unit 1", parent: "", color: "" }], placement: { "document:501": "77" }, partial: true } });
  assert.deepEqual(data.FOLDERS, { course: "4455", folders: [{ id: "77", title: "Unit 1", parent: "", color: "" }], placement: { "document:501": "77" }, partial: true });
  assert.deepEqual(mergeExtras({}, reqs("course-materials", "?course=4455"), { folders: { folders: [] } }).FOLDERS, { course: "4455", folders: [], placement: {}, partial: false });
});

await test("messages: CONVERSATIONS, MESSAGE_PEOPLE, MESSAGES_ME", () => {
  const data = mergeExtras({ MESSAGES: [{ from: "x" }] }, reqs("messages"), { messages: { CONVERSATIONS: [{ id: "88" }], PEOPLE: { "555": { name: "Mr. Cho" } }, me: 42, partial: false } });
  assert.deepEqual(data.CONVERSATIONS, [{ id: "88" }]);
  assert.deepEqual(data.MESSAGE_PEOPLE, { "555": { name: "Mr. Cho" } });
  assert.equal(data.MESSAGES_ME, "42");
  assert.deepEqual(data.MESSAGES, [{ from: "x" }], "the bundle's MESSAGES stay");
});

await test("a missing, failed or malformed extra sets nothing", () => {
  const before = BUNDLE();
  for (const [page, answers] of [
    ["home", {}],
    ["home", { people: null, updates: "nope" }],
    ["home", { people: { error: "schoology_error" } }],
    ["calendar", { events: { EVENTS: "x" } }],
    ["calendar", { events: [] }],
    ["messages", { messages: { error: "not_available" } }],
    ["course-materials", { folders: { error: "x" } }],
  ]) {
    const data = mergeExtras(before, reqs(page), answers);
    for (const field of ["TEACHERS", "CONTACTS", "COURSE_TEACHERS", "PEOPLE_PLATFORM", "EVENTS", "CONVERSATIONS", "FOLDERS"]) {
      assert.equal(field in data, false, `${page}: ${field} set from ${JSON.stringify(answers)}`);
    }
    assert.deepEqual(data.COURSES, before.COURSES);
    assert.deepEqual(data.COURSE_UPDATES, before.COURSE_UPDATES);
  }
  assert.equal(mergeExtra({}, { name: "people", course: "" }, undefined), false);
});

await test("an answer for an extra the page didn't ask for is ignored", () => {
  const data = mergeExtras({}, reqs("calendar"), { people: PEOPLE });
  assert.equal("CONTACTS" in data, false);
});

await test("no bundle (null) still gets the extras", () => {
  const data = mergeExtras(null, reqs("calendar"), { events: { EVENTS: [] } });
  assert.deepEqual(data, { EVENTS: [] });
});

// ---------------------------------------------------------------- averages.ts

console.log("\nloadExtras (app/lib/averages.ts, fake browser)");

register(
  "data:text/javascript," +
    encodeURIComponent(`
      export async function resolve(specifier, context, next) {
        if (/^\\.\\.?\\//.test(specifier) && !/\\.[a-z]+$/i.test(specifier) && context.parentURL && context.parentURL.endsWith('.ts')) {
          return next(specifier + '.ts', context);
        }
        return next(specifier, context);
      }`)
);

function fakeStorage() {
  const map = new Map();
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    _map: map,
  };
}
const session = fakeStorage();
const local = fakeStorage();
globalThis.window = { location: { hostname: "localhost", search: "" }, sessionStorage: session, localStorage: local };
let routes = {};
const calls = [];
globalThis.fetch = async (url, init) => {
  const path = String(url).replace("http://localhost:8787", "");
  calls.push({ path, init });
  const route = Object.entries(routes).find(([prefix]) => path.startsWith(prefix));
  if (!route) return { ok: false, status: 404, json: async () => ({ error: "not_found" }) };
  const { status = 200, body = {}, delay = 0, throws = false } = route[1];
  if (delay) await new Promise((r) => setTimeout(r, delay));
  if (throws) throw new TypeError("network");
  return { ok: status >= 200 && status < 300, status, json: async () => body };
};

const averages = await import("../app/lib/averages.ts");
const { loadExtras, clearExtras, invalidateBundle, forgetSession, signOut } = averages;
const { EXTRAS_WAIT_MS } = extras;

// Node has a read-only global navigator; tests swap in their own.
function setNavigator(value) {
  Object.defineProperty(globalThis, "navigator", { value, configurable: true, writable: true });
}

function reset() {
  session.clear();
  local.clear();
  calls.length = 0;
  routes = {};
}

await test("asks every extra in parallel, caches each under averages_extras_ with the student", async () => {
  reset();
  routes = { "/data/people": { body: PEOPLE, delay: 30 }, "/data/updates": { body: { COURSE_UPDATES: [] }, delay: 30 } };
  const t0 = Date.now();
  const r = await loadExtras("home", "", "u1");
  assert.ok(Date.now() - t0 < 55, "in parallel, not one after the other");
  assert.deepEqual(Object.keys(r.answers).sort(), ["people", "updates"]);
  assert.equal(r.signedOut, false);
  assert.ok(calls.every((c) => c.init && c.init.credentials === "include"));
  const cached = JSON.parse(session.getItem("averages_extras_people"));
  assert.equal(cached.who, "u1");
  assert.deepEqual(cached.data, PEOPLE);
});

await test("the next page within 5 minutes uses the cache; another student doesn't", async () => {
  calls.length = 0;
  const again = await loadExtras("courses", "", "u1");
  assert.equal(calls.length, 0);
  assert.deepEqual(again.answers.people, PEOPLE);
  const other = await loadExtras("courses", "", "u2");
  assert.equal(calls.length, 1, "u2 asks the API itself");
  assert.deepEqual(other.answers.people, PEOPLE);
  assert.equal(JSON.parse(session.getItem("averages_extras_people")).who, "u2");
});

await test("a cache entry older than 5 minutes is asked again", async () => {
  reset();
  routes = { "/data/people": { body: PEOPLE } };
  session.setItem("averages_extras_people", JSON.stringify({ at: Date.now() - 5 * 60 * 1000 - 1, who: "u1", data: { CONTACTS: ["old"] } }));
  const r = await loadExtras("contacts", "", "u1");
  assert.equal(calls.length, 1);
  assert.deepEqual(r.answers.people, PEOPLE);
  session.setItem("averages_extras_people", "{not json");
  const r2 = await loadExtras("contacts", "", "u1");
  assert.equal(calls.length, 2);
  assert.deepEqual(r2.answers.people, PEOPLE);
});

await test("failed calls (5xx, 403, 404, network) are absent and never cached", async () => {
  reset();
  routes = { "/data/people": { status: 502, body: { error: "schoology_error" } }, "/messages": { status: 404, body: { error: "not_available" } } };
  const r = await loadExtras("messages", "", "u1");
  assert.deepEqual(r.answers, {});
  assert.equal(r.signedOut, false);
  routes = { "/data/events": { throws: true } };
  const r2 = await loadExtras("calendar", "", "u1");
  assert.deepEqual(r2.answers, {});
  assert.equal([...session._map.keys()].filter((k) => k.startsWith("averages_extras_")).length, 0);
});

await test("a 401 means signed out (and drops the cached session answer)", async () => {
  reset();
  session.setItem("schoolagy_session_state", JSON.stringify({ at: Date.now(), state: { mode: "live" } }));
  routes = { "/data/people": { status: 401, body: { error: "not_authenticated" } }, "/data/updates": { body: { COURSE_UPDATES: [] } } };
  const r = await loadExtras("home", "", "u1");
  assert.equal(r.signedOut, true);
  assert.equal(session.getItem("schoolagy_session_state"), null);
});

await test("waits at most 4 s; a late extra keeps going and fills the cache", async () => {
  reset();
  routes = { "/data/people": { body: PEOPLE, delay: 10 }, "/data/updates": { body: { COURSE_UPDATES: [{ id: "late" }] }, delay: EXTRAS_WAIT_MS + 400 } };
  const t0 = Date.now();
  const r = await loadExtras("home", "", "u1");
  const waited = Date.now() - t0;
  assert.ok(waited >= EXTRAS_WAIT_MS - 50 && waited < EXTRAS_WAIT_MS + 300, `waited ${waited} ms`);
  assert.deepEqual(Object.keys(r.answers), ["people"]);
  const merged = mergeExtras(BUNDLE(), r.requests, r.answers);
  assert.equal(merged.COURSE_UPDATES[0].body, "bundle one", "page renders without the late one");
  await new Promise((res) => setTimeout(res, 600));
  assert.deepEqual(JSON.parse(session.getItem("averages_extras_updates")).data, { COURSE_UPDATES: [{ id: "late" }] });
  assert.ok(r.answers.updates, "landed in the same result too (used if the bundle was still loading)");
  calls.length = 0;
  const next = await loadExtras("home", "", "u1");
  assert.equal(calls.length, 0, "next page: both cached");
  assert.deepEqual(next.answers.updates, { COURSE_UPDATES: [{ id: "late" }] });
});

await test("a page with no extras resolves at once without calls", async () => {
  reset();
  const t0 = Date.now();
  const r = await loadExtras("settings", "", "u1");
  assert.ok(Date.now() - t0 < 20);
  assert.deepEqual(r, { requests: [], answers: {}, signedOut: false });
  assert.equal(calls.length, 0);
});

console.log("\ncache clearing and sign-out");

function seed() {
  session.setItem("averages_extras_people", "x");
  session.setItem("averages_extras_events_2026-06-08_2027-06-03", "x");
  session.setItem("schoolagy_bundle_cache", "x");
  session.setItem("unrelated", "keep");
}
const extrasKeys = () => [...session._map.keys()].filter((k) => k.startsWith("averages_extras_"));

await test("clearExtras / invalidateBundle / forgetSession drop every averages_extras_* key", () => {
  reset(); seed();
  clearExtras();
  assert.deepEqual(extrasKeys(), []);
  assert.equal(session.getItem("unrelated"), "keep");
  seed();
  invalidateBundle();
  assert.deepEqual(extrasKeys(), []);
  assert.equal(session.getItem("schoolagy_bundle_cache"), null);
  seed();
  forgetSession();
  assert.deepEqual(extrasKeys(), []);
  assert.equal(session.getItem("unrelated"), "keep");
});

await test("signIn drops them too", async () => {
  reset(); seed();
  routes = { "/auth/session": { body: { ok: true } } };
  const r = await averages.signIn("k", "s");
  assert.equal(r.ok, true);
  assert.deepEqual(extrasKeys(), []);
});

await test("signOut: extras, cloud (incl. OneDrive picks) and push notes gone; push unsubscribed inline", async () => {
  reset(); seed();
  for (const k of ["averages_push_endpoint", "averages_push_touched", "averages_push_pending_delete", "averages_onedrive_picked", "averages_cloud_accounts", "schoolagy_dark_mode"]) local.setItem(k, "1");
  let unsubscribed = 0;
  setNavigator({ serviceWorker: { getRegistration: async (scope) => (scope === "/" ? { pushManager: { getSubscription: async () => ({ unsubscribe: async () => { unsubscribed++; return true; } }) } } : null) } });
  routes = { "/auth/session": { body: { ok: true } } };
  await signOut();
  assert.deepEqual(extrasKeys(), []);
  for (const k of ["averages_push_endpoint", "averages_push_touched", "averages_push_pending_delete", "averages_onedrive_picked", "averages_cloud_accounts"]) assert.equal(local.getItem(k), null, k);
  assert.equal(local.getItem("schoolagy_dark_mode"), "1", "the theme stays");
  assert.equal(unsubscribed, 1);
  assert.ok(calls.some((c) => c.path === "/auth/session" && c.init.method === "DELETE"));
});

await test("signOut uses AveragesPush.forgetLocal() when it's loaded", async () => {
  reset();
  let forgot = 0, inline = 0;
  window.AveragesPush = { forgetLocal: async () => { forgot++; return { ok: true }; } };
  setNavigator({ serviceWorker: { getRegistration: async () => { inline++; return null; } } });
  routes = { "/auth/session": { body: { ok: true } } };
  await signOut();
  assert.equal(forgot, 1);
  assert.equal(inline, 0);
  delete window.AveragesPush;
});

await test("signOut never throws or hangs on push trouble", async () => {
  reset();
  local.setItem("averages_push_endpoint", "e");
  setNavigator({ serviceWorker: { getRegistration: async () => { throw new Error("blocked"); } } });
  routes = { "/auth/session": { body: { ok: true } } };
  await signOut();
  window.AveragesPush = { forgetLocal: () => new Promise(() => {}) };   // never settles
  const t0 = Date.now();
  await signOut();
  assert.ok(Date.now() - t0 < 3300, "capped by sign-out's own 3 s");
  delete window.AveragesPush;
  setNavigator({});
  await signOut();   // no serviceWorker at all
  assert.equal(local.getItem("averages_push_endpoint"), null);
});

await test("an extra that lands after sign-out's wipe isn't cached (2026-10-06 review)", async () => {
  reset();
  routes = { "/data/people": { body: PEOPLE, delay: EXTRAS_WAIT_MS + 150 } };
  const r = await loadExtras("contacts", "", "u1");   // returns at the 4 s mark, people still in flight
  assert.equal(r.answers.people, undefined);
  clearExtras();                                        // what sign-out does
  await new Promise((done) => setTimeout(done, 250));   // the late answer lands now
  assert.equal(session.getItem("averages_extras_people"), null, "not written back after the wipe");
});

await test("expired extras are swept, so old event windows don't pile up (2026-10-06 review)", async () => {
  reset();
  const old = JSON.stringify({ at: Date.now() - 6 * 60 * 1000, who: "u1", data: { EVENTS: [] } });
  session.setItem("averages_extras_events_2026-01-01_2026-09-01", old);
  session.setItem("averages_extras_events_2026-01-02_2026-09-02", "not json");
  session.setItem("schoolagy_bundle_cache", "keep me");
  routes = { "/data/people": { body: PEOPLE } };
  await loadExtras("contacts", "", "u1");
  assert.equal(session.getItem("averages_extras_events_2026-01-01_2026-09-01"), null);
  assert.equal(session.getItem("averages_extras_events_2026-01-02_2026-09-02"), null);
  assert.equal(session.getItem("schoolagy_bundle_cache"), "keep me", "other keys untouched");
  assert.ok(session.getItem("averages_extras_people"), "the fresh one is cached");
});

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
