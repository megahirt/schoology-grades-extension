# Schoology Dashboard Extension — build contract (SPEC)

Repo: `schoology-grades-extension` (public, @sabaisnoopy).
This file is the interface contract
between the three build workstreams. Do not change an exported function name or a
storage key without updating this file and every caller.

## Platform priority: SAFARI FIRST, Chrome second (decision 2026-11-06)

Many students use Safari (school Macs and iPhones), so the Safari version is what
matters most. Chrome (Web Store, $5 one-time, Unlisted) is second.
- Shared codebase must be Safari-compatible from day one: use the
  `webextension-polyfill` and the `browser.*` namespace with Promise-based APIs
  everywhere (never `chrome.*` callbacks as the primary path). The polyfill is
  bundled; no remote code (MV3 bans it anyway).
- AVOID Chrome-only APIs as primary paths. In particular, do NOT make the
  offscreen `DOM_PARSER` the primary parse route — it is Chrome-only and does
  not exist in Safari. The bundled pure-JS parser (`node-html-parser`) is the
  portable default that works in Safari. Offscreen may exist only as a
  Chrome-only enhancement, never as a dependency.
- Do NOT use Chrome-only APIs the shared code depends on: no `sidePanel`, no
  `declarativeNetRequest`, no offscreen document in the critical path. Use the
  common subset: `storage`, `alarms`, `runtime` messaging, `tabs`, `scripting`,
  content scripts, action popup. Safari supports service workers for web
  extensions since Safari 16.4 — target modern Safari.
- Safari distribution is part of the build, not a follow-up: `xcrun
  safari-web-extension-packager` (new name; formerly safari-web-extension-converter
  — try the packager name first) produces the Xcode project + macOS app wrapper
  from the shared extension folder; since iOS 26, App Store Connect's web Safari
  Web Extension Packager can also package a ZIP upload with no Mac/Xcode.
  Distribution is via the Mac App Store only (no separate Safari Extensions
  Gallery; do NOT treat Developer-ID notarized outside-store distribution as
  viable). After conversion, strip browser_specific_settings/key/side_panel/
  offscreen from the manifest. Local testing: Safari Settings > Developer >
  Allow Unsigned Extensions (resets every Safari quit) > Add Temporary
  Extension, or the Xcode loop (open .xcodeproj, Product > Run, enable in
  Safari Settings > Extensions); debug via Develop > Web Extension Background
  Pages. Enabling the extension is NOT the same as granting page access —
  per-site / Always Allow access must be granted separately or the content
  script never runs. TestFlight is the reliable route for other Macs (100
  internal / 10,000 external testers, 90-day builds, first external build needs
  Beta App Review). Review checks Guideline 4.4 (containing app must have real
  functionality, e.g. help/settings screen — must not be blank) and 2.1
  completeness; plan 1–7 days, submit 2–3 weeks early (Oct 2026 reports show
  12–22 day tails for first submissions; never promise tighter timing). Updates
  ride with app updates: bump CFBundleShortVersionString per release and
  CFBundleVersion per upload. Apple Developer Program $99/year; a free Apple ID
  (Personal Team) cannot distribute at all and its profiles expire in 7 days.
  The account owner must personally: Apple ID + 2FA, enrol as Individual, verify identity,
  pay $99, accept the licence, create API key/certs, add a helper via App Store
  Connect roles (never share his Apple ID password/2FA). CI can build/submit on
  macOS runners (secrets: base64 .p12 + password, provisioning profiles, App
  Store Connect API key, Team ID); Xcode Cloud has 25 compute hours/month
  included with membership.
- The live background-fetch probe runs in SAFARI as the primary target (and
  Chrome as well if cheap). Report Safari results first.
- GitHub Actions CI covers both browsers; the release workflow produces the
  Safari path first, Chrome second.
- README must state Safari-first and why (students use Safari).

## Background (verified research, 2026-11-06)

- Manifest V3. One shared codebase for Chrome and Safari.
- NO Schoology API, NO OAuth, NO stored Schoology password. Auth = the user's
  existing logged-in browser session (cookies).
- The Schoology REST API Grade object has NO "missing" flag (exception is only
  1=excused, 2=incomplete). The Missing flag lives ONLY on the Grades web page
  (orange hexagon / text "Missing"). A plain numeric 0 is NEVER treated as Missing.
- Background service-worker `fetch(url, {credentials:'include'})` + host_permissions
  is the primary data path, but it is NOT proven for Schoology (community reports
  say SW fetch sometimes does not attach cookies). The live probe (test/probe/)
  must test it against real Schoology. Fallbacks in order: (1) fetch+parse from
  the popup page, (2) hidden background tab + content script.
- Parent detection: `GET {base}/iapi/parent/info` returns JSON with `view_mode`,
  `view_child`, and child profiles. Per-child JSON endpoints are parameterised by
  child UID (`/iapi/parent/overdue_submissions/<uid>`, `/home/feed?children=<uid>`).
  Whether HTML Grades pages accept a per-child parameter is UNVERIFIED — the
  extension must not assume it; it fetches per-child data via the parameterised
  endpoints and per-course pages, and records what worked.
- Data volume is tiny; `chrome.storage.local` is the source of truth. Never keep
  fetched grades only in service-worker globals (SW terminates after ~30s idle).
- NO LLM anywhere in the extension. All verdicts are deterministic arithmetic.

## Rules engine (deterministic, customizable)

Defaults (the shipped default rules — defaults, NOT hard-coded for everyone):
- `gradeThreshold: 75` (75 passes, below 75 is NO-GO)
- `missingThreshold: 2` (NO-GO if missingCount >= 2; one Missing alone is GO)
- Badge states the reason: "NO-GO — Missing work", "NO-GO — Low grades",
  "NO-GO — Missing work + Low grades", otherwise "GO".
- "Missing" = ONLY items explicitly marked Missing on the Schoology Grades page.
  Ungraded + not-Missing = in-between, OK, not counted. To Do overdue flags ignored.
- "Not so good" section: graded items below the grade threshold from the past
  7 days only (by the date shown on the row).
- "Doing well" section (every view): graded B or higher (80%+, or a letter
  A/B) from the past 10 days (`doingWellPercent`, `doingWellDays`).
- GO/NO-GO is shown in the parent view only. A student's own view shows a
  "things to finish first" note instead.
- Class list: a class with no grade yet for the current quarter shows "—"
  there; its semester grade stands (and is what GO/NO-GO uses).
- Due soon: outstanding (not yet graded) items due today / tomorrow. Items past
  their due date AND time with no grade and NOT Missing disappear entirely
  (may be noted in fine print only). No due time given = due at end of day.
  Missing items always stay in Missing.
- "Waiting on teacher" (near the bottom of the dashboard) holds:
  - Submitted work Schoology hasn't graded yet, whether or not the teacher
    marked it Missing. It does NOT count as Missing (no Undo: Schoology
    reported it). It leaves Waiting once graded.
  - Items the family marked, each with Undo, plus the note "Marking
    something done or turned in is for your own use — nobody is notified.":
  - "Turned in" on a Missing item: while Schoology still shows it Missing it
    waits here and does NOT count as Missing. Once Schoology grades it or
    removes the Missing mark it drops out on its own.
  - The grey ✓ "Mark as done" on a Due soon item: it leaves Due soon and waits
    here until graded, even after its due date. If the teacher marks it
    Missing it counts as Missing again (a "done" mark never hides Missing).
  Stored as `turnedIn` and `markedDone`: `{ [studentUid]: [assignmentId] }`.
- Refresh: one at a time (`startRefresh` in background.js; a second request
  joins the running one; gives up after 2 minutes). Progress is stored as
  `refreshState` `{ running, startedAt, done, total, label, finishedAt, ok,
  error }`, so every popup and panel shows a "Refreshing grades…" banner
  with a progress bar and a greyed-out refresh button.
- Auto-refresh: each Schoology page load (top frame) sends
  `schoology-page-loaded`. The background refreshes when the stored data is
  older than 5 minutes and the page is on the configured Schoology site.
  A parent refresh briefly switches Schoology's "viewing as" child, so a
  Schoology page that loads during one gets a "Reload page" notice.
- Partial data: when some grade rows could not be read, the verdict shows
  UNKNOWN instead of GO/NO-GO.
- Service-worker HTML parsing uses parse5 (spec-compliant). Live Schoology
  leaves `<span class="has-dropbox-icon grade-pending-icon">` unclosed on
  ungraded submissions; the earlier non-spec parser dropped every later row.
- Class grades (`parser-core.js`): `grade` (what GO/NO-GO uses) is the
  current quarter: a grading period nested under a semester, not an exam,
  whose dates include today; between quarters, the latest one that has
  started. A quarter that has started with no grade yet, or a course with no
  quarters, falls back to the semester or course grade (`gradeLabel` says
  which, and the dashboard notes it). `overallGrade` / `overallLabel` is the
  second column: "Semester" (the current semester) until a later semester
  has any grade, then "Overall" (the course grade, or the semesters' average).
- Links: every assignment title with a Schoology page links to it, and
  every class title links to that class's grades, opening in a new tab.
  For a parent these use Schoology's preview link
  (`/course/<id>/preview/<child uid>/parent?url=…`), which also switches
  the viewed child; `/course/<id>/student_grades` is 403 for any other child.
- The class list leaves out sections with no grade data (no course grade and
  no graded assignment, e.g. advisory or house group): `hasGradeData()`.
  Their teacher-marked Missing items, if any, still count.
- Dashboard panel: Safari has no extension side-panel API, so the content
  script docks the dashboard on the right edge of Schoology pages
  (`src/panel.js`, a shadow root that never touches Schoology's elements; a
  bottom sheet on phones). The toolbar popup shows the same view
  (`src/dashboard-view.js`). `settings.showPanel` turns the panel off.

`extension/src/rules.js` (pure JS, no chrome APIs, importable by node tests):
- `DEFAULT_SETTINGS` — object: `{ gradeThreshold: 75, missingThreshold: 2,
  notSoGoodDays: 7, showGoNoGo: true, gradeVisibility: 'both',
  gradeDisplay: 'percent', showPanel: true }`
- `computeVerdict({ missingCount, lowestClassGrade, settings })` ->
  `{ verdict: 'GO'|'NO-GO', reasons: string[] }` where reasons use the exact
  badge wording above.
- `summarizeStudent(courses, settings, turnedInIds?, doneIds?)` -> per-student summary (also `waiting`):
  `{ missingCount, missingItems, lowestClassGrade, lowClasses, dueToday,
    dueTomorrow, doingWell, notSoGood, verdict }`.

## Real-vs-skip classifier

`extension/src/classifier.js` (pure JS):
- `classifySection(section)` where section = `{ name, gradedItemCount,
  hasPeriodGrade, assignmentCount }` -> `{ recommendation: 'include'|'check'|'skip', score, reasons[] }`.
- Scoring (deterministic, documented in code): +40 if a period grade is posted,
  +3 per graded item (cap +30), +1 per assignment (cap +10), -15 if the name
  matches advisory/study-hall/house-group/advisory patterns (case-insensitive:
  'advisory','study hall','house group','homeroom','mentor').
  Thresholds: score >= 60 'include', 25–59 'check', < 25 'skip'.
- Real classes have real grades posted; advisory/study-hall types have very
  little grade information. The settings page hides sections with no grade
  data automatically; the user can show or hide any class.

## Grades HTML parser

`extension/src/parser-core.js` is DOM-agnostic (browser DOM in the content
script, `node-html-parser` via `extension/src/parser.js` in the service worker
and tests). The markup it reads was **verified against live Schoology on
2026-11-06** (parent account, `/parent/grades_attendance/grades` and
`/course/<id>/student_grades`); the full annotated structure is in the
parser-core.js header.

- `parseGradesHtml(html, { courseId, courseName, sourceUrl, baseUrl, now } = {})` ->
  `{ courses: [{ id, name, sectionTitle, grade, gradeSource, periods, assignments, url }],
    parseWarnings: string[] }`.
- One course per `.gradebook-course` block; one assignment per `tr.item-row`,
  **including rows with class `hidden`** (items in collapsed grading periods).
- Assignment: `{ id, title, kind, due (ISO|null), dueText, score, maxPoints,
  letterGrade, status: 'missing'|'incomplete'|'excused'|'graded'|'pending'|'overdue',
  submitted, submissionNote, gradePending, periodId, url, sourceUrl }`.
- Missing = ONLY the teacher's Missing exception (`.exception-icon.missing` /
  `.exception-text` "Missing"). NEVER inferred from a 0 score, from overdue, or
  from a missing submission. A Missing row can also carry "This student has
  made a submission that has not been graded" (teacher lag) — kept as
  `submitted: true`, still Missing.
- Class grade: the course-row grade when shown, else the top-level grading
  period (semester) containing today, else the latest graded one.
- SELF-CHECK: grade rows present but nothing parsed -> `error: 'PARSE_EMPTY'`;
  callers show "could not read grades", never a green GO.

## Schoology fetch layer

`extension/src/schoology.js` (global `fetch`, injectable `fetchImpl`; all
requests `{ credentials: 'include' }`; endpoints verified live 2026-11-06):
- `createClient({ baseUrl, fetchImpl })` -> `{ detectAccount(), fetchPage(url),
  fetchGradesPage(url), fetchStudentDashboard(), fetchParentDashboards(),
  runLiveProbe(url) }`.
- `detectAccount()`: `GET /iapi/parent/info` -> `{ response_code, body: {
  session: { view_mode, view_child }, children: { "<uid>": { uid, username,
  profile_tiny } } } }`. Children present => parent; else a logged-in `/home`
  => student; a login page => loggedOut.
- Parent flow, per child: `GET /parent/home?child_uid=<uid>` (switches the
  session's viewed child), confirm `view_child` via `/iapi/parent/info`,
  `GET /parent/grades_attendance/grades` (all of that child's courses), confirm
  `view_child` again. Any mismatch => verdict UNKNOWN, never another child's
  grades. The originally viewed child is restored afterwards.
- Student flow (NOT verified live — no student account was available):
  `GET /grades/grades`, falling back to `/course/<id>/student_grades` for the
  courses linked from `/home`.
- Not used: `/iapi/parent/overdue_submissions` (omits teacher-marked Missing
  items, includes non-Missing ones) and `/home/feed` (submission events only).

## Storage keys (chrome.storage.local)

- `settings` — the settings object (see rules.js DEFAULT_SETTINGS plus
  `schoologyBase`, `classIcons`, `avatarOverride`, `realClasses` per student).
- `dashboards` — `{ [studentUid]: { studentName, pictureUrl, courses, summary,
  updatedAt, source } }`.
- `liveTest` — the latest live-probe evidence object.
- `account` — `{ type, children, detectedAt }`.

## Extension file layout

- `extension/manifest.json` — MV3. permissions: `storage`, `alarms`,
  `scripting`, `tabs`. host_permissions: `https://*.schoology.com/*`.
  action default_popup: `popup/popup.html`. background service_worker:
  `background.js`. content_scripts on `https://*.schoology.com/*` -> `content.js`.
  options_page: `options/options.html`.
- `extension/background.js` — service worker. Top-level listeners only. Alarm
  `refresh-grades` (every 60 min, only while Chrome runs) + `chrome.runtime.onMessage`
  (`refresh-now`, `run-live-probe`, `get-dashboards`). Delegates fetching to
  schoology.js and parsing to parser.js; writes results to storage; never holds
  grades in globals.
- `extension/content.js` — runs on Schoology Grades pages (document_idle + a
  MutationObserver wait for the grades table). Scrapes the RENDERED DOM with the
  same multi-signal Missing detection as the parser, sends `{ type: 'grades-scraped',
  url, courses }` to the background, and also reports the current page URL so the
  probe can capture the exact Grades URL pattern. Must not modify the page.
- `extension/popup/` — dashboard UI. Reads `dashboards` + `settings` from
  storage on open. Parent view: one section per child + GO/NO-GO badge with
  reason. Student view: just their own dashboard, Schoology avatar
  (`pictureUrl`), class icons, NO GO/NO-GO emphasis (badge hidden unless a
  parent enabled it in settings). "Refresh now" button. "Demo data" button that
  loads the bundled fixture snapshot so the extension works out of the box with
  zero setup. Shows `updatedAt` and a stale warning if data is older than 24h.
- `extension/options/` — one settings page, saved on every change:
  Account (connection, children, Refresh now), Family rules (passing grade,
  Missing limit, GO/NO-GO badge), Display (Doing well / Not so good windows,
  panel on Schoology pages, refresh when Schoology opens = `autoRefresh`, who
  sees grades, percent/points), Classes (show/hide per child, stored in
  `realClasses` "<uid>:<courseId>"; hidden classes leave the class list and
  the passing-grade check via `withHiddenCourses`, their Missing work still
  counts), Privacy & data (clear saved grades and marks), Developer (dev
  builds: data source, live test, demo data). Profile pictures always come
  from Schoology (initials when there is none).
- `scripts/build.mjs` — `node scripts/build.mjs [--dev]`: bundles `src/*.js`
  with esbuild into `dist/`, copies manifest/popup/options/content. `--dev`
  adds `http://localhost:*/*` to host_permissions and renames the extension
  "(Dev)" so Playwright e2e can point it at the mock server. Prod build must
  NOT contain localhost permissions.

## Mock Schoology server (test/)

`test/mock-server/server.js` serves the live endpoint shapes above, with HTML
rendered in the live Grades markup by `test/mock-server/markup.js`. All people
and data are made up. Personas via `POST /login?as=student|parent`:
- student "Alex Student": Algebra 2 (68%), American Literature (82%, 1 Missing),
  United States History (95%), Advisory 11 (no grades);
- parent with "Sam Rivera" (2 Missing + a 55% class = NO-GO) and "Jamie Rivera"
  (1 Missing, all classes >= 90 = GO); the viewed child is a cookie switched by
  `/parent/home?child_uid=`.

## Tests

- Unit (vitest, `test/unit/`): `rules.test.js`, `classifier.test.js`,
  `parser.test.js` (live-markup fixture + mock markup), `schoology.test.js`
  (fetch layer against the mock server with a stub fetch).
- E2E (Playwright, `test/e2e/extension.spec.js`): launches Chromium with the
  unpacked DEV build, starts the mock server, sets `settings.schoologyBase` to
  the mock URL via the extension options page, clicks Refresh, and asserts the
  popup renders correct Missing counts and GO/NO-GO verdicts for BOTH the
  student persona and the parent persona (two children). Uses
  `chromium.launchPersistentContext` with `--load-extension`.
- `npm test` = unit tests. `npm run test:e2e` = Playwright e2e (starts mock
  server automatically). `npm run build` / `npm run build:dev` = build script.

## Probe extension (test/probe/)

Minimal standalone MV3 extension that proves (or disproves) the two unproven
points against REAL Schoology. See `test/probe/README.md` (owned by the
probe workstream). It must: capture the exact Grades URL from the logged-in UI
(content script), fetch that URL from the service worker with
credentials:'include', record the evidence object from `runLiveProbe`, and show
results in its popup. Fallback buttons in the popup: "Fetch from popup" and
"Hidden tab scrape", each recording their own evidence. Results are written to
`test/probe/LIVE-TEST-RESULTS.md` after the browser-task run. Never put
credentials in the probe, logs, or the repo.
