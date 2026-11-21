// Web feature suite smoke: the parent dashboard in the in-page panel, with the
// extension's real code running as a web app (npm run build:web) in Chrome,
// Firefox or Safari (BROWSER=…). See test/web/helpers.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clickInPanel, requestsTo, signIn, skipReason, useMock, waitForPanel, withSession } from './helpers.mjs';

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
    await browser.waitUntil(
      async () => {
        before = parentInfo.count();
        return clickInPanel(browser, /^Refresh grades$/);
      },
      { timeout: 30_000, interval: 250, timeoutMsg: 'no Refresh grades button in the panel' },
    );
    const text = await waitForPanel(browser, (t) => parentInfo.count() > before && /Sam Rivera/.test(t) && /Jamie/.test(t), {
      message: 'parent dashboard did not show',
    });
    // The DEV footer names the data source. "Mock server" is only for the
    // fixed localhost:8123; this mock runs on a free port, shown as its host.
    assert.match(text, new RegExp(`Data: ${new URL(base).host}`));
    // The NO-GO disc is an SVG with "NO" and "GO" as two <text> elements:
    // Chrome and Safari's innerText put a space between them, Firefox doesn't.
    assert.match(text, /NO ?GO/);
    assert.doesNotMatch(text, /Please log in to Schoology/);
  });
});
