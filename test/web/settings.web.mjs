// Web feature suite: the settings page. Ported from
// test/e2e/extension.spec.js "settings page: one auto-saving page; students
// get no Family rules" and "settings: Clear data asks in the page, greys out
// when empty; demo mode shows made-up students and reads nothing", as two
// subtests in one browser session. Both were Chromium-only in Playwright
// (its Firefox can't open moz-extension:// pages); here they run in every
// browser. The settings page is /__ext/options/options.html on the mock's
// origin, so it shares the mock pages' storage (the shim: localStorage,
// keys sgd:<chrome.storage key>, JSON values). See test/web/helpers.mjs.
//
// Adaptations (the assertions themselves are all kept):
// - "The popup" is the dashboard page (/__ext/popup/dashboard.html), the
//   page the original's openPopup opens.
// - Playwright's getByRole(name) is read from the DOM: a heading is
//   h1-h6 (or role=heading) with that exact text; a link's name is its text
//   without aria-hidden parts (the emoji), matched as a substring the way a
//   non-exact name is. getByText(s, exact) counting 0 is: no element whose
//   whole text is s.
// - The saved passing grade (85) is written through the dashboard page's
//   own browser.storage (the shim), so its onChanged listener re-renders as
//   it does for the original's worker write. Instead of a 500 ms pause, the
//   test waits for that re-render (a mark on the rendered dashboard is gone)
//   before checking American Literature is still not low.
// - The slider: focused from the page, then a real End key press.
// - Clicks that a person makes on this page (Clear data…, Cancel, Clear data,
//   Show demo data, the thanks box, Exit demo mode) are real pointer clicks.
//   Show demo data opens Schoology from its click (window.open needs the
//   user's gesture); Clear data and Exit demo mode reload the page, and that
//   reload is waited for.
// - "Close closes the settings tab": the original opened the settings page
//   with goto; here it is opened from the panel's Settings button (a real
//   click; the shim's openOptionsPage is window.open), so it is a window a
//   script opened, which a script may close (a window WebDriver opened and
//   navigated is not). The shim's tabs.remove(this tab's id) closes the page
//   as chrome.tabs.remove(me.id) closes the tab. The test waits for the
//   window to go.
// - Before Clear data, the dashboard page is left (about:blank), as the
//   original closed the popup first: no other extension page is open to
//   write to storage while it is checked.
// - "No native dialog" (the original listened for Playwright's dialog
//   event): window.alert/confirm/prompt are replaced in the settings page by
//   ones that note the call in sessionStorage (kept across the page's reload
//   in that tab) and answer as a dismissed dialog.
// - "Reads nothing from Schoology": besides no user@/refreshState@ keys,
//   the mock counts every request from the moment the demo page shows Sam;
//   the panel's Refresh is pressed and its answer waited for (the button
//   goes disabled, then the dashboard re-renders with it enabled), and this
//   page's background is asked directly (as the content script asks on
//   load) for a refresh and a page-load refresh; it answers both as demo
//   mode. Then the mock must have had no request at all.
/* global shown */ // in page-side readers: see inDashboard (helpers.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WAIT_PREFIX, clickDashboard, count, countIn, expectDashboard, freshStart, inDashboard, realClickDashboard, refreshNow,
  requestsTo, sessionSuite, signIn, skipReason, switchToNewWindow, text, updateSettings, useMock, visible, waitForPanel,
} from './helpers.mjs';

const OPTIONS = '/__ext/options/options.html';
const POPUP = '/__ext/popup/dashboard.html';

// ---- Page-side readers (run by inDashboard as (root, q, ...args)) ----
const HEADINGS = 'h1, h2, h3, h4, h5, h6, [role="heading"]';
// A heading whose text is exactly `name` is shown.
const headingShown = (root, q, sel, name) => q(sel).some((e) => e.textContent.replace(/\s+/g, ' ').trim() === name && shown(e));
// How many headings have exactly the text `name`.
const headingCount = (root, q, sel, name) => q(sel).filter((e) => e.textContent.replace(/\s+/g, ' ').trim() === name).length;
// The first link whose accessible name (text without aria-hidden parts)
// contains `name` (case-insensitive): { href, shown }, or null.
const link = (root, q, name) => {
  const acc = (el) => {
    let t = '';
    for (const n of el.childNodes) {
      if (n.nodeType === 3) t += n.textContent;
      else if (n.nodeType === 1 && n.getAttribute('aria-hidden') !== 'true') t += acc(n);
    }
    return t;
  };
  const a = q('a').find((e) => acc(e).replace(/\s+/g, ' ').trim().toLowerCase().includes(name.toLowerCase()));
  return a ? { href: a.getAttribute('href'), shown: shown(a) } : null;
};
// How many elements have exactly the text s (whitespace collapsed).
const exactTextCount = (root, q, s) => q('body *').filter((e) => e.textContent.replace(/\s+/g, ' ').trim() === s).length;
// An element's property (value, disabled, type…), or null if absent.
const prop = (root, q, sel, name) => { const e = q(sel)[0]; return e ? e[name] : null; };
const attr = (root, q, sel, name) => q(sel)[0]?.getAttribute(name) ?? null;
// `sel` is shown (false if absent).
const isShown = (root, q, sel) => shown(q(sel)[0]);
// The class attribute of `inner` in the first `outer` with outerHas.
const classIn = (root, q, outer, outerHas, inner) => q(outer, outerHas)[0]?.querySelector(inner)?.getAttribute('class') ?? null;
// A tab whose name matches /Sam/ is shown.
const samTab = (root, q) => q('[role="tab"]').some((t) => /Sam/.test(t.textContent) && shown(t));

// Storage as the extension keeps it (the shim: localStorage, sgd:<key>).
const storedKeys = (browser) => browser.execute(() => Object.keys(localStorage).filter((k) => k.startsWith('sgd:')).map((k) => k.slice(4)).sort());
const stored = (browser, key) => browser.execute((k) => {
  try {
    return JSON.parse(localStorage.getItem(`sgd:${k}`));
  } catch {
    return null;
  }
}, key);

async function waitFor(browser, fn, expected, message, timeout = 15_000) {
  let last;
  await browser.waitUntil(async () => {
    last = await fn();
    return JSON.stringify(last) === JSON.stringify(expected);
  }, { timeout, interval: 250, timeoutMsg: () => `${WAIT_PREFIX} ${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(last)}` });
}

// Close every window but `keep`, and switch to it.
async function onlyWindow(browser, keep) {
  for (const h of await browser.getWindowHandles()) {
    if (h === keep) continue;
    await browser.switchToWindow(h);
    await browser.closeWindow().catch(() => {});
  }
  await browser.switchToWindow(keep);
}

async function autoSavingStudentPage({ browser, base }) {
  const see = (read, expected, message, ...args) => expectDashboard(browser, read, expected, message, { args });
  const main = await browser.getWindowHandle();
  try {
    await signIn(browser, base, 'student');
    await useMock(browser, base);
    await browser.url(`${base}/home`);
    await waitForPanel(browser, (t) => t !== null, { message: 'no panel: did the web build load?' });
    await refreshNow(browser, base);

    // The settings page, opened from the panel's Settings button (a real
    // click: it opens a window), so the page is one a script opened, which
    // Close may close at the end.
    const before = await browser.getWindowHandles();
    await realClickDashboard(browser, 'button[data-act="options"]');
    const opts = await switchToNewWindow(browser, before);
    await browser.waitUntil(async () => (await browser.getUrl()) === `${base}${OPTIONS}`, {
      timeout: 15_000, interval: 250, timeoutMsg: `${WAIT_PREFIX} the Settings button did not open ${OPTIONS}`,
    });
    await see(headingShown, true, 'Grades Dashboard settings heading shown', HEADINGS, 'Grades Dashboard settings');
    await see(text, 'Connected as a student', '#account-title', '#account-title');
    for (const name of ['Account', 'Display', 'Privacy & data', 'About']) {
      await see(headingShown, true, `${name} heading shown`, HEADINGS, name);
    }
    // The School address section is gone; About links the website and two ways to say thanks.
    await see(headingCount, 0, 'no School address heading', HEADINGS, 'School address');
    await see(link, (l) => l && l.href === 'https://schoology.hirtfamily.net/', 'Visit the website link', 'Visit the website');
    // The thanks box starts closed; opening it shows the two links.
    await see(link, (l) => l && !l.shown, 'Support our mission work hidden while the box is closed', 'Support our mission work');
    await realClickDashboard(browser, 'summary .strong', { hasText: 'Has Grades Dashboard helped your family?' });
    await see(link, (l) => l && l.shown && l.href === 'https://www.wycliffe.org/partner/hirt5', 'Support our mission work link (shown)', 'Support our mission work');
    await see(link, (l) => l && l.href === 'https://buymeacoffee.com/megahirt', 'Buy me a coffee link', 'Buy me a coffee');
    await see(link, (l) => l && l.href === 'mailto:gradesdashboard@hirtfamily.net?subject=A%20note%20of%20encouragement', 'Send an encouraging note link', 'Send an encouraging note');
    await see(text, /^Version \d+\.\d+\.\d+/, '#version', '#version');
    // Family rules are for parents only; removed choices are gone.
    await see((root, q, sel, name) => q(sel).filter((e) => e.textContent.trim() === name).every((e) => !shown(e)), true, 'Family rules heading hidden', HEADINGS, 'Family rules');
    for (const gone of ['Who sees grades', 'Not so good', 'Show the GO/NO-GO badge', 'Dashboard panel on Schoology pages']) {
      await see(exactTextCount, 0, `no "${gone}"`, gone);
    }
    await see(count, 0, 'no #doing-well-days', '#doing-well-days');
    await see(visible, true, 'Doing well help text shown', 'Graded work from the past 10 days at or above this.');
    await see(attr, 'range', '#doing-well-percent type', '#doing-well-percent', 'type');
    await see(text, '80%', '#doing-well-percent-out', '#doing-well-percent-out');
    await see(visible, true, 'privacy note shown', 'Nothing is sent, and marking work turned in or done does not notify anyone.');
    await see(headingCount, 0, 'no Classes heading (no class switches)', HEADINGS, 'Classes');
    await see(headingShown, true, 'Developer heading shown (dev build)', HEADINGS, 'Developer');
    // Only classes with grades posted count (Advisory 11 has none).
    await see(text, (t) => typeof t === 'string' && t.includes('3 classes'), '.kid says 3 classes', '.kid');

    // The popup: the dashboard page, in the first window.
    await browser.switchToWindow(main);
    await browser.url(`${base}${POPUP}`);
    await see(headingShown, true, 'Hi, Alex heading shown in the popup', HEADINGS, 'Hi, Alex');
    await see(count, 0, 'no Advisory 11 class', '.class', 'Advisory 11');
    // Passing line at the default 75%: Algebra 2 (68%) is below it,
    // American Literature (82%) is not. A low grade is a red pill on the grade itself.
    await see(classIn, /(^|\s)low(\s|$)/, 'Algebra 2 grade is low', '.class', 'Algebra 2', '.class-grade');
    await see(countIn, 0, 'American Literature not low', '.class', 'American Literature', '.low');

    // A saved passing grade (from a parent) doesn't apply to a student: the
    // default 75% stands.
    await inDashboard(browser, (root, q) => { q('main.body')[0]?.setAttribute('data-sgd-mark', '1'); });
    await updateSettings(browser, { gradeThreshold: 85 });
    await see((root, q) => { const m = q('main.body')[0]; return Boolean(m && !m.hasAttribute('data-sgd-mark')); }, true, 'the popup re-rendered after the settings change');
    await see(headingShown, true, 'Hi, Alex heading shown after the change', HEADINGS, 'Hi, Alex');
    await see(countIn, 0, 'American Literature still not low at a saved 85%', '.class', 'American Literature', '.low');

    // A Display choice still saves automatically. The slider: End jumps to
    // the top of its range (90%).
    await browser.switchToWindow(opts);
    await browser.execute(() => document.getElementById('doing-well-percent').focus());
    await browser.keys('End');
    await see(text, '90%', '#doing-well-percent-out after End', '#doing-well-percent-out');
    await waitFor(browser, async () => (await stored(browser, 'settings'))?.doingWellPercent, 90, 'doingWellPercent saved');

    // The popup closes (no extension page but settings is open now).
    await browser.switchToWindow(main);
    await browser.url('about:blank');
    await browser.switchToWindow(opts);

    // Clear data removes everything, settings included, and the page
    // shows the defaults again.
    await see(text, 'Clear data…', '#clear-btn name', '#clear-btn');
    await realClickDashboard(browser, '#clear-btn');
    await see(isShown, true, 'confirm box shown', '[role="alertdialog"]');
    await see(text, 'Clear data', '#clear-yes name', '[role="alertdialog"] #clear-yes');
    await realClickDashboard(browser, '[role="alertdialog"] #clear-yes', { reloads: true });
    await waitFor(browser, async () => (await storedKeys(browser)).filter((k) => k !== 'settings'), [], 'nothing saved after Clear data');
    await see(prop, '80', '#doing-well-percent value after Clear data', '#doing-well-percent', 'value');
    // Close: the button closes the settings tab.
    await clickDashboard(browser, 'button', { label: /^\s*Close\s*$/ });
    await browser.waitUntil(async () => !(await browser.getWindowHandles()).includes(opts), {
      timeout: 15_000, interval: 250, timeoutMsg: `${WAIT_PREFIX} Close did not close the settings window`,
    });
  } finally {
    await onlyWindow(browser, main);
  }
}

async function clearDataAndDemo({ browser, base, mock }) {
  const see = (read, expected, message, ...args) => expectDashboard(browser, read, expected, message, { args });
  const main = await browser.getWindowHandle();
  // Native dialogs note themselves in this tab's sessionStorage.
  const watchDialogs = () => browser.execute(() => {
    for (const name of ['alert', 'confirm', 'prompt']) {
      window[name] = () => { sessionStorage.setItem('sgd-test:nativeDialog', name); return name === 'prompt' ? null : false; };
    }
  });
  try {
    // Something saved: Clear data is on and asks in the page (no window.confirm).
    await browser.execute((b) => {
      localStorage.setItem('sgd:settings', JSON.stringify({ schoologyBase: b }));
      localStorage.setItem('sgd:turnedIn@x', JSON.stringify({ a: 1 }));
    }, base);
    await browser.url(`${base}${OPTIONS}#privacy`);
    await browser.execute(() => sessionStorage.removeItem('sgd-test:nativeDialog'));
    await watchDialogs();
    // The buttons by their names, as the original found them.
    await see(text, 'Clear data…', '#clear-btn name', '#clear-btn');
    await see(text, 'Show demo data', '#demo-mode-btn name', '#demo-mode-btn');
    await see(prop, false, 'Clear data… enabled', '#clear-btn', 'disabled');
    await see(isShown, false, 'Show demo data hidden', '#demo-mode-btn');
    await realClickDashboard(browser, '#clear-btn');
    await see(isShown, true, 'confirm box shown', '[role="alertdialog"]');
    await see(text, 'Cancel', '#clear-cancel name', '[role="alertdialog"] #clear-cancel');
    await see(text, 'Clear data', '#clear-yes name', '[role="alertdialog"] #clear-yes');
    await realClickDashboard(browser, '[role="alertdialog"] #clear-cancel');
    await see(isShown, false, 'confirm box hidden after Cancel', '[role="alertdialog"]');
    await realClickDashboard(browser, '#clear-btn');
    await realClickDashboard(browser, '[role="alertdialog"] #clear-yes', { reloads: true });
    await watchDialogs();
    await see(prop, true, 'Clear data… disabled with nothing saved', '#clear-btn', 'disabled');
    assert.equal(await browser.execute(() => sessionStorage.getItem('sgd-test:nativeDialog')), null, 'no native dialog');
    assert.deepEqual(await storedKeys(browser), [], 'nothing saved after Clear data');

    // Nothing saved: Show demo data, which opens Schoology with the made-up family.
    await updateSettings(browser, { schoologyBase: base });
    await see(isShown, true, 'Show demo data shown', '#demo-mode-btn');
    const before = await browser.getWindowHandles();
    await realClickDashboard(browser, '#demo-mode-btn');
    await see((root, q) => q('button').some((b) => b.textContent.trim() === 'Exit demo mode' && shown(b)), true, 'Exit demo mode button on the settings page');
    await see(prop, false, 'Clear data… enabled in demo mode', '#clear-btn', 'disabled');
    await switchToNewWindow(browser, before);
    await waitForPanel(browser, (t) => t !== null, { timeout: 15_000, message: 'no panel on the demo Schoology page' });
    await see(samTab, true, 'Sam tab shown in the demo');
    await see(text, 'Exit demo mode', '.demo-banner', '.demo-banner');
    // Nothing read from Schoology: no signed-in person, no refresh.
    const readKeys = async () => (await storedKeys(browser)).filter((k) => k.startsWith('user@') || k.startsWith('refreshState@'));
    assert.deepEqual(await readKeys(), [], 'no user@ or refreshState@ in demo mode');

    // And no request reaches Schoology (the mock) from here on: not for the
    // panel's Refresh, nor for a page load.
    const requests = requestsTo(mock, '/');
    await inDashboard(browser, (root) => {
      window.__sgdRefreshDisabled = false;
      new MutationObserver(() => {
        if (root.querySelector('button[data-act="refresh"]')?.disabled) window.__sgdRefreshDisabled = true;
      }).observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled'] });
    });
    await clickDashboard(browser, 'button[data-act="refresh"]', { label: /^Refresh grades$/ });
    await see((root) => {
      const btn = root.querySelector('button[data-act="refresh"]');
      return Boolean(window.__sgdRefreshDisabled && btn && !btn.disabled && btn.getAttribute('aria-label') === 'Refresh grades');
    }, true, 'the Refresh press was answered (button disabled, then enabled again)');
    const answers = await browser.execute(async () => {
      const ask = async (message) => {
        const sender = { tab: { id: 1, index: 0, url: location.href } };
        for (const fn of globalThis.__sgdBus.listeners.background) {
          const r = fn(message, sender);
          if (r !== undefined) return await r;
        }
        return null;
      };
      return {
        refresh: await ask({ type: 'refresh-now', site: location.origin }),
        pageLoad: await ask({ type: 'schoology-page-loaded', url: location.href }),
      };
    });
    assert.deepEqual(answers.refresh, { ok: true, demo: true }, 'Refresh answers as demo mode');
    assert.equal(answers.pageLoad?.demo, true, `a page load answers as demo mode: ${JSON.stringify(answers.pageLoad)}`);
    assert.equal(requests.count(), 0, 'no request reached the mock in demo mode');
    assert.deepEqual(await readKeys(), [], 'still no user@ or refreshState@');

    // Exit demo mode: everything is cleared and the page reloads.
    await realClickDashboard(browser, 'button[data-act="exit-demo"]', { reloads: true });
    await waitFor(browser, async () => (await stored(browser, 'demoMode')) ?? null, null, 'demoMode cleared');
    await waitForPanel(browser, (t) => t !== null, { timeout: 15_000, message: 'no panel after Exit demo mode' });
    await see(count, 0, 'no demo banner after Exit demo mode', '.demo-banner');
  } finally {
    await onlyWindow(browser, main);
  }
}

test('settings page', { skip: skipReason(), timeout: 360_000 }, async (t) => {
  await sessionSuite(t, [
    ['settings page: one auto-saving page; students get no Family rules', autoSavingStudentPage],
    ['settings: Clear data asks in the page, greys out when empty; demo mode shows made-up students and reads nothing', clearDataAndDemo],
  ], { before: freshStart });
});
