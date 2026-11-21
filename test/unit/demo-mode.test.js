// Demo mode (src/demo-mode.js): offered only when nothing is saved; fills
// every Schoology site with the made-up family; leaving it clears all.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_SETTINGS } from '../../extension/src/rules.js';
import { enterDemoMode, exitDemoMode, isDemoMode, hasNoSavedData, demoSites, DEMO_KEY } from '../../extension/src/demo-mode.js';

const DEMO_JSON = readFileSync(new URL('../../extension/popup/demo-data.json', import.meta.url), 'utf8');

function fakeBrowser() {
  const store = new Map();
  return {
    store,
    runtime: { getURL: (p) => `chrome-extension://x/${p}` },
    storage: {
      local: {
        async get(k) {
          if (k === null) return Object.fromEntries(store);
          return store.has(k) ? { [k]: structuredClone(store.get(k)) } : {};
        },
        async set(obj) { for (const [k, v] of Object.entries(obj)) store.set(k, structuredClone(v)); },
        async remove(k) { store.delete(k); },
        async clear() { store.clear(); },
      },
    },
  };
}

describe('demo mode', () => {
  let browser;
  beforeEach(() => {
    browser = fakeBrowser();
    globalThis.browser = browser;
    vi.stubGlobal('fetch', async () => ({ json: async () => JSON.parse(DEMO_JSON) }));
  });
  afterEach(() => {
    delete globalThis.browser;
    vi.unstubAllGlobals();
  });

  it('counts as nothing saved: no keys, the default settings, or only the panel state', async () => {
    expect(await hasNoSavedData(browser)).toBe(true);
    await browser.storage.local.set({ settings: { ...DEFAULT_SETTINGS, schoologyBase: 'https://app.schoology.com' }, panelOpen: false });
    expect(await hasNoSavedData(browser)).toBe(true);
    await browser.storage.local.set({ settings: { ...DEFAULT_SETTINGS, gradeThreshold: 70 } });
    expect(await hasNoSavedData(browser)).toBe(false);
    await browser.storage.local.clear();
    await browser.storage.local.set({ 'dashboards@https://app.schoology.com': {} });
    expect(await hasNoSavedData(browser)).toBe(false);
  });

  it('fills every Schoology site with the made-up family and sets the flag', async () => {
    await enterDemoMode(browser);
    expect(await isDemoMode()).toBe(true);
    expect(browser.store.get(DEMO_KEY)).toBe(true);
    for (const site of demoSites()) {
      const d = browser.store.get(`dashboards@${site}`);
      expect(Object.keys(d).sort()).toEqual(['demo-jamie', 'demo-sam']);
      expect(Date.parse(d['demo-sam'].updatedAt)).toBeGreaterThan(Date.now() - 60000);
    }
    expect(demoSites()).toEqual(['https://app.schoology.com', 'https://schoology.npchristian.org']);
    expect(demoSites({ dev: true })).toContain('http://localhost:8123');
  });

  it('leaving demo mode clears everything', async () => {
    await enterDemoMode(browser);
    await exitDemoMode(browser);
    expect(browser.store.size).toBe(0);
    expect(await isDemoMode()).toBe(false);
    expect(await hasNoSavedData(browser)).toBe(true);
  });
});
