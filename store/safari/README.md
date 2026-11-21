# App Store listing kit (Safari on Mac, iPhone and iPad)

Everything to paste into [App Store Connect](https://appstoreconnect.apple.com)
for **Grades Dashboard for Schoology** (bundle ID
`net.hirtfamily.schoology-dashboard`). Check each field's limit in App Store
Connect when you paste; Apple changes them.

## App information

| Field | Value |
|---|---|
| Name (30) | Grades Dashboard for Schoology |
| Subtitle (30) | Missing work, grades, due soon |
| Primary category | Education |
| Secondary category | Productivity |
| Content rights | Does not contain third-party content |
| Age rating | Answer "None" to every question (rating 4+) |
| Copyright | 2026 Chris Hirt |
| Price | Free |
| Privacy policy URL | https://schoology.hirtfamily.net/privacy.html |
| Support URL | https://github.com/megahirt/schoology-grades-extension/issues |
| Marketing URL | https://schoology.hirtfamily.net/ |

## Version information

**Promotional text** (170):

```text
One dashboard on top of Schoology: what's missing, what's due soon and how each class is going. For parents and students. Everything stays on your Mac.
```

**Keywords** (100, comma separated, no spaces):

```text
schoology,grades,homework,missing,assignments,parent,student,school,dashboard,due,safari,extension
```

**Description:**

```text
Grades Dashboard is a Safari extension that puts one dashboard on top of Schoology. It shows what's missing, what's due soon, and how each class is going, for parents and students.

FOR PARENTS
• See missing work and low grades at a glance, for each of your children.
• An optional GO / NO-GO for the day, using simple rules you choose.
• Notice what's going well: good scores, classes going up, this week's progress.

FOR STUDENTS
• What to finish first, then what's due today and tomorrow.
• This week's progress bar and personal bests that only go up.
• Mark work you've turned in, so the list stays honest.

HOW IT WORKS
Turn the extension on in Safari's Settings, under Extensions, and allow it on your Schoology site. Sign in to Schoology in Safari as you normally do. The dashboard reads the same grades pages you can already see, and shows a panel on Schoology pages; the toolbar button links to Schoology. Keep a Schoology tab open when you refresh.

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

Mac screenshots must be 1280×800, 1440×900, 2560×1600 or 2880×1800. Upload
the five in `store/chrome/` (`screenshot-1.png` … `screenshot-5.png`, in that
order). They are 1280×800, show no browser window frame, and use made-up
students only.

## iPhone and iPad

The same app record holds the iOS app (iPhone and iPad). It is added when the
first iOS build is uploaded (see `docs/safari.md`, "iOS and iPadOS"). App
Store Connect keeps the version information per platform, so paste the text
above into the iOS version too, with these changes:

- "your Mac" becomes "your device" (promotional text and description).
- In HOW IT WORKS, the first sentence becomes: "Turn the extension on in
  Settings, under Apps, Safari, Extensions, and allow it on your Schoology
  site."
- **What's New** (first version): "First release for iPhone and iPad."
- In the review notes, the way to turn it on is: Settings > Apps > Safari >
  Extensions.

**Screenshots** (made by `npm run appstore:assets`, made-up students only, no
alpha channel):

| Slot in App Store Connect | Files | Size |
|---|---|---|
| iPhone 6.3" display | `iphone/screenshot-1.png` … `-3.png` | 1179×2556 |
| iPad 13" display | `ipad/screenshot-1.png` … `-3.png` | 2732×2048 |
| Header (creative asset) | `iphone/header-1.png` … `-3.png` | 3840×1646 |
| Search Results (creative asset) | `iphone/search-results-1.png` … `-3.png` | 3840×2560 |

If App Store Connect asks for another size, it says which when you upload;
the sizes are set at the top of each block in `scripts/appstore-assets.mjs`.

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

The extension shows a dashboard of a student's grades from Schoology (a school learning system by PowerSchool). It needs a Schoology parent or student account, which schools issue to their families; we cannot create a demo account. The toolbar button lists the Schoology addresses where the dashboard appears, and its "See a demo" link opens the dashboard with a "Show demo data" button that shows made-up students.

The extension only reads Schoology pages the signed-in user can already see. It stores everything in Safari's extension storage on the Mac and sends nothing anywhere. There is no server, no account and no analytics.

Screenshots in the listing use made-up students. Source code: https://github.com/megahirt/schoology-grades-extension
```

Apple often asks for a way to see the app working. Be ready to send a short
screen recording, or point the reviewer to demo mode: toolbar button → "See
a demo" → "Show demo data", or Settings → Privacy & data → "Show demo data"
(offered while nothing is saved). Schoology's pages then show made-up
students, and nothing is read from Schoology until "Exit demo mode".

## Before you submit

- Build the app with `APPLE_TEAM_ID=... BUILD_NUMBER=... npm run build:safari`,
  then archive and upload from Xcode. The build puts in the app's own screen
  and the privacy manifest (`scripts/safari-app.mjs`).
- Run the app once from Xcode and read its screen: it is what the reviewer
  sees first.
- Set the contact email in App Store Connect to
  gradesdashboard@hirtfamily.net.
