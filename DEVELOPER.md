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

Then load `dist/` in Chrome (see below), open the toolbar popup and click
**Load demo data**. It loads made-up students, so you can see everything with
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
  the content script. Everything is stored in `browser.storage.local` on
  the device; the service worker never keeps grades only in memory.
- **Parent accounts** are detected with `GET /iapi/parent/info`. For each
  child the extension switches the viewed child (as Schoology's own menu
  does), confirms the switch, and reads that child's grades page. If the
  switch can't be confirmed, that child shows **UNKNOWN**, so grades are
  never shown under the wrong child.
- **GO / NO-GO** (parents only) uses simple rules you can change in
  Settings. Defaults: below 75% in a class, or 2+ Missing items, is NO-GO.
- **Parser self-check:** if a page has grade rows but nothing parses, the
  dashboard says it couldn't read the grades (`PARSE_EMPTY`) instead of
  showing a green GO. The parser's header (`extension/src/parser-core.js`)
  documents the live markup it reads.

## Load it in a browser

**Chrome or Edge:** `npm run build`, open `chrome://extensions`, turn on
Developer mode, click **Load unpacked** and choose `dist/`.

**Firefox:** `npm run build:firefox` (a dev build in `dist-firefox/`), then
`about:debugging` → This Firefox → **Load Temporary Add-on** → choose
`dist-firefox/manifest.json`.

**Safari (Mac):**

1. `node scripts/build-safari.mjs` builds `dist-safari/`. On a Mac with
   Xcode it also makes the Xcode project; otherwise it writes
   `safari/convert.sh` to run on one.
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
npm run build:firefox # Firefox dev build
npm run test:e2e      # Playwright e2e in Chromium and Firefox, against the mock Schoology server
npm run mock-server   # the mock Schoology server on its own (port 8123)
```

CI ([`ci.yml`](.github/workflows/ci.yml)) runs all of these on every push
and pull request. `main` requires the CI `test` check, and PRs auto-merge
once it passes.

Site screenshots: `npm run build:dev && npm run site:screenshots` (on a
Mac), then commit `site/img/`.

## Releasing

The version comes **only from the tag**. `extension/manifest.json` and
`package.json` stay at `0.0.0`; the build writes the real version into each
built manifest. To release, tag a commit on `main`:

```bash
git checkout main && git pull
git tag v1.4.0
git push origin v1.4.0
```

[`release.yml`](.github/workflows/release.yml) then:

1. Checks the tag is `vX.Y.Z` and on `main`.
2. Builds Chrome/Edge, Firefox and Safari ZIPs with that version.
3. Creates the GitHub Release (generated notes, ZIPs, checksums).
4. Redeploys the site so it shows the new version.
5. Runs the store uploads behind the `release` environment's approval gate.
   They skip until their secrets and upload steps exist.

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
| `test/e2e/` | Playwright end-to-end tests |
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

Not yet checked live: the fetch from the extension's own service worker,
Safari, and student accounts. Details:
[test/probe/LIVE-TEST-RESULTS.md](test/probe/LIVE-TEST-RESULTS.md).

## More docs

- [docs/safari.md](docs/safari.md): Safari packaging, testing and App Store
  submission
- [docs/chrome-web-store-setup.md](docs/chrome-web-store-setup.md): Chrome
  Web Store setup
- [docs/release-plan.md](docs/release-plan.md): releases and store
  publishing
- [docs/promo-site-plan.md](docs/promo-site-plan.md): the website
