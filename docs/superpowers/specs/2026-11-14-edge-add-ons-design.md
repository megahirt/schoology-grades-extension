# Microsoft Edge Add-ons listing: design

Approved by Chris on 2026-11-14.

## Intent

List **Grades Dashboard for Schoology** on Microsoft Edge Add-ons, so Edge
users find it in Edge's own store instead of being sent to the Chrome Web
Store. Chris registers as a developer in Partner Center; the repo supplies
everything else.

## Goals

- A listing kit to paste into Partner Center (`store/edge/`).
- A step-by-step owner guide: registration, first manual submission, API
  credentials (`docs/edge-add-ons-setup.md`).
- Each `vX.Y.Z` release uploads the package to Edge as a **draft**; the
  owner clicks Publish in Partner Center.
- The site's Edge button points at the Edge listing once it exists.

## Non-goals

- No extension code or manifest changes. Edge takes the Chrome ZIP as is
  (no `update_url` in our manifest; the manifest text doesn't say "Chrome").
- No separate Edge build or ZIP.
- CI never calls Edge's publish endpoint.

## Anti-goals

- Anything going live on Edge without the owner's click.
- The word "Chrome" in the Edge listing text (Microsoft's certification
  rejects it).
- API credentials in the repo or in logs.

## Constraints (checked against Microsoft's docs, 2026-11-14)

- Registration is free; needs a personal Microsoft account (or GitHub
  sign-in), not a work or school account. Account type (individual or
  company) can't be changed later.
- The API can't create a product or edit listing text: the first
  submission is by hand in Partner Center.
- Update REST API v1.1: `Authorization: ApiKey <key>` and
  `X-ClientID: <id>`; upload is
  `POST /v1/products/<productID>/submissions/draft/package` with
  `Content-Type: application/zip`, answering 202 with the operation ID in
  `Location`; status is
  `GET …/submissions/draft/package/operations/<operationID>` with
  `status` of `InProgress`, `Succeeded` or `Failed`.
- Listing: description 250 to 10,000 characters; logo 1:1, 300×300
  recommended (128 minimum); up to 6 screenshots at 1280×800 or 640×480;
  tiles 440×280 and 1400×560; up to 7 search terms, 30 characters each,
  21 words in total.
- API keys expire; Partner Center shows the date.

## Approaches

1. **Kit + guide + draft-upload job (picked).** Same shape as the Chrome
   setup: a `scripts/publish-edge.mjs` using only Node's `fetch`, unit
   tested against a fake store, and an `edge` job in `release.yml` that
   skips until its settings exist. Matches `docs/release-plan.md` §4.
2. **Kit + guide only, upload by hand each release.** Less to build, but
   every release needs a manual ZIP upload and Edge drifts behind Chrome.
3. **Upload and publish from CI.** One fewer click, but removes the
   owner's Publish click that the release plan requires on every store.

Chris picked 1.

## Design

- `store/edge/README.md`: Edge-worded description, search terms, Privacy
  page answers, certification notes. Reuses `store/chrome/` screenshots
  and tiles; adds `store/edge/logo-300.png` from `npm run store:assets`.
- `docs/edge-add-ons-setup.md`: owner steps.
- `scripts/publish-edge.mjs`: `publishEdge({ zip, productId, clientId,
  apiKey })` uploads, polls the operation, fails with the store's message
  on `Failed` or timeout. Never prints the key.
- `release.yml` `edge` job: after `release`, in the `release`
  environment. Settings: variables `EDGE_PRODUCT_ID`, `EDGE_CLIENT_ID`;
  secret `EDGE_API_KEY`.
- `site/links.js` `edge:` is filled in after the listing is live (not in
  this change).
- `docs/release-plan.md`, `DEVELOPER.md`: point at the new pieces.

## Left to the builder

Polling interval and retry count; wording of log lines.
