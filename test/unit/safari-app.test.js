// safari-app.test.js — turning the packager's template app into ours
// (scripts/safari-app.mjs).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resizeWindow, openLinksFromScreen, addPrivacyManifest, WINDOW, PRIVACY_MANIFEST } from '../../scripts/safari-app.mjs';

const read = (name) => readFileSync(new URL(`../../scripts/safari-app/${name}`, import.meta.url), 'utf8');

const SWIFT = `    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if (message.body as! String != "open-preferences") {
            return;
        }

        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { error in
        }
    }`;

const PROJECT = `      "children": [
        { "path": "Assets.xcassets", "target-membership": [ "My App/resources" ] },
        { "path": "Info.plist" },
      ],
    }, {
      "children": [
        { "path": "Handler.swift", "target-membership": [ "My App Extension/compile-sources" ] },
        { "path": "Info.plist" },
      ],`;

describe('the containing app', () => {
  it('makes the template window bigger', () => {
    const out = resizeWindow('<rect key="contentRect" x="196" y="240" width="425" height="325"/>\n<rect key="frame" x="0.0" y="0.0" width="425" height="325"/>');
    expect(out.match(new RegExp(`width="${WINDOW.width}" height="${WINDOW.height}"`, 'g'))).toHaveLength(2);
    expect(out).not.toContain('425');
  });

  it('opens web and mail links outside the app, and nothing else', () => {
    const out = openLinksFromScreen(SWIFT);
    expect(out).toContain('body.hasPrefix("open:")');
    expect(out).toContain('["https", "mailto"].contains(url.scheme ?? "")');
    expect(out).toContain('if (body != "open-preferences")');
    expect(out).not.toContain('as! String');
    expect(openLinksFromScreen(out)).toBe(out);
    expect(() => openLinksFromScreen('class ViewController {}')).toThrow(/not the template/);
  });

  it('lists the privacy manifest in both targets, once', () => {
    const out = addPrivacyManifest(PROJECT, 'My App');
    expect(out).toContain(`        { "path": "Info.plist" },\n        { "path": "${PRIVACY_MANIFEST}", "target-membership": [ "My App/resources" ] },`);
    expect(out).toContain(`{ "path": "${PRIVACY_MANIFEST}", "target-membership": [ "My App Extension/resources" ] },`);
    expect(addPrivacyManifest(out, 'My App')).toBe(out);
  });

  it('has a screen that says how to start, keeps the promise, and loads nothing from the web', () => {
    const html = read('Main.html');
    expect(html).toContain("default-src 'self'");
    expect(html).toContain('How to start');
    expect(html).toContain('Nothing is sent to us or anyone else');
    for (const cls of ['state-unknown', 'state-on', 'state-off', 'open-preferences']) expect(html).toContain(cls);
    expect(html).not.toMatch(/(src|href)="https?:[^"]*"(?! data-open)/);
    const script = read('Script.js');
    expect(script).toContain('function show(enabled, useSettingsInsteadOfPreferences)');
    expect(script).toContain('post("open-preferences")');
  });

  it('declares no tracking and no collected data', () => {
    const manifest = read(PRIVACY_MANIFEST);
    expect(manifest).toMatch(/<key>NSPrivacyTracking<\/key>\s*<false\/>/);
    expect(manifest).toMatch(/<key>NSPrivacyCollectedDataTypes<\/key>\s*<array\/>/);
  });
});
