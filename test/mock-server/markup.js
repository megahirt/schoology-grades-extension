// markup.js — renders mock Schoology Grades HTML in the LIVE Schoology
// structure (verified on app.schoology.com 2026-11-06; see
// extension/src/parser-core.js). All names, titles and grades rendered here
// are made-up test data, never real student data.
//
// Course data shape:
//   { id, title ("Algebra 2: Section 5"), courseGrade (number|null),
//     periods: [{ id, title ("Semester 1: 8/24/26 - 12/19/26"), grade,
//                 items: [{ id, title, kind, due ("11/03/26 11:25am"|null),
//                           score, max, letter, exception ('missing'|'excused'|'incomplete'),
//                           note (screen-reader submission label), pending (bool),
//                           hidden (bool) }] }] }

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function gradeCell(item) {
  let inner;
  if (item.exception) {
    const label = { missing: 'Missing', excused: 'Exempt', incomplete: 'Incomplete' }[item.exception];
    const placeholder = item.exception === 'missing' ? '0' : '—';
    inner = `<div class="exception-grade-wrapper"><span class="no-grade">${placeholder}</span><span class="exception"><span class="exception-icon ${item.exception}"></span><span class="exception-text">${label}</span></span></div>`;
  } else if (item.letter) {
    inner = `<span class="awarded-grade">${esc(item.letter)}</span>`;
  } else if (item.score !== undefined && item.score !== null) {
    inner = `<span class="awarded-grade"><span class="rounded-grade" title="${item.score}">${item.score}</span></span><span class="max-grade"> / ${item.max}</span>`;
  } else {
    inner = '—';
  }
  // Live Schoology quirk (seen 2026-11-07): for a submission awaiting a
  // grade, Schoology never closes the outer <span class="has-dropbox-icon
  // grade-pending-icon">. Browsers recover; a non-spec HTML parser lost every
  // row after it. The mock reproduces the unclosed tag on purpose.
  const icon = item.note
    ? (item.pending
      ? `<span class="has-dropbox-icon grade-pending-icon"><span class="visually-hidden">${esc(item.note)}</span>`
      : `<span class="has-dropbox-icon"><span class="visually-hidden">${esc(item.note)}</span></span>`)
    : '';
  return `<td class="grade-column"><div class="td-content-wrapper">${inner}<div class="grade-wrapper">${icon}</div></div></td>`;
}

const comment = '<td class="comment-column"><div class="td-content-wrapper"><span class="visually-hidden">No comment</span></div></td>';

function itemRow(item, parentId, href) {
  const due = item.due
    ? ` <span class="due-date"><span class="visually-hidden">Due </span>${esc(item.due)}</span>`
    : '';
  return `<tr data-id="I-${item.id}" data-parent-id="${parentId}" class="report-row item-row${item.hidden ? ' hidden' : ''}">` +
    `<th scope="row" class="title-column clickable"><div class="reportSpacer-4"><div class="td-content-wrapper">` +
    `<span class="title" role="button" tabindex="0"><a href="${esc(href(item))}" target="_blank">${esc(item.title)}` +
    `${item.kind ? `<span class="visually-hidden">${esc(item.kind)}</span>` : ''}</a></span>${due}</div></div></th>` +
    `${gradeCell(item)}${comment}</tr>`;
}

function gradeSpan(grade) {
  return grade === null || grade === undefined
    ? ''
    : `<span class="awarded-grade"><span class="numeric-grade primary-grade"><span class="rounded-grade" title="${grade}%">${Math.round(grade * 100) / 100}%</span></span></span>`;
}

// href(item) -> link for the assignment (student vs parent-preview form).
export function renderCourse(course, { href = (item) => `/assignment/${item.id}` } = {}) {
  const rows = [
    `<tr data-id="${course.id}" data-parent-id="" class="report-row course-row has-children"><th scope="row" class="title-column clickable" tabindex="0"><div class="reportSpacer-0"><div class="td-content-wrapper"><span class="title" role="button" tabindex="0"><span class="course-grade-text">Course Grade</span><span class="visually-hidden">Course</span></span></div></div></th><td class="grade-column"><div class="td-content-wrapper">${gradeSpan(course.courseGrade)}</div></td>${comment}</tr>`,
  ];
  for (const period of course.periods || []) {
    rows.push(
      `<tr tabindex="0" data-id="${period.id}" data-parent-id="${course.id}" class="report-row period-row has-children"><th scope="row" class="title-column clickable" tabindex="0"><div class="reportSpacer-1"><div class="td-content-wrapper"><span class="title" role="button" tabindex="0">${esc(period.title)}<span class="visually-hidden">Grading Period</span></span></div></div></th><td class="grade-column"><div class="td-content-wrapper">${gradeSpan(period.grade)}</div></td>${comment}</tr>`,
    );
    const catId = `${period.id}-1`;
    rows.push(
      `<tr data-id="${catId}" data-parent-id="${period.id}" class="report-row category-row has-children last-row-of-tier"><th scope="row" class="title-column clickable" tabindex="0"><div class="reportSpacer-3"><div class="td-content-wrapper"><span class="title" role="button" tabindex="0">Work<span class="visually-hidden">Category</span></span></div></div></th><td class="grade-column"><div class="td-content-wrapper">${gradeSpan(period.grade)}</div></td>${comment}</tr>`,
    );
    for (const item of period.items || []) rows.push(itemRow(item, catId, href));
  }
  return `<div id="s-js-gradebook-course-${course.id}" class="gradebook-course hierarchical-grading-report show-title interactive">` +
    `<div class="gradebook-course-title">${esc(course.title)}<span class="visually-hidden">Course</span></div>` +
    `<div class="gradebook-course-grades"><table role="presentation"><tbody>${rows.join('')}</tbody></table></div></div>`;
}

export function renderPage(title, bodyHtml) {
  return `<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><title>${esc(title)} | Schoology</title></head>` +
    `<body><div id="main-inner"><h1 class="page-title">${esc(title)}</h1>${bodyHtml}</div></body></html>\n`;
}
