# Release plan — Schoology Dashboard extension

Status: **plan only, nothing implemented.** Written 7 Nov 2026. Safari
polishing and testing come first. This is what we build once the owner is
ready to publish.

Related docs: [`safari.md`](safari.md) (Safari packaging, review, the
containing app) and [`chrome-web-store-setup.md`](chrome-web-store-setup.md)
(listing assets and privacy tab). This plan supersedes their CI sections.

> Store rules, API endpoints and Apple tooling change often. Each "verify"
> below marks something to re-check against the live docs at
> implementation time.

---

## 0. Where we are today (and what's stale)

| Piece | State |
|---|---|
| Version | `0.1.0` in both `package.json` and `extension/manifest.json`. No git tags exist yet. Nothing checks that the two files match. |
| `ci.yml` | Lint, unit, prod + dev build, Playwright e2e. Its `test` job is the required check on `main`. Fine as is. |
| `release.yml` | Runs on `v*` tag pushes. Builds the ZIP, then a Safari job, a Chrome job, and a Release job. **Stale, details below.** |
| `build-safari.mjs` | Regenerates an Xcode project from `dist/` every run, with the placeholder bundle ID `com.example.schoology-dashboard` and `--macos-only`. |
| Accounts | None yet: no Apple Developer membership, no Chrome Web Store developer account. Only the owner can create them. |

Problems with the current `release.yml`:

1. **A store failure blocks the GitHub Release.** `release` has
   `needs: [build, safari, chrome]`, so a Chrome API error means no
   Release and no ZIP. Create the Release first and make store jobs
   downstream of it.
2. **The Chrome step only uploads.** `chrome-webstore-upload-cli upload`
   leaves the draft unsubmitted. It also predates the Chrome Web Store
   **API v2**, released 15 Oct 2025, while v1 was supported only until
   15 Oct 2026, which has now passed. Treat the v1 path as dead until
   verified otherwise.
3. **The Safari job is a scaffold.** It regenerates a throwaway Xcode
   project on each run, with a placeholder bundle ID and macOS only, and
   never archives or uploads. Its "Safari source ZIP" is byte-for-byte
   the same `dist/` ZIP as the Chrome one.
4. **There is no version guard.** Nothing fails when the tag,
   `package.json` and `manifest.json` disagree.
5. **The release body is hand-written boilerplate**, not a changelog.

---

## 1. Versioning and the release flow

### Version numbers

- **SemVer `MAJOR.MINOR.PATCH`** in `package.json` and
  `extension/manifest.json` (Chrome's `version` allows only dotted
  integers, so no `-beta` suffix there; `version_name` may carry one).
- These two files are the single source of truth. Every store version
  derives from them:
  - Chrome / Edge / Firefox: `version` as is. Chrome requires every upload
    to be strictly greater than the last.
  - Apple: `CFBundleShortVersionString` (MARKETING_VERSION) = the same
    SemVer. `CFBundleVersion` (build number) = the CI run number
    (`github.run_number`), which is unique for every upload, TestFlight
    re-uploads included.

### Bumping

Add `scripts/bump-version.mjs` and an `npm run release:bump -- <patch|minor|major|x.y.z>` script that:

1. Updates both files at once (via `npm version --no-git-tag-version`, then
   writes the same value into the manifest).
2. Moves the `## Unreleased` section of `CHANGELOG.md` under a new
   `## x.y.z — YYYY-MM-DD` heading.

Add a cheap check to `ci.yml` (a step in `test`, so no new required
check): `package.json` version == `manifest.json` version, and the prod
`dist/manifest.json` has no `localhost` permission.

### Flow (fits "main requires `test`, PRs auto-merge")

`main` is protected, so a version can't be pushed straight to it, and a
tag pushed by `GITHUB_TOKEN` won't trigger other workflows. The cleanest
fit is a **release PR whose merge *is* the release**:

```
feature PRs ──merge──▶ main          (each adds a line under "## Unreleased")
                         │
owner: npm run release:bump -- minor  → branch release/v0.2.0 → PR
                         │  CI `test` passes → auto-merge
                         ▼
push to main ──▶ release.yml: "is manifest version untagged?"
                   no  → exit (ordinary merge)
                   yes → build → tag v0.2.0 → GitHub Release (+ ZIPs)
                                   └─▶ store jobs (each guarded by its secrets)
```

- `release.yml` triggers on `push: branches: [main]` (paths: the manifest)
  plus `workflow_dispatch` (re-run a release, or a **dry run** with
  `dry_run: true`).
- The workflow creates the tag and the Release itself, with
  `gh release create v$VERSION --target $GITHUB_SHA`, so nothing depends on
  a tag-push event.
- **Release notes:** the `CHANGELOG.md` section for that version, plus
  GitHub's `--generate-notes` PR list underneath. Feature PRs keep the
  changelog human-readable, and the generated list covers anything missed.
- **Assets attached:**
  - `schoology-dashboard-<v>-chrome.zip`: prod `dist/` for Chrome and Edge,
    also good for Safari "Add Temporary Extension" and Apple's web
    packager.
  - `schoology-dashboard-<v>-firefox.zip` (if Phase 4 happens).
  - `SHA256SUMS.txt`.
  - No signed Apple binaries; those go to App Store Connect only.
- Releases stay public. The repo is public anyway, and the ZIP is
  installable "load unpacked" for anyone technical.

The alternative was **release-please** (bot-maintained release PR from
Conventional Commits). It's rejected for now: more machinery than a
one-maintainer family project needs, and it forces a commit-message
convention. Revisit if the bump script becomes a chore.

---

## 2. Chrome Web Store

### Owner does by hand (one time)

1. Register at the [Developer Dashboard](https://chrome.google.com/webstore/devconsole)
   with the Google account that will own the listing. **$5 one-time.**
   Complete identity/contact verification. Note the **Publisher ID** shown
   there; API v2 URLs need it.
2. **First upload is manual:** New Item → upload the release ZIP, fill in
   the listing and privacy tab (see `chrome-web-store-setup.md`), pick
   visibility (see §6), submit. This creates the **extension ID**.
3. Choose how CI authenticates. **Recommended: a service account**, which
   API v2 supports:
   - Google Cloud Console → new project → enable **Chrome Web Store API**
     → create a **service account** → create a JSON key.
   - Developer Dashboard → Account → add the service account's email.
   - No refresh token to expire. With the OAuth "user" flow, a consent
     screen left in *Testing* status issues refresh tokens that **expire
     after 7 days**. That's the classic "CI upload suddenly 401s" trap.
     If OAuth is used instead, the consent screen must be *In production*.

### CI (store job, after the Release exists)

- Get an access token for the service account, scope
  `https://www.googleapis.com/auth/chromewebstore`, via
  `google-github-actions/auth` or a few lines of JWT signing.
- `POST https://chromewebstore.googleapis.com/upload/v2/publishers/$PUB/items/$ID:upload`
  with the ZIP.
- `POST .../v2/publishers/$PUB/items/$ID:publish`, using
  `publishType: STAGED_PUBLISH` at first: once review passes the item
  waits for a click in the dashboard, so the owner controls go-live.
  Switch to the default (auto-publish after review) once trusted.
- Implement as a small `scripts/publish-chrome.mjs` (fetch + JSON), not a
  third-party action, so we depend only on Google's documented API. If a
  maintained action or CLI with **confirmed v2 + service-account support**
  exists at implementation time, using it is fine. Verify before choosing.
- Gotcha: API publishing fails if visibility was changed in the dashboard
  and not yet manually published once. Change visibility only in the
  dashboard, then do one manual publish.
- Guarded: if `CWS_*` secrets are missing, echo "skipped" and succeed,
  as today.

---

## 3. Safari — Mac App Store and iOS

### Facts that shape the choice

- Safari extensions ship only inside a **containing app** on the Mac
  and/or iOS App Store, via App Store Connect and App Review. There is no
  separate gallery, and no workable outside-store route for web
  extensions (none at all on iOS). See `safari.md`.
- **Apple Developer Program, $99/yr, enrolled by the owner.** Choose an
  *Individual* membership: the seller name on the listing is the owner's
  legal name, and no D-U-N-S number is needed (an *Organization* would
  need one). A lapsed membership means no fixes can ship when Schoology
  changes its pages.
- iOS and macOS can share **one app record with one bundle ID** (universal
  purchase). Re-run the packager without `--macos-only` to get both
  targets.

### The options

| Option | How | Pros | Cons |
|---|---|---|---|
| **A. App Store Connect web packager** | Create app record → Xcode Cloud tab → Safari Web Extension Packager → upload the ZIP; Apple builds a generic containing app → TestFlight. | No Mac, no Xcode, no certificates. Fastest first build. | Apple-generated containing app (Guideline 4.4 "must have real functionality" risk, can't customise). Manual upload in the browser, not CI-scriptable as far as documented. **Fall 2026 forum reports** that the packager section is missing or export fails ([845036](https://developer.apple.com/forums/thread/845036), [844441](https://developer.apple.com/forums/thread/844441)). |
| **B. GitHub macOS runner + committed Xcode project** | Generate the Xcode project **once** (macOS + iOS, real bundle ID), commit `safari/`. CI on `macos-26`: `npm run build` → copy `dist/` into the project's extension resources → `xcodebuild archive` + `-exportArchive` with the **App Store Connect API key** and `-allowProvisioningUpdates` (cloud-managed signing) → `xcrun altool --upload-app` or `fastlane pilot` → TestFlight. | Fully automated on every release. Custom containing app (setup help, privacy note) helps with Guideline 4.4. Same GitHub Actions setup as everything else. macOS minutes are free on a public repo. | Someone must produce and maintain the Xcode project, and edits to it are painful without a Mac. Debugging signing on CI is slow. Needs an API key with enough role for cloud signing (Admin, or App Manager with cloud-signing access; verify). |
| **C. Xcode Cloud** | Same committed project; Apple's CI builds on push and delivers to TestFlight. | Apple manages signing. 25 compute h/mo included. | Workflow configured in App Store Connect/Xcode UI, not in the repo. A second CI system next to GitHub Actions. |
| B′. B with manual certs | As B, but import `.p12` + provisioning profiles from secrets. | Works with any API-key role. | Five more secrets, certificates expire yearly, profiles needed per target. |

### Recommendation: **A once to learn, then B**

1. **First TestFlight build via A.** As soon as the owner enrols, it
   proves the account, bundle ID and app record with zero tooling. It
   also gets a build onto the family's devices through TestFlight. If the
   web packager is broken that week, skip straight to step 2.
2. **Steady state via B.** Generate the real project (macOS + iOS, real
   bundle ID, customised containing app), commit `safari/`, and have
   `release.yml` push each release to **TestFlight**. Promoting a
   TestFlight build to App Store review stays a manual click in App Store
   Connect, which is cheap and keeps a human on the "what's new" text and
   review answers.
   - Make `build-safari.mjs` **sync** `dist/` into the committed project
     instead of regenerating it. It regenerates only when someone runs
     it with `--rebuild` on purpose.
   - Signing: cloud-managed via the API key (no `.p12`/profiles). Fall
     back to B′ only if the key's role can't be granted.
   - The project can be generated without the owner having Xcode: run the
     packager once on a GitHub macOS runner (`workflow_dispatch`) and
     commit the output via a PR. The containing app's SwiftUI view is
     plain text and can be edited and CI-built from any machine; a Mac
     with Xcode makes it much faster.
3. Keep **C** as the fallback if GitHub-hosted signing proves fiddly.

### Bundle ID: owner decides, and it's permanent

Bundle IDs can never be changed or reused after the first upload.
Proposal:

- App: `io.github.sabaisnoopy.schoology-dashboard`. It's tied to the
  GitHub account that owns the repo, so no domain is needed.
  Alternatives: a domain the owner controls (`com.<owner-domain>.schoology-dashboard`),
  or a family name.
- Extension target: `<app id>.Extension` (packager default).
- iOS and macOS use the same IDs (universal purchase).
- The App Store **name** is separate and changeable; "Schoology" is a
  trademark of PowerSchool, so review may push back on it as the leading
  word. Something like "Homework Dashboard for Schoology" is safer.
  Verify against the guidelines.

### TestFlight as the Safari dry run

- **Internal testers** (up to 100, must be App Store Connect users) get
  builds immediately, with no review. Use this for the family.
- **External testers** (up to 10,000, by email or public link) need Beta
  App Review on the first build. Use this for other NPC families.
- Builds expire after 90 days, so ship to the App Store before then or
  keep uploading.

---

## 4. Optional: Firefox (AMO) and Edge

Both are free, and both API flows are simple. They are **not** zero-code,
though.

| | Firefox AMO | Edge Add-ons |
|---|---|---|
| Account | Firefox Account, free | Microsoft Partner Center developer account, free (individual) |
| Code changes | Firefox MV3 uses `background.scripts`, not `service_worker`. It needs `browser_specific_settings.gecko.id` (+ `data_collection_permissions` for new AMO submissions; verify). → a `--target=firefox` manifest transform in `build.mjs`, its own ZIP, Playwright can't cover it. Our `browser.*` + polyfill code should otherwise run. | None. It takes the Chrome ZIP as is. |
| CI | `web-ext sign --channel=listed` (or `unlisted` for self-hosted signed `.xpi`) with an AMO JWT issuer + secret | Edge Add-ons API v1.1: upload package → publish; API key + client ID from Partner Center → Publish API |
| Review | Automated plus possible human review; source upload needed only if code is minified/bundled in ways reviewers can't read (esbuild bundle → **probably yes**, upload the repo ZIP) | Hours to ~7 days |
| Effort | ~half a day + ongoing manual testing | ~1–2 hours |

**Recommendation:** add **Edge** whenever Chrome automation lands, since it
is almost free. Leave **Firefox** out unless a family actually asks for
it; it's a real second build target.

---

## 5. Secrets inventory

All stored as **GitHub Actions secrets** in a `release` **environment**
(Settings → Environments). That limits them to the release workflow on
`main`, and the environment can require the owner's approval before store
jobs run. Fork PRs never see them. **None ever go in the repo**,
including `.env` files, workflow `env:` literals and logs. `.p8`/`.json`
keys go in base64-encoded.

| Secret | Store | Created by | Notes |
|---|---|---|---|
| `CWS_PUBLISHER_ID` | Chrome | Owner (dashboard) | Not really secret; a repo *variable* is fine |
| `CWS_EXTENSION_ID` | Chrome | Exists after owner's first manual upload | Not really secret; *variable* |
| `CWS_SERVICE_ACCOUNT_JSON_B64` | Chrome | Owner (Google Cloud Console) | Recommended auth |
| `CWS_CLIENT_ID` / `CWS_CLIENT_SECRET` / `CWS_REFRESH_TOKEN` | Chrome | Owner | Only if OAuth chosen instead; consent screen must be *In production* |
| `APPLE_TEAM_ID` | Apple | Shown after owner enrols | *Variable* is fine |
| `ASC_API_KEY_ID` / `ASC_API_ISSUER_ID` | Apple | Owner (App Store Connect → Users and Access → Integrations) | |
| `ASC_API_KEY_P8_B64` | Apple | Owner | **Downloadable only once.** Store it immediately. Role per §3 |
| `APPLE_DIST_CERT_P12_B64` / `_PASSWORD` / `APPLE_PROFILE_*_B64` | Apple | Owner | **Only for option B′.** Expire yearly |
| `EDGE_PRODUCT_ID` / `EDGE_CLIENT_ID` / `EDGE_API_KEY` | Edge | Owner (Partner Center) | API keys expire; check the current lifetime and calendar it |
| `AMO_JWT_ISSUER` / `AMO_JWT_SECRET` | Firefox | Owner (addons.mozilla.org → API keys) | Only if Phase 4 |

`GITHUB_TOKEN` (automatic) creates tags and Releases and needs
`contents: write` on the release job only. Builder/Claude sessions never
see or handle any of the values above; the owner pastes them into GitHub
directly.

---

## 6. Phases

### Phase 0: polish and Safari testing (now, no accounts)

Current work: the temporary unsigned extension in Safari, live probe,
demo-data screenshots.

### Phase 1: GitHub Release pipeline (no accounts needed)

- Bump script, `CHANGELOG.md`, version-match check in CI.
- Rewrite `release.yml`: push-to-main trigger + `workflow_dispatch`
  dry run → build → tag → Release with ZIPs + checksums → store jobs as
  guarded no-ops.
- **Dry run:** `workflow_dispatch` with `dry_run: true` builds and uploads
  the assets as a workflow artifact and creates a **draft** Release (only
  maintainers see drafts), with no tag and no store calls. Delete the
  draft afterwards. Then cut a real `v0.1.0` as the first tagged
  baseline.
- Also needed before any store (owner reviews): a **privacy policy page**
  (GitHub Pages from `docs/`) and a support URL, since all three stores
  ask for them.

### Phase 2: Chrome Web Store (owner: $5 account)

- Owner: register, first manual upload, service account (§2).
- **Test channel:** first listing as **Private** with **trusted testers**
  (owner + family Google accounts added in the dashboard). Nobody else can
  see or install it, but it goes through real review and real
  auto-updates. When happy, switch visibility to **Unlisted** (link-only,
  the planned steady state for the family and NPC) and do one manual
  publish so API publishing works afterwards (see §2 gotcha).
- Enable the CI publish job with `STAGED_PUBLISH`.
- Edge (optional) rides along here.

### Phase 3: Safari (owner: $99/yr membership)

- Owner: enrol (Individual), decide bundle ID and App Store name, create
  the app record, create the ASC API key, add any helper accounts in
  Users and Access (never share the Apple ID password or 2FA).
- 3a: web packager → TestFlight internal (family Macs/iPhones).
- 3b: committed Xcode project (macOS + iOS) + CI → TestFlight on every
  release.
- 3c: first App Store submission done **by hand** in App Store Connect
  (listing, screenshots, privacy labels, `PrivacyInfo.xcprivacy`, review
  notes explaining the Schoology login). Updates after that: CI uploads to
  TestFlight, owner clicks "Submit for Review".
- Allow 1–7+ days for first review, and submit 2–3 weeks before any date
  that matters (see `safari.md`).

### Phase 4: optional Firefox

Only on demand (§4).

### What ships first

**Phase 1 is fully unblocked**, so it can ship as soon as polishing
settles. Phase 2 needs about 30 minutes of the owner's time plus $5.
Phase 3 needs the $99 and the bundle-ID decision; Safari is the priority
target, so the owner should start enrolment early. Identity verification
can take a few days.

---

## 7. Decisions for the owner

1. **Bundle ID** (permanent): `io.github.sabaisnoopy.schoology-dashboard`,
   a personal domain, or something else.
2. **App Store name**: avoid leading with "Schoology"? E.g. "Homework
   Dashboard for Schoology".
3. **Apple enrolment** as Individual (seller name = owner's legal name),
   $99/yr, and when to start.
4. **Safari platforms**: macOS + iOS from the start (recommended; same
   app record), or macOS first.
5. **Chrome visibility** after testing: Unlisted (recommended) or Public.
6. **Auto-publish vs staged**: should CI make store updates live after
   review, or wait for the owner's click? Recommended: staged at first.
7. **Edge / Firefox**: add Edge with Chrome? Skip Firefox for now?
8. **Release approval gate**: require the owner's approval on the
   `release` environment before store jobs run (recommended).
