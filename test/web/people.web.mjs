// Web feature suite: data per signed-in person on a site. Ported from
// test/e2e/extension.spec.js "each person signed in on a site has their own
// data; signed out shows the old data with a banner". See test/web/helpers.mjs.
//
// Adaptations (the assertions themselves are all kept):
// - Storage is read and written as the shim keeps it: localStorage keys
//   sgd:<chrome.storage key> (dashboards@<site>#<uid>, user@<site>). The
//   backdating write goes through the page's browser.storage (the shim), so
//   the panel's onChanged listener fires as it does for the original's
//   worker write.
// - A sign-in lands on /home with the panel, which is the "Schoology page
//   load after signing in" the original opened as a new page; the test uses
//   that page instead of loading /home a second time (the web build's
//   background lives in the page, so loading again would cut short the
//   refresh the sign-in page started).
// - Added: after backdating, the test waits until the banner no longer says
//   "from today", so the following checks are known to read the re-rendered
//   panel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WAIT_PREFIX, count, expectDashboard, refreshNow, shownText, signIn, skipReason, text, useMock, visible, waitForPanel, withSession } from './helpers.mjs';

const HEADING = 'h1, h2, h3, [role="heading"]';

test('each person signed in on a site has their own data; signed out shows the old data with a banner', { skip: skipReason(), timeout: 240_000 }, async () => {
  await withSession(async ({ browser, base }) => {
    const see = (read, expected, message, { args = [], timeout } = {}) => expectDashboard(browser, read, expected, message, { args, ...(timeout && { timeout }) });
    const site = base;
    // Storage as the extension keeps it (the shim: localStorage, sgd:<key>).
    const read = (key) => browser.execute((k) => {
      try {
        return JSON.parse(localStorage.getItem(`sgd:${k}`));
      } catch {
        return null;
      }
    }, key);
    const names = async (uid) => Object.values((await read(`dashboards@${site}#${uid}`)) || {}).map((d) => d.studentName);
    const waitFor = async (fn, expected, message, timeout) => {
      let last;
      await browser.waitUntil(async () => {
        last = await fn();
        return JSON.stringify(last) === JSON.stringify(expected);
      }, { timeout, interval: 250, timeoutMsg: () => `${WAIT_PREFIX} ${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(last)}` });
    };
    const heading = (name, message, timeout) => see(shownText, name, message, { args: [HEADING, name], timeout });

    await signIn(browser, base, 'student');
    await useMock(browser, base);
    await browser.url(`${base}/home`);
    await waitForPanel(browser, (t) => t !== null, { message: 'no panel: did the web build load?' });
    await refreshNow(browser, base);
    await waitFor(() => names('3000001'), ['Alex Student'], "Alex's data saved under his own id", 30_000);

    // Signed out: the sign-in page marks the site signed out; the last
    // person's data stays, under a banner saying it is old.
    await browser.url(`${base}/logout`);
    assert.equal(await browser.getUrl(), `${base}/login`);
    await waitFor(async () => (await read(`user@${site}`))?.signedOut ?? null, true, 'site marked signed out', 15_000);
    await see(text, /Please log in to Schoology to see the latest\. This is old data \(from today, /, 'signed-out banner', { args: ['.signed-out'], timeout: 15_000 });
    await see(count, 0, 'no stale banner', { args: ['.stale'] });
    // Grades more than a day old while signed out: still the log-in
    // message, never "more than a day old. Press Refresh."
    await browser.execute(async (k) => {
      const { [k]: v } = await globalThis.browser.storage.local.get(k);
      const old = new Date(Date.now() - 2 * 86400000).toISOString();
      for (const d of Object.values(v)) d.updatedAt = old;
      await globalThis.browser.storage.local.set({ [k]: v });
    }, `dashboards@${site}#3000001`);
    await see(text, (t) => typeof t === 'string' && !t.includes('from today'), 'banner re-rendered with the old date', { args: ['.signed-out'] });
    await see(text, /Please log in to Schoology to see the latest\./, 'signed-out banner on old data', { args: ['.signed-out'] });
    await see(count, 0, 'still no stale banner', { args: ['.stale'] });
    await heading('Hi, Alex', 'Hi, Alex heading shown while signed out');
    await see(visible, true, 'Missing · 1 shown while signed out', { args: ['Missing · 1'] });

    // Someone else signs in: their own data, none of the first student's.
    await signIn(browser, base, 'student2');
    await waitFor(() => names('3000002'), ['Riley Student'], "Riley's data saved under her own id", 30_000);
    await heading('Hi, Riley', 'Hi, Riley heading shown', 15_000);
    await see(count, 0, 'no signed-out banner for Riley', { args: ['.signed-out'] });
    await see(count, 0, "none of Alex's classes", { args: ['*', 'American Literature'] });
    assert.deepEqual(await names('3000001'), ['Alex Student'], "Alex's data untouched");

    // The first student back: their data is still there.
    await signIn(browser, base, 'student');
    await heading('Hi, Alex', 'Hi, Alex heading shown again', 15_000);
    await see(visible, true, 'Missing · 1 shown for Alex again', { args: ['Missing · 1'] });
  });
});
