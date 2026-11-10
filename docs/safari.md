# Safari distribution — Grades Dashboard for Schoology

**Safari first.** Many students use Safari (school Macs and iPhones), so the
Safari version is the primary target; Chrome (Web Store) is second.

> Sources: Apple Safari Extensions overview and WWDC26 session
> "Create web extensions for Safari" (developer.apple.com), plus the
> research report at
> the maintainer's research notes (not in this repo).
> Figures from secondary sources are marked as such; verify exact
> screenshot sizes, CLI flags, and review timing in App Store Connect /
> on the build Mac at submission time.

## The model in one paragraph

There is **no separate Safari Extensions Gallery**. A Safari extension
must be wrapped in a containing Mac/iOS app and distributed via the
**Mac/iOS App Store (Extensions category)** through App Store Connect,
after App Review. The packager (`xcrun safari-web-extension-packager`,
formerly `safari-web-extension-converter`) turns the shared Chrome MV3
extension folder into an Xcode project with a native app + embedded
`.appex` extension. Since iOS 26, App Store Connect's web Safari Web
Extension Packager can also package a ZIP upload with **no Mac/Xcode**.
Distribution outside the App Store is **not** treated as viable for web
extensions (Apple mentions Developer-ID notarization, but community
reports say web extensions won't load that way except with Allow
Unsigned Extensions enabled — and iOS has no outside-store route at
all). Recommend App Store only.

## Cost

Apple Developer Program: **$99 USD per membership year** (Apple,
verified). A free Apple ID (Personal Team) **cannot distribute at all**
— no App Store, no TestFlight, no App Store Connect — and its profiles
expire in 7 days. Budget the $99 as an ongoing yearly cost, not a
one-off: if membership lapses, fixes can't be shipped (e.g. when
Schoology changes its pages).

## Step 1 — Convert (on a Mac)

Prerequisite: full Xcode from the Mac App Store (Command Line Tools
alone is not enough for the Xcode-project step).

```bash
# From the repo root. Builds dist/ first if needed, then converts.
node scripts/build-safari.mjs

# Or run the generated script directly on the Mac:
./safari/convert.sh
```

The exact command the script runs / generates:

```bash
xcrun safari-web-extension-packager --copy-resources ./dist \
  --project-location ./safari \
  --app-name "Grades Dashboard for Schoology" \
  --bundle-identifier net.hirtfamily.schoology-dashboard \
  --swift --macos-only --no-open
# If the packager name is not found (older Xcode), use
# safari-web-extension-converter instead — same flags.
```

- `--copy-resources` copies the extension files into the project
  (default references them at their original path).
- **Bundle ID:** `net.hirtfamily.schoology-dashboard` (app) and `net.hirtfamily.schoology-dashboard.Extension`
  (extension). This is the real, permanent ID. Bundle IDs can never be
  reused or changed after the first upload. The converter
  derives target IDs from it and appends `.Extension` to the extension
  target. Verify every target's bundle ID in Xcode after conversion:
  some Xcode versions mangle them so the app and extension prefixes
  mismatch and Xcode refuses to build.
- **After conversion, strip from the manifest** if present:
  `browser_specific_settings`, `key`, `side_panel`, `offscreen`.
  Read the converter's compatibility warnings — don't ignore them.
- Shared-code rules that make this work: `browser.*` Promise APIs (or
  the webextension-polyfill) everywhere — `chrome.*` has no Promises in
  Safari; background is **non-persistent** (persist state to storage,
  never background globals); narrow host permissions to
  `*.schoology.com`. Missing in Safari: `sidePanel`, `offscreen`,
  `identity.getAuthToken`, `downloads`, `bookmarks`/`history`,
  `omnibox`, `userScripts` — none are in this extension's critical path.

No-Mac alternative: enrol ($99), create the app in App Store Connect,
go to the Xcode Cloud tab → Safari Web Extension Packager, upload a ZIP
of the extension; Apple packages it in minutes, then TestFlight. You
still need a Mac/iPhone to *test* in Safari.

## Step 2 — Containing app (required, Guideline 4.4)

The generated app's default SwiftUI view is a starting point, not a
shippable app. A blank window that just says "open Safari" is a
rejection risk. Minimum viable containing app for Schoology:

1. What the extension does.
2. How to enable it (Safari → Settings → Extensions → tick it on,
   then allow it on schoology.com).
3. A button that opens Safari's extension settings.
4. A privacy note: "homework data stays on this Mac; nothing is sent
   to a server."
5. A support link.

No marketing, ads, or in-app purchases inside the extension.

## Step 3 — Test locally

**Quick loop (no Xcode project needed):**

1. Safari → Settings → Advanced/Developer → turn on "Show features
   for web developers" (older Safari: "Show Develop menu in menu bar").
2. Safari → Settings → Developer → **Allow Unsigned Extensions**.
   **This resets every time Safari quits — re-enable each session.**
3. Same pane → **Add Temporary Extension…** → pick the folder
   containing `manifest.json`. It unloads when Safari quits.

**Xcode loop (the real build):** open the generated `.xcodeproj`,
select the macOS scheme, **Product → Run** (⌘R). Xcode builds/signs
the app and launches it; the extension appears in Safari → Settings →
Extensions — tick it on. Rebuild with ⌘B after source changes.
Ship against **release Safari** (Guideline 4.4.2 requires the extension
to run on the current Safari version); Safari Technology Preview is
for testing upcoming behaviour only.

**Enabling ≠ granting access — the #1 "it does nothing" trap.**
After ticking the extension on, grant website access separately:
Safari → Settings → Extensions → select it → Permissions / Edit
Websites → "Always Allow on Every Website" (dev) or allow only
`schoology.com`. On first visit Safari also prompts: *Allow for one
day / Always allow on this website / Always allow on every website*.
Until granted, the content script simply never runs.

**Debugging:** Develop → **Web Extension Background Pages** →
[Extension name] (background/service worker); popup/options page via
Develop → [Mac name] → [Extension] – popup.html, or right-click →
Inspect Element; content script via the page's Web Inspector →
Sources → Extension Scripts. iOS: connect by cable, enable Web
Inspector on the device, then Mac Safari → Develop → [device] →
[extension].

**Live probe:** run the probe in Safari first — see
`test/probe/README.md`. Safari results are reported before Chrome's.

## Step 4 — TestFlight (other Macs)

TestFlight is the reliable route for other Macs:

1. Xcode → Product → Archive → Distribute App → App Store Connect →
   Upload. (First archive/upload/submission should be done manually
   in Xcode so signing errors are cheap to fix; automate only once
   that works.)
2. App Store Connect → create the app record → TestFlight → add the
   build → invite testers (internal ≤100, external ≤10,000).
3. First external build needs Beta App Review. Builds expire after
   **90 days** — ship the App Store version before testers' builds die.
4. Testers install TestFlight, install the app, open it once, enable
   the extension in Safari, allow it on Schoology.

## Step 5 — App Store submission

1. App Store Connect → My Apps → **+** → New App: name, primary
   language, bundle ID (must match the Xcode app target), SKU, category
   (Education or Productivity), pricing **Free**.
2. Complete the listing: 1024×1024 app icon (PNG, no alpha),
   screenshots for each required device size (Mac sizes such as
   1280×800 / 1440×900 / 2560×1600 / 2880×1800 — **confirm the exact
   required sizes in App Store Connect at submission time, they
   change**), description (≤4,000 chars), subtitle (≤30), keywords
   (≤100), support URL, **privacy policy URL (must be live — a GitHub
   Pages page is acceptable for a free family app)**.
3. **App Privacy (nutrition labels):** answer honestly. A dashboard
   that stores homework data only on-device and sends nothing to a
   server is "No Data Collected" — but only if that is actually true
   (no analytics/crash SDK). Include a `PrivacyInfo.xcprivacy` in the
   app (and extension) target; Apple requires a privacy manifest for
   new submissions.
4. Age-rating questionnaire; export compliance (usually "no encryption
   / exempt" for a plain extension).
5. Parent reads the listing; select the TestFlight-tested build, add
   "What's New" notes, **Submit for Review**.

**What review checks:** Guideline 4.4 (containing app must have real
functionality; extensions may not contain marketing, advertising, or
in-app purchases; must run on current Safari; must not claim access to
more websites than strictly necessary — `*.schoology.com` only) and
Guideline 2.1 completeness (>40% of unresolved review issues, per
Apple: crashes, placeholder text, broken links, no demo account where
login is needed). In Review Notes, explain that the reviewer needs a
Schoology account (or provide a demo/test account if possible) and
describe exactly what to click.

**Review timing — do not promise tighter than this range.** Apple's
stated goal is 50% of submissions reviewed in under 24 hours and 90%
under 48 hours — a goal, not a promise. Oct 2026 reports show 12–22
day tails for first submissions, while routine updates to live apps
were typically ~1–2 days. **Plan 1–7 days for a first extension
submission and submit 2–3 weeks before any date that matters.** A
rejection restarts the clock — reply in the Resolution Center before
resubmitting if it's a misunderstanding.

## Updates

Updates ride with app updates: bump `CFBundleShortVersionString`
(MARKETING_VERSION, user-visible, e.g. 1.1.0) per public release and
`CFBundleVersion` (CURRENT_PROJECT_VERSION, build number) **per
upload, including TestFlight builds** (a re-upload with the same build
number is rejected). Keep app and extension targets' versions in sync.
Re-archive → upload → TestFlight → submit for review (updates are
reviewed too, usually faster than a first submission). Users get the
update through normal App Store updates; there is no separate
extension-only update channel.

## Account owner's checklist (must be done by the account owner)

| Account owner does personally | Builder / CI can do |
|---|---|
| Create Apple Account, turn on 2FA, verify identity | Write/convert/build the extension, run the packager, fix bundle IDs |
| Enrol as **Individual** at developer.apple.com/programs/enroll, accept the Developer Program Licence Agreement, pay **$99/year** | Bump versions, archive, upload builds |
| Create the App Store Connect API key and distribution certificate (or approve Xcode creating them while signed in) — the `.p8`/`.p12` are created once, then stored as CI secrets | Run the CI pipeline; fill listing metadata *drafts*, screenshots, privacy answers for the account owner to review |
| Add the helper in App Store Connect → Users and Access with a role (e.g. Developer / App Manager) so the helper works **without the account owner's Apple ID password** — never share the Apple ID password or 2FA codes | Submit a build for review *only if* the account owner granted that role; The account owner should still read the final listing and press submit the first time |
| Answer/submit privacy, age-rating, and trader (EU, if applicable) declarations; reply to App Review messages; renew membership yearly | Prepare the privacy policy text and the review notes |

## CI

GitHub Actions **can** build/submit on macOS runners (see
`.github/workflows/release.yml`): `macos-15`/`macos-26` runners can run
the packager, `xcodebuild archive`, and upload via `xcrun altool` /
fastlane. Secrets needed: distribution certificate as base64 `.p12` +
password, provisioning profiles (base64) for *each* target, App Store
Connect API key (`.p8` base64 / Key ID / Issuer ID), Team ID. The
release workflow's Safari job **skips gracefully** when those secrets
are not set (The account owner has not done Apple Developer setup yet) — it still
produces the extension ZIP + converter script so the manual path stays
open. Xcode Cloud is the alternative: 25 compute hours/month included
with the $99 membership, signing managed by Apple.

## iOS differences (if you get there)

Same web code can ship to both from one converter run
(`--rebuild-project` to add iOS), but iOS has no `downloads` (use
share sheet), no `contextMenus`, no keyboard `commands`; the popup
appears as a sheet from the toolbar's Extensions button; enabling is
in Settings → Apps → Safari → Extensions (iOS 18+); background must
be non-persistent. iOS needs its own screenshots and goes through its
own App Store review as part of the same app record. iOS has no
outside-store route at all.

## Gotchas checklist

- [ ] Host permissions are only `*.schoology.com` (not `<all_urls>`).
- [ ] Containing app is not blank (help/settings screen).
- [ ] Privacy policy URL is live; `PrivacyInfo.xcprivacy` included.
- [ ] Review Notes explain the Schoology login + exact steps.
- [ ] Tested on release Safari, not just Technology Preview.
- [ ] Family told to enable the extension **and** grant Schoology
      access — "installed but does nothing" is almost always this step.
- [ ] $99 membership renewing; re-test on each new Safari/macOS release.
