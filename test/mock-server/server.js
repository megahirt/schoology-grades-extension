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
//   POST /login?as=student|parent            sets mock-session + mock-persona, redirects to /home
//   Any other request without the mock-session cookie redirects to /login.
//   GET  /home                               home page (student: course links)
//   GET  /grades/grades                      student: every course's grades
//   GET  /course/<id>/student_grades         one course's grades (student, or the parent's viewed child)
//   GET  /iapi/parent/info                   parent: { response_code, body: { session, children: {uid: {...}} } }
//   GET  /parent/home?child_uid=<uid>        parent: switch the viewed child (cookie mock-view-child)
//   GET  /parent/grades_attendance/grades    parent: every course of the viewed child
//
// Personas:
//   student — "Alex Student": Algebra 2 (68%, below 75), American
//             Literature (82%, 1 Missing), United States History (95%),
//             Advisory 11 (no grades — classifier bait).
//   parent  — "Sam Rivera" (2 Missing + a class at 55% => NO-GO) and
//             "Jamie Rivera" (1 Missing, all classes >= 90 => GO).

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderCourse, renderPage } from './markup.js';

export const DEFAULT_PORT = 8123;

const S1 = 'Semester 1: 8/24/26 - 12/19/26';
const SUBMITTED = 'This student has completed assignment submission';
const PENDING = 'This student has made a submission that has not been graded.';

function course(id, title, grade, items, { courseGrade = null } = {}) {
  return { id, title, courseGrade, periods: [{ id: `${id}1`, title: S1, grade, items }] };
}

const STUDENT = {
  name: 'Alex Student',
  courses: [
    course('1001', 'Algebra 2: Section 5', 68, [
      { id: '5001', title: 'Quadratics Quiz', kind: 'assessment', due: '10/20/26 11:59pm', score: 6, max: 10 },
      { id: '5002', title: 'Factoring Worksheet', kind: 'assignment', due: '10/27/26 11:59pm', score: 7, max: 10, note: SUBMITTED },
      { id: '5003', title: 'Practice Set (optional)', kind: 'assignment', due: '10/29/26 11:59pm', exception: 'excused' },
    ]),
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
const sendHtml = (res, status, html, headers) => send(res, status, 'text/html', html, headers);
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

function viewChild(cookies) {
  return PARENT.children.find((c) => c.uid === cookies['mock-view-child']) || PARENT.children[0];
}

const parentHref = (child, c) => (item) => `/course/${c.id}/preview/${child.uid}/parent?url=assignment/${item.id}`;

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const reqUrl = new URL(req.url, 'http://localhost');
      const pathname = reqUrl.pathname;
      const cookies = parseCookies(req);

      if (pathname === '/login') {
        const as = reqUrl.searchParams.get('as') === 'parent' ? 'parent' : 'student';
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

      if (cookies['mock-session'] !== '1') {
        redirect(res, '/login');
        return;
      }
      const persona = cookies['mock-persona'] === 'parent' ? 'parent' : 'student';

      if (pathname === '/home') {
        if (persona === 'parent') {
          sendHtml(res, 200, renderPage('Home', '<p>Parent home</p>'));
        } else {
          const links = STUDENT.courses.map((c) => `<li><a href="/course/${c.id}/materials">${c.title}</a></li>`).join('');
          sendHtml(res, 200, renderPage('Home', `<div data-user-name="${STUDENT.name}"><ul>${links}</ul></div>`));
        }
        return;
      }

      if (pathname === '/grades/grades' && persona === 'student') {
        sendHtml(res, 200, renderPage('Grades', STUDENT.courses.map((c) => renderCourse(c)).join('')));
        return;
      }

      const courseMatch = pathname.match(/^\/course\/(\d+)\/student_grades$/);
      if (courseMatch) {
        const id = courseMatch[1];
        if (persona === 'student') {
          const c = STUDENT.courses.find((x) => x.id === id);
          if (c) return sendHtml(res, 200, renderPage(c.title, renderCourse(c)));
        } else {
          const child = viewChild(cookies);
          const c = child.courses.find((x) => x.id === id);
          if (c) return sendHtml(res, 200, renderPage(c.title, renderCourse(c, { href: parentHref(child, c) })));
        }
        sendHtml(res, 403, renderPage('Access denied', '<p>Access denied</p>'));
        return;
      }

      if (pathname === '/iapi/parent/info') {
        if (persona !== 'parent') {
          sendJson(res, 403, { response_code: 403 });
          return;
        }
        const children = {};
        for (const c of PARENT.children) {
          children[c.uid] = {
            uid: Number(c.uid),
            username: c.name,
            profile_url: `/user/${c.uid}`,
            profile_tiny: `<div class=" profile-picture-wrapper"><div class="profile-picture"><img src="https://mock.schoology.test/pictures/${c.uid}.png" alt=""></div></div>`,
          };
        }
        sendJson(res, 200, { response_code: 200, body: { session: { view_mode: 1, view_child: viewChild(cookies).uid }, children } });
        return;
      }

      if (persona === 'parent' && pathname === '/parent/home') {
        const uid = reqUrl.searchParams.get('child_uid');
        const child = PARENT.children.find((c) => c.uid === uid);
        const headers = child ? { 'set-cookie': `mock-view-child=${child.uid}; Path=/` } : {};
        sendHtml(res, 200, renderPage('Home', '<p>Parent home</p>'), headers);
        return;
      }

      if (persona === 'parent' && pathname === '/parent/grades_attendance/grades') {
        const child = viewChild(cookies);
        sendHtml(res, 200, renderPage('Grades', child.courses.map((c) => renderCourse(c, { href: parentHref(child, c) })).join('')));
        return;
      }

      sendHtml(res, 404, '<h1>Not found</h1>');
    } catch (err) {
      send(res, 500, 'text/plain', `Mock server error: ${err.message}`);
    }
  });
}

export function startServer(port = DEFAULT_PORT) {
  const server = createServer();
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

// Run directly: `node test/mock-server/server.js` (PORT env, default 8123).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || DEFAULT_PORT);
  const { url } = await startServer(port);
  console.log(`Mock Schoology server listening on ${url}`);
}
