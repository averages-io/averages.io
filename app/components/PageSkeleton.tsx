/**
 * Loading placeholders, injected INTO the real page rather than replacing it.
 *
 * ── Why this was rewritten (2026-09-16) ──────────────────────────────────
 * The previous version rendered a hand-drawn stand-in for each whole page:
 * grey boxes where the header goes, grey boxes where the nav goes, grey boxes
 * where the table goes. It was explicitly "not a pixel-perfect replica … a
 * hand-authored approximation of its rough shape," which is exactly the
 * problem — the approximations drifted from the real pages and, in Martin's
 * words, were "not accurate at all."
 *
 * This version follows the pattern Martin sent (the Cloudflare dashboard):
 * the page's real chrome — sidebar, headers, column titles, nav, footer —
 * appears immediately and for real, and only the slots where DATA will land
 * get a shimmer. Nothing is redrawn, so nothing can drift out of shape.
 *
 * The thing that makes this safe: every data container in pages-src ships
 * EMPTY and is filled by the page's own script (`#gradesBody`, `#threadList`,
 * `#assignListBody`, …). So rendering the markup early shows real structure
 * with genuine holes in it — never somebody else's sample grades.
 *
 * ── How the specs work ───────────────────────────────────────────────────
 * Each row template reuses the page's OWN class names. That is deliberate,
 * and the opposite of the old file's reasoning. Borrowing the real classes
 * means the skeleton inherits the real padding, borders and row heights, so
 * the shimmer sits exactly where the content will and nothing jumps when the
 * data arrives. The old worry — that class names change and the skeleton
 * drifts silently — is handled two ways now: the failure mode is benign (an
 * unstyled bar, not a mis-drawn page), and `scripts/verify-pages.mjs` fails
 * the build if a selector below no longer exists in its page.
 */

import { calm, rise, skelBar } from "../lib/averages-loading";

/**
 * What's left here after the 2026-10-19 switch to the new loading animation:
 * the shimmer bar, [data-skel], the rise/fade keyframes and the chart skeleton
 * all come from app/lib/averages-loading.css (loaded app-wide by
 * app/layout.tsx), Martin's file, unchanged.
 */
export const SKELETON_CSS = `
  .skel-dot { border-radius: 50%; }
  /* The trend chart's placeholder (class page): its own frame, until
     chartSkeleton() takes over and keeps drawing. */
  [data-chart-skel] { aspect-ratio: 240 / 108; }
`;

/** A shimmer bar. `w` accepts any CSS width so rows can vary believably. */
function bar(w: string, h = 10): string {
  return skelBar(w, h);
}

function dot(size = 8): string {
  return skelBar(`${size}px`, size, "50%");
}

/**
 * Widths cycle rather than sitting uniform, because real rows are ragged —
 * a column of identical bars reads as a loading graphic, a ragged one reads
 * as content that hasn't arrived.
 */
const W = ["68%", "52%", "80%", "44%", "72%", "58%"];
const w = (i: number) => W[i % W.length];

/**
 * Pixel widths, for bars inside shrink-to-fit parents (table cells, flex
 * items). A percentage there resolves against a parent whose width comes from
 * the text that hasn't loaded yet, so it computes to zero and the bar simply
 * doesn't appear.
 */
const PX = ["142px", "104px", "168px", "88px", "150px", "120px"];

export interface SkeletonSpec {
  /** CSS selector for the container the page's script will fill. */
  sel: string;
  /** How many placeholder rows to put in it. */
  count: number;
  /** Row markup, given its index. Reuses the page's real class names. */
  row: (i: number) => string;
  /**
   * Whether this slot joins the top-to-bottom reveal. Default true.
   *
   * False for page furniture — the greeting, a course title, the big current/
   * predicted grade numbers. Those are headings, not data, and animating them
   * makes the whole page look like it's sliding in rather than the rows
   * filling. Per Martin: only the data should do that.
   */
  reveal?: boolean;
}

/**
 * chartSkeleton()'s grid and axis labels, drawn ahead of time at the trend
 * chart's own size (240 x 108), for the frames before any script runs. Same
 * numbers as app/lib/averages-loading.js: L 34, R 6, T 8, B 22.
 */
const CHART_FRAME = (() => {
  const w = 240, h = 108, L = 34, R = 6, T = 8, B = 22;
  const y = (f: number) => T + f * (h - T - B);
  let g = [0, 0.5, 1].map((f) => `<line class="g" x1="${L}" x2="${w - R}" y1="${y(f)}" y2="${y(f)}"/><rect class="axs" x="${L - 30}" y="${y(f) - 4}" width="22" height="8" rx="4"/>`).join("");
  g += [0, 0.5, 1].map((f) => `<rect class="axs" x="${L + f * (w - L - R) - 18 - (f === 1 ? 18 : f ? 0 : -18)}" y="${h - 11}" width="36" height="8" rx="4"/>`).join("");
  return `<svg class="cskel" viewBox="0 0 ${w} ${h}" aria-hidden="true">${g}</svg>`;
})();

const SPECS: Record<string, SkeletonSpec[]> = {
  home: [
    // Ships as the literal text "Hey, Martin" and is rewritten from the saved
    // profile once the script runs — so without this it greets every user by
    // the sample name for the length of the fetch.
    { sel: "#greetingTitle", count: 1, reveal: false, row: () => `<span data-skel>${bar("190px", 26)}</span>` },
    {
      sel: "#gradesBody",
      count: 6,
      row: (i) => `<tr data-skel>
        <td><div class="course-cell">${dot()}<span class="course-name">${bar(PX[i % PX.length], 11)}</span></div></td>
        <td>${bar("34px")}</td>
        <td>${bar("72px", 18)}</td>
        <td class="updated">${bar("46px")}</td>
      </tr>`,
    },
    {
      sel: "#overdueList",
      count: 3,
      row: (i) => `<div class="assign-item" data-skel>
        <span class="assign-tick"></span>
        <div class="assign-text"><p class="assign-title">${bar(PX[i % PX.length], 11)}</p>
        <p class="assign-meta">${bar("120px", 8)}</p></div>
        <span class="assign-due">${bar("52px", 9)}</span>
      </div>`,
    },
    {
      sel: "#upcomingList",
      count: 3,
      row: (i) => `<div class="assign-item" data-skel>
        <span class="assign-tick"></span>
        <div class="assign-text"><p class="assign-title">${bar(PX[(i + 2) % PX.length], 11)}</p>
        <p class="assign-meta">${bar("104px", 8)}</p></div>
        <span class="assign-due">${bar("52px", 9)}</span>
      </div>`,
    },
    {
      sel: "#todayList",
      count: 1,
      row: () => `<div class="today-item" data-skel>
        <span class="today-tick"></span>
        <div class="today-item-text"><p class="today-item-title">${bar("132px", 11)}</p>
        <p class="today-item-class">${bar("78px", 8)}</p></div>
      </div>`,
    },
    {
      sel: "#messagesList",
      count: 3,
      row: (i) => `<div class="message-item" data-skel>
        <span class="message-tick"></span>
        <div class="message-item-text">
          <div class="message-item-top"><p class="message-item-from">${bar("96px", 10)}</p>
          <p class="message-item-time">${bar("40px", 9)}</p></div>
          <p class="message-item-preview">${bar(PX[i % PX.length], 9)}</p>
        </div>
      </div>`,
    },
    {
      // renderRecentGrades() (added 2026-10-19 with the new loading animation):
      // "Recently graded" sat empty while loading.
      sel: "#recentList",
      count: 3,
      row: (i) => `<div class="rg-item" data-skel>
        <span class="assign-tick" style="background:rgba(120, 120, 135, 0.16)"></span>
        <div class="rg-text"><p class="rg-title">${bar(PX[(i + 2) % PX.length], 10)}</p><p class="rg-meta">${bar("96px", 8)}</p></div>
        <div class="rg-score">${bar("40px", 12)}</div>
      </div>`,
    },
    {
      // renderCourseUpdates() (2026-10-19): the Course updates box, same reason.
      sel: "#updatesList",
      count: 2,
      row: (i) => `<div class="tu-item" data-skel>
        <span class="tu-avatar" style="background:none">${dot(28)}</span>
        <div class="tu-text">
          <div class="tu-top"><p>${bar("120px", 10)}</p><span class="tu-time">${bar("32px", 8)}</span></div>
          <p class="tu-body">${bar(w(i), 9)}</p>
        </div>
      </div>`,
    },
  ],

  /*
   * grades.html renders four cells per row (Class / Grade / Predicted Grade /
   * Grade Calculator) — see renderGradesTable(). The `style="flex:1"` pair on
   * the Class cell is the one thing here that isn't copied from the page: the
   * real name and meta text give `.course-row-text` its width, and an empty
   * placeholder gives an auto-layout table nothing to size the column from, so
   * the min-width stands in for the text that hasn't arrived and stops the
   * Class column snapping wider when it does.
   */
  grades: [
    // Stand-in text in the page's markup (2026-10-23, Martin: "why is it flashing a random class
    // emoji then reverting or a random class name"): shimmer in its place while the data loads.
    { sel: "#courseCountSub", count: 1, reveal: false, row: () => `<span data-skel>${bar("64px", 10)}</span>` },
    {
      sel: "#gradesBody",
      count: 6,
      row: (i) => `<tr data-skel>
        <td>
          <div class="course-row">
            <span class="course-tick skel-bar"></span>
            <div class="course-row-text" style="flex:1;min-width:190px">
              <div class="course-row-top">
                <span class="course-row-name" style="flex:1">${bar(w(i), 11)}</span>
                <span class="course-row-code">${bar("42px", 8)}</span>
              </div>
              <div class="course-row-meta">${bar(w(i + 3), 8)}</div>
            </div>
          </div>
        </td>
        <td><span class="grade-val">${bar("20px", 13)}<span class="grade-pct">${bar("30px", 8)}</span></span></td>
        <td><span class="trend flat"><span class="arrow">${dot(7)}</span>${bar("18px", 11)}<span class="grade-pct">${bar("32px", 8)}</span></span></td>
        <td class="calc-cell">${bar("104px", 28)}</td>
      </tr>`,
    },
  ],

  /*
   * courses.html shares the whole `.course-row` / `.grade-val` / `.trend`
   * family with grades.html and adds two columns of its own: the assignment
   * summary (`.assign-cell`, which carries the expand chevron) and Updated.
   * The `upcoming` modifier is kept on `.assign-status` because that is what
   * makes `.assign-status-due` a second line — without it the cell is a line
   * shorter than the rows that replace it.
   */
  courses: [
    // Stand-in text in the page's markup (2026-10-23, Martin: "why is it flashing a random class
    // emoji then reverting or a random class name"): shimmer in its place while the data loads.
    { sel: "#courseCountSub", count: 1, reveal: false, row: () => `<span data-skel>${bar("64px", 10)}</span>` },
    {
      sel: "#coursesBody",
      count: 6,
      row: (i) => `<tr data-skel>
        <td>
          <div class="course-row">
            <span class="course-tick skel-bar"></span>
            <div class="course-row-text" style="flex:1;min-width:190px">
              <div class="course-row-top">
                <span class="course-row-name" style="flex:1">${bar(w(i), 11)}</span>
                <span class="course-row-code">${bar("42px", 8)}</span>
              </div>
              <div class="course-row-meta">${bar(w(i + 3), 8)}</div>
            </div>
          </div>
        </td>
        <td><span class="grade-val">${bar("20px", 13)}<span class="grade-pct">${bar("30px", 8)}</span></span></td>
        <td><span class="trend flat"><span class="arrow">${dot(7)}</span>${bar("18px", 11)}<span class="grade-pct">${bar("32px", 8)}</span></span></td>
        <td>
          <div class="assign-cell">
            <span class="assign-status upcoming">${bar("92px", 10)}<span class="assign-status-due">${bar("64px", 8)}</span></span>
            <span class="assign-expand-btn">${bar("13px", 13)}</span>
          </div>
        </td>
        <td class="updated">${bar("52px", 9)}</td>
      </tr>`,
    },
  ],

  /*
   * `#curVal` / `#predVal` are themselves the `.grade-hero-val` spans, so these
   * rows are their *contents*: a letter grade and a `.grade-hero-pct` beside it
   * (and, for the prediction, the `.grade-hero-trend` pill that wraps the
   * arrow). `#gbCategories` mirrors renderCategories(): a `.gb-category` per
   * weighting category, each a head, its `.gb-bar` average meter, and its
   * `.gb-assign-row` list.
   */
  gradebook: [
    // Stand-in text in the page's markup (2026-10-23, Martin: "why is it flashing a random class
    // emoji then reverting or a random class name"): shimmer in its place while the data loads.
    { sel: "#gbTitle", count: 1, reveal: false, row: () => `<span data-skel>${bar("46%", 22)}</span>` },
    { sel: "#sheetEmoji", count: 1, reveal: false, row: () => "" },
    { sel: "#sheetTitle", count: 1, reveal: false, row: () => `<span data-skel>${bar("220px", 24)}</span>` },
    {
      sel: "#curVal",
      reveal: false,
      count: 1,
      row: () => `<span data-skel>${bar("30px", 26)}</span><span class="grade-hero-pct" data-skel>${bar("34px", 10)}</span>`,
    },
    {
      sel: "#predVal",
      reveal: false,
      count: 1,
      row: () => `<span class="grade-hero-trend flat" data-skel><span class="arrow">${dot(9)}</span>${bar("30px", 26)}</span><span class="grade-hero-pct" data-skel>${bar("34px", 10)}</span>`,
    },
    {
      sel: "#gbCategories",
      count: 3,
      row: (i) => `<div class="gb-category" data-skel>
        <div class="gb-category-head">
          <span class="gb-category-name">${bar("110px", 11)}</span>
          <span class="gb-category-weight">${bar("86px", 9)}</span>
        </div>
        <div class="gb-bar"><div class="gb-bar-fill skel-bar" style="width:${w(i)}"></div></div>
        ${[0, 1, 2]
          .map(
            (j) => `<div class="gb-assign-row">
          <span class="gb-assign-title" style="flex:1">${bar(w(i + j), 10)}</span>
          <span class="gb-assign-score">${bar("54px", 9)}</span>
        </div>`
          )
          .join("")}
      </div>`,
    },
  ],

  /*
   * assignments.html builds its list in assignRowHTML() and groups it under
   * `.assign-group-label` headings on the default "All" tab, so two of the
   * seven placeholders carry a label above them. The status modifier
   * (`overdue`/`upcoming`/…) is deliberately left off: it only recolors the
   * tick, and a grey tick is the honest thing to show before the data says
   * whether anything is late.
   */
  assignments: [
    {
      sel: "#assignListBody",
      count: 7,
      row: (i) => `${
        i === 0 || i === 3 ? `<p class="assign-group-label" data-skel>${bar("68px", 8)}</p>` : ""
      }<div class="assign-row" data-skel>
        <span class="assign-tick"></span>
        <div class="assign-text">
          <p class="assign-course">${bar(w(i), 11)}</p>
          <p class="assign-title">${bar(w(i + 2), 10)}</p>
          <p class="assign-meta">${bar("72px", 8)}</p>
        </div>
        <span class="assign-due">${bar("64px", 9)}</span>
      </div>`,
    },
  ],

  assignment: [
    // Stand-in text in the page's markup (2026-10-23, Martin: "why is it flashing a random class
    // emoji then reverting or a random class name"): shimmer in its place while the data loads.
    { sel: "#classLink", count: 1, reveal: false, row: () => `<span data-skel>${bar("96px", 10)}</span>` },
    { sel: "#gradebookLink", count: 1, reveal: false, row: () => `<span data-skel>${bar("72px", 10)}</span>` },
    // `#assignTitle` is a plain <h1 class="title"> the page fills with
    // textContent, so one bar standing in for the line is the whole of it.
    { sel: "#assignTitle", count: 1, reveal: false, row: () => `<span data-skel>${bar("62%", 22)}</span>` },
    {
      // materialRowHTML(m, true) in assignment.html: the file-type badge,
      // the name, and the Download button in its `.material-actions` box.
      sel: "#materialsList",
      count: 3,
      row: (i) => `<div class="material-row" data-skel>
        <span class="material-badge">${bar("30px", 30)}</span>
        <span class="material-name">${bar(w(i), 10)}</span>
        <div class="material-actions">${dot(28)}</div>
      </div>`,
    },
  ],

  // Settings (2026-10-23): only the storage figure, which showed a made-up "128 MB" first.
  settings: [
    { sel: "#cacheSizeValue", count: 1, reveal: false, row: () => `<span data-skel>${bar("44px", 9)}</span>` },
  ],

  messages: [
    {
      // renderThreadList() in messages.html. The name/time line is a flex
      // row, so those two bars are sized in px — a percentage width inside
      // a shrink-to-fit flex item resolves against nothing and collapses.
      sel: "#threadList",
      count: 7,
      row: (i) => `<div class="msgs-thread-row" data-skel>
        <span class="msgs-avatar">${dot(44)}</span>
        <div class="msgs-thread-row-text">
          <div class="msgs-thread-row-top">
            <span class="msgs-thread-row-name">${bar(`${96 + (i % 3) * 22}px`, 11)}</span>
            <span class="msgs-thread-row-time">${bar("34px", 8)}</span>
          </div>
          <div class="msgs-thread-row-subject">${bar(w(i), 9)}</div>
          <div class="msgs-thread-row-preview">${bar(w(i + 2), 9)}</div>
        </div>
      </div>`,
    },
  ],

  contacts: [
    // Stand-in text in the page's markup (2026-10-23, Martin: "why is it flashing a random class
    // emoji then reverting or a random class name"): shimmer in its place while the data loads.
    { sel: "#contactsHeading", count: 1, reveal: false, row: () => `<span data-skel>${bar("128px", 14)}</span>` },
    {
      // contactRowHTML() in contacts.html. The row's Email quick-action is
      // a real <a>; a span keeps the same 30px box without being a link.
      sel: "#contactsListBody",
      count: 8,
      row: (i) => `<div class="contact-row" data-skel>
        <span class="contact-avatar">${dot(38)}</span>
        <div class="contact-text">
          <p class="contact-name">${bar(w(i))}</p>
          <p class="contact-role">${bar(w(i + 3), 9)}</p>
          <p class="contact-meta">${bar("52%", 8)}</p>
        </div>
        <span class="contact-email-btn">${dot(14)}</span>
      </div>`,
    },
  ],

  /* calendar: deliberately has no spec.
     #calBody isn't a list of data rows — renderMonthView() replaces it
     wholesale with a .cal-grid-wrap > .cal-dow-row + .cal-month-grid, and
     week/year/search views swap in three further shapes. The grid itself
     is computed locally from focusDate, not fetched: the weekday header
     and every .cal-day-num appear the instant the script runs, so
     shimmering them would claim they're loading. The only real data is the
     .cal-event-chip set, which lands on an unpredictable subset of days —
     any placement we picked would be invented, and the row count (5 vs 6
     week rows) depends on a month we can't know yet. Better nothing than a
     grid that rearranges itself the moment the real one arrives. */

  /*
   * `#curVal` / `#predVal` are the `.grade-hero-val` spans themselves, filled
   * with a letter grade plus a `.grade-hero-pct` (and, for the prediction, the
   * `.grade-hero-trend` pill around the arrow) — same shape as gradebook's.
   * The band class (`good`/`mid`/`bad`) is left off: it only colors the letter,
   * and guessing a color before the grade loads would be a claim, not a shape.
   */
  "course-home": [
    // Stand-in text in the page's markup (2026-10-23, Martin: "why is it flashing a random class
    // emoji then reverting or a random class name"): shimmer in its place while the data loads.
    { sel: "#bannerIcon", count: 1, reveal: false, row: () => "" },
    { sel: "#hubTitle", count: 1, reveal: false, row: () => `<span data-skel>${bar("220px", 24)}</span>` },
    {
      // Current grade, under the projected grade in the course banner (2026-10-01).
      sel: "#curVal",
      reveal: false,
      count: 1,
      row: () => `<span class="sheet-letter" data-skel>${bar("56px", 44)}</span><span class="sheet-pct" data-skel>${bar("30px", 9)}</span>`,
    },
    {
      // Projected grade, inside the course banner (2026-10-01).
      sel: "#predVal",
      reveal: false,
      count: 1,
      row: () => `<span class="grade-hero-trend" data-skel><span class="arrow">${dot(9)}</span>${bar("30px", 26)}</span><span class="grade-hero-pct" data-skel>${bar("34px", 10)}</span>`,
    },
    {
      // announceRowHTML(): each post is a <button class="announce-item">.
      // tabindex="-1" keeps the placeholders out of the tab order — the
      // [data-skel] rule handles the pointer, not the keyboard.
      sel: "#announceList",
      count: 3,
      row: (i) => `<button type="button" class="announce-item" tabindex="-1" data-skel>
        <div class="announce-item-head">
          <span class="announce-avatar">${dot(24)}</span>
          <span class="announce-author">${bar("96px", 9)}</span>
          <span class="announce-time">${bar("38px", 8)}</span>
        </div>
        <p class="announce-text">${bar(w(i), 10)}</p>
      </button>`,
    },
    {
      // renderWeek(): the hub's "Coming up" ribbon (redo 2026-10-01). One
      // placeholder row stands in for the grid while data loads.
      sel: "#upcomingBody",
      count: 3,
      row: (i) => `<div class="week-item" data-skel>${dot(18)}<span class="week-item-text"><span class="week-title">${bar(w(i), 10)}</span><span class="week-when">${bar("48px", 8)}</span></span></div>`,
    },
    {
      // renderTrend(): the grade trend chart and the scores under it
      // (2026-10-19). The frame is chartSkeleton()'s own grid at the chart's
      // 240 x 108, so the first frame already looks like a chart loading;
      // once the page is live, LegacyPage starts the line that keeps drawing.
      sel: "#trendBody",
      count: 1,
      row: () => `<div class="trend-chart" data-chart-skel data-skel>${CHART_FRAME}</div>
        <ol class="trend-list" data-skel>${[0, 1, 2].map((i) => `<li><span class="trend-title">${bar(w(i + 1), 10)}</span><span class="trend-date">${bar("40px", 8)}</span><span class="trend-score">${bar("28px", 10)}</span></li>`).join("")}</ol>`,
    },
  ],

  /*
   * Only the grid is specced. course-materials.html renders `#itemGrid` or
   * the `#itemList` table depending on `view`, which starts at 'grid', and
   * the table shows up `hidden` in the markup — placeholders in its tbody
   * would be invisible. The star badge is omitted: it's per-file state, so
   * reserving room for one on every tile would invent starred files.
   */
  "course-materials": [
    // Stand-in text in the page's markup (2026-10-23, Martin: "why is it flashing a random class
    // emoji then reverting or a random class name"): shimmer in its place while the data loads.
    { sel: "#sheetEmoji", count: 1, reveal: false, row: () => "" },
    { sel: "#sheetTitle", count: 1, reveal: false, row: () => `<span data-skel>${bar("220px", 24)}</span>` },
    {
      sel: "#itemGrid",
      count: 10,
      row: (i) => `<div class="item-tile" data-skel>
        <span class="item-icon">${bar("34px", 40)}</span>
        <span class="item-name">${bar(`${44 + (i % 3) * 16}px`, 9)}</span>
      </div>`,
    },
  ],
};

/**
 * Drops placeholder rows into `root` for the given page and returns a cleanup
 * that removes them again.
 *
 * Silently skips a selector that isn't present: a page legitimately renders
 * different containers in different states (Course Materials' grid vs list
 * view), and a missing one during loading is not worth throwing over. Real
 * drift is caught at build time instead — see verify-pages.mjs.
 */
/**
 * The placeholder markup for a page, as `[selector, html]` pairs.
 *
 * Split out from injectSkeleton so it can be built and inspected without a
 * DOM — which is what lets verify/skeleton-preview.mjs render every page's
 * loading state to a real browser for review. A skeleton nobody can look at
 * is how the last set drifted into being wrong.
 */
export function skeletonMarkup(pageId?: string): Array<[string, string]> {
  const specs = pageId ? SPECS[pageId] : undefined;
  if (!specs) return [];
  return specs.map((spec) => [
    spec.sel,
    Array.from({ length: spec.count }, (_, i) => spec.row(i)).join(""),
  ]);
}

/**
 * Replaces the inner HTML of the element carrying `id` — as a string, with no
 * DOM involved.
 *
 * Scans forward from the opening tag counting same-name tags so that a
 * container holding nested elements of its own kind (a `<div id="x">` with
 * `<div>`s inside it) ends at its OWN closing tag rather than the first one.
 * Returns the input untouched if the id isn't there or the element is
 * self-closing, which is the same "silently skip" behaviour the DOM version
 * had: a page legitimately renders different containers in different states.
 */
function replaceInnerHtml(html: string, id: string, inner: string): string {
  const open = new RegExp(`<([a-zA-Z][\\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*\\sid=["']${id}["'](?:[^>"']|"[^"]*"|'[^']*')*)>`).exec(html);
  if (!open) return html;
  if (open[2].trimEnd().endsWith("/")) return html;

  const tag = open[1].toLowerCase();
  const openEnd = open.index + open[0].length;
  const scan = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  scan.lastIndex = openEnd;

  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = scan.exec(html))) {
    if (match[1]) {
      depth -= 1;
      if (depth === 0) return html.slice(0, openEnd) + inner + html.slice(match.index);
    } else if (!match[0].trimEnd().endsWith("/>")) {
      depth += 1;
    }
  }
  return html;
}

/**
 * A page's body markup with the shimmer already sitting in its data slots.
 *
 * This is the whole point of the 2026-09-16 rework. The DOM version of this
 * (`injectSkeleton`, now gone) ran in a layout effect, which is before the
 * browser paints — but only once React has hydrated. The server-rendered HTML
 * reaches the screen well before that, so for about one tenth of a second the
 * page showed its real card, its real column headings and NOTHING in between:
 * correct structure, no placeholders. Exactly the gap Martin caught on video.
 *
 * Doing it as a string means the skeleton is in the HTML the server sends, so
 * the very first painted frame already has it — which is what the Cloudflare
 * dashboard does and what he asked for: the structure is there at its final
 * size, the data is not, and the holes are visibly loading.
 *
 * Every selector in SPECS is an id (verify-pages.mjs enforces that they all
 * still exist), so a targeted string replacement is enough; no HTML parser.
 */
export function skeletonHtml(bodyHtml: string, pageId?: string): string {
  let out = bodyHtml;
  for (const [sel, inner] of skeletonMarkup(pageId)) {
    if (!sel.startsWith("#")) continue;
    out = replaceInnerHtml(out, sel.slice(1), inner);
  }
  return out;
}

/**
 * Taken a moment before the skeleton is swapped for the real page (LegacyPage,
 * right before it flips to "ready"): each data box's height, and where every
 * shimmer was in its sweep. The reveal uses it to lay a frozen copy of the
 * placeholders over the real rows and fade it out, and to ease each box from
 * its loading height to its real one. Empty under Potato mode or reduced
 * motion, where nothing animates.
 */
export interface SkeletonSnapshot {
  [sel: string]: { h0: number; sweep: string[] };
}

const isTablePart = (el: Element) => /^(TABLE|THEAD|TBODY|TFOOT|TR)$/.test(el.tagName);
const shown = (el: Element) => el.getClientRects().length > 0;

export function snapshotSkeleton(root: HTMLElement | null, pageId?: string): SkeletonSnapshot {
  const out: SkeletonSnapshot = {};
  const sels = pageId ? REVEAL_SELECTORS[pageId] : undefined;
  if (!root || !sels || calm()) return out;
  for (const sel of sels) {
    const host = root.querySelector<HTMLElement>(sel);
    if (!host || !shown(host)) continue;
    out[sel] = {
      h0: host.offsetHeight,
      sweep: Array.from(host.querySelectorAll<HTMLElement>(".skel-bar")).map((b) => getComputedStyle(b).backgroundPosition),
    };
  }
  return out;
}

/**
 * The placeholders, laid exactly over the box that now holds the real rows,
 * with each shimmer frozen where it was, fading out (.skel-ghost). Built from
 * the same markup the skeleton was, in the same parent, so it looks the same.
 *
 * Not for tables: a <tbody> or <tr> can't be lifted out and laid over its own
 * table, so table rows just rise in.
 */
function ghostOver(host: HTMLElement, markup: string, sweep: string[]): void {
  const par = host.parentElement;
  if (!par || isTablePart(host) || isTablePart(par)) return;
  const restore = par.style.position;
  if (getComputedStyle(par).position === "static") par.style.position = "relative";
  const g = document.createElement(host.tagName);
  g.className = host.className;
  g.classList.add("skel-ghost");
  g.setAttribute("aria-hidden", "true");
  g.innerHTML = markup;
  g.querySelectorAll<HTMLElement>(".skel-bar").forEach((b, i) => { if (sweep[i]) b.style.backgroundPosition = sweep[i]; });
  Object.assign(g.style, { position: "absolute", left: `${host.offsetLeft}px`, top: `${host.offsetTop}px`, width: `${host.offsetWidth}px`, margin: "0" });
  par.insertBefore(g, host.nextSibling);
  window.setTimeout(() => {
    g.remove();
    par.style.position = restore;
  }, 420);
}

/**
 * Data landed (2026-10-19, Martin's new loading animation,
 * app/lib/averages-loading.js): in each data box the placeholders fade out on
 * top, the real rows rise in underneath 35ms apart (capped, so a long list
 * doesn't drag), and the box eases from its loading height to its real one.
 *
 * Unchanged from before: only the data moves. Furniture (the greeting, a
 * course title, the big grade numbers) is `reveal: false` in SPECS and just
 * appears. Every box starts at the same moment, so rows level with each other
 * in side-by-side boxes still arrive together.
 *
 * Replaces the 2026-09-16 opacity-only wave down the page. Potato mode and
 * reduced motion: the rows simply appear.
 */
export function revealContent(root: HTMLElement, pageId?: string, snap: SkeletonSnapshot = {}, only?: readonly string[]): void {
  const all = pageId ? REVEAL_SELECTORS[pageId] : undefined;
  // `only`: just these cards (a card that loaded on its own, revealCards()).
  const sels = all && only ? all.filter((sel) => only.includes(sel)) : all;
  if (!sels || sels.length === 0 || calm()) return;
  const markup = new Map(skeletonMarkup(pageId));

  for (const sel of sels) {
    const host = root.querySelector<HTMLElement>(sel);
    // Home's Messages widget is off by default: nothing to animate in it.
    if (!host || !shown(host)) continue;
    const before = snap[sel];
    if (before && markup.has(sel)) ghostOver(host, markup.get(sel)!, before.sweep);

    Array.from(host.children).filter(shown).forEach((row, i) => rise(row as HTMLElement, i));

    const h1 = host.offsetHeight;
    if (before && before.h0 && !isTablePart(host) && Math.abs(h1 - before.h0) > 2 && host.animate) {
      const overflow = host.style.overflow;
      host.style.overflow = "hidden";
      host.animate([{ height: `${before.h0}px` }, { height: `${h1}px` }], { duration: 520, easing: "cubic-bezier(.16, 1, .3, 1)" }).onfinish = () => {
        host.style.overflow = overflow;
      };
    }
  }
}

/**
 * Cards that load on their own (2026-10-20, app/lib/extras.ts LATE_EXTRAS).
 *
 * holdCards: right after the page's script has drawn (it drew these cards
 * without their data, as "didn't load"), put the placeholders back in them,
 * in the same frame, so what shows is a card still loading.
 */
export function holdCards(root: HTMLElement | null, pageId: string | undefined, sels: readonly string[]): void {
  if (!root || !pageId || !sels.length) return;
  const markup = new Map(skeletonMarkup(pageId));
  for (const sel of sels) {
    const host = root.querySelector<HTMLElement>(sel);
    const inner = markup.get(sel);
    if (!host || inner === undefined) continue;
    host.innerHTML = inner;
    host.setAttribute("aria-busy", "true");
  }
}

/**
 * revealCards: a held card's data is in. Same reveal as the page's first one,
 * card by card: the placeholders fade out on top, the real rows rise in, the
 * box eases to its new height. `redraw` is the page drawing those cards.
 * Potato mode and reduced motion: the rows simply appear.
 */
export function revealCards(root: HTMLElement | null, pageId: string | undefined, sels: readonly string[], redraw: () => void): void {
  if (!root || !pageId || !sels.length) {
    redraw();
    return;
  }
  const snap: SkeletonSnapshot = {};
  if (!calm()) {
    for (const sel of sels) {
      const host = root.querySelector<HTMLElement>(sel);
      if (!host || !shown(host)) continue;
      snap[sel] = { h0: host.offsetHeight, sweep: Array.from(host.querySelectorAll<HTMLElement>(".skel-bar")).map((b) => getComputedStyle(b).backgroundPosition) };
    }
  }
  redraw();
  for (const sel of sels) root.querySelector(sel)?.removeAttribute("aria-busy");
  revealContent(root, pageId, snap, sels);
}

/** Page ids that have a spec — used by verify-pages.mjs and by LegacyPage. */
export const SKELETON_PAGES = Object.keys(SPECS);
export const SKELETON_SELECTORS: Record<string, string[]> = Object.fromEntries(
  Object.entries(SPECS).map(([id, specs]) => [id, specs.map((s) => s.sel)])
);

/** Only the data containers — what the reveal animation is allowed to touch. */
export const REVEAL_SELECTORS: Record<string, string[]> = Object.fromEntries(
  Object.entries(SPECS).map(([id, specs]) => [
    id,
    specs.filter((s) => s.reveal !== false).map((s) => s.sel),
  ])
);
