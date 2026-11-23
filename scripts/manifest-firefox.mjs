// manifest-firefox.mjs — the manifest changes for the Firefox build
// (scripts/build.mjs --firefox). Kept apart from the build so they can be
// unit tested without building.

// The add-on's ID on addons.mozilla.org. Never change it: AMO ties the
// listing and its updates to this ID.
export const FIREFOX_ID = 'grades-dashboard@hirtfamily.net';

// forFirefox(manifest) -> a new manifest for Firefox. The input is not changed.
export function forFirefox(input) {
  const manifest = structuredClone(input);
  // Firefox runs MV3 backgrounds as event pages, not service workers.
  manifest.background = { scripts: ['background.js'] };
  manifest.options_ui = { page: manifest.options_page, open_in_tab: true };
  delete manifest.options_page;
  manifest.browser_specific_settings = {
    gecko: {
      id: FIREFOX_ID,
      strict_min_version: '128.0',
      // Mozilla requires new extensions to declare what data they collect.
      // This one collects none: grades stay in the browser's own storage
      // and nothing is sent anywhere (docs/privacy.md).
      data_collection_permissions: { required: ['none'] },
    },
    // Without this key addons.mozilla.org doesn't list the add-on for
    // Firefox for Android. An empty object is enough.
    gecko_android: {},
  };
  // Firefox match patterns can't name a port; without one they match any.
  // (build.mjs no longer adds one, Safari ignores them too; kept for safety.)
  const noPort = (list) => (list || []).map((m) => m.replace('localhost:*', 'localhost'));
  manifest.host_permissions = noPort(manifest.host_permissions);
  for (const cs of manifest.content_scripts || []) cs.matches = noPort(cs.matches);
  for (const war of manifest.web_accessible_resources || []) war.matches = noPort(war.matches);
  return manifest;
}
