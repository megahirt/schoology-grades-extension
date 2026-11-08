// firefox-addon.js — load the unpacked extension into Playwright's Firefox
// and reach its background page.
//
// Playwright loads Chrome extensions with --load-extension but has no way
// to install a Firefox add-on, and its Firefox can't open moz-extension://
// pages (the popup and settings page). Firefox's own remote debugging
// protocol (RDP, what `web-ext run` and about:debugging use) can do both
// things the tests need:
//   - install the dev build folder as a temporary add-on, and
//   - run code in the add-on's background page (storage reads and writes),
// so Firefox starts with its debugger server on a free local port and the
// tests talk to it here. The dashboard itself is tested through the
// in-page panel on the mock Schoology pages, which renders the same view
// as the popup.

import net from 'node:net';

export async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// Prefs for launchPersistentContext({ firefoxUserPrefs }).
export const FIREFOX_PREFS = {
  'devtools.debugger.remote-enabled': true,
  'devtools.debugger.prompt-connection': false,
  'devtools.chrome.enabled': true,
  // Keep the MV3 event page loaded, so the background target stays put
  // between storage calls.
  'extensions.background.idle.enabled': false,
  // Let the screenshot test read the clipboard back without a paste prompt.
  'dom.events.testing.asyncClipboard': true,
};

// A minimal RDP client: packets are "<length>:<json>".
async function rdpConnect(port) {
  let lastErr;
  for (let i = 0; i < 50; i++) {
    try {
      return await new Promise((resolve, reject) => {
        const sock = net.connect(port, '127.0.0.1');
        let buf = Buffer.alloc(0);
        const listeners = new Set();
        sock.on('data', (chunk) => {
          buf = Buffer.concat([buf, chunk]);
          for (;;) {
            const colon = buf.indexOf(0x3a);
            if (colon < 0) break;
            const len = Number(buf.subarray(0, colon).toString());
            if (buf.length < colon + 1 + len) break;
            const msg = JSON.parse(buf.subarray(colon + 1, colon + 1 + len).toString());
            buf = buf.subarray(colon + 1 + len);
            for (const l of [...listeners]) l(msg);
          }
        });
        const client = {
          send(obj) {
            const s = JSON.stringify(obj);
            sock.write(`${Buffer.byteLength(s)}:${s}`);
          },
          wait(pred, timeout = 15000, what = 'an answer') {
            const err = new Error(`Firefox debugger: no ${what} in ${timeout} ms`);
            return new Promise((res, rej) => {
              const timer = setTimeout(() => {
                listeners.delete(l);
                rej(err);
              }, timeout);
              const l = (m) => {
                if (!pred(m)) return;
                clearTimeout(timer);
                listeners.delete(l);
                res(m);
              };
              listeners.add(l);
            });
          },
          async request(obj) {
            const answer = client.wait((m) => m.from === obj.to);
            client.send(obj);
            const m = await answer;
            if (m.error) throw new Error(`${m.error}: ${m.message || ''}`);
            return m;
          },
          listen(l) {
            listeners.add(l);
          },
          close: () => sock.destroy(),
        };
        sock.once('error', reject);
        sock.once('connect', () => {
          client.wait((m) => m.applicationType).then(() => resolve(client), reject);
        });
      });
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`Could not reach Firefox's debugger server on port ${port}: ${lastErr && lastErr.message}`);
}

// installAddon(port, folder) -> { id, evaluate(fn, arg) }.
// evaluate runs `fn(arg)` in the add-on's background page (it may be
// async) and returns its JSON-able result, like Playwright's
// worker.evaluate for the Chromium service worker.
export async function installAddon(port, addonPath) {
  const client = await rdpConnect(port);
  const root = await client.request({ to: 'root', type: 'getRoot' });
  const { addon } = await client.request({ to: root.addonsActor, type: 'installTemporaryAddon', addonPath });
  const { addons } = await client.request({ to: 'root', type: 'listAddons' });
  const desc = addons.find((a) => a.id === addon.id);
  if (!desc) throw new Error(`Add-on ${addon.id} was installed but is not listed`);
  const watcher = await client.request({ to: desc.actor, type: 'getWatcher', isServerTargetSwitchingEnabled: true });
  // Follow the background page: Firefox can replace it (a new target), so
  // keep the latest one and wait for it when there is none.
  const isBg = (t) => /^moz-extension:\/\/[^/]+\/_generated_background_page\.html/.test(String(t && t.url));
  let target = null;
  client.listen((m) => {
    if (m.type === 'target-available-form' && isBg(m.target)) target = m.target;
    if (m.type === 'target-destroyed-form' && target && m.target && m.target.actor === target.actor) target = null;
  });
  client.send({ to: watcher.actor, type: 'watchTargets', targetType: 'frame' });

  async function currentTarget() {
    for (let i = 0; i < 150 && !target; i++) await new Promise((r) => setTimeout(r, 100));
    if (!target) throw new Error("The add-on's background page did not appear");
    return target;
  }

  async function evaluateOnce(text) {
    const t = await currentTarget();
    const started = client.wait((m) => (m.from === t.consoleActor && m.resultID) || (m.error && (m.from === t.consoleActor || m.from === 'root')), 15000, 'evaluation start');
    client.send({ to: t.consoleActor, type: 'evaluateJSAsync', text, mapped: { await: true } });
    const s = await started;
    if (s.error) {
      if (target === t) target = null; // stale: wait for the new one
      throw Object.assign(new Error(`${s.error}: ${s.message || ''}`), { stale: true });
    }
    try {
      return await client.wait((m) => m.type === 'evaluationResult' && m.resultID === s.resultID, 5000, `result for ${text.slice(0, 120)}`);
    } catch (e) {
      // Now and then Firefox starts an evaluation and never answers. The
      // tests only read and write storage, so asking again is safe.
      throw Object.assign(e, { stale: true });
    }
  }

  async function evaluate(fn, arg) {
    const text = `(async () => JSON.stringify(await (${fn})(${JSON.stringify(arg === undefined ? null : arg)}) ?? null))()`;
    let res;
    for (let attempt = 1; ; attempt++) {
      try {
        res = await evaluateOnce(text);
        break;
      } catch (e) {
        if (!e.stale || attempt >= 4) throw e;
      }
    }
    if (res.hasException) {
      const msg = (res.exception && res.exception.preview && res.exception.preview.message) || res.exceptionMessage || 'error';
      throw new Error(`Background evaluate failed: ${msg}`);
    }
    return typeof res.result === 'string' ? JSON.parse(res.result) : null;
  }
  return { id: addon.id, evaluate, close: () => client.close() };
}
