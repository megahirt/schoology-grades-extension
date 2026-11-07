// build.mjs — `node scripts/build.mjs [--dev]`
// Bundles the extension with esbuild into dist/ and copies static assets.
//   --dev : adds http://localhost:*/* to host_permissions (mock server for
//           Playwright e2e) and renames the extension "Schoology Dashboard
//           (Dev)". Prod builds NEVER contain localhost permissions.
import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const extDir = path.join(root, 'extension');
const distDir = path.join(root, 'dist');
const isDev = process.argv.includes('--dev');

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
      loader: { '.css': 'text' },
      logLevel: 'info',
    });
  }

  // Manifest (transformed for --dev).
  const manifest = JSON.parse(await readFile(path.join(extDir, 'manifest.json'), 'utf8'));
  if (isDev) {
    manifest.name = 'Schoology Dashboard (Dev)';
    manifest.host_permissions = [...(manifest.host_permissions || []), 'http://localhost:*/*'];
    // Run the content script (grades scrape + panel) on the mock server too.
    for (const cs of manifest.content_scripts || []) cs.matches = [...cs.matches, 'http://localhost:*/*'];
  }
  await writeFile(path.join(distDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  // Static assets.
  await cp(path.join(extDir, 'popup', 'popup.html'), path.join(distDir, 'popup', 'popup.html'));
  await cp(path.join(extDir, 'popup', 'demo-data.json'), path.join(distDir, 'popup', 'demo-data.json'));
  await cp(path.join(extDir, 'options', 'options.html'), path.join(distDir, 'options', 'options.html'));
  await cp(path.join(extDir, 'options', 'options.css'), path.join(distDir, 'options', 'options.css'));
  await cp(path.join(extDir, 'icons'), path.join(distDir, 'icons'), { recursive: true });

  console.log(`Built ${isDev ? 'DEV' : 'PROD'} extension -> ${distDir}`);
  if (isDev) console.log('Dev build includes http://localhost:*/* host permission.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
