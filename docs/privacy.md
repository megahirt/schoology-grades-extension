# Privacy Policy: Grades Dashboard for Schoology

> **DRAFT, not yet published.** Owner to review, fill in the contact
> email, and set the effective date before this is linked from any store
> listing.

**Effective date:** _[date of first store release]_
**Applies to:** the "Grades Dashboard for Schoology students and parents"
browser extension for Safari (macOS and iOS), Chrome, Edge and Firefox,
and its Mac/iOS containing app.
**Publisher:** Chris Hirt (individual developer)

## The short version

The extension **does not collect, transmit, sell or share any personal
data**. There is no server, no account to create, no analytics, no
advertising and no tracking. Everything it reads from Schoology stays in
your browser's own extension storage on your device.

## What the extension reads

When you are signed in to Schoology in your browser, the extension reads
your Schoology pages (or fetches them in the background, using the
session you're already signed in with) to build its dashboard:

- Student and class names, grades, assignments, due dates, and whether
  work is missing, submitted or graded.
- For parent accounts: the list of children linked to the account.
- Profile pictures, which are loaded straight from Schoology to show in
  the dashboard.

It never asks for or stores your Schoology password. It doesn't use the
Schoology API or any sign-in tokens. It only works with pages on
`*.schoology.com`, the one site it has permission to access.

## What is stored, and where

The extension keeps the following **only in your browser's extension
storage on your device** (`storage.local`):

- The latest dashboard data built from your Schoology pages.
- Your settings (which classes to show, icons, GO/NO-GO rules, Schoology
  address).
- Items you've marked as turned in, and the dashboard's personal-best
  records.
- The result of the optional connection test.

None of this is sent anywhere. It isn't synced to other devices by the
extension. It's deleted when you remove the extension. You can also clear
the saved grades and marks at any time with **Clear data…** on the
extension's settings page (your settings are kept).

## What is sent, and to whom

- **To Schoology only:** the extension's requests go to Schoology's own
  website, like the requests your browser makes when you browse it
  yourself. Schoology's handling of your data is covered by your school's
  agreement with Schoology/PowerSchool and their privacy policy.
- **To the publisher: nothing.** We don't operate any server, and the
  extension has no code that sends data to us or to anyone else.
- **No third parties.** No analytics, crash-reporting, advertising or
  tracking services are included.

### Background refresh

To keep the dashboard current, the extension refreshes about once an hour
while your browser is open. If Schoology's page can't be read directly,
it may briefly open a Schoology page in a background tab, read it, and
close it. This is the same data you could see yourself, read the same
way, and it stays on your device.

## Store statistics

The browser stores (Apple App Store, Chrome Web Store, Microsoft Edge
Add-ons and Firefox Add-ons) give developers **aggregate, anonymous**
statistics they collect themselves, such as install counts, active-user
counts, versions, and country or operating system breakdowns. We may look
at these numbers to see how many people use the extension. They don't
identify you, and the extension doesn't add anything to them. Each
store's own privacy policy covers what it collects.

## Children and students

The extension is meant for students and their parents, including
students under 13. Because it collects no personal information, and
nothing leaves the device, we don't knowingly collect data from children
or anyone else. A parent or school can review exactly what the extension
does, because its source code is public:
<https://github.com/sabaisnoopy/schoology-grades-extension>.

## Permissions, and why

| Permission | Why |
|---|---|
| Access to `*.schoology.com` | Read your grades and assignments from Schoology. No other site. |
| `storage` | Save the dashboard and your settings on your device. |
| `alarms` | Schedule the hourly refresh. |
| `tabs`, `scripting` | Open Schoology links from the dashboard, show the dashboard panel on Schoology pages, and the background-tab fallback described above. |

## Changes to this policy

If the extension ever changes how it handles data, this policy is
updated first, with a new effective date. The change history is public in
the GitHub repository. A change that would send data off your device
would be announced in the release notes and the store listings before it
ships.

## Not affiliated with Schoology

This is an independent project. It is not made, endorsed or supported by
Schoology or PowerSchool. "Schoology" is a trademark of its owner.

## Contact

Questions or concerns:
[open an issue on GitHub](https://github.com/sabaisnoopy/schoology-grades-extension/issues)
or email _[contact email, owner to fill in]_.
