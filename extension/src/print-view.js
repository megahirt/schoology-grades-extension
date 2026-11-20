// print-view.js — one child's dashboard laid out for one sheet of Letter
// paper (popup/print.html). Always one page: the lists are cut short with
// "+N more" until the sheet fits, and if it still doesn't, the sheet is
// shrunk to fit (fitToOnePage).
//
// Same data and rules as the dashboard (rules.js summarizeStudent):
//   - Missing, Overdue and Due soon, leaving out what the student marked;
//   - Classes, with grades only where the dashboard shows grades
//     (Settings → who sees grades);
//   - the GO/NO-GO verdict only for a parent with the badge turned on.

import { summarizeStudent, assignmentPercent } from './rules.js';
import { cleanCourseNames } from './names.js';
import { escapeHtml, dueLabel, updatedLabel, ptsText, byPointsDesc, gradeColumns, visibleCourses, isPartial } from './dashboard-view.js';

// Letter paper, with 0.4 in margins, in CSS pixels (96 per inch).
export const PAGE = { width: Math.round(7.7 * 96), height: Math.round(10.2 * 96) };

export const PRINT_CSS = `
@page { size: letter; margin: 0.4in; }
* { box-sizing: border-box; }
html, body { margin: 0; background: #eef0f3; color: #111827; }
body { font: 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.bar { display: flex; align-items: center; gap: 12px; justify-content: center; padding: 14px 16px; font-size: 14px; color: #3b4652; }
.bar button { height: 36px; padding: 0 18px; border: none; border-radius: 8px; background: #1d4ed8; color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
.paper { margin: 0 auto 24px; width: 8.5in; min-height: 11in; padding: 0.4in; background: #fff; box-shadow: 0 2px 12px rgba(15, 23, 42, 0.18); }
.sheet { width: ${PAGE.width}px; max-height: ${PAGE.height}px; overflow: hidden; transform-origin: top left; }
@media print {
  html, body { background: #fff; }
  .bar { display: none; }
  .paper { margin: 0; width: auto; min-height: 0; padding: 0; box-shadow: none; }
  .sheet { break-inside: avoid; }
}
.p-head { display: flex; align-items: flex-end; gap: 12px; padding-bottom: 8px; border-bottom: 2px solid #111827; }
.p-head .grow { flex: 1 1 auto; min-width: 0; }
.p-name { font-size: 22px; font-weight: 800; line-height: 1.15; }
.p-meta { color: #5f6b7a; margin-top: 2px; }
.p-brand { color: #5f6b7a; font-size: 11px; text-align: right; }
.p-verdict { font-size: 14px; font-weight: 800; padding: 3px 10px; border-radius: 999px; color: #fff; }
.p-verdict.go { background: #1b7a3e; } .p-verdict.nogo { background: #b42318; } .p-verdict.unknown { background: #f2b84b; color: #3d2c00; }
.p-stats { display: flex; gap: 18px; margin: 10px 0 4px; }
.p-stat b { font-size: 18px; margin-right: 4px; }
.p-stat.bad b { color: #b42318; }
.p-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 8px; }
.p-sec { margin-top: 12px; break-inside: avoid; }
.p-sec h2 { margin: 0 0 4px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1px solid #d3d7dc; padding-bottom: 2px; }
.p-sec ul { list-style: none; margin: 0; padding: 0; }
.p-sec li { padding: 3px 0; border-bottom: 1px dotted #e5e7eb; }
.p-sec li.more { color: #5f6b7a; font-style: italic; border-bottom: none; }
.p-t { font-weight: 600; }
.p-s { color: #5f6b7a; font-size: 11px; }
.p-none { color: #5f6b7a; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-size: 11px; color: #5f6b7a; font-weight: 600; padding: 2px 4px 2px 0; }
td { padding: 3px 4px 3px 0; border-bottom: 1px dotted #e5e7eb; vertical-align: top; }
td.n, th.n { text-align: right; white-space: nowrap; }
td.low { color: #b42318; font-weight: 700; }
.p-foot { margin-top: 14px; padding-top: 6px; border-top: 1px solid #d3d7dc; color: #5f6b7a; font-size: 10px; }
`;

function pct(n) {
  return typeof n === 'number' ? `${Math.round(n)}%` : '–';
}

function list(title, items, key) {
  const body = items.length
    ? `<ul data-list="${key}" data-total="${items.length}">${items.map((it) => `<li><span class="p-t">${escapeHtml(it.title)}</span>${it.sub ? `<div class="p-s">${escapeHtml(it.sub)}</div>` : ''}</li>`).join('')}</ul>`
    : '<p class="p-none">None</p>';
  return `<section class="p-sec"><h2>${escapeHtml(title)} · ${items.length}</h2>${body}</section>`;
}

// renderPrintSheet({ d, settings, marks, isParentView, now }) -> HTML for one
// child's sheet (put inside <div class="sheet">). d is one entry of
// dashboards; marks = { turnedIn, done } for that child.
export function renderPrintSheet({ d, settings, marks = {}, isParentView = false, now = Date.now() }) {
  const courses = cleanCourseNames(d.courses || []);
  const at = { ...settings, now };
  const full = summarizeStudent(courses, at, [], []);
  const overdueIds = new Set(full.overdueItems.map((a) => String(a.id)));
  // The same marks the dashboard counts (renderStudentBody).
  const own = isParentView
    ? { turnedIn: (marks.turnedIn || []).filter((id) => overdueIds.has(String(id))), done: [] }
    : { turnedIn: marks.turnedIn || [], done: marks.done || [] };
  const s = summarizeStudent(courses, at, own.turnedIn, own.done);
  const showGrades = settings.gradeVisibility === 'both'
    || (settings.gradeVisibility === 'parent' && isParentView)
    || (settings.gradeVisibility === 'student' && !isParentView);
  const partial = Boolean(d.error) || isPartial(d);
  const verdict = isParentView && settings.showGoNoGo
    ? (partial ? 'UNKNOWN' : s.verdict.verdict)
    : null;
  const printed = new Date(now).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const updated = d.updatedAt ? updatedLabel(d.updatedAt).replace(/^Updated/, 'grades updated') : 'not updated yet';

  let html = '<header class="p-head"><div class="grow">' +
    `<div class="p-name">${escapeHtml(d.studentName || 'Student')}</div>` +
    `<div class="p-meta">Printed ${escapeHtml(printed)} · ${escapeHtml(updated)}</div></div>` +
    (verdict ? `<span class="p-verdict ${verdict === 'GO' ? 'go' : verdict === 'NO-GO' ? 'nogo' : 'unknown'}">${verdict}</span>` : '') +
    '<div class="p-brand">Grades Dashboard<br>for Schoology</div></header>';
  if (partial) html += '<p class="p-none">Only part of the grades loaded. Refresh the dashboard and print again for the full picture.</p>';

  const overdueCount = s.overdueItems.length;
  html += '<div class="p-stats">' +
    `<span class="p-stat${s.missingCount >= settings.missingThreshold ? ' bad' : ''}"><b>${s.missingCount}</b>Missing</span>` +
    `<span class="p-stat${overdueCount >= settings.overdueThreshold ? ' bad' : ''}"><b>${overdueCount}</b>Overdue</span>` +
    `<span class="p-stat"><b>${s.dueToday.length + s.dueTomorrow.length}</b>Due today or tomorrow</span>` +
    `<span class="p-stat"><b>${s.waiting.length}</b>Waiting on the teacher</span></div>`;

  const missing = byPointsDesc(s.missingItems).map((a) => ({ title: a.title, sub: [a.courseName, dueLabel(a), ptsText(a)].filter(Boolean).join(' · ') }));
  const dueT = (a) => { const t = Date.parse(a.due || ''); return Number.isNaN(t) ? Infinity : t; };
  const overdue = [...s.overdueItems].sort((x, y) => dueT(x) - dueT(y)).map((a) => ({ title: a.title, sub: [a.courseName, dueLabel(a)].filter(Boolean).join(' · ') }));
  const due = [
    ...byPointsDesc(s.dueToday).map((a) => ({ title: a.title, sub: [a.courseName, 'Today', ptsText(a)].filter(Boolean).join(' · ') })),
    ...byPointsDesc(s.dueTomorrow).map((a) => ({ title: a.title, sub: [a.courseName, 'Tomorrow', ptsText(a)].filter(Boolean).join(' · ') })),
  ];

  // Classes: every class with grade data; the quarter grade first when there
  // are quarters, then the semester or overall grade.
  const shown = visibleCourses(courses);
  const cols = gradeColumns(shown);
  const t = settings.gradeThreshold;
  const missingBy = new Map();
  for (const a of s.missingItems) missingBy.set(a.courseName, (missingBy.get(a.courseName) || 0) + 1);
  const rows = shown.map((c) => {
    const first = cols.quarter ? c.quarterGrade : c.grade;
    const second = cols.quarter ? c.overallGrade : null;
    const low = (n) => (typeof n === 'number' && n < t ? ' low' : '');
    return `<tr><td>${escapeHtml(c.name)}</td>` +
      (showGrades ? `<td class="n${low(first)}">${pct(first)}</td>${cols.quarter && cols.overall ? `<td class="n${low(second)}">${pct(second)}</td>` : ''}` : '') +
      `<td class="n">${missingBy.get(c.name) || ''}</td></tr>`;
  });
  const classes = '<section class="p-sec"><h2>Classes</h2>' + (rows.length
    ? '<table><thead><tr><th>Class</th>' +
      (showGrades ? `<th class="n">${escapeHtml(cols.quarter || 'Grade')}</th>${cols.quarter && cols.overall ? `<th class="n">${escapeHtml(cols.overall)}</th>` : ''}` : '') +
      `<th class="n">Missing</th></tr></thead><tbody>${rows.join('')}</tbody></table>`
    : '<p class="p-none">No classes with grades yet.</p>') + '</section>';

  // Recent low grades (rules.js notSoGood) only where grades show; then work
  // turned in that the teacher hasn't graded yet.
  const lows = showGrades
    ? s.notSoGood.map((a) => {
      const p = assignmentPercent(a);
      return { title: a.title, sub: [a.courseName, p !== null ? `${Math.round(p)}%` : a.letterGrade, dueLabel(a)].filter(Boolean).join(' · ') };
    })
    : [];
  const waiting = [...s.waiting].sort((x, y) => dueT(y) - dueT(x)).map((a) => ({ title: a.title, sub: [a.courseName, dueLabel(a)].filter(Boolean).join(' · ') }));

  html += '<div class="p-cols"><div>' + list('Missing', missing, 'missing') + list('Overdue', overdue, 'overdue') + list('Due soon', due, 'due') + '</div>' +
    `<div>${classes}${showGrades ? list('Recent low grades', lows, 'low') : ''}${list('Waiting on the teacher', waiting, 'waiting')}</div></div>`;
  html += '<footer class="p-foot">Read from Schoology on this device by Grades Dashboard for Schoology. Check Schoology for the latest.</footer>';
  return html;
}

// fitToOnePage(sheet, height) — make the sheet fit one page: while it is too
// tall, cut the longest list by one item (never below 3), keeping a
// "+N more" line; then, if it is still too tall, shrink it to fit. Returns
// { trimmed, scale }.
export function fitToOnePage(sheet, height = PAGE.height) {
  const tall = () => sheet.scrollHeight > height + 1;
  sheet.style.maxHeight = 'none';
  let trimmed = 0;
  const lists = [...sheet.querySelectorAll('ul[data-list]')];
  const items = (ul) => [...ul.querySelectorAll('li:not(.more)')];
  while (tall()) {
    const longest = lists.filter((ul) => items(ul).length > 3).sort((a, b) => items(b).length - items(a).length)[0];
    if (!longest) break;
    items(longest).at(-1).remove();
    trimmed += 1;
    let more = longest.querySelector('li.more');
    if (!more) {
      more = sheet.ownerDocument.createElement('li');
      more.className = 'more';
      longest.append(more);
    }
    more.textContent = `+${Number(longest.dataset.total) - items(longest).length} more (see the dashboard)`;
  }
  // Still too tall (a very long class list): shrink the whole sheet. The
  // height is measured before zooming, so the zoomed sheet is the page's
  // height at most.
  let scale = 1;
  if (tall()) {
    scale = Math.floor((height / sheet.scrollHeight) * 1000) / 1000;
    sheet.style.zoom = String(scale);
  }
  return { trimmed, scale };
}
