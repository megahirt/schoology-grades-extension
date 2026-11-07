# Schoology Dashboard Extension — build contract (SPEC)

Repo: `schoology-grades-extension` (public, @sabaisnoopy). Local working copy:
`~/workspace/schoology-dashboard-extension/`. This file is the interface contract
between the three build workstreams. Do not change an exported function name or a
storage key without updating this file and every caller.

## Platform priority: SAFARI FIRST, Chrome second (decision 2026-11-06)

Students at North Point Christian use Safari, so the Safari version is what
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
  Chris must personally: Apple ID + 2FA, enrol as Individual, verify identity,
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

Defaults (the Hirt family rules — defaults, NOT hard-coded for everyone):
- `gradeThreshold: 75` (75 passes, below 75 is NO-GO)
- `missingThreshold: 2` (NO-GO if missingCount >= 2; one Missing alone is GO)
- Badge states the reason: "NO-GO — Missing work", "NO-GO — Low grades",
  "NO-GO — Missing work + Low grades", otherwise "GO".
- "Missing" = ONLY items explicitly marked Missing on the Schoology Grades page.
  Ungraded + not-Missing = in-between, OK, not counted. To Do overdue flags ignored.
- "Not so good" section: graded items below the grade threshold from the past
  7 days only (by the date shown on the row).
- Due soon: outstanding (not yet graded) items due today / tomorrow. Items past
  their due date AND time with no grade and NOT Missing disappear entirely
  (may be noted in fine print only). No due time given = due at end of day.
  Missing items always stay in Missing.
- Manual "mark as turned in" (undoable) moves a Missing item to "Awaiting teacher"
  until Schoology updates; manually-marked items do NOT count as Missing.

`extension/src/rules.js` (pure JS, no chrome APIs, importable by node tests):
- `DEFAULT_SETTINGS` — object: `{ gradeThreshold: 75, missingThreshold: 2,
  notSoGoodDays: 7, showGoNoGo: true, gradeVisibility: 'both',
  gradeDisplay: 'percent' }`
- `computeVerdict({ missingCount, lowestClassGrade, settings })` ->
  `{ verdict: 'GO'|'NO-GO', reasons: string[] }` where reasons use the exact
  badge wording above.
- `summarizeStudent(courses, settings)` -> per-student summary:
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
  little grade information. The wizard shows the recommendation; the user makes
  the final call.

## Grades HTML parser

`extension/src/parser.js` (pure JS; uses `node-html-parser` so it runs in a
service worker with no DOM):
- `parseGradesHtml(html, { courseId, courseName } = {})` ->
  `{ courses: [{ id, name, grade (number|null, percent), assignments: [...] }],
    parseWarnings: string[] }`.
- Assignment: `{ id, title, due (ISO string|null), dueText, score (number|null),
  maxPoints (number|null), status: 'missing'|'incomplete'|'excused'|'graded'|'pending'|'overdue',
  sourceUrl }`.
- Missing detection, multi-signal, in order: (1) an element inside the grade cell
  whose `title` or `aria-label` contains "missing" (case-insensitive); (2) a class
  name containing "missing" on the grade cell or its children; (3) cell text
  exactly "Missing". NEVER infer Missing from a 0 score or from overdue alone.
- SELF-CHECK: if the HTML looks like a grades page (contains a grades table or
  course heading) but zero courses/assignments were parsed, return
  `{ courses: [], parseWarnings: [...], error: 'PARSE_EMPTY' }` — callers must
  surface "Schoology page changed — could not read grades" instead of a green GO.
- The parser must ALSO handle the fixture HTML defined below. Fixture structure
  is MODELLED on the known Schoology Grades structure (grades table, Missing
  markers) — it is NOT verified live Schoology DOM. The README and parser header
  must say so, and selectors must be re-validated against live pages.

### Fixture HTML structure (the contract between parser and mock server)

```html
<div class="gradebook">
  <section class="course-grades" data-course-id="8508768642" data-course-name="BPL American Literature">
    <h2 class="course-name">BPL American Literature</h2>
    <span class="course-grade">55%</span>
    <table class="grades-table"><tbody>
      <tr class="assignment-row" data-assignment-id="8631342075">
        <td class="assignment-title">Propaganda Script</td>
        <td class="assignment-due" data-due="2026-11-03T23:59:00">Nov 3</td>
        <td class="assignment-grade">
          <span class="grade-score">0</span>
          <span class="exception-icon exception-missing" title="Missing"></span>
        </td>
      </tr>
      <!-- graded: <span class="grade-score">42/50</span>, no exception icon -->
      <!-- incomplete: <span class="exception-icon exception-incomplete" title="Incomplete"></span> -->
      <!-- excused: <span class="exception-icon exception-excused" title="Excused"></span> -->
      <!-- pending: <span class="grade-score">—</span>, no exception icon -->
    </tbody></table>
  </section>
</div>
```

## Schoology fetch layer

`extension/src/schoology.js` (uses global `fetch`; no chrome APIs except via
injected `fetchImpl` for tests):
- `createClient({ baseUrl, fetchImpl = fetch })` ->
  `{ detectAccount(), fetchGradesPage(url), fetchStudentDashboard(),
    fetchParentDashboards(), runLiveProbe(gradesUrl) }`.
- `baseUrl` default `https://app.schoology.com`. All requests use
  `{ credentials: 'include' }`.
- `detectAccount()` -> `{ type: 'parent'|'student'|'loggedOut'|'unknown',
  children: [{ uid, name, pictureUrl }], studentName, evidence }`.
  Implementation: `GET {base}/iapi/parent/info`; if it returns child profiles,
  type='parent'. Otherwise fetch `{base}/home` and treat a logged-in page as
  student (record evidence). A redirect to /login or a login form means loggedOut.
  For student accounts `studentName` is extracted from the home page
  ("Welcome, <name>" heading or a data-user-name attribute); 'Student' when
  nothing matches. Never guessed from a URL or cookie.
- `fetchGradesPage(url)` -> `{ status, finalUrl, html, loggedIn }`. loggedIn=false
  if finalUrl contains '/login' or html contains a login form marker.
- `fetchStudentDashboard()` also returns `studentName`.
- `runLiveProbe(gradesUrl)` -> evidence object:
  `{ status, finalUrl, loggedIn, bodyLength, containsAssignmentTitle,
    containsGrade, containsMissing, assignmentTitleChecked, checkedAt }`.
  This is what the probe extension records. It must NEVER guess the grades URL:
  the URL comes from the logged-in UI (content script captures it) or from
  storage set by the user.
- Parent flow: `fetchParentDashboards()` fetches `/iapi/parent/info`, then for
  each child fetches per-child data (`/iapi/parent/overdue_submissions/<uid>`,
  `/home/feed?children=<uid>`). Grades come from the child's OWN course pages
  first: the parent home page groups each child's course Grades links in a
  `<section class="child" data-child-uid="...">` block, and the extension
  fetches those per-child links. FALLBACK ONLY: the combined parent grade
  report (`{base}/parent/grades_attendance/grades`), filtered by the
  per-section attribution the parser captures (`data-child-uid` /
  `data-student` on each course section). If report courses cannot be
  attributed to a child, they are NEVER assigned to that child: the dashboard
  is returned with empty courses, `error: 'NO_CHILD_ATTRIBUTION'`, a parse
  warning, and verdict UNKNOWN — a missing verdict is honest, a guessed one
  is not. The popup renders the UNKNOWN badge + warnings and suppresses the
  "Nothing missing" line. Each dashboard is labelled with which source
  supplied it (`source: { overdue, feed, childCoursePages, gradesReport,
  attribution }`).
- Parser course objects also carry `childUid` / `studentName` (null when the
  page does not attribute the section) — see parser.js.

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
- `extension/options/` — settings + 6-step setup wizard (Connect → Profile →
  Classes → Icons → Rules → Review). Classes step uses classifier.js and shows
  include/check/skip recommendations. Profile step pulls avatar from Schoology
  `pictureUrl` by default; upload/pick-from-list is fallback only.
- `scripts/build.mjs` — `node scripts/build.mjs [--dev]`: bundles `src/*.js`
  with esbuild into `dist/`, copies manifest/popup/options/content. `--dev`
  adds `http://localhost:*/*` to host_permissions and renames the extension
  "(Dev)" so Playwright e2e can point it at the mock server. Prod build must
  NOT contain localhost permissions.

## Mock Schoology server (test/)

`test/mock-server/server.js` — plain Node `http` server, no framework. Port from
`PORT` env (default 8123).
- Login: `GET /login` returns a login form; `POST /login` sets cookie
  `mock-session=1` and redirects to `/home`. Any request without the cookie
  redirects to `/login` (mirrors real Schoology).
- `GET /home` — student home listing courses with links to `/course/<id>/grades`.
- `GET /course/<id>/grades` — fixture Grades HTML for that course (fixture
  structure above). Student mode serves one student's courses.
- `GET /parent/grades_attendance/grades` — parent grade report HTML.
- `GET /iapi/parent/info` — JSON `{ view_mode: 1, view_child, children: [...] }`.
- `GET /iapi/parent/overdue_submissions/<uid>` — JSON overdue list for that child.
- `GET /home/feed?children=<uid>` — JSON activity for that child.
- Two personas, chosen by query `?as=student` / `?as=parent` on /login (sets a
  second cookie `mock-persona`). Student persona: one student ("Alex Student")
  with 3 courses (one below 75, one Missing item, one clean). Parent persona:
  two children ("Luis Hirt" with 2 Missing + a class at 55% = NO-GO, and "Emma
  Hirt" with 1 Missing and all classes >= 90 = GO).
- Fixtures live in `test/mock-server/fixtures/` and are labelled as fixtures
  modelled on the known Schoology Grades structure — NOT verified live DOM.

## Tests

- Unit (vitest, `test/unit/`): `rules.test.js`, `classifier.test.js`,
  `parser.test.js` (parses the fixture HTML files), `schoology.test.js`
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
