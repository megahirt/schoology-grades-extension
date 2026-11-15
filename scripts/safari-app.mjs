// safari-app.mjs — turn the packager's template app into ours
// (scripts/build-safari.mjs runs it after every conversion).
//
// A Safari web extension ships inside a small Mac app. Apple's packager
// writes a template for it: one line of text and a button. App Review turns
// such an app down as too thin (Guideline 4.4), and an upload needs a
// privacy manifest. So after each conversion:
//   - scripts/safari-app/ (Main.html, Style.css, Script.js) replaces the
//     template's screen: what the extension does, how to turn it on, the
//     privacy promise, and links to the website, privacy policy and feedback;
//   - the window grows to fit it, and links open in the browser or mail app;
//   - PrivacyInfo.xcprivacy (nothing collected, no tracking) goes into both
//     targets.
// The text changes here are pure functions so they can be tested without Xcode.

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const WINDOW = { width: 540, height: 620 };
export const PRIVACY_MANIFEST = 'PrivacyInfo.xcprivacy';
const SOURCE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'safari-app');

// The template's window and web view are a fixed 425 x 325.
export function resizeWindow(storyboard, { width, height } = WINDOW) {
  return storyboard.replace(/width="425" height="325"/g, `width="${width}" height="${height}"`);
}

// The template only answers "open-preferences". Also answer "open:<address>"
// (web and mail links on the screen) by handing it to the Mac.
const OPEN_LINKS = `let body = message.body as? String ?? ""
        if body.hasPrefix("open:") {
            if let url = URL(string: String(body.dropFirst(5))), ["https", "mailto"].contains(url.scheme ?? "") {
                NSWorkspace.shared.open(url)
            }
            return
        }
        if (body != "open-preferences") {
            return;
        }`;
export function openLinksFromScreen(swift) {
  if (swift.includes('body.hasPrefix("open:")')) return swift;
  const template = /if \(message\.body as! String != "open-preferences"\) \{\s*return;?\s*\}/;
  if (!template.test(swift)) throw new Error('ViewController.swift is not the template this script knows: the message check was not found.');
  return swift.replace(template, OPEN_LINKS);
}

// Xcode 27's project.xcproj: list the privacy manifest next to each target's
// Info.plist (the app's comes first, then the extension's).
export function addPrivacyManifest(project, appName) {
  if (project.includes(PRIVACY_MANIFEST)) return project;
  const targets = [appName, `${appName} Extension`];
  let n = 0;
  return project.replace(/^([ \t]*)\{ "path": "Info\.plist" \},$/gm, (line, indent) => {
    const target = targets[n++];
    if (!target) return line;
    return `${line}\n${indent}{ "path": "${PRIVACY_MANIFEST}", "target-membership": [ "${target}/resources" ] },`;
  });
}

// applySafariApp(projectRoot, appName) -> list of what could not be done.
//   projectRoot: the folder holding <appName>.xcodeproj and the two target folders.
export function applySafariApp(projectRoot, appName) {
  const problems = [];
  const appDir = path.join(projectRoot, appName);
  const extensionDir = path.join(projectRoot, `${appName} Extension`);
  const edit = (file, change) => writeFileSync(file, change(readFileSync(file, 'utf8')), 'utf8');

  copyFileSync(path.join(SOURCE_DIR, 'Main.html'), path.join(appDir, 'Resources', 'Base.lproj', 'Main.html'));
  copyFileSync(path.join(SOURCE_DIR, 'Style.css'), path.join(appDir, 'Resources', 'Style.css'));
  copyFileSync(path.join(SOURCE_DIR, 'Script.js'), path.join(appDir, 'Resources', 'Script.js'));
  edit(path.join(appDir, 'ViewController.swift'), openLinksFromScreen);
  edit(path.join(appDir, 'Base.lproj', 'Main.storyboard'), resizeWindow);

  copyFileSync(path.join(SOURCE_DIR, PRIVACY_MANIFEST), path.join(appDir, PRIVACY_MANIFEST));
  copyFileSync(path.join(SOURCE_DIR, PRIVACY_MANIFEST), path.join(extensionDir, PRIVACY_MANIFEST));
  const projectFile = path.join(projectRoot, `${appName}.xcodeproj`, 'project.xcproj');
  if (existsSync(projectFile)) {
    edit(projectFile, (text) => addPrivacyManifest(text, appName));
    const count = readFileSync(projectFile, 'utf8').split(PRIVACY_MANIFEST).length - 1;
    if (count !== 2) problems.push(`${PRIVACY_MANIFEST} is listed ${count} times in the project, expected 2.`);
  } else {
    problems.push(`This Xcode writes project.pbxproj: add ${PRIVACY_MANIFEST} to both targets by hand in Xcode (the files are in the two target folders).`);
  }
  return problems;
}
