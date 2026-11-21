# One Feature Suite for Safari, Chrome and Firefox — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the extension's real UI and logic as a web app on the mock Schoology server, test its features once with webdriverio in Safari, Chrome and Firefox, and shrink the Playwright suite to extension-only wiring.

**Architecture:** A `--web` build aliases `webextension-polyfill` to an in-page stand-in (`test/web-harness/browser-shim.js`). Each page loads the extension's own `background.js` bundle plus the page's bundle; the two shim copies talk over `globalThis.__sgdBus`. The mock server serves `dist-web/` under `/__ext/` and adds the two script tags to its own HTML pages. A `node:test` + webdriverio suite in `test/web/` runs in the browser named by `BROWSER`.

**Tech Stack:** esbuild (existing build), webdriverio 9 (already a devDependency), `node:test`, safaridriver / chromedriver / geckodriver, vitest (unit tests), Playwright (slim extension suite), GitHub Actions (`ubuntu-latest` + `macos-26`).

**Spec:** `docs/superpowers/specs/2026-11-21-safari-web-harness-design.md`

## Global Constraints

- No `if (web)` branches in product code (`extension/`). Product changes only for real bugs that Safari exposes; small ones are fixed here, bigger ones become a skipped test with the reason in the test and the README.
- The shim lives in `test/web-harness/`, never in `extension/`. `dist-web/` is never published and is gitignored.
- `--web` implies `--dev`. Output folder `dist-web/`.
- One browser session per test file; files run with `--test-concurrency=1`.
- Waits are `waitUntil` conditions, never fixed pauses used as assertions.
- Retry: one retry per test file in a fresh session **only** for session/driver errors, never for a failed assertion; every retry is logged.
- Safari: if a session times out while a Safari is running, quit it with `osascript -e 'quit app "Safari"'`, wait for exit, retry, and print one line saying so.
- No Playwright test is deleted until its web version runs in CI in Chrome and Firefox, in the same commit.
- Local e2e habit: `npm run test:web` = Chrome only; Firefox runs in CI.
- Commits as megahirt, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No PR until Chris asks.
- Making `safari` a required check is a ruleset change: ask Chris first, after the job is green.

## Review Focus

1. **Storage values chrome.storage drops or changes** (`undefined` fields, `Date`s): the shim must store them as chrome.storage does (JSON round-trip: `undefined` keys vanish), or tests pass on behaviour the real extension doesn't have. Pinned in Task 1 (`storage drops undefined like chrome.storage`).
2. **`storage.local.get` argument forms** (`null`, a string, an array, an object of defaults): product code uses several; a wrong form silently returns `{}`. Pinned in Task 1 (`get supports null, string, array and defaults object`).
3. **Messages with no answer**: no listener at all must reject (product code relies on `.catch`), listeners that all return `undefined` resolve `undefined`, and the first non-`undefined` answer wins. Pinned in Task 1 (`sendMessage answer rules`).
4. **Storage changes made by the background reaching the page's listeners** (the refresh progress banner depends on it) and reaching other open tabs. Pinned in Task 1 (`onChanged fires for both roles and for other tabs`) and Task 6 (auto-refresh banner).
5. **A session error vs a failed assertion**: retrying a failed assertion would hide real Safari bugs. Pinned in Task 3 (`isSessionError` unit test).

---

### Task 1: Browser stand-in (shim) with unit tests

**Files:**
- Create: `test/web-harness/browser-shim.js`
- Create: `test/unit/browser-shim.test.js`

**Interfaces:**
- Produces:
  - `export function createBrowserShim({ role, bus, storage, manifest, location, open }) -> browser` where `role` is `'background' | 'page'`; `bus` is the shared object (below); `storage` is a `Storage`-like (`getItem/setItem/removeItem/key/length`); `manifest` is the parsed manifest; `location` has `href` and `origin`; `open(url)` opens a tab.
  - `export function getBus(globalObj = globalThis) -> bus`: returns or creates `globalObj.__sgdBus = { listeners: { background: [], page: [] }, storageListeners: [] }`.
  - `export default` a shim built from real globals: `createBrowserShim({ role: __WEB_ROLE__, bus: getBus(), storage: localStorage, manifest: __WEB_MANIFEST__, location, open: (u) => window.open(u, '_blank') })`. It also sets `globalThis.chrome ??= { runtime: { id: 'web-harness' } }`.
  - Storage key prefix `sgd:`; values JSON.
  - API stand-ins exactly as in the spec's table (section 1).

- [ ] **Step 1: Write the failing tests** in `test/unit/browser-shim.test.js` (vitest, node env; use a `Map`-backed fake `Storage` and a fresh `getBus({})` per test):
  - `storage round-trips under the sgd: prefix`: `set({ a: { b: 1 } })` → fake storage has key `sgd:a` = `'{"b":1}'`; `get('a')` → `{ a: { b: 1 } }`.
  - `storage drops undefined like chrome.storage`: `set({ a: { x: undefined, y: 1 } })` → `get('a')` deep-equals `{ a: { y: 1 } }`.
  - `get supports null, string, array and defaults object`: after `set({ a: 1, b: 2 })`: `get(null)` → `{ a: 1, b: 2 }`; `get('a')` → `{ a: 1 }`; `get(['a', 'z'])` → `{ a: 1 }`; `get({ a: 0, z: 9 })` → `{ a: 1, z: 9 }`.
  - `remove and clear touch only sgd: keys`: a foreign key `other` survives `clear()`.
  - `sendMessage answer rules`: page shim with no background listeners → `runtime.sendMessage({})` rejects; background listeners returning `undefined` then `Promise.resolve(7)` → resolves `7`; all `undefined` → resolves `undefined`; a page's own `onMessage` listeners never receive its own `runtime.sendMessage`.
  - `sender carries the tab`: background listener receives `sender.tab` = `{ id: 1, index: 0, url: location.href }`.
  - `tabs.sendMessage reaches page listeners`: background `tabs.sendMessage(1, m)` → page listener gets `m`, answer returned.
  - `onChanged fires for both roles and for other tabs`: background `set({ k: 1 })` → page and background `storage.onChanged` listeners get `({ k: { newValue: 1 } }, 'local')` (with `oldValue` when there was one); simulating a `storage` event for key `sgd:k` (call the shim's exported `handleStorageEvent(bus, event)`) fires listeners with the parsed old/new values; non-`sgd:` keys are ignored.
  - `tabs.query answers with this page`: → `[{ id: 1, index: 0, active: true, url: location.href }]`.
  - `getURL, getManifest, permissions`: `runtime.getURL('icons/x.png')` → `'/__ext/icons/x.png'`; `getManifest()` → the manifest passed in; `permissions.contains(anything)` → `true`; `permissions.getAll()` → `{ origins: manifest.host_permissions, permissions: manifest.permissions }`.
  - `no-op APIs exist`: `alarms.create`, `alarms.onAlarm.addListener`, `scripting.registerContentScripts`, `scripting.getRegisteredContentScripts` (→ `[]`), `runtime.onInstalled.addListener`, `runtime.onStartup.addListener`, `permissions.onAdded/onRemoved.addListener` don't throw.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run test/unit/browser-shim.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `test/web-harness/browser-shim.js`** with the interfaces above. Also export `handleStorageEvent(bus, event)`; the default export registers it on `window`'s `storage` event. `tabs.create({ url })` → `open(url)`; `tabs.update(id, { url })` → `location.assign(url)` when given; `tabs.reload` → `location.reload()`; `tabs.remove` and `tabs.getCurrent` → resolve (`getCurrent` → the `tabs.query` tab); `runtime.openOptionsPage()` → `open('/__ext/options/options.html')`. `__WEB_ROLE__` and `__WEB_MANIFEST__` are build-time defines (Task 2); guard with `typeof` so vitest can import the module.

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run test/unit/browser-shim.test.js` → PASS; `npm test` → all pass.

- [ ] **Step 5: Commit** `test/web-harness/browser-shim.js`, `test/unit/browser-shim.test.js`: "Web harness: in-page stand-in for the extension APIs".

### Task 2: `--web` build and mock-server routes

**Files:**
- Modify: `scripts/build.mjs` (flag `--web`; dist folder; alias; defines; HTML copies)
- Modify: `test/mock-server/server.js` (`createServer`/`startServer` option `webExt`; `/__ext/*`; script injection; `MOCK_WEB_EXT` env)
- Modify: `package.json` (`"build:web": "node scripts/build.mjs --web"`)
- Modify: `.gitignore` (`dist-web/`, `dist-web.build-done`)
- Test: `test/unit/mock-server-web.test.js`

**Interfaces:**
- Consumes: Task 1's shim module path and its `__WEB_ROLE__` / `__WEB_MANIFEST__` defines.
- Produces:
  - `dist-web/` with the same layout as `dist/`; `background.js` built with `__WEB_ROLE__ = "background"`, every other entry with `"page"`; `__WEB_MANIFEST__` = the final manifest JSON; esbuild `alias: { 'webextension-polyfill': <abs path to browser-shim.js> }`.
  - In `dist-web/popup/*.html` and `dist-web/options/options.html`, `<script src="/__ext/background.js"></script>` inserted before the page's own `<script>`.
  - `startServer(port, { webExt })` / `createServer({ webExt })`: `webExt` is an absolute path to a built `dist-web/`. When set: `GET /__ext/<path>` serves that file (content type by extension: `.js`, `.html`, `.css`, `.json`, `.png`, `.map`; 404 otherwise; no `..` escape), and every `text/html` response gets `<script src="/__ext/background.js"></script><script src="/__ext/content.js"></script>` before `</body>` (after the existing page-settings script).
  - `MOCK_WEB_EXT=1 npm run mock-server` serves `<repo>/dist-web`.

- [ ] **Step 1: Write the failing tests** in `test/unit/mock-server-web.test.js` (start `startServer(0, { webExt: <tmp dir with a fake background.js, content.js and popup/dashboard.html> })`, use `fetch`):
  - `serves /__ext files with the right type`: `/__ext/background.js` → 200, `content-type` starts with `text/javascript` (or `application/javascript`), body equals the fixture.
  - `refuses paths outside dist-web`: `/__ext/../package.json` and `/__ext/%2e%2e/package.json` → 404.
  - `injects the two scripts into mock pages`: `/login` HTML contains `<script src="/__ext/background.js"></script><script src="/__ext/content.js"></script></body>`.
  - `no injection without webExt`: `startServer(0)` → `/login` contains no `/__ext/`.

- [ ] **Step 2: Run and see them fail**: `npx vitest run test/unit/mock-server-web.test.js` → FAIL.
- [ ] **Step 3: Implement the server option, then the build flag.**
- [ ] **Step 4: Verify**
  - `npx vitest run` → all pass.
  - `npm run build:web` → prints `Built DEV extension … -> …/dist-web`; `grep -c "__ext/background.js" dist-web/popup/dashboard.html` → `1`.
  - `npm run build:dev && npx playwright test --project=chromium` → still 11 passed (dist/ unchanged by the flag).
- [ ] **Step 5: Commit**: "Web harness: --web build and mock server serving it".

### Task 3: Feature-suite helpers and the smoke scenario in three browsers

**Files:**
- Create: `test/web/helpers.mjs`
- Create: `test/web/smoke.web.mjs`
- Create: `test/unit/web-helpers.test.js`
- Modify: `package.json` scripts (Node 24 expands the quoted glob itself):
  - `"test:web": "BROWSER=chrome node --test --test-concurrency=1 'test/web/*.web.mjs'"`
  - `"test:web:firefox": "BROWSER=firefox node --test --test-concurrency=1 'test/web/*.web.mjs'"`
  - `"test:safari": "BROWSER=safari node --test --test-concurrency=1 'test/web/*.web.mjs'"`

**Interfaces:**
- Consumes: Task 2's `startServer(port, { webExt })`, `dist-web/`.
- Produces (all exported from `test/web/helpers.mjs`):
  - `BROWSER` (`'chrome' | 'firefox' | 'safari'`, default `'chrome'`), `HAS_WEB_BUILD` (boolean), `skipReason()` → `false` or a string (no `dist-web/`; Safari not on macOS).
  - `capabilitiesFor(browser) -> object`: chrome `{ browserName: 'chrome', 'goog:chromeOptions': { args: ['--headless=new', '--window-size=1280,900'] } }`; firefox `{ browserName: 'firefox', 'moz:firefoxOptions': { args: ['-headless', '-width=1280', '-height=900'] } }`; safari `{ browserName: 'safari' }`.
  - `isSessionError(err) -> boolean`: true for session-not-created, "timed out while connecting to a Safari instance", ECONNREFUSED/ECONNRESET to the driver, "invalid session id"; false for `AssertionError` and `waitUntil` timeouts.
  - `withSession(fn: (ctx) => Promise<void>) -> Promise<void>`: starts the mock (`startServer(0, { webExt })`, base `http://localhost:<port>`), opens a session, runs `fn({ browser, base, mock })`, always closes both. On `isSessionError`: log `[web] session error, retrying once: <message>`; for Safari, if `pgrep -x Safari` finds one, run `osascript -e 'quit app "Safari"'`, wait up to 20 s for exit, log `[web] quit Safari so safaridriver can start its own`; retry once.
  - `signIn(browser, base, persona)`: `/login?as=<persona>`, fill and submit the form from the page (the panel may cover the button), wait for URL `${base}/home`.
  - `setSettings(browser, patch)`: in the page, merge `patch` into `localStorage['sgd:settings']` (JSON).
  - `useMock(browser, base)`: `setSettings(browser, { schoologyBase: base, showGoNoGo: true })`.
  - `panelText(browser) -> string | null`: `#sgd-panel-host` shadow root `.sheet` `innerText`, whitespace collapsed.
  - `clickInPanel(browser, re: RegExp) -> boolean`: click the first button/link in the shadow root whose text or `aria-label` matches.
  - `waitForPanel(browser, predicate, { timeout = 30000, message })`.
  - `requestsTo(mock, pathPrefix) -> { count(): number }`: counts requests via `mock.server.on('request')`.

- [ ] **Step 1: Write the failing tests**
  - `test/unit/web-helpers.test.js`: `isSessionError` true for `new Error('Could not create a session: The session timed out while connecting to a Safari instance')`, `Object.assign(new Error('x'), { name: 'SessionNotCreatedError' })`, `new Error('connect ECONNREFUSED 127.0.0.1:4444')`; false for `new assert.AssertionError({ message: 'x' })` and `new Error('waitUntil condition timed out after 30000ms')`. `capabilitiesFor('safari')` deep-equals `{ browserName: 'safari' }`.
  - `test/web/smoke.web.mjs`, test `parent dashboard in the panel` (skip with `skipReason()`): `withSession`; `signIn(parent)`; `useMock`; reload `/home`; `clickInPanel(/Refresh grades/)`; wait until `requestsTo(mock, '/iapi/parent/info').count() > 0` and panel text matches `/Sam Rivera/` and `/Jamie/`; assert text matches `/Data: Mock server/` and `/NO GO/`, and doesn't match `/Please log in to Schoology/`.
- [ ] **Step 2: Run and see them fail**: `npx vitest run test/unit/web-helpers.test.js` → FAIL; `npm run test:web` → FAIL (no helpers).
- [ ] **Step 3: Implement `test/web/helpers.mjs`.** Fix any product bug the smoke exposes per Global Constraints.
- [ ] **Step 4: Verify in all three browsers**
  - `npm run build:web && npm run test:web` → `pass 1`.
  - `npm run test:web:firefox` → `pass 1`.
  - `npm run test:safari` → `pass 1` (Chris's Mac; Safari may be quit first, one log line).
  - Without `dist-web/`: `npm run test:web` → `skipped 1`, exit 0.
- [ ] **Step 5: Commit**: "Web feature suite: helpers and parent smoke in Chrome, Firefox and Safari".

### Task 4: Student and parent scenarios (with dashboard, print, chart, records)

**Files:**
- Create: `test/web/student.web.mjs`, `test/web/parent.web.mjs`

**Interfaces:**
- Consumes: Task 3 helpers. Source scenarios: `test/e2e/extension.spec.js` tests at lines 273 (student) and 901 (parent), plus the `shareFromPopup` helper at the same file.

- [ ] **Step 1: Write the tests**, carrying over every assertion of the Playwright originals that doesn't need an extension API:
  - `student.web.mjs`: "student persona: 1 Missing, no verdict shown to students, quarter grades": `Missing · 1`, `Persuasive Essay Draft`, name `Alex Student`, no GO/NO-GO badge text, quarter grade columns as in the original; the grade chart link href = `${base}/course/1001/student_grades` (original line 313).
  - `parent.web.mjs`: "parent persona: TWO child dashboards — Sam NO-GO, Jamie GO, submitted work waiting": Sam `NO-GO` + `Missing · 2`, Jamie `GO` + `Missing · 1` + `Poetry Analysis Essay`; switching children with the panel's child switcher; the Share flow with stubbed `navigator.share` (port `shareFromPopup` via `browser.execute`), expecting `grades-dashboard-jamie-YYYY-MM-DD.png image/png`.
  - In `parent.web.mjs`, a second test "dashboard page and print page show the same dashboard": open `${base}/__ext/popup/dashboard.html`, see Sam and Jamie; press Print, switch to the new window, see the chosen child's name and a records section (`🏆` heading or `RECORDS`).
- [ ] **Step 2: Run in Chrome**: `npm run test:web` → all pass. If an assertion fails because the harness differs from the extension (not a product bug), fix the harness, not the assertion.
- [ ] **Step 3: Run in Firefox and Safari**: `npm run test:web:firefox`, `npm run test:safari` → all pass, or a product bug handled per Global Constraints.
- [ ] **Step 4: Commit**: "Web feature suite: student and parent scenarios".

### Task 5: Panel scenarios

**Files:**
- Create: `test/web/panel.web.mjs`

**Interfaces:**
- Consumes: Task 3 helpers; originals at spec lines 708 and 733.

- [ ] **Step 1: Write the tests**: "in-page panel on Schoology pages: open by default, closes, reopens, remembered" and "in-page panel on a narrow screen closes when a link in it is opened". Narrow screen: `browser.setWindowSize(400, 800)` (Safari: assert the resulting `window.innerWidth < DOCK_MIN_WIDTH` before continuing, since Safari may clamp sizes). "Remembered" is checked across a reload of the same origin (shared `localStorage`).
- [ ] **Step 2: Run in all three browsers** (`test:web`, `test:web:firefox`, `test:safari`) → pass.
- [ ] **Step 3: Commit**: "Web feature suite: panel scenarios".

### Task 6: Auto-refresh and per-person data scenarios

**Files:**
- Create: `test/web/refresh.web.mjs`, `test/web/people.web.mjs`

**Interfaces:**
- Consumes: Task 3 helpers; originals at spec lines 852 and 441. Slow answers: `startServer` already takes `delayMs`; give `withSession` an optional `{ delayMs }` passed through.

- [ ] **Step 1: Write the tests**:
  - `refresh.web.mjs`: "refreshes by itself when a Schoology page loads, with banner, progress and a disabled button": with `delayMs: 700`, loading `/home` shows the refresh banner and progress, the Refresh button is disabled until done, then enabled with data.
  - `people.web.mjs`: "each person signed in on a site has their own data; signed out shows the old data with a banner": student then student2 then logout, as in the original.
- [ ] **Step 2: Run in all three browsers** → pass.
- [ ] **Step 3: Commit**: "Web feature suite: auto-refresh and per-person scenarios".

### Task 7: Settings scenarios

**Files:**
- Create: `test/web/settings.web.mjs`

**Interfaces:**
- Consumes: Task 3 helpers; originals at spec lines 557 and 636. Settings page URL `${base}/__ext/options/options.html`.

- [ ] **Step 1: Write the tests**: "settings page: one auto-saving page; students get no Family rules" and "settings: Clear data asks in the page, greys out when empty; demo mode shows made-up students and reads nothing" (demo mode "reads nothing": `requestsTo(mock, '/')` count doesn't grow after turning it on and pressing Refresh).
- [ ] **Step 2: Run in all three browsers** → pass. (These two were Chromium-only in Playwright; they now also run in Firefox and Safari.)
- [ ] **Step 3: Commit**: "Web feature suite: settings scenarios".

### Task 8: Slim the Playwright suite, wire CI, docs

**Files:**
- Modify: `test/e2e/extension.spec.js` (add wiring smoke; delete the 8 moved tests and helpers only they used)
- Modify: `.github/workflows/ci.yml`
- Modify: `test/README.md`, `DEVELOPER.md` (test commands), `test/safari/smoke.safari.mjs` header (now "manual extension check")

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Add the Playwright wiring test** "extension wiring: background refresh fills the dashboard page and the in-page panel" (Chromium and Firefox): load the DEV extension, `loginAs(parent)`, `configureExtension`, `triggerRefresh`; `chrome.storage.local` has a `dashboards@<mock origin>` entry with 2 children; the dashboard page (Chromium) or panel (Firefox) shows `Sam Rivera` and `Jamie`; on `${mockBase}/home` the `#sgd-panel-host` panel shows them too.
- [ ] **Step 2: Run**: `npm run build:dev && npx playwright test --project=chromium` → passes (12 tests before deletion).
- [ ] **Step 3: Delete the 8 moved tests** (spec lines 273, 441, 557, 636, 708, 733, 852, 901 today) and any helper left unused. Keep: the two "background requests … reads through the open Schoology page" tests, "toolbar popup", and the new wiring test.
- [ ] **Step 4: CI**, in `.github/workflows/ci.yml`:
  - job `test` (unchanged name, still the required check): after the Firefox dev build add `npm run build:web`; after the Playwright step add `npm run test:web` and `npm run test:web:firefox`.
  - new job `safari`: `runs-on: macos-26`, `timeout-minutes: 20`, same triggers; steps: checkout, Node 24, `npm ci`, `sudo safaridriver --enable`, `npm run build:web`, `npm run test:safari`.
- [ ] **Step 5: Docs**: `test/README.md` gets the two-suite overview (features on the web build in three browsers; extension wiring in Playwright), the commands, the shim's limits (each page runs its own background; hidden-tab fallback not exercised; extension-only things listed in the spec's non-goals), the Safari quit behaviour and one-time "Terminal wants to control Safari" prompt; the old extension smoke section is relabelled as the manual extension check.
- [ ] **Step 6: Verify locally**: `npm test`; `npm run build:dev && npm run build:firefox && npm run build:web`; `npx playwright test --project=chromium` → 4 passed (wiring, 2× page-read, toolbar popup); `npm run test:web` and `npm run test:safari` → all pass.
- [ ] **Step 7: Commit**: "Tests: features run once in Safari, Chrome and Firefox; Playwright keeps extension wiring". Push the branch only when Chris asks for the PR; CI results then decide the ruleset question.
- [ ] **Step 8: Ask Chris** whether to add `safari` to the "main" ruleset's required checks (repository setting), once the `safari` job is green on the PR.
