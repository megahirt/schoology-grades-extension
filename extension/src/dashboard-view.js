// dashboard-view.js — the dashboard UI, shared by the toolbar popup
// (popup/popup.js) and the in-page panel on Schoology pages (src/panel.js).
// Layout follows the "Schoology Dashboard Panel" design:
//   header (title or "Hi, <name>", updated time, refresh, close in the panel)
//   → child switcher (parents with 2+ children)
//   → verdict card (GO/NO-GO pill when settings.showGoNoGo, reason, numbers)
//   → Missing (with "Turned in") → Due soon (with a grey ✓ "Mark as done")
//   → Classes (grade bars with the passing line) → Doing well / Not so good
//   → Waiting on teacher (with Undo) → footer.
// Every verdict is recomputed locally with rules.js, so marks show at once.
//
// mountDashboard(container, options) renders into any element (a popup body
// or a shadow root) and re-renders whenever the stored data changes, so every
// open popup and panel stays in sync. It only uses APIs that also work in
// content scripts: browser.storage and browser.runtime.sendMessage/getURL.

import { summarizeStudent, DEFAULT_SETTINGS, assignmentPercent, hasGradeData, withHiddenCourses } from './rules.js';
import {
  getSettings,
  setSettings,
  getDashboards,
  setDashboards,
  getTurnedIn,
  setTurnedIn,
  getMarkedDone,
  setMarkedDone,
  storageGet,
  storageSet,
} from './storage.js';
import css from './dashboard.css';
// Bundled as a data: URL (scripts/build.mjs) so the panel can show it inside
// Schoology's page without exposing extension files to web pages.
import npcLogo from '../icons/npc_icon_tiny.png';
// Schoology's own Missing icon (from its asset CDN, 14×12), so "Missing"
// here looks like Missing on Schoology's grades page.
import missingIcon from '../icons/schoology-missing.png';

const MISSING_IMG = `<img class="missing-icon" src="${missingIcon}" alt="" width="14" height="12">`;

export const DASHBOARD_CSS = css;

const DEMO_ANCHOR = new Date('2026-11-06T00:00:00');

// Dev builds only (scripts/build.mjs --dev defines __DEV__): a footer switch
// between real Schoology (the default) and the local mock server
// (`npm run mock-server`). Production builds never show it.
const IS_DEV = typeof __DEV__ !== 'undefined' && __DEV__; // eslint-disable-line no-undef
export const REAL_SCHOOLOGY = 'https://app.schoology.com';
export const MOCK_SCHOOLOGY = 'http://localhost:8123';
const STALE_MS = 24 * 60 * 60 * 1000;
// A refresh still marked running after this long is treated as dead (the
// service worker can be stopped mid-refresh).
const REFRESH_STUCK_MS = 3 * 60 * 1000;

// Only part of the grades loaded (some rows unreadable): never show a GO or
// NO-GO built on partial data.
export function isPartial(d) {
  return Array.isArray(d && d.parseWarnings)
    && d.parseWarnings.some((w) => /could not be read|did not parse/i.test(String(w)));
}

export function refreshRunning(state, now = Date.now()) {
  return Boolean(state && state.running && now - Date.parse(state.startedAt || 0) < REFRESH_STUCK_MS);
}

function friendlyRefreshError(error) {
  if (error === 'NOT_LOGGED_IN' || error === 'LOGGED_OUT') return 'Sign in to Schoology in this browser, then refresh.';
  return `Couldn’t refresh: ${error || 'unknown error'}`;
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Line icons (stroke = currentColor), decorative: the buttons carry labels.
const ICON = {
  refresh: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 4v5h-5"/></svg>',
  close: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  spinner: '<svg class="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9"/></svg>',
  cog: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  heart: '<svg width="13" height="13" viewBox="0 0 24 24" fill="#c2410c" stroke="none" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/></svg>',
  checkSmall: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
};

export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'Student';
}

function shortDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function dueLabel(a) {
  if (a.due) {
    const s = shortDate(a.due);
    if (s) return `Due ${s}`;
  }
  return a.dueText ? `Due ${a.dueText}` : '';
}

function updatedLabel(iso) {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return '';
  const time = when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const today = new Date();
  if (when.toDateString() === today.toDateString()) return `Updated today, ${time}`;
  return `Updated ${shortDate(iso)}, ${time}`;
}

function gradeText(a, settings) {
  const pct = assignmentPercent(a);
  if (pct === null) return a.status === 'graded' && a.letterGrade ? String(a.letterGrade) : '';
  if (settings.gradeDisplay === 'points' && a.maxPoints) return `${a.score}/${a.maxPoints}`;
  return `${Math.round(pct)}%`;
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function mostCommon(values) {
  const counts = new Map();
  for (const v of values) if (v) counts.set(v, (counts.get(v) || 0) + 1);
  let best = null;
  for (const [v, n] of counts) if (!best || n > counts.get(best)) best = v;
  return best;
}

// Column labels for a child's class list: the quarter the verdict uses
// ("Quarter 2") and the second column ("Semester", or "Overall" once a later
// semester has grades). Courses without quarters fall back individually.
export function gradeColumns(courses) {
  const list = courses || [];
  return {
    quarter: mostCommon(list.filter((c) => c.quarterGrade !== null && c.quarterGrade !== undefined).map((c) => c.gradeLabel)),
    overall: mostCommon(list.map((c) => c.overallLabel)),
  };
}

// "Quarter 2 is from Oct 19 to Dec 15." from the grading-period title
// Schoology shows on the grades page ("Quarter 2: 10/19/2026 - 12/15/2026").
export function quarterDatesLine(courses) {
  const titles = (courses || [])
    .filter((c) => typeof c.quarterGrade === 'number' && c.gradeSource)
    .map((c) => c.gradeSource);
  const title = mostCommon(titles);
  if (!title) return '';
  const m = String(title).match(/^([^:]+):\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*[-–]\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return '';
  const year = (y) => (Number(y) < 100 ? 2000 + Number(y) : Number(y));
  const start = new Date(year(m[4]), Number(m[2]) - 1, Number(m[3]));
  const end = new Date(year(m[7]), Number(m[5]) - 1, Number(m[6]));
  const fmt = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${m[1].trim()} is from ${fmt(start)} to ${fmt(end)}.`;
}

function pctText(n) {
  return typeof n === 'number' ? `${Math.round(n * 10) / 10}%` : '—';
}

// The student view's "what to do first" line.
function studentNote(summary, settings, period = null) {
  const todo = [];
  if (summary.missingCount === 1) todo.push(`turn in ${summary.missingItems[0].title}`);
  else if (summary.missingCount > 1) todo.push(`turn in ${summary.missingCount} missing assignments`);
  for (const c of summary.lowClasses.slice(0, 2)) todo.push(`bring ${c.name} up past ${settings.gradeThreshold}%${period && /^quarter/i.test(period) ? ' this quarter' : ''}`);
  if (!todo.length) return null;
  const n = summary.missingCount + summary.lowClasses.length;
  const text = todo.join(' and ');
  return { title: `${plural(n, 'thing', 'things')} to finish first`, body: text.charAt(0).toUpperCase() + text.slice(1) + '.' };
}

// Section headings carry an emoji; sections with no items are left out.
export const SECTION_EMOJI = {
  missing: MISSING_IMG, // Schoology's Missing icon rather than an emoji
  due: '⌛',
  classes: '🏛️',
  notSoGood: '📉',
  doingWell: '🎉',
  waiting: '📬',
};

function sectionHeading(title, emoji, extraClass = '') {
  // `emoji` is trusted markup from SECTION_EMOJI (an emoji, or the icon <img>).
  return `<h2 class="sec-h${extraClass}"><span class="sec-emoji" aria-hidden="true">${emoji}</span>${escapeHtml(title)}</h2>`;
}

function section(title, inner, emoji) {
  return `<section class="sec">${sectionHeading(title, emoji)}${inner}</section>`;
}

function titleLink(a, cls = 'item-title') {
  return a.url
    ? `<a class="${cls}" href="${escapeHtml(a.url)}">${escapeHtml(a.title)}</a>`
    : `<span class="${cls}">${escapeHtml(a.title)}</span>`;
}

function renderMissing(summary, uid) {
  if (!summary.missingItems.length) return '';
  const rows = summary.missingItems.map((a) => {
    const sub = [a.courseName, dueLabel(a)].filter(Boolean).map(escapeHtml).join(' · ');
    const note = a.submitted ? '<span class="note">Submitted, not graded yet</span>' : '';
    return `<div class="missing-card"><div class="grow">${titleLink(a)}<div class="sub">${sub}</div>${note}</div>` +
      `<button class="btn btn-sm" type="button" data-act="turned-in" data-uid="${escapeHtml(uid)}" data-aid="${escapeHtml(a.id ?? '')}">Turned in</button></div>`;
  });
  return section(`Missing · ${summary.missingItems.length}`, rows.join(''), SECTION_EMOJI.missing);
}

function renderDue(summary, uid) {
  const items = [
    ...summary.dueToday.map((a) => ({ a, when: 'Today', cls: 'today' })),
    ...summary.dueTomorrow.map((a) => ({ a, when: 'Tomorrow', cls: 'tomorrow' })),
  ];
  if (!items.length) return '';
  const rows = items.map(({ a, when, cls }) =>
    `<div class="row"><div class="grow">${titleLink(a, 'row-title')}<div class="sub">${escapeHtml(a.courseName || '')}</div></div>` +
    `<span class="chip ${cls}">${when}</span>` +
    `<button class="check-btn" type="button" data-act="done" data-uid="${escapeHtml(uid)}" data-aid="${escapeHtml(a.id ?? '')}" aria-label="Mark ${escapeHtml(a.title)} as done" title="Mark as done">${ICON.check}</button></div>`);
  return section('Due soon', rows.join(''), SECTION_EMOJI.due);
}

// Classes: only real classes (with grade data), minus any the family
// unticked in the setup wizard (settings.realClasses[`${uid}:${id}`] false).
export function visibleCourses(courses, settings, uid) {
  const real = settings.realClasses || {};
  return (courses || []).filter((c) => {
    const choice = real[`${uid}:${c.id || c.name}`];
    if (choice === true || choice === false) return choice; // chosen in Settings
    return hasGradeData(c); // sections with no grades start hidden
  });
}

function renderClasses(courses, settings, showGrades, uid) {
  const list = visibleCourses(courses, settings, uid);
  if (!list.length) return '';
  const t = settings.gradeThreshold;
  const cols = gradeColumns(list);
  const qHead = cols.quarter || 'Grade';
  const oHead = cols.overall;
  const head = showGrades
    ? `<div class="class-cols">${sectionHeading('Classes', SECTION_EMOJI.classes, ' grow')}<span class="col-h col-q">${escapeHtml(qHead)}</span>` +
      (oHead ? `<span class="col-h col-o">${escapeHtml(oHead)}</span>` : '') + '</div>'
    : sectionHeading('Classes', SECTION_EMOJI.classes);
  const rows = list.map((c) => {
    const grade = typeof c.grade === 'number' ? c.grade : null;
    // With quarters, the first column is the quarter grade, or a dash while
    // the quarter has no grades (the semester grade then stands).
    const first = cols.quarter ? (typeof c.quarterGrade === 'number' ? c.quarterGrade : null) : grade;
    const firstLow = first !== null && first < t;
    const overallIsVerdict = cols.quarter && first === null && grade !== null;
    const overallLow = overallIsVerdict && grade < t;
    const grades = showGrades
      ? `<span class="class-grade col-q${firstLow ? ' low' : ''}">${pctText(first)}</span>` +
        (oHead ? `<span class="class-overall col-o${overallLow ? ' low' : ''}">${pctText(c.overallGrade)}</span>` : '')
      : '';
    // The bar shows the grade GO/NO-GO uses: the quarter, or the semester
    // grade while the quarter has none.
    const barGrade = first !== null ? first : grade;
    const barLow = barGrade !== null && barGrade < t;
    const bar = showGrades && barGrade !== null
      ? `<div class="bar" aria-hidden="true"><div class="bar-fill${barLow ? ' low' : ''}" style="width:${Math.max(0, Math.min(100, barGrade))}%"></div><div class="bar-line" style="left:${t}%"></div></div>`
      : '';
    const name = c.url
      ? `<a class="class-name" href="${escapeHtml(c.url)}" title="Open ${escapeHtml(c.name)} grades in Schoology">${escapeHtml(c.name)}</a>`
      : `<span class="class-name">${escapeHtml(c.name)}</span>`;
    return `<div class="class"><div class="class-head"><span class="grow">${name}</span>${grades}</div>${bar}</div>`;
  });
  const dates = showGrades ? quarterDatesLine(list) : '';
  return `<section class="sec">${head}${rows.join('')}${dates ? `<p class="legend">${escapeHtml(dates)}</p>` : ''}</section>`;
}

function renderGradedList(title, items, settings, showGrades, emoji) {
  if (!items.length) return '';
  const rows = items.map((a) => {
    const g = showGrades ? gradeText(a, settings) : '';
    const pct = assignmentPercent(a);
    const low = pct !== null && pct < settings.gradeThreshold;
    return `<div class="row"><div class="grow">${titleLink(a, 'row-title')}<div class="sub">${escapeHtml(a.courseName || '')}</div></div>` +
      (g ? `<span class="row-grade${low ? ' low' : ''}">${escapeHtml(g)}</span>` : '') + '</div>';
  });
  return section(title, rows.join(''), emoji);
}

const WAITING_HOW = {
  submitted: 'Submitted, not graded yet',
  turnedIn: 'Marked turned in',
  done: 'Marked done',
};

function renderWaiting(summary, uid) {
  const n = summary.waiting.length;
  if (!n) {
    return '';
  }
  // Schoology-reported submissions first, then the family's own marks.
  const order = { submitted: 0, turnedIn: 1, done: 2 };
  const items = [...summary.waiting].sort((a, b) => order[a.waitingReason] - order[b.waitingReason]);
  const rows = items.map((a) => {
    const how = WAITING_HOW[a.waitingReason] || 'Waiting on teacher';
    const sub = [a.courseName, dueLabel(a), how].filter(Boolean).map(escapeHtml).join(' · ');
    // Still marked Missing on Schoology (submitted or turned in, not yet graded).
    const missingTag = a.status === 'missing' ? `<span class="missing-tag">${MISSING_IMG}Missing</span>` : '';
    const undo = a.waitingReason === 'submitted'
      ? ''
      : `<button class="link-btn" type="button" data-act="undo" data-reason="${a.waitingReason}" data-uid="${escapeHtml(uid)}" data-aid="${escapeHtml(a.id ?? '')}" aria-label="Undo: ${escapeHtml(a.title)}">Undo</button>`;
    return `<div class="waiting"><span class="waiting-icon">${ICON.checkSmall}</span>` +
      `<div class="grow">${titleLink(a, 'waiting-title')}<div class="sub">${sub}</div>${missingTag}</div>${undo}</div>`;
  });
  const manual = items.some((a) => a.waitingReason === 'turnedIn' || a.waitingReason === 'done');
  const disclaimer = manual ? '<p class="fineprint">Marking something done or turned in is for your own use — nobody is notified.</p>' : '';
  return section(`Waiting on teacher · ${n}`, rows.join('') + disclaimer, SECTION_EMOJI.waiting);
}

function verdictPill(verdict) {
  const cls = verdict === 'GO' ? 'go' : verdict === 'NO-GO' ? 'nogo' : 'unknown';
  return `<span class="pill ${cls}">${verdict}</span>`;
}

function avatarHtml(d) {
  return d.pictureUrl
    ? `<img class="avatar" src="${escapeHtml(d.pictureUrl)}" alt="" data-initials="${escapeHtml(initials(d.studentName))}">`
    : `<span class="avatar" aria-hidden="true">${escapeHtml(initials(d.studentName))}</span>`;
}

// One child's (or the student's own) dashboard body.
export function renderStudentBody(d, uid, settings, marks, { isParentView }) {
  const summary = summarizeStudent(d.courses || [], withHiddenCourses(settings, uid), marks.turnedIn, marks.done);
  const showGrades = settings.gradeVisibility === 'both'
    || (settings.gradeVisibility === 'parent' && isParentView)
    || (settings.gradeVisibility === 'student' && !isParentView);
  const failed = Boolean(d.error);
  const partial = !failed && isPartial(d);
  let html = '';

  if (failed) {
    html += `<div class="card unknown"><div class="card-head">${avatarHtml(d)}<div class="grow"><div class="card-name">${escapeHtml(d.studentName || 'Student')}</div>` +
      `<div class="card-reason">Could not read these grades just now. Press Refresh to try again.</div></div>${isParentView ? verdictPill('UNKNOWN') : ''}</div></div>`;
  } else if (isParentView) {
    // GO/NO-GO is for parents only; students get the "finish first" note.
    const verdict = partial ? 'UNKNOWN' : summary.verdict.verdict;
    const good = verdict === 'GO';
    // Only a NO-GO earns a badge (GO is the quiet default). UNKNOWN keeps its
    // badge too, since its line underneath explains why there's no verdict.
    const pill = settings.showGoNoGo && verdict !== 'GO' ? verdictPill(verdict) : '';
    // Compact metrics, only when non-zero: Missing and Due soon. (Classes
    // below the passing grade show in the Classes section, in red.)
    const stats = [];
    if (summary.missingCount > 0) {
      stats.push({ value: String(summary.missingCount), label: 'Missing', bad: summary.missingCount >= settings.missingThreshold });
    }
    const dueCount = summary.dueToday.length + summary.dueTomorrow.length;
    if (dueCount > 0) stats.push({ value: String(dueCount), label: 'Due soon', bad: false });
    const cardTone = !settings.showGoNoGo ? 'plain' : partial ? 'unknown' : good ? 'go' : 'nogo';
    // Just the picture, name and (when on) the GO/NO-GO badge. The only
    // line under the name is for an UNKNOWN verdict, which needs a reason.
    const reason = partial ? '<div class="card-reason">Only part of the grades loaded, so no verdict yet. Press Refresh.</div>' : '';
    html += `<div class="card ${cardTone}">` +
      `<div class="card-head">${avatarHtml(d)}<div class="grow"><div class="card-name">${escapeHtml(d.studentName || 'Student')}</div>` +
      `${reason}</div>${pill}</div>` +
      (stats.length
        ? `<div class="stats">${stats.map((st) => `<div class="stat"><span class="stat-v${st.bad ? ' low' : ''}">${escapeHtml(st.value)}</span>` +
          `<span class="stat-l">${escapeHtml(st.label)}</span></div>`).join('')}</div>`
        : '') + '</div>';
  } else {
    const note = studentNote(summary, settings, gradeColumns(visibleCourses(d.courses, settings, uid)).quarter);
    html += note
      ? `<div class="card nogo"><div class="card-name">${escapeHtml(note.title)}</div><div class="card-body">${escapeHtml(note.body)}</div></div>`
      : '<div class="card go"><div class="card-name">All caught up</div><div class="card-body">Nothing missing and every class is passing.</div></div>';
  }

  if (Array.isArray(d.parseWarnings) && d.parseWarnings.length) {
    html += `<p class="warn">${d.parseWarnings.map(escapeHtml).join('<br>')}</p>`;
  }
  if (!failed) {
    html += renderMissing(summary, uid);
    html += renderDue(summary, uid);
    html += renderClasses(d.courses, settings, showGrades, uid);
    html += renderGradedList('Not so good', summary.notSoGood, settings, showGrades, SECTION_EMOJI.notSoGood);
    html += renderGradedList('Doing well', summary.doingWell, settings, showGrades, SECTION_EMOJI.doingWell);
    html += renderWaiting(summary, uid);
  }
  return { html, summary };
}

// Demo data with due dates shifted so "today"/"tomorrow" line up with the
// day the demo is loaded (demo anchor: 2026-11-06).
export async function loadDemo(browser) {
  const res = await fetch(browser.runtime.getURL('popup/demo-data.json'));
  const data = await res.json();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const shiftMs = todayStart.getTime() - DEMO_ANCHOR.getTime();
  const dashboards = data.dashboards || {};
  for (const d of Object.values(dashboards)) {
    for (const c of d.courses || []) {
      for (const a of c.assignments || []) {
        if (a.due) {
          const shifted = new Date(new Date(a.due).getTime() + shiftMs);
          a.due = shifted.toISOString();
          a.dueText = shifted.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        }
      }
    }
    d.updatedAt = new Date().toISOString();
  }
  await setDashboards(dashboards);
}

async function loadState() {
  const settings = { ...DEFAULT_SETTINGS, schoologyBase: 'https://app.schoology.com', ...((await getSettings()) || {}) };
  return {
    settings,
    dashboards: (await getDashboards()) || {},
    turnedIn: (await getTurnedIn()) || {},
    done: (await getMarkedDone()) || {},
    refreshState: (await storageGet('refreshState', null)) || null,
    // The child last picked in any popup or panel (storage key dashboardChild).
    lastChild: (await storageGet('dashboardChild', null)) || null,
  };
}

// Toggle one id in a { [uid]: [ids] } mark store.
async function toggleMark(get, set, uid, aid, on) {
  const all = (await get()) || {};
  const ids = new Set((all[uid] || []).map(String));
  if (on) ids.add(aid);
  else ids.delete(aid);
  all[uid] = [...ids];
  await set(all);
}

// mountDashboard(container, { browser, showDemo = true, openOptions, onClose })
//   container   — element (or shadow root) to render into; its contents are replaced.
//   browser     — the webextension-polyfill namespace.
//   showDemo    — show the "Load demo data" button (popup only).
//   openOptions — how to open the settings page (content scripts cannot call
//                 runtime.openOptionsPage, so the panel asks the background).
//   onClose     — when given, the header gets a close button (the panel).
//   openLinksInActiveTab — the toolbar popup: assignment and class links
//                 load in the current browser tab (and close the popup)
//                 instead of navigating the popup. In the panel, links are
//                 ordinary same-tab links on the Schoology page.
// Returns { render, destroy }.
export function mountDashboard(container, { browser, showDemo = true, openOptions, onClose, openLinksInActiveTab = false } = {}) {
  const root = container.ownerDocument.createElement('div');
  root.className = 'sgd';
  container.replaceChildren(root);
  let pickedUid = null;
  let statusText = '';

  async function render() {
    const { settings, dashboards, turnedIn, done, refreshState, lastChild } = await loadState();
    const running = refreshRunning(refreshState);
    const uids = Object.keys(dashboards);
    const isParentView = uids.length > 1 || (uids.length === 1 && uids[0] !== 'self');
    // Stay on the child picked last (also after a page load or in another
    // popup/panel); fall back to the first child.
    if (lastChild && uids.includes(lastChild)) pickedUid = lastChild;
    if (!uids.includes(pickedUid)) pickedUid = uids[0] || null;
    const current = pickedUid ? dashboards[pickedUid] : null;

    let latest = null;
    for (const d of Object.values(dashboards)) {
      if (d.updatedAt && (!latest || d.updatedAt > latest)) latest = d.updatedAt;
    }
    const stale = latest && Date.now() - new Date(latest).getTime() > STALE_MS;
    const heading = isParentView || !current
      ? '<h1 class="title">Homework Dashboard</h1>'
      : `<h1 class="title">Hi, ${escapeHtml(firstName(current.studentName))}</h1>`;
    const headAvatar = !isParentView && current ? avatarHtml(current) : '';

    let header = `<header class="head"><div class="head-row">${headAvatar}<div class="grow">${heading}` +
      `<div class="muted">${latest ? escapeHtml(updatedLabel(latest)) : 'Not updated yet'}</div></div>` +
      (running
        ? `<button class="icon-btn busy" type="button" data-act="refresh" disabled aria-label="Refreshing grades" title="Refreshing grades">${ICON.spinner}</button>`
        : `<button class="icon-btn" type="button" data-act="refresh" aria-label="Refresh grades" title="Refresh grades">${ICON.refresh}</button>`) +
      `<button class="icon-btn" type="button" data-act="options" aria-label="Settings" title="Settings">${ICON.cog}</button>` +
      (onClose ? `<button class="icon-btn ghost" type="button" data-act="close" aria-label="Close dashboard panel" title="Close">${ICON.close}</button>` : '') +
      '</div>';

    if (isParentView && uids.length > 1) {
      const tabs = uids.map((uid) => {
        const d = dashboards[uid];
        const s = summarizeStudent(d.courses || [], withHiddenCourses(settings, uid), turnedIn[uid], done[uid]);
        const v = d.error || isPartial(d) ? 'unknown' : s.verdict.verdict === 'GO' ? 'go' : 'nogo';
        const dot = settings.showGoNoGo ? `<span class="dot ${v}" aria-hidden="true"></span>` : '';
        const sel = uid === pickedUid;
        return `<button class="tab${sel ? ' sel' : ''}" type="button" role="tab" aria-selected="${sel}" data-act="pick" data-uid="${escapeHtml(uid)}">${dot}${escapeHtml(firstName(d.studentName))}</button>`;
      });
      header += `<div class="tabs" role="tablist" aria-label="Choose a child" style="grid-template-columns:repeat(${uids.length}, minmax(0, 1fr))">${tabs.join('')}</div>`;
    }
    header += '</header>';

    let body;
    if (!current) {
      body = `<p class="empty">No Schoology data yet. Sign in to Schoology in this browser and press Refresh${showDemo ? ', or load the demo data to see how the dashboard looks' : ''}.</p>`;
    } else {
      const marks = { turnedIn: turnedIn[pickedUid], done: done[pickedUid] };
      body = renderStudentBody(current, pickedUid, settings, marks, { isParentView }).html;
    }
    if (stale && !running) body = '<p class="stale">These grades are more than a day old. Press Refresh.</p>' + body;
    if (running) {
      const total = Math.max(1, Number(refreshState.total) || 1);
      const doneSteps = Math.min(total, Number(refreshState.done) || 0);
      // Never show an empty bar: the first step is already under way.
      const pct = Math.max(8, Math.round(((doneSteps + 0.5) / total) * 100));
      body = '<div class="refreshing" role="status" aria-live="polite">' +
        `<div class="refreshing-row">${ICON.spinner}<b>Refreshing grades…</b>` +
        `<span class="refreshing-step">${escapeHtml(refreshState.label || '')}${total > 1 ? ` · ${Math.min(doneSteps + 1, total)} of ${total}` : ''}</span></div>` +
        `<div class="progress" role="progressbar" aria-label="Refresh progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div class="progress-fill" style="width:${pct}%"></div></div>` +
        '</div>' + body;
    }
    // A refresh that failed recently (including an automatic one) explains why.
    const failedRecently = refreshState && !running && refreshState.ok === false
      && Date.now() - Date.parse(refreshState.finishedAt || 0) < 10 * 60 * 1000;
    if (failedRecently && !statusText) statusText = friendlyRefreshError(refreshState.error);
    if (refreshState && refreshState.ok && statusText.startsWith('Couldn’t refresh')) statusText = '';

    const usingMock = settings.schoologyBase === MOCK_SCHOOLOGY;
    let buildStamp = '';
    try {
      const v = browser.runtime.getManifest().version_name || '';
      buildStamp = v.includes('-dev.') ? v.split('-dev.')[1].replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2}).*$/, '$2/$3 $4:$5') : '';
    } catch {
      buildStamp = '';
    }
    const devSwitch = IS_DEV
      ? '<div class="dev-row"><span class="dev-tag">DEV</span><span class="grow">Data: ' +
        `<b>${usingMock ? 'Mock server (localhost:8123)' : 'Real Schoology'}</b>` +
        (buildStamp ? `<span class="dev-build"> · built ${escapeHtml(buildStamp)} UTC</span>` : '') + '</span>' +
        `<button class="btn btn-sm" type="button" data-act="switch-source">${usingMock ? 'Use real Schoology' : 'Use mock server'}</button></div>`
      : '';
    const footer = '<footer class="foot">' + devSwitch +
      `<div class="status" role="status">${escapeHtml(statusText)}</div>` +
      (showDemo ? '<div class="foot-row"><button class="btn btn-sm" type="button" data-act="demo">Load demo data</button></div>' : '') +
      '</footer>' +
      `<div class="credit">${ICON.heart}<span>Made with love for</span><img class="credit-logo" src="${npcLogo}" alt="NPC" width="20" height="20"><span>by Chris Hirt</span></div>`;

    root.innerHTML = header + `<main class="body">${body}</main>` + footer;
    // A profile picture that fails to load falls back to the initials.
    for (const img of root.querySelectorAll('img.avatar')) {
      img.addEventListener('error', () => {
        const span = root.ownerDocument.createElement('span');
        span.className = 'avatar';
        span.setAttribute('aria-hidden', 'true');
        span.textContent = img.dataset.initials || '?';
        img.replaceWith(span);
      }, { once: true });
    }
  }

  function setStatus(text) {
    statusText = text;
    const el = root.querySelector('.status');
    if (el) el.textContent = text;
  }

  async function onClick(e) {
    const link = openLinksInActiveTab && e.target.closest('a[href]');
    if (link && root.contains(link)) {
      e.preventDefault();
      // Cmd/Ctrl/Shift-click or middle-click still opens a new tab.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) await browser.tabs.create({ url: link.href });
      else {
        await browser.tabs.update({ url: link.href });
        container.ownerDocument.defaultView.close();
      }
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn || !root.contains(btn)) return;
    const { act, uid, aid } = btn.dataset;
    if (act === 'pick') {
      pickedUid = uid;
      await render();
      await storageSet('dashboardChild', uid).catch(() => {});
    } else if (act === 'turned-in' && uid && aid) {
      await toggleMark(getTurnedIn, setTurnedIn, uid, aid, true);
    } else if (act === 'done' && uid && aid) {
      await toggleMark(getMarkedDone, setMarkedDone, uid, aid, true);
    } else if (act === 'undo' && uid && aid) {
      if (btn.dataset.reason === 'done') await toggleMark(getMarkedDone, setMarkedDone, uid, aid, false);
      else await toggleMark(getTurnedIn, setTurnedIn, uid, aid, false);
    } else if (act === 'refresh') {
      if (btn.disabled) return;
      btn.disabled = true; // the banner and progress bar take over from storage
      statusText = '';
      try {
        const result = await browser.runtime.sendMessage({ type: 'refresh-now' });
        if (result && !result.ok) setStatus(friendlyRefreshError(result.error));
      } catch (err) {
        setStatus(friendlyRefreshError(err.message || String(err)));
      }
      await render();
    } else if (act === 'demo') {
      try {
        await loadDemo(browser);
        setStatus('Demo data loaded.');
      } catch (err) {
        setStatus(`Could not load demo data: ${err.message || err}`);
      }
    } else if (act === 'options') {
      if (openOptions) openOptions();
      else browser.runtime.openOptionsPage();
    } else if (act === 'switch-source' && IS_DEV) {
      // Swap the data source, drop the other source's data, then refresh.
      const settings = (await getSettings()) || {};
      const toMock = settings.schoologyBase !== MOCK_SCHOOLOGY;
      await setSettings({ ...settings, schoologyBase: toMock ? MOCK_SCHOOLOGY : REAL_SCHOOLOGY });
      await setDashboards({});
      setStatus(toMock ? 'Switched to the mock server. Refreshing…' : 'Switched to real Schoology. Refreshing…');
      try {
        const result = await browser.runtime.sendMessage({ type: 'refresh-now' });
        setStatus(result && result.ok ? '' : `Refresh failed: ${(result && result.error) || 'sign in to the new source, then press Refresh'}`);
      } catch (err) {
        setStatus(`Refresh failed: ${err.message || err}`);
      }
      await render();
    } else if (act === 'close' && onClose) {
      onClose();
    }
    // Mark changes re-render through storage.onChanged below.
  }
  root.addEventListener('click', onClick);
  if (openLinksInActiveTab) root.addEventListener('auxclick', onClick); // middle-click

  const WATCHED = ['dashboards', 'settings', 'turnedIn', 'markedDone', 'refreshState', 'dashboardChild'];
  function onStorageChanged(changes, area) {
    if (area === 'local' && WATCHED.some((k) => k in changes)) render();
  }
  browser.storage.onChanged.addListener(onStorageChanged);

  render();
  return {
    render,
    destroy() {
      browser.storage.onChanged.removeListener(onStorageChanged);
      root.removeEventListener('click', onClick);
      root.removeEventListener('auxclick', onClick);
      root.remove();
    },
  };
}
