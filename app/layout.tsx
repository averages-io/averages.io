import type { Metadata } from "next";

/**
 * Link previews (2026-10-07, Martin): what iMessage, Discord, Slack, Gmail
 * and so on show when someone shares an app.averages.io link. Every route
 * gets this card unless it sets its own (app/schools/apply/layout.tsx does).
 * The images live in public/ (og.png, og-schools.png), 1200 x 630.
 */
const TYPEKIT_CSS = "https://use.typekit.net/gsk6off.css";
const FONT_LOADER = `(function(){
  function load(){
    if (document.getElementById('avTypekit')) return;
    var l = document.createElement('link');
    l.id = 'avTypekit'; l.rel = 'stylesheet'; l.href = '${TYPEKIT_CSS}';
    if (document.body === null) l.setAttribute('blocking', 'render');
    document.head.appendChild(l);
  }
  window.__averagesLoadFonts = load;
  try {
    var o = JSON.parse(localStorage.getItem('schoolagy_settings_options') || '{}') || {};
    if (o.potatoMode === true) return;
  } catch (e) {}
  load();
})();`;

const DESCRIPTION = "Because schoolwork should be simple. Grades, assignments and class files in one place.";

export const metadata: Metadata = {
  metadataBase: new URL("https://app.averages.io"),
  // No `title` on purpose (2026-10-07): each page sets its own tab title
  // (LegacyPage's document.title). A metadata title is a React-managed
  // <title> that wins over that and sticks across client navigation, which
  // showed one page's title on every page. Link previews use og:title.
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "Averages.io",
    title: "Averages.io",
    description: DESCRIPTION,
    // No url here: it would be inherited by every page, so a shared /grades
    // link would claim to be the sign-in page. Without it the link is its own.
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Averages.io: Do school, your way. The Averages.io home page with grades and assignments." }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Averages.io",
    description: DESCRIPTION,
    images: ["/og.png"],
  },
};

/**
 * Deliberately minimal: every route under app/ is a ported legacy page
 * (see components/LegacyPage.tsx) that already brings its own full-page
 * CSS reset and layout. This shell exists only because Next.js requires
 * exactly one root <html>/<body> — it must not add any styling of its own
 * that could leak into pages that don't expect it.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Puffin, via Adobe Fonts. Every page's CSS asks for
          `font-family: "puffin", ...`, but the stylesheet that actually
          DEFINES that face lives in a <link> in each source page's <head> —
          and the port script only extracts <style>, <body> and <script>. So
          without this line the whole app silently falls back to system sans
          and none of the type looks right.

          It sits here rather than per-page on purpose: one <link> for the
          whole app means the font is fetched once and is warm in cache for
          every subsequent route.
        */}
        {/*
          Potato PC mode (2026-10-09, Martin: on a Chromebook most of the load
          was fetching the font from Adobe). Potato mode already draws every
          page in the system font, so with it on the Adobe stylesheet isn't
          requested at all. Otherwise it loads as before, still holding the
          first paint (blocking="render") so Puffin doesn't flash in late.
          window.__averagesLoadFonts() adds it later, when Potato mode is
          turned off in Settings. <noscript> keeps the font without scripts.
        */}
        <script dangerouslySetInnerHTML={{ __html: FONT_LOADER }} />
        <noscript>
          <link rel="stylesheet" href={TYPEKIT_CSS} />
        </noscript>
        {/*
          Feature switches (2026-10-09): hides what's switched off and shows
          the maintenance banner (public/js/averages-features.js). Plain and
          early on purpose, so a switched-off button never flashes. It sets
          data-feature-off on <html>, hence suppressHydrationWarning there.
        */}
        <script src="/js/averages-features.js" />
        {/* File type icons (2026-10-09): AveragesFileIcons, used by Files, the assignment page and course materials. */}
        <script src="/js/averages-file-icons.js" />
      </head>
      {/*
        No inline style on <body>, deliberately.

        It previously carried style={{ margin: 0, padding: 0 }} as a reset —
        but an inline style beats a stylesheet rule, so that silently
        overrode every page's own `body { padding: 40px 24px 100px }`. The
        visible effect was content jammed against the top of the window and
        running underneath the fixed bottom nav, on every page.

        The reset isn't needed anyway: all 15 pages set `margin: 0` on
        html/body themselves (verified), so letting their CSS own the body box
        is both correct and less code.
      */}
      {/*
        The theme boot script is NOT here, deliberately.

        It was, briefly, on 2026-09-16 — which is the earliest point in the
        document and therefore the obvious place for a no-flash script. But
        this layout wraps every route identically and has no idea which page
        it is rendering, so from here it also applied the saved wallpaper to
        the Login screen: sign out, and you landed on a login page still
        wearing the theme of the account you had just left.

        It now renders as the first thing in LegacyPage's own output, gated on
        that page's `usesSavedTheme`. Still inside <body>, still synchronous,
        still ahead of the page's CSS and markup — so it still lands in the
        first painted frame — but only on the pages that should wear it.
      */}
      <body>{children}</body>
    </html>
  );
}
