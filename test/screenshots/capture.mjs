// capture.mjs — `npm run screenshots`
//
// Visual check of the dashboard against the "Schoology Dashboard Panel"
// design. Loads the DEV build into local Chromium, fills it with the made-up
// demo data (the Rivera family; never real student data), shows the panel on
// a fake Schoology page served by Playwright itself (no network, no server),
// and saves screenshots of every state the design covers:
//
//   popup, panel open (parent), refresh in progress, Sam NO-GO, after "Turned in" + "Mark as done"
//   (Waiting on teacher), closed tab with verdicts, student view, iPhone,
//   and the settings page.
//
// Output: test/screenshots/out/*.png (gitignored). Run `npm run build:dev` first.

import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, 'test/screenshots/out');
if (!existsSync(path.join(DIST, 'manifest.json'))) {
  console.error('No dist/ build. Run `npm run build:dev` first.');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const FAKE_PAGE = '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>' +
  '<body style="margin:0;font-family:sans-serif;background:#f4f5f7"><div style="height:56px;background:#e3e6ea"></div>' +
  '<div style="padding:32px 40px"><h1>Grades (fake page)</h1>' +
  '<div style="background:#fff;margin:10px 0;height:44px;border-radius:6px"></div>'.repeat(10) + '</div></body></html>';

const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'sgd-shots-'));
const ctx = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
});
const shots = [];
const shot = async (page, name) => {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  shots.push(file);
};

try {
  const worker = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
  const extId = new URL(worker.url()).hostname;
  await ctx.route('https://app.schoology.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: FAKE_PAGE }));

  // Popup + demo data (parent view, GO/NO-GO badge on).
  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 400, height: 600 });
  await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
  // Data is kept per Schoology site ("<key>@<origin>"); the screenshots use
  // app.schoology.com, so the popup is pointed there too.
  await popup.evaluate(() => chrome.storage.local.set({ settings: { showGoNoGo: true, schoologyBase: 'https://app.schoology.com' }, 'turnedIn@https://app.schoology.com': {}, 'markedDone@https://app.schoology.com': {} }));
  await popup.reload();
  await popup.getByRole('button', { name: 'Demo data' }).click();
  await popup.getByText('Demo data loaded.').waitFor();
  await popup.screenshot({ path: path.join(OUT, '01-popup.png'), fullPage: true });
  shots.push(path.join(OUT, '01-popup.png'));

  // Settings page with the demo families loaded.
  const settingsPage = await ctx.newPage();
  await settingsPage.setViewportSize({ width: 1280, height: 900 });
  await settingsPage.goto(`chrome-extension://${extId}/options/options.html`);
  await settingsPage.locator('.kid').first().waitFor();
  await settingsPage.waitForTimeout(400); // let the switches settle
  await settingsPage.screenshot({ path: path.join(OUT, '08-settings.png'), fullPage: true });
  shots.push(path.join(OUT, '08-settings.png'));
  await settingsPage.close();

  const page = await ctx.newPage();
  await page.goto('https://app.schoology.com/grades/grades');
  const sheet = page.locator('#sgd-panel-host aside.sheet');
  const body = sheet.locator('.body');
  await sheet.locator('.card').waitFor();
  await shot(page, '02-panel-open');

  // Refresh in progress (state written directly; no network needed).
  await popup.evaluate(() => chrome.storage.local.set({
    'refreshState@https://app.schoology.com': { running: true, reason: 'page-load', startedAt: new Date().toISOString(), done: 2, total: 4, label: 'Reading Jamie’s grades' },
  }));
  await sheet.getByText('Refreshing grades…').waitFor();
  await shot(page, '02b-refreshing');
  await popup.evaluate(() => chrome.storage.local.set({
    'refreshState@https://app.schoology.com': { running: false, ok: true, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), done: 4, total: 4, label: 'Done' },
  }));
  await sheet.getByText('Refreshing grades…').waitFor({ state: 'hidden' });

  await sheet.getByRole('tab', { name: 'Sam' }).click();
  await sheet.locator('.card', { hasText: 'Sam Rivera' }).waitFor();
  await shot(page, '03-sam-nogo');

  // Grade chart: open one class, hover near today.
  const lit = sheet.locator('.class', { hasText: 'American Literature' });
  await lit.locator('button.class-toggle').click();
  await lit.locator('svg.gchart').waitFor();
  await lit.scrollIntoViewIfNeeded();
  const hit = await lit.locator('svg.gchart .gc-hit').boundingBox();
  await page.mouse.move(hit.x + hit.width * 0.75, hit.y + hit.height / 2);
  await page.waitForTimeout(200);
  await shot(page, '03b-grade-chart');
  await lit.locator('button.class-toggle').click();

  await sheet.getByRole('button', { name: /as turned in$/ }).first().click();
  await sheet.getByRole('button', { name: /as done$/ }).first().click();
  await sheet.getByText('Submitted, not graded yet · 2').waitFor();
  await body.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await shot(page, '04-waiting-on-teacher');

  await sheet.getByRole('button', { name: 'Close dashboard panel' }).click();
  await page.waitForTimeout(300); // slide-out transition
  await shot(page, '05-closed-tab');

  // Student view: one dashboard keyed 'self', badge hidden (student default).
  await popup.evaluate(async () => {
    const K = (k) => `${k}@https://app.schoology.com`;
    const dashboards = (await chrome.storage.local.get(K('dashboards')))[K('dashboards')];
    await chrome.storage.local.set({
      [K('dashboards')]: { self: { ...dashboards['demo-sam'], studentName: 'Alex Student' } },
      settings: { showGoNoGo: false, schoologyBase: 'https://app.schoology.com' },
      [K('turnedIn')]: {},
      [K('markedDone')]: {},
    });
  });
  await page.locator('#sgd-panel-host button.edge-tab').click();
  await sheet.getByRole('heading', { name: 'Hi, Alex' }).waitFor();
  await page.waitForTimeout(300);
  await shot(page, '06-student');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await shot(page, '07-iphone');

  console.log(`Saved ${shots.length} screenshots:\n${shots.map((f) => `  ${path.relative(ROOT, f)}`).join('\n')}`);
} finally {
  await ctx.close();
  rmSync(userDataDir, { recursive: true, force: true });
}
