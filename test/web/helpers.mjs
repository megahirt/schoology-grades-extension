// Helpers for the web feature suite (test/web/*.web.mjs).
//
// The suite runs the extension's real code as a web app (npm run build:web →
// dist-web/, served by the mock server at /__ext/ and added to every mock
// page) in a real browser driven by webdriverio:
//   npm run test:web            Chrome (headless)
//   npm run test:web:firefox    Firefox (headless)
//   npm run test:safari         Safari (macOS; safaridriver)
// One browser session per test file. A session/driver error (never a failed
// assertion) is retried once in a fresh session, and the retry is logged.
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { startServer } from '../mock-server/server.js';

const run = promisify(execFile);
const WEB_EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist-web');

export const BROWSER = process.env.BROWSER || 'chrome';
// BROWSER_VERSION=stable (optional): webdriverio downloads that browser
// instead of using the installed one, e.g. when the installed Firefox has a
// half-applied update and hangs at start under geckodriver.
const BROWSER_VERSION = process.env.BROWSER_VERSION || '';
export const HAS_WEB_BUILD = existsSync(path.join(WEB_EXT, 'background.js'));

// The DEV footer's build stamp of dist-web/ ("11/21 19:48", formatted as
// dashboard-view.js does). A panel with another stamp is a real extension
// loaded in the browser (e.g. a Safari temporary extension), whose content
// script also runs on localhost and replaces the web build's panel.
function webBuildStamp() {
  try {
    const v = JSON.parse(readFileSync(path.join(WEB_EXT, 'manifest.json'), 'utf8')).version_name || '';
    return v.includes('-dev.') ? v.split('-dev.')[1].replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2}).*$/, '$2/$3 $4:$5') : '';
  } catch {
    return '';
  }
}
const WEB_STAMP = HAS_WEB_BUILD ? webBuildStamp() : '';

// false, or why this suite can't run here (for node:test's `skip`).
export function skipReason() {
  if (!HAS_WEB_BUILD) return 'no dist-web/: run npm run build:web first';
  if (BROWSER === 'safari' && process.platform !== 'darwin') return 'Safari runs only on macOS';
  return false;
}

export function capabilitiesFor(browser) {
  switch (browser) {
    case 'chrome':
      // Headless Chrome's screen is 800×600 unless told otherwise: the panel
      // would take it for a phone (short side ≤ 600) and draw its phone sheet.
      return { browserName: 'chrome', 'goog:chromeOptions': { args: ['--headless=new', '--window-size=1280,900', '--screen-info={1920x1080}'] } };
    case 'firefox':
      return { browserName: 'firefox', 'moz:firefoxOptions': { args: ['-headless', '-width=1280', '-height=900'] } };
    case 'safari':
      return { browserName: 'safari' };
    default:
      throw new Error(`unknown BROWSER ${browser} (chrome, firefox or safari)`);
  }
}

// Every wait in this suite puts this prefix on its timeout message, so its
// timeouts are never mistaken for driver errors (the message may quote panel
// text, which could contain anything).
export const WAIT_PREFIX = '[web-wait]';

// A driver/session problem (worth one retry in a fresh session), as opposed
// to a failed assertion or a waitUntil timeout (a real failure: retrying it
// would hide a browser bug).
const SESSION_ERROR = [
  /session not created/i,
  /could not create a session/i,
  /timed out while connecting to a Safari instance/i,
  /invalid session id/i,
  /\bECONNREFUSED\b/,
  /\bECONNRESET\b/,
  // A WebDriver command that got no answer within connectionRetryTimeout.
  /\bETIMEDOUT\b/,
  /Request timed out!/,
];
export function isSessionError(err) {
  if (!err || typeof err !== 'object') return false;
  if (err.name === 'AssertionError' || err.code === 'ERR_ASSERTION') return false;
  const message = String(err.message || '');
  if (message.includes(WAIT_PREFIX) || /waitUntil condition timed out/i.test(message)) return false;
  if (/^(SessionNotCreatedError|InvalidSessionIdError)$/.test(err.name || '')) return true;
  const text = `${err.message || ''} ${err.code || ''} ${err.cause?.message || ''} ${err.cause?.code || ''}`;
  return SESSION_ERROR.some((re) => re.test(text));
}

async function safariRunning() {
  try {
    await run('pgrep', ['-x', 'Safari']);
    return true;
  } catch {
    return false;
  }
}

// safaridriver can't attach to a Safari the user started: new sessions time
// out while connecting to it. Only that error, with a Safari running, is a
// reason to quit Safari; any other session error just retries.
const SAFARI_CONNECT_TIMEOUT = [/timed out while connecting to a Safari instance/i, /Request timed out!/i];
export function shouldQuitSafari(err, safariIsRunning) {
  if (!safariIsRunning || !isSessionError(err)) return false;
  const text = `${err.message || ''} ${err.cause?.message || ''}`;
  return SAFARI_CONNECT_TIMEOUT.some((re) => re.test(text));
}

// Quit Safari and wait (up to 20 s) for it to exit.
async function quitSafari() {
  await run('osascript', ['-e', 'quit app "Safari"']).catch(() => {});
  const until = Date.now() + 20_000;
  while (Date.now() < until && (await safariRunning())) await new Promise((r) => setTimeout(r, 500));
  if (await safariRunning()) console.log('[web] WARNING: asked Safari to quit, but it is still running after 20 s; retrying anyway');
  else console.log('[web] quit Safari so safaridriver can start its own');
}

async function attempt(fn, opts, n) {
  const { remote } = await import('webdriverio');
  // WebDriver classic in every browser (Safari has nothing else): with
  // WebDriver BiDi, webdriverio's execute never answers in a window the page
  // opened (window.open, as the print page is), seen in Chrome.
  const capabilities = { 'wdio:enforceWebDriverClassic': true, ...capabilitiesFor(BROWSER), ...(BROWSER_VERSION && { browserVersion: BROWSER_VERSION }) };
  const mock = await startServer(0, { webExt: WEB_EXT, delayMs: opts.delayMs || 0 });
  // Use localhost (not 127.0.0.1): the DEV build's host permission and
  // content-script match are for localhost.
  const base = `http://localhost:${mock.port}`;
  let browser;
  try {
    // No retries inside webdriverio: withSession's one logged retry is the
    // only one, and a hung session start fails within a minute. Note that
    // connectionRetryTimeout also caps EVERY WebDriver command at 60 s.
    try {
      browser = await remote({
        logLevel: 'error',
        connectionRetryCount: 0,
        connectionRetryTimeout: 60_000,
        capabilities,
      });
    } catch (e) {
      // webdriver rewrites session-start failures into plain Errors ("Unable
      // to connect…", "Request timed out!…"); any of them is a session error.
      throw Object.assign(new Error(`Could not create a session: ${e.message}`), { name: 'SessionNotCreatedError', cause: e });
    }
    await fn({ browser, base, mock, attempt: n });
  } finally {
    if (browser) await browser.deleteSession().catch(() => {});
    await mock.close();
  }
}

// Start the mock (serving dist-web/), open a browser session, run
// fn({ browser, base, mock, attempt }), and always close both. attempt is 1,
// or 2 on the one retry. opts.delayMs delays the mock's grade answers.
export async function withSession(fn, opts = {}) {
  try {
    await attempt(fn, opts, 1);
  } catch (err) {
    if (!isSessionError(err)) throw err;
    console.log(`[web] session error, retrying once: ${err.message}`);
    if (BROWSER === 'safari' && shouldQuitSafari(err, await safariRunning())) await quitSafari();
    await attempt(fn, opts, 2);
  }
}

// Start a scenario signed out, with empty storage (sessionSuite's before).
export async function freshStart({ browser, base }) {
  await browser.url(`${base}/login`);
  await browser.deleteCookies();
  await browser.execute(() => localStorage.clear());
}

// What a scenario's error means: 'rerun' (a session/driver error on the
// first attempt: the whole file runs again in a fresh session) or 'fail'
// (a failed assertion or wait, or any error on the retry).
export function scenarioOutcome(err, attemptNo) {
  return attemptNo === 1 && isSessionError(err) ? 'rerun' : 'fail';
}

// Run a file's scenarios as node:test subtests of `t`, all in one browser
// session (Safari allows one at a time). scenarios: [[name, fn(session)]].
// before(session) runs at the start of each one. A session/driver error in
// any scenario marks that subtest skipped ("rerun"), stops this attempt and
// reruns every scenario once in a fresh session (withSession logs it); a
// failed assertion or [web-wait] fails its subtest as usual, never rerun.
// opts.withSession is for unit tests.
export async function sessionSuite(t, scenarios, { before = async () => {}, withSession: run = withSession, ...opts } = {}) {
  await run(async (session) => {
    let rerun = null;
    for (const [name, fn] of scenarios) {
      await t.test(name, async (st) => {
        try {
          await before(session);
          await fn(session);
        } catch (err) {
          if (scenarioOutcome(err, session.attempt) !== 'rerun') throw err;
          rerun = err;
          st.skip(`session error, rerunning the file in a fresh session: ${err.message}`);
        }
      });
      if (rerun) throw rerun;
    }
  }, opts);
}

// Sign in to the mock as `persona`. The panel may open over the form, so fill
// and submit it from the page instead of clicking the button.
export async function signIn(browser, base, persona) {
  await browser.url(`${base}/login?as=${encodeURIComponent(persona)}`);
  await browser.execute(() => {
    document.querySelector('#username').value = 'testuser';
    document.querySelector('#password').value = 'testpass';
    document.querySelector('#login-submit').closest('form').submit();
  });
  await browser.waitUntil(async () => (await browser.getUrl()) === `${base}/home`, {
    timeout: 15_000,
    timeoutMsg: `${WAIT_PREFIX} sign-in as ${persona} did not reach ${base}/home`,
  });
}

// Merge `patch` into the extension's settings (the web shim keeps
// storage.local in localStorage, keys prefixed sgd:, JSON values).
export async function setSettings(browser, patch) {
  await browser.execute((p) => {
    let current = {};
    try {
      current = JSON.parse(localStorage.getItem('sgd:settings') || '{}') || {};
    } catch {}
    localStorage.setItem('sgd:settings', JSON.stringify({ ...current, ...p }));
  }, patch);
}

export function useMock(browser, base) {
  return setSettings(browser, { schoologyBase: base, showGoNoGo: true });
}

// The panel sheet's text with whitespace collapsed, or null when there is no panel.
export function panelText(browser) {
  return browser.execute(() => {
    const sheet = document.getElementById('sgd-panel-host')?.shadowRoot?.querySelector('.sheet');
    return sheet ? sheet.innerText.replace(/\s+/g, ' ').trim() : null;
  });
}

// Click the first button or link in the panel whose text or aria-label
// matches `re`. Returns whether one was found.
export function clickInPanel(browser, re) {
  return browser.execute(
    (source, flags) => {
      const root = document.getElementById('sgd-panel-host')?.shadowRoot;
      if (!root) return false;
      const match = new RegExp(source, flags);
      const el = [...root.querySelectorAll('button, a')].find((e) =>
        match.test(e.innerText || e.textContent || '') || match.test(e.getAttribute('aria-label') || ''),
      );
      el?.click();
      return Boolean(el);
    },
    re.source,
    re.flags,
  );
}

// The timeout message waitForPanel throws.
export const waitMessage = (message, text) => `${WAIT_PREFIX} ${message}; panel text: ${text}`;

// Each student card's verdict, in order: the NO-GO disc's aria-label
// ("NO-GO"), the UNKNOWN pill, "GO" for a card in the GO tone (the product
// shows no badge for GO, the quiet default), or "" for a card without a
// verdict (verdicts off). Read from the DOM, not innerText, which differs
// between browsers for the SVG disc.
export function panelVerdicts(browser) {
  return browser.execute(() => {
    const sheet = document.getElementById('sgd-panel-host')?.shadowRoot?.querySelector('.sheet');
    if (!sheet) return [];
    return [...sheet.querySelectorAll('.card')].map((card) => {
      const disc = card.querySelector('.card-head [role="img"][aria-label]');
      if (disc) return disc.getAttribute('aria-label');
      const pill = card.querySelector('.card-head .pill');
      if (pill) return pill.textContent.trim();
      return card.classList.contains('go') ? 'GO' : '';
    });
  });
}

// Wait until predicate(panelText) is true; returns that text.
export async function waitForPanel(browser, predicate, { timeout = 30_000, message } = {}) {
  let text = null;
  await browser.waitUntil(
    async () => {
      text = await panelText(browser);
      const stamp = text && / · built (\d\d\/\d\d \d\d:\d\d) UTC/.exec(text)?.[1];
      if (stamp && WEB_STAMP && stamp !== WEB_STAMP) {
        throw new Error(`${WAIT_PREFIX} the panel is from another build (built ${stamp} UTC, dist-web/ is ${WEB_STAMP}): ` +
          'an extension loaded in this browser runs on localhost too. Remove it (Safari: quit Safari, which drops temporary extensions) and run again.');
      }
      return Boolean(await predicate(text));
    },
    // A function, so the message quotes the panel text at the timeout.
    { timeout, interval: 250, timeoutMsg: () => waitMessage(message || 'panel condition not met', text) },
  );
  return text;
}

// Count the mock's requests whose URL starts with pathPrefix (from now on).
export function requestsTo(mock, pathPrefix) {
  let n = 0;
  mock.server.on('request', (req) => {
    if ((req.url || '').startsWith(pathPrefix)) n += 1;
  });
  return { count: () => n };
}

// ---- The dashboard, in the panel or on a page of its own ----
//
// The functions below work on "the dashboard": the panel's sheet on a mock
// Schoology page, or else the document (the dashboard page
// /__ext/popup/dashboard.html and the print page).

// Runs `fn(root, q, ...args)` in the page and returns its result (a Promise
// is awaited). root is the dashboard; q(selector, hasText?, scope = root)
// lists the elements matching selector whose textContent contains hasText.
// fn is sent as source: it can't use anything from this file, but it can
// call shown(el), defined beside it:
//   shown(el): el is shown, as Playwright's toBeVisible means it: a
//   non-empty box (getBoundingClientRect width and height > 0; this is 0
//   under any display:none ancestor), computed visibility is not
//   'hidden' or 'collapse', and el.checkVisibility() (where the browser
//   has it) is true, as Playwright checks: content inside a closed
//   <details> keeps a box in Chrome but is not shown.
// On an extension page (/__ext/…) a #sgd-panel-host is the panel of an
// extension loaded in the browser (e.g. a Safari temporary extension, whose
// content script runs on localhost too): that fails at once, since it would
// stand in for the page's own dashboard.
export function inDashboard(browser, fn, ...args) {
  return browser.execute(
    'if (location.pathname.startsWith("/__ext/") && document.getElementById("sgd-panel-host")) ' +
      `throw new Error(${JSON.stringify(`${WAIT_PREFIX} a panel (#sgd-panel-host) is on an extension page: an extension loaded in this browser runs on localhost. Remove it (Safari: quit Safari, which drops temporary extensions) and run again.`)});` +
      'const root = document.getElementById("sgd-panel-host")?.shadowRoot?.querySelector(".sheet") || document;' +
      'const q = (sel, has, scope = root) => [...scope.querySelectorAll(sel)].filter((e) => has == null || (e.textContent || "").includes(has));' +
      'const shown = (e) => { if (!e) return false; const r = e.getBoundingClientRect(); const v = getComputedStyle(e).visibility;' +
      ' return r.width > 0 && r.height > 0 && v !== "hidden" && v !== "collapse" && (!e.checkVisibility || e.checkVisibility()); };' +
      `return (${fn})(root, q, ...arguments);`,
    ...args,
  );
}

const show = (v) => (v instanceof RegExp ? String(v) : typeof v === 'function' ? 'a match' : JSON.stringify(v));
const matches = (expected, v) =>
  typeof expected === 'function' ? Boolean(expected(v))
    : expected instanceof RegExp ? typeof v === 'string' && expected.test(v)
      : JSON.stringify(v) === JSON.stringify(expected);

// Readers for inDashboard / expectDashboard (run in the page as
// (root, q, ...args); self-contained, since they are sent as source).
export const text = (root, q, sel, has) => { const e = q(sel, has)[0]; return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; };
export const count = (root, q, sel, has) => q(sel, has).length;
export const attr = (root, q, sel, has, name) => q(sel, has)[0]?.getAttribute(name) ?? null;
// Some shown element's text contains s (Playwright's getByText(s) ...
// toBeVisible). textContent, not innerText: innerText applies CSS
// text-transform (section headings are upper case).
/* global shown */
export const visible = (root, q, s) => {
  const norm = (e) => (e.textContent || '').replace(/\s+/g, ' ');
  const hits = q('*').filter((e) => norm(e).includes(s) && ![...e.children].some((c) => norm(c).includes(s)));
  return hits.some((e) => shown(e));
};
// The text of the first shown `sel` with `has` (or null).
export const shownText = (root, q, sel, has) => { const e = q(sel, has).find((x) => shown(x)); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; };
// How many `sel` with `has` are shown (see shown() at inDashboard).
export const shownCount = (root, q, sel, has) => q(sel, has).filter((e) => shown(e)).length;
// How many `inner` in the first `outer` with outerHas are shown (-1: no outer).
export const shownIn = (root, q, outer, outerHas, inner) => {
  const o = q(outer, outerHas)[0];
  return o ? [...o.querySelectorAll(inner)].filter((e) => shown(e)).length : -1;
};
// Within the first `outer` with outerHas: `inner`'s text (or null).
export const textIn = (root, q, outer, outerHas, inner) => {
  const o = q(outer, outerHas)[0];
  const e = o && o.querySelector(inner);
  return e ? e.textContent.replace(/\s+/g, ' ').trim() : null;
};
export const countIn = (root, q, outer, outerHas, inner) => { const o = q(outer, outerHas)[0]; return o ? o.querySelectorAll(inner).length : -1; };
export const attrIn = (root, q, outer, outerHas, inner, name) => q(outer, outerHas)[0]?.querySelector(inner)?.getAttribute(name) ?? null;

// Wait until read(root, q, ...args) (run by inDashboard) gives `expected`: a
// value (compared as JSON), a RegExp (for a string) or a predicate. Returns
// the value read. The timeout message quotes the last value.
export async function expectDashboard(browser, read, expected, message, { args = [], timeout = 15_000 } = {}) {
  let last;
  await browser.waitUntil(
    async () => {
      last = await inDashboard(browser, read, ...args);
      return matches(expected, last);
    },
    { timeout, interval: 200, timeoutMsg: () => `${WAIT_PREFIX} ${message}: expected ${show(expected)}, got ${JSON.stringify(last)}` },
  );
  return last;
}

// Click (element.click()) the first `selector` in the dashboard whose text
// contains hasText, or whose aria-label matches `label` (a RegExp), waiting
// for it to appear.
export async function clickDashboard(browser, selector, { hasText = null, label = null, within = null, withinText = null } = {}) {
  await expectDashboard(
    browser,
    (root, q, sel, has, src, flags, w, wHas) => {
      const scopes = w ? q(w, wHas) : [root];
      const re = src == null ? null : new RegExp(src, flags);
      const el = scopes.flatMap((s) => q(sel, has, s)).find((e) => !re || re.test(e.getAttribute('aria-label') || e.textContent || ''));
      el?.click();
      return Boolean(el);
    },
    true,
    `no ${selector}${hasText ? ` with "${hasText}"` : ''}${label ? ` labelled ${label}` : ''}${within ? ` in ${within}${withinText ? ` "${withinText}"` : ''}` : ''} to click`,
    { args: [selector, hasText, label?.source ?? null, label?.flags ?? '', within, withinText] },
  );
}

// The viewport point at (fx, fy) (fractions of its box) of the first
// `selector` in the dashboard with hasText, scrolled into view first.
async function pointIn(browser, selector, hasText, fx, fy) {
  const box = await expectDashboard(
    browser,
    (root, q, sel, has) => {
      const el = q(sel, has)[0];
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight };
    },
    // Its centre on screen (not, say, mid-way through the panel sliding in).
    (b) => b && b.w > 0 && b.h > 0 && b.x + b.w / 2 >= 0 && b.x + b.w / 2 < b.vw && b.y + b.h / 2 >= 0 && b.y + b.h / 2 < b.vh,
    `no visible ${selector}${hasText ? ` with "${hasText}"` : ''}`,
    { args: [selector, hasText] },
  );
  return { x: Math.round(box.x + box.w * fx), y: Math.round(box.y + box.h * fy) };
}

// Move the real pointer over the first `selector` (at fx, fy of its box).
export async function hoverDashboard(browser, selector, { hasText = null, fx = 0.5, fy = 0.5 } = {}) {
  const { x, y } = await pointIn(browser, selector, hasText, fx, fy);
  await browser.action('pointer').move({ x, y, origin: 'viewport' }).perform();
}

// A real click only reaches a page whose window is in front. On a Mac in
// use, another app can be in front of Safari (the page is then "hidden" and
// has no focus), and every pointer click is lost: bring the window forward
// first (switching to it is WebDriver's way; Safari also needs telling).
async function bringToFront(browser) {
  // Only Safari runs as a window on the desktop here (Chrome and Firefox are headless).
  if (BROWSER !== 'safari') return;
  const front = () => browser.execute(() => document.hasFocus() && document.visibilityState === 'visible');
  if (await front()) return;
  await browser.switchToWindow(await browser.getWindowHandle());
  if (!(await front())) await run('osascript', ['-e', 'tell application "Safari" to activate']).catch(() => {});
  await browser.waitUntil(front, { timeout: 5_000, interval: 100 }).catch(() => {});
  console.log(`[web] the browser window was not in front; brought it forward (${(await front()) ? 'now in front' : 'still not in front'})`);
}

// A real (trusted) pointer click on the first `selector`: for what needs a
// user's click, such as opening a window.
// It waits until a trusted click reached that element, and fails (with
// what was seen) if a click landed elsewhere. Safari sometimes delivers no
// click at all for the pointer action (no click event in the page, seen
// after other sessions' work in the same Safari): then, and only then, the
// click is sent again (at most 3 times, logged), since nothing happened.
// navigatesTo (a RegExp for the URL): the click follows a link in this tab,
// so the page that saw the click is gone: reaching that URL is the proof,
// and the function waits for it.
// reloads: the click reloads this page (same URL), which likewise ends the
// page that saw the click: a mark left in the page before the click being
// gone is the proof, and the function waits for it.
export async function realClickDashboard(browser, selector, { hasText = null, navigatesTo = null, reloads = false } = {}) {
  let seen = null;
  const arrived = async () => {
    if (navigatesTo) return navigatesTo.test(await browser.getUrl());
    if (reloads) return browser.execute(() => !window.__sgdBeforeReload).catch(() => false);
    return false;
  };
  // Already there: reaching it would prove nothing about the click.
  if (navigatesTo && await arrived()) throw new Error(`${WAIT_PREFIX} the page is already at ${navigatesTo} before clicking ${selector}`);
  if (reloads) await browser.execute(() => { window.__sgdBeforeReload = true; });
  for (let attempt = 1; attempt <= 3; attempt++) {
    await bringToFront(browser);
    const { x, y } = await pointIn(browser, selector, hasText, 0.5, 0.5);
    await inDashboard(browser, (root, q, sel) => {
      window.__sgdRealClick = [];
      document.addEventListener('click', (e) => {
        const hit = e.composedPath().find((el) => el instanceof Element && el.matches(sel));
        window.__sgdRealClick.push({ trusted: e.isTrusted, hit: Boolean(hit) });
      }, { capture: true, once: true });
    }, selector);
    await browser.action('pointer').move({ x, y, origin: 'viewport' }).down().up().perform();
    await browser.waitUntil(
      async () => {
        if (await arrived()) return true;
        seen = await browser.execute(() => window.__sgdRealClick || null);
        return Boolean(seen && seen.length);
      },
      { timeout: 3_000, interval: 100 },
    ).catch(() => {});
    if (await arrived()) return;
    if (seen && seen.some((c) => c.trusted && c.hit)) {
      if (!navigatesTo && !reloads) return;
      await browser.waitUntil(arrived, {
        timeout: 15_000, interval: 250, timeoutMsg: `${WAIT_PREFIX} a real click reached ${selector}, but the page did not ${navigatesTo ? `go to ${navigatesTo}` : 'reload'}`,
      });
      return;
    }
    if (seen && seen.length) break;
    const state = await browser.execute(() => ({ focus: document.hasFocus(), vis: document.visibilityState, iw: innerWidth, ih: innerHeight, sx: scrollX, sy: scrollY, at: (() => { const e = document.elementFromPoint(0, 0); return e ? e.tagName : null; })() })).catch(() => null);
    const rect = await browser.getWindowRect().catch(() => null);
    console.log(`[web] the click at ${x},${y} on ${selector} produced no click event (attempt ${attempt}); clicking again. page ${JSON.stringify(state)} window ${JSON.stringify(rect)}`);
  }
  throw new Error(`${WAIT_PREFIX} a real click did not reach ${selector}: clicks seen ${JSON.stringify(seen)}`);
}

// Write extension storage through the page's own browser.storage (the
// shim), so its onChanged listeners fire as they do for chrome.storage.
export function updateSettings(browser, patch) {
  return browser.execute(async (p) => {
    const { settings = {} } = await globalThis.browser.storage.local.get('settings');
    await globalThis.browser.storage.local.set({ settings: { ...settings, ...p } });
  }, patch);
}

// A refresh of `site` finished after `since` (page clock, ms) and the
// dashboard's button is enabled ("Refresh grades") again.
function refreshDoneSince(browser, site, since) {
  return inDashboard(
    browser,
    (root, q, s, after) => {
      let state = null;
      try {
        state = JSON.parse(localStorage.getItem(`sgd:refreshState@${s}`));
      } catch {}
      const btn = root.querySelector('button[data-act="refresh"]');
      return Boolean(state && !state.running && Date.parse(state.finishedAt) >= after
        && btn && !btn.disabled && btn.getAttribute('aria-label') === 'Refresh grades');
    },
    site,
    since,
  );
}

// Press the dashboard's Refresh button and wait until that refresh has
// finished and the button is enabled again. A refresh already running (the
// panel's automatic one on page load) is waited out first: the button is
// "Refreshing grades" (disabled) meanwhile. beforeClick() runs just before
// the click.
export async function refreshNow(browser, base, { beforeClick = () => {}, timeout = 30_000 } = {}) {
  let clickedAt = 0;
  await browser.waitUntil(
    async () => {
      beforeClick();
      clickedAt = await browser.execute(() => Date.now());
      return inDashboard(browser, (root) => {
        const btn = root.querySelector('button[data-act="refresh"]');
        if (!btn || btn.disabled || btn.getAttribute('aria-label') !== 'Refresh grades') return false;
        btn.click();
        return true;
      });
    },
    { timeout, interval: 250, timeoutMsg: `${WAIT_PREFIX} no enabled Refresh grades button in the dashboard` },
  );
  await browser.waitUntil(() => refreshDoneSince(browser, base, clickedAt), {
    timeout,
    interval: 250,
    timeoutMsg: `${WAIT_PREFIX} the clicked refresh did not finish`,
  });
}

// Switch to the window opened after `before` (getWindowHandles), waiting for
// it; returns its handle.
export async function switchToNewWindow(browser, before, { timeout = 15_000 } = {}) {
  let handle = null;
  await browser.waitUntil(
    async () => {
      handle = (await browser.getWindowHandles()).find((h) => !before.includes(h)) || null;
      return Boolean(handle);
    },
    { timeout, interval: 250, timeoutMsg: `${WAIT_PREFIX} no new window opened` },
  );
  await browser.switchToWindow(handle);
  return handle;
}
