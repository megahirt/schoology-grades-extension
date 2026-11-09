// site-screenshots.mjs — `npm run site:screenshots`
//
// Regenerates every screenshot on the promo site (site/img/). Run it on a
// Mac, so the Share button shows Apple's share icon like most NPC families
// will see.
//
// 1. Starts the mock Schoology server with the made-up "showcase" data
//    (test/mock-server/showcase.js: the Rivera family, 8 classes each, dates
//    relative to today).
// 2. Loads the DEV build (run `npm run build:dev` first) into Chromium, logs
//    in as the parent, seeds two months of the daily log so Records has a
//    "nothing missing" run, and refreshes for real against the mock server.
// 3. Saves desktop shots (1280×800) of the panel, the teacher chooser, the
//    grade chart, Records, the popup and the settings page; then phone
//    shots (390×844), each also placed in a drawn phone frame.
// 4. Does the same as the student (Sam), in a fresh profile.
//
// Never point this at real Schoology or use real student data: the repo
// is public and these images are committed.

import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../test/mock-server/server.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, 'site/img');
const DAY = 24 * 60 * 60 * 1000;

if (!existsSync(path.join(DIST, 'manifest.json'))) {
  console.error('No dist/ build. Run `npm run build:dev` first.');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(path.join(DIST, 'manifest.json'), 'utf8'));
if (!(manifest.host_permissions || []).some((h) => h.includes('localhost'))) {
  console.error('dist/ is a production build. Run `npm run build:dev` first (the mock server is on localhost).');
  process.exit(1);
}
if (process.platform !== 'darwin') {
  console.warn('Note: not on a Mac, so the Share button will show the three-dots icon instead of Apple\'s.');
}
mkdirSync(OUT, { recursive: true });

// A plain, neutral page behind the panel (no Schoology or school branding).
const BACKDROP = '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Grades</title></head>' +
  '<body style="margin:0;font-family:-apple-system,system-ui,sans-serif;background:#f4f5f7;color:#3e4c59">' +
  '<div style="height:52px;background:#dfe3e8"></div><div style="padding:28px 40px"><div style="width:180px;height:22px;background:#d3d8de;border-radius:4px;margin-bottom:18px"></div>' +
  '<div style="background:#fff;margin:10px 0;height:44px;border-radius:6px"></div>'.repeat(10) + '</div></body></html>';

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
const saved = [];

const mock = await startServer(0, { dataset: 'showcase' });
const base = mock.url.replace('127.0.0.1', 'localhost'); // the dev build allows localhost, not 127.0.0.1

async function launch() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sgd-site-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    channel: 'chromium', // full Chromium: the headless shell ignores --load-extension
    headless: true,
    viewport: DESKTOP,
    deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
  });
  let worker = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'));
  if (!worker) worker = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = new URL(worker.url()).hostname;
  await ctx.route(`${base}/showcase`, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: BACKDROP }));
  // Profile pictures the mock server links to: plain initials.
  await ctx.route('https://mock.schoology.test/pictures/**', (r) => {
    const uid = r.request().url().match(/(\d+)\.png/)?.[1];
    const [text, color] = { 2000001: ['SR', '#2f6f4e'], 2000002: ['JR', '#7a4fa0'] }[uid] || ['?', '#667'];
    r.fulfill({ status: 200, contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="${color}"/><text x="48" y="60" font-family="-apple-system,Helvetica,Arial" font-size="38" font-weight="600" fill="#fff" text-anchor="middle">${text}</text></svg>` });
  });
  return { ctx, dir, worker, extId };
}

// The extension writes its default settings on first run, which can land
// after ours; write until the mock server's address sticks.
async function setStorage(worker, values) {
  for (let i = 0; i < 20; i++) {
    try {
      await worker.evaluate(async (v) => {
        // Account data is kept per Schoology site ("<key>@<origin>").
        const site = new URL(v.settings.schoologyBase).origin;
        const scoped = Object.fromEntries(Object.entries(v).map(([k, val]) => [k === 'settings' ? k : `${k}@${site}`, val]));
        const { settings = {} } = await chrome.storage.local.get('settings');
        await chrome.storage.local.set({ ...scoped, settings: { ...settings, ...v.settings } });
      }, values);
      await new Promise((r) => setTimeout(r, 500));
      const { settings = {} } = await worker.evaluate(() => chrome.storage.local.get('settings'));
      if (settings.schoologyBase === values.settings.schoologyBase) return;
    } catch (e) {
      if (i === 19) throw e;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Could not point the extension at the mock server');
}

async function login(ctx, persona) {
  const page = await ctx.newPage();
  await page.goto(`${base}/login?as=${persona}`);
  await page.fill('#username', 'showcase');
  await page.fill('#password', 'showcase');
  await page.click('#login-submit');
  await page.waitForURL(`${base}/home`);
  await page.close();
}

// Daily log: one entry per day. `missingOn(daysAgo)` says how many items
// were teacher-marked Missing that day.
function dailyLog(missingOn, days = 60) {
  const out = {};
  for (let ago = days; ago >= 1; ago--) {
    const d = new Date(Date.now() - ago * DAY);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    out[key] = { v: 1, at: d.toISOString(), teacherMissing: missingOn(ago) };
  }
  return out;
}

async function refresh(ctx, extId, worker, expected) {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/popup/popup.html`);
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'refresh-now' }));
  for (let i = 0; i < 60; i++) {
    const { dashboards = {}, refreshState = {} } = await worker.evaluate(async () => {
      const all = await chrome.storage.local.get(null);
      const pick = (k) => Object.entries(all).find(([key]) => key.startsWith(`${k}@`))?.[1];
      return { dashboards: pick('dashboards') || {}, refreshState: pick('refreshState') || {} };
    });
    if (Object.keys(dashboards).length >= expected && !refreshState.running) break;
    await page.waitForTimeout(500);
  }
  await page.close();
}

async function save(target, name, opts = {}) {
  const file = path.join(OUT, `${name}.png`);
  await target.screenshot({ path: file, ...opts });
  saved.push(file);
  return file;
}

async function openPanel(ctx) {
  const page = await ctx.newPage();
  await page.goto(`${base}/showcase`);
  const sheet = page.locator('#sgd-panel-host aside.sheet');
  const tab = page.locator('#sgd-panel-host button.edge-tab');
  await tab.waitFor();
  await waitIdle(sheet);
  if ((await tab.getAttribute('aria-expanded')) !== 'true') await tab.click();
  await sheet.locator('.card').first().waitFor();
  await hideDev(page);
  await page.waitForTimeout(500);
  return { page, sheet, body: sheet.locator('.body') };
}

// The panel redraws when storage changes, which can detach an element
// between finding it and scrolling to it: retry.
async function scrollTo(locator) {
  for (let i = 0; i < 10; i++) {
    try {
      await locator.evaluate((el) => el.scrollIntoView({ block: 'start' }));
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  await locator.scrollIntoViewIfNeeded();
}

// Hide what only the dev build shows (the "DEV · Data: …" bar and the
// settings page's Developer section): the site shows the real product.
const HIDE_DEV = '.dev-row, .dev-only, a.dev-only { display: none !important; }';
async function hideDev(page) {
  await page.evaluate((css) => {
    const add = (root) => {
      if (!root || root.querySelector('style[data-site-shots]')) return;
      const st = document.createElement('style');
      st.dataset.siteShots = '1';
      st.textContent = css;
      (root.head || root).appendChild(st);
    };
    add(document);
    add(document.querySelector('#sgd-panel-host')?.shadowRoot);
  }, HIDE_DEV);
}

async function waitIdle(sheet) {
  await sheet.getByText('Refreshing grades…').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
  await sheet.page().waitForTimeout(300);
}

// Phone frame: the screenshot inside a drawn phone (CSS only, no Apple
// artwork), saved with a transparent background.
let framer;
async function frame(file, name) {
  if (!framer) {
    framer = await chromium.launch({ channel: 'chromium' });
  }
  const page = await framer.newPage({ deviceScaleFactor: 1, viewport: { width: 1000, height: 1900 } });
  const src = `data:image/png;base64,${readFileSync(file).toString('base64')}`;
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">
    <div id="phone" style="display:inline-block;padding:28px;border-radius:118px;background:#1b1d22;box-shadow:inset 0 0 0 4px #3a3d44">
      <div style="position:relative;border-radius:92px;overflow:hidden;width:780px;height:1688px;background:#fff">
        <img src="${src}" style="display:block;width:780px;height:1688px">
        <div style="position:absolute;top:22px;left:50%;transform:translateX(-50%);width:250px;height:72px;border-radius:40px;background:#000"></div>
      </div>
    </div></body></html>`);
  await page.locator('img').evaluate((img) => img.decode());
  await save(page.locator('#phone'), name, { omitBackground: true });
  await page.close();
}

async function phoneShots(page, sheet, body, shots) {
  await page.setViewportSize(PHONE);
  await page.waitForTimeout(400);
  for (const [name, before] of shots) {
    if (before) await before();
    await body.evaluate((el) => { el.scrollTop = 0; });
    await page.waitForTimeout(250);
    const file = await save(page, `${name}-raw`);
    await frame(file, name);
  }
  await page.setViewportSize(DESKTOP);
  await page.waitForTimeout(300);
}

try {
  // ---------------- Parent ----------------
  {
    const { ctx, dir, worker, extId } = await launch();
    try {
      await setStorage(worker, {
        settings: { schoologyBase: base, showGoNoGo: true },
        // Sam: nothing missing for weeks until 11 days ago. Jamie: a shorter run earlier.
        dailyLog: {
          2000001: dailyLog((ago) => (ago <= 11 ? 1 : 0)),
          2000002: dailyLog((ago) => (ago >= 30 && ago <= 42 ? 0 : 2)),
        },
        turnedIn: {},
        markedDone: {},
      });
      await login(ctx, 'parent');
      await refresh(ctx, extId, worker, 2);

      const { page, sheet, body } = await openPanel(ctx);
      await waitIdle(sheet);

      // Sam: GO, doing well.
      await sheet.getByRole('tab', { name: 'Sam' }).click();
      await sheet.locator('.card', { hasText: 'Sam Rivera' }).waitFor();
      await page.waitForTimeout(300);
      await save(page, 'parent-sam');

      // Sam's Records and Doing well, further down.
      await scrollTo(sheet.locator('h2', { hasText: 'Records' }));
      await page.waitForTimeout(300);
      await save(page, 'records');

      // Grade chart for a class that went up since Q1.
      await body.evaluate((el) => { el.scrollTop = 0; });
      const bio = sheet.locator('.class', { hasText: 'Biology' });
      await bio.locator('button.class-toggle').click();
      await bio.locator('svg.gchart').waitFor();
      await scrollTo(bio);
      const hit = await bio.locator('svg.gchart .gc-hit').boundingBox();
      if (hit) await page.mouse.move(hit.x + hit.width * 0.8, hit.y + hit.height / 2);
      await page.waitForTimeout(300);
      await save(page, 'grade-chart');
      await bio.locator('button.class-toggle').click();

      // Jamie: NO-GO with Missing work.
      await body.evaluate((el) => { el.scrollTop = 0; });
      await sheet.getByRole('tab', { name: 'Jamie' }).click();
      await sheet.locator('.card', { hasText: 'Jamie Rivera' }).waitFor();
      await body.evaluate((el) => { el.scrollTop = 0; });
      await page.waitForTimeout(300);
      await save(page, 'parent-jamie');

      // "Message the teacher" on a class with two admins: the chooser.
      const mathCard = sheet.locator('.missing-card', { hasText: 'Integers Homework' });
      await mathCard.locator('[data-act="email-teacher"]').click();
      await sheet.locator('.teacher-chooser').waitFor({ timeout: 15000 });
      await scrollTo(sheet.locator('.teacher-chooser'));
      await page.waitForTimeout(300);
      await save(page, 'teacher-chooser');
      await sheet.locator('[data-act="tc-cancel"]').click();
      // Close any compose tab the click may have opened.
      for (const p of ctx.pages()) if (p !== page && /messages\/new/.test(p.url())) await p.close();

      // Turned-in mark: tick one Missing item, then show Submitted, not graded yet.
      await sheet.getByRole('button', { name: 'Mark Field Notes as turned in' }).click();
      await sheet.getByText(/Submitted, not graded yet/).first().waitFor();
      await scrollTo(sheet.locator('h2', { hasText: 'Submitted, not graded yet' }));
      await page.waitForTimeout(300);
      await save(page, 'waiting-on-teacher');
      await sheet.getByRole('button', { name: 'Undo: Field Notes' }).click();

      // Closed: just the tab at the page's edge, with each child's counts.
      await sheet.getByRole('button', { name: 'Close dashboard panel' }).click();
      await page.waitForTimeout(500);
      await save(page, 'closed-tab');
      await page.locator('#sgd-panel-host button.edge-tab').click();
      await sheet.locator('.card').first().waitFor();
      await page.waitForTimeout(400);

      // Phone: Jamie then Sam.
      await phoneShots(page, sheet, body, [
        ['phone-parent-jamie', null],
        ['phone-parent-sam', async () => {
          await sheet.getByRole('tab', { name: 'Sam' }).click();
          await sheet.locator('.card', { hasText: 'Sam Rivera' }).waitFor();
        }],
      ]);
      await page.close();

      // Popup.
      const popup = await ctx.newPage();
      await popup.setViewportSize({ width: 400, height: 640 });
      await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
      await popup.locator('.card').first().waitFor();
      await hideDev(popup);
      await popup.waitForTimeout(400);
      await save(popup, 'popup', { fullPage: true });
      await popup.close();

      // Settings page.
      const opts = await ctx.newPage();
      await opts.setViewportSize({ width: 1100, height: 900 });
      await opts.goto(`chrome-extension://${extId}/options/options.html`);
      await opts.locator('#grade-threshold').waitFor();
      await hideDev(opts);
      // Show the address families will see, not the mock server's.
      await opts.evaluate((host) => {
        const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) if (n.nodeValue.includes(host)) n.nodeValue = n.nodeValue.replace(host, 'app.schoology.com');
      }, new URL(base).host);
      await opts.waitForTimeout(500);
      await save(opts, 'settings', { fullPage: true });
      await opts.close();
    } finally {
      await ctx.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // ---------------- Student (Sam) ----------------
  {
    const { ctx, dir, worker, extId } = await launch();
    try {
      await setStorage(worker, {
        settings: { schoologyBase: base },
        dailyLog: { self: dailyLog((ago) => (ago <= 11 ? 1 : 0)) },
        turnedIn: {},
        markedDone: {},
      });
      await login(ctx, 'student');
      await refresh(ctx, extId, worker, 1);
      const { page, sheet, body } = await openPanel(ctx);
      await waitIdle(sheet);
      await save(page, 'student-sam');
      await phoneShots(page, sheet, body, [['phone-student-sam', null]]);
      await page.close();
    } finally {
      await ctx.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }

  console.log(`Saved ${saved.length} images to ${path.relative(ROOT, OUT)}/:\n${saved.map((f) => `  ${path.basename(f)}`).join('\n')}`);
} finally {
  if (framer) await framer.close();
  await mock.close();
}

// Keep the raw (unframed) phone shots out of the published site.
for (const f of saved.filter((f) => f.endsWith('-raw.png'))) rmSync(f, { force: true });
writeFileSync(path.join(OUT, 'README.md'), '# Site screenshots\n\nGenerated by `npm run site:screenshots` (scripts/site-screenshots.mjs) from the made-up showcase data. Do not edit by hand; never add real student data.\n');
