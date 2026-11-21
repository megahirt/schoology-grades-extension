# Test environment — Grades Dashboard extension

How to run the mock server, the unit tests, and the Playwright e2e tests.
All commands run from the repo root.

> **Markup:** the mock server renders HTML in the **live Schoology Grades
> structure** verified on 2026-11-06 (`test/mock-server/markup.js`, see the
> header of `extension/src/parser-core.js`). All names and grades are made up.

> **Browsers:** the e2e tests run in **Chromium and Firefox** via
> Playwright, locally and in CI. Safari can't be driven by Playwright
> (its WebKit is not Safari and can't load Safari Web Extensions); one
> smoke test runs in real Safari through safaridriver, locally, after a
> one-time setup (see "Safari" below).

## Run everything

```sh
npm test          # unit tests (vitest, test/unit/)
npm run build:dev && npm run build:firefox   # the two DEV builds the e2e tests load
npm run test:e2e  # Playwright e2e (test/e2e/), Chromium + Firefox
npx playwright test --project=firefox   # one browser only
SAFARI_E2E=1 npm run test:e2e:safari   # Safari smoke test (macOS, one-time setup: see "Safari")
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

## E2E tests (`test/e2e/extension.spec.js`, Playwright — `npm run test:e2e`)

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
     against the same dashboard in the in-page panel, and the settings-page
     test is skipped.
   The extension is pointed at `http://localhost:<port>` (not
   `127.0.0.1`), because the DEV host permission is `http://localhost`.
3. It logs in to the mock server, sets `settings.schoologyBase` to the mock
   URL via the options page (storage), triggers a refresh, opens
   `popup/dashboard.html` (the full dashboard page; the toolbar popup itself
   only links to Schoology), and asserts:
   - **Student:** "Missing · 1", "Persuasive Essay Draft", badge **NO-GO —
     Low grades** (Algebra 2 is 68%, below 75; one Missing alone would be
     GO), with the student's name "Alex Student".
   - **Parent:** TWO child dashboards — Sam Rivera **NO-GO** ("Missing · 2")
     and Jamie Rivera **GO** ("Missing · 1", "Poetry Analysis Essay").

If `dist/` (or `dist-firefox/` for Firefox) does not exist yet, the e2e
tests **skip** (they do not fake a pass). If Playwright browsers are
missing, run first:

```sh
npx playwright install --no-shell chromium firefox
```

### Safari

Playwright can't drive Safari: its WebKit is not Safari and can't load
Safari Web Extensions. Instead there is one **smoke test** in real Safari,
driven by Safari's own WebDriver (`safaridriver`) through webdriverio:
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

**CI (not set up yet):** GitHub's `macos-26` and `macos-15` images ship
Safari 27.2 with `safaridriver --enable` and "Allow remote automation"
already done in the image (`images/macos/scripts/build/install-safari.sh`
in actions/runner-images). The image also gives `osascript` and `/bin/bash`
Accessibility and Apple Events rights to System Events and Safari. A Safari
job would need to load `dist/` without hands: UI-script Safari Settings
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
For Safari see "Safari" above (smoke test + manual check).

