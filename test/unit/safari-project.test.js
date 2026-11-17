// safari-project.test.js — the fix-up of the Xcode project Apple's Safari
// packager generates (scripts/safari-project.mjs).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fixSafariProject, MIN_MACOS, MIN_IOS, APP_CATEGORY } from '../../scripts/safari-project.mjs';

const OPTIONS = { bundleId: 'net.hirtfamily.schoology-dashboard', version: '1.4.0', build: '57' };

// Xcode 27's project.xcproj, as the packager wrote it (cut down).
const XCPROJ = `{
  "targets": [
    {
      "name": "Grades Dashboard for Schoology",
      "build-settings": {
        "CODE_SIGN_STYLE": "Automatic",
        "CURRENT_PROJECT_VERSION": "1",
        "INFOPLIST_KEY_CFBundleDisplayName": "Grades Dashboard for Schoology",
        "MARKETING_VERSION": "1.0",
        "PRODUCT_BUNDLE_IDENTIFIER": "net.hirtfamily.Grades-Dashboard-for-Schoology",
      },
    }, {
      "name": "Grades Dashboard for Schoology Extension",
      "build-settings": {
        "CODE_SIGN_STYLE": "Automatic",
        "CURRENT_PROJECT_VERSION": "1",
        "INFOPLIST_KEY_CFBundleDisplayName": "Grades Dashboard for Schoology Extension",
        "MACOSX_DEPLOYMENT_TARGET": "12.0",
        "MARKETING_VERSION": "1.0",
        "PRODUCT_BUNDLE_IDENTIFIER": "net.hirtfamily.schoology-dashboard.Extension",
      },
    },
  ],
  "build-settings": {
    "MACOSX_DEPLOYMENT_TARGET": "27.2",
  },
}`;

// The older project.pbxproj format.
const PBXPROJ = `
				CODE_SIGN_STYLE = Automatic;
				CURRENT_PROJECT_VERSION = 1;
				INFOPLIST_KEY_CFBundleDisplayName = "Grades Dashboard for Schoology";
				MACOSX_DEPLOYMENT_TARGET = 15.0;
				MARKETING_VERSION = 1.0;
				PRODUCT_BUNDLE_IDENTIFIER = "net.hirtfamily.Grades-Dashboard-for-Schoology";
				PRODUCT_BUNDLE_IDENTIFIER = "net.hirtfamily.schoology-dashboard.Extension";
`;

describe('fixSafariProject', () => {
  it('gives the iOS app and its extension one oldest iOS version', () => {
    const out = fixSafariProject('"IPHONEOS_DEPLOYMENT_TARGET": "17.0",\n"IPHONEOS_DEPLOYMENT_TARGET": "15.0",', OPTIONS);
    expect(out.match(/"IPHONEOS_DEPLOYMENT_TARGET": "[^"]*"/g)).toEqual([`"IPHONEOS_DEPLOYMENT_TARGET": "${MIN_IOS}"`, `"IPHONEOS_DEPLOYMENT_TARGET": "${MIN_IOS}"`]);
  });

  it('fixes Xcode 27’s project.xcproj', () => {
    const out = fixSafariProject(XCPROJ, OPTIONS);
    expect(out.match(/"PRODUCT_BUNDLE_IDENTIFIER": "[^"]*"/g)).toEqual([
      '"PRODUCT_BUNDLE_IDENTIFIER": "net.hirtfamily.schoology-dashboard"',
      '"PRODUCT_BUNDLE_IDENTIFIER": "net.hirtfamily.schoology-dashboard.Extension"',
    ]);
    expect(out.match(/"MARKETING_VERSION": "[^"]*"/g)).toEqual(['"MARKETING_VERSION": "1.4.0"', '"MARKETING_VERSION": "1.4.0"']);
    expect(out.match(/"CURRENT_PROJECT_VERSION": "[^"]*"/g)).toEqual(['"CURRENT_PROJECT_VERSION": "57"', '"CURRENT_PROJECT_VERSION": "57"']);
    expect(out.match(/"MACOSX_DEPLOYMENT_TARGET": "[^"]*"/g)).toEqual([`"MACOSX_DEPLOYMENT_TARGET": "${MIN_MACOS}"`, `"MACOSX_DEPLOYMENT_TARGET": "${MIN_MACOS}"`]);
    expect(out).toContain(`        "INFOPLIST_KEY_CFBundleDisplayName": "Grades Dashboard for Schoology",\n        "INFOPLIST_KEY_LSApplicationCategoryType": "${APP_CATEGORY}",`);
    expect(out).not.toContain('Grades-Dashboard-for-Schoology');
  });

  it('fixes the older project.pbxproj', () => {
    const out = fixSafariProject(PBXPROJ, OPTIONS);
    expect(out).toContain('PRODUCT_BUNDLE_IDENTIFIER = "net.hirtfamily.schoology-dashboard";');
    expect(out).toContain('PRODUCT_BUNDLE_IDENTIFIER = "net.hirtfamily.schoology-dashboard.Extension";');
    expect(out).toContain('MARKETING_VERSION = "1.4.0";');
    expect(out).toContain('CURRENT_PROJECT_VERSION = "57";');
    expect(out).toContain(`MACOSX_DEPLOYMENT_TARGET = "${MIN_MACOS}";`);
    expect(out).toContain(`INFOPLIST_KEY_LSApplicationCategoryType = "${APP_CATEGORY}";`);
  });

  it('signs both targets with the given team, and leaves the team alone without one', () => {
    const TEAM = { ...OPTIONS, teamId: 'ABCDE12345' };
    const out = fixSafariProject(XCPROJ, TEAM);
    expect(out.match(/"DEVELOPMENT_TEAM": "[^"]*",/g)).toEqual(['"DEVELOPMENT_TEAM": "ABCDE12345",', '"DEVELOPMENT_TEAM": "ABCDE12345",']);
    expect(out).toContain('        "CODE_SIGN_STYLE": "Automatic",\n        "DEVELOPMENT_TEAM": "ABCDE12345",');
    expect(fixSafariProject(PBXPROJ, TEAM)).toContain('CODE_SIGN_STYLE = Automatic;\n\t\t\t\tDEVELOPMENT_TEAM = "ABCDE12345";');
    expect(fixSafariProject(XCPROJ, OPTIONS)).not.toContain('DEVELOPMENT_TEAM');
    // A team picked in Xcode on one target only (what Xcode saved): both end up the same.
    // Xcode keeps the team a few lines below the signing style.
    const half = XCPROJ.replace('"MARKETING_VERSION": "1.0",', '"DEVELOPMENT_TEAM": "OTHER00000",\n        "MARKETING_VERSION": "1.0",');
    expect(fixSafariProject(half, TEAM).match(/"DEVELOPMENT_TEAM": "[^"]*",/g)).toEqual(['"DEVELOPMENT_TEAM": "ABCDE12345",', '"DEVELOPMENT_TEAM": "ABCDE12345",']);
    expect(fixSafariProject(out, TEAM)).toBe(out);
  });

  it('changes nothing more when run twice', () => {
    const once = fixSafariProject(XCPROJ, OPTIONS);
    expect(fixSafariProject(once, OPTIONS)).toBe(once);
  });
});

// App Store Connect refuses the upload when the extension's description is
// missing or longer than 112 characters (Chrome allows 132).
describe('manifest description', () => {
  it('fits Safari’s 112 characters', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../extension/manifest.json', import.meta.url), 'utf8'));
    expect(typeof manifest.description).toBe('string');
    expect(manifest.description.length).toBeGreaterThan(0);
    expect(manifest.description.length).toBeLessThanOrEqual(112);
  });
});
