// build.mjs — `node scripts/build.mjs [--dev]`
// Bundles the extension with esbuild into dist/ and copies static assets.
//   --dev : shows a "Data: Real Schoology / Mock server" switch in the
//           dashboard footer (default: real Schoology), adds
//           http://localhost:*/* to host_permissions (mock server for
//           Playwright e2e) and renames the extension "Grades Dashboard
//           (Dev)". Prod builds NEVER contain localhost permissions.
//   --firefox : writes a Firefox build to dist-firefox/ instead (combine
//           with --dev for the e2e tests). Firefox runs MV3 backgrounds as
//           event pages (background.scripts, not a service worker) and needs
//           an add-on id.
//   --safari : writes the Safari input to dist-safari/ (scripts/build-safari.mjs
//           runs this). Safari gets no optional "https://*/*" host
//           permission: with it, Safari badges and prompts on every site
//           (WebKit bug 290508), so Safari covers only the manifest's
//           sites until that is fixed (docs/schoology-domains-research.md).
//   --fake-now=<date> : (with --dev only) the extension's clock starts at
//           <date> (e.g. 2026-11-08T16:42:00, local time) and runs on from
//           there. Used by scripts/site-screenshots.mjs so the promo
//           screenshots come out the same whatever day they're taken.
//
// Version: the release tag is the only source of the version number.
// extension/manifest.json and package.json say 0.0.0 on purpose; the build
// writes the real version into dist*/manifest.json:
//   1. RELEASE_VERSION (the release workflow sets it from the vX.Y.Z tag;
//      a leading "v" is fine), else
//   2. the newest vX.Y.Z git tag reachable from HEAD (local builds), else
//   3. 0.0.0 (no tags yet, or a shallow checkout such as CI).
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const extDir = path.join(root, 'extension');
const isDev = process.argv.includes('--dev');
const isFirefox = process.argv.includes('--firefox');
const isSafari = process.argv.includes('--safari');
const fakeNowArg = process.argv.find((a) => a.startsWith('--fake-now='));
const fakeNow = fakeNowArg ? new Date(fakeNowArg.slice('--fake-now='.length)).getTime() : null;
if (fakeNowArg && (!isDev || Number.isNaN(fakeNow))) {
  console.error('--fake-now=<date> needs --dev and a valid date, e.g. --fake-now=2026-11-08T16:42:00');
  process.exit(1);
}
// Prepended to every bundle when --fake-now is set: Date (and Date.now())
// start at the fixed time and keep ticking.
const FAKE_NOW_BANNER = fakeNow === null ? '' : `(() => {
  const RealDate = Date;
  const offset = ${fakeNow} - RealDate.now();
  class FakeDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [RealDate.now() + offset])); }
    static now() { return RealDate.now() + offset; }
  }
  globalThis.Date = FakeDate;
})();`;
const distDir = path.join(root, isFirefox ? 'dist-firefox' : isSafari ? 'dist-safari' : 'dist');
const FIREFOX_ID = 'schoology-dashboard@schoologydashboard';

// Adding a school's own Schoology address (schoology.yourschool.org) needs
// the optional "https://*/*" host permission, plus "scripting" and
// "activeTab" for that feature only. A broad host permission sends the
// Chrome Web Store listing to an in-depth review, so release builds leave
// all three out for now; the extension then says other addresses can't be
// added yet (school-access.js canAddSchools). Dev builds keep them so the
// feature stays testable. Set to true to ship the feature again.
const ASK_FOR_OTHER_SCHOOL_SITES = false;

// The manifest allows every Schoology subdomain ("https://*.schoology.com/*",
// which includes districts' own name.schoology.com addresses). The Chrome Web
// Store counts any wildcard host as broad and sends the listing to an
// in-depth review, so release builds pin it to app.schoology.com (the school
// addresses in the manifest stay). sites.js follows the same setting through
// __ALL_SCHOOLOGY_SUBDOMAINS__, so the extension only treats the pinned
// addresses as Schoology. Dev builds keep the wildcard. Set to false to ship
// every subdomain again.
const PIN_SCHOOLOGY_HOSTS = true;
const PINNED_SCHOOLOGY = 'https://app.schoology.com/*';
const pinHosts = !isDev && PIN_SCHOOLOGY_HOSTS;

// X.Y.Z with no leading zeros, each part 0–65535 (Chrome's rule for
// manifest versions; Firefox, Edge and Safari accept the same form).
const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function releaseVersion() {
  let v = process.env.RELEASE_VERSION || '';
  if (!v) {
    try {
      v = execFileSync('git', ['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*.[0-9]*.[0-9]*'], {
        cwd: root,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).toString().trim();
    } catch {
      v = '';
    }
  }
  v = (v || '0.0.0').replace(/^v/, '');
  if (!VERSION_RE.test(v) || v.split('.').some((n) => Number(n) > 65535)) {
    throw new Error(`Version "${v}" is not X.Y.Z (no leading zeros, each part 0-65535).`);
  }
  return v;
}

async function main() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });
  await mkdir(path.join(distDir, 'popup'), { recursive: true });
  await mkdir(path.join(distDir, 'options'), { recursive: true });
  await mkdir(path.join(distDir, 'icons'), { recursive: true });

  const entries = {
    background: path.join(extDir, 'background.js'),
    content: path.join(extDir, 'content.js'),
    'popup/popup': path.join(extDir, 'popup', 'popup.js'),
    'options/options': path.join(extDir, 'options', 'options.js'),
  };
  for (const [outName, entry] of Object.entries(entries)) {
    await build({
      entryPoints: [entry],
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: ['safari16', 'chrome109'],
      outfile: path.join(distDir, `${outName}.js`),
      sourcemap: isDev,
      // __DEV__ turns on dev-only UI (the real/mock data source switch).
      define: { __DEV__: JSON.stringify(isDev), __ALL_SCHOOLOGY_SUBDOMAINS__: JSON.stringify(!pinHosts) },
      banner: FAKE_NOW_BANNER ? { js: FAKE_NOW_BANNER } : undefined,
      loader: { '.css': 'text', '.png': 'dataurl' },
      logLevel: 'info',
    });
  }

  // Manifest (transformed for --dev).
  const manifest = JSON.parse(await readFile(path.join(extDir, 'manifest.json'), 'utf8'));
  manifest.version = releaseVersion();
  if (isDev) {
    manifest.name = 'Grades Dashboard (Dev)';
    manifest.short_name = 'Grades Dashboard (Dev)';
    // Build stamp, so a running dev build can be identified (version_name is
    // display-only; Chrome and Safari keep using `version`).
    manifest.version_name = `${manifest.version}-dev.${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}`;
    manifest.host_permissions = [...(manifest.host_permissions || []), 'http://localhost:*/*'];
    // Run the content script (grades scrape + panel) on the mock server too.
    for (const cs of manifest.content_scripts || []) cs.matches = [...cs.matches, 'http://localhost:*/*'];
  }
  if (isFirefox) {
    manifest.background = { scripts: ['background.js'] };
    manifest.options_ui = { page: manifest.options_page, open_in_tab: true };
    delete manifest.options_page;
    manifest.browser_specific_settings = { gecko: { id: FIREFOX_ID, strict_min_version: '128.0' } };
    // Firefox match patterns can't name a port; without one they match any.
    const noPort = (list) => (list || []).map((m) => m.replace('localhost:*', 'localhost'));
    manifest.host_permissions = noPort(manifest.host_permissions);
    for (const cs of manifest.content_scripts || []) cs.matches = noPort(cs.matches);
  }
  if (pinHosts) {
    const pin = (list) => (list || []).map((m) => (m === 'https://*.schoology.com/*' ? PINNED_SCHOOLOGY : m));
    manifest.host_permissions = pin(manifest.host_permissions);
    for (const cs of manifest.content_scripts || []) cs.matches = pin(cs.matches);
  }
  if (isSafari || (!isDev && !ASK_FOR_OTHER_SCHOOL_SITES)) delete manifest.optional_host_permissions;
  if (!isDev && !ASK_FOR_OTHER_SCHOOL_SITES) {
    manifest.permissions = manifest.permissions.filter((p) => p !== 'scripting' && p !== 'activeTab');
  }
  await writeFile(path.join(distDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  // Static assets.
  await cp(path.join(extDir, 'popup', 'popup.html'), path.join(distDir, 'popup', 'popup.html'));
  await cp(path.join(extDir, 'popup', 'demo-data.json'), path.join(distDir, 'popup', 'demo-data.json'));
  await cp(path.join(extDir, 'options', 'options.html'), path.join(distDir, 'options', 'options.html'));
  await cp(path.join(extDir, 'options', 'options.css'), path.join(distDir, 'options', 'options.css'));
  await cp(path.join(extDir, 'icons'), path.join(distDir, 'icons'), { recursive: true });

  // Dev builds: a marker written last, so `npm run firefox` (web-ext) reloads
  // the extension once the whole build is in place, never halfway through.
  // It sits next to the build folder (dist-firefox.build-done), not in it:
  // the build deletes and remakes that folder, and a watcher loses files in it.
  if (isDev) await writeFile(`${distDir}.build-done`, `${new Date().toISOString()}\n`);

  console.log(`Built ${isDev ? 'DEV' : 'PROD'}${isFirefox ? ' Firefox' : ''}${isSafari ? ' Safari' : ''} extension ${manifest.version} -> ${distDir}`);
  if (isDev) console.log('Dev build includes http://localhost:*/* host permission.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
