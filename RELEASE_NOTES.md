# Release notes

What's new in each version of Grades Dashboard for Schoology, newest first.

The section for a version is written before that version is tagged: it
becomes the What's new note the extension shows once after updating, the
App Store's What's New, the Firefox release notes and the top of the
GitHub release. Format: `scripts/release-notes.mjs`.

Only a version with a `### ✨ New` section shows the What's new note in the
extension. A version with only `### 🛠️ Fixed` (or other sections) updates
quietly; its notes still go to the stores and the GitHub release.

## 1.7.1 — November 28, 2026

### 🛠️ Fixed

- 🤫 Small updates with only fixes, like this one, no longer show a What's new note.
- 🧩 Updates reach Microsoft Edge Add-ons on their own, the same as the other stores.

## 1.7.0 — November 22, 2026

### ✨ New

- 🏷️ A small badge shows where each assignment is turned in: S for Schoology, G for Google, Δ for DeltaMath, or a globe for another online tool.
- ⌛ Due soon lists work you can turn in online first, within each day.

### 🛠️ Fixed

- ✅ Work done on paper or in class no longer shows as Overdue. Once its due date passes it counts as done, unless the teacher marks it Missing.
- 📊 This week's progress bar and each class's checks count that work as done, shown as "done offline".
- 📬 Paper and in-class work no longer shows under Submitted, not graded yet.

## 1.6.0 — November 21, 2026

### ✨ New
- 📰 **What's new:** after each update, a short note like this one shows what changed.
- 📶 A thin bar under the tabs while grades refresh, instead of the big Refreshing box.

### 🛠️ Fixed
- 😬 Overdue leaves out work handed in on paper, and tests that can't be turned in online.
- 👨‍👩‍👧 Opening a child's class page no longer starts a full refresh.
- 📱 On phones, the header buttons get their own row under the greeting.

## 1.5.0 — November 21, 2026

### ✨ New
- 🖨️ **Print** a one-page sheet in color, with a box to tick off each item and a Doing well section. Look for the ![Print button](docs/release-notes/print-button.png) at the top of the dashboard.
- 👀 **Try it first:** Settings can show demo data before you sign in to Schoology.
- 🧭 A simpler toolbar button that opens the dashboard.
- 🌐 A new website: schoology.hirtfamily.net

### 🛠️ Fixed
- 📱 On phones, tapping a link closes the dashboard so you can see the page.
- 🍎 Clearer setup steps on Mac.

## 1.4.1 — November 18, 2026

### ✨ New
- 🍎 **Safari:** now on the App Store for Mac, iPhone and iPad.

## 1.4.0 — November 18, 2026

### ✨ New
- 🎃 **Holiday logos** on the dashboard and in Settings, for a few days around each holiday.
- 🏷️ Overdue shows each item's class.
- 🚦 **Overdue work limit** in Family rules: past that many overdue items, the verdict is NO-GO.

### 🛠️ Fixed
- ⚙️ Small improvements to Settings.

## 1.3.0 — November 17, 2026

### ✨ New
- 😬 **Overdue:** a new section right after Missing work.

### 🛠️ Fixed
- 💛 The thanks box in Settings starts closed.

## 1.2.4 — November 16, 2026

### 🛠️ Fixed
- 📱 A sharper dashboard and icons in Safari on iPhone.
- 📸 On phones, Share saves the picture when it can't be copied or shared.

## 1.2.3 — November 15, 2026

### ✨ New
- 🌟 **New since you last looked:** new items fade in, and good news gets one small celebration.
- 🚀 The rocket flies along the week's bar when more work gets done.
- ☑️ Students can mark work done. It stays in its list, crossed out, with Undo.
- 🪪 A compact name card with a progress bar, and child tabs that stay at the top.

### 🛠️ Fixed
- 📱 On phones, the dashboard fills the screen at a readable size.
- ❌ A clearer Close button.

## 1.2.2 — November 15, 2026

### 🛠️ Fixed
- 💙 A tidier About card in Settings, with Send feedback and Visit the website buttons.

## 1.2.1 — November 14, 2026

### ✨ New
- 🦊 **Firefox:** on Firefox Add-ons, for computers and Android.

## 1.2.0 — November 14, 2026

### ✨ New
- 🌐 **Chrome and Edge:** on the Chrome Web Store.
- ℹ️ An About section in Settings.

## 1.1.1 — November 10, 2026

### 🛠️ Fixed
- 🔒 Asks for access to fewer Schoology addresses.

## 1.1.0 — November 10, 2026

### ✨ New
- 🗓️ Each class shows this week's work.
- 🚀 The rocket logo in the dashboard header.

### 🛠️ Fixed
- 🎯 This week's ring counts Missing work too.
- 📸 Shared pictures look right.

## 1.0.1 — November 10, 2026

### 🛠️ Fixed
- 🔒 No longer asks for access to every website.
- 🖼️ A crisper icon in the Chrome Web Store.

## 1.0.0 — November 10, 2026

The first release.

### ✨ New
- 📋 **One dashboard** right on Schoology: Missing work, Due soon and every class's grade on one page.
- 🚦 **GO / NO-GO** for parents: one look says whether homework is under control.
- 📈 Each class shows its quarter and semester grades and a trend line. Click it for a chart of every graded assignment.
- ⏳ **Submitted, not graded yet** shows work waiting on the teacher, and **Doing well** shows recent good grades.
- 🎯 This week's ring and records cheer on work turned in, extra credit too.
- 📸 **Share** a picture of the dashboard.
- 👨‍👩‍👧 Switch between children, and parent and student sign-ins keep their data apart.
- 🏫 Works with a school's own Schoology address.
- 🎚️ Family rules in Settings: passing grade, Doing well and the Missing work limit.
- 🔒 Everything is worked out on your device. Nothing is sent anywhere.
