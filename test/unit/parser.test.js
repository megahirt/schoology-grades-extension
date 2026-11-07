// parser.test.js — unit tests for extension/src/parser.js + parser-core.js.
//
// The static fixture below copies the LIVE Schoology Grades markup verified
// on app.schoology.com (2026-11-06) — element structure, classes and
// screen-reader labels are exact; titles, ids and grades are made up.
// Here node-html-parser is the DOM; the browser-DOM path of the same core is
// exercised by the e2e tests and was run against live Schoology.

import { describe, it, expect } from 'vitest';
import { parseGradesHtml, parseSchoologyDate } from '../../extension/src/parser.js';
import { renderCourse, renderPage } from '../mock-server/markup.js';

const LIVE_SHAPE = `<!DOCTYPE html><html><head><title>Literature: Section 4 | Schoology</title></head><body>
<div id="s-js-gradebook-course-9100" class="gradebook-course hierarchical-grading-report show-title interactive">
<div class="gradebook-course-title">Literature: Section 4<span class="visually-hidden">Course</span></div>
<div class="gradebook-course-grades"><table role="presentation"><tbody>
<tr data-id="9100" data-parent-id="" class="report-row course-row has-children"><th scope="row" class="title-column clickable" tabindex="0"><div class="reportSpacer-0"><div class="td-content-wrapper"><span class="title" role="button" tabindex="0"><span class="course-grade-text">Course Grade</span><span class="visually-hidden">Course</span></span></div></div></th><td class="grade-column"><div class="td-content-wrapper"></div></td><td class="comment-column"><div class="td-content-wrapper"><span class="visually-hidden">No comment</span></div></td></tr>
<tr tabindex="0" data-id="801" data-parent-id="9100" class="report-row period-row has-children"><th scope="row" class="title-column clickable" tabindex="0"><div class="reportSpacer-1"><div class="td-content-wrapper"><img src="/x.png" class="expandable-icon-grading-report" alt=""><span class="title" role="button" tabindex="0">Semester 1: 8/24/26 - 12/19/26<span class="visually-hidden">Grading Period</span></span> <span class="percentage-contrib">(50%)</span></div></div></th><td class="grade-column"><div class="td-content-wrapper"><span class="awarded-grade"><span class="numeric-grade primary-grade"><span class="rounded-grade" title="66.25%">66.25%</span></span></span></div></td><td class="comment-column"></td></tr>
<tr tabindex="0" data-id="802" data-parent-id="801" class="report-row period-row has-children childrenCollapsed"><th scope="row" class="title-column clickable"><div class="td-content-wrapper"><span class="title" role="button" tabindex="0">Quarter 1: 8/24/2026 - 10/14/2026<span class="visually-hidden">Grading Period</span></span></div></th><td class="grade-column"><div class="td-content-wrapper"><span class="awarded-grade"><span class="numeric-grade primary-grade"><span class="rounded-grade" title="77%">77%</span></span></span></div></td><td class="comment-column"></td></tr>
<tr tabindex="0" data-id="803" data-parent-id="801" class="report-row period-row has-children childrenCollapsed"><th scope="row" class="title-column clickable"><div class="td-content-wrapper"><span class="title" role="button" tabindex="0">Quarter 2: 10/19/2026 - 12/15/2026<span class="visually-hidden">Grading Period</span></span></div></th><td class="grade-column"><div class="td-content-wrapper"><span class="awarded-grade"><span class="numeric-grade primary-grade"><span class="rounded-grade" title="55.5%">55.5%</span></span></span></div></td><td class="comment-column"></td></tr>
<tr data-id="802-1" data-parent-id="802" class="report-row category-row hidden has-children childrenCollapsed last-row-of-tier"><th scope="row" class="title-column clickable"><div class="td-content-wrapper"><span class="title" role="button" tabindex="0">Work<span class="visually-hidden">Category</span></span></div></th><td class="grade-column"><div class="td-content-wrapper"><span class="awarded-grade"><span class="numeric-grade primary-grade"><span class="rounded-grade" title="76.9%">76.9%</span></span></span></div></td><td class="comment-column"></td></tr>
<tr data-id="I-7001" data-parent-id="802-1" class="report-row item-row hidden"><th scope="row" class="title-column clickable"><div class="reportSpacer-4"><div class="td-content-wrapper"><span class="title" role="button" tabindex="0"><a href="/assignment/7001" target="_blank">Warm-up 1<span class="visually-hidden">assignment</span></a></span> <span class="due-date"><span class="visually-hidden">Due </span>8/25/26 10:00am</span></div></div></th><td class="grade-column"><div class="td-content-wrapper"><span class="awarded-grade"><span class="rounded-grade" title="4.25">4.25</span></span><span class="max-grade"> / 5</span><div class="grade-wrapper"></div></div></td><td class="comment-column"></td></tr>
<tr data-id="I-7002" data-parent-id="802-1" class="report-row item-row hidden"><th scope="row" class="title-column clickable"><div class="reportSpacer-4"><div class="td-content-wrapper"><span class="title" role="button" tabindex="0"><a href="/assignment/7002" target="_blank">Worksheet 4.2<span class="visually-hidden">assignment</span></a></span> <span class="due-date"><span class="visually-hidden">Due </span>9/30/26 11:59pm</span></div></div></th><td class="grade-column"><div class="td-content-wrapper"><div class="exception-grade-wrapper"><span class='no-grade'>0</span><span class="exception"><span class="exception-icon missing"></span><span class="exception-text">Missing</span></span></div><div class="grade-wrapper"></div></div></td><td class="comment-column"></td></tr>
<tr data-id="I-7003" data-parent-id="802-1" class="report-row item-row hidden"><th scope="row" class="title-column clickable"><div class="reportSpacer-4"><div class="td-content-wrapper"><span class="title" role="button" tabindex="0"><a href="/assignment/7003" target="_blank">Mini-Project<span class="visually-hidden">assignment</span></a></span> <span class="due-date"><span class="visually-hidden">Due </span>10/13/26 11:00am</span></div></div></th><td class="grade-column"><div class="td-content-wrapper"><span class="awarded-grade"><span class="rounded-grade" title="0">0</span></span><span class="max-grade"> / 10</span><div class="grade-wrapper"></div></div></td><td class="comment-column"></td></tr>
<tr data-id="I-7004" data-parent-id="802-1" class="report-row item-row hidden"><th scope="row" class="title-column clickable"><div class="reportSpacer-4"><div class="td-content-wrapper"><span class="title" role="button" tabindex="0"><a href="/assignment/7004" target="_blank">Response to Talk<span class="visually-hidden">discussion</span></a></span> <span class="due-date"><span class="visually-hidden">Due </span>10/01/26 12:30pm</span></div></div></th><td class="grade-column"><div class="td-content-wrapper"><span class="awarded-grade"><span class="rounded-grade" title="5">5</span></span><span class="max-grade"> / 5</span><div class="grade-wrapper"><span class="has-discussion-comment discussion-comment-inline-icon-wrapper"><img src="/d.png" alt="Discussion icon"><span class="visually-hidden">This student has posted in the discussion</span></span></div></div></td><td class="comment-column"></td></tr>
<tr data-id="I-7005" data-parent-id="801" class="report-row item-row"><th scope="row" class="title-column clickable"><div class="reportSpacer-4"><div class="td-content-wrapper"><span class="title" role="button" tabindex="0"><a href="/assignment/7005" target="_blank">Script Draft<span class="visually-hidden">assignment</span></a></span> <span class="due-date"><span class="visually-hidden">Due </span>11/03/26 11:25am</span></div></div></th><td class="grade-column"><div class="td-content-wrapper"><div class="exception-grade-wrapper"><span class='no-grade'>0</span><span class="exception"><span class="exception-icon missing"></span><span class="exception-text">Missing</span></span></div><div class="grade-wrapper"><span class="has-dropbox-icon grade-pending-icon"><span class="visually-hidden">This student has made a submission that has not been graded.</span></span></div></div></td><td class="comment-column"></td></tr>
<tr data-id="I-7006" data-parent-id="801" class="report-row item-row"><th scope="row" class="title-column clickable"><div class="reportSpacer-4"><div class="td-content-wrapper"><span class="title" role="button" tabindex="0"><a href="/assignment/7006" target="_blank">Practice Quiz (optional)<span class="visually-hidden">assessment</span></a></span> <span class="due-date"><span class="visually-hidden">Due </span>10/29/26 11:59pm</span></div></div></th><td class="grade-column"><div class="td-content-wrapper"><div class="exception-grade-wrapper"><span class='no-grade'>—</span><span class="exception"><span class="exception-icon excused"></span><span class="exception-text">Exempt</span></span></div><div class="grade-wrapper"></div></div></td><td class="comment-column"></td></tr>
<tr data-id="I-7007" data-parent-id="801" class="report-row item-row"><th scope="row" class="title-column clickable"><div class="reportSpacer-4"><div class="td-content-wrapper"><span class="title" role="button" tabindex="0"><a href="/course/9100/preview/2000001/parent?url=assignment/7007" target="_blank">Final Project &amp; Reflection</a></span> <span class="due-date"><span class="visually-hidden">Due </span>11/05/26 8:00am</span></div></div></th><td class="grade-column"><div class="td-content-wrapper">—</div></td><td class="comment-column"></td></tr>
<tr data-id="I-7008" data-parent-id="801" class="report-row item-row"><th scope="row" class="title-column clickable"><div class="reportSpacer-4"><div class="td-content-wrapper"><span class="title" role="button" tabindex="0"><a href="/assignment/7008" target="_blank">Map Project</a></span></div></div></th><td class="grade-column"><div class="td-content-wrapper"><span class="awarded-grade">A</span><div class="grade-wrapper"></div></div></td><td class="comment-column"></td></tr>
</tbody></table></div></div></body></html>`;

const NOW = new Date(2026, 10, 6, 21, 0); // Nov 6 2026, 9 p.m. local

describe('parseSchoologyDate', () => {
  it('reads M/DD/YY h:mmam|pm as local time', () => {
    const d = parseSchoologyDate('11/03/26 11:25am');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 10, 3, 11, 25]);
    const p = parseSchoologyDate('9/30/26 11:59pm');
    expect([p.getMonth(), p.getDate(), p.getHours(), p.getMinutes()]).toEqual([8, 30, 23, 59]);
    expect(parseSchoologyDate('10/01/26 12:30pm').getHours()).toBe(12);
    expect(parseSchoologyDate('10/01/26 12:05am').getHours()).toBe(0);
  });

  it('treats a date with no time as due at the end of that day', () => {
    const d = parseSchoologyDate('10/27/26');
    expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([27, 23, 59]);
  });

  it('returns null for text that is not a date', () => {
    expect(parseSchoologyDate('')).toBeNull();
    expect(parseSchoologyDate('soon')).toBeNull();
  });
});

describe('parseGradesHtml — live Schoology markup', () => {
  const { courses, parseWarnings, error } = parseGradesHtml(LIVE_SHAPE, { now: NOW });
  const [course] = courses;
  const byTitle = Object.fromEntries(course.assignments.map((a) => [a.title, a]));

  it('parses one course with every item row, including rows in collapsed periods', () => {
    expect(error).toBeUndefined();
    expect(parseWarnings).toEqual([]);
    expect(courses).toHaveLength(1);
    expect(course.id).toBe('9100');
    expect(course.name).toBe('Literature');
    expect(course.sectionTitle).toBe('Literature: Section 4');
    expect(course.assignments).toHaveLength(8);
  });

  it('uses the current quarter for the verdict grade, and the semester alongside', () => {
    expect(course.grade).toBe(55.5);
    expect(course.gradeLabel).toBe('Quarter 2');
    expect(course.gradeSource).toMatch(/^Quarter 2/);
    expect(course.quarterGrade).toBe(55.5);
    expect(course.overallGrade).toBe(66.25);
    expect(course.overallLabel).toBe('Semester');
  });

  it('flags ONLY teacher-marked Missing items, including one in a collapsed quarter', () => {
    const missing = course.assignments.filter((a) => a.status === 'missing').map((a) => a.title);
    expect(missing).toEqual(['Worksheet 4.2', 'Script Draft']);
    expect(byTitle['Worksheet 4.2'].score).toBeNull();
  });

  it('never infers Missing from a real 0 score', () => {
    expect(byTitle['Mini-Project'].status).toBe('graded');
    expect(byTitle['Mini-Project'].score).toBe(0);
    expect(byTitle['Mini-Project'].maxPoints).toBe(10);
  });

  it('keeps the submission note (teacher lag: Missing but a submission exists)', () => {
    const a = byTitle['Script Draft'];
    expect(a.status).toBe('missing');
    expect(a.submitted).toBe(true);
    expect(a.gradePending).toBe(true);
    expect(a.submissionNote).toMatch(/submission that has not been graded/);
  });

  it('reads scores, titles without screen-reader labels, kinds, ids and links', () => {
    const a = byTitle['Warm-up 1'];
    expect(a).toMatchObject({ id: '7001', score: 4.25, maxPoints: 5, status: 'graded', kind: 'assignment' });
    expect(a.url).toBe('https://app.schoology.com/assignment/7001');
    expect(byTitle['Response to Talk'].kind).toBe('discussion');
    expect(byTitle['Final Project & Reflection'].url).toBe(
      'https://app.schoology.com/course/9100/preview/2000001/parent?url=assignment/7007',
    );
  });

  it('maps Exempt to excused, "—" to no grade, and letter grades to graded', () => {
    expect(byTitle['Practice Quiz (optional)'].status).toBe('excused');
    expect(byTitle['Final Project & Reflection'].status).toBe('overdue');
    expect(byTitle['Final Project & Reflection'].score).toBeNull();
    expect(byTitle['Map Project']).toMatchObject({ status: 'graded', letterGrade: 'A', score: null, due: null });
  });

  it('stores due dates as ISO strings of the local due time', () => {
    const due = new Date(byTitle['Script Draft'].due);
    expect([due.getMonth(), due.getDate(), due.getHours(), due.getMinutes()]).toEqual([10, 3, 11, 25]);
    expect(byTitle['Script Draft'].dueText).toBe('11/03/26 11:25am');
  });
});

describe('parseGradesHtml — multi-course report (mock markup)', () => {
  it('parses every .gradebook-course block on a grade report page', () => {
    const page = renderPage('Grades', [
      renderCourse({ id: '1', title: 'Algebra 2: Section 5', courseGrade: 91, periods: [] }),
      renderCourse({
        id: '2',
        title: 'Chemistry: Section 1',
        courseGrade: null,
        periods: [{ id: '21', title: 'Semester 1: 8/24/26 - 12/19/26', grade: 74.5, items: [
          { id: '9', title: 'Lab Notebook Check', due: '10/21/26 11:59pm', exception: 'missing' },
        ] }],
      }),
    ].join(''));
    const { courses } = parseGradesHtml(page, { now: NOW });
    expect(courses.map((c) => [c.name, c.grade])).toEqual([['Algebra 2', 91], ['Chemistry', 74.5]]);
    expect(courses[1].assignments[0].status).toBe('missing');
  });
});

describe('parseGradesHtml — self-check', () => {
  it('returns PARSE_EMPTY when grade rows exist but no course block parses', () => {
    const html = '<table><tr class="report-row item-row"><td>x</td></tr></table>';
    const result = parseGradesHtml(html);
    expect(result.error).toBe('PARSE_EMPTY');
    expect(result.courses).toEqual([]);
  });

  it('returns no courses and no error for a page that is not a grades page', () => {
    const result = parseGradesHtml('<html><body><h1>Home</h1></body></html>');
    expect(result.error).toBeUndefined();
    expect(result.courses).toEqual([]);
  });

  it('handles empty input', () => {
    expect(parseGradesHtml('').courses).toEqual([]);
  });
});

// Regression (2026-11-07, live parent report): Schoology leaves
// <span class="has-dropbox-icon grade-pending-icon"> unclosed on a submission
// awaiting a grade. The old service-worker parser (node-html-parser) then
// lost every later row (100 of 136), so a child with a 55% class read as GO.
// The parse5-based parser must recover exactly like a browser.
describe('parseGradesHtml — Schoology unclosed grade-pending span', () => {
  const course = (id, title, grade, items) => renderCourse({
    id, title, courseGrade: grade,
    periods: [{ id: `${id}1`, title: 'Semester 1: 8/24/26 - 12/19/26', grade, items }],
  });
  const PENDING = 'This student has made a submission that has not been graded.';
  const page = renderPage('Grades', [
    course('701', 'Literature: Section 1', 55, [
      { id: '7011', title: 'Essay Draft', due: '11/03/26 11:25am', exception: 'missing', note: PENDING, pending: true },
      { id: '7012', title: 'Reading Log', due: '10/20/26', score: 8, max: 10 },
    ]),
    course('702', 'Government: Section 4', 63, [
      { id: '7021', title: 'Bill Project', due: '10/22/26', score: 40, max: 50 },
      { id: '7022', title: 'Unit Quiz', due: '10/24/26', exception: 'missing' },
    ]),
    course('703', 'History: Section 2', 94, [
      { id: '7031', title: 'Map Work', due: '10/10/26', score: 19, max: 20, note: PENDING, pending: true },
      { id: '7032', title: 'Timeline', due: '10/12/26', score: 10, max: 10 },
    ]),
  ].join(''));

  it('really contains the unclosed span (the fixture reproduces the live quirk)', () => {
    const opens = (page.match(/<span class="has-dropbox-icon grade-pending-icon">/g) || []).length;
    expect(opens).toBe(2);
    expect(page).toContain('has not been graded.</span></div>');
  });

  it('keeps every row in its own course, with no warnings', () => {
    const { courses, parseWarnings } = parseGradesHtml(page, { now: NOW });
    expect(parseWarnings).toEqual([]);
    expect(courses.map((c) => [c.name, c.grade, c.assignments.map((a) => a.title)])).toEqual([
      ['Literature', 55, ['Essay Draft', 'Reading Log']],
      ['Government', 63, ['Bill Project', 'Unit Quiz']],
      ['History', 94, ['Map Work', 'Timeline']],
    ]);
    const missing = courses.flatMap((c) => c.assignments.filter((a) => a.status === 'missing').map((a) => a.title));
    expect(missing).toEqual(['Essay Draft', 'Unit Quiz']);
  });
});

describe('parseGradesHtml — quarter, semester and overall grades', () => {
  const S1 = 'Semester 1: 8/24/26 - 12/19/26';
  const Q1 = 'Quarter 1: 8/24/2026 - 10/14/2026';
  const Q2 = 'Quarter 2: 10/19/2026 - 12/15/2026';
  const EX1 = 'Exam 1: 12/16/2026 - 12/18/2026';
  const S2 = 'Semester 2: 1/11/27 - 5/29/27';
  const Q3 = 'Quarter 3: 1/11/2027 - 3/19/2027';
  const item = { id: '1', title: 'Item', score: 9, max: 10 };
  const page = (periods, courseGrade = null) => renderPage('Grades', renderCourse({
    id: '900', title: 'Spanish 2: Section 1', courseGrade,
    periods: periods.map(([id, title, grade, parentId], i) => ({ id, title, grade, parentId, items: i === 0 ? [item] : [] })),
  }));
  const fall = [['1', S1, 84], ['2', Q1, 96, '1'], ['3', Q2, 71, '1'], ['4', EX1, null, '1'], ['5', S2, null], ['6', Q3, null, '5']];

  it('fall: the verdict uses Quarter 2 (71) even though the semester passes (84)', () => {
    const [c] = parseGradesHtml(page(fall), { now: new Date(2026, 10, 7, 12) }).courses;
    expect([c.grade, c.gradeLabel, c.overallGrade, c.overallLabel]).toEqual([71, 'Quarter 2', 84, 'Semester']);
  });

  it('exam week (between quarters): the latest quarter that has started, never the exam', () => {
    const withExam = fall.map((p) => (p[0] === '4' ? ['4', EX1, 40, '1'] : p));
    const [c] = parseGradesHtml(page(withExam), { now: new Date(2026, 11, 17, 12) }).courses;
    expect([c.grade, c.gradeLabel]).toEqual([71, 'Quarter 2']);
  });

  it('a new quarter with no grades yet falls back to the semester grade, not last quarter', () => {
    const early = [['1', S1, 90], ['2', Q1, 96, '1'], ['3', Q2, null, '1']];
    const [c] = parseGradesHtml(page(early), { now: new Date(2026, 9, 20, 12) }).courses;
    expect([c.grade, c.gradeLabel, c.quarterGrade]).toEqual([90, 'Semester 1', null]);
  });

  it('spring: once Semester 2 has a grade the second column becomes Overall', () => {
    const spring = [['1', S1, 84], ['2', Q2, 71, '1'], ['5', S2, 78], ['6', Q3, 74, '5']];
    const [c] = parseGradesHtml(page(spring, 81), { now: new Date(2027, 1, 10, 12) }).courses;
    expect([c.grade, c.gradeLabel, c.overallGrade, c.overallLabel]).toEqual([74, 'Quarter 3', 81, 'Overall']);
    const [noRow] = parseGradesHtml(page(spring, null), { now: new Date(2027, 1, 10, 12) }).courses;
    expect(noRow.overallGrade).toBe(81); // average of 84 and 78
  });

  it('a new quarter with no grade falls back to the course-row grade, labelled as such', () => {
    const early = [['1', S1, 99], ['2', Q1, 99, '1'], ['3', Q2, null, '1']];
    const [c] = parseGradesHtml(page(early, 99.5), { now: new Date(2026, 10, 7, 12) }).courses;
    expect([c.grade, c.gradeLabel]).toEqual([99.5, 'Course grade']);
  });

  it('a course with no quarters keeps its semester grade for the verdict', () => {
    const [c] = parseGradesHtml(page([['1', S1, 88]]), { now: new Date(2026, 10, 7, 12) }).courses;
    expect([c.grade, c.gradeLabel, c.overallGrade, c.overallLabel]).toEqual([88, 'Semester 1', 88, 'Semester']);
  });
});

