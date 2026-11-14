// safari-project.test.js — the fix-up of the Xcode project Apple's Safari
// packager generates (scripts/safari-project.mjs).

import { describe, it, expect } from 'vitest';
import { fixSafariProject, MIN_MACOS, APP_CATEGORY } from '../../scripts/safari-project.mjs';

const OPTIONS = { bundleId: 'net.hirtfamily.schoology-dashboard', version: '1.4.0', build: '57' };

// Xcode 27's project.xcproj, as the packager wrote it (cut down).
const XCPROJ = `{
  "targets": [
    {
      "name": "Grades Dashboard for Schoology",
      "build-settings": {
        "CURRENT_PROJECT_VERSION": "1",
        "INFOPLIST_KEY_CFBundleDisplayName": "Grades Dashboard for Schoology",
        "MARKETING_VERSION": "1.0",
        "PRODUCT_BUNDLE_IDENTIFIER": "net.hirtfamily.Grades-Dashboard-for-Schoology",
      },
    }, {
      "name": "Grades Dashboard for Schoology Extension",
      "build-settings": {
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
				CURRENT_PROJECT_VERSION = 1;
				INFOPLIST_KEY_CFBundleDisplayName = "Grades Dashboard for Schoology";
				MACOSX_DEPLOYMENT_TARGET = 15.0;
				MARKETING_VERSION = 1.0;
				PRODUCT_BUNDLE_IDENTIFIER = "net.hirtfamily.Grades-Dashboard-for-Schoology";
				PRODUCT_BUNDLE_IDENTIFIER = "net.hirtfamily.schoology-dashboard.Extension";
`;

describe('fixSafariProject', () => {
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

  it('changes nothing more when run twice', () => {
    const once = fixSafariProject(XCPROJ, OPTIONS);
    expect(fixSafariProject(once, OPTIONS)).toBe(once);
  });
});
