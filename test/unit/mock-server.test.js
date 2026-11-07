// mock-server.test.js — unit tests for the mock Schoology server itself
// (test/mock-server/server.js): login flow, personas, live endpoint shapes.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer } from '../mock-server/server.js';

let mock;
let baseUrl;

function jarredFetch(jar) {
  const f = async (url, init = {}) => {
    const headers = { ...(init.headers || {}) };
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) headers.cookie = cookie;
    const res = await fetch(url, { ...init, headers, redirect: 'manual' });
    for (const c of res.headers.getSetCookie?.() || []) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      jar[pair.slice(0, i)] = pair.slice(i + 1);
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (location) return f(new URL(location, url).toString(), { ...init, method: 'GET', body: undefined });
    }
    return res;
  };
  return f;
}

async function loginAs(persona) {
  const f = jarredFetch({});
  const res = await f(`${baseUrl}/login?as=${persona}`, { method: 'POST', body: 'u=x' });
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

describe('mock Schoology server', () => {
  it('GET /login returns a login form', async () => {
    const html = await (await fetch(`${baseUrl}/login`)).text();
    expect(html).toContain('id="login-form"');
  });

  it('requests without a session cookie redirect to /login', async () => {
    const res = await fetch(`${baseUrl}/home`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/login');
  });

  it('POST /login sets the session + persona cookies and redirects to /home', async () => {
    const res = await fetch(`${baseUrl}/login?as=parent`, { method: 'POST', body: 'u=x', redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/home');
    const cookies = res.headers.getSetCookie().join('; ');
    expect(cookies).toContain('mock-session=1');
    expect(cookies).toContain('mock-persona=parent');
  });

  it('student grade report uses the live markup (gradebook-course, item-row, Missing exception)', async () => {
    const f = await loginAs('student');
    const html = await (await f(`${baseUrl}/grades/grades`)).text();
    expect(html.match(/class="gradebook-course /g)).toHaveLength(4);
    expect(html).toContain('class="report-row item-row');
    expect(html.match(/exception-icon missing/g)).toHaveLength(1);
  });

  it('parent /iapi/parent/info returns the live shape with two children', async () => {
    const f = await loginAs('parent');
    const info = await (await f(`${baseUrl}/iapi/parent/info`)).json();
    expect(info.response_code).toBe(200);
    expect(Object.values(info.body.children).map((c) => c.username)).toEqual(['Sam Rivera', 'Jamie Rivera']);
    expect(info.body.session.view_child).toBe('2000001');
  });

  it('student /iapi/parent/info is refused', async () => {
    const f = await loginAs('student');
    expect((await f(`${baseUrl}/iapi/parent/info`)).status).toBe(403);
  });

  it('/parent/home?child_uid switches which child the grade report shows', async () => {
    const f = await loginAs('parent');
    const first = await (await f(`${baseUrl}/parent/grades_attendance/grades`)).text();
    expect(first).toContain('Unit 2 Essay');
    await f(`${baseUrl}/parent/home?child_uid=2000002`);
    const second = await (await f(`${baseUrl}/parent/grades_attendance/grades`)).text();
    expect(second).toContain('Poetry Analysis Essay');
    expect(second).not.toContain('Unit 2 Essay');
    const info = await (await f(`${baseUrl}/iapi/parent/info`)).json();
    expect(info.body.session.view_child).toBe('2000002');
  });

  it('a course outside the viewed child returns 403', async () => {
    const f = await loginAs('parent');
    expect((await f(`${baseUrl}/course/3101/student_grades`)).status).toBe(403);
  });
});
