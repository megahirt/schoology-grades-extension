// Mock Schoology server for tests (test/mock-server/server.js).
//
// Plain Node `http` server, no framework, ES modules. Serves FIXTURE HTML
// modelled on the known Schoology Grades structure — NOT verified live
// Schoology DOM (see SPEC.md and the header comment in each fixture file).
//
// Port from PORT env (default 8123). Run directly:
//   node test/mock-server/server.js            (or: npm run mock-server)
// Or import for tests:
//   import { startServer } from './server.js';
//   const { url, close } = await startServer(0); // 0 = ephemeral port
//
// Routes (see SPEC.md "Mock Schoology server"):
//   GET  /login                              login form
//   POST /login?as=student|parent            sets mock-session=1 + mock-persona,
//                                             redirects to /home
//   Any request without the mock-session cookie redirects to /login.
//   GET  /home                               course list (links to /course/<id>/grades)
//   GET  /course/<id>/grades                 fixture Grades HTML for that course
//   GET  /parent/grades_attendance/grades    parent grade report HTML (both children)
//   GET  /iapi/parent/info                   JSON { view_mode, view_child, children }
//   GET  /iapi/parent/overdue_submissions/<uid>  JSON overdue list for that child
//   GET  /home/feed?children=<uid>           JSON activity for that child
//
// Personas (chosen by ?as=student / ?as=parent on /login):
//   student — "Alex Student": Algebra 2 (68%, below 75), American Literature
//             (82%, 1 Missing), United States History (95%, clean), plus
//             BPL Advisory 11 (no period grade, almost no grades — classifier bait).
//   parent  — two children: "Luis Hirt" (2 Missing + a class at 55% => NO-GO)
//             and "Emma Hirt" (1 Missing, all classes >= 90 => GO).

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

export const DEFAULT_PORT = 8123;

// ---------------------------------------------------------------------------
// Persona data
// ---------------------------------------------------------------------------

const STUDENT = {
  name: 'Alex Student',
  courses: [
    { id: '1001', name: 'Algebra 2', fixture: 'student-grades-algebra2.html' },
    { id: '1002', name: 'American Literature', fixture: 'student-grades-american-literature.html' },
    { id: '1003', name: 'United States History', fixture: 'student-grades-us-history.html' },
    { id: '1004', name: 'BPL Advisory 11', fixture: 'student-grades-advisory.html' },
  ],
};

const PARENT = {
  children: [
    {
      uid: 'uid-luis-hirt',
      name: 'Luis Hirt',
      pictureUrl: 'https://mock.schoology.test/pictures/luis.png',
      courses: [
        { id: '8508768642', name: 'BPL American Literature', fixture: 'parent-grades-luis.html', section: 0 },
        { id: '8508768643', name: 'United States History', fixture: 'parent-grades-luis.html', section: 1 },
      ],
      overdue: [
        { assignment_id: '8631342075', title: 'Propaganda Script', course: 'BPL American Literature', due: '2026-11-03' },
        { assignment_id: '8631342080', title: 'Unit 2 Contexts Essay', course: 'BPL American Literature', due: '2026-11-05' },
      ],
    },
    {
      uid: 'uid-emma-hirt',
      name: 'Emma Hirt',
      pictureUrl: 'https://mock.schoology.test/pictures/emma.png',
      courses: [
        { id: '8508768650', name: '07 English', fixture: 'parent-grades-emma.html', section: 0 },
        { id: '8508768651', name: '07 Math', fixture: 'parent-grades-emma.html', section: 1 },
      ],
      overdue: [
        { assignment_id: '3001', title: 'Poetry Analysis Essay', course: '07 English', due: '2026-11-04' },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseCookies(req) {
  const cookies = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name) cookies[name] = decodeURIComponent(rest.join('='));
  }
  return cookies;
}

function getPersona(req) {
  const persona = parseCookies(req)['mock-persona'];
  return persona === 'parent' ? 'parent' : 'student';
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
  });
}

const fixtureCache = new Map();
async function readFixture(name) {
  if (!fixtureCache.has(name)) {
    fixtureCache.set(name, await readFile(path.join(FIXTURES_DIR, name), 'utf8'));
  }
  return fixtureCache.get(name);
}

// Extract a single <section class="course-grades">...</section> (0-based index)
// from a multi-section fixture file, wrapped as a standalone grades page.
function extractSection(html, index) {
  const sections = [...html.matchAll(/<section class="course-grades"[\s\S]*?<\/section>/g)].map((m) => m[0]);
  const section = sections[index];
  if (!section) return null;
  return `<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><title>Grades</title></head>\n<body>\n<div class="gradebook">\n${section}\n</div>\n</body>\n</html>\n`;
}

function sendHtml(res, status, html) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function redirect(res, location) {
  res.writeHead(302, { location });
  res.end();
}

function loginPage(reqUrl) {
  const as = reqUrl.searchParams.get('as') || 'student';
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Log in to Schoology (Mock)</title></head>
<body>
<h1>Mock Schoology Login</h1>
<form id="login-form" method="post" action="/login?as=${as}">
  <label>Username <input type="text" name="username" id="username"></label>
  <label>Password <input type="password" name="password" id="password"></label>
  <input type="hidden" name="as" value="${as}">
  <button type="submit" id="login-submit">Log in</button>
</form>
<p>Mock login — any credentials work. Persona: ${as}.</p>
</body>
</html>`;
}

function homePage(persona) {
  if (persona === 'parent') {
    const childrenHtml = PARENT.children.map((child) => `
      <section class="child" data-child-uid="${child.uid}">
        <h2>${child.name}</h2>
        <ul>
          ${child.courses.map((c) => `<li><a href="/course/${c.id}/grades">${c.name}</a></li>`).join('\n')}
        </ul>
      </section>`).join('\n');
    return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Home (Mock)</title></head>
<body>
<h1>Welcome, Parent</h1>
<p><a href="/parent/grades_attendance/grades">Grade Report</a></p>
${childrenHtml}
</body>
</html>`;
  }
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Home (Mock)</title></head>
<body>
<h1>Welcome, ${STUDENT.name}</h1>
<ul>
  ${STUDENT.courses.map((c) => `<li><a href="/course/${c.id}/grades">${c.name}</a></li>`).join('\n')}
</ul>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const reqUrl = new URL(req.url, 'http://localhost');
      const pathname = reqUrl.pathname;
      const cookies = parseCookies(req);

      // Login page / login submit: no session required.
      if (pathname === '/login') {
        if (req.method === 'POST') {
          const body = new URLSearchParams(await readBody(req));
          const persona = reqUrl.searchParams.get('as') || body.get('as') || 'student';
          const safePersona = persona === 'parent' ? 'parent' : 'student';
          res.writeHead(302, {
            'set-cookie': [
              'mock-session=1; Path=/; HttpOnly',
              `mock-persona=${safePersona}; Path=/`,
            ],
            location: '/home',
          });
          res.end();
          return;
        }
        sendHtml(res, 200, loginPage(reqUrl));
        return;
      }

      // Everything else requires the mock session cookie (mirrors real Schoology).
      if (cookies['mock-session'] !== '1') {
        redirect(res, '/login');
        return;
      }

      const persona = getPersona(req);

      if (pathname === '/home') {
        sendHtml(res, 200, homePage(persona));
        return;
      }

      const courseMatch = pathname.match(/^\/course\/([^/]+)\/grades$/);
      if (courseMatch) {
        const courseId = courseMatch[1];
        const allCourses = [
          ...STUDENT.courses.map((c) => ({ ...c, multi: false })),
          ...PARENT.children.flatMap((child) =>
            child.courses.map((c) => ({ ...c, multi: true }))),
        ];
        const course = allCourses.find((c) => c.id === courseId);
        if (!course) {
          sendHtml(res, 404, '<h1>Course not found</h1>');
          return;
        }
        const fixture = await readFixture(course.fixture);
        const html = course.multi
          ? extractSection(fixture, course.section)
          : fixture;
        if (!html) {
          sendHtml(res, 500, '<h1>Fixture section missing</h1>');
          return;
        }
        sendHtml(res, 200, html);
        return;
      }

      if (pathname === '/parent/grades_attendance/grades') {
        if (persona !== 'parent') {
          redirect(res, '/home');
          return;
        }
        sendHtml(res, 200, await readFixture('parent-grades-all.html'));
        return;
      }

      if (pathname === '/iapi/parent/info') {
        if (persona === 'parent') {
          sendJson(res, 200, {
            view_mode: 1,
            view_child: PARENT.children[0].uid,
            children: PARENT.children.map((c) => ({
              uid: c.uid,
              name: c.name,
              pictureUrl: c.pictureUrl,
            })),
          });
        } else {
          // A student account has no child profiles.
          sendJson(res, 200, { view_mode: 0, view_child: null, children: [] });
        }
        return;
      }

      const overdueMatch = pathname.match(/^\/iapi\/parent\/overdue_submissions\/([^/]+)$/);
      if (overdueMatch) {
        const child = PARENT.children.find((c) => c.uid === overdueMatch[1]);
        if (!child) {
          sendJson(res, 404, { error: 'unknown child uid' });
          return;
        }
        sendJson(res, 200, { uid: child.uid, overdue: child.overdue });
        return;
      }

      if (pathname === '/home/feed') {
        const uid = reqUrl.searchParams.get('children');
        const child = PARENT.children.find((c) => c.uid === uid);
        sendJson(res, 200, {
          uid: uid || null,
          feed: child
            ? child.overdue.map((o) => ({
                title: o.title,
                text: `${o.title} is overdue in ${o.course}.`,
              }))
            : [],
        });
        return;
      }

      sendHtml(res, 404, '<h1>Not found</h1>');
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`Mock server error: ${err.message}`);
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
