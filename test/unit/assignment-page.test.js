// assignment-page.js: what an assignment's own page says about handing it in.
import { describe, it, expect } from 'vitest';
import { readAssignmentPage, needsPageCheck, dueSoonCheck, viaFor, checkOverdueWork, rarelyOnline, NO_SUBMISSIONS_KEEP_MS } from '../../extension/src/assignment-page.js';
import { summarizeStudent, DEFAULT_SETTINGS } from '../../extension/src/rules.js';
import { weekState } from '../../extension/src/rewards.js';

const SITE = 'https://app.schoology.com';
// Trimmed from live pages (2026-11-21), names removed.
const classic = (box) => `<html><body><div class="assignment-details"><p>Due Friday</p></div>${box}</body></html>`;
const EMPTY_BOX = '<div class="drop-items"><div class="right-block-big-wrapper drop-item-display-own"><h3 class="h3-med-flat">Submissions</h3><div class="right-block-big"><form action="/assignment/11/info" method="post"></form></div></div></div>';
const TURNED_IN = '<div class="drop-items"><div class="right-block-big-wrapper drop-item-display-own"><h3 class="h3-med-flat">Submissions</h3><div class="right-block-big"><div id="dropbox-revisions" class="dropbox-revisions"><div class="item-list"><ul><li class="first last"><a href="/assignment/11/dropbox/view/2001?revision=1" class="dropbox-view-link">Assignment submitted</a></li></ul></div></div></div></div></div>';
const newPage = (on) => `<html><script>window.siteNavigationUiProps={"props":{"hasSubmissionsEnabled":${on},"type":"lti"}}</script></html>`;

describe('readAssignmentPage', () => {
  it('classic page: a Submissions box means it takes submissions; listed work means turned in', () => {
    expect(readAssignmentPage(classic(EMPTY_BOX), `${SITE}/assignment/11/info`)).toEqual({ page: 'classic', takesSubmissions: true, submitted: false, via: 'schoology' });
    expect(readAssignmentPage(classic(TURNED_IN), `${SITE}/assignment/11/info`)).toEqual({ page: 'classic', takesSubmissions: true, submitted: true, via: 'schoology' });
    expect(readAssignmentPage(classic(''), `${SITE}/assignment/11/info`)).toEqual({ page: 'classic', takesSubmissions: false, submitted: false, via: null });
  });
  it('newer page: hasSubmissionsEnabled', () => {
    expect(readAssignmentPage(newPage(true), `${SITE}/assignments/11/info`)).toMatchObject({ page: 'new', takesSubmissions: true });
    expect(readAssignmentPage(newPage(false), `${SITE}/assignments/11/info`)).toMatchObject({ page: 'new', takesSubmissions: false });
  });
  it('test pages: Submissions Disabled or Enabled', () => {
    const test = (state, text) => `<div class="assessment-status-wrapper"><span role="button" tabindex="0" class="infotip" aria-label='Submissions ${state} This assessment is ${text}'><span class='assessment-status disabled'>Submissions ${state}</span></span></div>`;
    expect(readAssignmentPage(test('Disabled', 'not currently accepting submissions'), `${SITE}/assignment/11/assessment`)).toEqual({ page: 'test', takesSubmissions: false, submitted: false, via: null });
    expect(readAssignmentPage(test('Enabled', 'currently accepting submissions'), `${SITE}/course/5/assessments/11`)).toEqual({ page: 'test', takesSubmissions: true, submitted: false, via: 'schoology' });
    // The words alone (Schoology's list of UI strings is on every page) say nothing.
    expect(readAssignmentPage('"assessments.submissions_disabled":"Submissions Disabled"', `${SITE}/assignment/11/assessment`).page).toBe(null);
  });
  it('where work is turned in: Schoology, Google, or another tool online', () => {
    const google = `<html><script>{"hasSubmissionsEnabled":true,"launchUrl":"https:\\/\\/lti-submission-google.app.schoology.com\\/lti\\/assignment"}</script></html>`;
    expect(readAssignmentPage(google, `${SITE}/assignments/11/info`).via).toBe('google');
    expect(readAssignmentPage(newPage(true), `${SITE}/assignments/11/info`).via).toBe('online');
    expect(readAssignmentPage(newPage(false), `${SITE}/assignments/11/info`).via).toBe(null);
    // Parents get a 403 on an outside tool's launch page: the address says enough.
    const tool = readAssignmentPage('<html>Forbidden</html>', `${SITE}/external_tool/77/launch`);
    expect(tool).toEqual({ page: 'tool', takesSubmissions: true, submitted: false, via: 'online' });
    expect(viaFor(tool, 'DM: Roots are Factors')).toBe('deltamath');
    expect(viaFor(tool, 'Deltamath - Extra Practice')).toBe('deltamath');
    expect(viaFor(tool, 'Reading log')).toBe('online');
    expect(viaFor(readAssignmentPage(classic(EMPTY_BOX), `${SITE}/assignment/11/info`), 'DM: notes')).toBe('schoology');
  });
  it('says nothing for error pages and anything else', () => {
    const none = { page: null, takesSubmissions: null, submitted: false, via: null };
    expect(readAssignmentPage('<html>attempts</html>', `${SITE}/course/5/assessments/11`)).toEqual(none);
    expect(readAssignmentPage('<html>Page not found</html>', `${SITE}/assignment/11/info`)).toEqual(none);
    expect(readAssignmentPage('<html></html>', `${SITE}/assignments/11/info`)).toEqual(none);
    expect(readAssignmentPage('', 'not a url')).toEqual(none);
  });
});

describe('checkOverdueWork', () => {
  const NOW = Date.parse('2026-11-21T12:00:00Z');
  const past = '2026-11-19T23:59:00Z';
  const item = (id, extra = {}) => ({ id, title: `Item ${id}`, status: 'overdue', due: past, url: `${SITE}/assignment/${id}/info`, ...extra });
  const pages = {
    1: classic(''), // can't be submitted
    2: classic(EMPTY_BOX), // takes submissions, nothing in
    3: classic(TURNED_IN), // turned in online
    4: '<html>Server error</html>',
  };
  const fetchPage = async (url) => {
    const id = url.match(/assignment\/(\d+)/)[1];
    return { status: 200, loggedIn: true, finalUrl: url, html: pages[id] };
  };

  it('marks work that takes no submissions, and work turned in online; the rest stays', async () => {
    const courses = [{ id: 'c', name: 'Science', assignments: [item(1), item(2), item(3), item(4), item(5, { status: 'pending', due: '2026-11-30T23:59:00Z' })] }];
    const known = {};
    const reads = await checkOverdueWork(courses, { fetchPage, known, now: NOW });
    const [a1, a2, a3, a4, a5] = courses[0].assignments;
    expect(reads).toBe(4); // not the item that isn't due yet
    expect(a1.noSubmissions).toBe('page');
    expect(a2.noSubmissions).toBeUndefined();
    expect(a3.submitted).toBe(true);
    expect(a4.noSubmissions).toBeUndefined();
    expect(a5.noSubmissions).toBeUndefined();
    expect(known[1]).toMatchObject({ page: 'classic' });
    expect(known[1].via).toBeUndefined();
    expect(known[2]).toMatchObject({ page: 'classic', via: 'schoology' });
    expect(known[4]).toBeUndefined();

    // The rules: only items 2 and 4 are Overdue; 3 waits on the teacher.
    const s = summarizeStudent(courses, DEFAULT_SETTINGS, [], []);
    expect(s.overdueItems.map((a) => a.id)).toEqual([2, 4]);
    expect(weekState(a1, {}, NOW)).toBe('passed');
    expect(weekState(a3, {}, NOW)).toBe('submitted');
  });

  it('trusts a known "no submissions" for a week, then reads the page again', async () => {
    let reads = 0;
    const counting = async (url) => { reads += 1; return fetchPage(url); };
    const fresh = { 1: { at: new Date(NOW - 60000).toISOString() } };
    const c1 = [{ assignments: [item(1)] }];
    await checkOverdueWork(c1, { fetchPage: counting, known: fresh, now: NOW });
    expect(reads).toBe(0);
    expect(c1[0].assignments[0].noSubmissions).toBe('page');
    const old = { 2: { at: new Date(NOW - NO_SUBMISSIONS_KEEP_MS - 1).toISOString() } };
    const c2 = [{ assignments: [item(2)] }];
    await checkOverdueWork(c2, { fetchPage: counting, known: old, now: NOW });
    expect(reads).toBe(1);
    expect(c2[0].assignments[0].noSubmissions).toBeUndefined();
    expect(old[2]).toMatchObject({ via: 'schoology' }); // it takes submissions now
  });

  it('a signed-out or failed page, or too many items, changes nothing', async () => {
    const out = async () => ({ status: 200, loggedIn: false, finalUrl: `${SITE}/login`, html: '' });
    const boom = async () => { throw new Error('network'); };
    for (const f of [out, boom]) {
      const c = [{ assignments: [item(1)] }];
      await checkOverdueWork(c, { fetchPage: f, now: NOW });
      expect(c[0].assignments[0].noSubmissions).toBeUndefined();
    }
    // At most `max` pages; a page already known to take none isn't read.
    const many = [{ assignments: [item(2), item(2), item(2), item(1), item(1)] }];
    expect(await checkOverdueWork(many, { fetchPage, now: NOW, max: 2 })).toBe(2);
    expect(many[0].assignments.map((a) => Boolean(a.noSubmissions))).toEqual([false, false, false, false, false]);
    const known = {};
    const few = [{ assignments: [item(1), item(1)] }];
    expect(await checkOverdueWork(few, { fetchPage, known, now: NOW })).toBe(1);
    expect(few[0].assignments.map((a) => Boolean(a.noSubmissions))).toEqual([true, true]);
  });

  it("paper assignments are decided one at a time: an unused Submissions box in a class whose work rarely goes in online is paper; Google or a tool is online", async () => {
    const graded = (n, online) => Array.from({ length: n }, (_, i) => ({ id: 100 + i, status: 'graded', score: 9, maxPoints: 10, submitted: i < online }));
    expect(rarelyOnline({ assignments: graded(10, 1) })).toBe(true); // 10%
    expect(rarelyOnline({ assignments: graded(10, 2) })).toBe(false); // 20%
    expect(rarelyOnline({ assignments: graded(4, 0) })).toBe(false); // too few to tell
    const google = `<html>{"hasSubmissionsEnabled":true} lti-submission-google.app.schoology.com</html>`;
    const f = async (url) => {
      const id = url.match(/assignments?\/(\d+)/)[1];
      return id === '3' ? { status: 200, loggedIn: true, finalUrl: `${SITE}/assignments/3/info`, html: google } : fetchPage(url);
    };
    const soon = (id) => item(id, { status: 'pending', due: '2026-11-22T20:00:00Z' });
    // Past due and due soon, in a class whose work rarely goes in online, and one where it does.
    const courses = [
      { id: 'm', name: 'Math', assignments: [...graded(10, 0), item(1), item(2), item(3), item(4), soon(2), soon(3)] },
      { id: 's', name: 'Spanish', assignments: [...graded(10, 4), item(2)] },
    ];
    expect(await checkOverdueWork(courses, { fetchPage: f, now: NOW })).toBe(5); // every page is read once (the due-soon copies reuse the answers)
    const [p1, p2, p3, p4, s2, s3] = courses[0].assignments.slice(-6);
    expect(p1.noSubmissions).toBe('page'); // no Submissions box
    expect(p2.noSubmissions).toBe('paper'); // a box nobody uses
    expect(p2.via).toBeUndefined();
    expect(p3.via).toBe('google'); // Google: online, so still Overdue
    expect(p3.noSubmissions).toBeUndefined();
    expect(p4.noSubmissions).toBeUndefined(); // the page said nothing: stays Overdue
    expect(s2.noSubmissions).toBe('paper');
    expect(s3.via).toBe('google');
    expect(courses[1].assignments.at(-1).via).toBe('schoology'); // this class uses the box
    const s = summarizeStudent(courses, { ...DEFAULT_SETTINGS, now: NOW }, [], []);
    expect(s.overdueItems.map((a) => `${a.courseName} ${a.id}`)).toEqual(['Math 3', 'Math 4', 'Spanish 2']);
  });
  it('work due soon: its page says where it goes, and whether it can be turned in at all', async () => {
    const soon = (id, extra = {}) => item(id, { status: 'pending', due: '2026-11-22T20:00:00Z', ...extra });
    const tool = { 7: true };
    const f = async (url) => {
      const id = url.match(/assignment\/(\d+)/)[1];
      if (tool[id]) return { status: 403, loggedIn: true, finalUrl: `${SITE}/external_tool/9${id}/launch`, html: '' };
      return fetchPage(url);
    };
    const courses = [{ id: 'c', name: 'Algebra', assignments: [soon(1), soon(2), soon(7, { title: 'DM: Roots' }), soon(8, { due: '2026-11-25T20:00:00Z' })] }];
    const known = {};
    expect(await checkOverdueWork(courses, { fetchPage: f, known, now: NOW })).toBe(3); // not the one due next week
    const [a1, a2, a7, a8] = courses[0].assignments;
    expect(a1.noSubmissions).toBe('page');
    expect(a2.via).toBe('schoology');
    expect(a7.via).toBe('deltamath');
    expect(a8.via).toBeUndefined();
    // Known answers aren't read again while fresh.
    const again = [{ id: 'c', assignments: [soon(1), soon(2), soon(7, { title: 'DM: Roots' })] }];
    expect(await checkOverdueWork(again, { fetchPage: f, known, now: NOW })).toBe(0);
    expect(again[0].assignments.map((a) => a.via || a.noSubmissions)).toEqual(['page', 'schoology', 'deltamath']);
    // In the rules, both still show in Due soon.
    const s = summarizeStudent(courses, { ...DEFAULT_SETTINGS, now: NOW }, [], []);
    expect(s.dueToday.length + s.dueTomorrow.length).toBe(3);
  });

  it('dueSoonCheck: still due today, or due tomorrow, not graded or turned in', () => {
    const at = (due, extra = {}) => item(1, { status: 'pending', due, ...extra });
    expect(dueSoonCheck(at('2026-11-21T20:00:00Z'), NOW)).toBe(true);
    expect(dueSoonCheck(at('2026-11-22T20:00:00Z'), NOW)).toBe(true);
    expect(dueSoonCheck(at('2026-11-25T20:00:00Z'), NOW)).toBe(false);
    expect(dueSoonCheck(at('2026-11-21T08:00:00Z'), NOW)).toBe(false); // already past
    expect(dueSoonCheck(at('2026-11-22T20:00:00Z', { submitted: true }), NOW)).toBe(false);
    expect(dueSoonCheck(at('2026-11-22T20:00:00Z', { status: 'graded' }), NOW)).toBe(false);
  });

  it('needsPageCheck: past due, ungraded, not submitted, with a link', () => {
    expect(needsPageCheck(item(1), NOW)).toBe(true);
    expect(needsPageCheck(item(1, { submitted: true }), NOW)).toBe(false);
    expect(needsPageCheck(item(1, { status: 'graded' }), NOW)).toBe(false);
    expect(needsPageCheck(item(1, { url: null }), NOW)).toBe(false);
    expect(needsPageCheck(item(1, { due: '2026-11-22T23:59:00Z' }), NOW)).toBe(false);
  });
});
