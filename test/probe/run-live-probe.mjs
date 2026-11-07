// run-live-probe.mjs — run the Schoology live background-fetch probe
// WITHOUT the chrome://extensions page.
//
// Background: the managed browser blocks chrome://extensions, so the probe
// extension cannot be loaded unpacked through the UI. The workaround is
// launching Chromium with the extension on the command line — the same
// mechanism the repo's own e2e tests already use (see
// test/e2e/extension.spec.js launchWithExtension), and verified on
// 2026-11-06: the probe service worker starts and the popup renders.
//
//   node test/probe/run-live-probe.mjs [--headed] [--profile <dir>] [--wait-seconds N]
//
// What it does:
//   1. Launches a persistent Chromium context with --load-extension pointing
//      at test/probe/probe-extension/ (no chrome://extensions involved).
//   2. Opens Schoology and waits for the operator to sign in (saved parent
//      login) and open a course Grades page in the UI. The probe's content
//      script captures the exact Grades URL — it is never guessed.
//   3. Once a Grades page is captured, clicks the three probe buttons in
//      order (service worker, popup, hidden tab) and writes the JSON results
//      to test/probe/live-results-<timestamp>.json, then prints the verdict.
//
// What it does NOT do: it never handles, stores, or prints a password.
// Sign-in is the operator's step, in the browser, with the saved login.
// If nobody signs in within the wait window it exits without a verdict —
// that is a blocked run, not a failure of the probe.
//
// Modes:
//   --headed            Show the browser (needs a display, e.g. xvfb-run)
//                       so the operator can sign in and navigate.
//   --profile <dir>     Reuse an existing Chrome profile directory that is
//                       already signed in to Schoology (Chromium must not
//                       already be running with it). With a signed-in
//                       profile the operator only has to open a Grades page.
//   --wait-seconds N    How long to wait for sign-in + Grades capture
//                       (default 1200 = 20 minutes).
//
// After a run, copy the JSON into test/probe/LIVE-TEST-RESULTS.md.

import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'));
const { chromium } = require('@playwright/test');

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROBE_DIR = path.join(REPO_ROOT, 'test', 'probe', 'probe-extension');

const args = process.argv.slice(2);
const headed = args.includes('--headed');
const profileIdx = args.indexOf('--profile');
const waitIdx = args.indexOf('--wait-seconds');
const waitSeconds = waitIdx >= 0 ? Number(args[waitIdx + 1]) : 1200;
const profileDir = profileIdx >= 0 ? args[profileIdx + 1] : null;

if (!existsSync(path.join(PROBE_DIR, 'manifest.json'))) {
  console.error('Probe extension not found at ' + PROBE_DIR);
  process.exit(2);
}

// Playwright's headless shell is not installed here; the full Chromium
// build is (same fallback as playwright.config.js).
function executablePath() {
  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), '.cache', 'ms-playwright');
  if (!existsSync(browsersPath)) return undefined;
  const full = require('node:fs').readdirSync(browsersPath)
    .filter((e) => /^chromium-\d+$/.test(e))
    .map((e) => path.join(browsersPath, e, 'chrome-linux64', 'chrome'))
    .find((p) => existsSync(p));
  return full;
}

const userDataDir = profileDir || mkdtempSync(path.join(os.tmpdir(), 'schoology-probe-'));
const createdProfile = !profileDir;

console.log('Loading probe extension from ' + PROBE_DIR);
console.log('Profile: ' + userDataDir + (createdProfile ? ' (temporary, will be removed)' : ' (reused)'));
console.log('Mode: ' + (headed ? 'headed — sign in with the saved parent login, then open a course Grades page' : 'headless — sign-in must come from a reused --profile, or re-run with --headed'));

let context;
try {
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: !headed,
    executablePath: executablePath(),
    args: [`--disable-extensions-except=${PROBE_DIR}`, `--load-extension=${PROBE_DIR}`],
  });

  let worker = null;
  try {
    worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  } catch {
    for (let i = 0; i < 20 && !worker; i++) {
      worker = context.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'));
      if (!worker) await new Promise((r) => setTimeout(r, 500));
    }
  }
  if (!worker) throw new Error('Probe service worker did not start — the extension did not load.');
  const extensionId = new URL(worker.url()).hostname;
  console.log('Probe loaded, extension id ' + extensionId);

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/probe-popup.html`);

  const schoology = await context.newPage();
  await schoology.goto('https://www.schoology.com/', { waitUntil: 'domcontentloaded' }).catch((e) => {
    console.log('Note: Schoology home did not finish loading (' + e.message.split('\n')[0] + ') — continuing to wait for sign-in.');
  });

  // Wait for the content script to capture a Grades page.
  const deadline = Date.now() + waitSeconds * 1000;
  let state = null;
  while (Date.now() < deadline) {
    try {
      state = await popup.evaluate(async () => {
        const reply = await browser.runtime.sendMessage({ type: 'get-probe-state' });
        return reply && reply.ok ? reply : null;
      });
    } catch { /* popup not ready yet; keep waiting */ }
    if (state && state.context && state.context.url) break;
    const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
    if (left % 60 === 0) console.log(`Waiting for sign-in + a Grades page… ${left}s left`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (!state || !state.context || !state.context.url) {
    console.log('BLOCKED — no Grades page was captured within the wait window. No probe ran; nothing to report as a pass or fail.');
    console.log('To retry: sign in to Schoology with the saved parent login, open a course Grades page in the UI, and re-run this script.');
    process.exitCode = 3;
  } else {
    console.log('Captured Grades page: ' + state.context.url);
    console.log('Sample title: ' + (state.context.sampleTitle || '(none found)') + ' | Rendered DOM has "Missing": ' + (state.context.domHasMissing ? 'yes' : 'no'));

    // Run the three probes in order via the popup buttons.
    for (const [id, label] of [['#btn-sw', 'service worker'], ['#btn-popup', 'popup'], ['#btn-hidden-tab', 'hidden tab']]) {
      console.log('Running probe: ' + label + '…');
      await popup.click(id);
      // Wait until a new result with that fetchContext appears (up to 90 s).
      const target = label === 'service worker' ? 'service-worker' : label === 'popup' ? 'popup' : 'hidden-tab';
      const until = Date.now() + 90000;
      while (Date.now() < until) {
        const s = await popup.evaluate(async () => {
          const reply = await browser.runtime.sendMessage({ type: 'get-probe-state' });
          return reply && reply.ok ? reply : null;
        }).catch(() => null);
        if (s && s.results.some((r) => r.fetchContext === target)) { state = s; break; }
        await new Promise((r) => setTimeout(r, 2000));
      }
      await popup.waitForTimeout(1000);
    }

    const outPath = path.join(REPO_ROOT, 'test', 'probe', `live-results-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    writeFileSync(outPath, JSON.stringify({ context: state.context, results: state.results }, null, 2));
    console.log('Results written to ' + outPath);

    const verdict = await popup.textContent('#verdict');
    console.log('Popup verdict: ' + (verdict || '').trim());
    for (const r of state.results) {
      console.log(`- ${r.fetchContext}: status=${r.status} loggedIn=${r.loggedIn} title=${r.containsAssignmentTitle} missing=${r.containsMissing} finalUrl=${r.finalUrl}`);
    }
    console.log('Next step: paste the JSON into test/probe/LIVE-TEST-RESULTS.md and record the verdict.');
  }
} catch (err) {
  console.error('Probe runner failed: ' + (err && err.message ? err.message : err));
  process.exitCode = 1;
} finally {
  if (context) await context.close().catch(() => {});
  if (createdProfile) rmSync(userDataDir, { recursive: true, force: true });
}
