# Build notes — Schoology Dashboard extension (core build, 2026-11-06)

Safari-first, Chrome second. Shared codebase uses `webextension-polyfill`
(`browser.*`, Promise-based) everywhere; no `chrome.*` callbacks, no
offscreen document, no sidePanel, no declarativeNetRequest in the critical
path. The bundled pure-JS, spec-compliant parser (`parse5`, via `src/html-dom.js`) is the portable
default. No server, no LLM, no Schoology password stored, no Schoology
REST API/OAuth — auth is the user's logged-in browser session cookies.

## What was built (all under `extension/`, plus `scripts/build.mjs`)

- `manifest.json` — MV3; permissions `storage, alarms, scripting, tabs`;
  host_permissions `https://*.schoology.com/*` plus schools' own Schoology addresses (`src/sites.js`, e.g. `https://schoology.npchristian.org/*`); action popup
  `popup/popup.html`; background service worker `background.js`;
  content script `content.js` on the same sites;
  options page `options/options.html`; icons 16/48/128 (green rounded
  square with a white "S", generated with PIL/DejaVu).
- `src/rules.js` — `DEFAULT_SETTINGS`, `computeVerdict`, `summarizeStudent`
  (accepts an optional third `turnedInIds` Set/Array, also read from
  `settings.turnedInIds`). Exact badge wording: "NO-GO — Missing work",
  "NO-GO — Low grades", "NO-GO — Missing work + Low grades". 75 passes;
  NO-GO at missingCount >= 2 OR any class grade < threshold. Missing =
  only explicitly marked Missing; a 0 is never Missing; ungraded +
  not-Missing is in-between/OK; past-due-and-time with no grade and not
  Missing disappears; no due time = end of day; "Not so good" = graded
  below threshold from the past `notSoGoodDays` (7) days.
- `src/classifier.js` — `classifySection`, scoring per SPEC (+40 period
  grade, +3/graded item capped +30, +1/assignment capped +10, −15 for
  advisory/study-hall/house-group/homeroom/mentor names); >=60 include,
  25–59 check, <25 skip.
- `src/parser.js` — `parseGradesHtml` on the SPEC fixture structure, with
  multi-signal Missing detection in SPEC order and the `PARSE_EMPTY`
  self-check. Header states the fixture structure is MODELLED on known
  Schoology Grades structure, NOT verified live DOM; selectors must be
  re-validated against live pages.
- `src/schoology.js` — `createClient({ baseUrl, fetchImpl })`:
  `detectAccount` (parent via `GET {base}/iapi/parent/info`, else
  `{base}/home` logged-in check), `fetchGradesPage`, `runLiveProbe`
  (evidence object per SPEC; the grades URL is never guessed — it comes
  from the logged-in UI or storage), `fetchStudentDashboard`,
  `fetchParentDashboards` (per-child overdue/feed/grade-report, each
  dashboard labelled with which source supplied it). All fetches use
  `{ credentials: 'include' }`.
- `src/storage.js` — wrappers over `browser.storage.local` for keys
  `settings`, `dashboards`, `liveTest`, `account`, plus `turnedIn`
  (manually marked-turned-in assignment ids per student).
- `background.js` — service worker, top-level listeners only. Alarm
  `refresh-grades` every 60 min; messages `refresh-now`,
  `run-live-probe`, `get-dashboards`, `grades-scraped`,
  `grades-page-url`, `refresh-via-hidden-tab`. Never holds grades in
  globals; storage is the source of truth. Hidden-tab fallback
  (`tabs.create({ active: false })` + content-script scrape +
  `tabs.remove`) is implemented as a labelled, on-demand-only function.
- `content.js` — read-only scrape of the rendered DOM (same multi-signal
  Missing detection), MutationObserver until the grades table appears,
  sends `{ type: 'grades-scraped', url, courses }` and reports the page
  URL for probe URL capture. Never modifies the page.
- `popup/` — dashboard UI: parent view (one section per child) and
  student view (avatar, class icons, badge hidden unless
  `settings.showGoNoGo`); sections Missing / Due soon (Due today /
  Due tomorrow badges) / Doing well / Not so good / Awaiting teacher;
  "Refresh now", "Load demo data" (`demo-data.json`: Sam Rivera —
  2 Missing + 55% class = NO-GO; Jamie Rivera — 1 Missing, all classes
  >= 90 = GO; demo due dates are shifted to today on load so Due
  today/tomorrow always render), updatedAt + stale warning past 24h,
  gray ✓ mark-as-turned-in with Undo persisted in storage.
- `options/` — 6-step setup wizard (Connect → Profile → Classes →
  Icons → Rules → Review) plus Advanced (Schoology base URL, "Run live
  connection test" showing the `runLiveProbe` evidence). Classes step
  uses `classifier.js`; Profile uses the Schoology `pictureUrl` by
  default, upload/pick-from-list is fallback only.
- `scripts/build.mjs` — `node scripts/build.mjs [--dev]`; esbuild-bundles
  background, content, popup, options into `dist/`, copies manifest,
  HTML/CSS, icons, demo-data.json. `--dev` adds
  `http://localhost:*/*` and renames the extension "(Dev)"; prod never
  contains localhost permissions.

## Verification done

- `npm run build` — succeeds; prod `dist/manifest.json` is valid JSON,
  name "Schoology Dashboard", host_permissions only
  `https://*.schoology.com/*` (no localhost).
- `npm run build:dev` — succeeds; name "Schoology Dashboard (Dev)",
  host_permissions add `http://localhost:*/*`.
- `npm run lint` (`node --check` on the six source files) — clean.
- `node --check` on all four `dist/` bundles — clean.
- Node smoke test of the pure modules against the SPEC fixture HTML:
  parser marks the Missing item (score 0 + exception icon) as `missing`
  and a genuine `0/25` as `graded` (never inferred Missing from 0);
  `PARSE_EMPTY` fires on a grades-looking page with zero rows;
  verdicts: 1 Missing + 55% class → NO-GO (Low grades); 2 Missing →
  NO-GO (Missing work); classifier: real class → include (80),
  "House Group 1" → skip (−14); `storage.js` in-memory fallback works
  in Node; `detectAccount`/`runLiveProbe`/`fetchParentDashboards` work
  against a stub fetch (parent detected, per-child dashboard labelled
  with sources). `dist/` was left as the PROD build.

## Deviations from SPEC.md (and why)

1. `src/storage.js` does NOT statically `import browser from
   'webextension-polyfill'`. The polyfill throws at import time in Node
   ("This script should only be loaded in a browser extension") unless
   `chrome.runtime.id` exists, so a static import would make the module
   unimportable by unit tests — exactly what the task's in-memory
   fallback requirement forbids. Instead the entry points
   (background/content/popup/options) import the polyfill, which installs
   the global `browser` namespace, and `storage.js` reads
   `globalThis.browser.storage.local` when present, falling back to an
   in-memory Map otherwise. Same API surface, same behaviour in the
   extension.
2. `summarizeStudent` returns `verdict` as the full `computeVerdict`
   object `{ verdict, reasons }` (not a bare string), so the popup can
   show the exact badge reason without recomputing.
3. `runLiveProbe(gradesUrl, { assignmentTitle })` takes the assignment
   title as an optional second argument; `assignmentTitleChecked` is the
   title string checked (or `null` when none was supplied) and
   `containsAssignmentTitle` is whether that title appeared in the body.
4. Extra storage key `turnedIn` (`{ [studentUid]: [assignmentId] }`)
   holds manually marked-turned-in ids; SPEC's four keys are unchanged.
5. `fetchStudentDashboard` / `fetchParentDashboards` accept optional
   `{ turnedInIds }` / `{ turnedInIdsByStudent }` so the background can
   re-apply manual turn-ins after a refresh.
6. `background.js` re-exports `parseGradesHtml` (one line) to keep the
   parser in the bundled dependency graph explicit.

## NOT verified (honest limits)

- The extension has NOT been loaded in a real browser (no live browser
  available to this agent): Safari/Chrome loading, popup rendering,
  content-script scraping, service-worker fetch cookie behaviour, and
  the live probe against real Schoology are all unverified. The
  parser/content-script selectors are modelled on the SPEC fixture, not
  on live Schoology DOM, and must be re-validated live.
- The hidden-tab fallback is implemented but untested in a browser.
- E2E (Playwright) and unit (vitest) suites belong to other workstreams;
  only the Node smoke test above was run here.
