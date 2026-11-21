// Tests for the in-page stand-in for the extension APIs used by the web
// build (test/web-harness/browser-shim.js).
import { describe, it, expect } from 'vitest';
import { createBrowserShim, getBus, handleStorageEvent } from '../web-harness/browser-shim.js';

function fakeStorage() {
  const m = new Map();
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

const manifest = {
  host_permissions: ['https://*.schoology.com/*'],
  permissions: ['storage', 'alarms'],
};
const location = { href: 'http://localhost:3000/x', origin: 'http://localhost:3000', assign() {}, reload() {} };

function setup() {
  const bus = getBus({});
  const storage = fakeStorage();
  const opened = [];
  const make = (role) => createBrowserShim({
    role, bus, storage, manifest, location, open: (u) => opened.push(u),
  });
  return { bus, storage, opened, page: make('page'), background: make('background') };
}

describe('storage', () => {
  it('round-trips under the sgd: prefix', async () => {
    const { page, storage } = setup();
    await page.storage.local.set({ a: { b: 1 } });
    expect(storage.getItem('sgd:a')).toBe('{"b":1}');
    expect(await page.storage.local.get('a')).toEqual({ a: { b: 1 } });
  });

  it('drops undefined like chrome.storage', async () => {
    const { page } = setup();
    await page.storage.local.set({ a: { x: undefined, y: 1 } });
    expect(await page.storage.local.get('a')).toEqual({ a: { y: 1 } });
  });

  it('get supports null, string, array and defaults object', async () => {
    const { page } = setup();
    await page.storage.local.set({ a: 1, b: 2 });
    expect(await page.storage.local.get(null)).toEqual({ a: 1, b: 2 });
    expect(await page.storage.local.get('a')).toEqual({ a: 1 });
    expect(await page.storage.local.get(['a', 'z'])).toEqual({ a: 1 });
    expect(await page.storage.local.get({ a: 0, z: 9 })).toEqual({ a: 1, z: 9 });
  });

  it('remove and clear touch only sgd: keys', async () => {
    const { page, storage } = setup();
    storage.setItem('other', 'keep');
    await page.storage.local.set({ a: 1, b: 2 });
    await page.storage.local.remove('a');
    expect(await page.storage.local.get(null)).toEqual({ b: 2 });
    await page.storage.local.clear();
    expect(await page.storage.local.get(null)).toEqual({});
    expect(storage.getItem('other')).toBe('keep');
  });

  it('onChanged fires for both roles, with oldValue when there was one', async () => {
    const { page, background } = setup();
    const seen = [];
    page.storage.onChanged.addListener((c, area) => seen.push(['page', c, area]));
    background.storage.onChanged.addListener((c, area) => seen.push(['bg', c, area]));
    await background.storage.local.set({ k: 1 });
    expect(seen).toEqual([
      ['page', { k: { newValue: 1 } }, 'local'],
      ['bg', { k: { newValue: 1 } }, 'local'],
    ]);
    seen.length = 0;
    await page.storage.local.set({ k: 2 });
    expect(seen[0][1]).toEqual({ k: { oldValue: 1, newValue: 2 } });
  });

  it('onChanged fires for other tabs via handleStorageEvent', () => {
    const { bus, page } = setup();
    const seen = [];
    page.storage.onChanged.addListener((c, area) => seen.push([c, area]));
    handleStorageEvent(bus, { key: 'sgd:k', oldValue: '1', newValue: '{"a":2}' });
    handleStorageEvent(bus, { key: 'other', oldValue: null, newValue: '5' });
    expect(seen).toEqual([[{ k: { oldValue: 1, newValue: { a: 2 } } }, 'local']]);
  });

  it('removeListener stops delivery', async () => {
    const { page } = setup();
    const seen = [];
    const fn = (c) => seen.push(c);
    page.storage.onChanged.addListener(fn);
    page.storage.onChanged.removeListener(fn);
    await page.storage.local.set({ k: 1 });
    expect(seen).toEqual([]);
  });
});

describe('messaging', () => {
  it('sendMessage rejects with no listener at all', async () => {
    const { page } = setup();
    await expect(page.runtime.sendMessage({})).rejects.toThrow();
  });

  it('first non-undefined listener answer wins', async () => {
    const { page, background } = setup();
    background.runtime.onMessage.addListener(() => undefined);
    background.runtime.onMessage.addListener(() => Promise.resolve(7));
    background.runtime.onMessage.addListener(() => 99);
    expect(await page.runtime.sendMessage({})).toBe(7);
  });

  it('resolves undefined when every listener returns undefined', async () => {
    const { page, background } = setup();
    background.runtime.onMessage.addListener(() => undefined);
    expect(await page.runtime.sendMessage({})).toBeUndefined();
  });

  it("a page's own listeners never receive its own sendMessage", async () => {
    const { page, background } = setup();
    let got = false;
    page.runtime.onMessage.addListener(() => { got = true; return 1; });
    background.runtime.onMessage.addListener(() => 'bg');
    expect(await page.runtime.sendMessage({})).toBe('bg');
    expect(got).toBe(false);
  });

  it('sender carries the tab', async () => {
    const { page, background } = setup();
    let sender;
    background.runtime.onMessage.addListener((m, s) => { sender = s; return true; });
    await page.runtime.sendMessage({});
    expect(sender.tab).toEqual({ id: 1, index: 0, url: location.href });
  });

  it('messages and answers are serialized, not shared by reference', async () => {
    const { page, background } = setup();
    const received = [];
    const answer = { n: 1 };
    background.runtime.onMessage.addListener((m) => { received.push(m); return Promise.resolve(answer); });
    const msg = { a: { b: 1 }, skip: undefined };
    const got = await page.runtime.sendMessage(msg);
    expect(received[0]).toEqual({ a: { b: 1 } });
    expect(received[0]).not.toBe(msg);
    expect(got).toEqual(answer);
    expect(got).not.toBe(answer);
  });

  it('tabs.sendMessage reaches page listeners', async () => {
    const { page, background } = setup();
    let got;
    page.runtime.onMessage.addListener((m) => { got = m; return 'ok'; });
    expect(await background.tabs.sendMessage(1, { hi: 1 })).toBe('ok');
    expect(got).toEqual({ hi: 1 });
  });
});

describe('tabs, runtime, permissions', () => {
  it('tabs.query answers with this page', async () => {
    const { page } = setup();
    expect(await page.tabs.query({})).toEqual([
      { id: 1, index: 0, active: true, url: location.href },
    ]);
  });

  it('getURL, getManifest, permissions', async () => {
    const { page } = setup();
    expect(page.runtime.getURL('icons/x.png')).toBe(location.origin + '/__ext/icons/x.png');
    expect(page.runtime.getManifest()).toBe(manifest);
    expect(await page.permissions.contains({ origins: ['x'] })).toBe(true);
    expect(await page.permissions.getAll()).toEqual({
      origins: manifest.host_permissions,
      permissions: manifest.permissions,
    });
  });

  it('tabs.create and openOptionsPage open via open()', async () => {
    const { page, opened } = setup();
    await page.tabs.create({ url: 'http://a/' });
    await page.runtime.openOptionsPage();
    expect(opened).toEqual(['http://a/', '/__ext/options/options.html']);
  });

  it('tabs.update navigates in both argument forms', async () => {
    const bus = getBus({});
    const urls = [];
    const loc = { ...location, assign: (u) => urls.push(u), reload() {} };
    const shim = createBrowserShim({ role: 'page', bus, storage: fakeStorage(), manifest, location: loc, open() {} });
    await shim.tabs.update({ url: 'http://a/' });
    await shim.tabs.update(1, { url: 'http://b/' });
    await shim.tabs.update(1, {});
    expect(urls).toEqual(['http://a/', 'http://b/']);
  });

  it('tabs.remove closes the page only for its own tab id', async () => {
    let closed = 0;
    const shim = createBrowserShim({ role: 'page', bus: getBus({}), storage: fakeStorage(), manifest, location, open() {}, close: () => { closed += 1; } });
    await shim.tabs.remove(2);
    await shim.tabs.remove(undefined);
    expect(closed).toBe(0);
    await shim.tabs.remove((await shim.tabs.getCurrent()).id);
    await shim.tabs.remove([1]);
    expect(closed).toBe(2);
  });

  it('no-op APIs exist', async () => {
    const { page } = setup();
    const noop = () => {};
    page.alarms.create('a', {});
    page.alarms.onAlarm.addListener(noop);
    await page.scripting.registerContentScripts([]);
    expect(await page.scripting.getRegisteredContentScripts()).toEqual([]);
    page.runtime.onInstalled.addListener(noop);
    page.runtime.onStartup.addListener(noop);
    page.permissions.onAdded.addListener(noop);
    page.permissions.onRemoved.addListener(noop);
    await page.tabs.reload();
    expect(await page.tabs.getCurrent()).toEqual({ id: 1, index: 0, active: true, url: location.href });
  });
});
