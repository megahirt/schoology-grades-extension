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
//   tests (/assignment/<id>/assessment, /course/<c>/assessments/<id>): a
//       status reads aria-label='Submissions Disabled This assessment is
//       not currently accepting submissions' (or 'Submissions Enabled').
//       Attempts are drawn by script, so whether it was taken isn't known.
//   /external_tool/<id>/launch  where an outside tool's assignment (DeltaMath,
//       say) leads. Parents get a 403 there, and the page never names the
//       tool, but the address alone says it's done online. Its title can
//       say which tool: "DM: …" or "Deltamath …" is DeltaMath.
//
// Where work is turned in (`via`, shown as a letter badge):
//   'schoology'  the classic page's Submissions box, or a Schoology test
//                that is accepting submissions
//   'google'     the newer page, handing off to Google (lti-submission-google)
//   'online'     the newer page for any other tool, or an outside tool
//   'deltamath'  an outside tool whose title says DeltaMath (viaFor)
//
// Paper assignments are decided one at a time, never for a whole class.
// One is a paper assignment when its page says it can't be turned in
// online, or when its page has a Submissions box but nothing in it and
// its class's graded work almost never went in online (rarelyOnline):
// some teachers leave the box on for work handed in on paper, and a
// parent can't see whether anyone else used it. Checked against three
// students' classes on 2026-11-21: classes where the box goes unused had
// 0-16% of graded work turned in online, classes that use it 30-81%.
// A Google, outside-tool or open-test page is online whatever the class
// usually does.
//
// Anything not recognized says nothing (takesSubmissions: null), and the
// item stays Overdue: a wrong guess must never hide work that is due.

// readAssignmentPage(html, url) -> { page, takesSubmissions, submitted, via }
//   page              'classic' | 'new' | 'test' | 'tool' | null (not recognized)
//   takesSubmissions  true | false | null (unknown)
//   submitted         true when the page lists turned-in work
//   via               where it's turned in (above), or null
export function readAssignmentPage(html, url) {
  const none = { page: null, takesSubmissions: null, submitted: false, via: null };
  let path = '';
  try {
    path = new URL(url).pathname;
  } catch {
    return none;
  }
  if (/^\/external_tool\/\d+\/launch\b/.test(path)) return { page: 'tool', takesSubmissions: true, submitted: false, via: 'online' };
  if (!html || typeof html !== 'string') return none;
  if (/^\/assignments\/\d+\/info\b/.test(path)) {
    const m = html.match(/"hasSubmissionsEnabled"\s*:\s*(true|false)/);
    if (!m) return none;
    const takes = m[1] === 'true';
    return { page: 'new', takesSubmissions: takes, submitted: false, via: takes ? (/lti-submission-google\./.test(html) ? 'google' : 'online') : null };
  }
  if (/^\/assignment\/\d+\/assessment\b/.test(path) || /^\/course\/\d+\/assessments\/\d+\b/.test(path)) {
    const m = html.match(/class="assessment-status-wrapper"[\s\S]{0,600}?aria-label=['"]Submissions (Disabled|Enabled)\b/);
    if (!m) return none;
    const takes = m[1] === 'Enabled';
    return { page: 'test', takesSubmissions: takes, submitted: false, via: takes ? 'schoology' : null };
  }
  if (/^\/assignment\/\d+\/info\b/.test(path) && /class="assignment-details"/.test(html)) {
    const box = /class="[^"]*\bdrop-item-display-own\b/.test(html);
    const submitted = box && /class="[^"]*\bdropbox-revisions\b/.test(html) && /\/dropbox\/view\//.test(html);
    return { page: 'classic', takesSubmissions: box, submitted, via: box ? 'schoology' : null };
  }
  return none;
}

// An outside tool named in the assignment's title: "DM: Roots are Factors"
// or "Deltamath - Extra Practice" is DeltaMath.
export function viaFor(info, title) {
  if (!info || !info.via) return null;
  if (info.page === 'tool' && /\bdelta\s?math\b|^\s*DM\s*[:\-]/i.test(title || '')) return 'deltamath';
  return info.via;
}

// How long a page's answer is trusted before the page is read again.
export const NO_SUBMISSIONS_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
// At most this many pages per child per refresh (the rest stay as they are).
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

// Is this item due soon (still due today, or due tomorrow), with no grade
// and nothing turned in? Its page says where it's turned in (the badge in
// Due soon), and whether it can be at all.
export function dueSoonCheck(a, now = Date.now()) {
  if (!a || !a.url || !a.id || a.submitted === true) return false;
  if (a.status !== 'pending') return false;
  const t = Date.parse(a.due || '');
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + 2);
  return !Number.isNaN(t) && t >= now && t < end.getTime();
}

// Does this class's graded work almost never go in online? At least
// PAPER_MIN_GRADED graded items, and fewer than PAPER_ONLINE_SHARE of them
// turned in online. Only used for an assignment whose Submissions box is
// on but empty: then it's probably handed in on paper.
export const PAPER_MIN_GRADED = 5;
export const PAPER_ONLINE_SHARE = 0.2;
export function rarelyOnline(course) {
  const graded = (course && course.assignments || []).filter((a) => a.status === 'graded');
  if (graded.length < PAPER_MIN_GRADED) return false;
  const online = graded.filter((a) => a.submitted === true).length;
  return online / graded.length < PAPER_ONLINE_SHARE;
}

// What a saved answer says: { at } alone (older saves) means it takes no
// submissions; { at, page, via } that it does, and where.
const fromKnown = (k) => (k.via ? { page: k.page || null, takesSubmissions: true, submitted: false, via: k.via } : { page: k.page || null, takesSubmissions: false, submitted: false, via: null });

// checkOverdueWork(courses, { fetchPage, known, now }) — reads the page of
// each item that would be Overdue, and of each item due soon, and marks it:
//   a.submitted = true            the page lists turned-in work
//   a.noSubmissions = 'page'      its page says it can't be turned in online
//   a.noSubmissions = 'paper'     a Submissions box nobody uses (above): paper
//   a.via = 'schoology' | 'google' | 'deltamath' | 'online'   where it's turned in
// `known` is { [assignmentId]: { at, page?, via? } }, the pages' answers
// (kept per site); it is updated in place. A past-due item's page is read
// again each refresh unless it's known to take no submissions, to catch
// work turned in since. Returns the number of pages read. Errors leave
// the item as it was.
export async function checkOverdueWork(courses, { fetchPage, known = {}, now = Date.now(), max = MAX_PAGE_CHECKS } = {}) {
  let reads = 0;
  for (const c of courses || []) {
    const rarely = rarelyOnline(c);
    for (const a of c.assignments || []) {
      const past = needsPageCheck(a, now);
      const soon = !past && dueSoonCheck(a, now);
      if (!past && !soon) continue;
      const id = String(a.id);
      const k = known[id];
      const fresh = k && now - Date.parse(k.at || 0) < NO_SUBMISSIONS_KEEP_MS;
      let info = null;
      if (fresh && (soon || !k.via)) info = fromKnown(k);
      else if (reads < max) {
        reads += 1;
        try {
          const res = await fetchPage(a.url);
          const tool = res && /\/external_tool\/\d+\/launch\b/.test(res.finalUrl || '');
          if (res && res.loggedIn && (res.status < 400 || tool)) {
            info = readAssignmentPage(res.html, res.finalUrl);
            if (info.takesSubmissions === false) known[id] = { at: new Date(now).toISOString(), page: info.page };
            else if (info.takesSubmissions === true) known[id] = { at: new Date(now).toISOString(), page: info.page, via: info.via };
          }
        } catch {
          // A page that can't be read changes nothing.
        }
      }
      if (info && info.submitted) {
        a.submitted = true;
        a.submissionNote = 'Turned in online (on the assignment page).';
        continue;
      }
      if (!info) continue;
      if (rarely && info.page === 'classic' && info.takesSubmissions === true) {
        a.noSubmissions = 'paper';
        continue;
      }
      if (info.takesSubmissions === false) a.noSubmissions = 'page';
      else if (info.takesSubmissions === true) {
        const via = viaFor(info, a.title);
        if (via) a.via = via;
      }
    }
  }
  return reads;
}
