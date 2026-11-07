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
  async function loginAs(context, persona) {
    const page = await context.newPage();
    await page.goto(`${mockBase}/login?as=${persona}`);
    await page.fill('#username', 'testuser');
    await page.fill('#password', 'testpass');
    await page.click('#login-submit');
    await expect(page).toHaveURL(`${mockBase}/home`);
    await page.close();
  }

  // Point the extension at the mock server and enable the GO/NO-GO badge
  // (student view hides it by default unless a parent enables it).
  // The options-page evaluate occasionally throws a transient Chromium
  // storage IO error on a fresh profile, so retry a few times; if it keeps
  // failing, write the same settings via the background service worker
  // (same storage, same result) while the options page stays open.
  async function configureExtension(context, extensionId, worker) {
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
        }, mockBase);
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
      }, mockBase);
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

  test('student persona: 1 Missing, NO-GO (68% class below 75)', async () => {
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
      const card = popup.locator('.card');
      await expect(card.getByText('Alex Student', { exact: true })).toBeVisible();
      await expect(card.getByText('NO-GO', { exact: true })).toBeVisible();
      await expect(card.getByText('1 missing · Algebra 2 below 75%')).toBeVisible();
      await expect(popup.getByText('Missing · 1')).toBeVisible();
      await expect(popup.getByText('Persuasive Essay Draft')).toBeVisible();
      const algebra = popup.locator('.class', { hasText: 'Algebra 2' });
      await expect(algebra).toBeVisible();
      await expect(algebra.getByText('68%')).toBeVisible();

      // "Turned in" moves the Missing item to Waiting on teacher; Undo moves it back.
      await popup.getByRole('button', { name: 'Turned in' }).click();
      await expect(popup.getByText('Missing · 0')).toBeVisible();
      await expect(popup.getByText('Waiting on teacher · 1')).toBeVisible();
      await expect(popup.locator('.waiting').getByText('Persuasive Essay Draft')).toBeVisible();
      await popup.getByRole('button', { name: 'Undo: Persuasive Essay Draft' }).click();
      await expect(popup.getByText('Missing · 1')).toBeVisible();
      await expect(popup.getByText('Waiting on teacher · 0')).toBeVisible();
      await popup.close();
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
      await expect(panel.locator('.card').getByText('NO-GO', { exact: true })).toBeVisible();
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
      // The closed tab shows the verdict at a glance.
      await expect(tab).toHaveAttribute('aria-label', /Alex Student: NO-GO/);
      await tab.click();
      await expect(panel.getByRole('heading', { name: 'Hi, Alex', exact: true })).toBeVisible();
      await page.close();
    } finally {
      await context.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('parent persona: TWO child dashboards — Sam NO-GO, Jamie GO', async () => {
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
      await expect(card.getByText('NO-GO', { exact: true })).toBeVisible();
      await expect(popup.getByText('Missing · 2')).toBeVisible();
      await expect(popup.getByText('Persuasive Essay Draft')).toBeVisible();
      await expect(popup.getByText('Unit 2 Essay')).toBeVisible();
      // Classes leave out sections with no grade data (House Group 1).
      await expect(popup.locator('.class', { hasText: 'United States History' })).toBeVisible();
      await expect(popup.locator('.class', { hasText: 'House Group 1' })).toHaveCount(0);
      // Jamie: 1 Missing, all classes >= 90 => GO.
      await jamieTab.click();
      await expect(card.getByText('Jamie Rivera', { exact: true })).toBeVisible();
      await expect(card.getByText('GO', { exact: true })).toBeVisible();
      await expect(popup.getByText('Missing · 1')).toBeVisible();
      await expect(popup.getByText('Poetry Analysis Essay')).toBeVisible();
      await popup.close();
    } finally {
      await context.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});
