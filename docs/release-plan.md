# Release plan — Schoology Dashboard extension

Status: **plan only, nothing implemented.** Written 7 Nov 2026. Safari
polishing and testing come first. This is what we build once the owner is
ready to publish.

Related docs: [`safari.md`](safari.md) (Safari packaging, review, the
containing app) and [`chrome-web-store-setup.md`](chrome-web-store-setup.md)
(listing assets and privacy tab). This plan supersedes their CI sections and their "Unlisted" advice:
every store listing is now public.

### Owner decisions (7 Nov 2026)

| Decision | Choice |
|---|---|
| Bundle ID (permanent) | `net.hirtfamily.schoology-dashboard`; extension target `net.hirtfamily.schoology-dashboard.Extension` |
| Product name | Full: "Grades Dashboard for Schoology students and parents". App Store name: "Grades Dashboard for Schoology", subtitle "For students and parents", short display name "Grades Dashboard" (§1a) |
| Safari platforms | **iOS and macOS** from the start, one app record |
| Store visibility | **Public on every store** (Chrome, Edge, Firefox AMO listed, Mac + iOS App Store). Testing still happens in private channels first (§6) |
| Going live | **Every store waits for the owner's click.** CI never makes an update live by itself (§5a) |
| Edge and Firefox | **Both in scope**, both public |
| Approval gate | **On every store job** via the `release` environment (§5a) |

Still open: see §7.

> Store rules, API endpoints and Apple tooling change often. Each "verify"
> below marks something to re-check against the live docs at
> implementation time.

---

## 0. Where we are today (and what's stale)

| Piece | State |
|---|---|
| Version | `0.1.0` in both `package.json` and `extension/manifest.json`. No git tags exist yet. Nothing checks that the two files match. |
| `ci.yml` | Lint, unit, prod + dev build, Playwright e2e. Its `test` job is the required check on `main`. Fine as is. |
| `release.yml` | Runs on `v*` tag pushes. Builds the ZIP, then a Safari job, a Chrome job, and a Release job. **Stale, details below; replaced by megahirt/schoology-grades-extension#73.** |
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

**Owner decision (10 Nov 2026): a release is a `vX.Y.Z` tag on `main`, and
the tag is the only source of the version.** Implemented in
megahirt/schoology-grades-extension#73.

### Version numbers

- **`vX.Y.Z` tags** (no leading zeros, each part 0–65535, Chrome's rule).
  `extension/manifest.json` and `package.json` stay at `0.0.0`; nothing is
  bumped in a commit.
- `scripts/build.mjs` writes the version into every built manifest
  (`dist/`, `dist-firefox/`, `dist-safari/`) from `RELEASE_VERSION`. The
  release workflow sets that from the tag. Local builds use the newest
  `vX.Y.Z` tag, or `0.0.0` if there is none.
- What derives from it:
  - Chrome / Edge / Firefox: manifest `version`. Each store requires every
    upload to be greater than the last, which tags give us for free.
  - Apple: `CFBundleShortVersionString` (MARKETING_VERSION) = X.Y.Z.
    `CFBundleVersion` (build number) = the release run number
    (`github.run_number`), unique for every upload.
  - The extension's own UI (settings footer, "Send feedback" subject) reads
    the manifest, so it shows the release version.
  - The promo site: `pages.yml` stamps the newest tag into
    `site/links.js`, which shows "Version X.Y.Z" in every page footer and
    next to the install page's release links.

### Flow

```
feature PRs ──CI `test`──▶ auto-merge to main
                              │
owner:  git tag v1.4.0 <commit on main> && git push origin v1.4.0
                              ▼
release.yml (on the tag push)
  verify   tag is vX.Y.Z and its commit is on main (else fail, no release)
  build    lint + unit tests; Chrome/Edge, Firefox, Safari builds stamped
           with X.Y.Z; check each manifest; ZIPs + SHA256SUMS.txt
  release  GitHub Release vX.Y.Z (generated notes + files), then
           `gh workflow run pages.yml` so the site shows the new version
  stores   chrome / safari (edge, firefox later) in the `release`
           environment: owner approval, then upload; each skips until its
           secrets and upload steps exist
```

- Tagging a commit that is already on `main` means it has passed the
  required CI `test` check. The workflow re-runs lint and unit tests
  anyway before building.
- **Release notes:** GitHub's generated list of merged PRs since the last
  tag, under a short header naming the files. PR titles are the changelog,
  so keep them readable.
- **Assets attached:** `schoology-grades-extension-<v>-chrome.zip` (Chrome
  and Edge), `-firefox.zip`, `-safari.zip` (Safari temporary install and
  Apple's packager input), and `SHA256SUMS.txt`. No signed Apple binaries;
  those go to App Store Connect only.
- **A wrong tag:** if verify fails, nothing is released. Delete the tag
  (`git push origin :refs/tags/vX.Y.Z`) and tag the right commit. Once a
  version has reached a store, never reuse it; tag the next patch instead.
- **Recommended:** a tag ruleset (Settings → Rules → Rulesets → New tag
  ruleset, target `v*`) that restricts creating, updating and deleting
  release tags to the owner.
- **Needed:** the `release` environment must allow tags `v*` as well as
  `main` (Settings → Environments → release → Deployment branches and
  tags → Add rule → Tag `v*`). Tag-triggered store jobs can't start
  otherwise.

### 1a. Product name per store

The full name is **51 characters**, which is longer than some stores
allow. Decided per-store names:

| Where | Limit | What goes there |
|---|---|---|
| Apple App Store name | **30 chars (hard limit)** | **"Grades Dashboard for Schoology"** (exactly 30) |
| Apple subtitle | 30 chars | "For students and parents" (24) |
| Safari containing app / extension display name | Short is better (Home Screen, Safari toolbar) | "Grades Dashboard" |
| `manifest.json` `name` (Chrome, Edge, Firefox) | Chrome allows 75 | Full name. Check the Edge and AMO limits at listing time; AMO may cap names at 50, so fall back to the 30-char form there |
| `manifest.json` `action.default_title` and short display | — | "Grades Dashboard" (and add `short_name`) |

Changing `manifest.json` `name` from today's "Schoology Dashboard" is a
small code change for Phase 1. The dev build's "(Dev)" suffix keeps
working.

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
  `publishType: STAGED_PUBLISH`, always (owner decision): once review
  passes, the item waits for the owner's **Publish** click in the
  dashboard.
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

### Bundle ID: decided

Bundle IDs can never be changed or reused after the first upload.

- App: **`net.hirtfamily.schoology-dashboard`**.
- Extension target: **`net.hirtfamily.schoology-dashboard.Extension`**
  (packager default suffix).
- iOS and macOS share both IDs (universal purchase, one app record).
- Replace the `com.example.schoology-dashboard` placeholder in
  `build-safari.mjs` and `safari.md` when the Xcode project is generated
  (Phase 3b). Before that, register the ID in the developer portal
  (Identifiers) as soon as the owner enrols, so it's reserved.
- App Store name: "Grades Dashboard for Schoology" (see §1a). The
  descriptive "for Schoology" form, not "Schoology …", is what keeps the
  PowerSchool trademark from being a review problem.

### TestFlight as the Safari dry run

- **Internal testers** (up to 100, must be App Store Connect users) get
  builds immediately, with no review. Use this for the family.
- **External testers** (up to 10,000, by email or public link) need Beta
  App Review on the first build. Use this for other NPC families.
- Builds expire after 90 days, so ship to the App Store before then or
  keep uploading.

---

## 4. Firefox (AMO) and Edge (in scope)

Both are free, and both API flows are simple. Firefox needs its own build
target.

| | Firefox AMO | Edge Add-ons |
|---|---|---|
| Account | Firefox Account, free | Microsoft Partner Center developer account, free (individual) |
| Code changes | Firefox MV3 uses `background.scripts`, not `service_worker`. It needs `browser_specific_settings.gecko.id` (+ `data_collection_permissions` for new AMO submissions; verify). → a `--target=firefox` manifest transform in `build.mjs`, its own ZIP, Playwright can't cover it. Our `browser.*` + polyfill code should otherwise run. | None. It takes the Chrome ZIP as is. |
| CI | `web-ext sign --channel=listed` with an AMO JWT issuer + secret | Edge Add-ons API v1.1: upload package → publish; API key + client ID from Partner Center → Publish API |
| Review | Automated plus possible human review; source upload needed only if code is minified/bundled in ways reviewers can't read (esbuild bundle → **probably yes**, upload the repo ZIP) | Hours to ~7 days |
| Effort | ~half a day + ongoing manual testing | ~1–2 hours |

**Plan:** Edge ships with Chrome (Phase 2). Firefox follows as Phase 4,
since it needs the `--target=firefox` build and manual testing in
Firefox (Playwright's e2e stays Chromium-only).

**Keeping the owner's click on each store:**

- **Edge:** CI uploads the new package as a draft (API "upload" only).
  The owner clicks **Publish** in Partner Center, which sends it to
  certification, and it goes live when certification passes. Visibility:
  **Public**. For testing first, Partner Center can hide the listing
  (link-only) before switching it to public; verify the option name.
- **Firefox:** AMO has no "wait after review" state; a submission goes
  live once approved. So the click is the GitHub approval gate (§5a) on
  the Firefox job, before `web-ext sign --channel=listed` submits.
  Visibility: **AMO listed** (owner decision). It is public and searchable
  on addons.mozilla.org, like the other stores, and AMO hosts the signed
  add-on and pushes updates, so no `update_url` or self-hosting is
  needed. A listed add-on needs a full listing: description, screenshots
  (demo data only), privacy policy link, and likely the source ZIP for
  the esbuild bundle.

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
| `AMO_JWT_ISSUER` / `AMO_JWT_SECRET` | Firefox | Owner (addons.mozilla.org → API keys) | Phase 4 |

### 5a. The approval gate (where it lives)

The gate is a **GitHub Actions environment** named `release`, configured
in **repo Settings → Environments → `release`**. It isn't a file in the
repo: only repo admins can change it, so a PR can't switch it off.

- **Required reviewers: the owner.** Any job that declares
  `environment: release` pauses before it starts, and GitHub emails the
  owner. The run page shows **"Review deployments" → Approve / Reject**
  (also in the GitHub mobile app).
- **Deployment branches: `main` only.** A workflow run from any other
  branch or a fork can't use the environment or read its secrets.
- **Environment secrets:** the store credentials in the table above live
  *in the environment*, not as repo-wide secrets, so only approved jobs
  can read them.
- In `release.yml`, the build, tag and GitHub Release jobs run with no
  gate (no credentials needed). Each store job (`chrome`, `edge`,
  `firefox`, `safari`) declares `environment: release`. One approval
  covers all store jobs in that run if they're approved together.

How it combines with each store's own go-live click:

| Store | GitHub gate (before upload) | Store-side click (after review) |
|---|---|---|
| Chrome | Approve | **Publish** in the dashboard (`STAGED_PUBLISH`) |
| Edge | Approve | **Publish** in Partner Center (CI uploads the draft only) |
| Firefox | **Approve = the go-live decision** | none (AMO goes live once approved) |
| Safari | Approve | **Submit for Review** in App Store Connect (CI uploads to TestFlight only), with "Manually release this version" selected, so it also waits after approval |

For Chrome, Edge and Safari, the store-side click is what satisfies
"wait for the owner's click", so the GitHub gate is extra protection
there. Firefox is the one store where the gate does that job. Decided:
the gate stays on for **every** store job. One tap per release is cheap,
and it stops a mistaken version-bump merge from ever touching a store.

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

- Done in megahirt/schoology-grades-extension#73: tag-driven
  `release.yml`, version from the tag, site shows the version.
- **First real test:** after merging, tag `v0.1.0` on `main`. Check the
  Release, its three ZIPs (load the Chrome one unpacked and check the
  version in Settings), and the site footer.
- Also needed before any store (owner reviews): the **privacy policy
  page** (megahirt/schoology-grades-extension#32, plus `site/privacy.html`)
  and a support URL. All the stores ask for them.

### Phase 2: Chrome Web Store (owner: $5 account)

- Owner: register, first manual upload, service account (§2).
- **Test channel:** first listing as **Private** with **trusted testers**
  (owner + family Google accounts added in the dashboard). Nobody else can
  see or install it, but it goes through real review and real
  auto-updates. When happy, switch visibility to **Public** (owner decision)
  and do one manual publish so API publishing works afterwards (see §2
  gotcha).
- Enable the CI publish job with `STAGED_PUBLISH`.
- **Edge** ships here too. Owner: Partner Center account (free), first
  manual submission (hidden while testing, then **Public**), then the API key. CI uploads drafts
  and the owner clicks Publish.

### Phase 3: Safari (owner: $99/yr membership)

- Owner: enrol (Individual), register the bundle ID (decided above), create
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

### Phase 4: Firefox

- Build: `--target=firefox` manifest transform, Firefox ZIP, manual test
  in Firefox (temporary add-on via `about:debugging`).
- Owner: Firefox Account → AMO API keys.
- First submission by hand as **listed** (listing, screenshots, privacy
  policy, source ZIP if reviewers ask). Then the CI job runs behind the
  approval gate.

### What ships first

**Phase 1 is fully unblocked**, so it can ship as soon as polishing
settles. Phase 2 needs about 30 minutes of the owner's time plus $5.
Phase 3 needs the $99 and the bundle-ID decision; Safari is the priority
target, so the owner should start enrolment early. Identity verification
can take a few days.

---

## 7. Decisions

Decided 7 Nov 2026: see the table at the top.

Still open:

1. **Apple enrolment** as Individual (seller name = owner's legal name),
   $99/yr, and when to start.
