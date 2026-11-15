# Firefox Add-ons (AMO) listing: design

Approved by Chris on 2026-11-14 ("Include Android").

## Intent

List **Grades Dashboard for Schoology** publicly on addons.mozilla.org
(AMO), for Firefox on desktop **and Android**, as `docs/release-plan.md`
§4 describes.

## Goals

- The Firefox build declares what Mozilla now requires of new extensions:
  no data collection, and Android support.
- Every release carries a source ZIP that reviewers can rebuild to the
  exact package.
- A listing kit (`store/firefox/`) and an owner guide
  (`docs/firefox-amo-setup.md`).
- A `firefox` release job that submits each version to AMO, skipping until
  its keys exist.

## Non-goals

- No change to the Chrome, Edge or Safari builds.
- CI does not create the listing: the first submission is by hand.
- No Android-specific UI work in this change.

## Anti-goals

- A version going to AMO without the owner's approval of the job (AMO has
  no hold after review, so that approval is the go-live decision).
- A source ZIP that doesn't rebuild to the uploaded package.
- AMO keys in the repo or in logs.

## Constraints (Mozilla's docs, read 2026-11-14)

- New extensions must declare data collection in the manifest:
  `browser_specific_settings.gecko.data_collection_permissions`;
  `{ "required": ["none"] }` for none.
- AMO lists an add-on for Android only if the manifest has
  `browser_specific_settings.gecko_android` (an empty object is enough).
- Bundled code (ours: esbuild) needs the source and build steps with
  every version; the rebuilt package must match exactly.
- MV3 needs `gecko.id` (we have `grades-dashboard@hirtfamily.net`).
- Summary is limited to 250 characters; up to 2 categories per platform.
- `web-ext sign --channel listed` submits a version;
  `--upload-source-code` attaches the source; `--approval-timeout 0`
  doesn't wait for review.

## Approaches

1. **Kit + guide + CI submit, first listing by hand (picked).** Same shape
   as Chrome and Edge. The owner fills in the listing once; CI sends
   updates with `web-ext sign`.
2. **CI creates the listing too** (`--amo-metadata`). One step fewer for
   the owner, but the listing text would live in a JSON file CI pushes
   blind, and a mistake is public at once.
3. **By hand every release.** Nothing to build, but every version needs a
   manual upload plus the source ZIP.

## Design

- `scripts/manifest-firefox.mjs`: `forFirefox(manifest)` holds the Firefox
  manifest changes (moved out of `build.mjs`), adding
  `data_collection_permissions: { required: ['none'] }` and
  `gecko_android: {}`. Unit tested.
- `release.yml` build job: `git archive` of the tag as
  `…-source.zip`, in the Release and checksums.
- `store/firefox/SOURCE.md`: build steps for reviewers (in the source ZIP).
- `release.yml` `firefox` job: `release` environment; secrets
  `AMO_JWT_ISSUER`, `AMO_JWT_SECRET`; runs `web-ext sign` on the unpacked
  Firefox ZIP.
- `store/firefox/README.md`, `docs/firefox-amo-setup.md`; pointers in
  `docs/release-plan.md` and `DEVELOPER.md`.

## Known gap

The dashboard has not been tried on a real Android phone. The guide tells
the owner how, before the first submission.
