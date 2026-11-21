// Web feature suite: the automatic refresh when a Schoology page loads.
// Ported from test/e2e/extension.spec.js "refreshes by itself when a
// Schoology page loads, with banner, progress and a disabled button".
// See test/web/helpers.mjs.
//
// Adaptations (the assertions themselves are all kept):
// - The second Schoology page that loads mid-refresh is opened with
//   ?mock-no-background=1, so it gets the content script only. In the web
//   build every page runs its own copy of the background (one per page, not
//   one per browser); without this the second page's background would see
//   no refresh running in its own memory and start a second one, which the
//   real extension never does (one background joins the running refresh).
//   The page still sees the first page's refresh through storage (the
//   cross-tab `storage` event), which is what its reload notice depends on.
// - "Loading another page does not refresh again": instead of a fixed
//   1.5 s pause, the test asks the page's background the same question the
//   content script asks on load (schoology-page-loaded) and waits for its
//   answer, "fresh", then checks that no refresh started (refreshState's
//   startedAt unchanged, nothing running, no new account request).
/* global shown */ // in page-side readers: see inDashboard (helpers.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WAIT_PREFIX, expectDashboard, inDashboard, requestsTo, freshStart, signIn, skipReason, useMock, visible, waitForPanel, withSession } from './helpers.mjs';

// The refreshState of `site` as stored (the shim keeps storage in localStorage).
const refreshState = (browser, site) => browser.execute((s) => {
  try {
    return JSON.parse(localStorage.getItem(`sgd:refreshState@${s}`));
  } catch {
    return null;
  }
}, site);

// The panel's "loaded while switching children" notice (in the panel's
// shadow root, outside the sheet): { notice, reload } shown.
const noticeShown = (browser) => browser.execute(() => {
  const root = document.getElementById('sgd-panel-host')?.shadowRoot;
  const shownEl = (e) => {
    if (!e) return false;
    const r = e.getBoundingClientRect();
    const v = getComputedStyle(e).visibility;
    return r.width > 0 && r.height > 0 && v !== 'hidden' && v !== 'collapse';
  };
  const notice = root?.querySelector('.notice');
  const reload = notice && [...notice.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Reload page');
  return { panel: Boolean(root), notice: shownEl(notice), reload: shownEl(reload) };
});

// The Sam tab is shown in the dashboard.
const samTab = (root, q) => shown(q('[role="tab"]').find((t) => t.textContent.trim() === 'Sam'));

test('refreshes by itself when a Schoology page loads, with banner, progress and a disabled button', { skip: skipReason(), timeout: 240_000 }, async () => {
  // A slow mock (like real Schoology) so the in-progress state is visible.
  await withSession(async ({ browser, base, mock }) => {
    const see = (read, expected, message, opts = {}) => expectDashboard(browser, read, expected, message, opts);
    await freshStart({ browser, base });
    await signIn(browser, base, 'parent');
    // Point the extension at the mock from a page that never refreshes by
    // itself (the dashboard page), so the first Schoology page load below is
    // what starts the refresh.
    await browser.url(`${base}/__ext/popup/dashboard.html`);
    await useMock(browser, base);
    assert.equal(await refreshState(browser, base), null, 'no refresh before the Schoology page loads');

    // Just open Schoology: no Refresh click.
    await browser.url(`${base}/home`);
    const pageWindow = await browser.getWindowHandle();
    await waitForPanel(browser, (t) => t !== null, { message: 'no panel: did the web build load?' });
    // All at once, while the refresh runs: the banner, the progress bar, the
    // disabled "Refreshing grades" button and the step count.
    await see((root, q) => {
      const btn = root.querySelector('button[data-act="refresh"]');
      const bar = q('[role="progressbar"][aria-label="Refresh progress"]')[0];
      const step = q('.refreshing-step')[0];
      const norm = (e) => (e.textContent || '').replace(/\s+/g, ' ');
      const banner = q('*').filter((e) => norm(e).includes('Refreshing grades…') && ![...e.children].some((c) => norm(c).includes('Refreshing grades…')));
      return {
        banner: banner.some((e) => shown(e)),
        progress: shown(bar),
        busyDisabled: Boolean(btn && btn.getAttribute('aria-label') === 'Refreshing grades' && btn.disabled),
        step: Boolean(step && /of \d/.test(step.textContent)),
      };
    }, (v) => Boolean(v && v.banner && v.progress && v.busyDisabled && v.step), 'refresh banner, progress, disabled button and step count', { timeout: 15_000 });

    // A second Schoology page that loads mid-refresh may show the wrong
    // child (the refresh switches "viewing as"): it gets a reload notice.
    // WebDriver's New Window, not webdriverio's newWindow (a script's
    // window.open, whose handle Safari sometimes doesn't list last).
    const { handle: duringWindow } = await browser.createWindow('window');
    assert.notEqual(duringWindow, pageWindow, 'the second page is in its own window');
    await browser.switchToWindow(duringWindow);
    await browser.url(`${base}/home?mock-no-background=1`);
    const running = await refreshState(browser, base);
    assert.equal(running && running.running, true, `the second page loaded while the refresh ran: ${JSON.stringify(running)}`);

    // When it finishes: data in, banner gone, button back.
    await browser.switchToWindow(pageWindow);
    await see(samTab, true, 'Sam tab shown', { timeout: 30_000 });
    await see(visible, false, '"Refreshing grades…" hidden', { args: ['Refreshing grades…'], timeout: 30_000 });
    await see((root) => {
      const btn = root.querySelector('button[data-act="refresh"]');
      return Boolean(btn && btn.getAttribute('aria-label') === 'Refresh grades' && !btn.disabled);
    }, true, 'Refresh grades button enabled');
    await browser.switchToWindow(duringWindow);
    let notice = null;
    await browser.waitUntil(async () => {
      notice = await noticeShown(browser);
      return notice.notice && notice.reload;
    }, { timeout: 10_000, interval: 200, timeoutMsg: () => `${WAIT_PREFIX} no reload notice on the page that loaded mid-refresh: ${JSON.stringify(notice)}` });
    await browser.closeWindow();
    await browser.switchToWindow(pageWindow);
    // Loaded before the refresh began: no notice.
    notice = await noticeShown(browser);
    assert.deepEqual(notice, { panel: true, notice: false, reload: false }, 'no notice on the page that loaded before the refresh');

    // Fresh data: loading another Schoology page does not refresh again.
    const before = (await refreshState(browser, base)).startedAt;
    const accountReads = requestsTo(mock, '/iapi/parent/info');
    await browser.url(`${base}/home`);
    await see(samTab, true, 'Sam tab shown after loading another page', { timeout: 15_000 });
    // The question the content script asks on load, answered by this page's background.
    const answer = await browser.execute(async () => {
      const sender = { tab: { id: 1, index: 0, url: location.href } };
      for (const fn of globalThis.__sgdBus.listeners.background) {
        const r = fn({ type: 'schoology-page-loaded', url: location.href }, sender);
        if (r !== undefined) return await r;
      }
      return null;
    });
    assert.deepEqual(answer, { started: false, reason: 'fresh' }, 'the page load finds the data fresh');
    const after = await refreshState(browser, base);
    assert.equal(after.startedAt, before, 'no new refresh started');
    assert.equal(after.running, false, 'nothing running');
    assert.equal(accountReads.count(), 0, 'no refresh request reached the mock');
    assert.equal(await inDashboard(browser, visible, 'Refreshing grades…'), false, 'no refresh banner');
  }, { delayMs: 700 });
});
