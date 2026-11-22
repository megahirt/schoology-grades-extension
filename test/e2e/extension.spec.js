// extension.spec.js — Playwright e2e for the Grades Dashboard extension.
//
// Extension wiring only. The features (dashboard, panel, refresh, people,
// settings) are tested once, on the web build, in Safari, Chrome and
// Firefox: see test/web/ and test/README.md. These tests load the real
// unpacked DEV build (dist/, `npm run build:dev`), start the mock Schoology
// server, point the extension at it via settings.schoologyBase, and check
// what only the real extension has: the background refresh filling
// chrome.storage, the dashboard page and the in-page panel; reading through
// an open Schoology page when background requests are turned away; and the
// toolbar popup.
//
// Tests run in Chromium and Firefox (two Playwright projects, see
// playwright.config.js). Chromium loads dist/ with --load-extension; Firefox
// loads dist-firefox/ (`npm run build:firefox`) as a temporary add-on over
// its debugger protocol (firefox-addon.js). Playwright's Firefox can't open
// moz-extension:// pages, so in Firefox "the popup" is the same dashboard
// in the in-page panel on a mock Schoology page, storage is read and
// written in the add-on's background page, and the tests that need an
// extension page are skipped. Safari can't be automated here; see
// test/README.md.
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
// The toolbar popup now only links to Schoology; the full dashboard page
// (popup/dashboard.html) is what these tests drive as "the popup".
const POPUP_PAGE = 'popup/dashboard.html';
const TOOLBAR_POPUP = MANIFEST.action?.default_popup || 'popup/popup.html';

let mock;
let mockBase; // http://localhost:<port> — the DEV build's host permission is
// http://localhost/*, which does NOT match 127.0.0.1, so the extension
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

  // Extension wiring only: the features themselves are tested once, on the
  // web build, in Safari, Chrome and Firefox (test/web/). This checks the
  // real extension puts them together: the background refresh reads the
  // mock Schoology, saves to chrome.storage, and both the dashboard page and
  // the panel the content script adds to Schoology pages show the result.
  test('extension wiring: background refresh fills the dashboard page and the in-page panel', async () => {
    const userDataDir = freshUserDataDir();
    const { context, extensionId, worker } = await launchWithExtension(userDataDir);
    try {
      await loginAs(context, 'parent');
      await configureExtension(context, extensionId, worker);
      await triggerRefresh(context, extensionId);

      // The background saved both children for this Schoology site (the
      // key is "dashboards@<origin>#<signed-in user>").
      const site = new URL(mockBase).origin;
      const dashboards = await worker.evaluate(async (prefix) => Object.entries(await chrome.storage.local.get(null)).find(([k]) => k.startsWith(prefix))?.[1], `dashboards@${site}`);
      expect(Object.keys(dashboards || {})).toHaveLength(2);

      // The dashboard page (Chromium) or the panel (Firefox) shows them.
      const popup = await openPopup(context, extensionId);
      await expect(popup.getByRole('tab', { name: 'Sam' })).toBeVisible({ timeout: 15000 });
      await expect(popup.locator('.card').getByText('Sam Rivera', { exact: true })).toBeVisible();
      await expect(popup.getByRole('tab', { name: 'Jamie' })).toBeVisible();
      await popup.close();

      // The content script's panel on a Schoology page shows them too.
      const page = await context.newPage();
      await page.goto(`${mockBase}/home`);
      const panel = page.locator('#sgd-panel-host aside.sheet');
      await expect(panel.getByRole('tab', { name: 'Sam' })).toBeVisible({ timeout: 15000 });
      await expect(panel.locator('.card').getByText('Sam Rivera', { exact: true })).toBeVisible();
      await expect(panel.getByRole('tab', { name: 'Jamie' })).toBeVisible();
      await page.close();
    } finally {
      await context.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  // Safari sends the background worker's requests to Schoology without the
  // sign-in (seen live). The mock's page-only switch does the same here: the
  // worker is answered with the sign-in page, and only a request from one of
  // the site's own pages is signed in. The extension must then read through
  // the open Schoology page (extension/src/page-fetch.js).
  // how 'fail': the worker's request fails outright, as when a school sends
  // signed-out requests on to its own sign-in on another site (seen live:
  // a school using Microsoft sign-in showed "Couldn't reach Schoology").
  for (const how of ['login', 'fail']) test(`background requests ${how === 'fail' ? 'fail' : 'signed out'} (as in Safari): reads through the open Schoology page`, async () => {
    // Chromium only: the mock tells the worker's requests from a page's by
    // their Sec-Fetch headers, and Firefox sends its background requests
    // with the same ones as a page's (same-origin). The code under test has
    // no browser check, so one browser covers it.
    test.skip(isFirefox(), 'The mock cannot tell Firefox background requests from page requests.');
    const userDataDir = freshUserDataDir();
    const { context, extensionId, worker } = await launchWithExtension(userDataDir);
    const site = new URL(mockBase).origin;
    try {
      await loginAs(context, 'parent');
      await configureExtension(context, extensionId, worker);
      await fetch(`${mock.url}/__mock/page-only?on=1&how=${how}`);
      // The worker itself really is turned away.
      expect(await worker.evaluate(async (u) => fetch(u, { credentials: 'include' }).then((r) => r.url, () => 'failed'), `${site}/iapi/parent/info`)).toBe(how === 'fail' ? 'failed' : `${site}/login`);

      // A Schoology page loads: the refresh it starts reads through that page.
      const page = await context.newPage();
      await page.goto(`${mockBase}/home`);
      const panel = page.locator('#sgd-panel-host aside.sheet');
      await expect(panel.getByRole('tab', { name: 'Sam' })).toBeVisible({ timeout: 30000 });
      await expect(panel.getByRole('tab', { name: 'Jamie' })).toBeVisible();
      await expect(panel.locator('.card').getByText('Sam Rivera', { exact: true })).toBeVisible();
      await expect(panel.locator('.signed-out')).toHaveCount(0);
      await expect(panel.getByText('Please log in to Schoology')).toHaveCount(0);
      expect(await worker.evaluate(async (k) => (await chrome.storage.local.get(k))[k], `user@${site}`)).toMatchObject({ type: 'parent', signedOut: false });

      // The Refresh button works the same way while the page is open.
      const refresh = panel.getByRole('button', { name: 'Refresh grades' });
      await expect(refresh).toBeEnabled({ timeout: 30000 });
      await refresh.click();
      await expect(refresh).toBeEnabled({ timeout: 30000 });
      await expect(panel.getByRole('tab', { name: 'Jamie' })).toBeVisible();
      await expect(panel.locator('.signed-out')).toHaveCount(0);
      await page.close();
    } finally {
      await fetch(`${mock.url}/__mock/page-only?on=0`);
      await context.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  // After an update, background.js sets whatsNewPending; the dashboard then
  // shows this version's notes from RELEASE_NOTES.md once (dev builds: the
  // newest section), until Got it. Set directly here: an update can't be
  // made to happen in a test.
  test("What's new shows once after an update, from RELEASE_NOTES.md", async () => {
    const userDataDir = freshUserDataDir();
    const { context, extensionId, worker } = await launchWithExtension(userDataDir);
    try {
      await loginAs(context, 'student');
      await configureExtension(context, extensionId, worker);
      await worker.evaluate(() => chrome.storage.local.set({ whatsNewPending: { version: '9.9.9' } }));
      const popup = await openPopup(context, extensionId);
      const dialog = popup.getByRole('dialog', { name: /^What's new in version \d+\.\d+\.\d+$/ });
      await expect(dialog).toBeVisible({ timeout: 15000 });
      // A list per section (New, Fixed), each item starting with its emoji.
      await expect(dialog.locator('.wn-h').first()).toHaveText('✨ New');
      await expect(dialog.locator('.wn-list li').first()).toHaveText(/^\p{Extended_Pictographic}/u);
      // Pictures of buttons come along (data: URLs, nothing to fetch).
      await expect(dialog.getByRole('img', { name: 'Print button' })).toHaveAttribute('src', /^data:image\/png;base64,/);
      await dialog.getByRole('button', { name: 'Got it' }).click();
      await expect(dialog).toHaveCount(0);
      expect(await worker.evaluate(async () => (await chrome.storage.local.get('whatsNewPending')).whatsNewPending ?? null)).toBe(null);
      await popup.close();
      // Not again.
      const again = await openPopup(context, extensionId);
      await expect(again.locator('.card, .empty, .setup').first()).toBeVisible({ timeout: 15000 }).catch(() => {});
      await expect(again.getByRole('dialog')).toHaveCount(0);
      await again.close();
    } finally {
      await context.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('toolbar popup: only the Schoology addresses, as links, no second dashboard', async () => {
    test.skip(isFirefox(), "Playwright's Firefox can't open moz-extension:// pages (the popup).");
    const userDataDir = freshUserDataDir();
    const { context, extensionId } = await launchWithExtension(userDataDir);
    try {
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/${TOOLBAR_POPUP}`);
      await expect(popup.getByText('The dashboard shows on these Schoology pages:')).toBeVisible();
      const links = popup.locator('#sites a');
      await expect(links).toHaveText(['app.schoology.com', 'schoology.npchristian.org']);
      await expect(links.first()).toHaveAttribute('href', 'https://app.schoology.com/');
      await expect(popup.locator('.sgd')).toHaveCount(0); // no dashboard in the popup
      // "See a demo" opens the full dashboard page, where demo data loads.
      const [demo] = await Promise.all([context.waitForEvent('page'), popup.getByRole('link', { name: 'See a demo' }).click()]);
      await expect(demo).toHaveURL(/\/popup\/dashboard\.html$/);
      await expect(demo.getByRole('button', { name: 'Show demo data' })).toBeVisible();
    } finally {
      await context.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('Overdue leaves out work its own page says can\'t be submitted online', async () => {
    const userDataDir = freshUserDataDir();
    const { context, extensionId, worker } = await launchWithExtension(userDataDir);
    try {
      await loginAs(context, 'student');
      await configureExtension(context, extensionId, worker);
      const page = await context.newPage();
      await page.goto(`${mockBase}/home`);
      const panel = page.locator('#sgd-panel-host aside.sheet');
      const overdue = panel.locator('.overdue-list');
      await expect(overdue).toContainText('Primary Source Notes', { timeout: 30000 });
      await expect(overdue).not.toContainText('Field Trip Form');
      const known = await worker.evaluate(async () => Object.entries(await chrome.storage.local.get(null)).find(([k]) => k.startsWith('noSubmissions@'))?.[1]);
      expect(Object.keys(known || {})).toEqual(['5203']);
      await page.close();
    } finally {
      await context.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('a parent opening a child\'s class page doesn\'t start a refresh', async () => {
    // Schoology names the child as the page's user there, not the parent.
    const userDataDir = freshUserDataDir();
    const { context, extensionId, worker } = await launchWithExtension(userDataDir);
    try {
      await loginAs(context, 'parent');
      await configureExtension(context, extensionId, worker);
      const page = await context.newPage();
      await page.goto(`${mockBase}/home`);
      const panel = page.locator('#sgd-panel-host aside.sheet');
      await expect(panel.getByRole('tab', { name: 'Sam' })).toBeVisible({ timeout: 30000 });
      await expect(panel.locator('.refresh-line, .refreshing')).toHaveCount(0, { timeout: 30000 });
      const state = () => worker.evaluate(async () => {
        const all = await chrome.storage.local.get(null);
        const pick = (p) => Object.entries(all).find(([k]) => k.startsWith(p))?.[1] || {};
        return { started: pick('refreshState@').startedAt, uid: pick('user@').uid };
      });
      const before = await state();
      const preview = await panel.locator('a[href*="/preview/"]').first().getAttribute('href');
      expect(preview).toBeTruthy();
      await page.goto(new URL(preview, mockBase).href);
      await expect(panel.getByRole('tab', { name: 'Sam' })).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(2000);
      expect(await state()).toEqual(before);
      await page.close();
    } finally {
      await context.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});
