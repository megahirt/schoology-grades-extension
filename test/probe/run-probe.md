# Handoff brief: run the Schoology live probe (browser task)

**For the parent agent — run this as a browser task signed in with the
saved Schoology parent login from the Secure Vault. Never ask for, paste,
or record a password. If sign-in is blocked, report the blocker instead
of claiming a pass.**

## What the probe is

A minimal standalone Manifest V3 extension at
`test/probe/probe-extension/` (separate from the real extension). It
answers the two questions the dashboard architecture depends on:

1. Does a service-worker `fetch(gradesUrl, {credentials:'include'})`
   return the **logged-in** Grades HTML, not a `/login` redirect?
2. Are the grades table / Missing markers present in the fetched HTML
   (server-rendered), or is it an empty JS shell?

Full instructions: [`test/probe/README.md`](./README.md).
Results template: [`test/probe/LIVE-TEST-RESULTS.md`](./LIVE-TEST-RESULTS.md).

## Exact steps

1. Load the probe unpacked from `test/probe/probe-extension/`.
   **Safari first** (students use Safari); Chrome if Safari loading is
   blocked — and say so if Safari could not be run. Safari quick loop:
   Settings → Developer → Allow Unsigned Extensions (resets every
   Safari quit) → Add Temporary Extension… → pick the probe folder.
   Then grant the probe Schoology access separately in Settings →
   Extensions (enabling is NOT the same as granting access — without
   it the content script never runs and nothing is captured).
2. Sign in to Schoology **as the parent** with the saved login.
3. In the Schoology UI, switch to a child if needed, open a course, open
   its Grades page. **Do not type a guessed Grades URL** — the probe
   captures whatever URL the UI actually used.
4. Wait a few seconds, open the probe popup, confirm it shows the
   captured Grades URL, a sample assignment title, and whether the
   rendered DOM has "Missing". If nothing is captured, reload the Grades
   page, wait 5 seconds, and reopen the popup; if still nothing, report
   that as the outcome.
5. Run the three probe buttons **in order**: (1) "Probe from service
   worker", (2) "Probe from popup", (3) "Hidden tab scrape" (up to 30 s).
6. Click "Copy all results (JSON)" in the popup.

## Evidence to capture back

- The copied JSON (context + all probe results), and the popup's verdict
  line (PROVEN / FAILED / INCONCLUSIVE).
- Per probe: `status`, `finalUrl`, `loggedIn`, `bodyLength`,
  `containsAssignmentTitle`, `containsGrade`, `containsMissing`,
  `assignmentTitleChecked`, `checkedAt`, `fetchContext`.
- The **exact Grades URL pattern observed** (from the captured URL —
  never a guessed pattern), and the sample assignment title checked.
- Which browser(s) ran (Safari first, then Chrome if run), and whether
  the account was a parent account with the child switcher visible.
- If a second child exists, note whether the Grades URL pattern differs
  for that child (repeat step 3 for the second child if cheap).

## Rules

- **If sign-in is blocked** (login fails, 2FA / SSO challenge the task
  cannot complete, Schoology shows a bot check that cannot be passed),
  **report the blocker instead of claiming a pass.** A blocked run is a
  blocked run — record what blocked it and stop.
- Do not claim PROVEN unless the **service-worker** probe returned
  `loggedIn=true`, found the assignment title, and `containsMissing`
  matched the rendered DOM. Popup-only or hidden-tab-only success is a
  fallback result, not a pass for the primary architecture.
- Never put credentials in code, logs, screenshots shared onwards, or
  the repo. Do not paste the password anywhere except the Schoology
  sign-in form itself.
- After the run, fill in `test/probe/LIVE-TEST-RESULTS.md` (replace the
  "NOT YET RUN" banner with the real results, date, and browser) — or
  return the evidence to the parent agent to file there.

## Current status

**NOT YET RUN — no live Schoology test has been performed.** This brief
is the handoff for the first run.
