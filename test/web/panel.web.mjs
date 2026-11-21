// Web feature suite: the in-page panel on mock Schoology pages. Ported from
// test/e2e/extension.spec.js "in-page panel on a narrow screen closes when a
// link in it is opened" and "in-page panel on Schoology pages: open by
// default, closes, reopens, remembered", as two subtests in one browser
// session. "Remembered" is checked on the next page of the same origin
// (the web build keeps storage in that origin's localStorage). See
// test/web/helpers.mjs.
/* global shown */ // in page-side readers: see inDashboard (helpers.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  WAIT_PREFIX, clickDashboard, count, expectDashboard, inDashboard, realClickDashboard, refreshNow, shownCount,
  signIn, skipReason, useMock, visible, waitForPanel, withSession,
} from './helpers.mjs';

// The panel's widths, read from extension/src/panel.js (it can't be
// imported in Node: it imports CSS).
const PANEL_SRC = readFileSync(fileURLToPath(new URL('../../extension/src/panel.js', import.meta.url)), 'utf8');
const constant = (name) => Number(new RegExp(`export const ${name} = (\\d+);`).exec(PANEL_SRC)[1]);
const PANEL_WIDTH = constant('PANEL_WIDTH');
const DOCK_MIN_WIDTH = constant('SCHOOLOGY_MIN_WIDTH') + PANEL_WIDTH;
// panel.js closes the panel as a link in it opens when the window matches
// (max-width: 600px).
const NARROW_MAX = 600;

// Page-side readers (run by inDashboard as (root, q, ...args); root is the
// panel's sheet, or the document while there is no panel yet).
// The sheet is shown (null: no panel yet).
const sheetShown = (root) => (root === document ? null : shown(root));
// An attribute of the panel's edge tab (null: no panel yet).
const tabAttr = (root, q, name) => (root === document ? null : root.getRootNode().querySelector('.edge-tab')?.getAttribute(name) ?? null);
// Inside the edge tab: how many `sel`, or the first one's text.
const tabCount = (root, q, sel) => (root === document ? -1 : root.getRootNode().querySelectorAll(`.edge-tab ${sel}`).length);
const tabText = (root, q, sel) => (root === document ? null : root.getRootNode().querySelector(`.edge-tab ${sel}`)?.textContent.trim() ?? null);
// Click the edge tab.
const clickTab = (root) => {
  const tab = root === document ? null : root.getRootNode().querySelector('.edge-tab');
  tab?.click();
  return Boolean(tab);
};
// The heading "Hi, Alex" (exact) is shown in the panel.
const HEADING = 'h1, h2, h3, h4, h5, h6, [role="heading"]';
const helloShown = (root, q, sel) => root !== document && q(sel).some((e) => e.textContent.trim() === 'Hi, Alex' && shown(e));

async function windowWidth(browser, w, h) {
  await browser.setWindowSize(w, h);
  return browser.execute(() => window.innerWidth);
}

async function narrowScreenLink({ browser, base }) {
  const see = (read, expected, message, ...args) => expectDashboard(browser, read, expected, message, { args });
  await signIn(browser, base, 'student');
  await useMock(browser, base);
  await browser.url(`${base}/grades/grades`);
  await waitForPanel(browser, (t) => t !== null, { message: 'no panel: did the web build load?' });
  await refreshNow(browser, base);

  // The original's 420 px viewport. A window size includes the browser's
  // frame, and Safari may clamp it: what matters is that the page is narrow
  // enough for the panel's link rule (and so floats over Schoology).
  try {
    const inner = await windowWidth(browser, 400, 800);
    assert.ok(inner <= NARROW_MAX && inner < DOCK_MIN_WIDTH, `window.innerWidth ${inner} is not narrow (<= ${NARROW_MAX} px)`);
    await browser.refresh();
    await see(helloShown, true, 'Hi, Alex heading shown in the panel', HEADING);
    await realClickDashboard(browser, '.missing-card a.item-title', { hasText: 'Persuasive Essay Draft', navigatesTo: /\/assignment\/5101$/ });
    assert.match(await browser.getUrl(), /\/assignment\/5101$/);
    // The dashboard closed as the link opened, and stays closed on the next
    // page, so the assignment shows.
    await browser.waitUntil(async () => (await browser.execute(() => localStorage.getItem('sgd:panelOpen'))) === 'false', {
      timeout: 15_000, interval: 250, timeoutMsg: `${WAIT_PREFIX} panelOpen was not saved as false`,
    });
    // (The mock has no assignment pages, so there is no panel there to look at.)
  } finally {
    await browser.setWindowSize(1280, 900);
  }
}

async function openClosesRemembered({ browser, base }) {
  const see = (read, expected, message, ...args) => expectDashboard(browser, read, expected, message, { args });
  await browser.setWindowSize(1280, 900);
  await signIn(browser, base, 'student');
  await useMock(browser, base);
  await browser.url(`${base}/grades/grades`);
  await waitForPanel(browser, (t) => t !== null, { message: 'no panel: did the web build load?' });
  await refreshNow(browser, base);

  // Open by default.
  await see(helloShown, true, 'Hi, Alex heading shown in the panel', HEADING);
  await see(visible, true, 'Missing · 1 shown', 'Missing · 1');
  await see((root, q) => q('.card .card-name').map((e) => e.textContent.trim()), ['Alex Student'], 'card name');
  // The panel hides the demo button (demo data is a popup feature).
  await see((root, q) => q('button').filter((b) => /demo/i.test(b.getAttribute('aria-label') || b.textContent) && shown(b)).length, 0, 'no demo button shown');
  // The page's own grades table is untouched and still on the page.
  await see(() => shown(document.querySelector('.gradebook-course')), true, 'the page\'s grades table shown');

  await clickDashboard(browser, 'button', { label: /^Close dashboard panel$/ });
  await see(sheetShown, false, 'panel hidden after Close');
  await see(tabAttr, 'false', 'tab aria-expanded after Close', 'aria-expanded');

  // Closed state is remembered on the next Schoology page.
  await browser.url(`${base}/home`);
  await see(tabAttr, 'false', 'tab aria-expanded on the next page', 'aria-expanded');
  await see(sheetShown, false, 'panel hidden on the next page');
  // A student's closed tab shows the counts but no verdict (GO/NO-GO is for parents).
  await see(tabAttr, /^Show grades dashboard\. Alex Student: 1 missing/, 'tab label', 'aria-label');
  await see(tabAttr, (v) => typeof v === 'string' && !/NO-GO/.test(v), 'no NO-GO in the tab label', 'aria-label');
  await see(tabCount, 1, 'one picture in the tab', '.kid-pic');
  await see(tabText, '1', 'tab Missing count', '.kid-m'); // Schoology Missing icon + 1
  await see(tabCount, 0, 'no NO-GO circle in the tab', '.nogo-circle');
  await see(clickTab, true, 'no edge tab to click');
  await see(helloShown, true, 'Hi, Alex heading shown after reopening', HEADING);

  // Share copies a picture of the whole dashboard (taller than the visible
  // panel) to the clipboard. Adapted: WebDriver has no portable way to read
  // the clipboard (Safari asks the user before a page may read it), so the
  // page's clipboard.write is stubbed to keep the picture it is given, and
  // the share menu is taken away, as headless Chromium had none in the
  // original (Safari's would open a system sheet).
  await browser.execute(() => {
    window.__copied = null;
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    navigator.clipboard.write = async (items) => {
      const blob = await items[0].getType('image/png');
      const bmp = await createImageBitmap(blob);
      window.__copied = { type: blob.type, w: bmp.width, h: bmp.height };
    };
  });
  await clickDashboard(browser, 'button', { label: /^Share a picture of the dashboard$/ });
  await see(shownCount, 1, 'Copied button shown', 'button[aria-label="Copied"]');
  let shot = null;
  await browser.waitUntil(async () => (shot = await browser.execute(() => window.__copied)) !== null, {
    timeout: 15_000, interval: 250, timeoutMsg: `${WAIT_PREFIX} no picture was handed to the clipboard`,
  });
  assert.equal(shot.type, 'image/png');
  // The panel width plus a 16px margin each side, at 2×.
  assert.ok(Math.abs(shot.w - (PANEL_WIDTH + 2 * 16) * 2) <= 4, `picture width ${shot.w}`);
  const bodyHeight = await inDashboard(browser, (root) => root.querySelector('main.body').clientHeight);
  assert.ok(shot.h / 2 > bodyHeight, `the whole dashboard (${shot.h / 2} px), not just what's on screen (${bodyHeight} px)`);

  // Wide window (Schoology's 980 px + the 437 px panel fit): the panel
  // docks beside Schoology, which narrows to the space left, no shadow.
  await browser.execute(() => { document.body.insertAdjacentHTML('beforeend', '<div id="probe" style="width:100%;height:10px"></div>'); });
  const probeWidth = () => browser.execute(() => document.getElementById('probe').getBoundingClientRect().width);
  const probeIs = async (ok, message) => {
    let w = null;
    await browser.waitUntil(async () => ok((w = await probeWidth())), {
      timeout: 15_000, interval: 200, timeoutMsg: () => `${WAIT_PREFIX} ${message}: probe width ${w}`,
    });
  };
  const htmlDocked = () => browser.execute(() => document.documentElement.classList.contains('sgd-panel-open'));
  const sheetShadow = (root) => getComputedStyle(root).boxShadow;
  const wide = await windowWidth(browser, 1500, 900);
  assert.ok(wide >= DOCK_MIN_WIDTH, `window.innerWidth ${wide} is too narrow to dock (needs ${DOCK_MIN_WIDTH} px)`);
  await browser.waitUntil(htmlDocked, { timeout: 15_000, interval: 200, timeoutMsg: `${WAIT_PREFIX} <html> lacks sgd-panel-open` });
  await probeIs((w) => w <= wide - PANEL_WIDTH, 'Schoology did not narrow beside the docked panel');
  await see(sheetShadow, 'none', 'docked panel has no shadow');
  await clickDashboard(browser, 'button', { label: /^Close dashboard panel$/ });
  await browser.waitUntil(async () => !(await htmlDocked()), { timeout: 15_000, interval: 200, timeoutMsg: `${WAIT_PREFIX} <html> keeps sgd-panel-open after Close` });
  await probeIs((w) => w > wide - PANEL_WIDTH, 'closed: Schoology not full width again');
  await see(clickTab, true, 'no edge tab to click');
  await probeIs((w) => w <= wide - PANEL_WIDTH, 'reopened: Schoology did not narrow again');
  // Narrower than 1417 px: the panel floats over the page with its shadow.
  const floating = await windowWidth(browser, 1400, 900);
  assert.ok(floating < DOCK_MIN_WIDTH, `window.innerWidth ${floating} is wide enough to dock`);
  await probeIs((w) => w > floating - PANEL_WIDTH, 'floating: Schoology not full width');
  await see((root) => getComputedStyle(root).boxShadow !== 'none', true, 'floating panel has a shadow');
  await browser.setWindowSize(1280, 720);

  // Opening a class's chart while scrolled down keeps the panel where it
  // was (it used to jump back to the top).
  await browser.setWindowSize(1280, 480);
  await see(shownCount, 1, 'United States History toggle shown', '.class button.class-toggle', 'United States History');
  const scrolledTo = await inDashboard(browser, (root, q) => {
    const body = root.querySelector('main.body');
    q('.class', 'United States History')[0].querySelector('button.class-toggle').scrollIntoView({ block: 'nearest' });
    body.scrollTop += 40;
    return body.scrollTop;
  });
  assert.ok(scrolledTo > 100, `panel body scrolled down: ${scrolledTo}`);
  const bodyTop = () => inDashboard(browser, (root) => root.querySelector('main.body').scrollTop);
  const toggle = (name) => clickDashboard(browser, 'button.class-toggle', { within: '.class', withinText: name });
  await toggle('United States History');
  await see(shownCount, 1, 'United States History open', '.class.open', 'United States History');
  const after = await bodyTop();
  assert.ok(Math.abs(after - scrolledTo) <= 2, `panel stayed scrolled: ${scrolledTo} -> ${after}`);
  await toggle('United States History');
  // With another class's chart open above, opening this one closes that
  // chart: the clicked row stays put on screen instead of jumping up.
  await toggle('Algebra 2');
  await see(shownCount, 1, 'Algebra 2 open', '.class.open', 'Algebra 2');
  const rowY = () => inDashboard(browser, (root, q) => q('.class', 'United States History')[0].querySelector('.class-head').getBoundingClientRect().y);
  // (scrollIntoViewIfNeeded, as the original did.) The original clicked the
  // row's centre; this presses the row's class toggle the same way the other
  // toggles here are pressed: the row's behaviour doesn't depend on a real
  // pointer click, and Safari sometimes delivers none to it.
  await inDashboard(browser, (root, q) => q('.class', 'United States History')[0].querySelector('.class-head').scrollIntoView({ block: 'nearest' }));
  const rowBefore = await rowY();
  await toggle('United States History');
  await see(shownCount, 1, 'United States History open', '.class.open', 'United States History');
  const rowAfter = await rowY();
  assert.ok(Math.abs(rowAfter - rowBefore) <= 2, `the row stayed put: ${rowBefore} -> ${rowAfter}`);
  await toggle('United States History');
  await browser.setWindowSize(1280, 720);

  // Class and assignment links open in this same tab, not a new one.
  const windowsBefore = (await browser.getWindowHandles()).length;
  await toggle('Algebra 2');
  const chart = `${base}/course/1001/student_grades`;
  await realClickDashboard(browser, '.class.open a.chart-link', { hasText: 'Algebra 2', navigatesTo: new RegExp(`^${chart.replace(/[.?/]/g, '\\$&')}$`) });
  assert.equal(await browser.getUrl(), chart);
  assert.equal((await browser.getWindowHandles()).length, windowsBefore, 'no new window');

  // Emailing the teacher is for parents: a student gets no envelope.
  await see((root, q) => q('.missing-card').some((e) => shown(e)), true, 'a Missing card shown');
  await see(count, 0, 'no mail button for a student', '.missing-card .mail-btn');
}

// Both scenarios in one browser session (one session per file: Safari
// allows one at a time). Each starts signed out with empty storage.
test('in-page panel', { skip: skipReason(), timeout: 420_000 }, async (t) => {
  await withSession(async (session) => {
    const fresh = async () => {
      await session.browser.url(`${session.base}/login`);
      await session.browser.deleteCookies();
      await session.browser.execute(() => localStorage.clear());
    };
    await t.test('in-page panel on a narrow screen closes when a link in it is opened', async () => {
      await fresh();
      await narrowScreenLink(session);
    });
    await t.test('in-page panel on Schoology pages: open by default, closes, reopens, remembered', async () => {
      await fresh();
      await openClosesRemembered(session);
    });
  });
});
