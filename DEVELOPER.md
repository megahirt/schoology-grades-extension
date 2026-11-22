# Developer guide

Everything you need to build, test and release the extension. For what it
is and who it's for, see the [README](README.md).

- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [Load it in a browser](#load-it-in-a-browser)
- [Tests](#tests)
- [Releasing](#releasing)
- [Project layout](#project-layout)
- [Live-test status](#live-test-status)
- [More docs](#more-docs)

## Quick start

```bash
npm ci              # install dependencies (never commit secrets)
npm run build       # production build -> dist/
npm test            # unit tests
```

Then load `dist/` in Chrome (see below), click the toolbar button, then
**See a demo** and **Show demo data**. It loads made-up students, so you can see everything with
no Schoology login.

## How it works

- **No server.** It reads Schoology pages with the user's own signed-in
  browser session (`fetch(url, { credentials: 'include' })`). No password,
  API key or OAuth token is stored. No Schoology API.
- **Safari first.** Many students use Safari on school Macs and iPhones.
  The code uses `webextension-polyfill` (`browser.*` promises), a bundled
  pure-JS HTML parser, and no Chrome-only APIs (`sidePanel`, offscreen
  documents, `declarativeNetRequest`).
- **Missing work** comes from Schoology's own Missing marker on the Grades
  page. A plain 0 is never treated as Missing.
- **Data path, in order:** (1) a background fetch + the bundled parser,
  (2) the same from the dashboard page, (3) a hidden background tab with
  the content script. If Schoology answers the background as signed out
  while a Schoology tab is open, the same reads go through that tab
  (`extension/src/page-fetch.js`): Safari sends the background's requests
  without the sign-in. Everything is stored in `browser.storage.local` on
  the device; the service worker never keeps grades only in memory.
- **Parent accounts** are detected with `GET /iapi/parent/info`. For each
  child the extension switches the viewed child (as Schoology's own menu
  does), confirms the switch, and reads that child's grades page. If the
  switch can't be confirmed, that child shows **UNKNOWN**, so grades are
  never shown under the wrong child.
- **GO / NO-GO** (parents only) uses simple rules you can change in
  Settings. Defaults: below 75% in a class, or 2+ Missing items, is NO-GO.
- **Demo mode** (`extension/src/demo-mode.js`): while nothing is saved,
  Settings → Privacy & data (and the dashboard page) offer **Show demo
  data**. It fills every Schoology site with made-up students, and the
  background reads nothing from Schoology until **Exit demo mode** in the
  link at the bottom, which clears everything.
- **Parser self-check:** if a page has grade rows but nothing parses, the
  dashboard says it couldn't read the grades (`PARSE_EMPTY`) instead of
  showing a green GO. The parser's header (`extension/src/parser-core.js`)
  documents the live markup it reads.

## Load it in a browser

**Chrome or Edge:** `npm run build`, open `chrome://extensions`, turn on
Developer mode, click **Load unpacked** and choose `dist/`.

**Firefox:** `npm run firefox` builds the dev version (`dist-firefox/`) and
opens Firefox with it loaded, through Mozilla's `web-ext`. It uses its own
profile in `.firefox-profile/`, so you sign in to Schoology there once.
While it runs, every `npm run build:firefox` reloads the extension in that
window (press R in its terminal to reload by hand). By hand instead:
`npm run build:firefox`, then `about:debugging` → This Firefox → **Load
Temporary Add-on** → choose `dist-firefox/manifest.json`.

**Safari (Mac):**

1. `node scripts/build-safari.mjs` builds `dist-safari/`. On a Mac with
   Xcode it also makes the Xcode project; otherwise it writes
   `safari/convert.sh` to run on one. Set `APPLE_TEAM_ID` to sign both
   targets with your Apple team (or pick the Team on each target in Xcode
   after every run), and `BUILD_NUMBER` for an upload to Apple.
2. Quick loop with no Xcode: Safari → Settings → Developer → **Allow
   Unsigned Extensions** (resets when Safari quits) → **Add Temporary
   Extension…** → choose `dist-safari/`.
3. **Then allow it on Schoology.** Turning the extension on isn't the same
   as giving it access: in Safari → Settings → Extensions, allow it on
   `schoology.com`, or it never runs.
4. Debug with Develop → Web Extension Background Pages.

Full Safari pipeline (TestFlight, App Store, review):
[docs/safari.md](docs/safari.md).

## Tests

```bash
npm run lint          # node --check on the extension sources
npm test              # unit tests (vitest)
npm run build:dev     # dev build: localhost permission for the mock server
npm run build:firefox # Firefox dev build (reloads a running `npm run firefox`)
npm run chromium      # Chromium window with the dev build, on real Schoology
npm run firefox       # Firefox window with the dev build; reloads on every Firefox build
npm run build:web     # web build (dist-web/) for the feature suite
npm run test:web      # feature suite on the web build, in Chrome
npm run test:safari   # the same in Safari (macOS); quits a Safari you started
npm run test:web:firefox   # the same in Firefox (CI runs it)
npm run test:e2e      # Playwright: extension wiring in Chromium and Firefox
npm run mock-server   # the mock Schoology server on its own (port 8123)
```

All of them run against the mock Schoology server. The features are tested
once, on the web build, in Safari, Chrome and Firefox; Playwright keeps a
few tests of the real extension's wiring. Details: [test/README.md](test/README.md).

CI ([`ci.yml`](.github/workflows/ci.yml)) runs the lint, builds and tests
on every push and pull request: job `test` on Linux (Chromium, Chrome and
Firefox), job `safari` on macOS (the feature suite in Safari). `main`
requires the CI `test` and `safari` checks, and PRs auto-merge once both pass.

Site screenshots: `npm run build:dev && npm run site:screenshots` (on a
Mac), then commit `site/img/`.

## Releasing

The version comes **only from the tag**. `extension/manifest.json` and
`package.json` stay at `0.0.0`; the build writes the real version into each
built manifest.

**Release notes come first.** Write the version's section in
[`RELEASE_NOTES.md`](RELEASE_NOTES.md) and commit it on `main` before
tagging: a list of what's new (✨ New) and what's fixed (🛠️ Fixed), one line
per item, each starting with an emoji, worded for families (no PR numbers or
developer terms). A picture of a button can go inline,
`![Print button](docs/release-notes/print-button.png)`; button pictures are
made by `npm run site:screenshots`. That one section becomes:

- the **What's new** note the extension shows once after it updates (in every
  browser; the build bundles it, [`scripts/release-notes.mjs`](scripts/release-notes.mjs));
- Safari's **What's New** in the App Store and Firefox's **release notes** on AMO
  (plain text);
- the top of the **GitHub Release**, followed by GitHub's list of merged PRs.

Chrome and Edge have no per-version notes on their store pages; the What's
new note in the extension covers them. A tag without notes for its version
stops at the first step, and a release build without them fails.

Then tag the commit on `main`:

```bash
git checkout main && git pull
git tag v1.4.0
git push origin v1.4.0
```

[`release.yml`](.github/workflows/release.yml) then:

1. Checks the tag is `vX.Y.Z`, on `main`, and that `RELEASE_NOTES.md` has
   its section.
2. Builds Chrome/Edge, Firefox and Safari ZIPs with that version, plus a
   ZIP of the source. On macOS it also compiles the Mac and iOS apps
   unsigned, so a broken Safari build stops the release before any approval.
3. Creates the GitHub Release (the release notes, ZIPs, checksums and the
   merged PRs).
4. Redeploys the site so it shows the new version.
5. Runs the store uploads behind the `release` environment's approval gate.
   They skip until their secrets and upload steps exist. Chrome is
   submitted for review and goes live once Google approves it. Firefox is
   the same: approving its job sends the version live once Mozilla approves
   it ([docs/firefox-amo-setup.md](docs/firefox-amo-setup.md)). Safari too:
   a macOS runner builds, signs and uploads the Mac and iOS apps and
   submits them for review, and they are released once Apple approves
   them ([docs/safari.md](docs/safari.md)). Edge gets a
   draft that waits for the owner's Publish click in Partner Center
   ([docs/edge-add-ons-setup.md](docs/edge-add-ons-setup.md)).

**One review at a time.** Before tagging, check that no store is still
busy with the last version (in review, or approved and not out yet):

```bash
gh workflow run store-status.yml --ref main
```

It reports each store and goes red while one is busy. It never cancels a
review: the next release waits for it. The release workflow runs the same
check ([`scripts/store-status.mjs`](scripts/store-status.mjs)) as its
`stores` job, before the GitHub Release or any upload, so a tag pushed too
early stops there; re-run its failed jobs once the review is done. Edge's API
can't report reviews, so check Partner Center before clicking Publish. The
check uses the `release` environment's keys, so each run waits for
approval, and that environment must allow `main` as well as `v*` tags.

Local builds use the newest `vX.Y.Z` tag, or `0.0.0` if there is none. Set
`RELEASE_VERSION=1.4.0` to override. The full plan, including stores,
secrets and phases, is in [docs/release-plan.md](docs/release-plan.md).

## Project layout

| Path | What it is |
|---|---|
| `extension/` | The shared MV3 extension: manifest, background, content script, popup, options, and `src/` (rules, parser, fetch layer, dashboard) |
| `scripts/build.mjs` | Main build (esbuild → `dist/`, `dist-firefox/`, `dist-safari/`) |
| `scripts/build-safari.mjs` | Safari packager step (`safari/convert.sh` when there's no Xcode) |
| `safari/` | Safari project output, `convert.sh` and notes |
| `site/` | The website (GitHub Pages, [`pages.yml`](.github/workflows/pages.yml)); plan in [docs/promo-site-plan.md](docs/promo-site-plan.md) |
| `test/unit/` | Vitest unit tests |
| `test/web/` | Feature suite: the web build in Safari, Chrome and Firefox (webdriverio) |
| `test/web-harness/` | In-page stand-in for the extension APIs, used only by the web build |
| `test/e2e/` | Playwright tests of the real extension's wiring |
| `test/safari/` | Manual check of the real extension in Safari |
| `test/mock-server/` | Mock Schoology server with live-style markup and made-up data |
| `test/probe/` | Live-test probe extension and results |
| `SPEC.md` | The original build spec |

## Live-test status

Checked on live Schoology on 2026-11-06 (parent account, Chrome,
read-only):

- Grades pages are server-rendered, so a plain `fetch()` with the session
  returns everything, including the Missing markers.
- The parser read every row for three students (526 rows, none missed, no
  warnings) and matched Schoology's Missing flags exactly.
- `/iapi/parent/overdue_submissions` turned out unreliable for Missing
  work, so it isn't used.
- Overdue (2026-11-21): work that is past due with no grade and nothing
  submitted gets its own assignment page read during a refresh
  (`src/assignment-page.js`). No Submissions box (classic page) or
  `"hasSubmissionsEnabled":false` (newer page) means it can't be submitted
  online, so it isn't Overdue; a box listing turned-in work counts as
  submitted. Tests and pages it doesn't recognize stay Overdue. "Can't be
  submitted" is remembered per assignment for a week (`noSubmissions`).

Not yet checked live: the fetch from the extension's own service worker,
Safari, and student accounts. Details:
[test/probe/LIVE-TEST-RESULTS.md](test/probe/LIVE-TEST-RESULTS.md).

## More docs

- [docs/safari.md](docs/safari.md): Safari packaging, testing and App Store
  submission
- [docs/chrome-web-store-setup.md](docs/chrome-web-store-setup.md): Chrome
  Web Store setup
- [docs/edge-add-ons-setup.md](docs/edge-add-ons-setup.md): Edge Add-ons
  setup
- [docs/firefox-amo-setup.md](docs/firefox-amo-setup.md): Firefox Add-ons
  (AMO) setup
- [docs/release-plan.md](docs/release-plan.md): releases and store
  publishing
- [docs/promo-site-plan.md](docs/promo-site-plan.md): the website
