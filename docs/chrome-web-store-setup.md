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

Zip `dist/` as `schoology-grades-extension-<version>.zip` (the
release workflow does this automatically on version tags — see
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

- The extension requests host permission for `https://*.schoology.com/*`
  only, plus `storage`, `alarms`, `scripting`, `tabs`.
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

## 4. CI upload (optional — guarded skip)

The release workflow (`.github/workflows/release.yml`) uploads to the
Web Store **second**, after the Safari job, using
`chrome-webstore-upload-cli` via `npx` with these repository secrets:

| Secret | Value |
|---|---|
| `CWS_CLIENT_ID` | OAuth client ID (Google Cloud project, Chrome Web Store API enabled) |
| `CWS_CLIENT_SECRET` | OAuth client secret |
| `CWS_REFRESH_TOKEN` | OAuth refresh token for the developer account |
| `CWS_EXTENSION_ID` | The store item ID from step 3 |

**Skip behaviour (by design):** if any of those secrets is not set,
the upload step **skips gracefully** with a clear echo message and the
release still succeeds with the ZIP attached. The account owner has **not** done
Chrome Web Store developer setup yet, and no store credentials exist —
do not invent them. The manual upload in step 3 is the path until the
secrets are set.

To set up the OAuth credentials when ready: create a Google Cloud
project, enable the Chrome Web Store API, create OAuth 2.0 credentials
(Web application), and generate a refresh token for the developer
account (the `chrome-webstore-upload-cli` README documents the flow —
verify it at setup time). Store all four values as GitHub repository
secrets, never in the repo.

## 5. Updates

Bump the version in `package.json` and `extension/manifest.json`
(they must match), tag `v<version>`, push — the release workflow
builds the ZIP and (if secrets are set) uploads it. Each upload is
reviewed again before it reaches users. Users get updates
automatically through Chrome.
