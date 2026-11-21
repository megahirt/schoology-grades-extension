// Web feature suite: the parent persona. Ported from test/e2e/extension.spec.js
// "parent persona: TWO child dashboards — Sam NO-GO, Jamie GO, submitted work
// waiting", as two subtests in one browser session:
// - the in-page panel on a mock Schoology page (as the original's Firefox
//   branch did, plus its Share step, which works here: the web build's panel
//   shares the page's navigator, so the stubbed navigator.share is seen);
// - the dashboard page and its Print page (the original's Chromium popup part).
// See test/web/helpers.mjs.
/* global shown */ // in page-side readers: see inDashboard (helpers.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WAIT_PREFIX, attr, attrIn, clickDashboard, count, expectDashboard, inDashboard, panelVerdicts, realClickDashboard,
  refreshNow, shownCount, shownText, signIn, skipReason, switchToNewWindow, text, textIn, updateSettings, useMock, visible, waitForPanel, withSession,
} from './helpers.mjs';

// The tab for `name` is selected.
const tabSelected = (root, q, name) => q('[role="tab"]').find((t) => t.textContent.trim() === name)?.getAttribute('aria-selected') ?? null;
const pickTab = (browser, name) => clickDashboard(browser, '[role="tab"]', { hasText: name });
// An element in the first `outer` whose own text is exactly `exact`.
const exactIn = (root, q, outer, exact) => q(`${outer} *`).some((e) => e.textContent.trim() === exact && shown(e));
// The tab for `name` is shown.
const tabShown = (root, q, name) => shown(q('[role="tab"]').find((t) => t.textContent.trim() === name));

async function twoChildren({ browser, base, mock }) {
  const see = (read, expected, message, ...args) => expectDashboard(browser, read, expected, message, { args });
  await signIn(browser, base, 'parent');
  await useMock(browser, base);
  await browser.url(`${base}/home`);
  await waitForPanel(browser, (t) => t !== null, { message: 'no panel: did the web build load?' });
  await refreshNow(browser, base);

  // One child at a time, picked with the tabs at the top.
  await see(tabShown, true, 'Sam tab shown', 'Sam');
  await see(tabSelected, 'true', 'Sam tab selected', 'Sam');
  await see(tabSelected, 'false', 'Jamie tab', 'Jamie');
  // Sam: 2 Missing + lowest class 55% => NO-GO.
  await see(exactIn, true, 'Sam Rivera on the card', '.card', 'Sam Rivera');
  // NO-GO replaces Sam's picture with the NO-GO circle; no separate badge.
  assert.deepEqual(await panelVerdicts(browser), ['NO-GO']);
  await see(shownCount, 1, 'NO-GO disc shown', '.card [role="img"][aria-label="NO-GO"]');
  await see(count, 0, 'no picture beside the NO-GO circle', '.card .avatar:not(.nogo-circle)');
  await see(count, 0, 'no pill on Sam', '.card .pill');
  // Sam's essay is marked Missing but has a submission: it waits on the
  // teacher and does not count as Missing.
  await see(visible, true, 'Missing · 1 for Sam', 'Missing · 1');
  await see(shownCount, 1, 'Unit 2 Essay Missing card shown', '.missing-card', 'Unit 2 Essay');
  // Compact metrics: only non-zero counts; no class chips.
  await see(text, /^1\s*Missing$/, 'Sam Missing stat', '.card .stat', 'Missing');
  await see(count, 0, 'no class chip', '.card .stat', 'American Literature');
  // Parent class links open that child's class grades via Schoology's preview link.
  await clickDashboard(browser, 'button.class-toggle', { within: '.class', withinText: 'American Literature' });
  await see(attrIn, /\/course\/\d+\/preview\/2000001\/parent\?url=course\/\d+\/student_grades$/, 'parent chart link',
    '.class', 'American Literature', 'a.chart-link', 'href');
  // Earlier Missing work since submitted shows checked off in its class.
  await see((root, q) => {
    const wk = q('.class', 'American Literature').flatMap((c) => q('.wk', 'Persuasive Essay Draft', c))[0];
    const check = wk?.querySelector('.wk-check.on');
    return check ? check.disabled : null;
  }, true, 'Persuasive Essay Draft checked off (disabled)');
  await see((root, q) => {
    const wk = q('.class', 'American Literature').flatMap((c) => q('.wk', 'Persuasive Essay Draft', c))[0];
    return shown(wk?.querySelector('[role="img"][aria-label="Submitted, not graded yet"], img[alt="Submitted, not graded yet"]'));
  }, true, 'Submitted, not graded yet icon shown');
  await see(count, 0, 'essay not in Submitted', '.waiting', 'Persuasive Essay Draft');
  // Classes leave out sections with no grade data (House Group 1).
  await see(shownCount, 1, 'United States History shown', '.class', 'United States History');
  await see(count, 0, 'House Group 1 left out', '.class', 'House Group 1');
  // Records: personal bests saved with the refresh (they only go up).
  await see(shownCount, 1, 'Records heading shown', '.sec-h', 'Records');
  await see(count, 0, 'no Highest score record (per class now)', '.record', 'Highest score');
  await see(shownCount, 1, 'Highest class grade record shown', '.record', 'Highest class grade');
  // Storage is the shim's localStorage (keys sgd:<chrome.storage key>).
  assert.equal(await browser.execute(() => {
    const k = Object.keys(localStorage).find((key) => key.startsWith('sgd:records@'));
    return k ? Object.keys(JSON.parse(localStorage.getItem(k)) || {}).length : -1;
  }), 2, 'records saved for both children');

  // Jamie: 1 Missing, all classes >= 90 => GO.
  await pickTab(browser, 'Jamie');
  await see(exactIn, true, 'Jamie Rivera on the card', '.card', 'Jamie Rivera');
  // GO keeps the picture and gets no badge.
  await see(count, 0, 'no pill on Jamie', '.card .pill');
  await see(count, 0, 'no NO-GO circle on Jamie', '.card .nogo-circle');
  assert.deepEqual(await panelVerdicts(browser), ['GO']);
  await see(visible, true, 'Missing · 1 for Jamie', 'Missing · 1');
  await see(visible, true, 'Poetry Analysis Essay', 'Poetry Analysis Essay');
  // A parent's Family rules take effect: with a Missing limit of 1,
  // Jamie's one Missing item is NO-GO.
  await updateSettings(browser, { missingThreshold: 1 });
  await see(shownCount, 1, 'NO-GO circle shown at Missing limit 1', '.card .nogo-circle');
  await updateSettings(browser, { missingThreshold: 2 });
  await see(count, 0, 'GO again at Missing limit 2', '.card .nogo-circle');

  // Share: the picture goes to the clipboard and the system share menu
  // (stubbed: headless browsers have none). When the share menu needs a
  // fresh click, a second press shares the finished picture.
  await browser.execute(() => {
    window.__shared = [];
    window.__shareCalls = 0;
    navigator.canShare = () => true;
    navigator.share = async (data) => {
      window.__shareCalls += 1;
      if (window.__shareCalls === 1) throw new DOMException('needs a click', 'NotAllowedError');
      window.__shared.push(data.files.map((f) => `${f.name} ${f.type}`));
    };
  });
  const SHARE = /^Share a picture of the dashboard$/;
  await clickDashboard(browser, 'button', { label: SHARE });
  await see(text, /Press Share again to send it\.$/, 'share needs a second press', '.status');
  await clickDashboard(browser, 'button', { label: SHARE });
  await see(text, /shared\.$/, 'shared', '.status');
  const shared = await browser.execute(() => window.__shared);
  assert.equal(shared.length, 1, `one share: ${JSON.stringify(shared)}`);
  assert.equal(shared[0].length, 1, `one file: ${JSON.stringify(shared)}`);
  assert.match(shared[0][0], /^grades-dashboard-jamie-\d{4}-\d{2}-\d{2}\.png image\/png$/);
  // Shared "07" prefixes are dropped from class names.
  await see((root, q) => q('.class .class-name').map((e) => e.textContent.trim()), ['English', 'Math'], 'Jamie class names');
  // The picked child is remembered: a page load stays on Jamie.
  await browser.refresh();
  await see(tabSelected, 'true', 'Jamie still picked after a reload', 'Jamie');
  await see(exactIn, true, 'Jamie Rivera after a reload', '.card', 'Jamie Rivera');

  // Email the teacher (parents only). Sam's class lists two admins (its
  // teacher and a department admin on every class), so the panel asks
  // which one, with the likely teacher preselected. The message goes to
  // that one teacher, filled in and unsent.
  await pickTab(browser, 'Sam');
  await see(shownCount, 1, 'Unit 2 Essay shown', '.missing-card', 'Unit 2 Essay');
  let posted = false;
  mock.server.on('request', (req) => { if (req.method === 'POST' && /messages/.test(req.url || '')) posted = true; });
  const MAIL = /^Message the .* teacher about /;
  const mail = () => clickDashboard(browser, 'button', { within: '.missing-card', withinText: 'Unit 2 Essay', label: MAIL });
  const CHOOSER = '[role="group"][aria-label="Email which teacher?"]';
  await mail();
  await see(shownCount, 1, 'teacher chooser shown', CHOOSER);
  await see((root, q, c) => q(`${c} .tc-name`).map((e) => e.textContent.trim()), ['Mr. Ortiz', 'Ms. Park'], 'teacher names', CHOOSER);
  const parkChecked = (root, q) => q('.tc-opt', 'Ms. Park')[0]?.querySelector('input[type="radio"]')?.checked ?? null;
  await see(parkChecked, true, 'Ms. Park preselected');
  await see(text, /Likely teacher/, 'Ms. Park likely teacher', '.tc-opt', 'Ms. Park');
  await clickDashboard(browser, `${CHOOSER} button`, { hasText: 'Cancel' });
  await see(count, 0, 'chooser closed', CHOOSER);
  await mail();
  // Schoology is left viewing the other child (as a refresh, or looking up
  // the teachers, can leave it): the message page would then be "Private
  // Access Only". Writing the email switches back to Sam first.
  await browser.execute(() => fetch('/parent/home?child_uid=2000002', { credentials: 'include' }).then((r) => r.status));
  await clickDashboard(browser, `${CHOOSER} button`, { hasText: 'Write email' });
  await browser.waitUntil(async () => /\/parent\/messages\/new\/course\/3001\?recipient_uids=9301$/.test(await browser.getUrl()), {
    timeout: 15_000, interval: 250, timeoutMsg: `${WAIT_PREFIX} compose page did not open`,
  });
  // Read the compose page until its fields are filled in as expected.
  let compose = null;
  await browser.waitUntil(
    async () => {
      compose = await browser.execute(() => ({
        to: document.querySelector('.to')?.textContent.trim(),
        subject: document.querySelector('input[name="subject"]')?.value,
        body: document.querySelector('textarea[name="body"]')?.value,
      }));
      return compose.to === 'To: Ms. Park' && /^Unit 2 Essay.* - marked missing$/.test(compose.subject || '')
        && /what Sam needs to do to turn it in\?\n\nSincerely,/.test(compose.body || '');
    },
    { timeout: 15_000, interval: 250, timeoutMsg: () => `${WAIT_PREFIX} compose page not filled in as expected: ${JSON.stringify(compose)}` },
  );
  assert.equal(posted, false, 'nothing sent');
  // The pick is remembered for that class and preselected next time.
  await browser.url(`${base}/home`);
  await clickDashboard(browser, 'button', { within: '.missing-card', withinText: 'Unit 2 Essay', label: /^Message the / });
  await see(text, /Last emailed/, 'Ms. Park last emailed', '.tc-opt', 'Ms. Park');
  await see(parkChecked, true, 'Ms. Park preselected again');
}

async function dashboardAndPrint({ browser, base }) {
  const see = (read, expected, message, ...args) => expectDashboard(browser, read, expected, message, { args });
  await signIn(browser, base, 'parent');
  await useMock(browser, base);
  await browser.url(`${base}/__ext/popup/dashboard.html`);
  await refreshNow(browser, base);
  await see(tabSelected, 'true', 'Sam tab selected', 'Sam');
  await see(tabSelected, 'false', 'Jamie tab', 'Jamie');
  await see(exactIn, true, 'Sam Rivera on the card', '.card', 'Sam Rivera');
  // Records, with its trophy heading.
  await see(textIn, '🏆', 'Records heading emoji', '.sec-h', 'Records', '.sec-emoji');
  await see(shownCount, 1, 'Highest class grade record shown', '.record', 'Highest class grade');
  await pickTab(browser, 'Jamie');
  await see(exactIn, true, 'Jamie Rivera on the card', '.card', 'Jamie Rivera');

  // Print: the picked child (Jamie) on one sheet of Letter paper, in a new
  // window (tabs.create is window.open here). A real click, since opening
  // a window needs the user's gesture.
  const dashboardWindow = await browser.getWindowHandle();
  const before = await browser.getWindowHandles();
  await see(attr, 'Print on one page', 'Print button name', 'button[data-act="print"]', null, 'aria-label');
  await realClickDashboard(browser, 'button[data-act="print"]');
  await switchToNewWindow(browser, before);
  // The print page opens the print dialog by itself 300 ms after layout;
  // stub it once we're there (as the original did).
  await browser.execute(() => { window.print = () => {}; });
  await browser.waitUntil(async () => /\/popup\/print\.html\?/.test(await browser.getUrl()), {
    timeout: 15_000, interval: 250, timeoutMsg: `${WAIT_PREFIX} the new window is not the print page`,
  });
  await see(text, 'Jamie Rivera', 'print name', '.p-name');
  await see(text, 'GO', 'print verdict', '.p-verdict');
  await see(shownText, 'Missing · 1', 'print Missing heading shown', 'h2', 'Missing');
  const fit = await browser.execute(() => ({ h: document.getElementById('sheet').getBoundingClientRect().height, fit: document.body.dataset.fit }));
  assert.ok(fit.fit, 'fitted to one page');
  assert.ok(fit.h <= 979 + 1, `one Letter page high: ${fit.h}`);
  await browser.closeWindow();
  await browser.switchToWindow(dashboardWindow);
}

// Both scenarios in one browser session (one session per file: Safari
// allows one at a time, and a second one in the same process found the
// first safaridriver still running). Each starts signed out with empty
// storage.
test('parent persona', { skip: skipReason(), timeout: 420_000 }, async (t) => {
  await withSession(async (session) => {
    const fresh = async () => {
      await session.browser.url(`${session.base}/login`);
      await session.browser.deleteCookies();
      await session.browser.execute(() => localStorage.clear());
    };
    await t.test('TWO child dashboards — Sam NO-GO, Jamie GO, submitted work waiting', async () => {
      await fresh();
      await twoChildren(session);
    });
    await t.test('dashboard page and print page show the same dashboard', async () => {
      await fresh();
      await dashboardAndPrint(session);
    });
  });
});
