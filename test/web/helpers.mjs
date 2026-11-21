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
      return { browserName: 'chrome', 'goog:chromeOptions': { args: ['--headless=new', '--window-size=1280,900'] } };
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

async function attempt(fn, opts) {
  const { remote } = await import('webdriverio');
  const capabilities = { ...capabilitiesFor(BROWSER), ...(BROWSER_VERSION && { browserVersion: BROWSER_VERSION }) };
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
    await fn({ browser, base, mock });
  } finally {
    if (browser) await browser.deleteSession().catch(() => {});
    await mock.close();
  }
}

// Start the mock (serving dist-web/), open a browser session, run
// fn({ browser, base, mock }), and always close both. opts.delayMs delays the
// mock's grade answers.
export async function withSession(fn, opts = {}) {
  try {
    await attempt(fn, opts);
  } catch (err) {
    if (!isSessionError(err)) throw err;
    console.log(`[web] session error, retrying once: ${err.message}`);
    if (BROWSER === 'safari' && shouldQuitSafari(err, await safariRunning())) await quitSafari();
    await attempt(fn, opts);
  }
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
