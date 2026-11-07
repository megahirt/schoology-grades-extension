// parser-core.js — Schoology Grades parser that works on ANY DOM-like tree:
// the browser DOM (content script, DOMParser in a page/popup) and
// the parse5-based html-dom.js (service worker, unit tests). It touches only
// querySelectorAll / querySelector / getAttribute / childNodes / nodeType and
// text, which both implementations provide. No imports, so this file can also
// be pasted into a page to verify it against live Schoology.
//
// VERIFIED against live Schoology (app.schoology.com, parent account,
// 2026-11-06), both on /course/{id}/student_grades and on
// /parent/grades_attendance/grades. The markup is server-rendered (a plain
// fetch() with the session cookie returns the full table):
//
//   <div id="s-js-gradebook-course-{sectionId}" class="gradebook-course ...">
//     <div class="gradebook-course-title">{Course}: Section 4<span class="visually-hidden">Course</span></div>
//     <table> ...
//       <tr data-id="{sectionId}" data-parent-id="" class="report-row course-row">   (course grade, often empty)
//       <tr data-id="{periodId}" data-parent-id="{sectionId}" class="report-row period-row">
//           .title "Semester 1: 8/24/26 - 12/19/26"   .grade-column .rounded-grade[title="66%"]
//       <tr data-id="{periodId}-{catId}" class="report-row category-row">          (category, ignored)
//       <tr data-id="I-{assignmentId}" data-parent-id="..." class="report-row item-row [hidden]">
//           th .title > a[href="/assignment/{id}"] "Title"<span class="visually-hidden">assignment</span>
//           th .due-date <span class="visually-hidden">Due </span>11/03/26 11:25am
//           td.grade-column
//              graded:   .awarded-grade .rounded-grade[title="5"]  .max-grade " / 5"
//              no grade: "—"
//              Missing:  .exception-grade-wrapper .no-grade "0"
//                        .exception .exception-icon.missing  .exception-text "Missing"
//              .grade-wrapper .visually-hidden "This student has made a submission that has not been graded."
//
// Rows in collapsed grading periods carry the class "hidden" — they are still
// real items (a Quarter 1 Missing lives there) and MUST be parsed.
//
// Missing = ONLY the teacher's Missing exception. NEVER inferred from a 0
// score, from overdue, or from the absence of a submission.

const ELEMENT = 1;
const TEXT = 3;

function classOf(el) {
  return (el && el.getAttribute && el.getAttribute('class')) || '';
}

function hasClass(el, name) {
  return ` ${classOf(el)} `.replace(/\s+/g, ' ').includes(` ${name} `);
}

function nodeText(node) {
  if (!node) return '';
  return node.textContent || '';
}

// Visible text: concatenated text, skipping .visually-hidden screen-reader
// labels ("Course", "assignment", "Due ", "Grading Period").
export function visibleText(el) {
  if (!el) return '';
  let out = '';
  for (const child of el.childNodes || []) {
    if (child.nodeType === TEXT) out += nodeText(child);
    else if (child.nodeType === ELEMENT && !hasClass(child, 'visually-hidden')) out += visibleText(child);
  }
  return out.replace(/\s+/g, ' ').trim();
}

function hiddenText(el) {
  if (!el) return '';
  return [...el.querySelectorAll('.visually-hidden')]
    .map((x) => nodeText(x).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ');
}

function toNumber(raw) {
  if (raw === null || raw === undefined) return null;
  const m = String(raw).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

// "11/03/26 11:25am", "8/25/2026 10:00 AM", "10/27/26" -> local Date.
// A due date with no time means due at the END of that day (family rule).
export function parseSchoologyDate(raw) {
  if (!raw) return null;
  const m = String(raw).match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})\s*([ap])\.?m\.?)?/i);
  if (!m) return null;
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  const month = Number(m[1]) - 1;
  const day = Number(m[2]);
  if (m[4] === undefined) return new Date(year, month, day, 23, 59, 0, 0);
  let hour = Number(m[4]) % 12;
  if (m[6].toLowerCase() === 'p') hour += 12;
  return new Date(year, month, day, hour, Number(m[5]), 0, 0);
}

// "Semester 1: 8/24/26 - 12/19/26" -> { start, end } (end = end of day).
function parsePeriodRange(title) {
  const m = String(title || '').match(/(\d{1,2}\/\d{1,2}\/\d{2,4})\s*[-–]\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/);
  if (!m) return null;
  const start = parseSchoologyDate(m[1]);
  const end = parseSchoologyDate(m[2]);
  if (start) start.setHours(0, 0, 0, 0);
  return start && end ? { start, end } : null;
}

function absoluteUrl(href, baseUrl) {
  if (!href) return null;
  try {
    return new URL(href, baseUrl || 'https://app.schoology.com').toString();
  } catch {
    return null;
  }
}

function rowGrade(row) {
  const rounded = row.querySelector('.grade-column .rounded-grade');
  if (!rounded) return null;
  const precise = toNumber(rounded.getAttribute('title'));
  return precise !== null ? precise : toNumber(nodeText(rounded));
}

function exceptionOf(gradeCell) {
  if (!gradeCell) return null;
  const icon = gradeCell.querySelector('.exception-icon');
  const text = visibleText(gradeCell.querySelector('.exception-text')).toLowerCase();
  const iconClass = classOf(icon).toLowerCase();
  if (/\bmissing\b/.test(iconClass) || text === 'missing') return 'missing';
  if (/\b(excused|exempt)\b/.test(iconClass) || text === 'exempt' || text === 'excused') return 'excused';
  if (/\bincomplete\b/.test(iconClass) || text === 'incomplete') return 'incomplete';
  if (icon || text) return 'other';
  return null;
}

// What Schoology says about the submission (the icon's screen-reader label).
function submissionOf(gradeCell) {
  const wrapper = gradeCell && gradeCell.querySelector('.grade-wrapper');
  const note = hiddenText(wrapper) || null;
  let submitted = null;
  if (note) {
    if (/has made a submission|completed assignment submission|completed the test|posted in the discussion|has submitted/i.test(note)) submitted = true;
  }
  const pendingGrade = !!(wrapper && wrapper.querySelector('.grade-pending-icon'));
  return { submitted, submissionNote: note, gradePending: pendingGrade };
}

function parseItemRow(row, ctx) {
  const titleEl = row.querySelector('.title-column .title') || row.querySelector('.title');
  const link = titleEl ? titleEl.querySelector('a') : null;
  const title = visibleText(link || titleEl);
  if (!title) {
    ctx.parseWarnings.push(`Grade row without a title in ${ctx.courseName || ctx.courseId || 'a course'}`);
    return null;
  }
  const rowId = row.getAttribute('data-id') || '';
  const id = rowId.replace(/^I-/, '') || null;
  const kind = (hiddenText(link) || '').toLowerCase() || null;

  const dueEl = row.querySelector('.due-date');
  const dueText = dueEl ? visibleText(dueEl) : '';
  const dueDate = parseSchoologyDate(dueText);
  if (dueText && !dueDate) ctx.parseWarnings.push(`Unparseable due date "${dueText}" on "${title}"`);

  const gradeCell = row.querySelector('.grade-column');
  const exception = exceptionOf(gradeCell);
  let score = null;
  let maxPoints = null;
  let letterGrade = null;
  const awardedEl = gradeCell && gradeCell.querySelector('.awarded-grade');
  const rounded = awardedEl && awardedEl.querySelector('.rounded-grade');
  if (rounded) {
    score = toNumber(rounded.getAttribute('title'));
    if (score === null) score = toNumber(nodeText(rounded));
  } else if (awardedEl) {
    // Letter / scale grades: <span class="awarded-grade">A</span>
    const t = visibleText(awardedEl);
    if (t && t !== '—' && t !== '-') {
      score = toNumber(t);
      if (score === null) letterGrade = t;
    }
  }
  const maxEl = gradeCell && gradeCell.querySelector('.max-grade');
  if (maxEl) maxPoints = toNumber(nodeText(maxEl));

  let status;
  if (exception === 'missing') status = 'missing';
  else if (exception === 'incomplete') status = 'incomplete';
  else if (exception === 'excused') status = 'excused';
  else if (score !== null || letterGrade !== null) status = 'graded';
  else if (dueDate && dueDate < ctx.now) status = 'overdue';
  else status = 'pending';

  if (exception === 'missing') score = null; // the 0 shown is the Missing placeholder

  return {
    id,
    title,
    kind,
    due: dueDate ? dueDate.toISOString() : null,
    dueText,
    score,
    maxPoints,
    letterGrade,
    status,
    ...submissionOf(gradeCell),
    periodId: row.getAttribute('data-parent-id') || null,
    // The grading category the item sits in ("<periodId>-<categoryId>").
    categoryId: row.getAttribute('data-parent-id') || null,
    url: link ? absoluteUrl(link.getAttribute('href'), ctx.baseUrl) : null,
    sourceUrl: ctx.sourceUrl || null,
  };
}

// The semester-level grade (the fallback when a course has no quarters):
// the course-row grade when Schoology shows one, otherwise the top-level
// grading period (semester) that contains today, otherwise the latest
// top-level period that has a grade.
function pickCourseGrade(courseRowGrade, periods, now) {
  if (courseRowGrade !== null) return { grade: courseRowGrade, gradeSource: 'course' };
  const top = periods.filter((p) => p.topLevel && p.grade !== null);
  const current = top.find((p) => p.range && p.range.start <= now && now <= p.range.end);
  if (current) return { grade: current.grade, gradeSource: current.title };
  const latest = top.filter((p) => p.range && p.range.start <= now).sort((a, b) => b.range.start - a.range.start)[0]
    || top[0];
  return latest ? { grade: latest.grade, gradeSource: latest.title } : { grade: null, gradeSource: null };
}

// The current quarter: a grading period nested under a semester (not an
// exam), with a grade, whose dates include today; between quarters, the
// latest one that has started; failing dates, the last one with a grade.
// Live titles: "Quarter 2: 10/19/2026 - 12/15/2026", "Exam 1: 12/16/2026 - …".
// A quarter that has started but has no grade yet (Schoology shows "—")
// yields null, so the caller falls back to the semester grade rather than
// reaching back to last quarter's grade.
function pickQuarter(periods, now) {
  const all = periods.filter((p) => !p.topLevel && !/^\s*(final\s+)?exam\b/i.test(p.title || ''));
  const current = all.find((p) => p.range && p.range.start <= now && now <= p.range.end);
  if (current) return current.grade !== null ? current : null;
  const quarters = all.filter((p) => p.grade !== null);
  if (!quarters.length) return null;
  const started = quarters.filter((p) => p.range && p.range.start <= now).sort((a, b) => b.range.start - a.range.start);
  return started[0] || quarters[quarters.length - 1];
}

// The second column: "Semester" (the current semester's grade) until a later
// semester has any grade, then "Overall" (Schoology's whole-course grade, or
// the average of the semester grades when the course row shows none).
function pickOverall(courseRowGrade, periods, now) {
  const semesters = periods.filter((p) => p.topLevel && p.range).sort((a, b) => a.range.start - b.range.start);
  const laterStarted = semesters.slice(1).some((p) => p.grade !== null);
  if (laterStarted) {
    const graded = semesters.filter((p) => p.grade !== null).map((p) => p.grade);
    const avg = graded.length ? Math.round((graded.reduce((a, b) => a + b, 0) / graded.length) * 100) / 100 : null;
    return { grade: courseRowGrade !== null ? courseRowGrade : avg, label: 'Overall' };
  }
  const current = semesters.find((p) => p.range.start <= now && now <= p.range.end && p.grade !== null)
    || semesters.find((p) => p.grade !== null);
  if (current) return { grade: current.grade, label: 'Semester' };
  return { grade: courseRowGrade, label: courseRowGrade !== null ? 'Overall' : null };
}

function periodName(title) {
  return String(title || '').replace(/:.*$/, '').trim() || null;
}

function parseCourse(block, ctx) {
  const blockId = block.getAttribute('id') || '';
  const idMatch = blockId.match(/gradebook-course-(\d+)/);
  const courseRow = block.querySelector('tr.course-row');
  const id = (idMatch && idMatch[1]) || (courseRow && courseRow.getAttribute('data-id')) || ctx.courseId || null;
  const sectionTitle = visibleText(block.querySelector('.gradebook-course-title')) || ctx.courseName || null;
  const name = sectionTitle ? sectionTitle.replace(/:\s*Section\s+.*$/i, '').trim() : null;
  const courseCtx = { ...ctx, courseId: id, courseName: name };

  const periods = [];
  for (const row of block.querySelectorAll('tr.period-row')) {
    const title = visibleText(row.querySelector('.title'));
    periods.push({
      id: row.getAttribute('data-id'),
      parentId: row.getAttribute('data-parent-id') || null,
      title,
      grade: rowGrade(row),
      topLevel: (row.getAttribute('data-parent-id') || '') === String(id),
      range: parsePeriodRange(title),
    });
  }
  // Grading categories (Homework, Tests…) with their weight within the
  // period, e.g. "(35%)"; null when the class is points-based.
  const categories = [];
  for (const row of block.querySelectorAll('tr.category-row')) {
    const contrib = row.querySelector('.percentage-contrib');
    categories.push({
      id: row.getAttribute('data-id'),
      parentId: row.getAttribute('data-parent-id') || null,
      title: visibleText(row.querySelector('.title')) || null,
      weight: contrib ? toNumber(nodeText(contrib)) : null,
    });
  }
  const assignments = [];
  for (const row of block.querySelectorAll('tr.item-row')) {
    const a = parseItemRow(row, courseCtx);
    if (a) assignments.push(a);
  }
  const courseRowGrade = courseRow ? rowGrade(courseRow) : null;
  const fallback = pickCourseGrade(courseRowGrade, periods, ctx.now);
  const quarter = pickQuarter(periods, ctx.now);
  const overall = pickOverall(courseRowGrade, periods, ctx.now);
  // `grade` is what the family rule (GO/NO-GO) uses: the current quarter,
  // or the semester-level grade when the course has no graded quarters.
  return {
    id,
    name,
    sectionTitle,
    grade: quarter ? quarter.grade : fallback.grade,
    gradeSource: quarter ? quarter.title : fallback.gradeSource,
    gradeLabel: quarter
      ? periodName(quarter.title)
      : fallback.grade === null ? null : fallback.gradeSource === 'course' ? 'Course grade' : periodName(fallback.gradeSource) || 'Course grade',
    quarterGrade: quarter ? quarter.grade : null,
    overallGrade: overall.grade,
    overallLabel: overall.label,
    categories,
    periods: periods.map(({ id: pid, parentId, title, grade: g, topLevel, range }) => ({
      id: pid,
      parentId,
      title,
      grade: g,
      topLevel,
      start: range ? range.start.toISOString() : null,
      end: range ? range.end.toISOString() : null,
    })),
    assignments,
    url: id ? absoluteUrl(`/course/${id}/student_grades`, ctx.baseUrl) : null,
  };
}

// parseGradesRoot(root, opts) — root is a Document or an html-dom.js root.
// -> { courses, parseWarnings } or { courses: [], parseWarnings, error: 'PARSE_EMPTY' }
export function parseGradesRoot(root, { courseId, courseName, sourceUrl, baseUrl, now } = {}) {
  const parseWarnings = [];
  const ctx = { courseId, courseName, sourceUrl, baseUrl, now: now || new Date(), parseWarnings };
  const blocks = root ? [...root.querySelectorAll('.gradebook-course')] : [];
  const courses = blocks.map((b) => parseCourse(b, ctx));
  const itemRows = root ? root.querySelectorAll('tr.item-row').length : 0;
  const parsedItems = courses.reduce((n, c) => n + c.assignments.length, 0);
  const looksLikeGrades = itemRows > 0 || !!(root && root.querySelector('tr.report-row'));
  if ((courses.length === 0 && looksLikeGrades) || (itemRows > 0 && parsedItems === 0)) {
    parseWarnings.push(
      'Page looks like a Schoology grades page but its courses/assignments did not parse — Schoology page structure may have changed',
    );
    return { courses: [], parseWarnings, error: 'PARSE_EMPTY' };
  }
  if (courses.length === 0) {
    parseWarnings.push('No grades content found (not a grades page?)');
    return { courses: [], parseWarnings };
  }
  if (parsedItems < itemRows) {
    parseWarnings.push(`${itemRows - parsedItems} grade row(s) could not be read`);
  }
  return { courses, parseWarnings };
}
