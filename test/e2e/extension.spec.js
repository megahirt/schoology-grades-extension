// extension.spec.js — Playwright e2e for the Schoology Dashboard extension.
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
// Tests run in Chromium via Playwright. Safari cannot be automated here —
// the Safari build is verified separately (see test/README.md). The extension
// itself is Safari-first; these e2e tests only prove the shared logic in
// Chromium.
//
// If the DEV build does not exist yet (the extension workstream is still
// building it), the whole file skips gracefully instead of faking a pass —
// see the beforeAll check. Run `npm run build:dev` first.

import { test, expect, chromium } from '@playwright/test';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../mock-server/server.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// The DEV build output: `npm run build:dev` writes to dist/ (with the
// localhost host permission added); dist-dev/ is accepted as a fallback if
// the build script is ever changed to use it (as SPEC.md originally said).
const DIST_CANDIDATES = [path.join(REPO_ROOT, 'dist'), path.join(REPO_ROOT, 'dist-dev')];
const DIST_DIR = DIST_CANDIDATES.find((d) => existsSync(path.join(d, 'manifest.json')));
const HAS_DEV_BUILD = Boolean(DIST_DIR);
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

test.describe('Schoology Dashboard extension (mock Schoology)', () => {
  test.beforeEach(async () => {
    test.skip(!HAS_DEV_BUILD, 'DEV build (dist/) not present yet — run `npm run build:dev` first.');
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
        const { dashboards = {} } = await page.evaluate(() => chrome.storage.local.get('dashboards'));
        return Object.keys(dashboards).length;
      },
      { timeout: 30000 },
    ).toBeGreaterThan(0);
    await page.close();
  }

  async function openPopup(context, extensionId) {
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
      // GO/NO-GO is for parents only: a student sees what to finish first.
      const card = popup.locator('.card');
      await expect(card.getByText('2 things to finish first')).toBeVisible();
      await expect(card).toContainText('bring Algebra 2 up past 75% this quarter');
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
      // Clicking the class name opens its grade chart (dots + class-grade line),
      // with the link to the class in Schoology; clicking again closes it.
      await algebra.locator('button.class-toggle').click();
      await expect(algebra.locator('button.class-toggle')).toHaveAttribute('aria-expanded', 'true');
      await expect(algebra.locator('svg.gchart')).toBeVisible();
      await expect(algebra.locator('svg.gchart .gc-dot')).toHaveCount(2); // the two graded Algebra 2 items
      await expect(algebra.locator('svg.gchart .gc-pass')).toHaveCount(1); // dashed passing line
      await expect(algebra.locator('a.chart-link')).toHaveAttribute('href', `${mockBase}/course/1001/student_grades`);
      // Desktop hover shows the class grade at that moment.
      const box = await algebra.locator('svg.gchart .gc-hit').boundingBox();
      await popup.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2);
      await expect(algebra.locator('svg.gchart .gc-hover')).toHaveAttribute('visibility', 'visible');
      await expect(algebra.locator('svg.gchart .gc-tip')).toContainText('Quarter 2');
      await algebra.locator('.bar-toggle').click(); // the bar toggles too
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
      await expect(journal).toContainText('Submitted, not graded yet');
      await expect(journal.getByRole('button', { name: /Undo/ })).toHaveCount(0);
      await expect(journal.locator('.missing-tag')).toHaveCount(0); // submitted, but not marked Missing

      // "Turned in" moves the Missing item to Waiting on teacher; Undo moves it back.
      await popup.getByRole('button', { name: 'Turned in' }).click();
      // With nothing left, the Missing section disappears entirely.
      await expect(popup.locator('.sec-h', { hasText: 'Missing' })).toHaveCount(0);
      await expect(popup.getByText('Waiting on teacher · 2')).toBeVisible();
      await expect(popup.locator('.waiting', { hasText: 'Persuasive Essay Draft' })).toContainText('Marked turned in');
      await expect(popup.getByText('Marking something done or turned in is for your own use — nobody is notified.')).toBeVisible();
      await popup.getByRole('button', { name: 'Undo: Persuasive Essay Draft' }).click();
      await expect(popup.getByText('Missing · 1')).toBeVisible();
      await expect(popup.getByText('Waiting on teacher · 1')).toBeVisible();
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

  test('settings page: one auto-saving page; changing a rule takes effect', async () => {
    const userDataDir = freshUserDataDir();
    const { context, extensionId, worker } = await launchWithExtension(userDataDir);
    try {
      await loginAs(context, 'student');
      await configureExtension(context, extensionId, worker);
      await triggerRefresh(context, extensionId);

      const opts = await context.newPage();
      await opts.goto(`chrome-extension://${extensionId}/${OPTIONS_PAGE}`);
      await expect(opts.getByRole('heading', { name: 'Homework Dashboard settings' })).toBeVisible();
      await expect(opts.locator('#account-title')).toHaveText('Connected as a student');
      for (const name of ['Account', 'Family rules', 'Display', 'Privacy & data']) {
        await expect(opts.getByRole('heading', { name, exact: true })).toBeVisible();
      }
      await expect(opts.getByRole('heading', { name: 'Classes', exact: true })).toHaveCount(0); // no class switches
      await expect(opts.getByRole('heading', { name: 'Developer' })).toBeVisible(); // dev build
      // Only classes with grades posted count (Advisory 11 has none).
      await expect(opts.locator('.kid')).toContainText('3 classes');

      const popup = await openPopup(context, extensionId);
      await expect(popup.getByRole('heading', { name: 'Hi, Alex', exact: true })).toBeVisible({ timeout: 15000 });
      await expect(popup.locator('.class', { hasText: 'Advisory 11' })).toHaveCount(0);
      await expect(popup.locator('.card')).toContainText('bring Algebra 2 up past 75%');

      // Passing grade 85: American Literature (82%) now needs work too. Saved automatically.
      await opts.locator('#grade-threshold').fill('85');
      await opts.locator('#grade-threshold').press('Tab');
      await expect.poll(async () => (await opts.evaluate(() => chrome.storage.local.get('settings'))).settings.gradeThreshold).toBe(85);
      await expect(popup.locator('.card')).toContainText('bring American Literature up past 85%');
      await popup.close();
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
      await expect(panel.locator('.card')).toContainText('things to finish first');
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
      await expect(tab).toHaveAttribute('aria-label', /^Show homework dashboard\. Alex Student: 1 missing/);
      await expect(tab).not.toHaveAttribute('aria-label', /NO-GO/);
      await expect(tab.locator('.kid-pic')).toHaveCount(1);
      await expect(tab.locator('.kid-m').first()).toHaveText('1'); // Schoology Missing icon + 1
      await expect(tab.locator('.nogo-circle')).toHaveCount(0);
      await tab.click();
      await expect(panel.getByRole('heading', { name: 'Hi, Alex', exact: true })).toBeVisible();

      // Class and assignment links open in this same tab, not a new one.
      const pagesBefore = context.pages().length;
      await panel.locator('.class', { hasText: 'Algebra 2' }).locator('button.class-toggle').click();
      await panel.locator('.class', { hasText: 'Algebra 2' }).locator('a.chart-link').click();
      await expect(page).toHaveURL(`${mockBase}/course/1001/student_grades`);
      expect(context.pages().length).toBe(pagesBefore);
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
      const before = await worker.evaluate(async () => (await chrome.storage.local.get('refreshState')).refreshState.startedAt);
      await page.goto(`${slowBase}/home`);
      await expect(panel.getByRole('tab', { name: 'Sam' })).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(1500);
      const after = await worker.evaluate(async () => (await chrome.storage.local.get('refreshState')).refreshState.startedAt);
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
      const samEssay = popup.locator('.waiting', { hasText: 'Persuasive Essay Draft' });
      await expect(samEssay).toContainText('Submitted, not graded yet');
      // Still marked Missing on Schoology: Schoology's Missing icon + "Missing".
      await expect(samEssay.locator('.missing-tag')).toHaveText('Missing');
      await expect(samEssay.locator('.missing-tag img.missing-icon')).toBeVisible();
      // Classes leave out sections with no grade data (House Group 1).
      await expect(popup.locator('.class', { hasText: 'United States History' })).toBeVisible();
      await expect(popup.locator('.class', { hasText: 'House Group 1' })).toHaveCount(0);
      // Jamie: 1 Missing, all classes >= 90 => GO.
      await jamieTab.click();
      await expect(card.getByText('Jamie Rivera', { exact: true })).toBeVisible();
      // GO keeps the picture and gets no badge; the tab dot still shows green.
      await expect(card.locator('.pill')).toHaveCount(0);
      await expect(card.locator('.nogo-circle')).toHaveCount(0);
      await expect(popup.getByText('Missing · 1')).toBeVisible();
      await expect(popup.getByText('Poetry Analysis Essay')).toBeVisible();
      // Shared "07" prefixes are dropped from class names.
      await expect(popup.locator('.class .class-name')).toHaveText(['English', 'Math']);
      // The picked child is remembered: a fresh popup (or a page load) stays on Jamie.
      const again = await openPopup(context, extensionId);
      await expect(again.getByRole('tab', { name: 'Jamie' })).toHaveAttribute('aria-selected', 'true', { timeout: 15000 });
      await expect(again.locator('.card').getByText('Jamie Rivera', { exact: true })).toBeVisible();
      await again.close();
      await popup.close();
    } finally {
      await context.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});
