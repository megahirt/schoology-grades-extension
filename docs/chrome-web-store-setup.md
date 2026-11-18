# Chrome Web Store setup

Chrome is the **second** target — Safari first (many students use Safari). See `docs/safari.md` for the primary pipeline.

> Figures below (fees, listing requirements) come from Chrome Web Store
> developer documentation and the project spec; **verify at submission
> time** — store requirements change. Do not submit until the live probe
> (`test/probe/`) has proven the service-worker fetch against real
> Schoology.

## 1. Developer registration — $5 one-time

1. Sign in to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
   with the Google account that will own the listing.
2. Pay the **$5 one-time developer registration fee** (charged once per
   developer account, not per extension). Complete the identity
   verification the dashboard asks for.
3. The extension ID for CI uploads (`CWS_EXTENSION_ID`) exists only
   **after** the first manual upload creates the store item — see step 3.

## 2. Prepare the listing

Build the production extension first:

```bash
npm run build        # produces dist/ — must NOT contain localhost permissions
```

Zip `dist/` as `schoology-grades-extension-<version>-chrome.zip` (the
release workflow does this automatically on `vX.Y.Z` tags — see
`.github/workflows/release.yml`).

**Required assets:**

| Asset | Requirement (verify at submission time) |
|---|---|
| Store icon | 128×128 PNG |
| Screenshots | At least 1; 1280×800 or 640×400 recommended. Show the real dashboard (use demo-mode data, never a child's real grades). |
| Promotional tile (small) | 440×280 PNG |
| Description | What it does, that data stays local, that it needs a Schoology login. No misleading claims. |
| Category | Education (verify the closest category at submission). |
| Language | English. |

**Privacy practices (Chrome Web Store "Privacy" tab):**

- The extension requests host permission for `https://app.schoology.com/*`
  and `https://schoology.npchristian.org/*` only, plus `storage`, `alarms`
  and `tabs`.
- It collects **no data**: grades are fetched with the user's own
  logged-in Schoology session, parsed locally, and stored only in
  `chrome.storage.local` on the user's machine. There is no server, no
  analytics, no Schoology password stored, no Schoology API/OAuth.
- It does **not** sell or transfer user data to third parties.
- It does use a background tab as a fallback (hidden-tab scrape) only
  when fetch+parse cannot return the grades — disclose this plainly in
  the listing description and in-app, because undisclosed background
  scraping is what store review flags.
- A privacy policy is required if the extension handles personal data;
  host one (e.g. a GitHub Pages page) and link it, even for a
  "no data collected" listing — verify the current requirement in the
  dashboard at submission time.

## 3. Create the store item and choose Unlisted

1. Developer Dashboard → **New Item** → upload the ZIP.
2. Fill in the listing (description, icon, screenshots, category,
   privacy tab).
3. **Visibility: choose Unlisted** (not Public, not Private). Unlisted
   means anyone with the direct store link can install it, but it is
   not discoverable by search or browsing — the right fit for a family
   extension.
4. Submit for review. Chrome Web Store review typically takes a few
   days; the dashboard shows the status. Fix whatever review names and
   resubmit if rejected.

After the first upload, the dashboard shows the item's extension ID —
that is the `CWS_EXTENSION_ID` secret value for CI (below).

## 4. CI upload (service account, API v2)

On every `vX.Y.Z` tag, the release workflow's `chrome` job runs after the
GitHub Release is made, in the `release` environment, so it waits for the
owner's approval. It runs `scripts/publish-chrome.mjs`, which:

1. signs in as a Google **service account**;
2. uploads the release's `…-chrome.zip` (Chrome Web Store API v2);
3. submits it for review as **`DEFAULT_PUBLISH`**: once review passes, the
   update goes live by itself. Approving the `chrome` job is the go-live
   decision. (Set `CWS_PUBLISH_TYPE: STAGED_PUBLISH` in
   `.github/workflows/release.yml` to wait for a **Publish** click in the
   Developer Dashboard instead.)

Until all three settings below exist, the job prints `SKIPPED` and the
release still succeeds.

| Name | Kind | Value |
|---|---|---|
| `CWS_EXTENSION_ID` | repository **variable** | `nglbmnaepjadllenolmliglnonjkdhjp` (already set) |
| `CWS_PUBLISHER_ID` | repository **variable** | Developer Dashboard → **Publisher → Settings** |
| `CWS_SERVICE_ACCOUNT_JSON_B64` | **secret** in the `release` environment | the service account's JSON key, base64-encoded |

**One-time setup (owner):**

1. [Google Cloud Console](https://console.cloud.google.com/): create a
   project (any name), then **APIs & Services → Enable APIs** → enable the
   **Chrome Web Store API**.
2. **IAM & Admin → Service Accounts → Create service account** (no roles
   needed). Open it → **Keys → Add key → JSON**. A `.json` file downloads.
3. [Developer Dashboard](https://chrome.google.com/webstore/devconsole) →
   **Account**: add the service account's email (it ends in
   `iam.gserviceaccount.com`). Only one service account per publisher.
4. Store the key as a secret in the `release` environment, then delete the
   downloaded file:
   ```bash
   base64 -i ~/Downloads/<key>.json | gh secret set CWS_SERVICE_ACCOUNT_JSON_B64 --env release
   ```
5. Set the publisher ID:
   ```bash
   gh variable set CWS_PUBLISHER_ID --body <publisher-id>
   ```
6. The Google account that owns the listing needs **2-step verification**
   on to publish updates.

**Gotchas:**
- The upload fails unless the tag's version is higher than the store's.
- If you change visibility (Unlisted, Public) in the dashboard, publish
  once by hand there before the API can publish again.

## 5. Updates

Tag a commit on `main` with `vX.Y.Z` and push the tag (the version comes
only from the tag; see README → Releasing) — the release workflow
builds the ZIP and (if secrets are set) uploads it. Each upload is
reviewed again before it reaches users. Users get updates
automatically through Chrome.
