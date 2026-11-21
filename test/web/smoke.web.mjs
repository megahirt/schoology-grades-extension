// Web feature suite smoke: the parent dashboard in the in-page panel, with the
// extension's real code running as a web app (npm run build:web) in Chrome,
// Firefox or Safari (BROWSER=…). See test/web/helpers.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { panelVerdicts, refreshNow, requestsTo, signIn, skipReason, useMock, waitForPanel, withSession } from './helpers.mjs';

test('parent dashboard in the panel', { skip: skipReason(), timeout: 180_000 }, async () => {
  await withSession(async ({ browser, base, mock }) => {
    await signIn(browser, base, 'parent');
    await useMock(browser, base);
    await browser.url(`${base}/home`);
    await waitForPanel(browser, (text) => text !== null, { message: 'no panel: did the web build load?' });
    // Count only the reads the Refresh click makes, so a dashboard left in
    // storage (or the automatic refresh on page load) can't pass the test.
    // refreshNow waits out that automatic refresh, clicks, and waits for the
    // clicked refresh to finish (so a late error can't land after the asserts).
    const parentInfo = requestsTo(mock, '/iapi/parent/info');
    let before = 0;
    await refreshNow(browser, base, { beforeClick: () => { before = parentInfo.count(); } });
    const text = await waitForPanel(browser, (t) => parentInfo.count() > before && /Sam Rivera/.test(t) && /Jamie/.test(t), {
      message: 'parent dashboard did not show',
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
