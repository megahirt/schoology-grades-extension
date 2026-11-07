// schoology.test.js — unit tests for extension/src/schoology.js (SPEC:
// Schoology fetch layer). Runs against the mock server (test/mock-server/)
// started in-process on an ephemeral port, using real fetch with a small
// cookie jar so the mock login flow works like a browser session.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '../../extension/src/schoology.js';
import { startServer } from '../mock-server/server.js';

let mock;
let baseUrl;

// Minimal cookie jar: captures set-cookie on login, replays Cookie afterwards.
function jarredFetch(jar) {
  return async (url, init = {}) => {
    const headers = { ...(init.headers || {}) };
    if (jar.cookies.length) headers.cookie = jar.cookies.join('; ');
    const res = await fetch(url, { ...init, headers, redirect: 'manual' });
    const setCookie = res.headers.getSetCookie?.() || [];
    for (const c of setCookie) jar.cookies.push(c.split(';')[0]);
    // Follow redirects manually so the final URL is observable.
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (location) return jarredFetch(jar)(new URL(location, url).toString(), init);
    }
    return res;
  };
}

async function loginAs(persona) {
  const jar = { cookies: [] };
  const clientFetch = jarredFetch(jar);
  const res = await clientFetch(`${baseUrl}/login?as=${persona}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'username=test&password=test',
  });
  expect(res.status).toBe(200); // followed the redirect to /home
  expect(new URL(res.url).pathname).toBe('/home');
  return clientFetch;
}

beforeAll(async () => {
  mock = await startServer(0);
  baseUrl = mock.url;
});

afterAll(async () => {
  await mock.close();
});

describe('detectAccount', () => {
  it('returns parent with 2 children for the parent persona', async () => {
    const fetchImpl = await loginAs('parent');
    const client = createClient({ baseUrl, fetchImpl });
    const account = await client.detectAccount();
    expect(account.type).toBe('parent');
    expect(account.children).toHaveLength(2);
    expect(account.children.map((c) => c.name)).toEqual(['Luis Hirt', 'Emma Hirt']);
    expect(account.children[0].uid).toBe('uid-luis-hirt');
  });

  it('returns student for the student persona', async () => {
    const fetchImpl = await loginAs('student');
    const client = createClient({ baseUrl, fetchImpl });
    const account = await client.detectAccount();
    expect(account.type).toBe('student');
    expect(account.children).toEqual([]);
  });

  it('returns loggedOut with no session cookie', async () => {
    const client = createClient({ baseUrl, fetchImpl: fetch });
    const account = await client.detectAccount();
    expect(account.type).toBe('loggedOut');
  });
});

describe('fetchGradesPage', () => {
  it('returns loggedIn true with html containing a known assignment title', async () => {
    const fetchImpl = await loginAs('student');
    const client = createClient({ baseUrl, fetchImpl });
    const page = await client.fetchGradesPage(`${baseUrl}/course/1002/grades`);
    expect(page.loggedIn).toBe(true);
    expect(page.status).toBe(200);
    expect(page.html).toContain('Propaganda Script');
    expect(page.html).toContain('American Literature');
  });

  it('returns loggedIn false when not logged in (redirected to /login)', async () => {
    const client = createClient({ baseUrl, fetchImpl: fetch });
    const page = await client.fetchGradesPage(`${baseUrl}/course/1002/grades`);
    expect(page.loggedIn).toBe(false);
    expect(page.finalUrl).toContain('/login');
  });
});

describe('fetchParentDashboards', () => {
  it('returns one dashboard per child, labelled with its source', async () => {
    const fetchImpl = await loginAs('parent');
    const client = createClient({ baseUrl, fetchImpl });
    const dashboards = await client.fetchParentDashboards();
    expect(dashboards).toHaveLength(2);
    const luis = dashboards.find((d) => d.studentName === 'Luis Hirt');
    const emma = dashboards.find((d) => d.studentName === 'Emma Hirt');
    expect(luis).toBeDefined();
    expect(emma).toBeDefined();
    // Luis: 2 Missing items; Emma: 1 Missing item.
    expect(luis.summary.missingCount).toBe(2);
    expect(emma.summary.missingCount).toBe(1);
    expect(luis.summary.verdict.verdict).toBe('NO-GO');
    expect(emma.summary.verdict.verdict).toBe('GO');
    expect(luis.source).toBeTruthy();
    expect(emma.source).toBeTruthy();
  });
});
