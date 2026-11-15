# Firefox Add-ons (AMO) setup

How to get **Grades Dashboard for Schoology** onto
[addons.mozilla.org](https://addons.mozilla.org/) (AMO) for Firefox on
desktop and Android, and keep it updated.

> Steps were checked against Mozilla's Extension Workshop on 2026-11-14
> ([submitting](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/),
> [source code](https://extensionworkshop.com/documentation/publish/source-code-submission/),
> [data consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/),
> [Android](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/)).
> Where the Developer Hub differs from this page, trust it.

Three things are different from Chrome and Edge:

- **No hold after review.** A version goes live as soon as Mozilla
  approves it. Your approval of the release's `firefox` job is the
  go-live decision.
- **Source code goes with every version.** The package is bundled, so
  reviewers rebuild it from the source ZIP and compare.
- **The package must be a release that has the data declaration**
  (`data_collection_permissions`), which means a release made after this
  guide was added. v1.2.0 and earlier won't do.

## 1. Account (free, owner only)

Sign in or register at <https://addons.mozilla.org/developers/> with a
Mozilla account. There is no fee.

## 2. Try it on an Android phone first

The listing includes Firefox for Android, and Mozilla's reviewers check
that an add-on is usable there. The dashboard has been tested in desktop
Firefox only, so look at it on a phone before submitting:

1. On the phone: install Firefox, turn on **Developer options → USB
   debugging** in Android's settings, and in Firefox turn on **Settings →
   Remote debugging via USB**. Plug the phone into the Mac.
2. On the Mac (needs Android's `adb`; `brew install android-platform-tools`):

   ```bash
   npm run build:firefox
   ```

   ```bash
   npx web-ext run -t firefox-android -s dist-firefox --firefox-apk org.mozilla.firefox
   ```

   If more than one device is attached, web-ext lists them; add
   `--adb-device <id>`.
3. On the phone, sign in to Schoology, open Grades, and check the panel
   and the dashboard from Firefox's Extensions menu.

If something is unusable on the phone, either fix it first or leave
**Firefox for Android** unticked in step 3.1 below and add it later.

## 3. First submission, by hand

1. From the newest [GitHub Release](https://github.com/megahirt/schoology-grades-extension/releases),
   download `…-firefox.zip` and `…-source.zip`.
2. Developer Hub → **Submit a New Add-on** → **On this site**, and follow
   [store/firefox/README.md](../store/firefox/README.md): it has the answer
   for every step, in order (upload, platforms, source code, description,
   notes for reviewers).
3. Submit. Mozilla says signing and publishing can take up to 24 hours,
   longer if a person reviews it. You get an email.
4. Add the screenshots under **Edit Product Page** (kit §4).

## 4. Let releases submit new versions (after §3)

Each `vX.Y.Z` release runs the `firefox` job in
[release.yml](../.github/workflows/release.yml). After your approval it
runs Mozilla's `web-ext sign --channel listed` with the release's Firefox
ZIP and source ZIP. Until both secrets exist, the job prints `SKIPPED` and
the release still succeeds.

1. Open <https://addons.mozilla.org/developers/addon/api/key/> and
   generate credentials. You get a **JWT issuer** and a **JWT secret**.
2. Store both as secrets in the `release` environment. Each command asks
   for the value, so it never lands in your shell history:

   ```bash
   gh secret set AMO_JWT_ISSUER --env release
   ```

   ```bash
   gh secret set AMO_JWT_SECRET --env release
   ```

## 5. Each release

1. Tag and push as usual (`DEVELOPER.md` → Releasing).
2. Approve the `firefox` job **only when you want this version live on
   Firefox**. There is no second click on Mozilla's side.
3. The job finishes once the version is submitted; it doesn't wait for
   the review. Mozilla emails you when the version is approved.

**Gotchas:**

- Never change the add-on ID (`grades-dashboard@hirtfamily.net`, in
  `scripts/manifest-firefox.mjs`): AMO ties the listing to it.
- If the build ever starts collecting or sending data, the manifest's
  `data_collection_permissions` and the listing must say so first.
- Listing text and screenshots aren't changed by the job; edit them in the
  Developer Hub (and in `store/firefox/README.md`, so the kit stays true).

## 6. Point the site at the listing

Once the listing is public, put its URL in `firefox:` in
[site/links.js](../site/links.js). The site sends Firefox users and
Android users there.
