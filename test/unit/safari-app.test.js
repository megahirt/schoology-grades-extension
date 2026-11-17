// safari-app.test.js — turning the packager's template app into ours
// (scripts/safari-app.mjs).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resizeWindow, openLinksFromScreen, letPhoneScroll, addPrivacyManifest, WINDOW, PRIVACY_MANIFEST } from '../../scripts/safari-app.mjs';

const read = (name) => readFileSync(new URL(`../../scripts/safari-app/${name}`, import.meta.url), 'utf8');

// The packager's shared view controller (cut down).
const SWIFT = `#if os(iOS)
        self.webView.scrollView.isScrollEnabled = false
#endif
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
#if os(macOS)
        if (message.body as! String != "open-preferences") {
            return
        }

        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { error in
        }
#endif
    }`;

const PROJECT = `    {
      "kind": "group",
      "path": "Shared (App)",
      "children": [
        { "path": "Info.plist" },
      ],
    }, {
      "kind": "group",
      "path": "iOS (App)",
      "children": [
        { "path": "AppDelegate.swift", "target-membership": [ "My App (iOS)/compile-sources" ] },
        {
          "kind": "variant-group",
          "name": "Main.storyboard",
          "children": [
            {
              "path": "Base.lproj/Main.storyboard",
            },
          ],
        },
        { "path": "Info.plist" },
      ],
    }, {
      "kind": "group",
      "path": "macOS (App)",
      "children": [
        { "path": "Info.plist" },
      ],
    }, {
      "kind": "group",
      "path": "iOS (Extension)",
      "children": [
        { "path": "Info.plist" },
      ],
    }, {
      "kind": "group",
      "path": "macOS (Extension)",
      "children": [
        { "path": "Info.plist" },
      ],`;

describe('the containing app', () => {
  it('makes the template window bigger', () => {
    const out = resizeWindow('<rect key="contentRect" x="196" y="240" width="425" height="325"/>\n<rect key="frame" x="0.0" y="0.0" width="425" height="325"/>');
    expect(out.match(new RegExp(`width="${WINDOW.width}" height="${WINDOW.height}"`, 'g'))).toHaveLength(2);
    expect(out).not.toContain('425');
  });

  it('opens web and mail links outside the app on both platforms, and nothing else', () => {
    const out = openLinksFromScreen(SWIFT);
    expect(out).toContain('body.hasPrefix("open:")');
    expect(out).toContain('["https", "mailto"].contains(url.scheme ?? "")');
    expect(out).toContain('UIApplication.shared.open(url)');
    expect(out).toContain('NSWorkspace.shared.open(url)');
    expect(out).toContain('if (body != "open-preferences")');
    expect(out).not.toContain('as! String');
    // Every #if still has its #endif.
    expect(out.match(/^#if /gm)).toHaveLength(out.match(/^#endif/gm).length);
    expect(openLinksFromScreen(out)).toBe(out);
    expect(() => openLinksFromScreen('class ViewController {}')).toThrow(/not the template/);
  });

  it('lets the iPhone screen scroll', () => {
    const out = letPhoneScroll(SWIFT);
    expect(out).not.toContain('isScrollEnabled');
    expect(out).toContain('#if os(iOS)\n#endif');
    expect(letPhoneScroll(out)).toBe(out);
  });

  it('lists the privacy manifest in all four targets, once each', () => {
    const out = addPrivacyManifest(PROJECT, 'My App');
    for (const target of ['My App (iOS)', 'My App (macOS)', 'My App Extension (iOS)', 'My App Extension (macOS)']) {
      expect(out).toContain(`        { "path": "Info.plist" },\n        { "path": "${PRIVACY_MANIFEST}", "target-membership": [ "${target}/resources" ] },`);
    }
    expect(out.split(PRIVACY_MANIFEST)).toHaveLength(5);
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
    expect(script).toContain('function show(platform, enabled, useSettingsInsteadOfPreferences)');
    // The Mac and the iPhone each get their own steps.
    for (const cls of ['platform-mac', 'platform-ios']) expect(html).toContain(cls);
    expect(html).toContain('Settings</strong>, then <strong>Apps</strong>');
    expect(script).toContain('post("open-preferences")');
  });

  it('declares no tracking and no collected data', () => {
    const manifest = read(PRIVACY_MANIFEST);
    expect(manifest).toMatch(/<key>NSPrivacyTracking<\/key>\s*<false\/>/);
    expect(manifest).toMatch(/<key>NSPrivacyCollectedDataTypes<\/key>\s*<array\/>/);
  });
});
