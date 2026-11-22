# Test environment — Grades Dashboard extension

How to run the mock server, the unit tests, the web feature suite and the
Playwright extension tests. All commands run from the repo root.

> **Markup:** the mock server renders HTML in the **live Schoology Grades
> structure** verified on 2026-11-06 (`test/mock-server/markup.js`, see the
> header of `extension/src/parser-core.js`). All names and grades are made up.

> **Browsers:** there are two browser suites.
>
> - **Features** (`test/web/`): the extension's own code, built as a web
>   app, runs in **Safari, Chrome and Firefox**, driven by webdriverio. CI
>   runs all three. See "Web feature suite" below.
> - **Extension wiring** (`test/e2e/`): the real extension in **Chromium
>   and Firefox** via Playwright, locally and in CI. A few tests of what only
>   the real extension has. See "Extension wiring tests" below.
>
> Playwright can't drive Safari (its WebKit is not Safari and can't load
> Safari Web Extensions). The real extension in Safari is checked by hand
> (see "Manual check of the real extension in Safari" below).

## Run everything

```sh
npm test          # unit tests (vitest, test/unit/)
npm run build:web     # dist-web/: the web build the feature suite runs
npm run test:web      # feature suite in Chrome (headless)
npm run test:safari   # feature suite in Safari (macOS)
npm run test:web:firefox   # feature suite in Firefox (CI runs it; locally optional)
npm run build:dev && npm run build:firefox   # the two DEV builds Playwright loads
npm run test:e2e  # extension wiring (test/e2e/), Chromium + Firefox
npx playwright test --project=chromium   # one browser only
SAFARI_E2E=1 npm run test:e2e:safari   # manual check of the real extension in Safari (see below)
MOCK_WEB_EXT=1 npm run mock-server   # the mock serving dist-web/ under /__ext/
npm run mock-server   # start the mock Schoology server alone (port 8123)
MOCK_DELAY_MS=700 npm run mock-server   # slow answers, to see the refresh banner
```

## Mock Schoology server (`test/mock-server/server.js`)

Plain Node `http`, no framework. Port from `PORT` env (default `8123`).

```sh
PORT=8123 node test/mock-server/server.js
# or: npm run mock-server
```

Routes (see `SPEC.md`):

| Route | What it does |
|---|---|
| `GET /login` | Login form (`#login-form`, any credentials work) |
| `POST /login?as=student\|parent` | Sets `mock-session=1` + `mock-persona`, redirects `/home` |
| `GET /home` | Home page (student: course links + `data-user-name`) |
| `GET /grades/grades` | Student: every course's grades |
| `GET /course/<id>/student_grades` | One course's grades (student, or the parent's viewed child) |
| `GET /iapi/parent/info` | Parent: `{ response_code, body: { session: { view_child }, children: { uid: {...} } } }` |
| `GET /parent/home?child_uid=<uid>` | Parent: switch the viewed child (cookie `mock-view-child`) |
| `GET /parent/grades_attendance/grades` | Parent: every course of the viewed child |

Any request without the `mock-session` cookie redirects to `/login`
(mirrors real Schoology). Two personas, chosen by `?as=` on `/login`:

### Student persona — "Alex Student"

| Course | Grade | Contents |
|---|---|---|
| Algebra 2 | 68% | 2 graded items, 1 Exempt |
| American Literature | 82% | **1 Missing** ("Persuasive Essay Draft"); a graded **0/5 that is NOT Missing**; 1 submitted-not-graded |
| United States History | 95% | Clean; one letter grade ("A") |
| Advisory 11 | — (no grade) | No items — classifier should say **skip** |

### Parent persona — two children

| Child | Missing | Lowest class | Expected verdict |
|---|---|---|---|
| **Sam Rivera** | 2 ("Persuasive Essay Draft", "Unit 2 Essay") | 55% (American Literature) | **NO-GO** — Missing work + Low grades |
| **Jamie Rivera** | 1 ("Poetry Analysis Essay") | 92% (07 Math) | **GO** (one Missing alone is GO) |

Defaults: `gradeThreshold: 75` (75 passes), `missingThreshold: 2`.

## Unit tests (`test/unit/`, vitest — `npm test`)

| File | Covers |
|---|---|
| `rules.test.js` | `computeVerdict` / `summarizeStudent` — defaults, edge cases (75 passes, 74 fails), custom thresholds |
| `classifier.test.js` | `classifySection` — include / check / skip scoring, name penalties, caps |
| `parser.test.js` | `parseGradesHtml` on a live-markup fixture and mock markup — Missing (incl. collapsed periods), real 0s, Exempt/Incomplete, letter grades, submission notes, dates, `PARSE_EMPTY` |
| `schoology.test.js` | `createClient` against the mock server — `detectAccount`, student flow, parent per-child switching + UNKNOWN on a failed switch, probe |
| `mock-server.test.js` | The mock server itself (routes, cookies, personas) — no extension dependency |

Unit tests import the extension modules via relative paths
(`../../extension/src/rules.js` etc.). If `extension/src/` has not been
built yet, those four suites fail at import; `mock-server.test.js` still
passes and proves the harness works.

## Web feature suite (`test/web/`, webdriverio)

The features are tested once, in three browsers. `npm run build:web` builds
the extension's real code as a web app in `dist-web/` (never published,
gitignored). The extension APIs it calls are stood in for by
`test/web-harness/browser-shim.js`, in the page. The mock server serves
`dist-web/` at `/__ext/` and adds its background and content script to every
page. Each test file (`smoke`, `student`, `parent`, `panel`, `refresh`,
`people`, `settings`) drives one real browser through WebDriver; the helpers
are in `test/web/helpers.mjs`.

```sh
npm run build:web
npm run test:web           # Chrome, headless
npm run test:web:firefox   # Firefox, headless
npm run test:safari        # Safari (macOS); see the setup below
```

If `dist-web/` is missing, the suite skips and says to build it.

**How a run works:**

- One browser session per file. The file's scenarios run as subtests in
  that session. Files run one at a time (`--test-concurrency=1`).
- A session or driver error in any scenario (the session didn't start, the
  driver stopped answering) reruns the whole file once, in a fresh session.
  The rerun is logged (`[web] session error, retrying once: …`).
- A failed assertion or a wait that timed out (`[web-wait] …`) is a real
  failure. It never retries: that would hide a real browser bug.
- Waits are conditions (`waitUntil`), never fixed pauses.

**Firefox locally:** if your installed Firefox hangs at start (for example
with an update waiting to be applied), let webdriverio download one:

```sh
BROWSER_VERSION=stable npm run test:web:firefox
```

CI does the same, so its Firefox is a known stable build.

**Safari setup:** once, Safari → Settings → Developer → "Allow remote
automation", and run `sudo safaridriver --enable`. Then:

- safaridriver can't use a Safari you started yourself. If a session times
  out while Safari is running, the suite quits Safari, waits for it to exit,
  retries, and prints one line saying so. So a Safari run **quits your
  Safari** (Chris approved this).
- Before real clicks the suite brings Safari to the front: a real click
  only reaches a window that is in front, and on a Mac in use another app
  may be. macOS may ask once whether Terminal (or your editor) may control
  Safari: allow it.
- A Safari temporary extension that is still loaded breaks the Safari suite:
  its content script runs on localhost too and replaces the web build's
  panel. The suite checks the panel's build stamp and stops with "the panel
  is from another build … quit Safari, which drops temporary extensions".
  Quit Safari and run again.

**What the shim doesn't cover:**

- Every web page runs its own copy of the background (the real extension
  has one per browser). A page opened with `?mock-no-background=1` (mock
  server) gets only the content script. The refresh tests use it for a
  second page opened while a refresh runs, so it doesn't start a refresh of
  its own.
- The web build's background dies when its page navigates away, so a
  refresh cut short can leave `refreshState.running = true` until the stuck
  timeout (the real extension never does this).
- The hidden-tab fallback (`refresh-via-hidden-tab`) is not exercised.
- Extension plumbing is out of scope: permissions, content-script
  registration, the background's cookies, the toolbar popup. Playwright
  checks the wiring in Chromium and Firefox (next section); Safari's is
  checked by hand.

## Extension wiring tests (`test/e2e/extension.spec.js`, Playwright — `npm run test:e2e`)

1. Build the DEV builds first: `npm run build:dev` (produces `dist/` with
   `http://localhost/*` host permissions for the mock server) and
   `npm run build:firefox` (`dist-firefox/`: the same, with a Firefox
   add-on id, an event-page background and `http://localhost/*`, since
   Firefox match patterns can't name a port).
2. The spec starts the mock server on an ephemeral port and uses a fresh
   user-data-dir per test. There are two Playwright projects:
   - **chromium:** Chromium with the unpacked build
     (`chromium.launchPersistentContext` + `--load-extension`).
   - **firefox:** Playwright's Firefox, started with its debugger server;
     `test/e2e/firefox-addon.js` installs `dist-firefox/` as a temporary
     add-on and runs storage code in its background page over Firefox's
     remote debugging protocol. Playwright's Firefox can't open
     `moz-extension://` pages, so in Firefox the dashboard checks run
     against the same dashboard in the in-page panel, and the tests that
     need an extension page are skipped.
   The extension is pointed at `http://localhost:<port>` (not
   `127.0.0.1`), because the DEV host permission is `http://localhost`.
3. Each test logs in to the mock server and sets `settings.schoologyBase`
   to the mock URL via the options page (storage). The tests:
   - **Wiring:** a background refresh saves both children to
     `chrome.storage` (`dashboards@<mock origin>…`), and both the dashboard
     page (`popup/dashboard.html`; in Firefox the panel) and the in-page
     panel on `/home` show Sam Rivera and Jamie. Chromium and Firefox.
   - **Background requests turned away** (signed out, or failing, as in
     Safari): the refresh reads through the open Schoology page. Two tests,
     Chromium only.
   - **Toolbar popup:** only the Schoology addresses, as links, and "See a
     demo". Chromium only.
   So Chromium runs 4 tests and Firefox runs the wiring test.

If `dist/` (or `dist-firefox/` for Firefox) does not exist yet, the e2e
tests **skip** (they do not fake a pass). If Playwright browsers are
missing, run first:

```sh
npx playwright install --no-shell chromium firefox
```

### Manual check of the real extension in Safari

The features run in Safari in the web feature suite (above). The real
extension in Safari can't be automated: Playwright can't drive Safari, and
safaridriver can't install an extension. So there is one **manual check**
of the real extension, run by hand after loading it in Safari, driven by
Safari's own WebDriver (`safaridriver`) through webdriverio:
`test/safari/smoke.safari.mjs`. It signs in to the mock server as the
parent, presses Refresh in the in-page panel and checks that the panel shows
both children (Sam Rivera NO-GO, Jamie), "Data: Mock server" and no
"Please log in" banner. It also checks that the refresh really read the mock
server, so a dashboard left over from an earlier run can't pass it. It is
skipped unless `SAFARI_E2E=1` on macOS.

```sh
npm run build:dev
SAFARI_E2E=1 npm run test:e2e:safari   # stop `npm run mock-server` first: it uses port 8123
```

**What works (checked 2026-11-21, Safari 27.2, macOS 27.2):**

- `safaridriver` sessions work once Safari's Settings → Developer →
  "Allow remote automation and external agents" is on.
- An extension that is already loaded in Safari (App Store build or a
  temporary one) **also runs in the automation window**. The content script
  runs, the panel's shadow root is open, and the test reads it with
  `execute()`.
- WebDriver BiDi works only with the capability
  `'safari:experimentalWebSocketUrl': true` (`webSocketUrl: true` alone gives
  no socket). The test doesn't need BiDi.

**What doesn't:**

- safaridriver **can't install an extension**. BiDi
  `webExtension.install` answers "unknown command - 'webExtension' domain
  was not found". So the extension must be loaded in Safari by hand first.
- safaridriver **can't attach to a Safari you started yourself**. Every
  new session times out ("timed out while connecting to a Safari instance")
  and Safari only comes to the front. Quit Safari and let safaridriver
  start it. Sessions keep working against that Safari, also after you load a
  temporary extension in it. After clicking "Stop Session" on an automation
  window's lock dialog, that Safari refused new sessions until it was quit.
- You can't use the automation window while a session runs (Safari shows
  "This Safari window is remotely controlled…"). Use a normal window for
  setup clicks.
- Safari **ignores match patterns with a port** (`http://localhost:*/*`
  matched nothing, so the DEV build never ran on the mock server in Safari).
  The DEV build now uses `http://localhost/*`, which matches every port in
  Chrome, Firefox and Safari. For the same reason `originPattern()`
  (`extension/src/sites.js`) drops the port when the background looks for
  an open mock tab (`browser.tabs.query`). Without that, Safari's
  "read through the open page" fallback (`page-fetch.js`) found no tab and
  the panel said "Please log in" on the mock server.

**Local setup, once per Safari launch:**

1. Quit Safari. Run the test once (it fails); Safari is now started by
   safaridriver. Leave it running.
2. Safari Settings → Developer: "Allow remote automation" and
   "Allow unsigned extensions" on, then **Add Temporary Extension…** and
   pick `dist/` (Cmd+Shift+G to type the path; Cmd+Shift+. shows hidden
   folders such as `.claude`). Turn the App Store build off in
   Settings → Extensions so the two don't both run.
3. In a normal window open `http://localhost:8123/login` (with
   `npm run mock-server` running) and allow the DEV extension on localhost.
   Stop the mock server again.
4. `SAFARI_E2E=1 npm run test:e2e:safari`. After a rebuild, remove and
   re-add the temporary extension (and allow localhost again).

**In CI:** only the web feature suite runs in Safari (job `safari`). This
manual check doesn't. GitHub's `macos-26` and `macos-15` images ship
Safari 27.2 with `safaridriver --enable` and "Allow remote automation"
already done in the image (`images/macos/scripts/build/install-safari.sh`
in actions/runner-images). The image also gives `osascript` and `/bin/bash`
Accessibility and Apple Events rights to System Events and Safari. Running this
check there would need loading `dist/` without hands: UI-script Safari Settings
(Developer → Allow unsigned extensions, Add Temporary Extension…, then the
file dialog), allow localhost, then run the test. Not tried yet: whether
"Allow unsigned extensions" asks for a password on the runner, and whether
the per-site allow can be scripted. The other route is building the Xcode
wrapper (`npm run build:safari`) from the DEV build, signed, and opening it
once. Enabling it in Settings → Extensions still needs a click.

Without the test, check Safari by hand: Settings → Developer →
Add Temporary Extension…, pick `dist/`, and allow it on Schoology.

Playwright 1.49 headless launches use the headless shell; if that download
fails but the full Chromium build is present, `playwright.config.js` falls
back to the full binary automatically (same engine, `--headless=new`).

## Screenshots (visual check against the design)

`npm run build:dev && npm run screenshots` loads the DEV build into local
Chromium, fills it with the made-up demo data, shows the panel on a fake
Schoology page (served by Playwright, no network) and saves the popup, the
open panel, a NO-GO child, Waiting on teacher, the closed tab, the student
view and the iPhone bottom sheet to `test/screenshots/out/` (gitignored).
Compare them with the "Schoology Dashboard Panel" design.

## Dev build: real Schoology or the mock server

`npm run build:dev` builds "Grades Dashboard (Dev)". It uses real
Schoology (`https://app.schoology.com`) by default, like the normal build.
A purple **DEV** row in the dashboard footer (popup and panel) switches the
data source with one click:

- **Use mock server** points it at `http://localhost:8123`, clears the stored
  dashboards and refreshes. Start the server first (`npm run mock-server`)
  and sign in at `http://localhost:8123/login?as=parent` (or `?as=student`).
- **Use real Schoology** switches back the same way.

Production builds (`npm run build`) never show the switch.

## Dev Chromium window (hands-on testing without "Load unpacked")

`npm run chromium` builds the dev extension and opens a visible Chromium
window with it already loaded, on real Schoology. It has its own profile in
`.chromium-profile/` (gitignored): sign in to Schoology there once and it
stays signed in; your everyday Chrome is not touched. Rerun the command after
a code change (`-- --no-build` skips the rebuild). Chromium's DevTools
protocol listens on `127.0.0.1:9333` (this machine only), so tools such as
Playwright's `chromium.connectOverCDP('http://127.0.0.1:9333')` can attach to
the same window. Each launch clears the profile's cached extension service
worker (Chromium otherwise kept running a stale background script) and checks
that the running build matches the new one; the DEV row shows the build time.
For Safari see "Web feature suite" and "Manual check of the real extension
in Safari" above.

