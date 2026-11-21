// assignment-page.js — what an assignment's own Schoology page says about
// handing it in. Used during a refresh for work that would otherwise be
// Overdue (past due, no grade, nothing submitted on the grades page): work
// that can't be submitted in Schoology (handed in on paper, say) isn't
// Overdue, and work the page shows as turned in isn't either.
//
// Checked live on app.schoology.com with a parent account (2026-11-21),
// from the raw HTML a fetch gets (no scripts run):
//
//   /assignment/<id>/info   the classic page (.assignment-details). Its
//       Submissions box (.drop-item-display-own) is there only when the
//       teacher turned on online submissions. Turned-in work is listed in
//       it (.dropbox-revisions, with /dropbox/view/ links).
//   /assignments/<id>/info  the newer page (Google Assignments and the
//       like): its data says "hasSubmissionsEnabled":true|false. Whether
//       anything was turned in isn't in the raw HTML.
//   tests (/assessment, /assessments/): attempts are drawn by script, so
//       nothing is known from the raw HTML.
//
// Anything not recognized says nothing (takesSubmissions: null), and the
// item stays Overdue: a wrong guess must never hide work that is due.

// readAssignmentPage(html, url) -> { page, takesSubmissions, submitted }
//   page              'classic' | 'new' | null (not recognized)
//   takesSubmissions  true | false | null (unknown)
//   submitted         true when the page lists turned-in work
export function readAssignmentPage(html, url) {
  const none = { page: null, takesSubmissions: null, submitted: false };
  if (!html || typeof html !== 'string') return none;
  let path = '';
  try {
    path = new URL(url).pathname;
  } catch {
    return none;
  }
  if (/^\/assignments\/\d+\/info\b/.test(path)) {
    const m = html.match(/"hasSubmissionsEnabled"\s*:\s*(true|false)/);
    return m ? { page: 'new', takesSubmissions: m[1] === 'true', submitted: false } : none;
  }
  if (/^\/assignment\/\d+\/info\b/.test(path) && /class="assignment-details"/.test(html)) {
    const box = /class="[^"]*\bdrop-item-display-own\b/.test(html);
    const submitted = box && /class="[^"]*\bdropbox-revisions\b/.test(html) && /\/dropbox\/view\//.test(html);
    return { page: 'classic', takesSubmissions: box, submitted };
  }
  return none;
}

// How long "can't be submitted" is trusted before the page is read again.
export const NO_SUBMISSIONS_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
// At most this many pages per child per refresh (the rest stay Overdue).
export const MAX_PAGE_CHECKS = 30;

// Would this item be Overdue without the page check? Past due (its due
// date and time), no grade, nothing submitted, not marked Missing or
// excused. The rules decide the rest (grading period, family marks).
export function needsPageCheck(a, now = Date.now()) {
  if (!a || !a.url || !a.id || a.submitted === true) return false;
  if (a.status !== 'overdue') return false;
  const t = Date.parse(a.due || '');
  return !Number.isNaN(t) && t < now;
}

// checkOverdueWork(courses, { fetchPage, known, now }) — reads the page of
// each item that would be Overdue, and marks it:
//   a.submitted = true            the page lists turned-in work
//   a.noSubmissions = true        it can't be submitted in Schoology
// `known` is { [assignmentId]: { at } } for items already found to take no
// submissions (kept per site); it is updated in place. Returns the number
// of pages read. Errors leave the item as it was.
export async function checkOverdueWork(courses, { fetchPage, known = {}, now = Date.now(), max = MAX_PAGE_CHECKS } = {}) {
  let reads = 0;
  for (const c of courses || []) {
    for (const a of c.assignments || []) {
      if (!needsPageCheck(a, now)) continue;
      const id = String(a.id);
      const k = known[id];
      if (k && now - Date.parse(k.at || 0) < NO_SUBMISSIONS_KEEP_MS) {
        a.noSubmissions = true;
        continue;
      }
      if (reads >= max) continue;
      reads += 1;
      try {
        const res = await fetchPage(a.url);
        if (!res || !res.loggedIn || res.status >= 400) continue;
        const info = readAssignmentPage(res.html, res.finalUrl);
        if (info.submitted) {
          a.submitted = true;
          a.submissionNote = 'Turned in online (on the assignment page).';
        } else if (info.takesSubmissions === false) {
          a.noSubmissions = true;
          known[id] = { at: new Date(now).toISOString() };
        } else if (info.takesSubmissions === true) {
          delete known[id];
        }
      } catch {
        // A page that can't be read changes nothing.
      }
    }
  }
  return reads;
}
