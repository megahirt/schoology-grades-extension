# Microsoft Edge Add-ons listing kit

Everything to paste into
[Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/overview)
for **Grades Dashboard for Schoology**, in the order Partner Center asks for
it. First-time setup (account, first submission, API key) is in
[docs/edge-add-ons-setup.md](../../docs/edge-add-ons-setup.md).

Limits and field names below were checked against Microsoft's docs on
2026-11-14. If Partner Center shows something different, trust Partner
Center.

> Microsoft's certification rejects a listing that names another browser.
> Every `text` block here is written for Edge; keep it that way when you
> edit (a unit test checks).

---

## 1. Packages

Upload the **`schoology-grades-extension-<version>-chrome.zip`** from the
[GitHub Release](https://github.com/megahirt/schoology-grades-extension/releases),
not a local build. Edge takes this ZIP as is.

| Field | Value |
|---|---|
| Name | Grades Dashboard for Schoology (from the manifest) |
| Short description | From the manifest `description`; it can't be edited in Partner Center |

## 2. Availability

| Field | Value |
|---|---|
| Visibility | **Hidden** for the first round (only people with the link can find it), then **Public** |
| Markets | All markets (the default) |

## 3. Properties

| Field | Value |
|---|---|
| Category | Education (or the closest one offered) |
| Website | https://megahirt.github.io/schoology-grades-extension/ |
| Support contact | https://github.com/megahirt/schoology-grades-extension/issues |
| Mature content | No (leave unticked) |

## 4. Privacy

**Single purpose description:**

```text
Shows a student's Schoology grades, missing work and due dates on one simple dashboard, for the student and their parents.
```

**Permission justifications** (one box per permission):

storage:

```text
Saves the dashboard (grades, assignments and due dates read from Schoology), the user's settings, and items they mark as turned in, in the browser's local extension storage. This lets the dashboard open instantly and remember the user's choices. Nothing is sent off the device; there is no server.
```

alarms:

```text
Schedules a refresh about once an hour while the browser is open, so the dashboard shows current grades and due dates without the user having to open Schoology and press Refresh.
```

tabs:

```text
Opens assignment and class links from the dashboard in a tab, and finds the open Schoology tab so the toolbar button shows the right school's dashboard. As a fallback, when a grades page can't be read directly, it briefly opens that Schoology grades page in a background tab, reads it, and closes it. This is disclosed in the listing and privacy policy. It does not read or track the user's other tabs.
```

Host permission:

```text
https://app.schoology.com/* and https://schoology.npchristian.org/* : the extension reads the grades pages the signed-in user can already see in Schoology, using their existing browser session, to build the dashboard, and shows the dashboard panel on those pages. These are the only sites it can access. All data stays on the device; nothing is sent to any server.
```

**Remote code:** No, I am not using remote code. (All code is in the
package; no external scripts, no `eval`.)

**Data usage:** nothing is collected. The extension reads grades and names
from Schoology to show them, keeps them only in the browser's extension
storage on the device, and never sends them anywhere. Read Partner Center's
definitions as you fill this in: if they count data used only on the
device, tick personally identifiable information (student names) and
website content (grades). Tick the certifications that you don't sell or
transfer user data.

**Privacy policy URL:** https://megahirt.github.io/schoology-grades-extension/privacy.html

## 5. Store listings (English, United States)

**Description** (250 to 10,000 characters; paste as is):

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
Sign in to Schoology in Microsoft Edge as you normally do. The dashboard reads the same grades pages you can already see, and shows a panel on Schoology pages and in the toolbar button. It refreshes about once an hour while Microsoft Edge is open. If a page can't be read directly, it may briefly open a Schoology page in a background tab, read it, and close it.

PRIVATE BY DESIGN
• Everything stays on your device. Nothing is sent to us or anyone else.
• No account to create, no server, no analytics, no ads.
• Your Schoology password is never asked for or stored.
• The code is open source: https://github.com/megahirt/schoology-grades-extension

Works on app.schoology.com. Support for schools that use their own address for Schoology is coming soon.

Grades Dashboard is an independent project. It is not made, endorsed or supported by Schoology or PowerSchool.
```

| Field | File |
|---|---|
| Extension logo (300×300) | `logo-300.png` |
| Small promotional tile (440×280) | `../chrome/promo-small-440x280.png` |
| Large promotional tile (1400×560) | `../chrome/promo-marquee-1400x560.png` |
| Screenshots (1280×800, up to 6, in this order) | `../chrome/screenshot-1.png`, `../chrome/screenshot-2.png`, `../chrome/screenshot-3.png`, `../chrome/screenshot-4.png`, `../chrome/screenshot-5.png` |
| YouTube video | none |

The images are shared with the Chrome kit and show only made-up students
(the Rivera family). Regenerate them all, and the logo, with
`npm run store:assets`.

**Search terms** (up to 7 terms, 30 characters each, 21 words in all; one
per box):

```text
Schoology
grades
missing assignments
homework tracker
parent dashboard
student planner
school grades
```

## 6. Notes for certification

Paste this when you click Publish, on the "Submit your extension" page:

```text
The extension needs a Schoology account to show real grades. Without one, open the toolbar button and click "Load demo data" to see the full dashboard with made-up students. With a Schoology account: sign in at app.schoology.com, open Grades, and the dashboard panel appears on the right; the toolbar button shows the same dashboard.
```

For an update, add one line saying what changed (the GitHub Release notes
have it).
