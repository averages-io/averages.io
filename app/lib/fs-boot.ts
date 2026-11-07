// Fullscreen redirect: before anything paints, sends a student who picked Fullscreen to the /IS/ version of the page.
export const FS_BOOT_JS = `(function () {
  window.addEventListener("pageshow", function (e) {
    if (!e.persisted) return;
    if (!go() && window.__averagesSplash && window.__averagesSplash.hide) window.__averagesSplash.hide();
  });
  // The first page app.averages.io opens to (the app worker reads this cookie at "/"), so a new visit goes straight
  // there instead of through /home and a second redirect: Fullscreen or Windowed, and Settings > Open to.
  try { document.cookie = "averages_start=" + avStart() + "; Path=/; Max-Age=31536000; SameSite=Lax" + (location.protocol === "https:" ? "; Secure" : ""); } catch (e) { /* cookies off */ }
  if (openTo()) return;
  go();
  function avStart() {
    try {
      var o = JSON.parse(localStorage.getItem("schoolagy_settings_options") || "{}") || {};
      var pages = ["courses", "calendar", "grades", "messages", "assignments", "files", "contacts"];
      var to = pages.indexOf(o.openTo) >= 0 ? o.openTo : "home";
      var fs = o.windowType === "fullscreen" && sessionStorage.getItem("averages_fs_off") !== "1";
      var c = JSON.parse(sessionStorage.getItem("averages_features") || "null");
      if (c && c.features && c.features.fullscreen === false) fs = false;
      return (fs ? "/IS/" : "/") + to;
    } catch (e) { return "/home"; }
  }
  // Settings > Account > Open to: the first page of a new visit (a new tab or window) is the one picked, not Home.
  function openTo() {
    try {
      var p = location.pathname.replace(/\\/+$/, "") || "/";
      if (p === "/" || p === "/onboard" || p === "/signout" || p === "/scan") return false;
      if (sessionStorage.getItem("averages_opened") === "1") return false;
      sessionStorage.setItem("averages_opened", "1");
      if (p !== "/home" || location.search || location.hash) return false;
      var to = (JSON.parse(localStorage.getItem("schoolagy_settings_options") || "{}") || {}).openTo;
      if (!/^(courses|calendar|grades|messages|assignments|files|contacts)$/.test(to || "")) return false;
      location.replace("/" + to);
      return true;
    } catch (e) { return false; }
  }
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
