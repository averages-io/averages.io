// Fullscreen redirect: before anything paints, sends a student who picked Fullscreen to the /IS/ version of the page.
export const FS_BOOT_JS = `(function () {
  window.addEventListener("pageshow", function (e) {
    if (!e.persisted) return;
    if (!go() && window.__averagesSplash && window.__averagesSplash.hide) window.__averagesSplash.hide();
  });
  go();
  function go() {
  try {
    var o = JSON.parse(localStorage.getItem("schoolagy_settings_options") || "{}") || {};
    if (o.windowType !== "fullscreen") return;
    if (sessionStorage.getItem("averages_fs_off") === "1") return;
    var c = JSON.parse(sessionStorage.getItem("averages_features") || "null");
    if (c && c.features && c.features.fullscreen === false) return;
    var p = location.pathname.replace(/\\/+$/, "") || "/";
    if (p === "/" || p === "/onboard" || p === "/signout" || p === "/scan") return;
    var M = {
      "/home": "home", "/courses": "courses", "/grades": "grades", "/assignments": "assignments",
      "/files": "files", "/calendar": "calendar", "/messages": "messages", "/contacts": "contacts",
      "/settings": "settings", "/course-home": "course-hub", "/course-materials": "course-hub#materials",
      "/gradebook": "course-hub#grades", "/assignment": "course-hub#assignments"
    };
    var t = M[p];
    if (!t) { location.replace("/IS/404?from=" + encodeURIComponent(p + location.search)); return true; }
    var h = t.split("#");
    location.replace("/IS/" + h[0] + location.search + (h[1] ? "#" + h[1] : location.hash));
    return true;
  } catch (e) { /* storage off: the Windowed page */ }
  return false;
  }
})();`;
