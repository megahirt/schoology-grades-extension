# Firefox Add-ons (AMO) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Firefox build acceptable to AMO for desktop and Android, ship a rebuildable source ZIP with each release, and add the listing kit, owner guide and a `firefox` release job.

**Architecture:** The Firefox manifest changes move into one tested function. The release build adds a `git archive` source ZIP. A `firefox` job runs `web-ext sign --channel listed` on the released Firefox ZIP behind the `release` environment.

**Tech Stack:** Node 24, esbuild, web-ext 10.8.0, vitest, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-14-firefox-amo-design.md`

## Global Constraints

- Chrome, Edge and Safari manifests are byte-for-byte unchanged.
- Add-on ID stays `grades-dashboard@hirtfamily.net`; `strict_min_version` stays `128.0`.
- `data_collection_permissions` is exactly `{ "required": ["none"] }`; `gecko_android` is `{}`.
- Secrets: `AMO_JWT_ISSUER`, `AMO_JWT_SECRET` (passed to web-ext as `WEB_EXT_API_KEY`, `WEB_EXT_API_SECRET`).
- AMO summary ≤ 250 characters.

## Review Focus

1. Source ZIP rebuild differs from the uploaded package → verified by building from an exported copy and `diff -r`. (Task 2.)
2. `forFirefox` mutating its input → test that the input is unchanged. (Task 1.)
3. Dev builds losing the localhost port rewrite → test. (Task 1.)
4. Job running with only one of the two secrets → skips. (Task 3.)
5. `web-ext lint` errors on the built manifest → run it. (Task 1.)

### Task 1: `scripts/manifest-firefox.mjs`

**Files:** Create `scripts/manifest-firefox.mjs`, `test/unit/manifest-firefox.test.js`; modify `scripts/build.mjs`.

**Interfaces:** Produces `FIREFOX_ID` and `forFirefox(manifest) -> manifest` (a new object).

- [ ] Tests: background is `{ scripts: ['background.js'] }`; `options_ui` replaces `options_page`; gecko has the ID, `128.0` and the none declaration; `gecko_android` is `{}`; `localhost:*` loses its port in host permissions and content-script matches; input not mutated.
- [ ] Implement; use it in `build.mjs`; `npx web-ext lint -s dist-firefox` on a prod build has no errors.

### Task 2: Source ZIP

**Files:** Modify `.github/workflows/release.yml`; create `store/firefox/SOURCE.md`.

- [ ] `git archive --format=zip -o out/schoology-grades-extension-${RELEASE_VERSION}-source.zip HEAD` before the checksums; name it in the Release notes.
- [ ] `SOURCE.md`: Node 24, `npm ci`, `RELEASE_VERSION=<version> node scripts/build.mjs --firefox`, output `dist-firefox/`.
- [ ] Verify: export the tree to a temp folder, follow `SOURCE.md`, `diff -r` against a local build → identical.

### Task 3: `firefox` job

**Files:** Modify `.github/workflows/release.yml`.

- [ ] Job after `edge`: check both secrets → checkout → Node 24 → `npm ci` → download → unzip the Firefox ZIP → `npx web-ext sign --source-dir … --channel listed --upload-source-code … --approval-timeout 0`. Skip line names `docs/firefox-amo-setup.md`. YAML parses.

### Task 4: Kit, guide, pointers

**Files:** Create `store/firefox/README.md`, `docs/firefox-amo-setup.md`, `test/unit/firefox-listing.test.js`; modify `docs/release-plan.md`, `DEVELOPER.md`.

- [ ] Test: summary block ≤ 250 characters; referenced images exist.
- [ ] Write the kit and the guide (account, Android phone check, first submission by hand with the source ZIP, API keys, each release, site link).
- [ ] `npm run lint && npm test && npx playwright test --project=chromium`.
