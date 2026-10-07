/**
 * Per-page extras (2026-10-06): the pure half.
 *
 * The bundle (/data/bundle) is one call that every page shares. Some pages
 * need more than it carries: who teaches each class, teachers' updates, the
 * calendar's events, one class's exact gradebook, its folders, the inbox.
 * Each of those is its own API call, because asking Schoology for all of it
 * on every page would blow the Worker's subrequest budget and make Home wait
 * for the calendar. So each page asks only for what it shows (EXTRAS_BY_PAGE),
 * in parallel with the bundle, and the answers are merged into
 * `window.__AVERAGES__.data` before the page's script runs.
 *
 * This file is only the decisions (which calls, which cache keys, how an
 * answer lands in the data) so it can be tested in Node without a browser:
 * `node --experimental-strip-types --no-warnings scripts/extras.test.mjs`. The fetching,
 * caching and the 4 s wait are loadExtras() in ./averages.ts.
 *
 * A field that isn't set means that extra failed or ran out of time. Pages
 * then show their signed-in empty state, never their sample data.
 */

export type ExtraName = "people" | "updates" | "events" | "gradebook" | "folders" | "messages" | "locate";

export interface ExtraRequest {
  name: ExtraName;
  /** API path plus query, e.g. "/data/gradebook?course=123". */
  path: string;
  /** sessionStorage key. Always starts with EXTRAS_PREFIX, so sign-out can find them all. */
  cacheKey: string;
  /** The class it's about (gradebook, folders, one class's events), else "". */
  course: string;
}

/** Every extras cache key starts with this (see clearExtras() in ./averages.ts). */
export const EXTRAS_PREFIX = "averages_extras_";
/** Same life as the bundle cache: navigating around doesn't re-ask Schoology. */
export const EXTRAS_CACHE_MS = 5 * 60 * 1000;
/** How long a page waits for its extras before rendering without the late ones. */
export const EXTRAS_WAIT_MS = 4000;

/** Page id (scripts/port-pages.mjs ROUTES key) → the extras it shows. */
export const EXTRAS_BY_PAGE: Readonly<Record<string, readonly ExtraName[]>> = {
  home: ["people", "updates"],
  courses: ["people"],
  grades: ["people"],
  assignments: ["people"],
  "course-home": ["people", "updates", "events"],
  gradebook: ["people", "gradebook"],
  "course-materials": ["people", "folders"],
  calendar: ["events"],
  messages: ["people", "messages"],
  contacts: ["people"],
  // Opened as assignment?id=<id> (2026-10-07): which class it's in, for work
  // that isn't in the bundle (older, graded). Skipped when ?course= is there.
  assignment: ["locate"],
};

/** The pages about one class: since 2026-10-07 a real class comes as ?id=<section id>. */
const COURSE_PAGES = new Set(["course-home", "gradebook", "course-materials"]);
/** An assignment or class id from Schoology or Classroom. */
const LMS_ID = /^\d{1,24}$/;

/**
 * Event windows, in days around today. The calendar browses a school year
 * either way; a class hub only needs recent and coming events. The API
 * accepts at most 400 days per call.
 */
export const CALENDAR_DAYS_BACK = 120;
export const CALENDAR_DAYS_AHEAD = 240;
export const HUB_DAYS_BACK = 60;
export const HUB_DAYS_AHEAD = 120;

/**
 * A class id as it may appear in ?course=. Schoology and Classroom ids are
 * digits; anything that isn't a plain token never reaches a URL or a key.
 */
const COURSE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Local calendar date, YYYY-MM-DD (never through UTC, which can shift the day). */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

/**
 * The class a page is about: ?course=, or on a class page ?id= (a real
 * class's id, 2026-10-07). "" when there's no usable one.
 */
export function courseParam(search: string, pageId = ""): string {
  let value = "";
  try {
    const q = new URLSearchParams(search);
    value = q.get("course") ?? "";
    if (!value && COURSE_PAGES.has(pageId)) {
      const id = q.get("id") ?? "";
      if (LMS_ID.test(id)) value = id;
    }
  } catch {
    return "";
  }
  return COURSE_ID.test(value) ? value : "";
}

/** The assignment page's ?id= when it came without its class, else "". */
function bareAssignmentId(search: string): string {
  try {
    const q = new URLSearchParams(search);
    const id = q.get("id") ?? "";
    return !q.get("course") && !q.get("section") && LMS_ID.test(id) ? id : "";
  } catch {
    return "";
  }
}

/**
 * The calls one page makes, in a fixed order. `search` is location.search
 * ("?course=123" or ""); `now` decides the event windows (passed in so tests
 * don't depend on the clock).
 *
 * A page that's about one class but was opened without ?course= (gradebook,
 * course materials) skips that class's extra: it picks a class itself from
 * the bundle, which isn't here yet. The class hub still gets events, for all
 * classes, and keeps its own.
 */
export function extrasFor(pageId: string, search: string, now: Date): ExtraRequest[] {
  const names = EXTRAS_BY_PAGE[pageId] ?? [];
  const course = courseParam(search, pageId);
  const out: ExtraRequest[] = [];
  for (const name of names) {
    const key = (...parts: string[]) => EXTRAS_PREFIX + [name, ...parts].filter(Boolean).join("_");
    switch (name) {
      case "people":
        out.push({ name, path: "/data/people", cacheKey: key(), course: "" });
        break;
      case "updates":
        out.push({ name, path: "/data/updates", cacheKey: key(), course: "" });
        break;
      case "messages":
        out.push({ name, path: "/messages", cacheKey: key(), course: "" });
        break;
      case "events": {
        const hub = pageId === "course-home";
        const start = ymd(addDays(now, -(hub ? HUB_DAYS_BACK : CALENDAR_DAYS_BACK)));
        const end = ymd(addDays(now, hub ? HUB_DAYS_AHEAD : CALENDAR_DAYS_AHEAD));
        const forCourse = hub ? course : "";
        const query = `start=${start}&end=${end}${forCourse ? `&course=${encodeURIComponent(forCourse)}` : ""}`;
        out.push({ name, path: `/data/events?${query}`, cacheKey: key(start, end, forCourse), course: forCourse });
        break;
      }
      case "locate": {
        const id = bareAssignmentId(search);
        if (id) out.push({ name, path: `/data/assignment/locate?id=${id}`, cacheKey: key(id), course: id });
        break;
      }
      case "gradebook":
      case "folders":
        if (!course) break;
        out.push({ name, path: `/data/${name}?course=${encodeURIComponent(course)}`, cacheKey: key(course), course });
        break;
    }
  }
  return out;
}

type Data = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Puts one extra's answer into `data` (mutating it). Returns false when the
 * answer has the wrong shape, which counts the same as a failed call: the
 * fields stay unset.
 */
export function mergeExtra(data: Data, req: Pick<ExtraRequest, "name" | "course">, payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  switch (req.name) {
    case "people": {
      if (!Array.isArray(payload.CONTACTS) && !isRecord(payload.TEACHERS) && !isRecord(payload.courseTeachers)) return false;
      const courseTeachers = isRecord(payload.courseTeachers) ? payload.courseTeachers : {};
      data.TEACHERS = isRecord(payload.TEACHERS) ? payload.TEACHERS : {};
      data.CONTACTS = Array.isArray(payload.CONTACTS) ? payload.CONTACTS : [];
      data.COURSE_TEACHERS = courseTeachers;
      data.PEOPLE_PLATFORM = typeof payload.platform === "string" ? payload.platform : "";
      data.PEOPLE_NEEDS_PERMISSION = payload.needsPermission === true;
      // The bundle sends teacher: "" (it doesn't ask who teaches); fill it
      // here so every page's course line has it without knowing about people.
      // New course objects: the parsed bundle stays as the cache holds it.
      if (Array.isArray(data.COURSES)) {
        data.COURSES = data.COURSES.map((course) => {
          if (!isRecord(course)) return course;
          const id = String(course.id ?? "");
          const current = typeof course.teacher === "string" ? course.teacher.trim() : "";
          const name = courseTeachers[id];
          return !current && typeof name === "string" && name.trim() ? { ...course, teacher: name.trim() } : course;
        });
      }
      return true;
    }
    case "updates":
      // Classroom answers { COURSE_UPDATES: null }: the bundle already has
      // its announcements, so leave those alone.
      if (!Array.isArray(payload.COURSE_UPDATES)) return payload.COURSE_UPDATES === null;
      data.COURSE_UPDATES = payload.COURSE_UPDATES;
      return true;
    case "events":
      if (!Array.isArray(payload.EVENTS)) return false;
      data.EVENTS = payload.EVENTS;
      // Some classes' events didn't load: the calendar says so quietly.
      if (payload.partial === true) data.EVENTS_PARTIAL = true;
      return true;
    case "gradebook": {
      // Classroom answers { GRADEBOOK: null }: the bundle's is exact already.
      if (!isRecord(payload.GRADEBOOK)) return payload.GRADEBOOK === null;
      const merged: Data = isRecord(data.GRADEBOOK) ? { ...data.GRADEBOOK } : {};
      for (const [id, entry] of Object.entries(payload.GRADEBOOK)) {
        // Replace that class's entry whole: the extra's categories and
        // weights are exact, the bundle's are its best guess.
        if (isRecord(entry) && Array.isArray(entry.categories)) merged[id] = entry;
      }
      data.GRADEBOOK = merged;
      return true;
    }
    case "folders":
      if (!Array.isArray(payload.folders)) return false;
      data.FOLDERS = {
        course: req.course,
        folders: payload.folders,
        placement: isRecord(payload.placement) ? payload.placement : {},
        partial: payload.partial === true,
      };
      return true;
    case "locate":
      // { section, title } for the id in `course` (the assignment's id here).
      if (typeof payload.section !== "string" || !LMS_ID.test(payload.section)) return false;
      data.LOCATED = { id: req.course, section: payload.section, title: typeof payload.title === "string" ? payload.title.slice(0, 200) : "" };
      return true;
    case "messages":
      if (!Array.isArray(payload.CONVERSATIONS)) return false;
      data.CONVERSATIONS = payload.CONVERSATIONS;
      data.MESSAGE_PEOPLE = isRecord(payload.PEOPLE) ? payload.PEOPLE : {};
      data.MESSAGES_ME = typeof payload.me === "string" || typeof payload.me === "number" ? String(payload.me) : "";
      return true;
  }
  return false;
}

/**
 * The page's data: the bundle plus whichever extras arrived in time.
 * Returns a new object; `bundle` (the cached copy) isn't changed.
 */
export function mergeExtras(
  bundle: object | null | undefined,
  requests: readonly ExtraRequest[],
  answers: Readonly<Partial<Record<ExtraName, unknown>>>
): Data {
  const data: Data = { ...((bundle ?? {}) as Data) };
  for (const req of requests) {
    if (Object.prototype.hasOwnProperty.call(answers, req.name)) mergeExtra(data, req, answers[req.name]);
  }
  return data;
}
