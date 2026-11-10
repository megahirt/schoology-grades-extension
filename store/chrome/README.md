# Chrome Web Store listing kit

Everything to paste into the
[Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
for **Grades Dashboard for Schoology**. Images are in this folder; regenerate
them with `npm run store:assets` (after `npm run site:screenshots`).

Upload the **`schoology-grades-extension-<version>-chrome.zip`** from the
GitHub Release, not a local build.

---

## Package (from the ZIP)

| Field | Value |
|---|---|
| Name | Grades Dashboard for Schoology (from the manifest) |
| Summary | See missing work, what's due and how grades are going in Schoology, on one calm page. Everything stays on your device. (manifest `description`, 118 of 132 characters) |

## Store listing tab

**Description** (plain text; paste as is):

```text
Grades Dashboard puts one calm page on top of Schoology. It shows what's missing, what's due soon, and how each class is going, for parents and students.

FOR PARENTS
• See missing work and low grades at a glance, for each of your children.
• An optional GO / NO-GO for the day, using simple rules you choose.
• Notice what's going well: good scores, classes going up, this week's progress.

FOR STUDENTS
• What to finish first, then what's due today and tomorrow.
• This week's progress ring and personal bests that only go up.
• Mark work you've turned in, so the list stays honest.

HOW IT WORKS
Sign in to Schoology in Chrome as you normally do. The dashboard reads the same grades pages you can already see, and shows a panel on Schoology pages and in the toolbar button. It refreshes about once an hour while Chrome is open. If a page can't be read directly, it may briefly open a Schoology page in a background tab, read it, and close it.

PRIVATE BY DESIGN
• Everything stays on your device. Nothing is sent to us or anyone else.
• No account to create, no server, no analytics, no ads.
• Your Schoology password is never asked for or stored.
• The code is open source: https://github.com/megahirt/schoology-grades-extension

Works on schoology.com addresses. Support for schools that use their own address for Schoology is coming soon.

Grades Dashboard is an independent project. It is not made, endorsed or supported by Schoology or PowerSchool.
```

| Field | Value |
|---|---|
| Category | Education |
| Language | English (United States) |
| Store icon | 128×128, taken from the package (`icons/icon128.png`) |
| Screenshots | `screenshot-1.png` … `screenshot-5.png` (1280×800, in this order) |
| Small promo tile | `promo-small-440x280.png` |
| Marquee promo tile (optional) | `promo-marquee-1400x560.png` |
| Official URL | none (needs a verified domain; skip) |
| Homepage URL | https://megahirt.github.io/schoology-grades-extension/ |
| Support URL | https://github.com/megahirt/schoology-grades-extension/issues |
| Mature content | No |

Screenshots (all made-up students, the Rivera family):

1. `screenshot-1.png`: the dashboard next to a Schoology course page.
2. `screenshot-2.png`: a parent's view of Jamie: NO-GO with missing work first.
3. `screenshot-3.png`: Sam's own view: what to finish first.
4. `screenshot-4.png`: a class's grade over the quarter.
5. `screenshot-5.png`: doing well and personal records.

## Privacy practices tab

**Single purpose:**

```text
Shows a student's Schoology grades, missing work and due dates on one simple dashboard, for the student and their parents.
```

**Permission justifications** (one box each in the dashboard; paste the text):

The release build asks only for `storage`, `alarms`, `tabs` and the Schoology
host permissions. Adding a school's own address (`https://*/*`, `scripting`,
`activeTab`) is left out for now to avoid the in-depth review; see
`ASK_FOR_OTHER_SCHOOL_SITES` in `scripts/build.mjs`.

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
https://*.schoology.com/* and https://schoology.npchristian.org/* : the extension reads the grades pages the signed-in user can already see in Schoology, using their existing browser session, to build the dashboard, and shows the dashboard panel on those pages. These are the only sites it can access. All data stays on the device; nothing is sent to any server.
```

**Remote code:** No, I am not using remote code. (All code is in the package; no external scripts, no `eval`.)

**Data usage:**

- What user data do you plan to collect: **none** of the categories. The extension reads grades and names from Schoology to show them, but keeps them only in the browser's extension storage on the device and never sends them anywhere.
  - Read the dashboard's definition when you fill this in. If it counts data used only on the device, tick **Personally identifiable information** (student names) and **Website content** (grades), since that's what it reads.
- Tick all three certifications:
  - I do not sell or transfer user data to third parties, outside of the approved use cases.
  - I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
  - I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://megahirt.github.io/schoology-grades-extension/privacy.html

## Distribution tab

| Field | Value |
|---|---|
| Payments | Free |
| Visibility | **Private** for the first round (add family Google accounts as trusted testers), then **Public** |
| Regions | All regions |

## Notes for review (Test instructions field)

```text
The extension needs a Schoology account to show real grades. Without one, open the toolbar button and click "Load demo data" to see the full dashboard with made-up students. With a Schoology account: sign in at app.schoology.com, open Grades, and the dashboard panel appears on the right; the toolbar button shows the same dashboard.
```
