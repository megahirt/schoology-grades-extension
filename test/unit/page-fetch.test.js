// page-fetch.test.js — reading Schoology from inside an open Schoology page
// (extension/src/page-fetch.js), for browsers whose background worker's
// requests reach Schoology without the sign-in (Safari).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { answerPageFetch, pageFetchVia, firstTabSender, readableTabs, PAGE_FETCH } from '../../extension/src/page-fetch.js';
import { createClient } from '../../extension/src/schoology.js';
import { startServer } from '../mock-server/server.js';

const SITE = 'https://app.schoology.com';

describe('answerPageFetch (content script)', () => {
  it('reads a page on its own site with the sign-in, GET only', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return { status: 200, url: `${SITE}/home`, text: async () => '<html>home</html>' };
    };
    const reply = await answerPageFetch({ type: PAGE_FETCH, url: `${SITE}/home`, accept: 'text/html' }, { origin: SITE, fetchImpl });
    expect(reply).toEqual({ status: 200, url: `${SITE}/home`, text: '<html>home</html>' });
    expect(calls).toEqual([{ url: `${SITE}/home`, init: { method: 'GET', credentials: 'include', headers: { Accept: 'text/html' } } }]);
  });

  it('refuses another site and a bad address without fetching', async () => {
    let fetched = false;
    const fetchImpl = async () => { fetched = true; return { status: 200, url: '', text: async () => '' }; };
    expect(await answerPageFetch({ url: 'https://evil.example/home' }, { origin: SITE, fetchImpl })).toEqual({ error: 'Another site' });
    expect(await answerPageFetch({ url: 'not a url' }, { origin: SITE, fetchImpl })).toEqual({ error: 'Bad address' });
    expect(fetched).toBe(false);
  });

  it('reports a failed request as an error', async () => {
    const fetchImpl = async () => { throw new Error('offline'); };
    expect(await answerPageFetch({ url: `${SITE}/home` }, { origin: SITE, fetchImpl })).toEqual({ error: 'offline' });
  });
});

describe('pageFetchVia (background)', () => {
  it('turns the page’s answer into what the Schoology client reads', async () => {
    const sent = [];
    const pageFetch = pageFetchVia(async (m) => {
      sent.push(m);
      return { status: 200, url: `${SITE}/iapi/parent/info`, text: '{"body":{"children":{}}}' };
    });
    const res = await pageFetch(`${SITE}/iapi/parent/info`, { credentials: 'include', headers: { Accept: 'application/json' } });
    expect(sent).toEqual([{ type: PAGE_FETCH, url: `${SITE}/iapi/parent/info`, accept: 'application/json' }]);
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.url).toBe(`${SITE}/iapi/parent/info`);
    expect(await res.json()).toEqual({ body: { children: {} } });
    expect(await res.text()).toBe('{"body":{"children":{}}}');
  });

  it('throws when the page reports an error or does not answer', async () => {
    await expect(pageFetchVia(async () => ({ error: 'Another site' }))(`${SITE}/home`)).rejects.toThrow('Another site');
    await expect(pageFetchVia(async () => undefined)(`${SITE}/home`)).rejects.toThrow('did not answer');
  });
});

describe('firstTabSender', () => {
  it('uses the first tab that answers, then keeps to it', async () => {
    const asked = [];
    const sendToTab = async (tabId) => {
      asked.push(tabId);
      if (tabId === 1) throw new Error('no receiver');
      if (tabId === 2) return undefined; // nothing listening
      return { status: 200, tab: tabId };
    };
    const send = firstTabSender([1, 2, 3, 4], sendToTab);
    expect(await send({})).toEqual({ status: 200, tab: 3 });
    expect(await send({})).toEqual({ status: 200, tab: 3 });
    expect(asked).toEqual([1, 2, 3, 3]);
  });

  it('passes over a tab that never answers', async () => {
    const sendToTab = (tabId) => (tabId === 1 ? new Promise(() => {}) : Promise.resolve({ status: 200, tab: tabId }));
    expect(await firstTabSender([1, 2], sendToTab, 20)({})).toEqual({ status: 200, tab: 2 });
    await expect(firstTabSender([1], sendToTab, 20)({})).rejects.toThrow('took too long');
  });

  it('throws when no tab answers', async () => {
    await expect(firstTabSender([], async () => ({}))({})).rejects.toThrow('No Schoology page is open');
    await expect(firstTabSender([1], async () => { throw new Error('gone'); })({})).rejects.toThrow('gone');
  });
});

describe('readableTabs', () => {
  it('keeps this site’s pages, not its sign-in page or other sites; active tab first', () => {
    const tabs = [
      { id: 1, url: `${SITE}/login?destination=home` },
      { id: 2, url: `${SITE}/home` },
      { id: 3, url: 'https://example.com/home' },
      { id: 4, url: `${SITE}/grades/grades`, active: true },
      { id: 5 },
    ];
    expect(readableTabs(tabs, SITE)).toEqual([4, 2]);
  });
});

// The whole point: with the background's own requests signed out, the same
// Schoology client reads a parent's children through a signed-in page.
describe('Schoology client through a page (mock server)', () => {
  let mock;
  beforeAll(async () => { mock = await startServer(0); });
  afterAll(async () => { await mock.close(); });

  it('a signed-out background sees no one; the page read finds the parent’s children', async () => {
    // The page's own fetch: signed in as the parent (a cookie jar).
    const login = await fetch(`${mock.url}/login?as=parent`, { method: 'POST', redirect: 'manual' });
    const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const signedIn = (url, init = {}) => fetch(url, { ...init, headers: { ...(init.headers || {}), cookie } });

    const background = createClient({ baseUrl: mock.url });
    expect((await background.detectAccount()).type).toBe('loggedOut');

    const send = (message) => answerPageFetch(message, { origin: mock.url, fetchImpl: signedIn });
    const viaPage = createClient({ baseUrl: mock.url, fetchImpl: pageFetchVia(send) });
    const account = await viaPage.detectAccount();
    expect(account.type).toBe('parent');
    expect(account.children.map((c) => c.name)).toEqual(['Sam Rivera', 'Jamie Rivera']);
  });
});
