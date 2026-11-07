# Live-Test Results — Schoology background fetch probe

> ## Status (2026-11-06): Q2 PROVEN in Chrome · Q1 (service worker on schoology.com) NOT YET RUN · Safari NOT YET RUN
>
> A read-only live session on app.schoology.com (parent account, Chrome)
> answered Q2 and mapped the real endpoints and markup. See "Live session
> 2026-11-06" below. The probe extension itself has **not** been loaded on
> schoology.com yet, so Q1 for the **service worker** is still open, and
> nothing has been tested in Safari.

## Live session 2026-11-06 (Chrome, parent account, read-only)

Method: requests made with `fetch(url, {credentials: 'include'})` from a
logged-in app.schoology.com page (the same request a content script makes),
results parsed with `extension/src/parser-core.js` run in that page.
No data was changed; the only side effect is the parent's "viewing as"
child, which the run switched and then restored. Student names, grades and
titles are deliberately not recorded here.

| Question | Result |
|---|---|
| Logged-in Grades HTML via fetch (page context) | **Yes.** `/course/<id>/student_grades` and `/parent/grades_attendance/grades` return 200 with the full page |
| Grades table in the fetched HTML (server-rendered?) | **Yes.** All assignment rows, scores, due dates and Missing markers are in the HTML; no JS rendering needed |
| Missing marker in fetched HTML | **Yes.** `.exception-icon.missing` + `.exception-text` "Missing" on the row; translation strings elsewhere on the page also contain "missing", so a bare text search is not a valid check |
| Parser vs. Schoology, 3 students | **526 / 526** item rows parsed, 0 warnings; Missing count matched Schoology's flags exactly (5 total) |
| Rows in collapsed periods | Present in HTML with class `hidden`; one teacher-marked Missing item was **only** in a collapsed earlier quarter, so visible-text checks miss it |
| Teacher lag | 2 of 5 Missing items also carry "This student has made a submission that has not been graded" |
| Other states seen | Exempt (9), Incomplete (1), letter grade "A" (4), no due date (10), real 0 scores that are NOT Missing |
| `/iapi/parent/info` | JSON `{ response_code, body: { session: { view_mode, view_child }, children: { "<uid>": { uid, username, profile_url, profile_tiny } } } }`; no CSRF header needed |
| Child switching | Server-side session state. `/parent/home?child_uid=<uid>` switches it; `/parent/grades_attendance/grades` then lists all of that child's courses. The `/course/<id>/preview/<uid>/parent?url=...` links also switch it |
| Per-course page for a child not currently viewed | `/course/<id>/student_grades` returns **403** |
| `/iapi/parent/overdue_submissions/<uid>` | Earlier session: omits teacher-marked Missing items and includes non-Missing and future items, so it is **not used** |
| REST API key for a parent account | Not available ("You do not have permission to generate an API Key") |

**Still open:** Q1 from the extension **service worker** on schoology.com
(the e2e tests show it working against the mock server in Chromium);
everything in Safari (macOS + iOS); the student-account flow
(`/grades/grades` is the assumed student report page, not verified).

## The two questions

1. **Does a service-worker `fetch(gradesUrl, {credentials:'include'})`
   return the logged-in Grades HTML** — i.e. `loggedIn=true`, `status`
   200, `finalUrl` is the Grades page and **not** a `/login` redirect?
2. **Are the grades table / Missing markers present in the fetched
   HTML** — i.e. `containsAssignmentTitle=true` for a title seen in the
   rendered DOM, `containsGrade=true`, and `containsMissing` matches
   what the rendered DOM showed?

A **PROVEN** verdict needs Q1 = yes and Q2 = yes from the
**service-worker** probe. The popup and hidden-tab probes are fallbacks
and are reported separately — they do not substitute for the
service-worker result.

## Run metadata (fill in when run)

| Field | Value |
|---|---|
| Date run | 2026-11-06 (page-context session above; probe extension not yet run) |
| Browser(s) | _not yet run_ |
| Schoology account type | _parent (expected)_ |
| Child viewed (if parent) | _not yet run_ |
| Exact Grades URL observed | `/course/<courseId>/student_grades`, parent report `/parent/grades_attendance/grades` |
| Sample assignment title checked | _not yet run_ |
| Probe extension version | 0.1.0 (`test/probe/probe-extension/`) |

## Safari results (primary — report first)

Many students use Safari (school Macs and iPhones), so Safari is the primary
target.

| Probe | status | finalUrl | loggedIn | bodyLength | containsAssignmentTitle | containsGrade | containsMissing | assignmentTitleChecked | checkedAt |
|---|---|---|---|---|---|---|---|---|---|
| Service worker | _not run_ | | | | | | | | |
| Popup | _not run_ | | | | | | | | |
| Hidden tab | _not run_ | | | | | | | | |

**Safari verdict:** _not yet run_

**Safari notes:** _—_

## Chrome results

| Probe | status | finalUrl | loggedIn | bodyLength | containsAssignmentTitle | containsGrade | containsMissing | assignmentTitleChecked | checkedAt |
|---|---|---|---|---|---|---|---|---|---|
| Service worker | _not run_ | | | | | | | | |
| Popup | _not run_ | | | | | | | | |
| Hidden tab | _not run_ | | | | | | | | |

**Chrome verdict:** _not yet run_

**Chrome notes:** _—_

## Raw evidence

Paste the JSON copied from the probe popup ("Copy all results") here,
one block per browser run:

```json
// Safari — not yet run
```

```json
// Chrome — not yet run
```

## Interpretation (fill in when run)

- If service-worker PROVEN in Safari: primary architecture (SW fetch +
  bundled parser) is viable. Proceed.
- If only popup PROVEN: cookies work from an extension page but not the
  service worker — background refresh needs another path.
- If only hidden-tab PROVEN: the Grades page is JS-rendered — the
  dashboard needs the hidden-tab fallback (disclose it in the listing)
  or the internal `/iapi/parent/*` JSON endpoints.
- If all FAILED: record the exact `status` / `finalUrl` / `error` and
  stop — do not guess a fix.

## Blockers

The cloud browser used before 2026-11-06 could not open `chrome://` pages, so the probe extension could not be loaded there. Load it in a local Chrome or Safari.
