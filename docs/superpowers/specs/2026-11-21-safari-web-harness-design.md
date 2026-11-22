# One feature test suite for Safari, Chrome and Firefox (web-app build) — design

Date: 2026-11-21. Status: draft for Chris's approval (builder check done).

## Why

Safari is the extension's first target (many students use it), but today it
is only checked by hand. Playwright can't drive Safari, and Safari's own
WebDriver (`safaridriver`) can't install an extension. A temporary extension
works locally only after manual clicks in Safari Settings, and needs
re-adding after every build (see `test/README.md`, "Safari"). Chris wants
**fully automated** Safari coverage of the extension's features, run on
every change, in **real Safari**, locally and in GitHub Actions. If that is
impossible as an extension, a plain web-app version is fine.

## Goals

- Run the extension's own UI and logic code, unchanged, as a web app in real
  Safari, against the mock Schoology server.
- Cover the features the Chromium/Firefox e2e suite covers, wherever they
  don't depend on extension-only APIs.
- **Each scenario written once** (decided by Chris): one feature suite runs
  in Safari, Chrome and Firefox. No scenario exists in two test tools.
- No clicks or settings changes: `npm run test:safari` locally (with
  "Allow remote automation" on, already true on Chris's Mac), and a CI job
  on a GitHub `macos-26` runner (free: the repo is public).

## Non-goals

- Testing extension plumbing in Safari: permissions, content-script
  registration, the background service worker's cookies, the toolbar
  popup's extension behavior. The existing manual smoke test
  (`test/safari/smoke.safari.mjs`) stays for that.
- Playwright's WebKit. It is not Safari (see the conversation of
  2026-11-21), and running the real thing is free.
- Shipping the web app to anyone. It is a test build only, never published.

## Anti-goals

- Changing product code to suit the tests, beyond tiny seams. The point is
  to test the code that ships. If product code needs `if (web)` branches,
  the approach has failed.
- A second copy of the UI. The web build bundles the same source files.
- Flaky tests. Real Safari has one automation window at a time; tests run
  one after another.
- Duplicated tests: the same scenario kept in both Playwright and
  webdriverio.
- Losing coverage during the move: nothing is deleted from the Playwright
  spec until the new suite covers it in Chrome and Firefox.

## Approaches considered

1. **Extension in Safari, automated** (loading via UI scripting of Safari
   Settings on CI). Possible in theory: the runner image gives `osascript`
   Accessibility rights. But it is untested, may hit a password prompt
   ("Allow unsigned extensions"), and is brittle against Safari UI changes.
   Kept only as the manual smoke test.
2. **Web-app build, tests in Playwright WebKit.** Cheap and reuses the
   Playwright style, but it is not Safari. Rejected by Chris.
3. **Web-app build, Safari-only webdriverio suite next to the Playwright
   suite.** Real Safari, but every feature scenario would exist twice.
   Rejected by Chris for the duplication.
4. **Scenarios written once against a small helper API, with a Playwright
   adapter and a webdriverio adapter.** Less churn, but the two tools'
   waiting models differ, so the adapter layer becomes its own thing to
   maintain and every test is limited to what both share.
5. **One webdriverio feature suite on the web build, in Safari, Chrome and
   Firefox; Playwright kept only for extension-only wiring** (chosen by
   Chris). Each scenario once; Safari gets the same feature coverage as
   the others. Costs: a one-time move of most of the Playwright spec;
   Chrome/Firefox feature tests run on the web build, so the slim
   Playwright suite must still prove the real extension is wired up.

## Design

### 1. Web build: `node scripts/build.mjs --web` → `dist-web/`

Same esbuild entries as the DEV build (`--web` implies `--dev`, so the DEV
footer and `--fake-now` work), with one change: the import
`webextension-polyfill` is aliased to a stand-in,
`test/web-harness/browser-shim.js`. Only this build uses it. The shim lives
under `test/` because it is test code, not product code.

Each page loads **two** bundles: `background.js` (the extension's own
background, unchanged) and the page's own bundle (`content.js`,
`popup/dashboard.js`, `options/options.js`, `popup/print.js`). Each bundle has
its own copy of the shim, told its role at build time
(`define: { __WEB_ROLE__: '"background"' | '"page"' }`). The two copies talk
through one in-page bus (`globalThis.__sgdBus`), so messages go between
"background" and "page" listeners just as in the extension, and a page's
listeners never get its own messages.

The shim covers exactly the APIs the code uses today (grep of `browser.*`):

| API | Web stand-in |
|---|---|
| `storage.local` get/set/remove/clear | `localStorage`, keys prefixed `sgd:`, values JSON |
| `storage.onChanged` | fired in this page after a write, and in other tabs via the `storage` event |
| `runtime.sendMessage` / `onMessage` | in-page bus between the background and page roles; `sender = { tab: { id: 1, index: 0, url: location.href } }` |
| `tabs.sendMessage` | the bus, to the page role's listeners (the page-fetch fallback answers from the same page) |
| `tabs.query` | `[{ id: 1, index: 0, active: true, url: location.href }]` |
| `tabs.create` / `update` / `reload` / `remove` / `getCurrent` | `window.open` / `location` / no-op as fits |
| `runtime.getURL(p)` | `/__ext/` + `p` |
| `runtime.getManifest()` | the built `dist-web/manifest.json`, inlined at build time |
| `runtime.openOptionsPage()` | open `/__ext/options/options.html` |
| `permissions.*` | everything allowed; `getAll` returns the manifest's host permissions |
| `scripting.*`, `alarms.*`, `onInstalled`, `onStartup` | no-ops (registered listeners are kept but never fired) |

Known limits, stated in the test README: every page runs its own copy of the
background, so two open pages could both refresh (tests use one page at a
time). The hidden-tab fallback (`refresh-via-hidden-tab`) is not exercised.

### 2. Mock server serves the web app

`startServer(port, { webExtension: 'dist-web' })` (and `MOCK_WEB_EXT=1` for
`npm run mock-server`) adds:

- `GET /__ext/*`: static files from `dist-web/` (pages, bundles, icons,
  CSS).
- The extension's pages are served with the two script tags (background
  first). The build writes web copies of the HTML pages with the extra
  `<script src="/__ext/background.js">`, so the server only serves files.
- On every mock Schoology HTML page, before `</body>`:
  `<script src="/__ext/background.js"></script><script src="/__ext/content.js"></script>`,
  so the in-page panel mounts exactly as the content script would.

Everything is one origin (`http://localhost:<port>`), so the background's
`fetch(..., { credentials: 'include' })` carries the mock sign-in cookie.
Tests set `settings.schoologyBase` to the mock origin through storage
(`localStorage`, via `execute()`), like the Playwright suite does through
`chrome.storage`.

### 3. Feature suite: `test/web/*.web.mjs`, in three browsers

- One suite, `node --test` + webdriverio. `BROWSER=safari|chrome|firefox`
  picks the browser (webdriverio downloads chromedriver/geckodriver and
  Chrome for Testing itself; Safari uses the system `safaridriver`).
  Chrome and Firefox run headless; Safari can't.
- Scripts: `npm run test:web` (Chrome, the local default, like
  `--project=chromium` today), `npm run test:web:firefox`,
  `npm run test:safari`.

- One browser session per file, files run one at a time
  (`--test-concurrency=1`; needed for Safari, kept for all for sameness).
- A small helper module (`test/safari/helpers.mjs`): start the mock server
  with the web app on an ephemeral port, sign in as a persona (submit the
  form from the page), set storage, read the panel's open shadow root
  (`sgd-panel-host`), click by role/text inside it, wait for text.
- Each test starts clean: `localStorage.clear()` and the mock's `/logout`.
- **Scenarios moved here** from `test/e2e/extension.spec.js` (same mock data,
  same assertions where they apply):
  1. Student: 1 Missing, no verdict for students, quarter grades.
  2. Parent: two child dashboards, Sam NO-GO, Jamie GO, submitted work
     waiting; switching children.
  3. In-page panel: open by default, closes, reopens, remembered; on a
     narrow window (`setWindowSize`) it closes when a link is opened.
  4. Refreshes by itself when a Schoology page loads: banner, progress,
     disabled button.
  5. Each person signed in has their own data; signed out shows the old
     data with a banner.
  6. Settings page: auto-saves; students get no Family rules; Clear data
     asks in the page and greys out when empty; demo mode shows made-up
     students and reads nothing.
  7. Dashboard page (`popup/dashboard.html`) and print page render the same
     dashboard.
  8. Grade chart and records render (the parts most likely to differ by
     engine: SVG, `Intl` dates, CSS).
- Skipped (not faked) when `dist-web/` is missing, or for Safari when not
  on macOS.
- **Starting Safari (decided by Chris: quit it for him; Safari only).** safaridriver can't
  attach to a Safari the user opened (sessions time out). The helper first
  tries a session; if Safari is running and the session times out, it quits
  Safari gracefully (`osascript -e 'quit app "Safari"'`, which keeps
  Safari's window restore), waits for it to exit, and starts again, so
  the run needs no hands. It prints one line saying it did so. The first
  time, macOS may ask whether Terminal may control Safari (Apple Events);
  that one-time prompt is noted in the README. On CI there is no user
  Safari, so this never happens.
- **Robustness (the job is a required check, see 4).** Explicit
  `waitUntil` everywhere (no fixed pauses as assertions), per-test timeout,
  and one automatic retry per test file in a fresh Safari session if the
  session itself fails (driver/connection errors only, never a failed
  assertion). A retry is logged so flakiness is visible.

### 3b. What stays in Playwright (`test/e2e/extension.spec.js`)

Only what needs the real extension, still in Chromium and Firefox:

- **Extension wiring smoke** (new, replaces the feature depth of the moved
  tests): load the DEV extension, sign in to the mock as the parent,
  refresh through the service worker, and see the parent dashboard both
  on the extension's dashboard page and in the in-page panel the content
  script mounts. Proves the manifest, content script, background worker,
  `chrome.storage` and messaging are wired.
- "Background requests signed out / fail (as in Safari): reads through the
  open Schoology page" (both cases). Needs a real service worker.
- "Toolbar popup: only the Schoology addresses, as links".
- Per-site/per-person storage *as the extension stores it* stays covered by
  the wiring smoke reading back `chrome.storage`; the detailed per-person
  scenario moves to the feature suite.

Everything else in the spec moves to section 3: student persona, parent
persona, per-person data and signed-out banner, settings page, Clear data
and demo mode, panel on a narrow screen, panel open/close/remembered,
auto-refresh on page load.

### 3c. Order of the move (no gap in coverage)

1. Web build + shim + mock-server routes; the Safari smoke scenario passes
   in Safari and Chrome.
2. Port each scenario to `test/web/`, green in all three browsers.
3. Add the Playwright wiring smoke; then delete the moved tests from the
   Playwright spec in the same change that makes their web versions part
   of CI.

### 4. CI: a `safari` job in `.github/workflows/ci.yml`

- The existing `test` job (ubuntu) also builds `dist-web/` and runs the
  feature suite in Chrome and Firefox (`npm run test:web` and
  `test:web:firefox`), next to the slimmer Playwright suite. It stays the
  required `test` check.
- A separate job `safari`, `runs-on: macos-26`; `npm ci`;
  `npm run build:web`; `npm run test:safari`; job timeout 20 minutes.
safaridriver and "Allow remote automation" are already enabled in that
image (`install-safari.sh` in actions/runner-images); a
`sudo safaridriver --enable` step is harmless and keeps the job
self-explanatory. Runs on the same triggers as the existing e2e job.

**Required from day one (decided by Chris).** `main`'s ruleset ("main",
id 26954425) requires the `test` check today. The job is added to that
ruleset's required checks as `safari` once it has gone green on its PR.
That is a repository settings change, done (or approved) by Chris at that
point, not silently.

### 5. Docs

`test/README.md`: the two suites (features on the web build in three
browsers; extension wiring in Playwright) and a "Safari" section: what it covers, what it
can't (the extension-only list above), how to run locally, and the shim's
limits. The existing extension smoke-test section stays, marked as the
manual extension check.

## Decided by Chris

- Fully automated Safari coverage is the goal; the web-app route is fine.
- Real Safari only, no Playwright WebKit. macOS CI minutes are free here.
- No duplicated tests: one feature suite for all three browsers (approach
  5); Playwright keeps only extension wiring.

- `npm run test:safari` quits a user-opened Safari and carries on (above).
- The Safari job is a required check from day one (above).

## My calls (open to change)

- **When real Safari shows a product bug:** fix it in this work if it is
  small and clear (like the port-pattern bug found on 2026-11-21);
  otherwise skip that one test with the reason in the test and the
  README, and tell Chris. Done = every scenario green, or skipped with a
  written reason Chris has seen.
- **Hard-coded mock address** (`MOCK_SCHOOLOGY = 'http://localhost:8123'` in
  `dashboard-view.js` and `demo-mode.js`): it only feeds the DEV footer
  switch. Tests set `settings.schoologyBase` to the mock's real port
  through storage, so the constant stays and tests may use any port.
- **`chrome.runtime.id` and other direct `chrome.*` reads** outside the
  polyfill: the shim also defines a minimal `globalThis.chrome` with the
  same stand-ins (`runtime.id = 'web-harness'`).

## Left to the builder

- `node:test` rather than the WDIO test runner (one less framework; the
  smoke test already uses it).
- `test/safari/smoke.safari.mjs` (manual, extension loaded by hand) stays
  as the only Safari check of the real extension.
- The bus/role design for the shim (vs. running the background in a
  SharedWorker, which would need IndexedDB instead of `localStorage` and
  more shim code).
- Exact scenario wording and which Playwright assertions carry over 1:1.
- Whether the "web copies" of HTML pages are generated by the build or
  rewritten by the server.
