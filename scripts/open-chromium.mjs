#!/usr/bin/env node
// open-chromium.mjs — `npm run chromium`
//
// Builds the DEV extension and opens a visible Chromium window with it
// loaded, on real Schoology. For quick hands-on testing without the
// "Load unpacked" steps. Safari still needs its own manual check.
//
// - Its own browser profile in .chromium-profile/ (gitignored): sign in to
//   Schoology there once and it stays signed in. Your everyday Chrome and its
//   accounts are never touched.
// - Rerun the command after a code change: it rebuilds and reopens.
// - Chromium's DevTools protocol listens on 127.0.0.1:9333 (this machine
//   only) so the coding assistant can attach to this window to reproduce
//   what you see. Close the window, or press Ctrl-C here, to stop.
//
//   npm run chromium               # real Schoology (default)
//   npm run chromium -- --no-build # skip the rebuild

import { chromium } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const PROFILE = path.join(ROOT, '.chromium-profile');
const DEBUG_PORT = 9333;
const START_URL = 'https://app.schoology.com/home';

if (!process.argv.includes('--no-build')) {
  const built = spawnSync(process.execPath, [path.join(ROOT, 'scripts/build.mjs'), '--dev'], { stdio: 'inherit' });
  if (built.status !== 0) process.exit(built.status || 1);
}
if (!existsSync(path.join(DIST, 'manifest.json'))) {
  console.error('No dist/ build found.');
  process.exit(1);
}
mkdirSync(PROFILE, { recursive: true });

let context;
try {
  context = await chromium.launchPersistentContext(PROFILE, {
    channel: 'chromium',
    headless: false,
    viewport: null, // use the real window size
    args: [
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      `--remote-debugging-port=${DEBUG_PORT}`,
      '--remote-debugging-address=127.0.0.1',
      '--window-size=1400,900',
    ],
  });
} catch (err) {
  if (/ProcessSingleton|already in use/i.test(String(err))) {
    console.error('The dev Chromium window is already open. Close it first, then rerun.');
    process.exit(1);
  }
  throw err;
}

const page = context.pages()[0] || (await context.newPage());
await page.goto(START_URL).catch(() => {});
console.log('Dev Chromium is open with "Schoology Dashboard (Dev)" loaded.');
console.log('Sign in to Schoology in that window if asked; the panel is on the right edge.');
console.log(`DevTools protocol: http://127.0.0.1:${DEBUG_PORT} (this machine only).`);
console.log('Close the window or press Ctrl-C to stop.');

const stop = async () => {
  await context.close().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
context.on('close', () => process.exit(0));
