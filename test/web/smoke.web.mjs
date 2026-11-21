// Web feature suite smoke: the parent dashboard in the in-page panel, with the
// extension's real code running as a web app (npm run build:web) in Chrome,
// Firefox or Safari (BROWSER=…). See test/web/helpers.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WAIT_PREFIX, clickInPanel, panelVerdicts, requestsTo, signIn, skipReason, useMock, waitForPanel, withSession } from './helpers.mjs';

// A refresh of `base` finished after `since` (page clock, ms) and the panel's
// button is enabled ("Refresh grades") again.
const refreshDoneSince = (browser, base, since) =>
  browser.execute((site, after) => {
    let state = null;
    try {
      state = JSON.parse(localStorage.getItem(`sgd:refreshState@${site}`));
    } catch {}
    const btn = document.getElementById('sgd-panel-host')?.shadowRoot?.querySelector('button[data-act="refresh"]');
    return Boolean(state && !state.running && Date.parse(state.finishedAt) >= after
      && btn && !btn.disabled && btn.getAttribute('aria-label') === 'Refresh grades');
  }, base, since);

test('parent dashboard in the panel', { skip: skipReason(), timeout: 180_000 }, async () => {
  await withSession(async ({ browser, base, mock }) => {
    await signIn(browser, base, 'parent');
    await useMock(browser, base);
    await browser.url(`${base}/home`);
    await waitForPanel(browser, (text) => text !== null, { message: 'no panel: did the web build load?' });
    // Count only the reads the Refresh click makes, so a dashboard left in
    // storage (or the automatic refresh on page load) can't pass the test.
    // While that automatic refresh runs the button is "Refreshing grades"
    // (disabled), so wait for "Refresh grades" to come back.
    const parentInfo = requestsTo(mock, '/iapi/parent/info');
    let before = 0;
    let clickedAt = 0;
    await browser.waitUntil(
      async () => {
        before = parentInfo.count();
        clickedAt = await browser.execute(() => Date.now());
        return clickInPanel(browser, /^Refresh grades$/);
      },
      { timeout: 30_000, interval: 250, timeoutMsg: `${WAIT_PREFIX} no Refresh grades button in the panel` },
    );
    await waitForPanel(browser, (t) => parentInfo.count() > before && /Sam Rivera/.test(t) && /Jamie/.test(t), {
      message: 'parent dashboard did not show',
    });
    // Let the clicked refresh finish (its refreshState is done and the button
    // is "Refresh grades" again, not the disabled "Refreshing grades"), so a
    // late error can't land after the asserts.
    const text = await waitForPanel(browser, () => refreshDoneSince(browser, base, clickedAt), {
      message: 'the clicked refresh did not finish',
    });
    // The DEV footer names the data source. "Mock server" is only for the
    // fixed localhost:8123; this mock runs on a free port, shown as its host.
    assert.match(text, new RegExp(`Data: ${new URL(base).host}`));
    // Sam's card (shown first) is NO-GO: read the disc's aria-label, since
    // innerText of its SVG differs between browsers ("NO GO" / "NOGO").
    assert.deepEqual(await panelVerdicts(browser), ['NO-GO']);
    assert.doesNotMatch(text, /Please log in to Schoology/);
  });
});
