# Microsoft Edge Add-ons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everything the repo needs to list Grades Dashboard on Microsoft Edge Add-ons: a listing kit, an owner setup guide, and a release job that uploads each version as a draft.

**Architecture:** Edge takes the existing Chrome ZIP unchanged. A small Node script (`scripts/publish-edge.mjs`, only `fetch`) uploads that ZIP to the Edge Add-ons Update REST API v1.1 and waits for the upload operation; it never publishes. A new `edge` job in `release.yml` runs it behind the `release` environment and skips until its settings exist.

**Tech Stack:** Node 24 (ES modules, built-in `fetch`), vitest, GitHub Actions, Playwright (only for `store:assets`).

**Spec:** `docs/superpowers/specs/2026-11-14-edge-add-ons-design.md`

## Global Constraints

- No changes under `extension/`; no new build target or ZIP.
- CI never calls Edge's publish endpoint (`POST /v1/products/<id>/submissions`).
- The Edge listing text never contains the word "Chrome".
- The API key is never printed or committed.
- API base: `https://api.addons.microsoftedge.microsoft.com`. Headers: `Authorization: ApiKey <key>`, `X-ClientID: <id>`.
- Settings names: variables `EDGE_PRODUCT_ID`, `EDGE_CLIENT_ID`; secret `EDGE_API_KEY`.
- Listing limits: description 250–10,000 characters; ≤ 7 search terms, ≤ 30 characters each, ≤ 21 words in total.
- Local e2e runs Chromium only (`npx playwright test --project=chromium`).

## Review Focus

1. Upload answers 202 but with no `Location` header → clear error, not a poll of `…/operations/undefined`. (Task 1 test.)
2. Operation stays `InProgress` past the retry limit → fails with a timeout message, never reports success. (Task 1 test.)
3. Operation `Failed` → the error carries the store's `message`, `errorCode` and `errors`. (Task 1 test.)
4. `EDGE_PRODUCT_ID` not a GUID, or a missing client ID or key → error before any request. (Task 1 test.)
5. Non-JSON error body (HTML 401/429 page) → error with the HTTP status, no JSON parse crash. (Task 1 test.)

---

### Task 1: `scripts/publish-edge.mjs`

**Files:**
- Create: `scripts/publish-edge.mjs`
- Test: `test/unit/publish-edge.test.js`

**Interfaces:**
- Produces: `publishEdge({ zip: { name, data: Buffer }, productId, clientId, apiKey, fetchImpl = fetch, log = console.log, sleep, pollMs = 5000, pollTries = 36 }) -> Promise<operation>` (the final operation JSON, `status: 'Succeeded'`). CLI: `node scripts/publish-edge.mjs <chrome.zip>` reading `EDGE_PRODUCT_ID`, `EDGE_CLIENT_ID`, `EDGE_API_KEY`; on error prints `::error::<message>` and exits 1 (same shape as `scripts/publish-chrome.mjs`).

- [ ] **Step 1: Write the failing tests** in `test/unit/publish-edge.test.js`, with a fake store like `publish-chrome.test.js`'s (answers carry `status`, optional `headers`, optional `body` or raw `text`; the fake's response has `headers.get(name)`):
  - uploads then polls: first call is `POST https://api.addons.microsoftedge.microsoft.com/v1/products/<PRODUCT>/submissions/draft/package` with headers `Authorization: 'ApiKey k'`, `'X-ClientID': 'cid'`, `'Content-Type': 'application/zip'` and body `zip.data`; second is `GET …/submissions/draft/package/operations/op-1`; result `status` is `'Succeeded'`; exactly 2 calls and none to a URL ending `/submissions`.
  - a `Location` given as a full path (`/v1/products/<PRODUCT>/submissions/draft/package/operations/op-1`) polls the same operation URL.
  - `InProgress`, `InProgress`, `Succeeded` → 3 status calls.
  - `Failed` with `{ message: 'Bad package', errorCode: 'X', errors: ['e1'] }` → rejects with a message containing `Bad package`, `X` and `e1`.
  - 202 without `Location` → rejects mentioning `Location`.
  - always `InProgress` with `pollTries: 2` → rejects mentioning `still in progress`.
  - upload 401 with raw text `<html>nope</html>` → rejects with `Upload failed (HTTP 401)`.
  - `productId: 'nope'`, `clientId: ''`, `apiKey: ''` each reject naming `EDGE_PRODUCT_ID`, `EDGE_CLIENT_ID`, `EDGE_API_KEY`; 0 calls.
  - the API key appears in no `log` line.
- [ ] **Step 2:** `npx vitest run test/unit/publish-edge.test.js` → FAIL (module not found).
- [ ] **Step 3: Implement** `publishEdge` and `main()`. Product ID check: `/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i`. Operation ID = last path segment of `Location`.
- [ ] **Step 4:** same command → PASS; `npm test` → all pass.
- [ ] **Step 5:** Commit.

### Task 2: `edge` job in `.github/workflows/release.yml`

**Files:**
- Modify: `.github/workflows/release.yml` (header comment's job list; new job after `chrome`)

**Interfaces:**
- Consumes: Task 1's CLI; the `release-files` artifact's `schoology-grades-extension-${VERSION}-chrome.zip`.

- [ ] **Step 1:** Add job `edge`: `needs: [verify, release]`, `environment: release`, same check → checkout → Node 24 → download → run → skip structure as `chrome`. Configured when `vars.EDGE_PRODUCT_ID`, `vars.EDGE_CLIENT_ID` and `secrets.EDGE_API_KEY` are all set. Skip line: `SKIPPED: Edge Add-ons upload. Set the EDGE_API_KEY secret and the EDGE_PRODUCT_ID and EDGE_CLIENT_ID variables (docs/edge-add-ons-setup.md); not a failure.`
- [ ] **Step 2:** Verify the YAML parses: `node -e "…"` is not available without a YAML lib, so run `npx --yes yaml-lint .github/workflows/release.yml` or `ruby -ryaml -e 'YAML.load_file(ARGV[0])' .github/workflows/release.yml` → no error.
- [ ] **Step 3:** Commit.

### Task 3: Listing kit `store/edge/`

**Files:**
- Create: `store/edge/README.md`, `store/edge/logo-300.png`
- Modify: `scripts/store-assets.mjs` (render the logo at 300×300 into `store/edge/`; header comment)
- Test: `test/unit/edge-listing.test.js`

- [ ] **Step 1: Write the failing test:** read `store/edge/README.md`; the first ```` ```text ```` block after `**Description**` has length ≥ 250 and ≤ 10000; the whole file has no match for `/chrome(?!-web-store|\/)/i` outside the lines that name the `store/chrome/` folder or the `-chrome.zip` file (simplest: strip those two literal strings, then expect no `/chrome/i`); the search-terms block has ≤ 7 lines, each ≤ 30 characters, ≤ 21 words in total.
- [ ] **Step 2:** run it → FAIL (no file).
- [ ] **Step 3:** Write `store/edge/README.md` following Partner Center's page order (Packages, Availability, Properties, Privacy, Store listings, Notes for certification). Description: the Chrome kit's text with "in Chrome"/"while Chrome is open" reworded for Microsoft Edge. Images: point at `../chrome/screenshot-1…5.png` and the two tiles; logo `logo-300.png`. Visibility: **Hidden** for the first round, then **Public**. Permission justifications, single purpose, data usage, privacy URL and test notes: the Chrome kit's, reworded where they name the browser.
- [ ] **Step 4:** Add the logo render to `scripts/store-assets.mjs` (logo at 268×268 centred on transparent 300×300), run `npm run store:assets`, keep only `store/edge/logo-300.png` if the Chrome images merely re-rendered.
- [ ] **Step 5:** test → PASS. Commit.

### Task 4: Owner guide and pointers

**Files:**
- Create: `docs/edge-add-ons-setup.md`
- Modify: `docs/release-plan.md` (§4 Edge rows, §5 secrets row, Phase 2 Edge bullet), `DEVELOPER.md` (release steps), `store/chrome/README.md` only if it needs a cross-link (it doesn't; leave it)

- [ ] **Step 1:** Write the guide: 1. Register (URL `https://partner.microsoft.com/dashboard/microsoftedge/public/login`, free, personal Microsoft account, individual vs company can't be changed, publisher display name ≤ 50 characters). 2. First submission by hand (ZIP from the GitHub Release, the kit, Hidden first). 3. After it's live: Product ID, Publish API credentials, the three `gh` commands, key expiry reminder. 4. Each release: approve the `edge` job, then Publish in Partner Center with notes. 5. Put the listing URL in `site/links.js`.
- [ ] **Step 2:** Update the release plan and DEVELOPER.md to match what exists now (kind of each setting: two variables and one secret).
- [ ] **Step 3:** `npm run lint && npm test && npx playwright test --project=chromium` → all pass. Commit.
