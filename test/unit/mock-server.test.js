// mock-server.test.js — unit tests for the mock Schoology server itself
// (test/mock-server/server.js). These do NOT depend on extension/src, so
// they verify the test harness (fixtures, personas, login flow) even while
// the extension code is still being built.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer } from '../mock-server/server.js';

let mock;
let baseUrl;

// Tiny cookie jar for fetch.
function jarredFetch(jar) {
  return async (url, init = {}) => {
    const headers = { ...(init.headers || {}) };
    if (jar.cookies.length) headers.cookie = jar.cookies.join('; ');
    const res = await fetch(url, { ...init, headers, redirect: 'manual' });
    for (const c of res.headers.getSetCookie?.() || []) jar.cookies.push(c.split(';')[0]);
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (location) return jarredFetch(jar)(new URL(location, url).toString(), init);
    }
    return res;
  };
}

async function loginAs(persona) {
  const jar = { cookies: [] };
  const f = jarredFetch(jar);
  const res = await f(`${baseUrl}/login?as=${persona}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'username=test&password=test',
  });
  expect(res.status).toBe(200);
  return f;
}

beforeAll(async () => {
  mock = await startServer(0);
  baseUrl = mock.url;
});

afterAll(async () => {
  await mock.close();
});

describe('mock server', () => {
  it('GET /login returns a login form', async () => {
    const res = await fetch(`${baseUrl}/login`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="login-form"');
  });

  it('requests without a session cookie redirect to /login', async () => {
    const res = await fetch(`${baseUrl}/home`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/login');
  });

  it('POST /login sets mock-session + mock-persona cookies and redirects to /home', async () => {
    const res = await fetch(`${baseUrl}/login?as=parent`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'username=a&password=b',
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/home');
    const cookies = res.headers.getSetCookie().join('; ');
    expect(cookies).toContain('mock-session=1');
    expect(cookies).toContain('mock-persona=parent');
  });

  it('student home lists Alex Student and 4 courses including the advisory', async () => {
    const f = await loginAs('student');
    const html = await (await f(`${baseUrl}/home`)).text();
    expect(html).toContain('Alex Student');
    expect(html).toContain('/course/1001/grades');
    expect(html).toContain('/course/1004/grades');
    expect(html).toContain('BPL Advisory 11');
  });

  it('student course page contains the fixture Missing marker (1x)', async () => {
    const f = await loginAs('student');
    const html = await (await f(`${baseUrl}/course/1002/grades`)).text();
    expect(html).toContain('Propaganda Script');
    expect(html.match(/exception-missing/g)).toHaveLength(1);
  });

  it('parent /iapi/parent/info returns 2 children', async () => {
    const f = await loginAs('parent');
    const info = await (await f(`${baseUrl}/iapi/parent/info`)).json();
    expect(info.view_mode).toBe(1);
    expect(info.children).toHaveLength(2);
    expect(info.children.map((c) => c.name)).toEqual(['Luis Hirt', 'Emma Hirt']);
  });

  it('student /iapi/parent/info returns no children', async () => {
    const f = await loginAs('student');
    const info = await (await f(`${baseUrl}/iapi/parent/info`)).json();
    expect(info.children).toEqual([]);
  });

  it('parent overdue endpoint: Luis 2 items, Emma 1 item', async () => {
    const f = await loginAs('parent');
    const luis = await (await f(`${baseUrl}/iapi/parent/overdue_submissions/uid-luis-hirt`)).json();
    const emma = await (await f(`${baseUrl}/iapi/parent/overdue_submissions/uid-emma-hirt`)).json();
    expect(luis.overdue).toHaveLength(2);
    expect(emma.overdue).toHaveLength(1);
  });

  it('parent grade report contains both children and 3 Missing markers', async () => {
    const f = await loginAs('parent');
    const html = await (await f(`${baseUrl}/parent/grades_attendance/grades`)).text();
    expect(html).toContain('Luis Hirt');
    expect(html).toContain('Emma Hirt');
    expect(html.match(/exception-missing/g)).toHaveLength(3);
  });

  it('unknown course id returns 404', async () => {
    const f = await loginAs('student');
    const res = await f(`${baseUrl}/course/999999/grades`);
    expect(res.status).toBe(404);
  });
});
