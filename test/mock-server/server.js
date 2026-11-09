// Mock Schoology server for tests (test/mock-server/server.js).
//
// Plain Node `http` server, no framework, ES modules. Serves HTML in the
// LIVE Schoology Grades structure (rendered by ./markup.js) and the live
// endpoint shapes used by extension/src/schoology.js. All people, courses
// and grades here are made-up test data.
//
// Port from PORT env (default 8123). Run directly:
//   node test/mock-server/server.js            (or: npm run mock-server)
// Or import for tests:
//   import { startServer } from './server.js';
//   const { url, close } = await startServer(0); // 0 = ephemeral port
//
// Routes:
//   GET  /login                              login form
//   POST /login?as=student|student2|parent   sets mock-session + mock-persona, redirects to /home
//   GET  /logout                             clears the session, redirects to /login
//   Any other request without the mock-session cookie redirects to /login.
//   Every signed-in page carries Schoology's page settings with the signed-in
//   person's own id (…"user":{"uid":"<uid>"…), as real Schoology does.
//   GET  /home                               home page (student: course links)
//   GET  /grades/grades                      student: every course's grades
//   GET  /course/<id>/student_grades         one course's grades (student, or the parent's viewed child)
//   GET  /iapi/parent/info                   parent: { response_code, body: { session, children: {uid: {...}} } }
//   GET  /parent/home?child_uid=<uid>        parent: switch the viewed child (cookie mock-view-child)
//   GET  /parent/grades_attendance/grades    parent: every course of the viewed child
//
// MOCK_DATA=showcase (or createServer({ dataset: 'showcase' })) swaps the
// personas below for the richer showcase data in ./showcase.js.
//
// Personas:
//   student — "Alex Student": Algebra 2 (Quarter 2 68%, below 75; Semester
//             1 74%, with real nested quarters), American
//             Literature (82%, 1 Missing), United States History (95%),
//             Advisory 11 (no grades — classifier bait).
//   student2 — "Riley Student", a second student signing in on the same
//             site: only Algebra 2 and United States History.
//   parent  — "Sam Rivera" (2 Missing + a class at 55% => NO-GO) and
//             "Jamie Rivera" (1 Missing, all classes >= 90 => GO).

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderCourse, renderPage } from './markup.js';
import { buildShowcase, SHOWCASE_ADMINS } from './showcase.js';

export const DEFAULT_PORT = 8123;

const S1 = 'Semester 1: 8/24/26 - 12/19/26';
const SUBMITTED = 'This student has completed assignment submission';
// Made-up class admins for the "Message the teacher" chooser.
const ADMIN_NAMES = { 9001: 'Ms. Teacher', 9100: 'Mr. Ortiz', 9301: 'Ms. Park', 9302: 'Mr. Chen', 9401: 'Mrs. Hall', 9402: 'Mr. Young' };
const CLASS_TEACHER = { 3001: 9301, 3002: 9302, 3101: 9401, 3102: 9402 };
function courseAdmins(courseId) {
  const t = CLASS_TEACHER[courseId];
  const list = t ? [9100, t] : [9001];
  return list.map((uid) => ({ uid: String(uid), name: ADMIN_NAMES[uid] }));
}

const PENDING = 'This student has made a submission that has not been graded.';

const Q1 = 'Quarter 1: 8/24/2026 - 10/14/2026';
const Q2 = 'Quarter 2: 10/19/2026 - 12/15/2026';

// quarters: { semester, q1 } — nest Quarter 1 and Quarter 2 inside Semester 1
// like live Schoology. `grade` is then the Quarter 2 grade (what GO/NO-GO
// uses) and `semester` the Semester 1 grade shown beside it.
function course(id, title, grade, items, { courseGrade = null, quarters = null } = {}) {
  if (!quarters) return { id, title, courseGrade, periods: [{ id: `${id}1`, title: S1, grade, items }] };
  return {
    id, title, courseGrade,
    periods: [
      { id: `${id}1`, title: S1, grade: quarters.semester, items: [] },
      { id: `${id}2`, title: Q1, grade: quarters.q1, parentId: `${id}1`, items: [] },
      { id: `${id}3`, title: Q2, grade, parentId: `${id}1`, items },
    ],
  };
}

const STUDENT = {
  name: 'Alex Student',
  courses: [
    course('1001', 'Algebra 2: Section 5', 68, [
      { id: '5001', title: 'Quadratics Quiz', kind: 'assessment', due: '10/20/26 11:59pm', score: 6, max: 10 },
      { id: '5002', title: 'Factoring Worksheet', kind: 'assignment', due: '10/27/26 11:59pm', score: 7, max: 10, note: SUBMITTED },
      { id: '5003', title: 'Practice Set (optional)', kind: 'assignment', due: '10/29/26 11:59pm', exception: 'excused' },
    ], { quarters: { semester: 74, q1: 80 } }),
    course('1002', 'American Literature: Section 4', 82, [
      { id: '5101', title: 'Persuasive Essay Draft', kind: 'assignment', due: '11/03/26 11:25am', exception: 'missing' },
      { id: '5102', title: 'Rhetoric Analysis', kind: 'assignment', due: '10/22/26 11:00am', score: 42, max: 50, note: SUBMITTED },
      { id: '5103', title: 'Vocabulary Quiz 7', kind: 'assessment', due: '10/24/26', score: 9, max: 10 },
      { id: '5104', title: 'Reading Response 3', kind: 'discussion', due: '10/15/26 12:30pm', score: 0, max: 5, hidden: true },
      { id: '5105', title: 'Poetry Journal', kind: 'assignment', due: '10/30/26 8:00am', note: PENDING, pending: true },
    ]),
    course('1003', 'United States History: Section 2', 95, [
      { id: '5201', title: 'Unit 3 Test', kind: 'assessment', due: '10/23/26 11:59pm', score: 95, max: 100 },
      { id: '5202', title: 'Map Project', kind: 'assignment', due: '10/16/26 11:59pm', letter: 'A' },
    ]),
    { id: '1004', title: 'Advisory 11: Section 1', courseGrade: null, periods: [] },
  ],
};

// A second student, for signing out and in as someone else.
const STUDENT2 = { name: 'Riley Student', courses: STUDENT.courses.filter((c) => c.id === '1001' || c.id === '1003') };
// Each persona's own Schoology user id (made up).
const USER_UID = { student: '3000001', student2: '3000002', parent: '1000001' };

const PARENT = {
  children: [
    {
      uid: '2000001',
      name: 'Sam Rivera',
      courses: [
        course('3001', 'American Literature: Section 4', 55, [
          { id: '6001', title: 'Persuasive Essay Draft', due: '11/03/26 11:25am', exception: 'missing', note: PENDING, pending: true },
          { id: '6002', title: 'Unit 2 Essay', due: '10/29/26 7:45am', exception: 'missing', hidden: true },
          { id: '6003', title: 'Character Map', due: '10/20/26 11:59pm', score: 5, max: 10 },
        ]),
        course('3002', 'United States History: Section 2', 88, [
          { id: '6101', title: 'Unit 3 Test', due: '10/23/26 11:59pm', score: 88, max: 100 },
        ]),
        { id: '3003', title: 'House Group 1: Section 1', courseGrade: null, periods: [] },
      ],
    },
    {
      uid: '2000002',
      name: 'Jamie Rivera',
      courses: [
        course('3101', '07 English: Section 3', 96, [
          { id: '7001', title: 'Poetry Analysis Essay', due: '10/27/26 7:45am', exception: 'missing' },
          { id: '7002', title: 'Grammar Check', due: '10/20/26 11:59pm', score: 10, max: 10 },
        ]),
        course('3102', '07 Math: Section 5', 92, [
          { id: '7101', title: 'Ratios Quiz', due: '10/21/26 11:59pm', score: 23, max: 25 },
        ]),
      ],
    },
  ],
};

function parseCookies(req) {
  const cookies = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name) cookies[name] = decodeURIComponent(rest.join('='));
  }
  return cookies;
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
  });
}

function send(res, status, type, body, headers = {}) {
  res.writeHead(status, { 'content-type': `${type}; charset=utf-8`, ...headers });
  res.end(body);
}
// Signed-in pages get Schoology's page settings with the person's own id.
const sendHtml = (res, status, html, headers) => send(res, status, 'text/html',
  res.mockUserUid ? String(html).replace('</body>', `<script>jQuery.extend(Drupal.settings, {"s_common":{"user":{"uid":"${res.mockUserUid}","school_nid":"1"}}});</script></body>`) : html,
  headers);
const sendJson = (res, status, obj) => send(res, status, 'application/json', JSON.stringify(obj));

function redirect(res, location, headers = {}) {
  res.writeHead(302, { location, ...headers });
  res.end();
}

function loginPage(as) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Log in to Schoology</title></head>
<body>
<h1>Mock Schoology Login</h1>
<form id="login-form" method="post" action="/login?as=${as}">
  <label>Username <input type="text" name="username" id="username"></label>
  <label>Password <input type="password" name="password" id="password"></label>
  <button type="submit" id="login-submit">Log in</button>
</form>
<p>Mock login — any credentials work. Persona: ${as}.</p>
</body></html>`;
}

function viewChild(cookies, parent = PARENT) {
  return parent.children.find((c) => c.uid === cookies['mock-view-child']) || parent.children[0];
}

const parentHref = (child, c) => (item) => `/course/${c.id}/preview/${child.uid}/parent?url=assignment/${item.id}`;

// delayMs: wait this long before answering the grade pages and child
// switches, like real Schoology, so the refresh banner and progress bar can be
// seen (MOCK_DELAY_MS env when run directly; 0 in tests).
// dataset: 'test' (the personas above, used by the tests) or 'showcase'
// (./showcase.js: richer data with dates relative to today, for the promo
// site screenshots; MOCK_DATA env when run directly).
export function createServer({ delayMs = 0, dataset = 'test' } = {}) {
  const showcase = dataset === 'showcase' ? buildShowcase() : null;
  const STUDENT_DATA_ALL = showcase ? showcase.student : STUDENT;
  const PARENT_DATA = showcase ? showcase.parent : PARENT;
  const adminsOf = showcase ? showcase.admins : courseAdmins;
  const adminNames = showcase ? SHOWCASE_ADMINS : ADMIN_NAMES;
  return http.createServer(async (req, res) => {
    if (delayMs > 0 && /\/(grades|parent\/home|course\/)/.test(req.url || '')) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
    try {
      const reqUrl = new URL(req.url, 'http://localhost');
      const pathname = reqUrl.pathname;
      const cookies = parseCookies(req);

      if (pathname === '/login') {
        const asParam = reqUrl.searchParams.get('as');
        const as = asParam === 'parent' || asParam === 'student2' ? asParam : 'student';
        if (req.method === 'POST') {
          await readBody(req);
          redirect(res, '/home', {
            'set-cookie': ['mock-session=1; Path=/; HttpOnly', `mock-persona=${as}; Path=/`],
          });
          return;
        }
        sendHtml(res, 200, loginPage(as));
        return;
      }

      if (pathname === '/logout') {
        redirect(res, '/login', { 'set-cookie': ['mock-session=; Path=/; Max-Age=0', 'mock-persona=; Path=/; Max-Age=0'] });
        return;
      }

      if (cookies['mock-session'] !== '1') {
        redirect(res, '/login');
        return;
      }
      const who = USER_UID[cookies['mock-persona']] ? cookies['mock-persona'] : 'student';
      const persona = who === 'parent' ? 'parent' : 'student';
      res.mockUserUid = USER_UID[who];
      // The second student (test data only): same routes, own name and classes.
      const STUDENT_DATA = who === 'student2' && !showcase ? STUDENT2 : STUDENT_DATA_ALL;

      if (pathname === '/home') {
        if (persona === 'parent') {
          sendHtml(res, 200, renderPage('Home', '<p>Parent home</p>'));
        } else {
          const links = STUDENT_DATA.courses.map((c) => `<li><a href="/course/${c.id}/materials">${c.title}</a></li>`).join('');
          sendHtml(res, 200, renderPage('Home', `<div data-user-name="${STUDENT_DATA.name}"><ul>${links}</ul></div>`));
        }
        return;
      }

      if (pathname === '/grades/grades' && persona === 'student') {
        sendHtml(res, 200, renderPage('Grades', STUDENT_DATA.courses.map((c) => renderCourse(c)).join('')));
        return;
      }

      const courseMatch = pathname.match(/^\/course\/(\d+)\/student_grades$/);
      if (courseMatch) {
        const id = courseMatch[1];
        if (persona === 'student') {
          const c = STUDENT_DATA.courses.find((x) => x.id === id);
          if (c) return sendHtml(res, 200, renderPage(c.title, renderCourse(c)));
        } else {
          const child = viewChild(cookies, PARENT_DATA);
          const c = child.courses.find((x) => x.id === id);
          if (c) return sendHtml(res, 200, renderPage(c.title, renderCourse(c, { href: parentHref(child, c) })));
        }
        sendHtml(res, 403, renderPage('Access denied', '<p>Access denied</p>'));
        return;
      }

      // A course page with Schoology's "Message Admins" link and the admins'
      // pictures, and the compose form it opens (for "Message the teacher").
      // The student's classes (1xxx) have one admin; the Rivera children's
      // classes (3xxx) also list a department admin who is on every one of
      // them, as live Schoology does.
      const coursePage = pathname.match(/^\/course\/(\d+)\/(materials|preview\/\d+\/parent)$/);
      if (coursePage) {
        const admins = adminsOf(coursePage[1]);
        const compose = `${persona === 'parent' ? '/parent' : ''}/messages/new/course/${coursePage[1]}?recipient_uids=${admins.map((a) => a.uid).join('%2C')}`;
        const pictures = admins.map((a) => `<div class="picture"><a href="/user/${a.uid}" title="${a.name}"><img alt="${a.name}"></a></div>`).join('');
        sendHtml(res, 200, renderPage('Course', `<h3><a href="/course/${coursePage[1]}/members" class="view-members">${admins.length} Admin${admins.length > 1 ? 's' : ''}</a> &sdot; <a href="${compose}" class="enrollment-members-message"><span class="message-icon"></span></a></h3><div class='picture_block clearfix'>${pictures}</div>`));
        return;
      }
      if (/^\/(parent\/)?messages\/new\/course\/\d+$/.test(pathname)) {
        const to = String(reqUrl.searchParams.get('recipient_uids') || '').split(',').map((uid) => adminNames[uid] || uid);
        sendHtml(res, 200, renderPage('Compose Message', `<form id="s-messaging-compose-enrollment-form" method="post"><div class="to">To: ${to.join(', ')}</div>` +
          '<input type="text" name="subject" value=""><textarea name="body"></textarea><input type="submit" name="op" value="Send"></form>'));
        return;
      }

      if (pathname === '/iapi/parent/info') {
        if (persona !== 'parent') {
          sendJson(res, 403, { response_code: 403 });
          return;
        }
        const children = {};
        for (const c of PARENT_DATA.children) {
          children[c.uid] = {
            uid: Number(c.uid),
            username: c.name,
            profile_url: `/user/${c.uid}`,
            profile_tiny: `<div class=" profile-picture-wrapper"><div class="profile-picture"><img src="https://mock.schoology.test/pictures/${c.uid}.png" alt=""></div></div>`,
          };
        }
        sendJson(res, 200, { response_code: 200, body: { session: { view_mode: 1, view_child: viewChild(cookies, PARENT_DATA).uid }, children } });
        return;
      }

      if (persona === 'parent' && pathname === '/parent/home') {
        const uid = reqUrl.searchParams.get('child_uid');
        const child = PARENT_DATA.children.find((c) => c.uid === uid);
        const headers = child ? { 'set-cookie': `mock-view-child=${child.uid}; Path=/` } : {};
        sendHtml(res, 200, renderPage('Home', '<p>Parent home</p>'), headers);
        return;
      }

      if (persona === 'parent' && pathname === '/parent/grades_attendance/grades') {
        const child = viewChild(cookies, PARENT_DATA);
        sendHtml(res, 200, renderPage('Grades', child.courses.map((c) => renderCourse(c, { href: parentHref(child, c) })).join('')));
        return;
      }

      sendHtml(res, 404, '<h1>Not found</h1>');
    } catch (err) {
      send(res, 500, 'text/plain', `Mock server error: ${err.message}`);
    }
  });
}

export function startServer(port = DEFAULT_PORT, { delayMs = 0, dataset = 'test' } = {}) {
  const server = createServer({ delayMs, dataset });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        port: address.port,
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

// Run directly: `node test/mock-server/server.js` (PORT env, default 8123;
// MOCK_DELAY_MS env, default 0, slows grade pages like real Schoology).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || DEFAULT_PORT);
  const delayMs = Number(process.env.MOCK_DELAY_MS || 0);
  const dataset = process.env.MOCK_DATA === 'showcase' ? 'showcase' : 'test';
  const { url } = await startServer(port, { delayMs, dataset });
  console.log(`Mock Schoology server listening on ${url}${delayMs ? ` (answers delayed ${delayMs} ms)` : ''}${dataset === 'showcase' ? ' (showcase data)' : ''}`);
}
