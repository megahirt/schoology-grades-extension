// safari-app.mjs — turn the packager's template app into ours
// (scripts/build-safari.mjs runs it after every conversion).
//
// A Safari web extension ships inside a small app, one for the Mac and one
// for iPhone and iPad. Apple's packager
// writes a template for it: one line of text and a button. App Review turns
// such an app down as too thin (Guideline 4.4), and an upload needs a
// privacy manifest. So after each conversion:
//   - scripts/safari-app/ (Main.html, Style.css, Script.js) replaces the
//     template's screen: what the extension does, how to turn it on, the
//     privacy promise, and links to the website, privacy policy and feedback;
//   - the Mac window grows to fit it, the iPhone screen scrolls, and links
//     open in the browser or mail app;
//   - PrivacyInfo.xcprivacy (nothing collected, no tracking) goes into all
//     four targets (the two apps and their extensions).
// The text changes here are pure functions so they can be tested without Xcode.

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const WINDOW = { width: 540, height: 520 };
export const PRIVACY_MANIFEST = 'PrivacyInfo.xcprivacy';
const SOURCE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'safari-app');

// The template's window and web view are a fixed 425 x 325.
export function resizeWindow(storyboard, { width, height } = WINDOW) {
  return storyboard.replace(/width="425" height="325"/g, `width="${width}" height="${height}"`);
}

// The template only answers "open-preferences", and only on the Mac. Also
// answer "open:<address>" (web and mail links on the screen) on both
// platforms by handing the address to the system.
const OPEN_LINKS = `let body = message.body as? String ?? ""
        if body.hasPrefix("open:") {
            if let url = URL(string: String(body.dropFirst(5))), ["https", "mailto"].contains(url.scheme ?? "") {
#if os(iOS)
                UIApplication.shared.open(url)
#elseif os(macOS)
                NSWorkspace.shared.open(url)
#endif
            }
            return
        }
#if os(macOS)
        if (body != "open-preferences") {
            return
        }`;
export function openLinksFromScreen(swift) {
  if (swift.includes('body.hasPrefix("open:")')) return swift;
  const template = /#if os\(macOS\)\s*if \(message\.body as! String != "open-preferences"\) \{\s*return;?\s*\}/;
  if (!template.test(swift)) throw new Error('ViewController.swift is not the template this script knows: the message check was not found.');
  return swift.replace(template, OPEN_LINKS);
}

// The template stops the iPhone screen from scrolling; ours is taller than
// a small phone, so let it scroll.
export function letPhoneScroll(swift) {
  return swift.replace(/^[ \t]*self\.webView\.scrollView\.isScrollEnabled = false\n/m, '');
}

// The four targets, by the project group that holds each one's Info.plist.
const TARGET_OF_GROUP = {
  'iOS (App)': (app) => `${app} (iOS)`,
  'macOS (App)': (app) => `${app} (macOS)`,
  'iOS (Extension)': (app) => `${app} Extension (iOS)`,
  'macOS (Extension)': (app) => `${app} Extension (macOS)`,
};
export const TARGET_GROUPS = Object.keys(TARGET_OF_GROUP);

// Xcode 27's project.xcproj: list the privacy manifest next to each target's
// Info.plist, in that target's own group.
export function addPrivacyManifest(project, appName) {
  if (project.includes(PRIVACY_MANIFEST)) return project;
  let group = null;
  return project.split('\n').map((line) => {
    const path = /^\s*"path": "([^"]*)",?\s*$/.exec(line);
    // Only the top-level groups count: a storyboard's own "path" line sits
    // between a group's name and its Info.plist.
    if (path && /\((App|Extension)\)$/.test(path[1])) group = path[1];
    const plist = /^([ \t]*)\{ "path": "Info\.plist" \},$/.exec(line);
    if (!plist || !TARGET_OF_GROUP[group]) return line;
    return `${line}\n${plist[1]}{ "path": "${PRIVACY_MANIFEST}", "target-membership": [ "${TARGET_OF_GROUP[group](appName)}/resources" ] },`;
  }).join('\n');
}

// applySafariApp(projectRoot, appName) -> list of what could not be done.
//   projectRoot: the folder holding <appName>.xcodeproj and the packager's
//   folders: Shared (App), iOS (App), macOS (App) and the three (Extension) ones.
export function applySafariApp(projectRoot, appName) {
  const problems = [];
  const shared = path.join(projectRoot, 'Shared (App)');
  const edit = (file, change) => writeFileSync(file, change(readFileSync(file, 'utf8')), 'utf8');

  copyFileSync(path.join(SOURCE_DIR, 'Main.html'), path.join(shared, 'Resources', 'Base.lproj', 'Main.html'));
  copyFileSync(path.join(SOURCE_DIR, 'Style.css'), path.join(shared, 'Resources', 'Style.css'));
  copyFileSync(path.join(SOURCE_DIR, 'Script.js'), path.join(shared, 'Resources', 'Script.js'));
  edit(path.join(shared, 'ViewController.swift'), (swift) => letPhoneScroll(openLinksFromScreen(swift)));
  edit(path.join(projectRoot, 'macOS (App)', 'Base.lproj', 'Main.storyboard'), resizeWindow);

  for (const group of TARGET_GROUPS) copyFileSync(path.join(SOURCE_DIR, PRIVACY_MANIFEST), path.join(projectRoot, group, PRIVACY_MANIFEST));
  const projectFile = path.join(projectRoot, `${appName}.xcodeproj`, 'project.xcproj');
  if (existsSync(projectFile)) {
    edit(projectFile, (text) => addPrivacyManifest(text, appName));
    const count = readFileSync(projectFile, 'utf8').split(PRIVACY_MANIFEST).length - 1;
    if (count !== TARGET_GROUPS.length) problems.push(`${PRIVACY_MANIFEST} is listed ${count} times in the project, expected ${TARGET_GROUPS.length}.`);
  } else {
    problems.push(`This Xcode writes project.pbxproj: add ${PRIVACY_MANIFEST} to all four targets by hand in Xcode (the files are in the four target folders).`);
  }
  return problems;
}
