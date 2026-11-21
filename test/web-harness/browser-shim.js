// In-page stand-in for the browser extension APIs, used only by the web build
// (esbuild aliases `webextension-polyfill` to this file). It lets the
// extension's own background, content script and pages run inside ordinary
// web pages so the same feature tests can drive Safari, Chrome and Firefox.
//
// Each page loads two bundles (background + page), each with its own copy of
// this module. The copies talk through one shared object on globalThis
// (the "bus"), so messages go between the background and page roles just as
// they do in the extension, and a page's listeners never get its own messages.
//
// Only the APIs the product actually calls are covered; see the design doc
// docs/superpowers/specs/2026-11-21-safari-web-harness-design.md section 1.

const PREFIX = 'sgd:';
const TAB = (location) => ({ id: 1, index: 0, active: true, url: location.href });

export function getBus(globalObj = globalThis) {
  if (!globalObj.__sgdBus) {
    globalObj.__sgdBus = { listeners: { background: [], page: [] }, storageListeners: [] };
  }
  return globalObj.__sgdBus;
}

function event(list) {
  return {
    addListener: (fn) => { list.push(fn); },
    removeListener: (fn) => {
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    hasListener: (fn) => list.includes(fn),
  };
}

const noopEvent = () => event([]);

function fireChanged(bus, changes) {
  if (!Object.keys(changes).length) return;
  for (const fn of [...bus.storageListeners]) fn(changes, 'local');
}

const parse = (s) => (s == null ? undefined : JSON.parse(s));

// A write from another tab arrives as a `storage` event.
export function handleStorageEvent(bus, ev) {
  if (!ev.key || !ev.key.startsWith(PREFIX)) return;
  const change = {};
  const oldValue = parse(ev.oldValue);
  const newValue = parse(ev.newValue);
  if (oldValue !== undefined) change.oldValue = oldValue;
  if (newValue !== undefined) change.newValue = newValue;
  fireChanged(bus, { [ev.key.slice(PREFIX.length)]: change });
}

// The first listener that returns something other than undefined decides the
// answer; a Promise counts as an answer. No listeners at all is an error.
async function deliver(listeners, message, sender) {
  if (!listeners.length) {
    throw new Error('Could not establish connection. Receiving end does not exist.');
  }
  for (const fn of [...listeners]) {
    const result = fn(message, sender);
    if (result !== undefined) return result;
  }
  return undefined;
}

export function createBrowserShim({ role, bus, storage, manifest, location, open }) {
  const other = role === 'background' ? 'page' : 'background';
  const sender = () => ({ tab: { id: 1, index: 0, url: location.href } });

  const ownKeys = () => {
    const keys = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k.slice(PREFIX.length));
    }
    return keys;
  };
  const read = (key) => parse(storage.getItem(PREFIX + key));

  const local = {
    async get(keys) {
      const out = {};
      if (keys == null) {
        for (const k of ownKeys()) out[k] = read(k);
      } else if (typeof keys === 'string' || Array.isArray(keys)) {
        for (const k of [].concat(keys)) {
          const v = read(k);
          if (v !== undefined) out[k] = v;
        }
      } else {
        for (const [k, def] of Object.entries(keys)) {
          const v = read(k);
          out[k] = v !== undefined ? v : def;
        }
      }
      return out;
    },
    async set(items) {
      const changes = {};
      for (const [k, v] of Object.entries(items)) {
        const oldValue = read(k);
        const json = JSON.stringify(v);
        if (json === undefined) continue;
        storage.setItem(PREFIX + k, json);
        changes[k] = { newValue: JSON.parse(json) };
        if (oldValue !== undefined) changes[k].oldValue = oldValue;
      }
      fireChanged(bus, changes);
    },
    async remove(keys) {
      const changes = {};
      for (const k of [].concat(keys)) {
        const oldValue = read(k);
        if (oldValue === undefined) continue;
        storage.removeItem(PREFIX + k);
        changes[k] = { oldValue };
      }
      fireChanged(bus, changes);
    },
    async clear() {
      await local.remove(ownKeys());
    },
  };

  return {
    storage: { local, onChanged: event(bus.storageListeners) },
    runtime: {
      sendMessage: (message) => deliver(bus.listeners[other], message, sender()),
      onMessage: event(bus.listeners[role]),
      getURL: (p) => '/__ext/' + p,
      getManifest: () => manifest,
      openOptionsPage: async () => { open('/__ext/options/options.html'); },
      onInstalled: noopEvent(),
      onStartup: noopEvent(),
    },
    tabs: {
      sendMessage: (_id, message) => deliver(bus.listeners.page, message, sender()),
      query: async () => [TAB(location)],
      getCurrent: async () => TAB(location),
      create: async ({ url } = {}) => { open(url); },
      // Both forms are in use: update({ url }) and update(tabId, { url }).
      update: async (idOrProps, maybeProps) => {
        const props = (typeof idOrProps === 'object' && idOrProps !== null ? idOrProps : maybeProps) || {};
        if (props.url) location.assign(props.url);
      },
      reload: async () => { location.reload(); },
      remove: async () => {},
    },
    permissions: {
      contains: async () => true,
      request: async () => true,
      remove: async () => true,
      getAll: async () => ({ origins: manifest.host_permissions, permissions: manifest.permissions }),
      onAdded: noopEvent(),
      onRemoved: noopEvent(),
    },
    scripting: {
      registerContentScripts: async () => {},
      unregisterContentScripts: async () => {},
      getRegisteredContentScripts: async () => [],
      executeScript: async () => [],
    },
    alarms: {
      create: () => {},
      onAlarm: noopEvent(),
    },
  };
}

// Real-page wiring. The build-time defines are absent under vitest, so this
// only runs inside a browser bundle.
let shim = {};
if (typeof __WEB_ROLE__ !== 'undefined' && typeof window !== 'undefined') {
  globalThis.chrome ??= { runtime: { id: 'web-harness' } };
  const bus = getBus();
  shim = createBrowserShim({
    role: __WEB_ROLE__,
    bus,
    storage: localStorage,
    manifest: __WEB_MANIFEST__,
    location,
    open: (u) => window.open(u, '_blank'),
  });
  window.addEventListener('storage', (ev) => handleStorageEvent(bus, ev));
  // storage.js reads browser.storage from the global, which every real
  // browser running the extension provides. Both bundles share this global,
  // so the first one's shim is it; storage behaves the same in either role
  // (one localStorage, one bus). Safari gives ordinary web pages a `browser`
  // of its own ({ runtime, test }, no storage), so replace any global
  // without storage, not just a missing one.
  if (!globalThis.browser?.storage?.local) {
    Object.defineProperty(globalThis, 'browser', { value: shim, writable: true, configurable: true });
  }
}

export default shim;
