# Schoology Dashboard Extension

A browser extension that turns Schoology Grades into a clean homework
dashboard with a **GO / NO-GO** verdict — computed locally, on the
family's own machines. No server, no LLM, no Schoology password stored,
no Schoology API or OAuth.

## Safari first — why

**Many students use Safari (school Macs and iPhones), so the Safari version
is what matters most.** Chrome (Web Store, $5 one-time, Unlisted
listing) is second. The shared codebase is Safari-compatible from day
one: the `webextension-polyfill` with `browser.*` Promise APIs, a
bundled pure-JS HTML parser as the portable default, and no Chrome-only
APIs in the critical path (no `sidePanel`, no offscreen `DOM_PARSER`,
no `declarativeNetRequest`). Safari distribution is part of the build,
not a follow-up — see [docs/safari.md](docs/safari.md).

## What it does

- Reads the student's Schoology Grades pages using the user's existing
  logged-in browser session (cookies) — the extension never asks for a
  Schoology password.
- Shows each course's grade, each assignment's due date and score, and
  the teacher-marked **Missing** flag.
- Computes a GO / NO-GO verdict per student from deterministic,
  customizable rules (defaults, the shipped default rules): **75 passes**
  (below 75 is NO-GO); **NO-GO if 2+ items are Missing** (one Missing
  alone is GO). The badge states the reason: "NO-GO — Missing work",
  "NO-GO — Low grades", or both.
- Parent view: tabs per child with a GO/NO-GO verdict. Student view: just
  their own dashboard and what to finish first (GO/NO-GO is parents only).
- One settings page (saved automatically): account, family rules,
  display, privacy & data. Classes with no grades posted (advisory, house
  group) are left out automatically.
- "Demo data" button loads bundled fixture data so the extension works
  out of the box with zero setup.

## How it works

- **Auth:** the user's logged-in browser session cookies
  (`fetch(url, {credentials:'include'})` with host permission for
  `https://*.schoology.com/*`). No password, API key, or OAuth token is
  stored anywhere.
- **Missing flag:** read from the Grades **page** (orange hexagon /
  text "Missing"). The Schoology REST API's Grade object has no
  "missing" flag (exception is only excused/incomplete), and a plain
  numeric 0 is **never** treated as Missing. Ungraded + not-Missing is
  an in-between state, not a concern; To Do overdue flags are ignored.
- **Data path (in order):** (1) background service-worker fetch +
  bundled parser, (2) fetch+parse from the popup page, (3) hidden
  background tab + content script. All data is stored in
  `browser.storage.local` on the device; the service worker never holds
  grades only in memory (it terminates after ~30 s idle).
- **Parent accounts:** detected via `GET /iapi/parent/info` (child
  profiles + the session's `view_child`). Per child, the extension
  switches the viewed child (`/parent/home?child_uid=<uid>`, the same as
  picking the child in Schoology's menu), confirms the switch, and reads
  `/parent/grades_attendance/grades`, which lists all of that child's
  courses on one page. If the switch can't be confirmed, that child's
  verdict is **UNKNOWN**; grades are never attributed to the wrong child.

## Live-test status (2026-11-06)

**Verified on live Schoology (parent account, Chrome, read-only):**
Grades pages are **server-rendered**. A plain `fetch()` with the session
cookie returns the full grades table, including the Missing markers, so
no JS rendering is needed. The parser was run on every assignment row of
three students (526 rows, 0 unread, 0 warnings) and matched Schoology's
own Missing flags exactly, including a Missing item hidden inside a
collapsed earlier grading period. `/iapi/parent/overdue_submissions` was
checked and found **unreliable** as a Missing source, so it is not used.

**Still not verified:**
- The fetch from the extension's own **service worker** on
  schoology.com. It was verified from a logged-in page context (what a
  content script does), and against the mock server from the service
  worker in the e2e tests.
- Anything in **Safari** (macOS or iOS).
- The **student-account** flow (no student login was available).

See [`test/probe/LIVE-TEST-RESULTS.md`](test/probe/LIVE-TEST-RESULTS.md).

## Parser and markup

The parser (`extension/src/parser-core.js`) reads the live Schoology
Grades markup verified on 2026-11-06. Its header documents the structure.
The mock server renders that same markup from made-up data. The parser
self-checks: if a page has grade rows but nothing parses, it reports
`PARSE_EMPTY` ("could not read grades") instead of a green GO.

## Load unpacked

### Chrome

1. `npm run build` (or `npm run build:dev` for the mock-server build).
2. `chrome://extensions` → Developer mode on → Load unpacked →
   select `dist/`.

### Safari (development)

1. Build, then `node scripts/build-safari.mjs` (generates the Xcode
   project on a Mac; on Linux it writes `safari/convert.sh` — run that
   on a Mac with Xcode).
2. Quick loop, no Xcode project needed: Safari → Settings → Developer
   → **Allow Unsigned Extensions** (resets every Safari quit) → **Add
   Temporary Extension…** → pick the folder containing `manifest.json`.
   Or the Xcode loop: open the `.xcodeproj`, Product → Run, enable in
   Safari → Settings → Extensions.
3. **Grant page access separately** — enabling the extension is not the
   same as granting access. In Safari → Settings → Extensions, allow it
   on `schoology.com` (per-site / Always Allow), or the content script
   never runs.
4. Debug via Develop → Web Extension Background Pages.

Full Safari pipeline (TestFlight, App Store submission, $99/yr Apple
Developer Program, review timing): [docs/safari.md](docs/safari.md).
Chrome Web Store setup: [docs/chrome-web-store-setup.md](docs/chrome-web-store-setup.md).

## Demo mode

Open the popup and click **Demo data** — it loads the bundled fixture
snapshot (one student persona / a two-child parent persona in the mock
server) so you can see the dashboard with zero setup and no Schoology
login.

## Tests

```bash
npm ci            # install dependencies (never commit secrets)
npm run lint      # node --check on the extension sources
npm test          # unit tests (vitest): rules, classifier, parser, fetch layer
npm run test:e2e  # Playwright e2e against the mock Schoology server
npm run build     # production build -> dist/
npm run build:dev # dev build (localhost host permission for the mock server)
node scripts/build-safari.mjs   # Safari Xcode project (or safari/convert.sh on Linux)
```

CI (`.github/workflows/ci.yml`) runs lint, unit tests, both builds, and
e2e on every push/PR. Releases (`.github/workflows/release.yml`) run on
version tags (`v*`): Safari artifacts first, Chrome Web Store upload
second (skipped gracefully until the CWS secrets are configured).

## Project layout

| Path | What it is |
|---|---|
| `extension/` | The shared MV3 extension (manifest, background, content script, popup, options, `src/` rules/classifier/parser/fetch layer) |
| `scripts/build.mjs` | Main build (esbuild → `dist/`) |
| `scripts/build-safari.mjs` | Safari packager step (`safari/convert.sh` fallback on Linux) |
| `safari/` | Generated Xcode project + `convert.sh` + README |
| `test/mock-server/` | Mock Schoology server, live-markup renderer (port 8123) |
| `test/unit/` | Vitest unit tests |
| `test/e2e/` | Playwright e2e tests |
| `test/probe/` | Live-test probe extension + results (Safari first) |
| `site/` | Promo site (GitHub Pages, `.github/workflows/pages.yml`); plan in `docs/promo-site-plan.md`. Screenshots: `npm run build:dev && npm run site:screenshots` (on a Mac) |
| `docs/safari.md` | Safari distribution pipeline |
| `docs/chrome-web-store-setup.md` | Chrome Web Store setup |
| `SPEC.md` | Build contract between workstreams |

## License

MIT — see [LICENSE](LICENSE). Copyright 2026 Sabai Snoopy.
