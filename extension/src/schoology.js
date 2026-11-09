// schoology.js — Schoology fetch layer (no chrome/browser APIs; fetch is
// injectable for tests). Auth = the user's logged-in browser session cookies.
// NO Schoology REST API / OAuth, NO stored password. All requests use
// { credentials: 'include' }.
//
// Endpoints VERIFIED live on app.schoology.com with a parent account
// (2026-11-06); all are server-rendered, a plain fetch returns everything:
//
//   GET /iapi/parent/info
//       { response_code: 200, body: { session: { view_mode, view_child },
//         children: { "<uid>": { uid, username, profile_url, profile_tiny } } } }
//   GET /parent/home?child_uid=<uid>
//       switches the parent session's "viewing as" child (same as picking
//       the child in Schoology's own menu).
//   GET /parent/grades_attendance/grades
//       every course of the CURRENTLY VIEWED child on one page
//       (.gradebook-course blocks — see parser-core.js).
//   GET /course/<id>/student_grades
//       one course's Grades page (same markup).
//
// NOT verified (no student account was available): the student flow below
// reads /grades/grades, falling back to /course/<id>/student_grades for the
// courses linked from /home.
//
// Deliberately NOT used: /iapi/parent/overdue_submissions (live testing
// showed it omits teacher-marked Missing items and includes items that are
// not Missing) and /home/feed (submission events only).

import { parseGradesHtml } from './parser.js';
import { summarizeStudent, DEFAULT_SETTINGS } from './rules.js';

const DEFAULT_BASE_URL = 'https://app.schoology.com';

function stripTrailingSlash(u) {
  return String(u || '').replace(/\/+$/, '');
}

function isLoginPage(html, finalUrl) {
  if (finalUrl && /\/login(\b|\?|#|$)/i.test(finalUrl)) return true;
  if (!html) return false;
  return (
    /<form[^>]+(?:id|class)=["'][^"']*login/i.test(html) ||
    /<title>\s*Log in to Schoology/i.test(html)
  );
}

function getFinalUrl(res, fallbackUrl) {
  if (res && typeof res.url === 'string' && res.url) return res.url;
  return fallbackUrl;
}

function errMsg(e) {
  return String(e && e.message ? e.message : e);
}

// /iapi/parent/info -> { viewChild, children: [{ uid, name, pictureUrl }] }.
// Accepts the live shape (body.children keyed by uid) and a plain array.
export function normalizeParentInfo(json) {
  const body = json && typeof json === 'object' && json.body && typeof json.body === 'object' ? json.body : json || {};
  const raw = body.children;
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : [];
  const children = list
    .map((c) => {
      const uid = String(c.uid ?? c.id ?? c.user_id ?? '');
      const name = c.username || c.name || c.display_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Child';
      let pictureUrl = c.pictureUrl || c.picture_url || null;
      if (!pictureUrl && typeof c.profile_tiny === 'string') {
        const m = c.profile_tiny.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (m) pictureUrl = m[1].replace(/&amp;/g, '&');
      }
      return { uid, name, pictureUrl };
    })
    .filter((c) => c.uid);
  const session = body.session && typeof body.session === 'object' ? body.session : {};
  const viewChild = session.view_child != null ? String(session.view_child) : body.view_child != null ? String(body.view_child) : null;
  return { viewChild, children };
}

export function createClient({ baseUrl = DEFAULT_BASE_URL, fetchImpl = fetch } = {}) {
  const base = stripTrailingSlash(baseUrl) || DEFAULT_BASE_URL;
  const doFetch = (url, options = {}) => fetchImpl(url, { credentials: 'include', ...options });
  const readText = async (res) => {
    try {
      return typeof res.text === 'function' ? await res.text() : '';
    } catch {
      return '';
    }
  };
  const readJson = async (res) => {
    try {
      return typeof res.json === 'function' ? await res.json() : null;
    } catch {
      return null;
    }
  };

  // Best-effort display name from a logged-in page. Returns null when
  // nothing matches — callers fall back to 'Student'.
  function extractDisplayName(html) {
    if (!html) return null;
    const attr = html.match(/data-user-name=["']([^"']+)["']/i);
    if (attr && attr[1].trim()) return attr[1].trim();
    // Schoology's page settings (JSON in the page): …"uid":123,"name":"Sam Rivera",…
    // VERIFIED on a student's /home (a school's own Schoology address).
    const json = html.match(/"uid":\d+,"name":"((?:[^"\\]|\\.)+)"/);
    if (json) {
      try {
        const name = JSON.parse(`"${json[1]}"`).trim();
        if (name) return name;
      } catch {
        // not valid JSON text; try the next pattern
      }
    }
    const welcome = html.match(/Welcome,\s*([^<,\n\r]+)/i);
    if (welcome && welcome[1].trim()) return welcome[1].trim();
    return null;
  }

  // The signed-in user's picture, from the same page settings as the name:
  // …"uid":123,"name":"Sam Rivera","profilePictureUrl":"https:\/\/…",…
  function extractPictureUrl(html) {
    if (!html) return null;
    const m = html.match(/"uid":\d+,"name":"(?:[^"\\]|\\.)+","profilePictureUrl":"((?:[^"\\]|\\.)+)"/);
    if (!m) return null;
    try {
      const url = JSON.parse(`"${m[1]}"`);
      return /^https:\/\//i.test(url) ? url : null;
    } catch {
      return null;
    }
  }

  async function fetchPage(url) {
    const res = await doFetch(url, { headers: { Accept: 'text/html' } });
    const html = await readText(res);
    const finalUrl = getFinalUrl(res, url);
    return { status: res.status, finalUrl, html, loggedIn: !isLoginPage(html, finalUrl) };
  }
  // Kept under its old name for callers (probe, hidden-tab fallback).
  const fetchGradesPage = fetchPage;

  async function getParentInfo() {
    const res = await doFetch(`${base}/iapi/parent/info`, { headers: { Accept: 'application/json' } });
    const finalUrl = getFinalUrl(res, `${base}/iapi/parent/info`);
    if (/\/login(\b|\?|#|$)/i.test(finalUrl)) return { loggedOut: true, status: res.status, viewChild: null, children: [] };
    const json = res.status < 400 ? await readJson(res) : null;
    return { status: res.status, ...normalizeParentInfo(json) };
  }

  async function detectAccount() {
    const evidence = {};
    try {
      const info = await getParentInfo();
      evidence.parentInfoStatus = info.status;
      if (info.children.length > 0) {
        return { type: 'parent', children: info.children, studentName: null, evidence: { ...evidence, viewChild: info.viewChild } };
      }
      // A server error says nothing about the account type: don't fall
      // through and mistake a parent for a student.
      if (info.status >= 500) return { type: 'unknown', children: [], studentName: null, evidence };
      evidence.parentInfoChildren = 0;
    } catch (e) {
      evidence.parentInfoError = errMsg(e);
      return { type: 'unknown', children: [], studentName: null, evidence };
    }
    try {
      const home = await fetchPage(`${base}/home`);
      evidence.homeStatus = home.status;
      evidence.homeFinalUrl = home.finalUrl;
      if (!home.loggedIn) return { type: 'loggedOut', children: [], studentName: null, evidence };
      return { type: 'student', children: [], studentName: extractDisplayName(home.html) || 'Student', pictureUrl: extractPictureUrl(home.html), evidence };
    } catch (e) {
      evidence.homeError = errMsg(e);
      return { type: 'unknown', children: [], studentName: null, evidence };
    }
  }

  // runLiveProbe(gradesUrl, { assignmentTitle }) — evidence object for the
  // probe extension. Never guesses the grades URL.
  async function runLiveProbe(gradesUrl, { assignmentTitle = null } = {}) {
    const checkedAt = new Date().toISOString();
    try {
      const page = await fetchPage(gradesUrl);
      const html = page.html || '';
      const parsed = parseGradesHtml(html, { sourceUrl: page.finalUrl, baseUrl: base });
      const assignments = parsed.courses.flatMap((c) => c.assignments);
      return {
        status: page.status,
        finalUrl: page.finalUrl,
        loggedIn: page.loggedIn,
        bodyLength: html.length,
        containsAssignmentTitle: assignmentTitle != null ? html.includes(String(assignmentTitle)) : false,
        containsGrade: /class=["'][^"']*\bitem-row\b/.test(html),
        containsMissing: /exception-icon missing/.test(html),
        parsedCourses: parsed.courses.length,
        parsedAssignments: assignments.length,
        parsedMissing: assignments.filter((a) => a.status === 'missing').length,
        parseError: parsed.error || null,
        assignmentTitleChecked: assignmentTitle,
        checkedAt,
      };
    } catch (e) {
      return {
        status: null,
        finalUrl: gradesUrl,
        loggedIn: false,
        bodyLength: 0,
        containsAssignmentTitle: false,
        containsGrade: false,
        containsMissing: false,
        assignmentTitleChecked: assignmentTitle,
        checkedAt,
        error: errMsg(e),
      };
    }
  }

  function extractCourseIds(html) {
    const ids = [];
    const re = /href=["'][^"']*\/course\/(\d+)(?:\/|["'])/gi;
    let m;
    while ((m = re.exec(html || '')) !== null) if (!ids.includes(m[1])) ids.push(m[1]);
    return ids;
  }

  // Student flow (UNVERIFIED live — see header).
  async function fetchStudentDashboard({ turnedInIds } = {}) {
    const updatedAt = new Date().toISOString();
    const home = await fetchPage(`${base}/home`);
    if (!home.loggedIn) {
      return { courses: [], studentName: 'Student', parseWarnings: ['Not logged in to Schoology'], source: 'student', updatedAt, error: 'LOGGED_OUT' };
    }
    const studentName = extractDisplayName(home.html) || 'Student';
    const parseWarnings = [];
    const fetchedUrls = [];
    let courses = [];
    let source = 'student-grades-report';

    const report = await fetchPage(`${base}/grades/grades`);
    fetchedUrls.push(report.finalUrl);
    if (report.loggedIn && report.status < 400) {
      const parsed = parseGradesHtml(report.html, { sourceUrl: report.finalUrl, baseUrl: base });
      if (parsed.error) parseWarnings.push(`PARSE_EMPTY for ${report.finalUrl}`);
      else {
        courses = parsed.courses;
        parseWarnings.push(...parsed.parseWarnings);
      }
    }
    if (courses.length === 0) {
      source = 'student-course-pages';
      for (const id of extractCourseIds(home.html)) {
        const page = await fetchPage(`${base}/course/${id}/student_grades`);
        fetchedUrls.push(page.finalUrl);
        if (!page.loggedIn || page.status >= 400) continue;
        const parsed = parseGradesHtml(page.html, { courseId: id, sourceUrl: page.finalUrl, baseUrl: base });
        if (parsed.error) {
          parseWarnings.push(`PARSE_EMPTY for ${page.finalUrl}`);
          continue;
        }
        parseWarnings.push(...parsed.parseWarnings);
        courses.push(...parsed.courses);
      }
    }
    if (courses.length === 0) {
      return { courses: [], studentName, parseWarnings: [...parseWarnings, 'No grades found for this account'], source, updatedAt, fetchedUrls, error: 'NO_GRADES' };
    }
    const summary = summarizeStudent(courses, DEFAULT_SETTINGS, turnedInIds);
    return { courses, studentName, summary, parseWarnings, source, updatedAt, fetchedUrls };
  }

  // Parent flow: for each child, switch the viewed child, read that child's
  // whole grade report, and CONFIRM the session was still viewing that child
  // before and after the read. Anything unconfirmed gets verdict UNKNOWN —
  // a child is never shown another child's grades. The originally viewed
  // child is restored at the end.
  // onProgress({ done, total, label }) is called before each child and once
  // at the end (done === total), so the UI can show a progress bar.
  async function fetchParentDashboards({ turnedInIdsByStudent, onProgress } = {}) {
    const updatedAt = new Date().toISOString();
    const info = await getParentInfo();
    if (info.children.length === 0) return [];
    const originalChild = info.viewChild;
    const dashboards = [];
    const total = info.children.length + 1;
    const progress = (done, label) => {
      try {
        if (onProgress) onProgress({ done, total, label });
      } catch {
        // Progress reporting must never break a refresh.
      }
    };

    for (const [index, child] of info.children.entries()) {
      progress(index, `Reading ${child.name.split(' ')[0]}’s grades`);
      const parseWarnings = [];
      let courses = [];
      let error = null;
      const source = { gradesReport: false, attribution: null, url: `${base}/parent/grades_attendance/grades` };
      try {
        await doFetch(`${base}/parent/home?child_uid=${encodeURIComponent(child.uid)}`, { headers: { Accept: 'text/html' } });
        const before = await getParentInfo();
        if (before.loggedOut) {
          error = 'LOGGED_OUT';
          parseWarnings.push('Logged out of Schoology — sign in again, then Refresh.');
        } else if (before.viewChild !== child.uid) {
          error = 'NO_CHILD_ATTRIBUTION';
          parseWarnings.push(`Schoology did not switch to ${child.name} — verdict withheld rather than guessed.`);
        } else {
          const report = await fetchPage(source.url);
          const after = await getParentInfo();
          if (!report.loggedIn) {
            error = 'LOGGED_OUT';
            parseWarnings.push('Logged out of Schoology while reading grades.');
          } else if (after.viewChild !== child.uid) {
            error = 'NO_CHILD_ATTRIBUTION';
            parseWarnings.push(`The viewed child changed while reading ${child.name}'s grades (another tab?) — verdict withheld.`);
          } else {
            const parsed = parseGradesHtml(report.html, { sourceUrl: report.finalUrl, baseUrl: base });
            parseWarnings.push(...parsed.parseWarnings);
            if (parsed.error) error = parsed.error;
            else {
              // A parent can open a child's class grades only through
              // Schoology's preview link, which also switches the viewed
              // child (/course/<id>/student_grades is 403 for any other
              // child). Assignment links on the report already use it.
              courses = parsed.courses.map((c) => (c.id
                ? { ...c, url: `${base}/course/${encodeURIComponent(c.id)}/preview/${encodeURIComponent(child.uid)}/parent?url=course/${encodeURIComponent(c.id)}/student_grades` }
                : c));
              source.gradesReport = true;
              source.attribution = 'view-child-confirmed';
            }
          }
        }
      } catch (e) {
        error = 'FETCH_FAILED';
        parseWarnings.push(`Reading ${child.name}'s grades failed: ${errMsg(e)}`);
      }

      const turnedInIds = turnedInIdsByStudent ? turnedInIdsByStudent[child.uid] : undefined;
      let summary = summarizeStudent(courses, DEFAULT_SETTINGS, turnedInIds);
      if (error) {
        // Empty courses would recompute to a false GO — mark it UNKNOWN.
        summary = { ...summary, verdict: { verdict: 'UNKNOWN', reasons: ['Could not read this child’s grades.'] } };
      }
      dashboards.push({
        studentUid: child.uid,
        studentName: child.name,
        pictureUrl: child.pictureUrl,
        courses,
        summary,
        updatedAt,
        source,
        parseWarnings,
        error,
      });
    }

    progress(info.children.length, 'Finishing up');
    if (originalChild) {
      try {
        await doFetch(`${base}/parent/home?child_uid=${encodeURIComponent(originalChild)}`, { headers: { Accept: 'text/html' } });
      } catch {
        // Best effort: the parent's viewed child stays on the last child.
      }
    }
    return dashboards;
  }

  return { detectAccount, fetchGradesPage, fetchPage, fetchStudentDashboard, fetchParentDashboards, runLiveProbe };
}
