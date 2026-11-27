# Microsoft Edge Add-ons setup

How to get **Grades Dashboard for Schoology** onto
[Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons), and
keep it updated. Edge takes the Chrome ZIP as is: there is no separate Edge
build.

> Steps and limits were checked against Microsoft's docs on 2026-11-14
> ([register](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account),
> [publish](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension),
> [API](https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/api/using-addons-api)).
> Partner Center changes; where it differs from this page, trust it.

The order matters: the API can't create a listing, so the first submission
is by hand (§2), and the API settings (§3) only exist after it.

## 1. Register as a developer (free, owner only)

1. Open <https://partner.microsoft.com/dashboard/microsoftedge/public/login>
   and sign in with a **personal Microsoft account** (Outlook.com, Live.com,
   Hotmail.com) or with GitHub. A work or school account can't register.
   If no registration form appears, go to **Account settings → Programs**
   and click **Get started** on the Microsoft Edge card.
2. Fill in the form:

   | Field | Notes |
   |---|---|
   | Country/region | Can't be changed later |
   | Account type | **Individual** or **Company**. Can't be changed later. Individual is quicker: Microsoft only checks that the display name is free. Company needs a company approver and can take days to weeks |
   | Publisher display name | Up to 50 characters, shown to users on the listing. Must be available |
   | Contact info | For account problems |

3. Accept the developer agreement and finish. There is no fee.

## 2. First submission, by hand

1. Download `schoology-grades-extension-<version>-chrome.zip` from the
   newest [GitHub Release](https://github.com/megahirt/schoology-grades-extension/releases).
2. Partner Center → **Microsoft Edge → Overview → Create new extension**,
   and upload the ZIP.
3. Work through **Availability**, **Properties**, **Privacy** and
   **Store listings** with [store/edge/README.md](../store/edge/README.md)
   open: it has the text and image for every field, in the same order.
   Choose **Hidden** visibility for the first round.
4. When the status says Complete, click **Publish**, paste the notes for
   certification from the kit, and click **Publish** again.
5. Certification can take up to seven business days. When it passes, install
   it from the listing link and check it against real Schoology.
6. When you're happy, switch **Availability → Visibility** to **Public** and
   publish again.

## 3. Let releases publish (after §2)

Each `vX.Y.Z` release runs the `edge` job in
[release.yml](../.github/workflows/release.yml). It waits for your approval
(the `release` environment), then `scripts/publish-edge.mjs` uploads the
release's ZIP into the Edge draft and **publishes** it, which sends it to
certification with the notes for certification
([store/edge/certification-notes.txt](../store/edge/certification-notes.txt)
plus the version's section of `RELEASE_NOTES.md`). It goes live when
certification passes, so approving the job is the go-live decision. Until
the three settings below exist, the job prints `SKIPPED` and the release
still succeeds.

| Name | Kind | Where it comes from |
|---|---|---|
| `EDGE_PRODUCT_ID` | repository **variable** | Partner Center → Microsoft Edge → Overview → the extension → **Extension identity → Product ID** (a GUID) |
| `EDGE_CLIENT_ID` | repository **variable** | Partner Center → Microsoft Edge → **Publish API** |
| `EDGE_API_KEY` | **secret** in the `release` environment | Same page |

1. Partner Center → **Microsoft Edge → Publish API**. If it offers the new
   experience, click **Enable**. Click **Create API credentials** (it can
   take a few minutes).
2. Copy the **Client ID** and the **API key**, and note the key's
   **Expiry** date in your calendar: releases stop reaching Edge after it
   (the job fails with HTTP 401), and you repeat this step with a new key.
3. Store them. The last command asks for the key, so it never lands in your
   shell history:

   ```bash
   gh variable set EDGE_PRODUCT_ID --body <product-id>
   ```

   ```bash
   gh variable set EDGE_CLIENT_ID --body <client-id>
   ```

   ```bash
   gh secret set EDGE_API_KEY --env release
   ```

## 4. Each release

1. Tag and push as usual (`DEVELOPER.md` → Releasing) and approve the
   `edge` job. Its log ends with `Submitted for certification`.
2. It goes live when certification passes (up to seven business days).
   Partner Center → the extension shows its progress.

To upload without publishing (to check the draft first, say), run the
script by hand with `--draft-only` and the three settings in your
environment, then click **Publish** in Partner Center.

**Gotchas:**

- Each release needs a version higher than the one in the store (tags
  already guarantee that).
- Only one submission can be in certification at a time. If the last one
  is still there, the job fails with `InProgressSubmission`; the new
  package is already in the draft. Once that review is done, re-run the
  `edge` job (or click **Publish** in Partner Center).
- Any other failure names the store's reason (`SubmissionValidationError`,
  `ModuleStateUnPublishable`, …) and what to fix in Partner Center.
- Listing text and images can't be changed through the API; edit them in
  Partner Center (and in `store/edge/README.md`, so the kit stays true).

## 5. Point the site at the listing

Once the listing is public, put its URL in `edge:` in
[site/links.js](../site/links.js). Until then the site's Edge button goes
to the Chrome Web Store, which Edge can also install from.
