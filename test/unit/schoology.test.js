// schoology.test.js — unit tests for extension/src/schoology.js. Runs against
// the mock server (test/mock-server/), which serves the live Schoology
// markup and endpoint shapes, using real fetch with a small cookie jar so the
// mock login and child switching work like a browser session.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, normalizeParentInfo, extractUserUid } from '../../extension/src/schoology.js';
import { startServer } from '../mock-server/server.js';

let mock;
let baseUrl;

// Cookie jar: later Set-Cookie values replace earlier ones of the same name.
function jarredFetch(jar) {
  const f = async (url, init = {}) => {
    const headers = { ...(init.headers || {}) };
    const cookieHeader = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookieHeader) headers.cookie = cookieHeader;
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
  const jar = {};
  const clientFetch = jarredFetch(jar);
  const res = await clientFetch(`${baseUrl}/login?as=${persona}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'username=test&password=test',
  });
  expect(new URL(res.url).pathname).toBe('/home');
  return { fetchImpl: clientFetch, jar };
}

beforeAll(async () => {
  mock = await startServer(0);
  baseUrl = mock.url;
});

afterAll(async () => {
  await mock.close();
});

describe('normalizeParentInfo', () => {
  it('reads the live shape: body.children keyed by uid, session.view_child', () => {
    const info = normalizeParentInfo({
      response_code: 200,
      body: {
        session: { view_mode: 1, view_child: '11' },
        children: {
          11: { uid: 11, username: 'Kid One', profile_tiny: '<div><img src="https://x.test/a.png?x=1&amp;y=2"></div>' },
          12: { uid: 12, username: 'Kid Two' },
        },
      },
    });
    expect(info.viewChild).toBe('11');
    expect(info.children).toEqual([
      { uid: '11', name: 'Kid One', pictureUrl: 'https://x.test/a.png?x=1&y=2' },
      { uid: '12', name: 'Kid Two', pictureUrl: null },
    ]);
  });

  it('returns no children for an empty or unexpected response', () => {
    expect(normalizeParentInfo(null).children).toEqual([]);
    expect(normalizeParentInfo({ response_code: 403 }).children).toEqual([]);
  });
});

describe('detectAccount', () => {
  it('returns parent with both children for the parent persona', async () => {
    const { fetchImpl } = await loginAs('parent');
    const account = await createClient({ baseUrl, fetchImpl }).detectAccount();
    expect(account.type).toBe('parent');
    expect(account.children.map((c) => c.name)).toEqual(['Sam Rivera', 'Jamie Rivera']);
    expect(account.children[0].uid).toBe('2000001');
    expect(account.children[0].pictureUrl).toContain('2000001.png');
    // The parent's own id, not a child's: data is kept per signed-in person.
    expect(account.userUid).toBe('1000001');
  });

  it('returns student (with display name) for the student persona', async () => {
    const { fetchImpl } = await loginAs('student');
    const account = await createClient({ baseUrl, fetchImpl }).detectAccount();
    expect(account.type).toBe('student');
    expect(account.studentName).toBe('Alex Student');
    expect(account.userUid).toBe('3000001');
  });

  it('a second student on the same site has their own id', async () => {
    const { fetchImpl } = await loginAs('student2');
    const account = await createClient({ baseUrl, fetchImpl }).detectAccount();
    expect(account.studentName).toBe('Riley Student');
    expect(account.userUid).toBe('3000002');
  });

  it('returns loggedOut with no session cookie', async () => {
    const account = await createClient({ baseUrl, fetchImpl: fetch }).detectAccount();
    expect(account.type).toBe('loggedOut');
  });
});

describe('fetchGradesPage', () => {
  it('returns loggedIn true with the grades HTML', async () => {
    const { fetchImpl } = await loginAs('student');
    const page = await createClient({ baseUrl, fetchImpl }).fetchGradesPage(`${baseUrl}/course/1002/student_grades`);
    expect(page.loggedIn).toBe(true);
    expect(page.status).toBe(200);
    expect(page.html).toContain('Persuasive Essay Draft');
  });

  it('returns loggedIn false when redirected to /login', async () => {
    const page = await createClient({ baseUrl, fetchImpl: fetch }).fetchGradesPage(`${baseUrl}/course/1002/student_grades`);
    expect(page.loggedIn).toBe(false);
    expect(page.finalUrl).toContain('/login');
  });
});

describe('fetchStudentDashboard', () => {
  it('reads every course from the student grade report', async () => {
    const { fetchImpl } = await loginAs('student');
    const d = await createClient({ baseUrl, fetchImpl }).fetchStudentDashboard();
    expect(d.error).toBeUndefined();
    expect(d.studentName).toBe('Alex Student');
    expect(d.courses.map((c) => c.name)).toEqual(['Algebra 2', 'American Literature', 'United States History', 'Advisory 11']);
    expect(d.summary.missingCount).toBe(1);
    expect(d.summary.verdict.verdict).toBe('NO-GO');
    expect(d.summary.verdict.reasons.join(' ')).toContain('Low grades');
  });
});

describe('fetchParentDashboards', () => {
  it('returns one dashboard per child with only that child’s courses', async () => {
    const { fetchImpl } = await loginAs('parent');
    const dashboards = await createClient({ baseUrl, fetchImpl }).fetchParentDashboards();
    expect(dashboards).toHaveLength(2);
    const [sam, jamie] = dashboards;
    expect(sam.studentName).toBe('Sam Rivera');
    expect(sam.courses.map((c) => c.name)).toEqual(['American Literature', 'United States History', 'House Group 1']);
    expect(jamie.courses.map((c) => c.name)).toEqual(['07 English', '07 Math']);
    // Sam's Persuasive Essay Draft is Missing but has a submission, so it
    // waits on the teacher instead of counting as Missing.
    expect(sam.summary.missingCount).toBe(1);
    expect(sam.summary.waiting.map((a) => a.title)).toEqual(['Persuasive Essay Draft']);
    expect(jamie.summary.missingCount).toBe(1);
    expect(sam.summary.verdict.verdict).toBe('NO-GO');
    expect(jamie.summary.verdict.verdict).toBe('GO');
    expect(sam.source.attribution).toBe('view-child-confirmed');
    // Class links go through Schoology's parent preview link for that child.
    const lit = sam.courses.find((c) => c.name === 'American Literature');
    expect(lit.url).toBe(`${baseUrl}/course/${lit.id}/preview/2000001/parent?url=course/${lit.id}/student_grades`);
    expect(sam.error).toBeNull();
  });

  it('restores the child the parent was viewing before the refresh', async () => {
    const { fetchImpl, jar } = await loginAs('parent');
    await fetchImpl(`${baseUrl}/parent/home?child_uid=2000002`);
    await createClient({ baseUrl, fetchImpl }).fetchParentDashboards();
    expect(jar['mock-view-child']).toBe('2000002');
  });

  it('withholds the verdict (UNKNOWN) when Schoology does not switch to the child', async () => {
    const { fetchImpl } = await loginAs('parent');
    // A fetch that silently drops the child switch: every child reads as
    // whichever child the session was already viewing.
    const stuck = (url, init) => (String(url).includes('/parent/home?child_uid=') ? Promise.resolve(new Response('')) : fetchImpl(url, init));
    const dashboards = await createClient({ baseUrl, fetchImpl: stuck }).fetchParentDashboards();
    const jamie = dashboards.find((d) => d.studentName === 'Jamie Rivera');
    expect(jamie.error).toBe('NO_CHILD_ATTRIBUTION');
    expect(jamie.courses).toEqual([]);
    expect(jamie.summary.verdict.verdict).toBe('UNKNOWN');
  });
});

describe('runLiveProbe', () => {
  it('reports parsed counts from a real-markup Grades page', async () => {
    const { fetchImpl } = await loginAs('student');
    const ev = await createClient({ baseUrl, fetchImpl }).runLiveProbe(`${baseUrl}/course/1002/student_grades`, { assignmentTitle: 'Rhetoric Analysis' });
    expect(ev).toMatchObject({ loggedIn: true, containsAssignmentTitle: true, containsGrade: true, containsMissing: true, parsedMissing: 1 });
  });
});

describe('student name from Schoology\'s page settings', () => {
  it('reads "uid":…,"name":"…" when the page has no other name', async () => {
    const page = '<html><body><a href="/logout">Log out</a><script>jQuery.extend(Drupal.settings, {"s_common":{"user":{"uid":2000001,"name":"Sam Rivera","profilePictureUrl":"https:\\/\\/example.org\\/pictures\\/sam.png"}}});</script></body></html>';
    const fetchImpl = async (url) => {
      const u = String(url);
      if (u.endsWith('/iapi/parent/info')) return new Response('{}', { status: 403, headers: { 'Content-Type': 'application/json' } });
      return new Response(page, { status: 200, headers: { 'Content-Type': 'text/html' } });
    };
    const account = await createClient({ baseUrl: 'https://schoology.example.org', fetchImpl }).detectAccount();
    expect(account.type).toBe('student');
    expect(account.studentName).toBe('Sam Rivera');
    expect(account.pictureUrl).toBe('https://example.org/pictures/sam.png');
  });
});

describe('extractUserUid', () => {
  it('reads the signed-in person\'s own id from the page settings', () => {
    // A parent's page: the "uid","name" settings are the child being viewed.
    const page = '{"uid":2000001,"name":"Sam Rivera"} … "theme":"standard","userId":1000001,"locales":{} … "default_domain":"app.schoology.com","user":{"uid":"1000001","school_nid":"1"}';
    expect(extractUserUid(page)).toBe('1000001');
    expect(extractUserUid('"theme":"standard","userId":1000001,')).toBe('1000001');
    expect(extractUserUid('<html>no settings</html>')).toBe(null);
    expect(extractUserUid('')).toBe(null);
  });
});
