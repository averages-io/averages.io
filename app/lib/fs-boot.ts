/**
 * Fullscreen (2026-10-28, behind the `fullscreen` switch): a student who picked
 * Fullscreen (settingsOptions.windowType, set in onboarding or Settings) is
 * sent to the Fullscreen version of the page they asked for, before anything
 * paints. Those pages are static files in /IS/ (built from fs-src/ by
 * scripts/build-fs.mjs) and only show sample data for now: they're for
 * testing with the tester account.
 *
 * Never redirects when:
 *   - the student hasn't picked Fullscreen;
 *   - this tab already knows the switch is off (the features cache, or a
 *     Fullscreen page that found it off and sent the student back here);
 *   - it's the sign-in page, onboarding or /signout.
 * Any other address that isn't a page here is a 404: that goes to the
 * Fullscreen "page not found", carrying the address.
 */
export const FS_BOOT_JS = `(function () {
  try {
    var o = JSON.parse(localStorage.getItem("schoolagy_settings_options") || "{}") || {};
    if (o.windowType !== "fullscreen") return;
    if (sessionStorage.getItem("averages_fs_off") === "1") return;
    var c = JSON.parse(sessionStorage.getItem("averages_features") || "null");
    if (c && c.features && c.features.fullscreen === false) return;
    var p = location.pathname.replace(/\\/+$/, "") || "/";
    if (p === "/" || p === "/onboard" || p === "/signout") return;
    var M = {
      "/home": "home", "/courses": "courses", "/grades": "grades", "/assignments": "assignments",
      "/files": "files", "/calendar": "calendar", "/messages": "messages", "/contacts": "contacts",
      "/settings": "settings", "/course-home": "course-hub", "/course-materials": "course-hub#materials",
      "/gradebook": "course-hub#grades", "/assignment": "course-hub#assignments"
    };
    var t = M[p];
    if (!t) { location.replace("/IS/404?from=" + encodeURIComponent(p + location.search)); return; }
    var h = t.split("#");
    location.replace("/IS/" + h[0] + location.search + (h[1] ? "#" + h[1] : location.hash));
  } catch (e) { /* storage off: the Windowed page */ }
})();`;
