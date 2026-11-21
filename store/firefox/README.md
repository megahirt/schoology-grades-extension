# Firefox Add-ons (AMO) listing kit

Everything to paste into the
[Add-on Developer Hub](https://addons.mozilla.org/developers/) for
**Grades Dashboard for Schoology**, in the order the submission asks for
it. First-time setup (account, phone check, first submission, API keys) is
in [docs/firefox-amo-setup.md](../../docs/firefox-amo-setup.md).

Field names and limits were checked against Mozilla's docs on 2026-11-14.
Mozilla's pages don't list the category or license options, so those two
say what to look for. If the Developer Hub shows something different,
trust it.

---

## 1. Upload version

| Field | Value |
|---|---|
| Where to distribute | **On this site** (listed) |
| File | `schoology-grades-extension-<version>-firefox.zip` from the [GitHub Release](https://github.com/megahirt/schoology-grades-extension/releases), not a local build |
| Compatible platforms | **Firefox** and **Firefox for Android** |

Validation shows warnings about `innerHTML` and about a manifest key that
older Firefox versions don't know (the data collection declaration; they
ignore it). Warnings don't block the submission.

## 2. Source code

**Do you need to submit source code? Yes.** The package is bundled with
esbuild. Upload `schoology-grades-extension-<version>-source.zip` from the
same GitHub Release. It contains [SOURCE.md](SOURCE.md), the build steps
for the reviewer.

## 3. Describe add-on

| Field | Value |
|---|---|
| Name | Grades Dashboard for Schoology (from the manifest) |
| Add-on URL | `grades-dashboard-for-schoology`, if it's free |
| Experimental | No |
| Requires payment, non-free services or software, or additional hardware | No |
| Firefox categories (up to 2) | The closest to education or productivity; "Other" if neither is offered |
| Firefox for Android categories (up to 2) | The same |
| Support email | gradesdashboard@hirtfamily.net |
| Support website | https://github.com/megahirt/schoology-grades-extension/issues |
| License | MIT License (the repo's `LICENSE`) |

**Summary** (up to 250 characters; from the manifest, paste if the box is
empty):

```text
See missing work, what's due and how grades are going in Schoology, on one dashboard. Data stays on your device.
```

**Description** (paste as is):

```text
Grades Dashboard puts one dashboard on top of Schoology. It shows what's missing, what's due soon, and how each class is going, for parents and students.

FOR PARENTS
• See missing work and low grades at a glance, for each of your children.
• An optional GO / NO-GO for the day, using simple rules you choose.
• Notice what's going well: good scores, classes going up, this week's progress.

FOR STUDENTS
• What to finish first, then what's due today and tomorrow.
• This week's progress bar and personal bests that only go up.
• Mark work you've turned in, so the list stays honest.

HOW IT WORKS
Sign in to Schoology in Firefox as you normally do. The dashboard reads the same grades pages you can already see, and shows a panel on Schoology pages and in the toolbar button. It refreshes about once an hour while Firefox is open. If a page can't be read directly, it may briefly open a Schoology page in a background tab, read it, and close it.

PRIVATE BY DESIGN
• Everything stays on your device. Nothing is sent to us or anyone else.
• No account to create, no server, no analytics, no ads.
• Your Schoology password is never asked for or stored.
• The code is open source: https://github.com/megahirt/schoology-grades-extension

Works on app.schoology.com. Support for schools that use their own address for Schoology is coming soon.

Grades Dashboard is an independent project. It is not made, endorsed or supported by Schoology or PowerSchool.
```

**Privacy policy:** tick "This add-on has a privacy policy" and paste the
text of <https://schoology.hirtfamily.net/privacy.html>
(source: `docs/privacy.md`). Mozilla requires one only when data leaves the
device, and none does, but the other stores have ours and it costs nothing
to show it here too.

**Notes for reviewers:**

```text
The add-on needs a Schoology account to show real grades. Without one, click the toolbar button, then "See a demo", then "Show demo data" to see the full dashboard with made-up students. With a Schoology account: sign in at app.schoology.com, open Grades, and the dashboard panel appears on the right; the toolbar button links to the Schoology pages where it appears.

No data is collected or sent anywhere: grades are read from the Schoology pages the signed-in user can already see and are kept in the browser's extension storage (data_collection_permissions: none).

Source code: the package is bundled with esbuild, not minified. The attached source ZIP has the build steps in store/firefox/SOURCE.md (Node 24: npm ci, then RELEASE_VERSION=<this version> node scripts/build.mjs --firefox; the result is in dist-firefox/).
```

## 4. Images (after the first submission, under Edit Product Page)

| Field | File |
|---|---|
| Icon | Taken from the package. If the page asks for one: `../chrome/store-icon-128.png` |
| Screenshots (1280×800, in this order) | `../chrome/screenshot-1.png`, `../chrome/screenshot-2.png`, `../chrome/screenshot-3.png`, `../chrome/screenshot-4.png`, `../chrome/screenshot-5.png` |

The images are shared with the Chrome kit and show only made-up students
(the Rivera family). Regenerate them with `npm run store:assets`.
