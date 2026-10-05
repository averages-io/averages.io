# Developing Averages.io

Technical notes for working on the app. For what Averages.io is and how to get
help, see the [README](README.md).

The app pairs with a separate API Worker, which does the OAuth-signed requests to
the school platform. This app never sees a platform secret.

## How this repo is put together

The 15 app screens live in **`pages-src/*.html`** as self-contained HTML/CSS/JS
documents, the same format they've always been in, and still the source of
truth. `scripts/port-pages.mjs` turns each one into a Next.js route at build
time.

```
pages-src/login.html      ->  /            (app/page.tsx)
pages-src/onboarding.html ->  /onboard     (app/onboard/page.tsx)
pages-src/home.html       ->  /home        (app/home/page.tsx)
...
pages-src/404.html        ->  app/not-found.tsx
```

**Edit the HTML, not the generated TSX.** Everything under `app/*/page.tsx` is a
build artifact and is gitignored: it is regenerated on every build, so any edit there
is lost.

### Why not rewrite the pages as React components?

Each page is already built, tested, and documented in detail (see the project's
`architecture-decisions.md`), with its own globals, element ids and inline
script. Rewriting them idiomatically would risk regressing a lot of carefully
tuned behavior and buy nothing the user would notice. So instead each page's
style/markup/script is extracted and injected as-is, and the interesting wiring
happens around it.

## Commands

```bash
npm install
npm run dev      # port the pages, then next dev
npm run build    # port + verify + next build   (this is what Cloudflare runs)
npm run port     # regenerate routes from pages-src/
npm run verify   # parse every generated page and assert the wiring is intact
```

`npm run verify` runs automatically as part of `build`. It re-parses the
JavaScript embedded in every generated page and checks that each feature
actually got wired. If a source page changes shape enough to break a transform,
**the build fails** rather than quietly shipping an app whose NSFW filter or
live-data wiring silently does nothing.

## The three modes

| Mode | How you get there | What renders |
|---|---|---|
| **live** | Sign in with a personal API key from your school's learning platform | The student's real courses, grades, assignments |
| **demo** | Sign in with `demo` as **both** the key and the secret | Every page, fully usable, on built-in sample data |
| signed-out | Neither | App pages bounce to the login screen |

Demo mode is the beta-testing path: a tester with no school account gets the
whole app, not a cut-down demo. Same pages, same interactions; only the data
source differs. A "Demo · sample data" badge marks it; closing that badge, or
Sign out, returns to the login screen.

### The server decides, not the browser

Demo mode is a **real sign-in**: the API accepts `demo`/`demo` and issues the
same kind of httpOnly session cookie a live login gets. Every page then asks
`/auth/me` who you are before it renders anything.

That's deliberate. An earlier version kept the mode in `localStorage` and let
Escape on the login screen set it, which meant anyone could reach any page by
editing browser storage or typing a URL, and pages flashed their content before
the redirect caught up. There is now no keyboard shortcut, no local flag to
forge, and no paint of a protected page for a signed-out visitor.

### How live data reaches the pages

Each page keeps its sample data as a literal, and the port script rewrites the
declaration to prefer live data when it exists:

```js
const COURSES = (window.__SCHOOLAGY__ && window.__SCHOOLAGY__.data.COURSES) || [ ...sample... ];
```

`LegacyPage` fetches `/data/bundle` from the API and populates
`window.__SCHOOLAGY__` **before** injecting the page script, so the page reads
real data on its first synchronous pass. Anything the backend doesn't supply
falls through to the sample literal, which is why mock mode and partially-mapped
feeds both keep working.

## Image screening (NSFW)

Profile photos and wallpapers are screened in the browser with
[NSFWJS](https://github.com/infinitered/nsfwjs) before they're accepted.

The model is **self-hosted** from `public/models/mobilenet_v2/` rather than
loaded from a CDN, because NSFWJS's own README warns the hosted model has been moved
because of hotlinkers, so depending on it would mean the filter silently stops
working one day.

- The scan runs entirely on the user's device. The image is never uploaded
  anywhere to be checked.
- After the first load the model is cached in IndexedDB, so later uploads are
  fast.
- TensorFlow.js and the model are only loaded on the two pages that can actually
  upload (onboarding, settings), and only after the page is interactive.
- **Fails closed:** an image that couldn't be screened is refused, not waved
  through. Otherwise breaking the model load would be a bypass.
- Thresholds live at the top of `app/lib/nsfw.ts`. `Sexy` intentionally has a
  much higher bar than `Porn`/`Hentai`, because NSFWJS applies it to swimwear
  and ordinary beach photos.

Onboarding and Settings already shipped the whole upload gate (consent pane,
scanning pane, error pane), with the scan itself stubbed as a fixed delay. The
build replaces that stub with the real check, so the screening appears inside
the UI that was already designed for it.

**Known limitation:** profile photos may be animated GIFs, and only the first
frame is classified (an `<img>` exposes nothing else to the model). A GIF whose
later frames differ would pass on the strength of frame one. Fixing that
properly means screening server-side on upload, not pretending this covers it.
