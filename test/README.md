# Test environment — Schoology Dashboard extension

How to run the mock server, the unit tests, and the Playwright e2e tests.
All commands run from the repo root.

> **Markup:** the mock server renders HTML in the **live Schoology Grades
> structure** verified on 2026-11-06 (`test/mock-server/markup.js`, see the
> header of `extension/src/parser-core.js`). All names and grades are made up.

> **Safari note:** the extension is Safari-first (many students use Safari), but these tests run in **Chromium via Playwright** —
> Safari cannot be automated in this environment. The e2e tests prove the
> shared logic in Chromium; the Safari build is verified separately.

## Run everything

```sh
npm test          # unit tests (vitest, test/unit/)
npm run test:e2e  # Playwright e2e (test/e2e/) — needs the DEV build first
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

1. Build the DEV build first: `npm run build:dev` (produces `dist/` with
   `http://localhost:*/*` host permissions for the mock server).
2. The spec starts the mock server on an ephemeral port, launches Chromium
   with the unpacked DEV build (`chromium.launchPersistentContext` +
   `--load-extension`), and uses a fresh user-data-dir per test. The
   extension is pointed at `http://localhost:<port>` (not `127.0.0.1`),
   because the DEV host permission is `http://localhost:*/*`.
3. It logs in to the mock server, sets `settings.schoologyBase` to the mock
   URL via the options page (storage), triggers a refresh, opens
   `popup/popup.html`, and asserts:
   - **Student:** "Missing · 1", "Persuasive Essay Draft", badge **NO-GO —
     Low grades** (Algebra 2 is 68%, below 75; one Missing alone would be
     GO), with the student's name "Alex Student".
   - **Parent:** TWO child dashboards — Sam Rivera **NO-GO** ("Missing · 2")
     and Jamie Rivera **GO** ("Missing · 1", "Poetry Analysis Essay").

If `dist/` does not exist yet, the e2e tests **skip** (they do not fake
a pass). If Playwright browsers are missing, run first:

```sh
npx playwright install --no-shell chromium
```

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

`npm run build:dev` builds "Schoology Dashboard (Dev)". It uses real
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
Safari still needs its own manual check.

