// print-view.js — one child's dashboard laid out for one sheet of Letter
// paper (popup/print.html). Always one page: the lists are cut short with
// "+N more" until the sheet fits, and if it still doesn't, the sheet is
// shrunk to fit (fitToOnePage).
//
// Same data and rules as the dashboard (rules.js summarizeStudent):
//   - Missing, Overdue and Due soon, leaving out what the student marked,
//     each with an empty box to tick off with a pencil;
//   - Classes, with grades only where the dashboard shows grades
//     (Settings → who sees grades); Recent low grades; Doing well;
//   - the GO/NO-GO verdict only for a parent with the badge turned on.

import { summarizeStudent } from './rules.js';
import { cleanCourseNames } from './names.js';
import { escapeHtml, dueLabel, updatedLabel, ptsText, byPointsDesc, gradeColumns, visibleCourses, isPartial, gradeText, SECTION_EMOJI, ABOUT_URL } from './dashboard-view.js';

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
.p-head { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 12px; background: #f6f7f9; }
.p-head.go { background: #eef7f1; } .p-head.nogo { background: #fbefed; } .p-head.unknown { background: #fff4db; }
.p-head .grow { flex: 1 1 auto; min-width: 0; }
.p-name { font-size: 22px; font-weight: 800; line-height: 1.15; }
.p-meta { color: #5f6b7a; margin-top: 2px; }
.p-brand { color: #5f6b7a; font-size: 11px; text-align: right; }
.p-brand b { color: #1d4ed8; }
.p-verdict { font-size: 14px; font-weight: 800; padding: 3px 10px; border-radius: 999px; color: #fff; }
.p-verdict.go { background: #1b7a3e; } .p-verdict.nogo { background: #b42318; } .p-verdict.unknown { background: #f2b84b; color: #3d2c00; }
.p-stats { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0 2px; }
.p-stat { display: inline-flex; align-items: baseline; gap: 5px; padding: 3px 10px; border-radius: 8px; border: 1px solid #e5e7eb; background: #fff; }
.p-stat b { font-size: 16px; }
.p-stat.missing { background: #fdf6f5; border-color: #f1d4cf; }
.p-stat.overdue { background: #fdf8ec; border-color: #f3dfb4; }
.p-stat.due { background: #f3f6fe; border-color: #c7d4f5; }
.p-stat.well { background: #eef7f1; border-color: #b9dcc5; }
.p-stat.bad b { color: #b42318; }
.p-stat .e { font-size: 12px; }
.missing-icon { width: 14px; height: 12px; vertical-align: -1px; }
.p-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 8px; }
.p-sec { margin-top: 12px; break-inside: avoid; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; }
.p-sec h2 { display: flex; align-items: center; gap: 6px; margin: 0; padding: 5px 10px; font-size: 12.5px; text-transform: uppercase; letter-spacing: 0.04em; color: #3b4652; background: #f6f7f9; border-bottom: 1px solid #e5e7eb; }
.p-sec h2 .e { font-size: 14px; letter-spacing: 0; }
.p-sec h2 .missing-icon { width: 16px; height: 14px; }
.p-sec.missing { border-color: #f1d4cf; } .p-sec.missing h2 { background: #fbefed; border-color: #f1d4cf; color: #8f1c13; }
.p-sec.overdue { border-color: #f3dfb4; } .p-sec.overdue h2 { background: #fdf3dc; border-color: #f3dfb4; color: #7a4b00; }
.p-sec.due { border-color: #c7d4f5; } .p-sec.due h2 { background: #e8eefc; border-color: #c7d4f5; color: #1e3a8a; }
.p-sec.well { border-color: #b9dcc5; } .p-sec.well h2 { background: #eef7f1; border-color: #b9dcc5; color: #14592d; }
.p-sec.low { border-color: #f1d4cf; } .p-sec.low h2 { background: #fdf6f5; border-color: #f1d4cf; color: #8f1c13; }
.p-sec.classes h2 { background: #f1f3f6; }
.p-sec > ul, .p-sec > .p-none { margin: 0; padding: 4px 10px 5px; }
.p-sec > table { width: calc(100% - 20px); margin: 3px 10px 5px; }
.p-sec ul { list-style: none; }
.p-sec li { display: flex; align-items: flex-start; gap: 8px; padding: 3px 0; border-bottom: 1px dotted #e5e7eb; }
.p-sec li:last-child { border-bottom: none; }
.p-sec li.more { display: block; color: #5f6b7a; font-style: italic; }
.p-sec li .grow { flex: 1 1 auto; min-width: 0; }
.p-box { flex: 0 0 auto; width: 14px; height: 14px; margin-top: 1px; border: 1.5px solid #4b5563; border-radius: 3px; background: #fff; }
.p-g { flex: 0 0 auto; font-weight: 700; color: #1b7a3e; white-space: nowrap; }
.p-sec.low .p-g { color: #b42318; }
.p-t { font-weight: 600; }
.p-s { color: #5f6b7a; font-size: 11px; }
.p-none { color: #5f6b7a; }
table { border-collapse: collapse; }
th { text-align: left; font-size: 11px; color: #5f6b7a; font-weight: 600; padding: 2px 4px 2px 0; }
td { padding: 3px 4px 3px 0; border-bottom: 1px dotted #e5e7eb; vertical-align: top; }
td.n, th.n { text-align: right; white-space: nowrap; }
td.low { color: #b42318; font-weight: 700; }
.p-foot { margin-top: 14px; padding-top: 6px; border-top: 1px solid #d3d7dc; color: #5f6b7a; font-size: 10px; }
.p-foot b { color: #1d4ed8; }
`;

// The website, named in the footer.
const SITE_HOST = new URL(ABOUT_URL).host;

function pct(n) {
  return typeof n === 'number' ? `${Math.round(n)}%` : '–';
}

// One colored section, like the dashboard's: `key` picks the color (CSS
// .p-sec.<key>) and the heading's emoji/icon; `check` puts an empty box in
// front of each item to tick off with a pencil; an item's `grade` shows at
// the right.
const EMOJI = { missing: SECTION_EMOJI.missing, overdue: SECTION_EMOJI.overdue, due: SECTION_EMOJI.due, well: SECTION_EMOJI.doingWell, low: SECTION_EMOJI.notSoGood, classes: SECTION_EMOJI.classes };

function heading(title, key) {
  // EMOJI holds trusted markup (an emoji, or the Missing icon <img>).
  return `<h2><span class="e" aria-hidden="true">${EMOJI[key] || ''}</span>${escapeHtml(title)}</h2>`;
}

function list(title, items, key, { check = false, count = true } = {}) {
  const li = (it) => '<li>' + (check ? '<span class="p-box" aria-hidden="true"></span>' : '') +
    `<div class="grow"><span class="p-t">${escapeHtml(it.title)}</span>${it.sub ? `<div class="p-s">${escapeHtml(it.sub)}</div>` : ''}</div>` +
    (it.grade ? `<span class="p-g">${escapeHtml(it.grade)}</span>` : '') + '</li>';
  // A section with nothing in it is left out, as on the dashboard.
  if (!items.length) return '';
  const body = `<ul data-list="${key}" data-total="${items.length}">${items.map(li).join('')}</ul>`;
  return `<section class="p-sec ${key}">${heading(count ? `${title} · ${items.length}` : title, key)}${body}</section>`;
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

  const tone = verdict === 'GO' ? ' go' : verdict === 'NO-GO' ? ' nogo' : verdict ? ' unknown' : '';
  let html = `<header class="p-head${tone}"><div class="grow">` +
    `<div class="p-name">${escapeHtml(d.studentName || 'Student')}</div>` +
    `<div class="p-meta">Printed ${escapeHtml(printed)} · ${escapeHtml(updated)}</div></div>` +
    (verdict ? `<span class="p-verdict ${verdict === 'GO' ? 'go' : verdict === 'NO-GO' ? 'nogo' : 'unknown'}">${verdict}</span>` : '') +
    '<div class="p-brand"><b>Grades Dashboard</b><br>for Schoology</div></header>';
  if (partial) html += '<p class="p-none">Only part of the grades loaded. Refresh the dashboard and print again for the full picture.</p>';

  const overdueCount = s.overdueItems.length;
  const stat = (key, n, label, bad) => `<span class="p-stat ${key}${bad ? ' bad' : ''}"><span class="e" aria-hidden="true">${EMOJI[key]}</span><b>${n}</b>${label}</span>`;
  html += '<div class="p-stats">' +
    stat('missing', s.missingCount, 'Missing', s.missingCount >= settings.missingThreshold) +
    stat('overdue', overdueCount, 'Overdue', overdueCount >= settings.overdueThreshold) +
    stat('due', s.dueToday.length + s.dueTomorrow.length, 'Due today or tomorrow', false) +
    stat('well', s.doingWell.length, 'Doing well', false) + '</div>';

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
  const classes = rows.length
    ? `<section class="p-sec classes">${heading('Classes', 'classes')}` +
      '<table><thead><tr><th>Class</th>' +
      (showGrades ? `<th class="n">${escapeHtml(cols.quarter || 'Grade')}</th>${cols.quarter && cols.overall ? `<th class="n">${escapeHtml(cols.overall)}</th>` : ''}` : '') +
      `<th class="n">Missing</th></tr></thead><tbody>${rows.join('')}</tbody></table></section>`
    : '';

  // Recent low grades (rules.js notSoGood) only where grades show; then
  // Doing well (B or better lately), most recent first, with the grade only
  // where grades show, as on the dashboard.
  const lows = showGrades
    ? s.notSoGood.map((a) => ({ title: a.title, sub: [a.courseName, dueLabel(a)].filter(Boolean).join(' · '), grade: gradeText(a, settings) }))
    : [];
  const well = [...s.doingWell].sort((x, y) => dueT(y) - dueT(x)).map((a) => ({
    title: a.title,
    sub: [a.courseName, dueLabel(a)].filter(Boolean).join(' · '),
    grade: showGrades ? gradeText(a, settings) : '',
  }));

  const box = { check: true };
  html += '<div class="p-cols"><div>' + list('Missing', missing, 'missing', box) + list('Overdue', overdue, 'overdue', box) + list('Due soon', due, 'due', box) + '</div>' +
    `<div>${classes}${showGrades ? list('Recent low grades', lows, 'low') : ''}${list('Doing well', well, 'well')}</div></div>`;
  html += `<footer class="p-foot">By <b>Grades Dashboard for Schoology</b> · get it at <b>${escapeHtml(SITE_HOST)}</b></footer>`;
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
