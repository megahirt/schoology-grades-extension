# Mac App Store listing kit (Safari)

Everything to paste into [App Store Connect](https://appstoreconnect.apple.com)
for **Grades Dashboard for Schoology** (bundle ID
`net.hirtfamily.schoology-dashboard`). Check each field's limit in App Store
Connect when you paste; Apple changes them.

## App information

| Field | Value |
|---|---|
| Name (30) | Grades Dashboard for Schoology |
| Subtitle (30) | Missing work and grades, calm |
| Primary category | Education |
| Secondary category | Productivity |
| Content rights | Does not contain third-party content |
| Age rating | Answer "None" to every question (rating 4+) |
| Copyright | 2026 Chris Hirt |
| Price | Free |
| Privacy policy URL | https://megahirt.github.io/schoology-grades-extension/privacy.html |
| Support URL | https://github.com/megahirt/schoology-grades-extension/issues |
| Marketing URL | https://megahirt.github.io/schoology-grades-extension/ |

## Version information

**Promotional text** (170):

```text
One calm page on top of Schoology: what's missing, what's due soon and how each class is going. For parents and students. Everything stays on your Mac.
```

**Keywords** (100, comma separated, no spaces):

```text
schoology,grades,homework,missing,assignments,parent,student,school,dashboard,due,safari,extension
```

**Description:**

```text
Grades Dashboard is a Safari extension that puts one calm page on top of Schoology. It shows what's missing, what's due soon, and how each class is going, for parents and students.

FOR PARENTS
• See missing work and low grades at a glance, for each of your children.
• An optional GO / NO-GO for the day, using simple rules you choose.
• Notice what's going well: good scores, classes going up, this week's progress.

FOR STUDENTS
• What to finish first, then what's due today and tomorrow.
• This week's progress ring and personal bests that only go up.
• Mark work you've turned in, so the list stays honest.

HOW IT WORKS
Turn the extension on in Safari's Settings, under Extensions, and allow it on your Schoology site. Sign in to Schoology in Safari as you normally do. The dashboard reads the same grades pages you can already see, and shows a panel on Schoology pages and in the toolbar button. Keep a Schoology tab open when you refresh.

PRIVATE BY DESIGN
• Everything stays on your Mac. Nothing is sent to us or anyone else.
• No account to create, no server, no analytics, no ads.
• Your Schoology password is never asked for or stored.
• The code is open source: https://github.com/megahirt/schoology-grades-extension

Works on app.schoology.com.

Grades Dashboard is an independent project. It is not made, endorsed or supported by Schoology or PowerSchool.
```

**What's New** (first version):

```text
First release for Safari on the Mac.
```

## Screenshots

Mac screenshots must be 1280×800, 1440×900, 2560×1600 or 2880×1800. The five
in `store/chrome/` (`screenshot-1.png` … `screenshot-5.png`) are 1280×800 and
show made-up students only. Look at each before uploading: one that shows
Chrome's window frame should be retaken in Safari.

## App Privacy

- **Data collection:** "No, we do not collect data from this app." Grades and
  names are read from Schoology and kept only in Safari's extension storage on
  the Mac. Nothing is sent anywhere; there is no server and no analytics.
- **Tracking:** No.

## Export compliance

The app uses no encryption of its own, only the HTTPS that macOS provides.
Answer "None of the algorithms mentioned above".

## App Review information

**Sign-in required:** No (the app itself has no sign-in).

**Notes:**

```text
Grades Dashboard is a Safari web extension. To use it: open the app once, turn the extension on in Safari > Settings > Extensions, and allow it on app.schoology.com.

The extension shows a dashboard of a student's grades from Schoology (a school learning system by PowerSchool). It needs a Schoology parent or student account, which schools issue to their families; we cannot create a demo account. Signed out, the toolbar button shows the dashboard's empty state and a prompt to sign in to Schoology.

The extension only reads Schoology pages the signed-in user can already see. It stores everything in Safari's extension storage on the Mac and sends nothing anywhere. There is no server, no account and no analytics.

Screenshots in the listing use made-up students. Source code: https://github.com/megahirt/schoology-grades-extension
```

Apple often asks for a way to see the app working. Be ready to send a short
screen recording, or ship a build with "Load demo data" (`node
scripts/build-safari.mjs --dev` includes it; a release build does not).

## Before you submit

- The containing app is still Apple's template screen (Guideline 4.4 risk).
- There is no `PrivacyInfo.xcprivacy` yet.
- Update the feedback address in App Store Connect to
  gradesdashboard@hirtfamily.net.
