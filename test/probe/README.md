# Schoology Live Probe

A minimal standalone Manifest V3 extension that proves — or disproves — the
two unproven points the whole dashboard depends on, against **real**
Schoology:

1. A background service worker `fetch(url, {credentials:'include'})` returns
   the **logged-in** Grades HTML, not a `/login` redirect.
2. The fetched HTML contains the grades table / Missing markers (i.e. the
   Grades page is server-rendered enough for fetch+parse), not an empty
   JS shell.

It is a **test tool only**, separate from the real extension in
`extension/`. It never modifies a Schoology page, never stores a password,
never sends data anywhere. Auth is the user's existing logged-in browser
session (cookies). No Schoology API, no OAuth.

> **Status: NOT YET RUN — no live Schoology test has been performed.**
> Results go in [LIVE-TEST-RESULTS.md](./LIVE-TEST-RESULTS.md) after the
> browser-task run. Do not claim the probe passed until that file holds
> real evidence.

## What it is

`probe-extension/` — its own MV3 extension:

| File | Role |
|---|---|
| `manifest.json` | MV3, `storage` + `tabs` permissions, host permission `https://*.schoology.com/*`, content script on Schoology, popup |
| `probe-content.js` | Read-only. On a Grades-like page, captures the **exact** page URL, one sample assignment title from the rendered DOM, and whether "Missing" text appears. Sends `{type:'grades-page-seen', url, sampleTitle, domHasMissing}` to the background. Also answers `{type:'scrape-now'}` for the hidden-tab flow. Never modifies the page. Never guesses URL patterns. |
| `probe-background.js` | Service worker (webextension-polyfill, `browser.*` APIs — Safari-compatible). On `{type:'run-probe'}` it fetches the captured URL with `credentials:'include'` and records the evidence object `{status, finalUrl, loggedIn, bodyLength, containsAssignmentTitle, containsGrade, containsMissing, assignmentTitleChecked, checkedAt, fetchContext:'service-worker'}`. `loggedIn=false` if the final URL contains `/login` or the body contains a login form. Also runs the hidden-tab probe. Appends to `browser.storage.local` key `probeResults` (never overwrites). |
| `probe-popup.html` / `probe-popup.js` | Shows the captured Grades URL + latest results and a verdict line. Three buttons (see below). The popup fetch runs the same fetch in the popup page context (`fetchContext:'popup'`). |
| `vendor/browser-polyfill.min.js` | Vendored copy of `webextension-polyfill` 0.12.0 (from `node_modules`), so the probe is self-contained when loaded unpacked. |

## Exact steps for the browser task

The person running this must already be signed in to Schoology **as the
parent** (the saved Schoology parent login from the Secure Vault — the
browser task signs in; never paste a password into the probe, a log, or
the repo).

1. **Load the probe unpacked.**
   - Chrome: `chrome://extensions` → Developer mode on → Load unpacked →
     select `test/probe/probe-extension/`.
   - Safari (primary target — run it there first if possible): no Xcode
     project needed. Safari → Settings → Developer → **Allow Unsigned
     Extensions** (this resets every time Safari quits — re-enable each
     session) → **Add Temporary Extension…** → pick the
     `test/probe/probe-extension/` folder. It unloads when Safari quits.
     (Full Safari pipeline: `docs/safari.md`.)
   - **Enabling ≠ granting access.** After loading/ticking the probe on,
     grant it Schoology access separately (Safari → Settings →
     Extensions → select the probe → allow on `schoology.com`, or
     accept the "Always allow on this website" prompt on first visit).
     Until access is granted, the content script never runs and nothing
     will be captured — that looks like a probe failure, but it is a
     permissions step, not a fetch result. If Safari loading is blocked,
     run Chrome first and note that Safari is still untested.
2. **Sign in to Schoology as the parent** (if not already signed in).
   Open Schoology, confirm the parent account is active and the child
   switcher shows the children.
3. **Open a course Grades page.** Use the normal UI: switch to a child if
   needed, open a course, open its Grades page. Do **not** type a guessed
   Grades URL — the probe captures whatever URL the UI actually used.
   Wait a few seconds on the page so the content script can report.
4. **Open the probe popup** (click the probe icon in the toolbar). Check
   "Captured Grades page" shows the URL you just visited, a sample
   assignment title, and whether the rendered DOM has "Missing".
   - If nothing is captured: the page may not have looked grades-like to
     the content script, or the extension did not load. Reload the Grades
     page, wait 5 seconds, reopen the popup. If still nothing, record
     that as the outcome — do not proceed to step 5 with a guessed URL.
5. **Run the three probes in order**, waiting for each to finish:
   1. **"Probe from service worker"** (primary test) — the background
      fetches the captured URL.
   2. **"Probe from popup"** — the same fetch executed in the popup page.
   3. **"Hidden tab scrape"** — opens the Grades URL in a background tab
      (`active:false`), lets the content script report the rendered DOM,
      closes the tab (up to 30 s).
6. **Copy the results.** Click "Copy all results (JSON)" and paste the
   JSON into [LIVE-TEST-RESULTS.md](./LIVE-TEST-RESULTS.md), filling in
   the tables there. Also note the verdict line shown in the popup.

## What each outcome means

Popup verdict line:

- **PROVEN** — service-worker fetch returned `loggedIn=true`, found the
  sample assignment title in the fetched HTML, and `containsMissing`
  matches the rendered DOM. The primary architecture (SW fetch + bundled
  parser) is viable. Build on it.
- **FAILED** — a service-worker entry exists but does not meet PROVEN.
  Look at the evidence: `status` / `finalUrl` tells you whether it was a
  login redirect (cookies not attached in the SW) or a logged-in page
  missing the title/Missing (JS-rendered shell). Then check probes 2
  and 3:
  - Popup fetch PROVEN but SW FAILED → cookies work from an extension
    page but not the service worker; the dashboard needs the popup-page
    or another path for background refresh.
  - Only hidden-tab PROVEN → the Grades page is JS-rendered; the
    dashboard needs the hidden-tab fallback (slower, visible in the tab
    strip, disclose it in the store listing) or the internal
    `/iapi/parent/*` JSON endpoints.
  - All three FAILED → the session is not reaching Schoology from the
    extension at all; record the exact `status`/`finalUrl`/`error` and
    stop — do not guess a fix.
- **INCONCLUSIVE** — no service-worker entry yet, or no DOM capture to
  compare against. Re-run from step 3.

## Evidence to capture back

For each probe: `status`, `finalUrl`, `loggedIn`, `bodyLength`,
`containsAssignmentTitle`, `containsGrade`, `containsMissing`,
`assignmentTitleChecked`, `checkedAt`, `fetchContext`, plus the exact
Grades URL pattern observed and the sample title checked. If sign-in is
blocked at any point, report the blocker instead of claiming a pass.

## Caveats

- Fixture HTML in `test/mock-server/fixtures/` is **modelled on** the
  known Schoology Grades structure — it is **not** verified live DOM.
  The probe's selectors are heuristics; the live run is what validates
  them.
- Whether HTML Grades pages accept a per-child URL parameter is
  **unverified** — the probe captures one child's Grades URL as visited;
  repeat step 3 for a second child if applicable and record whether the
  URL pattern differs.
- `GET /iapi/parent/info` parent detection (child profiles, `view_mode`,
  `view_child`) is a research finding, not a verified live behaviour
  from an extension fetch. The probe does not test it; that is a
  follow-up live test.
