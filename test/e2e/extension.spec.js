// extension.spec.js — Playwright e2e for the Grades Dashboard extension.
//
// Launches Chromium with the unpacked DEV build (dist/, produced by
// `npm run build:dev`), starts the mock Schoology server, points the
// extension at the mock server via settings.schoologyBase, and asserts the
// popup renders the correct Missing counts and GO/NO-GO verdicts for BOTH
// personas (student: 1 Missing + a 68% class => NO-GO "Low grades";
// parent: Sam NO-GO + Jamie GO).
//
// The parent test guards the per-child attribution fix in
// extension/src/schoology.js (each child gets only their own courses).
//
// Tests run in Chromium and Firefox (two Playwright projects, see
// playwright.config.js). Chromium loads dist/ with --load-extension; Firefox
// loads dist-firefox/ (`npm run build:firefox`) as a temporary add-on over
// its debugger protocol (firefox-addon.js). Playwright's Firefox can't open
// moz-extension:// pages, so in Firefox "the popup" is the same dashboard
// in the in-page panel on a mock Schoology page, storage is read and
// written in the add-on's background page, and the settings-page test is
// skipped. Safari can't be automated here; see test/README.md.
//
// If the DEV build does not exist yet (the extension workstream is still
// building it), the whole file skips gracefully instead of faking a pass —
// see the beforeAll check. Run `npm run build:dev` first.

import { test, expect, chromium, firefox } from '@playwright/test';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../mock-server/server.js';
import { FIREFOX_PREFS, freePort, installAddon } from './firefox-addon.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// The DEV build output: `npm run build:dev` writes to dist/ (with the
// localhost host permission added); dist-dev/ is accepted as a fallback if
// the build script is ever changed to use it (as SPEC.md originally said).
const DIST_CANDIDATES = [path.join(REPO_ROOT, 'dist'), path.join(REPO_ROOT, 'dist-dev')];
const DIST_DIR = DIST_CANDIDATES.find((d) => existsSync(path.join(d, 'manifest.json')));
const HAS_DEV_BUILD = Boolean(DIST_DIR);
const FIREFOX_DIST_DIR = path.join(REPO_ROOT, 'dist-firefox');
const HAS_FIREFOX_BUILD = existsSync(path.join(FIREFOX_DIST_DIR, 'manifest.json'));
const isFirefox = () => test.info().project.use.browserName === 'firefox';
// Page paths come from the built manifest (options_page, action.default_popup)
// rather than being hardcoded — the layout is options/options.html and
// popup/popup.html, not bare options.html / popup.html at the extension root.
const MANIFEST = HAS_DEV_BUILD
  ? JSON.parse(readFileSync(path.join(DIST_DIR, 'manifest.json'), 'utf8'))
  : {};
const OPTIONS_PAGE = MANIFEST.options_page || 'options/options.html';
const POPUP_PAGE = MANIFEST.action?.default_popup || 'popup/popup.html';

let mock;
let mockBase; // http://localhost:<port> — the DEV build's host permission is
// http://localhost:*/*, which does NOT match 127.0.0.1, so the extension
// must be pointed at the localhost hostname (same loopback interface).

// The mock server runs once for the whole file; each test gets a fresh
// browser context (fresh user-data-dir) so personas do not leak cookies.
test.beforeAll(async () => {
  mock = await startServer(0);
  mockBase = mock.url.replace('127.0.0.1', 'localhost');
});

test.afterAll(async () => {
  await mock.close();
});

test.describe('Grades Dashboard extension (mock Schoology)', () => {
  test.beforeEach(async () => {
    if (isFirefox()) test.skip(!HAS_FIREFOX_BUILD, 'Firefox DEV build (dist-firefox/) not present yet — run `npm run build:firefox` first.');
    else test.skip(!HAS_DEV_BUILD, 'DEV build (dist/) not present yet — run `npm run build:dev` first.');
  });

  // Fresh user-data-dir per test, from the OS temp dir (plain ASCII path).
  // NOTE: testInfo.outputPath() is NOT used here — test titles containing
  // non-ASCII characters (e.g. an em dash) end up in that path, and Chrome's
  // extension storage failed to open the profile directory with such a path
  // ("Could not open/read directory").
  function freshUserDataDir() {
    return mkdtempSync(path.join(os.tmpdir(), 'schoology-e2e-'));
  }

  // Launch Chromium with the unpacked DEV build and return the context plus
  // the extension id (read from the background service worker target).
  async function launchWithExtension(userDataDir) {
    if (isFirefox()) return launchFirefoxWithExtension(userDataDir);
    const context = await chromium.launchPersistentContext(userDataDir, {
      // Chrome's headless shell (Playwright's default headless browser since
      // 1.49) ignores --load-extension. channel 'chromium' runs full Chromium
      // in new headless mode, which loads extensions.
      channel: 'chromium',
      headless: true,
      args: [
        `--disable-extensions-except=${DIST_DIR}`,
        `--load-extension=${DIST_DIR}`,
      ],
    });
    // MV3 background is a service worker; its URL carries the extension id.
    // waitForEvent can race with an already-registered worker, so fall back
    // to polling the context's service workers.
    let worker = null;
    try {
      worker = await context.waitForEvent('serviceworker', { timeout: 10000 });
    } catch {
      for (let i = 0; i < 20 && !worker; i++) {
        worker = context.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'));
        if (!worker) await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (!worker) throw new Error('Extension service worker did not start');
    const extensionId = new URL(worker.url()).hostname;
    return { context, extensionId, worker };
  }

  // Firefox: install dist-firefox/ as a temporary add-on. `worker` runs code
  // in the add-on's background page instead of a service worker; there is
  // no extension id (extension pages aren't opened in Firefox).
  async function launchFirefoxWithExtension(userDataDir) {
    const port = await freePort();
    const context = await firefox.launchPersistentContext(userDataDir, {
      headless: true,
      firefoxUserPrefs: FIREFOX_PREFS,
      args: ['-start-debugger-server', String(port)],
    });
    const addon = await installAddon(port, FIREFOX_DIST_DIR);
    context.on('close', () => addon.close());
    context.__addon = addon;
    return { context, extensionId: null, worker: addon };
  }

  // Log in to the mock server as the given persona inside the context.
  async function loginAs(context, persona, base = mockBase) {
    const page = await context.newPage();
    await page.goto(`${base}/login?as=${persona}`);
    await page.fill('#username', 'testuser');
    await page.fill('#password', 'testpass');
    await page.click('#login-submit');
    await expect(page).toHaveURL(`${base}/home`);
    await page.close();
  }

  // Point the extension at the mock server and enable the GO/NO-GO badge
  // (student view hides it by default unless a parent enables it).
  // The options-page evaluate occasionally throws a transient Chromium
  // storage IO error on a fresh profile, so retry a few times; if it keeps
  // failing, write the same settings via the background service worker
  // (same storage, same result) while the options page stays open.
  async function configureExtension(context, extensionId, worker, base = mockBase) {
    if (isFirefox()) {
      await worker.evaluate(async (base) => {
        const { settings = {} } = await chrome.storage.local.get('settings');
        await chrome.storage.local.set({ settings: { ...settings, schoologyBase: base, showGoNoGo: true } });
      }, base);
      return;
    }
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/${OPTIONS_PAGE}`);
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await page.evaluate(async (base) => {
          const { settings = {} } = await chrome.storage.local.get('settings');
          await chrome.storage.local.set({
            settings: { ...settings, schoologyBase: base, showGoNoGo: true },
          });
        }, base);
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
        await page.waitForTimeout(1000);
      }
    }
    if (lastError && worker) {
      await worker.evaluate(async (base) => {
        const { settings = {} } = await chrome.storage.local.get('settings');
        await chrome.storage.local.set({
          settings: { ...settings, schoologyBase: base, showGoNoGo: true },
        });
      }, base);
      lastError = null;
    }
    await page.close();
    if (lastError) throw lastError;
  }

  // Trigger a refresh: click the popup's Refresh button if present, else
  // send the `refresh-now` runtime message from an extension page.
  // The button's handler is async, so afterwards poll storage until the
  // dashboards land (up to 30s) — opening the popup immediately after the
  // click would race the background fetch and show "No data yet".
  async function triggerRefresh(context, extensionId) {
    if (isFirefox()) {
      // Firefox: a Schoology page load starts a refresh by itself (the
      // panel's Refresh button is the fallback); wait for it to land.
      const worker = context.__addon;
      const page = await context.newPage();
      await page.goto(`${mockBase}/home`);
      const refresh = page.locator('#sgd-panel-host').getByRole('button', { name: 'Refresh grades' });
      const count = async () => Object.keys((await worker.evaluate(async () => Object.entries(await chrome.storage.local.get(null)).find(([k]) => k.startsWith('dashboards@'))?.[1])) || {}).length;
      await expect.poll(async () => {
        if (await refresh.isEnabled().catch(() => false)) await refresh.click().catch(() => {});
        return count();
      }, { timeout: 30000, intervals: [1000] }).toBeGreaterThan(0);
      await expect(refresh).toBeEnabled({ timeout: 30000 });
      await page.close();
      return;
    }
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/${POPUP_PAGE}`);
    const refresh = page.getByRole('button', { name: /refresh/i });
    if (await refresh.count()) {
      await refresh.first().click();
    } else {
      await page.evaluate(() => chrome.runtime.sendMessage({ type: 'refresh-now' }));
    }
    await expect.poll(
      async () => {
        // Data is kept per Schoology site ("dashboards@<origin>").
        const dashboards = (await page.evaluate(async () => Object.entries(await chrome.storage.local.get(null)).find(([k]) => k.startsWith('dashboards@'))?.[1])) || {};
        return Object.keys(dashboards).length;
      },
      { timeout: 30000 },
    ).toBeGreaterThan(0);
    await page.close();
  }

  // The popup's Share button with a stubbed system share menu (see the
  // parent test).
  async function shareFromPopup(popup) {
    await popup.evaluate(() => {
      window.__shared = [];
      window.__shareCalls = 0;
      navigator.canShare = () => true;
      navigator.share = async (data) => {
        window.__shareCalls += 1;
        if (window.__shareCalls === 1) throw new DOMException('needs a click', 'NotAllowedError');
        window.__shared.push(data.files.map((f) => `${f.name} ${f.type}`));
      };
    });
    const shareBtn = popup.getByRole('button', { name: 'Share a picture of the dashboard' });
    await shareBtn.click();
    await expect(popup.locator('.status')).toHaveText(/Press Share again to send it\.$/);
    await shareBtn.click();
    await expect(popup.locator('.status')).toHaveText(/shared\.$/);
    expect(await popup.evaluate(() => window.__shared)).toEqual([[expect.stringMatching(/^grades-dashboard-jamie-\d{4}-\d{2}-\d{2}\.png image\/png$/)]]);
  }

  async function openPopup(context, extensionId) {
    if (isFirefox()) {
      // The same dashboard, in the panel on a Schoology page. Locator calls
      // go to the panel; mouse and close to the page.
      const page = await context.newPage();
      await page.goto(`${mockBase}/home`);
      const panel = page.locator('#sgd-panel-host aside.sheet');
      return {
        getByRole: (...a) => panel.getByRole(...a),
        getByText: (...a) => panel.getByText(...a),
        locator: (...a) => panel.locator(...a),
        mouse: page.mouse,
        close: () => page.close(),
      };
    }
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/${POPUP_PAGE}`);
    return page;
  }

  test('student persona: 1 Missing, no verdict shown to students, quarter grades', async () => {
    const userDataDir = freshUserDataDir();
    const { context, extensionId, worker } = await launchWithExtension(userDataDir);
    try {
      await loginAs(context, 'student');
      await configureExtension(context, extensionId, worker);
      await triggerRefresh(context, extensionId);

      const popup = await openPopup(context, extensionId);
      // Alex Student's data: Algebra 2 at 68% (below 75) is a low class, and
      // American Literature has 1 Missing item. Correct verdict: NO-GO for
      // low grades (one Missing alone would be GO). The student's name comes
      // from the home page (data-user-name).
      await expect(popup.getByRole('heading', { name: 'Hi, Alex', exact: true })).toBeVisible({ timeout: 15000 });
      // The same card as parents get (name, Missing chip; the week's ring
      // depends on today's date, so the unit test checks it), without the
      // GO/NO-GO verdict, which is for parents only.
      const card = popup.locator('.card');
      await expect(card.locator('.card-name')).toHaveText('Alex Student');
      await expect(card.locator('.stat', { hasText: 'Missing' })).toHaveText(/^1\s*Missing$/);
      await expect(popup.getByText('NO-GO', { exact: true })).toHaveCount(0);
      await expect(popup.getByText('Missing · 1')).toBeVisible();
      await expect(popup.locator('.missing-card', { hasText: 'Persuasive Essay Draft' })).toBeVisible();
      // Algebra 2 has real nested quarters: GO/NO-GO uses Quarter 2 (68%),
      // with the Semester 1 grade (74%) shown beside it.
      await expect(popup.locator('.class-cols .col-q')).toHaveText('Quarter 2');
      await expect(popup.locator('.class-cols .col-o')).toHaveText('Semester');
      // The quarter's dates, from the grading-period title on the grades page.
      await expect(popup.getByText('Quarter 2 is from Oct 19 to Dec 15.')).toBeVisible();
      const algebra = popup.locator('.class', { hasText: 'Algebra 2' });
      // Down on Quarter 1 (80% -> 68%): no "vs Q1" pill, drops are not shown.
      await expect(algebra.locator('.up-pill')).toHaveCount(0);
      // Clicking the class name opens its grade chart (dots + class-grade line),
      // with the link to the class in Schoology; clicking again closes it.
      await algebra.locator('button.class-toggle').click();
      await expect(algebra.locator('button.class-toggle')).toHaveAttribute('aria-expanded', 'true');
      await expect(algebra.locator('svg.gchart')).toBeVisible();
      await expect(algebra.locator('svg.gchart .gc-dot')).toHaveCount(2); // the two graded Algebra 2 items
      await expect(algebra.locator('svg.gchart .gc-pass')).toHaveCount(1); // dashed passing line
      await expect(algebra.locator('a.chart-link')).toHaveAttribute('href', `${mockBase}/course/1001/student_grades`);
      // The class's highest score sits under its chart.
      await expect(algebra.locator('.class-best')).toContainText('Highest score');
      // Desktop hover shows the nearest assignment: date, title and its grade.
      const box = await algebra.locator('svg.gchart .gc-hit').boundingBox();
      await popup.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2);
      await expect(algebra.locator('svg.gchart .gc-hover')).toHaveAttribute('visibility', 'visible');
      await expect(algebra.locator('svg.gchart .gc-tip')).toHaveText(/^[A-Z][a-z]{2} \d{1,2} · Factoring Worksheet · 70%$/);
      await algebra.locator('.class-row .bar').click(); // anywhere on the row toggles too
      await expect(algebra.locator('svg.gchart')).toHaveCount(0);
      // Assignment titles link to Schoology.
      await expect(popup.locator('.missing-card a.item-title', { hasText: 'Persuasive Essay Draft' })).toHaveAttribute('href', /\/assignment\/5101$/);
      await expect(algebra.locator('.class-grade')).toHaveText('68%');
      await expect(algebra.locator('.class-overall')).toHaveText('74%');
      // A class with no quarter grade shows a dash; its semester grade stands.
      const lit = popup.locator('.class', { hasText: 'American Literature' });
      await expect(lit.locator('.class-grade')).toHaveText('—');
      await expect(lit.locator('.class-overall')).toHaveText('82%');
      await expect(lit.locator('.bar-fill')).toHaveAttribute('style', /width:\s*82%/); // bar follows the semester grade
      // Submitted, ungraded work waits on the teacher (no Undo: Schoology reported it).
      const journal = popup.locator('.waiting', { hasText: 'Poetry Journal' });
      await expect(journal).toBeVisible();
      await expect(journal).not.toContainText('Submitted'); // the section title says it
      await expect(journal.getByRole('button', { name: /Undo/ })).toHaveCount(0);
      await expect(journal.locator('.missing-tag')).toHaveCount(0); // submitted, but not marked Missing

      // "Turned in" moves the Missing item to Submitted, not graded yet; Undo moves it back.
      await popup.getByRole('button', { name: /as turned in$/ }).click();
      // With nothing left, the Missing section disappears entirely.
      await expect(popup.locator('.sec-h', { hasText: 'Missing' })).toHaveCount(0);
      await expect(popup.getByText('Submitted, not graded yet · 2')).toBeVisible();
      await expect(popup.locator('.waiting', { hasText: 'Persuasive Essay Draft' })).toContainText('Marked turned in');
      await expect(popup.getByText('Marking something done or turned in is for your own use — nobody is notified.')).toBeVisible();
      await popup.getByRole('button', { name: 'Undo: Persuasive Essay Draft' }).click();
      await expect(popup.getByText('Missing · 1')).toBeVisible();
      await expect(popup.getByText('Submitted, not graded yet · 1')).toBeVisible();
      await expect(popup.getByText(/nobody is notified/)).toHaveCount(0);
      // Each section heading carries its emoji.
      await expect(popup.locator('.sec-h', { hasText: 'Missing' }).locator('img.missing-icon')).toBeVisible(); // Schoology's icon
      await expect(popup.locator('.sec-h', { hasText: 'Classes' }).locator('.sec-emoji')).toHaveText('🏛️');
      await popup.close();
    } finally {
      await context.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('each person signed in on a site has their own data; signed out shows the old data with a banner', async () => {
    const userDataDir = freshUserDataDir();
    const { context, extensionId, worker } = await launchWithExtension(userDataDir);
    // Storage as the background sees it (both browsers; small answers only,
    // which Firefox's add-on bridge returns reliably).
    const site = new URL(mockBase).origin;
    const read = (key, pick) => worker.evaluate(async ([k, p]) => {
      const v = (await chrome.storage.local.get(k))[k];
      return p === 'names' ? Object.values(v || {}).map((d) => d.studentName) : v ? v[p] : null;
    }, [key, pick]);
    const names = async (uid) => (await read(`dashboards@${site}#${uid}`, 'names')) || [];
    // The dashboard on a mock Schoology page (the in-page panel).
    async function panelOn(url) {
      const page = await context.newPage();
      await page.goto(url);
      return { page, panel: page.locator('#sgd-panel-host aside.sheet') };
    }
    try {
      await loginAs(context, 'student');
      await configureExtension(context, extensionId, worker);
      await triggerRefresh(context, extensionId);
      await expect.poll(() => names('3000001'), { timeout: 30000 }).toEqual(['Alex Student']);

      // Signed out: the sign-in page marks the site signed out; the last
      // person's data stays, under a banner saying it is old.
      const out = await panelOn(`${mockBase}/logout`);
      await expect(out.page).toHaveURL(`${mockBase}/login`);
      await expect.poll(() => read(`user@${site}`, 'signedOut'), { timeout: 15000 }).toBe(true);
      await expect(out.panel.locator('.signed-out')).toContainText(/Please log in to Schoology to see the latest\. This is old data \(from today, /, { timeout: 15000 });
      await expect(out.panel.locator('.stale')).toHaveCount(0);
      // Grades more than a day old while signed out: still the log-in
      // message, never "more than a day old. Press Refresh."
      await worker.evaluate(async (k) => {
        const v = (await chrome.storage.local.get(k))[k];
        const old = new Date(Date.now() - 2 * 86400000).toISOString();
        for (const d of Object.values(v)) d.updatedAt = old;
        await chrome.storage.local.set({ [k]: v });
      }, `dashboards@${site}#3000001`);
      await expect(out.panel.locator('.signed-out')).toContainText('Please log in to Schoology to see the latest.');
      await expect(out.panel.locator('.stale')).toHaveCount(0);
      await expect(out.panel.getByRole('heading', { name: 'Hi, Alex', exact: true })).toBeVisible();
      await expect(out.panel.getByText('Missing · 1')).toBeVisible();
      await out.page.close();

      // Someone else signs in: their own data, none of the first student's.
      await loginAs(context, 'student2');
      const riley = await panelOn(`${mockBase}/home`);
      await expect.poll(() => names('3000002'), { timeout: 30000 }).toEqual(['Riley Student']);
      await expect(riley.panel.getByRole('heading', { name: 'Hi, Riley', exact: true })).toBeVisible({ timeout: 15000 });
      await expect(riley.panel.locator('.signed-out')).toHaveCount(0);
      await expect(riley.panel.getByText('American Literature')).toHaveCount(0);
      await riley.page.close();
      expect(await names('3000001')).toEqual(['Alex Student']);

      // The first student back: their data is still there.
      await loginAs(context, 'student');
      const alex = await panelOn(`${mockBase}/home`);
      await expect(alex.panel.getByRole('heading', { name: 'Hi, Alex', exact: true })).toBeVisible({ timeout: 15000 });
      await expect(alex.panel.getByText('Missing · 1')).toBeVisible();
      await alex.page.close();
    } finally {
      await context.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('settings page: one auto-saving page; students get no Family rules', async () => {
    test.skip(isFirefox(), "Playwright's Firefox can't open moz-extension:// pages (the settings page).");
    const userDataDir = freshUserDataDir();
    const { context, extensionId, worker } = await launchWithExtension(userDataDir);
    try {
      await loginAs(context, 'student');
      await configureExtension(context, extensionId, worker);
      await triggerRefresh(context, extensionId);

      const opts = await context.newPage();
      await opts.goto(`chrome-extension://${extensionId}/${OPTIONS_PAGE}`);
      await expect(opts.getByRole('heading', { name: 'Grades Dashboard settings' })).toBeVisible();
      await expect(opts.locator('#account-title')).toHaveText('Connected as a student');
      for (const name of ['Account', 'Display', 'Privacy & data']) {
        await expect(opts.getByRole('heading', { name, exact: true })).toBeVisible();
      }
      // Family rules are for parents only; removed choices are gone.
      await expect(opts.getByRole('heading', { name: 'Family rules', exact: true })).toBeHidden();
      for (const gone of ['Who sees grades', 'Not so good', 'Show the GO/NO-GO badge', 'Dashboard panel on Schoology pages']) {
        await expect(opts.getByText(gone, { exact: true })).toHaveCount(0);
      }
      await expect(opts.locator('#doing-well-days')).toHaveCount(0);
      await expect(opts.getByText('Graded work from the past 10 days at or above this.')).toBeVisible();
      await expect(opts.locator('#doing-well-percent')).toHaveAttribute('type', 'range');
      await expect(opts.locator('#doing-well-percent-out')).toHaveText('80%');
      await expect(opts.getByText('Nothing is sent, and marking work turned in or done does not notify anyone.')).toBeVisible();
      await expect(opts.getByRole('heading', { name: 'Classes', exact: true })).toHaveCount(0); // no class switches
      await expect(opts.getByRole('heading', { name: 'Developer' })).toBeVisible(); // dev build
      // Only classes with grades posted count (Advisory 11 has none).
      await expect(opts.locator('.kid')).toContainText('3 classes');

      const popup = await openPopup(context, extensionId);
      await expect(popup.getByRole('heading', { name: 'Hi, Alex', exact: true })).toBeVisible({ timeout: 15000 });
      await expect(popup.locator('.class', { hasText: 'Advisory 11' })).toHaveCount(0);
      // Passing line at the default 75%: Algebra 2 (68%) is below it,
      // American Literature (82%) is not.
      await expect(popup.locator('.class', { hasText: 'Algebra 2' }).locator('.bar-fill')).toHaveClass(/low/);
      await expect(popup.locator('.class', { hasText: 'American Literature' }).locator('.bar-fill')).not.toHaveClass(/low/);

      // A saved passing grade (from a parent) doesn't apply to a student: the
      // default 75% stands. A Display choice still saves automatically.
      await worker.evaluate(async () => {
        const { settings } = await chrome.storage.local.get('settings');
        await chrome.storage.local.set({ settings: { ...settings, gradeThreshold: 85 } });
      });
      await popup.waitForTimeout(500);
      await expect(popup.locator('.class', { hasText: 'American Literature' }).locator('.bar-fill')).not.toHaveClass(/low/);
      // The slider: End jumps to the top of its range (90%).
      await opts.locator('#doing-well-percent').focus();
      await opts.keyboard.press('End');
      await expect(opts.locator('#doing-well-percent-out')).toHaveText('90%');
      await expect.poll(async () => (await opts.evaluate(() => chrome.storage.local.get('settings'))).settings.doingWellPercent).toBe(90);
      await popup.close();

      // Clear data removes everything, settings included, and the page
      // shows the defaults again.
      opts.once('dialog', (d) => d.accept());
      await opts.getByRole('button', { name: 'Clear data…' }).click();
      await expect.poll(async () => Object.keys(await worker.evaluate(() => chrome.storage.local.get(null))).filter((k) => k !== 'settings')).toEqual([]);
      await expect(opts.locator('#doing-well-percent')).toHaveValue('80');
      await opts.close();
    } finally {
      await context.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('in-page panel on Schoology pages: open by default, closes, reopens, remembered', async () => {
    const userDataDir = freshUserDataDir();
    const { context, extensionId, worker } = await launchWithExtension(userDataDir);
    try {
      await loginAs(context, 'student');
      await configureExtension(context, extensionId, worker);
      await triggerRefresh(context, extensionId);

      const page = await context.newPage();
      await page.goto(`${mockBase}/grades/grades`);
      // Playwright locators pierce the panel's open shadow root.
      const panel = page.locator('#sgd-panel-host aside.sheet');
      const tab = page.locator('#sgd-panel-host button.edge-tab');
      await expect(panel.getByRole('heading', { name: 'Hi, Alex', exact: true })).toBeVisible({ timeout: 15000 });
      await expect(panel.getByText('Missing · 1')).toBeVisible();
      await expect(panel.locator('.card .card-name')).toHaveText('Alex Student');
      // The panel hides the demo button (demo data is a popup feature).
      await expect(panel.getByRole('button', { name: /demo/i })).toBeHidden();
      // The page's own grades table is untouched and still on the page.
      await expect(page.locator('.gradebook-course').first()).toBeVisible();

      await panel.getByRole('button', { name: 'Close dashboard panel' }).click();
      await expect(panel).toBeHidden();
      await expect(tab).toHaveAttribute('aria-expanded', 'false');

      // Closed state is remembered on the next Schoology page.
      await page.goto(`${mockBase}/home`);
      await expect(tab).toHaveAttribute('aria-expanded', 'false', { timeout: 15000 });
      await expect(panel).toBeHidden();
      // A student's closed tab shows the counts but no verdict (GO/NO-GO is for parents).
      await expect(tab).toHaveAttribute('aria-label', /^Show grades dashboard\. Alex Student: 1 missing/);
      await expect(tab).not.toHaveAttribute('aria-label', /NO-GO/);
      await expect(tab.locator('.kid-pic')).toHaveCount(1);
      await expect(tab.locator('.kid-m').first()).toHaveText('1'); // Schoology Missing icon + 1
      await expect(tab.locator('.nogo-circle')).toHaveCount(0);
      await tab.click();
      await expect(panel.getByRole('heading', { name: 'Hi, Alex', exact: true })).toBeVisible();

      // Share copies a picture of the whole dashboard (taller than the
      // visible panel) to the clipboard. (Headless Chromium has no share
      // menu, so here it only copies; the popup test below covers sharing.)
      // Firefox lets the test read the clipboard through a testing pref, set
      // in firefox-addon.js.
      if (!isFirefox()) await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: mockBase });
      await page.bringToFront();
      await panel.getByRole('button', { name: 'Share a picture of the dashboard' }).click();
      await expect(panel.getByRole('button', { name: 'Copied' })).toBeVisible();
      const shot = await page.evaluate(async () => {
        const [item] = await navigator.clipboard.read();
        const blob = await item.getType('image/png');
        const bmp = await createImageBitmap(blob);
        return { type: blob.type, w: bmp.width, h: bmp.height };
      });
      expect(shot.type).toBe('image/png');
      expect(Math.abs(shot.w - 437 * 2)).toBeLessThanOrEqual(4); // the panel width, at 2×
      const visible = await panel.locator('main.body').evaluate((el) => el.clientHeight);
      expect(shot.h / 2).toBeGreaterThan(visible); // the whole dashboard, not just what's on screen

      // Wide window (Schoology's 980 px + the 437 px panel fit): the panel
      // docks beside Schoology, which narrows to the space left, no shadow.
      await page.evaluate(() => { document.body.innerHTML += '<div id="probe" style="width:100%;height:10px"></div>'; });
      const probeWidth = () => page.locator('#probe').evaluate((el) => el.getBoundingClientRect().width);
      await page.setViewportSize({ width: 1500, height: 900 });
      await expect(page.locator('html')).toHaveClass(/sgd-panel-open/);
      await expect.poll(probeWidth).toBeLessThanOrEqual(1500 - 437);
      await expect(panel).toHaveCSS('box-shadow', 'none');
      await panel.getByRole('button', { name: 'Close dashboard panel' }).click();
      await expect(page.locator('html')).not.toHaveClass(/sgd-panel-open/); // closed: full width again
      await expect.poll(probeWidth).toBeGreaterThan(1500 - 437);
      await tab.click();
      await expect.poll(probeWidth).toBeLessThanOrEqual(1500 - 437);
      // Narrower than 1417 px: the panel floats over the page with its shadow.
      await page.setViewportSize({ width: 1400, height: 900 });
      await expect.poll(probeWidth).toBeGreaterThan(1400 - 437);
      await expect(panel).not.toHaveCSS('box-shadow', 'none');
      await page.setViewportSize({ width: 1280, height: 720 });

      // Opening a class's chart while scrolled down keeps the panel where it
      // was (it used to jump back to the top).
      await page.setViewportSize({ width: 1280, height: 480 });
      const panelBody = panel.locator('main.body');
      await panel.locator('.class', { hasText: 'United States History' }).locator('button.class-toggle').scrollIntoViewIfNeeded();
      await panelBody.evaluate((el) => { el.scrollTop += 40; });
      const scrolledTo = await panelBody.evaluate((el) => el.scrollTop);
      expect(scrolledTo).toBeGreaterThan(100);
      await panel.locator('.class', { hasText: 'United States History' }).locator('button.class-toggle').click();
      await expect(panel.locator('.class.open', { hasText: 'United States History' })).toBeVisible();
      expect(Math.abs((await panelBody.evaluate((el) => el.scrollTop)) - scrolledTo)).toBeLessThanOrEqual(2);
      await panel.locator('.class', { hasText: 'United States History' }).locator('button.class-toggle').click();
      // With another class's chart open above, opening this one closes that
      // chart: the clicked row stays put on screen instead of jumping up.
      await panel.locator('.class', { hasText: 'Algebra 2' }).locator('button.class-toggle').click();
      await expect(panel.locator('.class.open', { hasText: 'Algebra 2' })).toBeVisible();
      const ush = panel.locator('.class', { hasText: 'United States History' }).locator('.class-head');
      await ush.scrollIntoViewIfNeeded();
      const rowBefore = (await ush.boundingBox()).y;
      await ush.click();
      await expect(panel.locator('.class.open', { hasText: 'United States History' })).toBeVisible();
      expect(Math.abs((await ush.boundingBox()).y - rowBefore)).toBeLessThanOrEqual(2);
      await ush.click();
      await page.setViewportSize({ width: 1280, height: 720 });

      // Class and assignment links open in this same tab, not a new one.
      const pagesBefore = context.pages().length;
      await panel.locator('.class', { hasText: 'Algebra 2' }).locator('button.class-toggle').click();
      await panel.locator('.class', { hasText: 'Algebra 2' }).locator('a.chart-link').click();
      await expect(page).toHaveURL(`${mockBase}/course/1001/student_grades`);
      expect(context.pages().length).toBe(pagesBefore);

      // Emailing the teacher is for parents: a student gets no envelope.
      await expect(panel.locator('.missing-card').first()).toBeVisible({ timeout: 15000 });
      await expect(panel.locator('.missing-card .mail-btn')).toHaveCount(0);
      await page.close();
    } finally {
      await context.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('refreshes by itself when a Schoology page loads, with banner, progress and a disabled button', async () => {
    // A slow mock (like real Schoology) so the in-progress state is visible.
    const slow = await startServer(0, { delayMs: 700 });
    const slowBase = slow.url.replace('127.0.0.1', 'localhost');
    const userDataDir = freshUserDataDir();
    const { context, extensionId, worker } = await launchWithExtension(userDataDir);
    try {
      await loginAs(context, 'parent', slowBase);
      await configureExtension(context, extensionId, worker, slowBase);

      // Just open Schoology: no Refresh click.
      const page = await context.newPage();
      await page.goto(`${slowBase}/home`);
      const panel = page.locator('#sgd-panel-host aside.sheet');
      await expect(panel.getByText('Refreshing grades…')).toBeVisible({ timeout: 15000 });
      await expect(panel.getByRole('progressbar', { name: 'Refresh progress' })).toBeVisible();
      const busyButton = panel.getByRole('button', { name: 'Refreshing grades' });
      await expect(busyButton).toBeDisabled();
      await expect(panel.locator('.refreshing-step')).toContainText(/of \d/);

      // A second Schoology page that loads mid-refresh may show the wrong
      // child (the refresh switches "viewing as"): it gets a reload notice.
      const during = await context.newPage();
      await during.goto(`${slowBase}/home`);

      // When it finishes: data in, banner gone, button back.
      await expect(panel.getByRole('tab', { name: 'Sam' })).toBeVisible({ timeout: 30000 });
      await expect(panel.getByText('Refreshing grades…')).toBeHidden({ timeout: 30000 });
      await expect(panel.getByRole('button', { name: 'Refresh grades' })).toBeEnabled();
      await expect(during.locator('#sgd-panel-host .notice')).toBeVisible({ timeout: 10000 });
      await expect(during.locator('#sgd-panel-host .notice').getByRole('button', { name: 'Reload page' })).toBeVisible();
      await expect(page.locator('#sgd-panel-host .notice')).toBeHidden(); // loaded before the refresh began
      await during.close();

      // Fresh data: loading another Schoology page does not refresh again.
      const before = await worker.evaluate(async () => Object.entries(await chrome.storage.local.get(null)).find(([k]) => k.startsWith('refreshState@'))[1].startedAt);
      await page.goto(`${slowBase}/home`);
      await expect(panel.getByRole('tab', { name: 'Sam' })).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(1500);
      const after = await worker.evaluate(async () => Object.entries(await chrome.storage.local.get(null)).find(([k]) => k.startsWith('refreshState@'))[1].startedAt);
      expect(after).toBe(before);
      await page.close();
    } finally {
      await context.close();
      await slow.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('parent persona: TWO child dashboards — Sam NO-GO, Jamie GO, submitted work waiting', async () => {
    const userDataDir = freshUserDataDir();
    const { context, extensionId, worker } = await launchWithExtension(userDataDir);
    try {
      await loginAs(context, 'parent');
      await configureExtension(context, extensionId, worker);
      await triggerRefresh(context, extensionId);

      const popup = await openPopup(context, extensionId);
      // One child at a time, picked with the tabs at the top.
      const samTab = popup.getByRole('tab', { name: 'Sam' });
      const jamieTab = popup.getByRole('tab', { name: 'Jamie' });
      await expect(samTab).toBeVisible({ timeout: 15000 });
      await expect(samTab).toHaveAttribute('aria-selected', 'true');
      const card = popup.locator('.card');
      // Sam: 2 Missing + lowest class 55% => NO-GO.
      await expect(card.getByText('Sam Rivera', { exact: true })).toBeVisible();
      // NO-GO replaces Sam's picture with the NO-GO circle; no separate badge.
      await expect(card.getByRole('img', { name: 'NO-GO' })).toBeVisible();
      await expect(card.locator('.avatar:not(.nogo-circle)')).toHaveCount(0);
      await expect(card.locator('.pill')).toHaveCount(0);
      // Sam's essay is marked Missing but has a submission: it waits on the
      // teacher and does not count as Missing.
      await expect(popup.getByText('Missing · 1')).toBeVisible();
      await expect(popup.locator('.missing-card', { hasText: 'Unit 2 Essay' })).toBeVisible();
      // Compact metrics: only non-zero counts; no class chips (Classes shows those).
      const samStats = card.locator('.stat');
      await expect(samStats.filter({ hasText: 'Missing' })).toHaveText(/^1\s*Missing$/);
      await expect(samStats.filter({ hasText: 'American Literature' })).toHaveCount(0);
      // Parent class links open that child's class grades via Schoology's preview link.
      await popup.locator('.class', { hasText: 'American Literature' }).locator('button.class-toggle').click();
      await expect(popup.locator('.class', { hasText: 'American Literature' }).locator('a.chart-link'))
        .toHaveAttribute('href', /\/course\/\d+\/preview\/2000001\/parent\?url=course\/\d+\/student_grades$/);
      // Submitted, not graded yet: grouped by class, with a count per class.
      await expect(popup.locator('.wait-class .wait-h').first()).toHaveText(/ · \d+$/);
      const samEssay = popup.locator('.waiting', { hasText: 'Persuasive Essay Draft' });
      await expect(samEssay).toBeVisible();
      // Still marked Missing on Schoology: Schoology's Missing icon + "Missing".
      await expect(samEssay.locator('.missing-tag')).toHaveText('Missing');
      await expect(samEssay.locator('.missing-tag img.missing-icon')).toBeVisible();
      // Classes leave out sections with no grade data (House Group 1).
      await expect(popup.locator('.class', { hasText: 'United States History' })).toBeVisible();
      await expect(popup.locator('.class', { hasText: 'House Group 1' })).toHaveCount(0);
      // Records: personal bests saved with the refresh (they only go up).
      await expect(popup.locator('.sec-h', { hasText: 'Records' })).toBeVisible();
      await expect(popup.locator('.record', { hasText: 'Highest score' })).toHaveCount(0); // shown per class now
      await expect(popup.locator('.record', { hasText: 'Highest class grade' })).toBeVisible();
      expect(await worker.evaluate(async () => Object.keys(Object.entries(await chrome.storage.local.get(null)).find(([k]) => k.startsWith('records@'))?.[1] || {}).length)).toBe(2);
      // Jamie: 1 Missing, all classes >= 90 => GO.
      await jamieTab.click();
      await expect(card.getByText('Jamie Rivera', { exact: true })).toBeVisible();
      // GO keeps the picture and gets no badge; the tab dot still shows green.
      await expect(card.locator('.pill')).toHaveCount(0);
      await expect(card.locator('.nogo-circle')).toHaveCount(0);
      await expect(popup.getByText('Missing · 1')).toBeVisible();
      await expect(popup.getByText('Poetry Analysis Essay')).toBeVisible();
      // A parent's Family rules take effect: with a Missing limit of 1,
      // Jamie's one Missing item is NO-GO, so the circle replaces the picture.
      await worker.evaluate(async () => {
        const { settings } = await chrome.storage.local.get('settings');
        await chrome.storage.local.set({ settings: { ...settings, missingThreshold: 1 } });
      });
      await expect(card.locator('.nogo-circle')).toBeVisible();
      await worker.evaluate(async () => {
        const { settings } = await chrome.storage.local.get('settings');
        await chrome.storage.local.set({ settings: { ...settings, missingThreshold: 2 } });
      });
      await expect(card.locator('.nogo-circle')).toHaveCount(0);
      // Share: the picture goes to the clipboard and the system share menu
      // (stubbed here: headless Chromium has none). When the share menu
      // needs a fresh click, a second press shares the finished picture.
      // Not in Firefox: there the dashboard is the panel's content script,
      // which can't see a navigator.share stubbed by the page (Firefox keeps
      // the two apart), and Firefox has no share menu to fall back on.
      if (!isFirefox()) await shareFromPopup(popup);
      // Shared "07" prefixes are dropped from class names.
      await expect(popup.locator('.class .class-name')).toHaveText(['English', 'Math']);
      // The picked child is remembered: a fresh popup (or a page load) stays on Jamie.
      const again = await openPopup(context, extensionId);
      await expect(again.getByRole('tab', { name: 'Jamie' })).toHaveAttribute('aria-selected', 'true', { timeout: 15000 });
      await expect(again.locator('.card').getByText('Jamie Rivera', { exact: true })).toBeVisible();
      await again.close();
      await popup.close();

      // Email the teacher (parents only). Sam's class lists two admins (its
      // teacher and a department admin on every class), so the panel asks
      // which one, with the likely teacher preselected. The message goes
      // to that one teacher, filled in and unsent.
      const page = await context.newPage();
      await page.goto(`${mockBase}/home`);
      const panel = page.locator('#sgd-panel-host aside.sheet');
      await panel.getByRole('tab', { name: 'Sam' }).click();
      const essay = panel.locator('.missing-card', { hasText: 'Unit 2 Essay' });
      await expect(essay).toBeVisible({ timeout: 15000 });
      let posted = false;
      page.on('request', (r) => { if (r.method() === 'POST' && /messages/.test(r.url())) posted = true; });
      const mail = essay.getByRole('button', { name: /^Message the .* teacher about / });
      await mail.click();
      const chooser = panel.getByRole('group', { name: 'Email which teacher?' });
      await expect(chooser).toBeVisible();
      await expect(chooser.locator('.tc-name')).toHaveText(['Mr. Ortiz', 'Ms. Park']);
      await expect(chooser.getByRole('radio', { name: /Ms\. Park/ })).toBeChecked();
      await expect(chooser.locator('.tc-opt', { hasText: 'Ms. Park' })).toContainText('Likely teacher');
      await chooser.getByRole('button', { name: 'Cancel' }).click();
      await expect(chooser).toHaveCount(0);
      await mail.click();
      await panel.getByRole('group', { name: 'Email which teacher?' }).getByRole('button', { name: 'Write email' }).click();
      await expect(page).toHaveURL(/\/parent\/messages\/new\/course\/3001\?recipient_uids=9301$/);
      await expect(page.locator('.to')).toHaveText('To: Ms. Park');
      await expect(page.locator('input[name="subject"]')).toHaveValue(/^Unit 2 Essay.* - marked missing$/);
      await expect(page.locator('textarea[name="body"]')).toHaveValue(/what Sam needs to do to turn it in\?\n\nSincerely,/);
      expect(posted).toBe(false);
      // The pick is remembered for that class and preselected next time.
      await page.goto(`${mockBase}/home`);
      await panel.locator('.missing-card', { hasText: 'Unit 2 Essay' }).getByRole('button', { name: /^Message the / }).click();
      await expect(panel.locator('.tc-opt', { hasText: 'Ms. Park' })).toContainText('Last emailed');
      await expect(panel.getByRole('radio', { name: /Ms\. Park/ })).toBeChecked();
      await page.close();
    } finally {
      await context.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});
