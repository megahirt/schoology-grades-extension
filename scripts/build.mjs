// build.mjs — `node scripts/build.mjs [--dev]`
// Bundles the extension with esbuild into dist/ and copies static assets.
//   --dev : shows a "Data: Real Schoology / Mock server" switch in the
//           dashboard footer (default: real Schoology), adds
//           http://localhost:*/* to host_permissions (mock server for
//           Playwright e2e) and renames the extension "Schoology Dashboard
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
const distDir = path.join(root, isFirefox ? 'dist-firefox' : isSafari ? 'dist-safari' : 'dist');
const FIREFOX_ID = 'schoology-dashboard@schoologydashboard';

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
      define: { __DEV__: JSON.stringify(isDev) },
      loader: { '.css': 'text', '.png': 'dataurl' },
      logLevel: 'info',
    });
  }

  // Manifest (transformed for --dev).
  const manifest = JSON.parse(await readFile(path.join(extDir, 'manifest.json'), 'utf8'));
  manifest.version = releaseVersion();
  if (isDev) {
    manifest.name = 'Schoology Dashboard (Dev)';
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
  if (isSafari) delete manifest.optional_host_permissions;
  await writeFile(path.join(distDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  // Static assets.
  await cp(path.join(extDir, 'popup', 'popup.html'), path.join(distDir, 'popup', 'popup.html'));
  await cp(path.join(extDir, 'popup', 'demo-data.json'), path.join(distDir, 'popup', 'demo-data.json'));
  await cp(path.join(extDir, 'options', 'options.html'), path.join(distDir, 'options', 'options.html'));
  await cp(path.join(extDir, 'options', 'options.css'), path.join(distDir, 'options', 'options.css'));
  await cp(path.join(extDir, 'icons'), path.join(distDir, 'icons'), { recursive: true });

  console.log(`Built ${isDev ? 'DEV' : 'PROD'}${isFirefox ? ' Firefox' : ''}${isSafari ? ' Safari' : ''} extension ${manifest.version} -> ${distDir}`);
  if (isDev) console.log('Dev build includes http://localhost:*/* host permission.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
