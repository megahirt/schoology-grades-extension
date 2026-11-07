# Live-Test Results — Schoology background fetch probe

> ## ⚠️ NOT YET RUN — no live Schoology test has been performed
>
> Everything below is a **template**. No probe has been run against real
> Schoology, no verdict has been reached, and nothing in this file is
> evidence yet. Replace this banner with the real results (and the date,
> browser, and account type) when the probe in
> [`test/probe/README.md`](./README.md) is actually run. Do not delete
> this banner until then.

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
| Date run | _not yet run_ |
| Browser(s) | _not yet run_ |
| Schoology account type | _parent (expected)_ |
| Child viewed (if parent) | _not yet run_ |
| Exact Grades URL observed | _not yet run — capture from the logged-in UI, do not guess_ |
| Sample assignment title checked | _not yet run_ |
| Probe extension version | 0.1.0 (`test/probe/probe-extension/`) |

## Safari results (primary — report first)

Students at North Point Christian use Safari, so Safari is the primary
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

_None recorded yet. If sign-in is blocked, record the blocker here
instead of claiming a pass._
