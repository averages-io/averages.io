# averages.api

The API behind [Averages.io](https://averages.io), a student-built companion app for your
school's learning platform. It is a Cloudflare Worker written in TypeScript with
[Hono](https://hono.dev).

The app never talks to Schoology directly. Every Schoology request has to be signed
with OAuth, and the secret that signs it can never be handed to browser code. So the
browser talks to this Worker, and only this Worker talks to Schoology.

> **Naming:** the product is Averages.io. The Worker is `averages-api` and answers on
> `api.averages.io`, for the app at `app.averages.io` (moved from `schoolagy.io` on
> 2026-10-05). Everything else was renamed to Averages on 2026-10-05, except the
> session cookie (`schoolagy_session`) and the app's storage keys (`schoolagy_*`). Don't
> rename those, or existing users lose their sessions and settings.

---

## What it does today

| Part | Status |
|---|---|
| Sign in with a personal Schoology API key | Live |
| Demo account (`demo` / `demo`) | Live |
| `/data/bundle`: courses, grades, assignments and messages, already shaped for the app | Live |
| Sync Across Devices | Live, stored only in the US (one Durable Object per student) |
| Sign in through Schoology's App Center ("appAuth") | Planned, needed before public launch |
| Google Classroom | Planned. OAuth client is set up; no code yet |
| Canva: connect, Edit in Canva, Drafts, designs list | Built (2026-10-05), stored only in the US. Canva approved the integration (2026-10-05), so any student can connect |
| Assignment details and attachment downloads | Built (2026-10-05) |
| Course files (`/data/files`): every class's Materials documents and assignment attachments | Built (2026-10-05) |
| Google Drive and OneDrive | Built (2026-10-05), entirely in the student's browser; the Worker only serves public app IDs |
| Rate limiting | Planned |

## How sign-in works

**Today: personal API keys.** A student creates their own key and secret on their
school's Schoology `/api` page and signs in with them. The Worker checks them by
calling Schoology as that student, so a typo fails at the login screen instead of
producing an empty app. Requests use two-legged OAuth 1.0a: the key and the account
are the same person, so no admin or App Center approval is involved. Schoology
expires these keys after 90 days.

**Next: appAuth.** Students sign in on Schoology's own page and approve Averages.io,
instead of pasting a key. `oauth.ts` already accepts a token and token secret so the
signing code carries over unchanged.

## Sessions

After sign-in the Worker seals `{key, secret, uid}` with AES-GCM using
`SESSION_SECRET` and sends it back as a cookie:

- **httpOnly:** no JavaScript, including the app's own, can read it.
- **Secure, SameSite=Lax**, on `.averages.io`, valid for 30 days.
- **Sealed:** the token is unreadable and can't be edited even if it leaks.

The Worker keeps no copy. The tradeoff is that a session can't be cancelled early
from the server; it lasts until it expires or the student signs out.

## What gets stored

- **Grades and schoolwork are never stored.** They pass through the Worker to the
  browser on each request.
- **Sync Across Devices** (off by default) stores one record per student, keyed by
  their Schoology user ID: their Averages.io settings (name, photo, background,
  colors, course nicknames) and, only if the Weekly Grade Summary email is also on,
  at most two Projected GPA numbers (this week's and last week's). Turning sync off
  deletes the record. Each student's record lives in their own Durable Object,
  created in Cloudflare's `us` jurisdiction, so it is stored and handled only in
  the United States. (It used Workers KV until 2026-10-04; KV copies data
  worldwide, so it was replaced.)
- **Canva** (only if the student connects it): their Canva access and refresh
  tokens, encrypted with a key derived from `SESSION_SECRET` and tied to their
  user ID; their Canva display name; their Drafts list (which assignment file
  became which Canva design); and, for a day at most, where to send them back
  when they click Return in Canva. One Durable Object per student, in the `us`
  jurisdiction, separate from Sync (turning Sync off doesn't disconnect Canva).
  Disconnect deletes all of it. Their designs live in their own Canva account;
  attachment files pass through the Worker on their way to Canva and aren't kept.
- **Google Drive and OneDrive: nothing.** Both connect straight from the
  student's browser to Google or Microsoft. Their tokens stay in that browser tab
  and never reach this Worker; the Worker only serves the public app IDs
  (`/config/cloud`) and the assignment files being copied (`/data/attachment`).
- **Nothing else.** No analytics, no tracking, no ads.

## Endpoints

| Method | Path | Sign-in | What it does |
|---|---|---|---|
| `GET` | `/` | | Health and setup check. Says whether `SESSION_SECRET` reaches the running Worker, never any part of it |
| `POST` | `/auth/session` | | Sign in with `{key, secret}`; sets the session cookie |
| `DELETE` | `/auth/session` | | Sign out; clears the cookie |
| `GET` | `/auth/me` | yes | The signed-in student |
| `GET` | `/data/bundle` | yes | Everything the app's pages show, in one call |
| `GET` | `/sync/settings` | yes | Read the synced settings |
| `PUT` | `/sync/settings` | yes | Save the synced settings (2 MB max) |
| `DELETE` | `/sync/settings` | yes | Delete everything sync stored |
| `GET` | `/data/assignment?section=&id=` | yes | One assignment's description and attachments (file ids and names only, never download links) |
| `GET` | `/data/attachment?section=&assignment=&file=` | yes | Download one attachment, streamed from Schoology. `document=` instead of `assignment=` for a file a teacher posted in Materials |
| `GET` | `/data/files` | yes | Every file in the student's classes (Materials documents and assignment attachments): ids, names, class, newest first, `partial: true` if a class didn't answer. No download paths |
| `GET` | `/canva/status` | yes | Whether Canva is set up and connected, and the account name |
| `GET` | `/canva/connect?return_to=` | yes | Starts connecting Canva (browser navigation) |
| `GET` | `/canva/callback` | yes | Where Canva sends the student back after they allow access |
| `DELETE` | `/canva/connection` | yes | Disconnect: forgets the tokens and drafts |
| `POST` | `/canva/edit` | yes | `{section, assignment, fileId, returnTo}`: imports that attachment into the student's Canva, adds a draft, answers with the editor link |
| `GET` | `/canva/return` | yes | Where Canva's Return button lands; sends the student back to the page they came from |
| `GET` | `/canva/drafts?section=&assignment=` | yes | That assignment's drafts |
| `DELETE` | `/canva/drafts/:id` | yes | Removes a draft from Averages.io (the design stays in Canva) |
| `POST` | `/canva/designs/:id/open` | yes | A fresh editor link with a Return key |
| `GET` | `/canva/designs` | yes | The student's Canva designs, newest first, 50 a page |
| `GET` | `/config/cloud` | | Public IDs the app needs to connect Google Drive and OneDrive in the browser (`null` for anything not set up) |

Demo sessions get `403 not_available_in_demo` on the sync, assignment and Canva routes.

`/data/bundle` is one call on purpose: Schoology is slow and rate-limited, and
sections, grades and assignments depend on each other. Every Schoology call gives up
after 20 seconds.

**There is no general Schoology passthrough.** An earlier `GET /schoology/*` route
could relay any read from a student's account and was removed on 2026-09-15. Each new
feature gets its own route with its own fixed Schoology calls.

## Security notes

- **CORS** only allows `https://app.averages.io` and `https://averages.io`.
  `http://localhost:3000` is allowed only when the Worker itself is running locally.
- **No secrets in the repo.** Everything secret is a Cloudflare secret (below).
- **Attachments:** the browser only ever sends ids. The Worker looks the file up on
  that student's own assignment (or Materials document), signs the request only for `api.schoology.com`,
  follows Schoology's redirect to its file storage itself (https only, without the
  signature), and refuses files over 25 MB for Canva.
- **Canva:** PKCE with the state kept in the student's own Durable Object and used
  once; tokens encrypted at rest; refreshes can't race (one object per student);
  the Return JWT's Ed25519 signature, audience, type and expiry are checked; every
  redirect goes to a fixed app origin plus a checked path. POSTs must be JSON from an
  allowed Origin, so another page can't trigger them.
- **`/config/cloud`** only serves values that look like the public ID they're
  meant to be (a Google client ID, an `AIza…` API key, a project number, a
  Microsoft GUID). If a secret were ever pasted into one of those boxes, it's left
  out instead of published.
- **Found a security problem?** Please email help@averages.io instead of opening a
  public issue.

## Configuration

**Secrets** (Worker → Settings → Variables and Secrets, type *Secret*, or
`npx wrangler secret put NAME`):

| Name | Used for |
|---|---|
| `SESSION_SECRET` | Seals session cookies. Required: without it sign-in returns 500 on purpose |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Classroom sign-in (planned) |
| `CANVA_CLIENT_ID`, `CANVA_CLIENT_SECRET` | Canva Connect app credentials (Developer Portal). Without them Canva reports "not set up" |
| `GOOGLE_PICKER_API_KEY` | Google Cloud API key for "Add from Google Drive". **Must** be restricted to `https://app.averages.io/*` and the Google Picker API: it's served publicly, and `/config/cloud` can't tell a restricted key from an unrestricted one |
| `GOOGLE_PROJECT_NUMBER` | Optional. The Google Cloud project number the Picker needs; without it, the number at the start of `GOOGLE_CLIENT_ID` is used |

Make a `SESSION_SECRET` with:
`node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"`

**Variables** (in `wrangler.jsonc`, not secret):

| Name | Value |
|---|---|
| `GOOGLE_REDIRECT_URI` | `https://api.averages.io/auth/google/callback` |
| `CANVA_REDIRECT_URI` | `https://api.averages.io/canva/callback` |
| `MS_CLIENT_ID` | The Microsoft Entra app's Application (client) ID, for OneDrive. A public ID, no client secret (it's a single-page app registration) |
| `GOOGLE_DRIVE_CLIENT_ID` | Optional. A separate Google OAuth client (same Google Cloud project) used only for Google Drive in the browser; its only setting is the JavaScript origin `https://app.averages.io`. Without it, Google Drive uses `GOOGLE_CLIENT_ID` |

Values entered under **Build** variables don't reach the running Worker. Use the
runtime ones. If sign-in returns 500, open `/` on the Worker: it says whether
`SESSION_SECRET` is set.

**Local development:** put the same names in a `.dev.vars` file (already in
`.gitignore`) and point the redirect addresses at `http://localhost:8787/...`.
Cloudflare's local runtime can't pin Durable Objects to the US, so on
`localhost` (and only there) sync storage is opened without the `us` setting.

## Development

```bash
npm install
npm test          # OAuth signing, sessions, data adapters, sync, Canva, cloud config, course files
npm run dev       # local Worker on http://localhost:8787
```

Cloudflare Workers Builds deploys `main` automatically: `npm run build`
(a TypeScript check) and then `npx wrangler deploy`.

## Tests

No test framework and no build step: the modules run directly under Node's
TypeScript support.

- **OAuth signing** is checked against the published OAuth 1.0 test vector
  (RFC 5849, Appendix A.5.1), base string and signature. A wrong signature shows up
  from Schoology as a bare `401` with no explanation, so it's pinned to a known-good
  answer.
- **Sessions:** the Schoology secret can't be read out of a token, edited or
  wrong-key tokens are rejected, and expired ones fail.
- **Adapters** run against realistic Schoology responses, including its quirks:
  single results sent as a bare object instead of a list, two timestamp formats, and
  excused work that must not pull a grade trend down.
- **Sync:** records stay separate per student, the GPA snapshot never holds more
  than two numbers, and the weekly email switch is read correctly.
- **Canva:** PKCE against the RFC 7636 test vector, forged and reused states
  (including names like `constructor`), sealed tokens that only open for their own
  student, one refresh for many simultaneous requests, Disconnect beating a refresh
  in flight, Return JWTs (bad signature, audience, type, expiry, unknown key), import
  polling and Canva's error codes, and attachment downloads (no signature sent off
  Schoology, size cap, no http redirects).
- **Course files:** both of Schoology's attachment shapes, extensions kept on names,
  non-numeric ids skipped, no download paths in the answer, the 1,000-file cap, and
  `partial` when a class didn't answer.
- **Cloud config:** `/config/cloud` serves IDs in the right shapes and leaves out
  anything that looks like a secret pasted into the wrong box.

The keys and secrets in the test files are the public example values from the
OAuth spec and made-up strings, not real credentials.

---

## License

**GNU General Public License v3.0.** See [LICENSE](LICENSE).

You're free to use, study, change and share this code. If you give out a changed
version, you have to share its source under the same license.

## Trademarks and affiliation

Averages.io is an independent app made by a student. It is **not affiliated with,
endorsed by, or sponsored by PowerSchool, Schoology, Google or Canva.** Schoology is
a trademark of PowerSchool Group LLC; Google Classroom is a trademark of Google LLC;
Canva is a trademark of Canva Pty Ltd. They are named here only to describe the
services this code connects to.

The license covers the code, not the Averages.io name, logo or look. Forks are
welcome under their own name.
