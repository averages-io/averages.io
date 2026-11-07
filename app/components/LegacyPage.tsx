"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { API_BASE, BELL_UPDATES_MAX_AGE_MS, getSession, loadBundle, loadExtras, pullSyncedSettings, restoreSyncedSetup, signOut, startExtras, studentTimeZone, waitForExtras, type ExtrasRun, type Mode } from "../lib/averages";
import { SPLASH_KEY } from "../lib/splash";
import { EXTRAS_LATE_GIVE_UP_MS, LATE_EXTRAS, mergeExtras, mergeLateExtra, type ExtraName } from "../lib/extras";
import { installNsfwGlobal, preloadNsfwModel } from "../lib/nsfw";
import { SKELETON_CSS, REVEAL_SELECTORS, holdCards, revealCards, skeletonHtml, revealContent, snapshotSkeleton, type SkeletonSnapshot } from "./PageSkeleton";
import * as loading from "../lib/averages-loading";

if (typeof window !== "undefined") (window as any).AveragesLoading = loading;
import { THEME_BOOT_JS } from "../lib/theme-boot";
import { SPLASH_CSS, SPLASH_JS, SPLASH_MIN_MS } from "../lib/splash";
import { JS } from "../lib/js-version";

/**
 * Re-applies the saved theme when ANOTHER tab changes it.
 *
 * The theme itself is applied by the inline boot script in app/layout.tsx
 * (see app/lib/theme-boot.ts), which runs before the first paint — far
 * earlier than any React code can. This file used to carry a second copy of
 * that logic in a layout effect; that copy is gone, and this just calls the
 * one the boot script left on `window`.
 */
function reapplyStoredTheme(): void {
  (window as unknown as { __averagesApplyTheme?: () => void }).__averagesApplyTheme?.();
}

const PUSH_SCRIPT = JS["averages-push.js"];
type PushApi = { touchIfDue?: () => Promise<unknown> };

function touchPushIfOn(): void {
  try {
    const store = window.localStorage;
    if (!store.getItem("averages_push_endpoint") && !store.getItem("averages_push_pending_delete")) return;
  } catch {
    return;
  }
  const run = () => {
    const push = (window as unknown as { AveragesPush?: PushApi }).AveragesPush;
    // touchIfDue never rejects, but a script error must not surface here.
    push?.touchIfDue?.().catch(() => {});
  };
  if ((window as unknown as { AveragesPush?: PushApi }).AveragesPush) {
    run();
    return;
  }
  let script = document.querySelector<HTMLScriptElement>(`script[src="${PUSH_SCRIPT}"]`);
  if (!script) {
    script = document.createElement("script");
    script.src = PUSH_SCRIPT;
    script.async = true;
    document.head.appendChild(script);
  }
  script.addEventListener("load", run, { once: true });
}

const CALENDAR_ON_KEY = "averages_calendar_on";
const CALENDAR_TOUCHED_KEY = "averages_calendar_touched";
function touchCalendarIfOn(): void {
  try {
    const store = window.localStorage;
    if (store.getItem(CALENDAR_ON_KEY) !== "1") return;
    const last = Number(store.getItem(CALENDAR_TOUCHED_KEY)) || 0;
    if (Date.now() - last < 24 * 60 * 60 * 1000 && last <= Date.now()) return;
    store.setItem(CALENDAR_TOUCHED_KEY, String(Date.now()));
  } catch {
    return;
  }
  let tz = "";
  try {
    tz = studentTimeZone();
  } catch {
    /* the feed keeps its zone */
  }
  fetch(`${API_BASE}/calendar/touch`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(tz ? { tz: tz.slice(0, 64) } : {}) })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (d && d.on === false) {
        try {
          window.localStorage.removeItem(CALENDAR_ON_KEY);
          window.localStorage.removeItem(CALENDAR_TOUCHED_KEY);
        } catch {
          /* nothing to forget */
        }
      }
    })
    .catch(() => {});
}

/**
 * Renders one of Averages.io's self-contained HTML/CSS/JS pages inside a real
 * Next.js route, and wires it to auth, real data and image screening.
 *
 * Why the pages aren't rewritten as React components: each one is already
 * built, tested and documented in detail, with its own globals, element ids
 * and inline script. Rewriting them idiomatically would risk regressing a lot
 * of tuned behavior for nothing the user would notice. So each page's original
 * style/markup/script is extracted at build time and injected here as-is.
 *
 * Two ordering rules make that work:
 *
 *   1. NO DATA renders until the API has confirmed this visitor may see it.
 *      The empty structure does paint first — that is the whole point of the
 *      skeleton — but every container it contains ships empty in pages-src and
 *      is filled by the page's own script, which only runs once `getSession()`
 *      has come back. A signed-out visitor who types a URL gets a shimmering
 *      shell and an immediate redirect, never a row of anybody's grades.
 *      (An earlier version of this comment claimed the markup didn't paint at
 *      all. It hasn't been true since the markup started mounting immediately,
 *      and it was worth correcting rather than trusting.)
 *   2. `window.__AVERAGES__` (real data) and `window.__averagesScanImage`
 *      (the NSFW check) exist BEFORE the page's script runs, since it reads
 *      them synchronously at top level.
 */
/** The profile button again, from the saved profile (after a sync pull changed it). Same rules as each page's own. */
function repaintProfileButtons(): void {
  let profile: any = null;
  try {
    profile = JSON.parse(window.localStorage.getItem("schoolagy_profile") || "null");
  } catch {}
  const name = (profile && typeof profile.name === "string" && profile.name.trim()) || (window as any).__AVERAGES_NAME__ || "";
  const photo = profile && typeof profile.photo === "string" && /^data:image\//.test(profile.photo) ? profile.photo : "";
  document.querySelectorAll<HTMLElement>(".profile-btn").forEach((btn) => {
    if (photo) {
      btn.style.backgroundImage = `url("${photo}")`;
      btn.style.backgroundSize = "cover";
      btn.style.backgroundPosition = "center";
      btn.textContent = "";
      btn.classList.add("has-photo");
    } else {
      btn.style.backgroundImage = "";
      btn.classList.remove("has-photo");
      (window as any).AveragesAvatar?.paint(btn, name);
    }
  });
}

export default function LegacyPage({
  title,
  styleCss,
  bodyHtml,
  scriptJs,
  requiresAuth = true,
  usesSavedTheme = true,
  hasUploads = false,
  externalScripts = [],
  pageId,
}: {
  title: string;
  styleCss: string;
  bodyHtml: string;
  scriptJs: string;
  /** Login is the one page reachable while signed out. */
  requiresAuth?: boolean;
  usesSavedTheme?: boolean;
  /**
   * Whether this page can upload images (onboarding and settings can).
   * Only those pages warm the NSFW model — TensorFlow.js plus the weights is
   * several megabytes, and pulling that onto a page with no file input would
   * be waste on every navigation.
   */
  hasUploads?: boolean;
  /**
   * CDN <script src="…"> URLs this specific page's own script depends on
   * (e.g. JSZip for course-materials' folder download). A source page's
   * <head> can list one, but the port step only ever extracts <title>,
   * <style> and inline <script> — an external tag like this would otherwise
   * silently never load in the real app, with no error, just a feature that
   * always falls back to its "can't do this without a real connection"
   * branch. See scripts/port-pages.mjs's EXTERNAL_SCRIPTS map.
   */
  externalScripts?: string[];
  /**
   * This page's key in scripts/port-pages.mjs's ROUTES (e.g. "home",
   * "gradebook") — passed through so the "checking" phase below can show a
   * matching skeleton instead of blank space. See PageSkeleton.tsx.
   */
  pageId?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  /** The signed-in account's id, for the bell's background fetch (scopes the extras cache). */
  const uidRef = useRef("");
  /** The skeleton as it was the moment before the swap (see snapshotSkeleton). */
  const snapRef = useRef<SkeletonSnapshot>({});
  const extrasRef = useRef<ExtrasRun | null>(null);
  /** The extras still on their way when the page drew: their cards hold placeholders until they land. */
  const lateRef = useRef<ExtraName[]>([]);

  /**
   * "checking" until the API answers. The page's markup only mounts once this
   * is "ready", so a signed-out visitor never gets a paint of a protected page
   * — which is also why there's no half-rendered flash on a slow connection.
   */
  const [phase, setPhase] = useState<"checking" | "ready" | "error">("checking");
  const [mode, setMode] = useState<Mode>("out");
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // The theme is already on screen by now — the boot script rendered at the
  // top of this component's output applied it before the first paint. This
  // only keeps it in step when the setting is changed in ANOTHER tab.
  useEffect(() => {
    if (!usesSavedTheme) return;
    function onStorage(e: StorageEvent) {
      if (e.key === "schoolagy_dark_mode" || e.key === "schoolagy_appearance") reapplyStoredTheme();
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [usesSavedTheme]);

  useEffect(() => {
    document.title = title;
  }, [title]);

  // Start loading any page-specific CDN dependency as early as possible —
  // well before the user could reach whatever feature needs it (e.g.
  // Download Folder on course-materials, which needs JSZip). Dedupe by src
  // so this is a no-op on re-renders and never double-loads.
  useEffect(() => {
    for (const src of externalScripts) {
      if (document.querySelector(`script[src="${src}"]`)) continue;
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      document.head.appendChild(script);
    }
  }, [externalScripts]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // The server is the authority on who this is — not localStorage, which
      // anyone could edit.
      const session = await getSession();
      if (cancelled) return;

      if (requiresAuth && session.mode === "out") {
        window.location.href = "/";
        return;
      }

      if (pageId === "onboarding" && session.mode === "live" && !session.incognito) {
        let done = false;
        try {
          done = window.localStorage.getItem("schoolagy_onboarded") === "1" || window.localStorage.getItem("schoolagy_account_mode") === "incognito";
        } catch {}
        if (!done && (await restoreSyncedSetup())) {
          if (cancelled) return;
          try {
            window.sessionStorage.removeItem(SPLASH_KEY);
          } catch {}
          window.location.replace("/home");
          return;
        }
        if (cancelled) return;
      }

      installNsfwGlobal();

      uidRef.current = session.uid ?? "";
      const wantsExtras = requiresAuth && session.mode === "live" && !!pageId;
      const extras = wantsExtras ? startExtras(pageId!, window.location.search, session.uid ?? "") : null;
      extrasRef.current = extras;
      const lateMap = (pageId && LATE_EXTRAS[pageId]) || {};
      const mustWait = extras ? extras.requests.map((r) => r.name).filter((name) => !(name in lateMap)) : [];
      const [bundle] = await Promise.all([
        requiresAuth ? loadBundle() : Promise.resolve(null),
        extras ? waitForExtras(extras, mustWait) : Promise.resolve(),
      ]);
      if (cancelled) return;
      // Late cards: whatever hasn't answered yet by the time the page draws.
      lateRef.current = extras ? extras.requests.map((r) => r.name).filter((name) => name in lateMap && !(name in extras.answers)) : [];

      // The session died between the check above and the data requests.
      if (bundle === "signed_out" || extras?.signedOut) {
        window.location.href = "/";
        return;
      }

      // Live mode with no data (school platform down, timeout, network):
      // stop here. Falling through would render each page's built-in SAMPLE
      // grades, which look exactly like this student's real ones. Keep the
      // skeleton up and show a retry message instead.
      if (requiresAuth && session.mode === "live" && bundle === null) {
        setMode(session.mode);
        (window as any).__averagesSplash?.hide();
        setPhase("error");
        return;
      }

      (window as any).__AVERAGES__ = {
        mode: session.mode,
        // Extras land as fields of the same data object (EVENTS, CONTACTS,
        // COURSE_UPDATES...), so a page reads them like any bundle field. One
        // that failed or ran out of time is simply missing.
        data: extras ? mergeExtras(bundle ?? {}, extras.requests, extras.answers) : bundle ?? {},
        pending: [...lateRef.current],
      };
      // Separate from __AVERAGES__ above on purpose: settings.html only
      // needs to know demo-vs-live to gate the sync toggles, not consume real
      // student data, and scripts/verify-pages.mjs's "Live-data hooks" check
      // treats any embedded page script that references the combined global
      // as a page that renders live data — settings and onboarding aren't
      // supposed to be on that list. Set for every page (not just
      // requiresAuth ones) so a page can check it without special-casing.
      (window as any).__AVERAGES_MODE__ = session.mode;
      (window as any).__AVERAGES_NAME__ = typeof session.name === "string" ? session.name : "";
      (window as any).__AVERAGES_SCHOOL_EMAIL__ = typeof session.email === "string" ? session.email : "";
      (window as any).__AVERAGES_PROVIDER__ = session.mode === "live" ? (session.provider === "google" ? "google" : "schoology") : "";
      let pickedIncognito = false;
      try {
        if (session.incognito) window.localStorage.setItem("schoolagy_account_mode", "incognito");
        pickedIncognito = window.localStorage.getItem("schoolagy_account_mode") === "incognito";
      } catch {
        /* storage blocked: only the API's answer counts */
      }
      const incognito = !!session.incognito || pickedIncognito;
      (window as any).__AVERAGES_INCOGNITO__ = { on: incognito, locked: !!session.incognito };

      const splash = (window as any).__averagesSplash;
      if (splash?.on) {
        const left = SPLASH_MIN_MS - (performance.now() - splash.at);
        if (left > 0) await new Promise((done) => window.setTimeout(done, left));
        if (cancelled) return;
      }

      setMode(session.mode);
      // The placeholders' heights and shimmer positions, read before they're
      // replaced, so the reveal can fade a frozen copy of them out.
      snapRef.current = snapshotSkeleton(containerRef.current, pageId);
      setPhase("ready");
    })();

    return () => {
      cancelled = true;
    };
    // pageId is fixed for a route; listed so the extras follow it if it ever changes.
  }, [requiresAuth, pageId]);

  // Browser notifications: on a signed-in page, once it's on screen. Never
  // in the way of the page: deferred, async, and silent on failure.
  useEffect(() => {
    if (phase !== "ready" || mode !== "live" || !requiresAuth) return;
    const timer = window.setTimeout(() => {
      touchPushIfOn();
      touchCalendarIfOn();
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [phase, mode, requiresAuth]);

  /**
   * Sign-out, wired once for the whole app.
   *
   * Home and Settings both already render `[data-action="signout"]` buttons
   * that were never connected to anything. One delegated listener covers both
   * (and any future page with the same button) without editing page markup.
   */
  useEffect(() => {
    let running = false;
    async function runSignOut() {
      // A page's own script may call this directly (window.__averagesSignOut)
      // as well as the delegated listener below reaching it through a click —
      // guard against both firing at once.
      if (running) return;
      running = true;
      try {
        await signOut();
      } finally {
        window.location.href = "/?signedout=1";
      }
    }

    (window as any).__averagesSignOut = runSignOut;

    function confirmSignOut(target: HTMLElement): Promise<boolean> {
      return new Promise((resolve) => {
        const box = document.createElement("div");
        box.setAttribute("role", "group");
        box.setAttribute("aria-label", "Sign out");
        box.setAttribute("style", "margin:4px;padding:12px;border-radius:12px;background:var(--panel-inner,#dcdce0);color:var(--text-dark,#14151f);text-align:left");
        box.innerHTML = `<b style="display:block;font-weight:800;margin-bottom:4px">Sign out of Averages.io?</b>
          <span style="display:block;font-size:.85rem;font-weight:600;line-height:1.4;color:var(--text-muted,#4b4d63)">You can sign back in with Schoology any time.</span>
          <span style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
            <button type="button" data-so="no" style="font:inherit;font-size:.85rem;font-weight:700;padding:8px 12px;border:0;border-radius:10px;background:var(--panel-bg,#eaeaec);color:inherit;cursor:pointer">Cancel</button>
            <button type="button" data-so="yes" style="font:inherit;font-size:.85rem;font-weight:800;padding:8px 12px;border:0;border-radius:10px;background:#b6432f;color:#fff;cursor:pointer">Sign out</button>
          </span>`;
        target.hidden = true;
        target.insertAdjacentElement("afterend", box);
        const done = (yes: boolean) => { box.remove(); target.hidden = false; if (!yes) target.focus(); resolve(yes); };
        box.addEventListener("click", (e) => { e.stopPropagation(); const b = (e.target as HTMLElement).closest("[data-so]") as HTMLElement | null; if (b) done(b.dataset.so === "yes"); });
        box.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); done(false); } });
        (box.querySelector('[data-so="no"]') as HTMLElement).focus();
      });
    }

    async function onClick(event: MouseEvent) {
      const target = (event.target as HTMLElement | null)?.closest?.(
        '[data-action="signout"]'
      );
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      if (!(await confirmSignOut(target as HTMLElement))) return;
      await runSignOut();
    }
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      if ((window as any).__averagesSignOut === runSignOut) {
        delete (window as any).__averagesSignOut;
      }
    };
  }, []);

  /**
   * A layout effect, not a plain one, and that matters.
   *
   * When `phase` flips to "ready" React swaps the mounted HTML from the
   * skeleton version to the real one (see `mountedHtml` below), which leaves
   * every data container momentarily EMPTY — the page's script is what fills
   * them. A passive effect is not guaranteed to run before the next paint, so
   * on a slow frame the user would see the skeleton blink out and the page sit
   * hollow before the rows appeared. React runs layout effects synchronously
   * after the DOM update and before the browser paints, which closes that gap
   * by construction rather than by luck.
   */
  useLayoutEffect(() => {
    if (phase !== "checking" || !containerRef.current) return;
    const stops = Array.from(containerRef.current.querySelectorAll<HTMLElement>("[data-chart-skel]")).map((el) =>
      loading.chartSkeleton(el, { kind: "line" })
    );
    return () => stops.forEach((stop) => stop());
  }, [phase]);

  useLayoutEffect(() => {
    if (phase !== "ready" || !containerRef.current) return;

    const script = document.createElement("script");
    script.text = scriptJs;
    document.body.appendChild(script);

    const canRedraw = typeof (window as any).__averagesExtraLanded === "function";
    if (!canRedraw) lateRef.current = [];
    const lateMap = (pageId && LATE_EXTRAS[pageId]) || {};
    const held = Array.from(new Set(lateRef.current.flatMap((name) => lateMap[name] ?? [])));
    holdCards(containerRef.current, pageId, held);

    revealContent(containerRef.current, pageId, snapRef.current, (pageId ? REVEAL_SELECTORS[pageId] ?? [] : []).filter((sel) => !held.includes(sel)));
    // The first-open splash (if it's up) fades as the rows rise.
    (window as any).__averagesSplash?.hide();

    if (requiresAuth) (window as any).AveragesBell?.mount({ mode });

    // Warm the model only where an upload is possible, and only after the page
    // is interactive, so a multi-megabyte download never competes with paint.
    if (hasUploads) {
      const warm = window.setTimeout(preloadNsfwModel, 1200);
      return () => {
        window.clearTimeout(warm);
        script.remove();
      };
    }

    return () => {
      script.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, scriptJs, hasUploads, pageId, requiresAuth, mode]);

  useEffect(() => {
    if (phase !== "ready") return;
    const run = extrasRef.current;
    const late = lateRef.current;
    if (!run || !late.length) return;
    let cancelled = false;
    const lateMap = (pageId && LATE_EXTRAS[pageId]) || {};
    const bell = (window as any).AveragesBell;
    if (late.includes("updates")) bell?.expectUpdates?.();
    for (const name of late) {
      const req = run.requests.find((r) => r.name === name);
      const settled = run.settled[name];
      if (!req || !settled) continue;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const giveUp = new Promise<"failed">((resolve) => { timer = setTimeout(() => resolve("failed"), EXTRAS_LATE_GIVE_UP_MS); });
      Promise.race([settled, giveUp]).then((outcome) => {
        if (timer !== undefined) clearTimeout(timer);
        if (cancelled) return;
        if (outcome === "signed_out") { window.location.href = "/"; return; }
        const av = (window as any).__AVERAGES__;
        if (!av || !av.data) return;
        if (outcome === "ok" && name in run.answers) mergeLateExtra(av.data, req, run.answers[name]);
        if (Array.isArray(av.pending)) av.pending = av.pending.filter((n: string) => n !== name);
        const redraw = () => {
          try { (window as any).__averagesExtraLanded?.(name); } catch (e) { console.error(e); }
        };
        revealCards(containerRef.current, pageId, lateMap[name] ?? [], redraw);
        if (name === "updates") bell?.setData?.(Array.isArray(av.data.COURSE_UPDATES) ? { COURSE_UPDATES: av.data.COURSE_UPDATES } : null);
      });
    }
    return () => { cancelled = true; };
  }, [phase, pageId]);

  /**
   * The bell's course updates on pages that don't load them (everything but
   * Home and the class page). After the page has drawn, never before it, so
   * no page waits longer than it did; usually answered from the cache Home
   * filled. A failure just leaves the bell without that section.
   */
  useEffect(() => {
    if (phase !== "ready" || !requiresAuth || mode !== "live") return;
    const bell = (window as any).AveragesBell;
    const have = (window as any).__AVERAGES__?.data?.COURSE_UPDATES;
    // This page loads course updates itself and they're still coming: the
    // late-cards effect below hands them to the bell when they land.
    if (!bell || Array.isArray(have) || lateRef.current.includes("updates")) return;
    let cancelled = false;
    bell.expectUpdates();
    loadExtras("bell", "", uidRef.current, { maxAgeMs: BELL_UPDATES_MAX_AGE_MS })
      .then((r) => {
        if (cancelled) return;
        const got = mergeExtras({}, r.requests, r.answers) as { COURSE_UPDATES?: unknown };
        bell.setData(Array.isArray(got.COURSE_UPDATES) ? { COURSE_UPDATES: got.COURSE_UPDATES } : null);
      })
      .catch(() => { if (!cancelled) bell.setData(null); });
    return () => { cancelled = true; };
  }, [phase, requiresAuth, mode]);

  useEffect(() => {
    if (phase !== "ready" || !requiresAuth || mode !== "live" || pageId === "settings" || pageId === "onboarding") return;
    if ((window as any).__AVERAGES_INCOGNITO__?.on) return;
    let cancelled = false;
    const run = () => {
      pullSyncedSettings().then((changed) => {
        if (cancelled || !changed.length) return;
        for (const key of changed) {
          try {
            window.dispatchEvent(new StorageEvent("storage", { key, newValue: window.localStorage.getItem(key), storageArea: window.localStorage }));
          } catch {}
        }
        if (changed.includes("schoolagy_profile")) repaintProfileButtons();
      });
    };
    const first = window.setTimeout(run, 1500);
    const onVisible = () => { if (document.visibilityState === "visible") run(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(first);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [phase, requiresAuth, mode, pageId]);

  const mountedHtml = useMemo(
    () => (phase === "ready" ? bodyHtml : skeletonHtml(bodyHtml, pageId)),
    [phase, bodyHtml, pageId]
  );

  return (
    <>
      {usesSavedTheme && <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_JS }} />}
      {/* First-open logo splash: signed-in pages, only when this tab has no saved grades yet (app/lib/splash.ts). */}
      {requiresAuth && <style dangerouslySetInnerHTML={{ __html: SPLASH_CSS }} />}
      {requiresAuth && <script dangerouslySetInnerHTML={{ __html: SPLASH_JS }} />}
      <style dangerouslySetInnerHTML={{ __html: styleCss }} />
      <style dangerouslySetInnerHTML={{ __html: SKELETON_CSS }} />
      {phase === "error" && (
        <div
          role="alert"
          style={{
            position: "fixed",
            left: "50%",
            bottom: 96,
            transform: "translateX(-50%)",
            zIndex: 2147483000,
            width: "min(420px, calc(100vw - 32px))",
            boxSizing: "border-box",
            padding: "16px 20px",
            borderRadius: 16,
            background: "#17171a",
            color: "#fff",
            font: "700 14px/1.45 Nunito, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
        >
          <span style={{ flex: 1 }}>
            We couldn't load your grades right now. Your school's platform didn't
            answer.
          </span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              all: "unset",
              cursor: "pointer",
              flex: "none",
              padding: "8px 16px",
              borderRadius: 999,
              background: "#fff",
              color: "#17171a",
              fontWeight: 900,
            }}
          >
            Try again
          </button>
        </div>
      )}
      {mode === "demo" && !bannerDismissed && (
        <div
          role="status"
          style={{
            position: "fixed",
            top: 10,
            left: 10,
            zIndex: 2147483000,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "5px 8px 5px 11px",
            borderRadius: 999,
            background: "rgba(17, 17, 24, 0.82)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            color: "#fff",
            font: "600 11px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            letterSpacing: "0.02em",
            boxShadow: "0 4px 14px rgba(0,0,0,0.28)",
          }}
        >
          <span>Demo · sample data</span>
          {/*
            Closing the demo badge signs you out and returns to login, rather
            than just hiding the label. Hiding it would leave someone in demo
            mode with no visible indication they were in it.
          */}
          <button
            type="button"
            onClick={async () => {
              setBannerDismissed(true);
              await signOut();
              window.location.href = "/?signedout=1";
            }}
            aria-label="Leave demo and return to sign in"
            style={{
              all: "unset",
              cursor: "pointer",
              lineHeight: 1,
              padding: "2px 4px",
              borderRadius: 999,
              opacity: 0.65,
            }}
          >
            ✕
          </button>
        </div>
      )}
      {/*
        display:contents is load-bearing. Every ported page styles `body` as its
        layout container and expects its own top-level element to be body's
        direct child. A plain <div> here became the flex item instead and
        collapsed every page's widths; this removes the wrapper's box from the
        layout tree entirely. The element still exists, so the ref works.
      */}
      <div
        ref={containerRef}
        id="legacy-root"
        style={{ display: "contents" }}
        dangerouslySetInnerHTML={{ __html: mountedHtml }}
      />
    </>
  );
}
