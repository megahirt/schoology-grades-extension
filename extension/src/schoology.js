// schoology.js — Schoology fetch layer (no chrome/browser APIs; fetch is
// injectable for tests). Auth = the user's logged-in browser session cookies.
// NO Schoology REST API / OAuth, NO stored password. All requests use
// { credentials: 'include' }.
//
// NOTE: the exact student Grades page URL pattern was NOT verified from any
// source — runLiveProbe / fetchGradesPage NEVER guess a grades URL. The URL
// comes from the logged-in UI (content script captures it) or from storage
// set by the user.

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
    /name=["']pass["']/i.test(html) ||
    /action=["'][^"']*\/login["']/i.test(html) ||
    /Log in to Schoology/i.test(html)
  );
}

function getFinalUrl(res, fallbackUrl) {
  if (res && typeof res.url === 'string' && res.url) return res.url;
  if (res && res.headers && typeof res.headers.get === 'function') {
    // Some stubs expose the final URL via a header; ignore otherwise.
  }
  return fallbackUrl;
}

export function createClient({ baseUrl = DEFAULT_BASE_URL, fetchImpl = fetch } = {}) {
  const base = stripTrailingSlash(baseUrl) || DEFAULT_BASE_URL;
  const doFetch = async (url, options = {}) => {
    const res = await fetchImpl(url, { credentials: 'include', ...options });
    return res;
  };
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

  // Best-effort display-name extraction from a logged-in home page.
  // Patterns: "Welcome, Alex Student" heading, or a data-user-name attr.
  // Returns null when nothing matches — callers fall back to 'Student'.
  // Never guesses a name from a URL or a cookie.
  function extractDisplayName(html) {
    if (!html) return null;
    const welcome = html.match(/Welcome,\s*([^<,\n\r]+)/i);
    if (welcome && welcome[1] && welcome[1].trim()) return welcome[1].trim();
    const attr = html.match(/data-user-name=["']([^"']+)["']/i);
    if (attr && attr[1] && attr[1].trim()) return attr[1].trim();
    return null;
  }

  async function detectAccount() {
    const evidence = {};
    // Parent signal first: GET {base}/iapi/parent/info
    try {
      const res = await doFetch(`${base}/iapi/parent/info`, {
        headers: { Accept: 'application/json' },
      });
      evidence.parentInfoStatus = res.status;
      const data = await readJson(res);
      const childrenRaw = data && Array.isArray(data.children) ? data.children : null;
      if (childrenRaw && childrenRaw.length > 0) {
        const children = childrenRaw.map((c) => ({
          uid: String(c.uid ?? c.id ?? c.user_id ?? ''),
          name: c.name || c.display_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Child',
          pictureUrl: c.pictureUrl || c.picture_url || c.profile_pic || null,
        }));
        return {
          type: 'parent',
          children,
          studentName: null,
          evidence: { ...evidence, viewMode: data.view_mode, viewChild: data.view_child },
        };
      }
      evidence.parentInfoChildren = childrenRaw ? childrenRaw.length : 0;
    } catch (e) {
      evidence.parentInfoError = String(e && e.message ? e.message : e);
    }
    // Otherwise: fetch {base}/home — a logged-in page means a student
    // account (a parent with no children listed would land here too, but
    // the parent-info check above is the primary detector).
    try {
      const res = await doFetch(`${base}/home`, { headers: { Accept: 'text/html' } });
      const html = await readText(res);
      const finalUrl = getFinalUrl(res, `${base}/home`);
      evidence.homeStatus = res.status;
      evidence.homeFinalUrl = finalUrl;
      if (isLoginPage(html, finalUrl)) {
        return { type: 'loggedOut', children: [], studentName: null, evidence };
      }
      return { type: 'student', children: [], studentName: extractDisplayName(html) || 'Student', evidence };
    } catch (e) {
      evidence.homeError = String(e && e.message ? e.message : e);
      return { type: 'unknown', children: [], studentName: null, evidence };
    }
  }

  async function fetchGradesPage(url) {
    const res = await doFetch(url, { headers: { Accept: 'text/html' } });
    const html = await readText(res);
    const finalUrl = getFinalUrl(res, url);
    const loggedIn = !isLoginPage(html, finalUrl);
    return { status: res.status, finalUrl, html, loggedIn };
  }

  // runLiveProbe(gradesUrl, { assignmentTitle } = {})
  // Evidence object — never guesses the grades URL.
  async function runLiveProbe(gradesUrl, { assignmentTitle = null } = {}) {
    const checkedAt = new Date().toISOString();
    try {
      const page = await fetchGradesPage(gradesUrl);
      const html = page.html || '';
      const containsAssignmentTitle =
        assignmentTitle !== null && assignmentTitle !== undefined
          ? html.includes(String(assignmentTitle))
          : false;
      const containsGrade = /grade-score|grades-table|\b\d{1,3}\s*%/.test(html);
      const containsMissing = /missing/i.test(html);
      return {
        status: page.status,
        finalUrl: page.finalUrl,
        loggedIn: page.loggedIn,
        bodyLength: html.length,
        containsAssignmentTitle,
        containsGrade,
        containsMissing,
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
        error: String(e && e.message ? e.message : e),
      };
    }
  }

  function extractCourseGradesLinks(homeHtml) {
    const links = [];
    const seen = new Set();
    const re = /href=["']([^"']*\/course\/(\d+)\/grades[^"']*)["']/gi;
    let m;
    while ((m = re.exec(homeHtml)) !== null) {
      const href = m[1];
      const id = m[2];
      const url = href.startsWith('http') ? href : `${base}${href.startsWith('/') ? '' : '/'}${href}`;
      if (!seen.has(url)) {
        seen.add(url);
        links.push({ id, url });
      }
    }
    return links;
  }

  // Per-child course links from a parent home page: each child gets a
  // <section class="child" data-child-uid="..."> block listing that child's
  // course Grades links. Returns [{ uid, links: [{ id, url }] }].
  // Returns [] when the home page has no per-child sections — callers must
  // fall back to the combined report with section attribution, never guess.
  function extractChildCourseLinks(homeHtml) {
    const out = [];
    const sectionRe = /<section[^>]*data-child-uid=["']([^"']+)["'][^>]*>([\s\S]*?)<\/section>/gi;
    let sm;
    while ((sm = sectionRe.exec(homeHtml || '')) !== null) {
      const uid = sm[1];
      const links = [];
      const seen = new Set();
      const re = /href=["']([^"']*\/course\/(\d+)\/grades[^"']*)["']/gi;
      let m;
      while ((m = re.exec(sm[2])) !== null) {
        const href = m[1];
        const id = m[2];
        const url = href.startsWith('http') ? href : `${base}${href.startsWith('/') ? '' : '/'}${href}`;
        if (!seen.has(url)) {
          seen.add(url);
          links.push({ id, url });
        }
      }
      out.push({ uid, links });
    }
    return out;
  }

  // Fetch + parse a list of per-course Grades pages. Shared by the student
  // flow and the parent per-child flow. Returns { courses, parseWarnings, fetchedUrls }.
  async function fetchCoursesForLinks(links) {
    const courses = [];
    const parseWarnings = [];
    const fetchedUrls = [];
    for (const link of links) {
      const page = await fetchGradesPage(link.url);
      fetchedUrls.push(page.finalUrl);
      if (!page.loggedIn) {
        parseWarnings.push(`Logged out while fetching ${link.url}`);
        continue;
      }
      const parsed = parseGradesHtml(page.html, { courseId: link.id, sourceUrl: page.finalUrl });
      if (parsed.error) {
        parseWarnings.push(`PARSE_EMPTY for ${link.url}`);
        continue;
      }
      parseWarnings.push(...parsed.parseWarnings);
      courses.push(...parsed.courses);
    }
    return { courses, parseWarnings, fetchedUrls };
  }

  // Student flow: /home -> per-course Grades pages -> parse -> summarize.
  async function fetchStudentDashboard({ turnedInIds } = {}) {
    const updatedAt = new Date().toISOString();
    const home = await fetchGradesPage(`${base}/home`);
    if (!home.loggedIn) {
      return { courses: [], studentName: 'Student', parseWarnings: ['Not logged in to Schoology'], source: 'student-grades-pages', updatedAt, error: 'LOGGED_OUT' };
    }
    const studentName = extractDisplayName(home.html || '') || 'Student';
    const links = extractCourseGradesLinks(home.html || '');
    if (links.length === 0) {
      return {
        courses: [],
        studentName,
        parseWarnings: ['No course Grades links found on the Schoology home page'],
        source: 'student-grades-pages',
        updatedAt,
        error: 'NO_GRADES_LINKS',
      };
    }
    const { courses, parseWarnings, fetchedUrls } = await fetchCoursesForLinks(links);
    const summary = summarizeStudent(courses, DEFAULT_SETTINGS, turnedInIds);
    return {
      courses,
      studentName,
      summary,
      parseWarnings,
      source: 'student-grades-pages',
      updatedAt,
      fetchedUrls,
    };
  }

  // Parent flow: /iapi/parent/info, then per child the parameterised
  // endpoints plus the parent grade report. Returns one dashboard object
  // per child, each labelled with which source supplied it.
  async function fetchParentDashboards({ turnedInIdsByStudent } = {}) {
    const updatedAt = new Date().toISOString();
    const infoRes = await doFetch(`${base}/iapi/parent/info`, {
      headers: { Accept: 'application/json' },
    });
    const info = await readJson(infoRes);
    const childrenRaw = info && Array.isArray(info.children) ? info.children : [];
    if (childrenRaw.length === 0) {
      return [];
    }
    const dashboards = [];
    // Primary per-child source: the parent home page lists each child's own
    // course Grades links, grouped by child UID. Fetch it once up front.
    let childLinksByUid = new Map();
    const homeWarnings = [];
    try {
      const homePage = await fetchGradesPage(`${base}/home`);
      if (homePage.loggedIn && homePage.html) {
        for (const entry of extractChildCourseLinks(homePage.html)) {
          childLinksByUid.set(entry.uid, entry.links);
        }
        if (childLinksByUid.size === 0) {
          homeWarnings.push('Parent home page has no per-child course sections — falling back to the combined grade report with section attribution.');
        }
      } else {
        homeWarnings.push('Could not read the parent home page (logged out?) — falling back to the combined grade report with section attribution.');
      }
    } catch (e) {
      homeWarnings.push(`Parent home page fetch failed: ${e.message || e} — falling back to the combined grade report with section attribution.`);
    }
    for (const child of childrenRaw) {
      const uid = String(child.uid ?? child.id ?? child.user_id ?? '');
      const name =
        child.name || child.display_name || [child.first_name, child.last_name].filter(Boolean).join(' ') || 'Child';
      const pictureUrl = child.pictureUrl || child.picture_url || child.profile_pic || null;
      const source = { overdue: false, feed: false, childCoursePages: false, gradesReport: false, attribution: null };
      const parseWarnings = [...homeWarnings];
      let courses = [];
      let overdueItems = [];
      let attributionError = null;

      try {
        const overdueRes = await doFetch(`${base}/iapi/parent/overdue_submissions/${uid}`, {
          headers: { Accept: 'application/json' },
        });
        const overdue = await readJson(overdueRes);
        if (overdue) {
          source.overdue = true;
          const list = Array.isArray(overdue) ? overdue : overdue.overdue || overdue.submissions || [];
          overdueItems = Array.isArray(list) ? list : [];
        }
      } catch (e) {
        parseWarnings.push(`overdue_submissions failed for ${name}: ${e.message || e}`);
      }

      try {
        const feedRes = await doFetch(`${base}/home/feed?children=${encodeURIComponent(uid)}`, {
          headers: { Accept: 'application/json' },
        });
        if (feedRes && feedRes.status < 400) source.feed = true;
        await readText(feedRes);
      } catch (e) {
        parseWarnings.push(`feed failed for ${name}: ${e.message || e}`);
      }

      // Grades for THIS child only. Primary: the child's own course pages
      // (links grouped by child UID on the parent home page). Fallback: the
      // combined parent grade report, filtered by the per-section attribution
      // the parser captures (data-child-uid / data-student). NEVER assign
      // unattributed courses to a child — withhold the verdict instead.
      const links = childLinksByUid.get(uid) || [];
      if (links.length > 0) {
        const fetched = await fetchCoursesForLinks(links);
        courses = fetched.courses;
        parseWarnings.push(...fetched.parseWarnings);
        source.childCoursePages = true;
        source.attribution = 'per-child-links';
      } else {
        try {
          const report = await fetchGradesPage(`${base}/parent/grades_attendance/grades`);
          if (report.loggedIn && report.html) {
            const parsed = parseGradesHtml(report.html, { sourceUrl: report.finalUrl });
            if (!parsed.error) {
              source.gradesReport = true;
              parseWarnings.push(...parsed.parseWarnings);
              const mine = parsed.courses.filter(
                (c) => c.childUid === uid || (c.studentName && c.studentName.toLowerCase() === name.toLowerCase()),
              );
              if (mine.length > 0) {
                courses = mine;
                source.attribution = 'report-section';
              } else if (parsed.courses.length > 0) {
                attributionError = 'NO_CHILD_ATTRIBUTION';
                parseWarnings.push(
                  `Grade report courses could not be attributed to ${name} — per-child verdict withheld rather than guessed.`,
                );
              } else {
                parseWarnings.push(`Parent grade report PARSE_EMPTY for ${name}`);
              }
            } else {
              parseWarnings.push(`Parent grade report PARSE_EMPTY for ${name}`);
            }
          } else if (!report.loggedIn) {
            parseWarnings.push(`Logged out while fetching parent grade report for ${name}`);
          }
        } catch (e) {
          parseWarnings.push(`grade report failed for ${name}: ${e.message || e}`);
        }
      }

      const turnedInIds = turnedInIdsByStudent ? turnedInIdsByStudent[uid] : undefined;
      let summary = summarizeStudent(courses, DEFAULT_SETTINGS, turnedInIds);
      if (attributionError) {
        // Empty courses would recompute to a false GO — mark it UNKNOWN.
        summary = {
          ...summary,
          verdict: { verdict: 'UNKNOWN', reasons: ['Could not read this child’s grades — courses could not be attributed to this child.'] },
        };
      }
      dashboards.push({
        studentUid: uid,
        studentName: name,
        pictureUrl,
        courses,
        summary,
        overdueItems,
        updatedAt,
        source,
        parseWarnings,
        error: attributionError,
      });
    }
    return dashboards;
  }

  return { detectAccount, fetchGradesPage, fetchStudentDashboard, fetchParentDashboards, runLiveProbe };
}
