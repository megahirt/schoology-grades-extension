// Safari smoke test: the DEV build's in-page panel on the mock Schoology
// server, in real Safari, driven by safaridriver (WebDriver) via webdriverio.
//
//   npm run build:dev && SAFARI_E2E=1 npm run test:e2e:safari
//
// Playwright can't do this (its WebKit is not Safari and can't load Safari
// Web Extensions), and safaridriver can't install an extension
// (WebDriver BiDi `webExtension.install` is "domain not found" on Safari
// 27.2). But an extension that is already loaded in Safari also runs in the
// automation window. So this test needs, once per Safari launch (see
// test/README.md, "Safari"):
//   - Safari started BY safaridriver (quit Safari, run this test once: it
//     fails or skips, but Safari is now driver-launched). A Safari you opened
//     yourself makes every session time out.
//   - Settings → Developer → Add Temporary Extension… → pick dist/, and
//     allow it on localhost (open http://localhost:8123/login once).
//   - Settings → Developer → "Allow remote automation" on.
// Skipped unless SAFARI_E2E=1 on macOS. Uses port 8123 (the DEV build's
// "Use mock server" address), so stop `npm run mock-server` first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../mock-server/server.js';

const run = process.platform === 'darwin' && process.env.SAFARI_E2E === '1';
const BASE = 'http://localhost:8123';

test('Safari: the panel shows the parent dashboard from the mock server', { skip: !run && 'set SAFARI_E2E=1 on macOS (see test/README.md)', timeout: 120_000 }, async () => {
  const { remote } = await import('webdriverio');
  const mock = await startServer(8123);
  // Count the reads that only a working refresh makes, so a dashboard left
  // in storage by an earlier run can't pass the test.
  let parentInfoReads = 0;
  mock.server.on('request', (req) => {
    if (req.url.startsWith('/iapi/parent/info')) parentInfoReads += 1;
  });
  const browser = await remote({ logLevel: 'error', capabilities: { browserName: 'safari' } });
  try {
    // Sign in to the mock as the parent. The panel may open over the form,
    // so submit it from the page instead of clicking.
    await browser.url(`${BASE}/login?as=parent`);
    await browser.execute(() => {
      document.querySelector('#username').value = 'testuser';
      document.querySelector('#password').value = 'testpass';
      document.querySelector('#login-submit').closest('form').submit();
    });
    await browser.waitUntil(async () => (await browser.getUrl()) === `${BASE}/home`, { timeout: 10_000 });

    const panelText = () =>
      browser.execute(() => {
        const sheet = document.getElementById('sgd-panel-host')?.shadowRoot?.querySelector('.sheet');
        return sheet ? sheet.innerText.replace(/\s+/g, ' ') : null;
      });
    // The panel is there (the content script ran in Safari).
    await browser.waitUntil(async () => (await panelText()) !== null, { timeout: 10_000, timeoutMsg: 'no panel: is the DEV extension loaded and allowed on localhost?' });

    // Point it at the mock if it isn't yet (DEV footer switch), then Refresh.
    const clickButton = (match) =>
      browser.execute((source) => {
        const re = new RegExp(source, 'i');
        const btn = [...document.getElementById('sgd-panel-host').shadowRoot.querySelectorAll('button')].find((b) =>
          re.test(`${b.innerText} ${b.getAttribute('aria-label') || ''}`),
        );
        btn?.click();
        return Boolean(btn);
      }, match.source);
    if (await clickButton(/Use mock server/)) await browser.pause(2000);
    const before = parentInfoReads;
    assert.ok(await clickButton(/Refresh grades/), 'Refresh button in the panel');

    let text = '';
    await browser.waitUntil(
      async () => {
        text = (await panelText()) || '';
        return parentInfoReads > before && /Sam Rivera/.test(text) && /Jamie/.test(text);
      },
      { timeout: 30_000, interval: 1000, timeoutMsg: 'parent dashboard did not show' },
    );
    assert.match(text, /Data: Mock server/);
    assert.doesNotMatch(text, /Please log in to Schoology/);
    assert.match(text, /NO GO/);
  } finally {
    await browser.deleteSession();
    await mock.close();
  }
});
