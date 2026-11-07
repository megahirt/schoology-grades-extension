# Test environment — Schoology Dashboard extension

How to run the mock server, the unit tests, and the Playwright e2e tests.
All commands run from the repo root (`~/workspace/schoology-dashboard-extension`).

> **Fixture-vs-live-DOM caveat:** every HTML fixture in
> `test/mock-server/fixtures/` is **modelled on the known Schoology Grades
> structure — it is NOT a copy of, or verified against, live Schoology DOM.**
> The parser selectors must be re-validated against real Schoology pages
> (that is what `test/probe/` is for). Fixture data is internally consistent
> with the verdict rules, but real Schoology markup may differ.

> **Safari note:** the extension is Safari-first (students at North Point
> Christian use Safari), but these tests run in **Chromium via Playwright** —
> Safari cannot be automated in this environment. The e2e tests prove the
> shared logic in Chromium; the Safari build is verified separately.

## Run everything

```sh
npm test          # unit tests (vitest, test/unit/)
npm run test:e2e  # Playwright e2e (test/e2e/) — needs the DEV build first
npm run mock-server   # start the mock Schoology server alone (port 8123)
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
| `GET /home` | Course list with links to `/course/<id>/grades` |
| `GET /course/<id>/grades` | Fixture Grades HTML for that course |
| `GET /parent/grades_attendance/grades` | Parent grade report HTML (both children) |
| `GET /iapi/parent/info` | JSON `{ view_mode, view_child, children }` |
| `GET /iapi/parent/overdue_submissions/<uid>` | JSON overdue list for that child |
| `GET /home/feed?children=<uid>` | JSON activity for that child |

Any request without the `mock-session` cookie redirects to `/login`
(mirrors real Schoology). Two personas, chosen by `?as=` on `/login`:

### Student persona — "Alex Student"

| Course | Grade | Contents |
|---|---|---|
| Algebra 2 | 68% | 4 graded items; a graded **0/10 is NOT Missing** |
| American Literature | 82% | **1 Missing** ("Propaganda Script"), 1 incomplete, 1 pending |
| United States History | 95% | Clean; 1 excused item |
| BPL Advisory 11 | — (no grade) | 1 pending item only — classifier should say **skip** |

### Parent persona — two children

| Child | Missing | Lowest class | Expected verdict |
|---|---|---|---|
| **Luis Hirt** | 2 ("Propaganda Script", "Unit 2 Contexts Essay") | 55% (BPL American Literature) | **NO-GO** — Missing work + Low grades |
| **Emma Hirt** | 1 ("Poetry Analysis Essay") | 92% (07 English) | **GO** (one Missing alone is GO) |

Defaults: `gradeThreshold: 75` (75 passes), `missingThreshold: 2`.

## Unit tests (`test/unit/`, vitest — `npm test`)

| File | Covers |
|---|---|
| `rules.test.js` | `computeVerdict` / `summarizeStudent` — defaults, edge cases (75 passes, 74 fails), custom thresholds |
| `classifier.test.js` | `classifySection` — include / check / skip scoring, name penalties, caps |
| `parser.test.js` | `parseGradesHtml` against the fixture files — courses, counts, Missing detection, graded scores, incomplete/excused, `PARSE_EMPTY` self-check |
| `schoology.test.js` | `createClient` against the live mock server — `detectAccount` (parent/student/loggedOut), `fetchGradesPage`, `fetchParentDashboards` |
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
   - **Student:** "Missing · 1", "Propaganda Script", badge **NO-GO —
     Low grades** (Algebra 2 is 68%, below 75; one Missing alone would be
     GO). The popup renders the generic name "Student", not "Alex Student"
     — `detectAccount` returns no student name for student accounts.
   - **Parent:** TWO child dashboards — Luis Hirt **NO-GO** ("Missing · 2")
     and Emma Hirt **GO** ("Missing · 1", "Poetry Analysis Essay").

   **Known failure (2026-11-06):** the parent test currently fails —
   `fetchParentDashboards` in `extension/src/schoology.js` assigns the
   combined parent grade report to every child with no per-child
   filtering, so both children show all 4 courses, "Missing · 3", and
   NO-GO. The unit test fails the same way. The fix belongs in the
   extension code, not in these assertions.

If `dist/` does not exist yet, the e2e tests **skip** (they do not fake
a pass). If Playwright browsers are missing, run first:

```sh
npx playwright install chromium
```

Playwright 1.49 headless launches use the headless shell; if that download
fails but the full Chromium build is present, `playwright.config.js` falls
back to the full binary automatically (same engine, `--headless=new`).
