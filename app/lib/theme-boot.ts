/**
 * The user's saved dark-mode / accent / background, applied before the browser
 * paints anything at all.
 *
 * ── Why this is a string of JS and not a normal function ──────────────────
 * It has to run earlier than React can run anything. LegacyPage used to apply
 * the theme in a layout effect, which is before paint — but only once React
 * has hydrated, and the server-rendered HTML is on screen well before that.
 * The visible result, caught on video 2026-09-16: the page appears on the
 * near-black CSS default, then flips to the saved wallpaper about a tenth of
 * a second later. Same class of bug as the missing skeleton.
 *
 * The fix is the standard no-flash pattern — a synchronous inline <script>,
 * which blocks parsing where it sits, so it is guaranteed to have run before
 * the markup after it is parsed, let alone painted. layout.tsx puts it as the
 * first child of <body> rather than in <head> on purpose: from there
 * `document.body` already exists, so the background can be set directly on
 * both elements instead of through an injected stylesheet fighting each
 * page's own `html { background-color }` rule for precedence.
 *
 * It is also the ONLY copy of this logic. It hangs the applier on
 * `window.__averagesApplyTheme` so LegacyPage's `storage` listener (another
 * tab changing the setting) can call the same code rather than keeping a
 * second implementation in sync with it.
 *
 * Why both <html> and <body> get the background: browser-drawn UI —
 * scrollbars, the overscroll gutter, form controls — is themed from
 * `color-scheme` and from the CANVAS background, which comes from <html>, not
 * from whatever JS later set on <body>. Declaring neither is what made
 * Firefox draw a pink scrollbar against a blue background.
 */
export const THEME_BOOT_JS = `(function () {
  function darken(hex, amount) {
    var n = parseInt(hex.slice(1), 16);
    var c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (v) {
      return Math.round(Math.max(0, v * (1 - amount))).toString(16).padStart(2, "0");
    });
    return "#" + c.join("");
  }

  function apply() {
    var html = document.documentElement;
    var root = html.style;
    var body = document.body;

    var isDark = false;
    try {
      var v = localStorage.getItem("schoolagy_dark_mode");
      if (v === "dark") isDark = true;
      else if (v === "light") isDark = false;
      else isDark = !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    } catch (e) {
      isDark = false;
    }

    var tokens = isDark
      ? {
          "--panel-bg": "#1c1d26",
          "--panel-inner": "#15161e",
          "--text-dark": "#f0f0f5",
          "--text-muted": "#a3a5bd",
          "--text-faint": "#6f7086",
          "--border": "#33344a",
          "--toggle-track-bg": "#3a3c4d"
        }
      : {
          "--panel-bg": "#eaeaec",
          "--panel-inner": "#dcdce0",
          "--text-dark": "#14151f",
          "--text-muted": "#4b4d63",
          "--text-faint": "#83849a",
          "--border": "#cfcfd6",
          "--toggle-track-bg": "#c7c7cd"
        };
    for (var k in tokens) root.setProperty(k, tokens[k]);
    if (body) body.classList.toggle("dark-mode", isDark);

    function background(image, color, scheme) {
      html.style.colorScheme = scheme;
      if (color !== null) html.style.backgroundColor = color;
      if (!body) return;
      if (image !== null) body.style.backgroundImage = image;
      if (color !== null) body.style.backgroundColor = color;
    }

    try {
      var raw = localStorage.getItem("schoolagy_appearance");
      var saved = raw ? JSON.parse(raw) : null;
      if (saved && saved.accent) {
        root.setProperty("--accent", saved.accent);
        root.setProperty("--accent-dark", saved.accentDark || darken(saved.accent, 0.22));
      }
      if (saved && saved.background === "white") background("none", "#f4f4f6", "light");
      else if (saved && saved.background === "black") background("none", "#0c0c0e", "dark");
      else if (saved && saved.background) {
        // A wallpaper image. Its average brightness is unknown, so the browser
        // UI follows the dark-mode preference rather than guessing.
        background('url("' + saved.background + '")', null, isDark ? "dark" : "light");
      } else {
        // Nothing saved: the page's own CSS default (the near-black #0c0c0e)
        // is what's showing, so tell the browser that's what it's theming
        // against.
        background(null, null, "dark");
      }
    } catch (e) {
      // Malformed JSON or private browsing — the page's own default look
      // stands, which is exactly what every page shipped with.
    }
  }

  var POTATO_CSS = "body.potato-mode,body.potato-mode *,body.potato-mode *::before,body.potato-mode *::after{animation:none!important;transition:none!important;scroll-behavior:auto!important;filter:none!important;text-shadow:none!important}html:has(body.potato-mode){scroll-behavior:auto!important}body.potato-mode,body.potato-mode *{font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif!important}body.potato-mode h1.title{font-style:normal!important;transform:none!important}body.potato-mode .trend.has-popup:focus-visible{outline:2px solid currentColor;outline-offset:2px}";
  function potatoOn() { return !!(document.body && document.body.classList.contains("potato-mode")); }
  function applyPotato() {
    var on = false;
    try { on = (JSON.parse(localStorage.getItem("schoolagy_settings_options") || "{}") || {}).potatoMode === true; } catch (e) {}
    if (document.body) document.body.classList.toggle("potato-mode", on);
    if (!document.getElementById("potatoStyle")) {
      var st = document.createElement("style");
      st.id = "potatoStyle";
      st.textContent = POTATO_CSS;
      (document.head || document.documentElement).appendChild(st);
    }
    var EP = window.Element && Element.prototype;
    if (EP && !EP.__potatoPatched) {
      EP.__potatoPatched = true;
      var anim = EP.animate;
      if (anim) EP.animate = function (frames, opts) {
        if (potatoOn()) opts = (typeof opts === "number" || opts == null) ? { duration: 0 } : Object.assign({}, opts, { duration: 0, delay: 0, endDelay: 0, iterations: 1 });
        return anim.call(this, frames, opts);
      };
      var siv = EP.scrollIntoView;
      if (siv) EP.scrollIntoView = function (arg) {
        if (potatoOn() && arg && typeof arg === "object") arg = Object.assign({}, arg, { behavior: "auto" });
        return siv.call(this, arg);
      };
      ["scrollTo", "scrollBy"].forEach(function (name) {
        [EP, window].forEach(function (target) {
          var fn = target[name];
          if (!fn) return;
          target[name] = function (a, b) {
            if (potatoOn() && a && typeof a === "object") a = Object.assign({}, a, { behavior: "auto" });
            return b === undefined ? fn.call(this, a) : fn.call(this, a, b);
          };
        });
      });
    }
  }

  // Potato PC Mode (2026-10-04): applied here too, before first paint, so the
  // loading skeleton and every page start with animations already off.
  window.__averagesApplyTheme = function () { apply(); applyPotato(); };
  apply();
  applyPotato();
})();`;
