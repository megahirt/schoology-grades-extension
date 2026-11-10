#!/usr/bin/env node
// open-firefox.mjs — `npm run firefox`
//
// Builds the Firefox DEV extension and opens Firefox with it loaded, on real
// Schoology, through Mozilla's web-ext tool. No about:debugging steps, and
// nothing to load again after Firefox restarts: just rerun this.
//
// - Its own Firefox profile in .firefox-profile/ (gitignored): sign in to
//   Schoology there once and it stays signed in. Your everyday Firefox, its
//   profile and accounts are never touched.
// - While it runs, every `npm run build:firefox` (in any terminal, or the
//   e2e tests' build) reloads the extension in that window by itself. The
//   build writes dist-firefox.build-done as its last step, and that is the
//   only file watched, so a reload never catches a half-written build.
//   Press R here to reload by hand.
// - Close the Firefox window, or press Ctrl-C here, to stop.
//
//   npm run firefox                # real Schoology (default)
//   npm run firefox -- --no-build  # skip the first build
//   FIREFOX=/path/to/firefox npm run firefox   # another Firefox

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import webExt from 'web-ext';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist-firefox');
const DONE = `${DIST}.build-done`; // written last by every dev build (build.mjs)
const PROFILE = path.join(ROOT, '.firefox-profile');
const START_URL = 'https://app.schoology.com/home';
const MAC_FIREFOX = '/Applications/Firefox.app/Contents/MacOS/firefox';

if (!process.argv.includes('--no-build')) {
  const built = spawnSync(process.execPath, [path.join(ROOT, 'scripts/build.mjs'), '--dev', '--firefox'], { stdio: 'inherit' });
  if (built.status !== 0) process.exit(built.status || 1);
}
if (!existsSync(path.join(DIST, 'manifest.json'))) {
  console.error('No dist-firefox/ build found. Run `npm run build:firefox` first, or drop --no-build.');
  process.exit(1);
}
mkdirSync(PROFILE, { recursive: true });
const builtName = JSON.parse(readFileSync(path.join(DIST, 'manifest.json'), 'utf8')).version_name || '';

// Before using a kept profile, web-ext reads your everyday Firefox's
// profiles.ini to make sure it isn't one of those profiles. macOS doesn't
// let a terminal read another app's data folder (~/Library/Application
// Support/Firefox), so that read fails with EPERM and web-ext gives up. Our
// profile is a folder in this repo, so it can never be an everyday one:
// treat "not allowed to look" as "no profiles.ini", for that file only.
// (Looking at the file is allowed; opening it is what macOS blocks.)
const realStat = fsp.stat;
fsp.stat = async (p, ...rest) => {
  const stats = await realStat(p, ...rest);
  if (path.basename(String(p)) === 'profiles.ini') {
    try {
      await (await fsp.open(p, 'r')).close();
    } catch (err) {
      if (err && (err.code === 'EPERM' || err.code === 'EACCES')) {
        throw Object.assign(new Error(`ENOENT (macOS blocked reading ${p})`), { code: 'ENOENT' });
      }
      throw err;
    }
  }
  return stats;
};

// web-ext finds Firefox on its own; on a Mac, prefer the usual app.
const firefox = process.env.FIREFOX || (existsSync(MAC_FIREFOX) ? MAC_FIREFOX : undefined);

try {
  await webExt.cmd.run(
    {
      sourceDir: DIST,
      firefox,
      firefoxProfile: PROFILE,
      profileCreateIfMissing: true,
      keepProfileChanges: true, // stay signed in to Schoology between runs
      startUrl: [START_URL],
      watchFile: [DONE],
    },
    { shouldExitProgram: true },
  );
} catch (err) {
  console.error(`Could not start Firefox: ${err && err.message ? err.message : err}`);
  process.exit(1);
}
console.log(`\nDev Firefox is open with "Grades Dashboard (Dev)" ${builtName} loaded.`);
console.log('Sign in to Schoology in that window if asked; the panel is on the right edge.');
console.log('Every `npm run build:firefox` reloads it here. Press R to reload by hand; Ctrl-C to stop.');
