// parser.js — Grades HTML parser (pure JS; node-html-parser, no DOM).
//
// IMPORTANT: the fixture HTML structure parsed here is MODELLED on the known
// Schoology Grades structure (grades table, Missing markers) — it is NOT
// verified live Schoology DOM. Selectors must be re-validated against live
// Schoology pages before relying on them, and the parser self-checks: if the
// HTML looks like a grades page but zero courses/assignments parse, it
// returns error 'PARSE_EMPTY' instead of a silent green GO.
//
// Fixture structure (see SPEC.md):
//   <div class="gradebook">
//     <section class="course-grades" data-course-id="..." data-course-name="...">
//       <h2 class="course-name">...</h2>
//       <span class="course-grade">55%</span>
//       <table class="grades-table"><tbody>
//         <tr class="assignment-row" data-assignment-id="...">
//           <td class="assignment-title">...</td>
//           <td class="assignment-due" data-due="2026-11-03T23:59:00">Nov 3</td>
//           <td class="assignment-grade">
//             <span class="grade-score">0</span>
//             <span class="exception-icon exception-missing" title="Missing"></span>
//           </td>
//         </tr>
//       </tbody></table>
//     </section>
//   </div>
//
// Missing detection, multi-signal, in SPEC order:
//   (1) an element inside the grade cell whose title or aria-label contains
//       "missing" (case-insensitive);
//   (2) a class name containing "missing" on the grade cell or its children;
//   (3) cell text exactly "Missing".
// NEVER infer Missing from a 0 score or from overdue alone.

import { parse } from 'node-html-parser';

function textOf(el) {
  return el ? (el.text || '').trim() : '';
}

function parsePercent(raw) {
  if (raw === null || raw === undefined) return null;
  const m = String(raw).match(/(-?\d+(?:\.\d+)?)\s*%/);
  if (m) return Number(m[1]);
  return null;
}

// "42/50" -> { score: 42, maxPoints: 50 }; "85" -> { score: 85, maxPoints: null };
// "—", "-", "", "Missing" -> { score: null, maxPoints: null }.
function parseScore(raw) {
  if (raw === null || raw === undefined) return { score: null, maxPoints: null };
  const t = String(raw).trim();
  if (!t || t === '—' || t === '–' || t === '-') return { score: null, maxPoints: null };
  const frac = t.match(/(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (frac) return { score: Number(frac[1]), maxPoints: Number(frac[2]) };
  const num = t.match(/-?\d+(?:\.\d+)?/);
  if (num) return { score: Number(num[0]), maxPoints: null };
  return { score: null, maxPoints: null };
}

function exceptionFromCell(gradeCell) {
  if (!gradeCell) return null;
  // (1) title / aria-label containing the exception word.
  const titled = gradeCell.querySelectorAll('[title], [aria-label]');
  for (const el of titled) {
    const label = `${el.getAttribute('title') || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase();
    if (label.includes('missing')) return 'missing';
    if (label.includes('incomplete')) return 'incomplete';
    if (label.includes('excused')) return 'excused';
  }
  // Also check the grade cell itself.
  const selfLabel = `${gradeCell.getAttribute('title') || ''} ${gradeCell.getAttribute('aria-label') || ''}`.toLowerCase();
  if (selfLabel.includes('missing')) return 'missing';
  if (selfLabel.includes('incomplete')) return 'incomplete';
  if (selfLabel.includes('excused')) return 'excused';
  // (2) class name containing the exception word, on the cell or children.
  const classText = [gradeCell.getAttribute('class') || '']
    .concat([...gradeCell.querySelectorAll('*')].map((el) => el.getAttribute('class') || ''))
    .join(' ')
    .toLowerCase();
  if (classText.includes('missing')) return 'missing';
  if (classText.includes('incomplete')) return 'incomplete';
  if (classText.includes('excused')) return 'excused';
  // (3) cell text exactly "Missing" (also Incomplete / Excused for symmetry).
  const cellText = textOf(gradeCell);
  if (cellText === 'Missing') return 'missing';
  if (cellText === 'Incomplete') return 'incomplete';
  if (cellText === 'Excused') return 'excused';
  return null;
}

function parseAssignmentRow(row, course, parseWarnings, sourceUrl) {
  const titleEl = row.querySelector('.assignment-title');
  const title = textOf(titleEl);
  const id = row.getAttribute('data-assignment-id') || null;
  if (!title) {
    parseWarnings.push(`Assignment row without a title in course ${course.name || course.id || '?'}`);
    return null;
  }
  const dueEl = row.querySelector('.assignment-due');
  const dueText = textOf(dueEl);
  let due = null;
  if (dueEl) {
    const dataDue = dueEl.getAttribute('data-due');
    if (dataDue) {
      const d = new Date(dataDue);
      if (!Number.isNaN(d.getTime())) due = d.toISOString();
      else parseWarnings.push(`Unparseable data-due "${dataDue}" on "${title}"`);
    } else if (dueText) {
      // No machine-readable due date; keep the display text only.
      due = null;
    }
  }
  const gradeCell = row.querySelector('.assignment-grade');
  const scoreEl = gradeCell ? gradeCell.querySelector('.grade-score') : null;
  const { score, maxPoints } = parseScore(scoreEl ? textOf(scoreEl) : null);
  const exception = exceptionFromCell(gradeCell);

  let status;
  if (exception === 'missing') status = 'missing';
  else if (exception === 'incomplete') status = 'incomplete';
  else if (exception === 'excused') status = 'excused';
  else if (score !== null) status = 'graded';
  else if (due) {
    status = new Date(due) < new Date() ? 'overdue' : 'pending';
  } else {
    status = 'pending';
  }

  return { id, title, due, dueText, score, maxPoints, status, sourceUrl: sourceUrl || null };
}

function parseCourseSection(section, parseWarnings, sourceUrl) {
  const id = section.getAttribute('data-course-id') || null;
  const name =
    section.getAttribute('data-course-name') ||
    textOf(section.querySelector('.course-name')) ||
    null;
  // Per-child attribution when the page carries it (e.g. the parent grade
  // report): data-child-uid / data-student on the section. Null when absent —
  // callers must NOT guess which child a course belongs to.
  const childUid = section.getAttribute('data-child-uid') || null;
  const studentName = section.getAttribute('data-student') || null;
  const gradeEl = section.querySelector('.course-grade');
  const grade = parsePercent(gradeEl ? textOf(gradeEl) : null);
  const assignments = [];
  for (const row of section.querySelectorAll('tr.assignment-row')) {
    const a = parseAssignmentRow(row, { id, name }, parseWarnings, sourceUrl);
    if (a) assignments.push(a);
  }
  return { id, name, grade, assignments, childUid, studentName };
}

// parseGradesHtml(html, { courseId, courseName, sourceUrl } = {})
// -> { courses: [{ id, name, grade, assignments: [...] }], parseWarnings }
// or, on self-check failure, { courses: [], parseWarnings, error: 'PARSE_EMPTY' }.
export function parseGradesHtml(html, { courseId, courseName, sourceUrl } = {}) {
  const parseWarnings = [];
  const raw = typeof html === 'string' ? html : '';
  if (!raw.trim()) {
    return { courses: [], parseWarnings: ['Empty HTML supplied to parser'] };
  }
  const root = parse(raw);
  const courses = [];

  const sections = root.querySelectorAll('section.course-grades, .course-grades');
  for (const section of sections) {
    const course = parseCourseSection(section, parseWarnings, sourceUrl);
    if (course.name || course.assignments.length > 0) courses.push(course);
  }

  if (courses.length === 0) {
    // Fallback: a bare grades table with no course section wrapper
    // (e.g. a single-course Grades page). Use the caller-supplied course.
    const tables = root.querySelectorAll('table.grades-table');
    if (tables.length > 0) {
      const course = { id: courseId || null, name: courseName || null, grade: null, assignments: [], childUid: null, studentName: null };
      const gradeEl = root.querySelector('.course-grade');
      course.grade = parsePercent(gradeEl ? textOf(gradeEl) : null);
      for (const row of root.querySelectorAll('tr.assignment-row')) {
        const a = parseAssignmentRow(row, course, parseWarnings, sourceUrl);
        if (a) course.assignments.push(a);
      }
      if (course.assignments.length > 0 || course.name) courses.push(course);
    }
  }

  const totalAssignments = courses.reduce((n, c) => n + c.assignments.length, 0);
  const looksLikeGradesPage =
    /grades-table|course-grades|course-name|gradebook/i.test(raw) ||
    /grades/i.test(raw);
  if (courses.length === 0 || totalAssignments === 0) {
    if (looksLikeGradesPage) {
      parseWarnings.push(
        'HTML looks like a grades page but zero courses/assignments were parsed — Schoology page structure may have changed',
      );
      return { courses: [], parseWarnings, error: 'PARSE_EMPTY' };
    }
    parseWarnings.push('No grades content found in HTML (not a grades page?)');
    return { courses: [], parseWarnings };
  }
  return { courses, parseWarnings };
}
