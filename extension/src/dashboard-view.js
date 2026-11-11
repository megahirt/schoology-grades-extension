// dashboard-view.js — the dashboard UI, shared by the toolbar popup
// (popup/popup.js) and the in-page panel on Schoology pages (src/panel.js).
// Layout follows the "Schoology Dashboard Panel" design:
//   header (title or "Hi, <name>", updated time, refresh, close in the panel)
//   → child switcher (parents with 2+ children)
//   → verdict card (GO/NO-GO pill when settings.showGoNoGo, reason, numbers)
//   → Missing (grey ✓ "Mark as turned in") → Due soon (grey ✓ "Mark as done")
//   → Classes (grade bars with the passing line) → Doing well / Not so good
//   → Records (personal bests, rewards.js) → Submitted, not graded yet (with Undo)
//   → footer. The card also carries this week's ring (parents).
// Every verdict is recomputed locally with rules.js, so marks show at once.
//
// mountDashboard(container, options) renders into any element (a popup body
// or a shadow root) and re-renders whenever the stored data changes, so every
// open popup and panel stays in sync. It only uses APIs that also work in
// content scripts: browser.storage and browser.runtime.sendMessage/getURL.

import { summarizeStudent, DEFAULT_SETTINGS, assignmentPercent, isExtraCredit, isBonus, hasGradeData, effectiveSettings, isStudentAccount } from './rules.js';
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
  getSite,
  setSite,
  changedFor,
  getSites,
  getUser,
} from './storage.js';
import { cleanCourseNames } from './names.js';
import { gradeHistory } from './grade-history.js';
import { renderGradeChart, chartHover, chartUnhover, smoothPath, linePoints } from './grade-chart.js';
import { quarterChange, weekProgress, isNewRecord, classHighScore, classWeek, weekRange, dueThisWeek, WEEK_DONE } from './rewards.js';
import { composeMessage, composeHash, composeUrlFor } from './teacher-email.js';
import { captureDashboard, copyImage, shareImage, isApplePlatform } from './screenshot.js';
import css from './dashboard.css';
// Bundled as a data: URL (scripts/build.mjs) so the panel can show it inside
// Schoology's page without exposing extension files to web pages.
import npcLogo from '../icons/npc_icon_tiny.png';
// Schoology's own Missing icon (from its asset CDN, 14×12), so "Missing"
// here looks like Missing on Schoology's grades page.
import missingIcon from '../icons/schoology-missing.png';

export const MISSING_IMG = `<img class="missing-icon" src="${missingIcon}" alt="" width="14" height="12">`;

export const DASHBOARD_CSS = css;

const DEMO_ANCHOR = new Date('2026-11-06T00:00:00');

// Dev builds only (scripts/build.mjs --dev defines __DEV__): a footer switch
// between real Schoology (the default) and the local mock server
// (`npm run mock-server`). Production builds never show it.
const IS_DEV = typeof __DEV__ !== 'undefined' && __DEV__; // eslint-disable-line no-undef
export { REAL_SCHOOLOGY } from './sites.js';
import { REAL_SCHOOLOGY } from './sites.js';
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

// A refresh that failed because nobody is signed in to Schoology.
export function isSignedOutError(error) {
  return error === 'NOT_LOGGED_IN' || error === 'LOGGED_OUT';
}

function friendlyRefreshError(error) {
  if (isSignedOutError(error)) return 'Please log in to Schoology to see the latest.';
  if (error === 'SCHOOLOGY_UNAVAILABLE') return 'Couldn’t reach Schoology. Press Refresh to try again.';
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
  // Android and most of the web: three connected dots.
  shareDots: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4"/><path d="M15.4 6.5l-6.8 4"/></svg>',
  // Mac, iPhone and iPad: a box with an arrow up.
  shareApple: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M7 11H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1"/></svg>',
  mail: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5l8.5 6.5 8.5-6.5"/></svg>',
  check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  // Submitted, not graded yet: an outbox tray (sent, waiting for the teacher).
  tray: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 13v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/><path d="M3 13h5l1.5 2.5h5L16 13h5"/><path d="M12 11V3.5"/><path d="M8.5 7L12 3.5 15.5 7"/></svg>',
  spinner: '<svg class="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9"/></svg>',
  cog: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
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
  if (pct === null && isExtraCredit(a)) return `+${Math.round(a.score * 100) / 100} pts`;
  if (pct === null) return a.status === 'graded' && a.letterGrade ? String(a.letterGrade) : '';
  if (settings.gradeDisplay === 'points' && a.maxPoints) return `${a.score}/${a.maxPoints}`;
  return `${Math.round(pct)}%`;
}

// What an assignment is worth ("10 pts"), never what was earned (the
// percent shows that). Empty when Schoology doesn't say: parents only see
// the total once the work is graded.
function ptsText(a) {
  const m = a && a.maxPoints;
  if (typeof m !== 'number' || !(m > 0)) return '';
  const n = Math.round(m * 100) / 100;
  return `${n} ${n === 1 ? 'pt' : 'pts'}`;
}

// Largest point value first; work with no known value keeps its order, last.
function byPointsDesc(list, get = (x) => x) {
  const val = (x) => (typeof get(x).maxPoints === 'number' ? get(x).maxPoints : -1);
  return list.map((x, i) => ({ x, i })).sort((p, q) => val(q.x) - val(p.x) || p.i - q.i).map(({ x }) => x);
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

// Section headings carry an emoji; sections with no items are left out.
const SHARE_LABEL = 'Share a picture of the dashboard';
export const SECTION_EMOJI = {
  missing: MISSING_IMG, // Schoology's Missing icon rather than an emoji
  due: '⌛',
  classes: '🏛️',
  notSoGood: '📉',
  doingWell: '🎉',
  waiting: '📬',
  records: '🏆',
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

function renderMissing(summary, uid, isParentView = false) {
  if (!summary.missingItems.length) return '';
  const rows = byPointsDesc(summary.missingItems).map((a) => {
    const sub = [a.courseName, dueLabel(a), ptsText(a)].filter(Boolean).map(escapeHtml).join(' · ');
    const note = a.submitted ? '<span class="note">Submitted, not graded yet</span>' : '';
    // Emailing the teacher is for parents only.
    const mail = isParentView
      ? `<button class="check-btn mail-btn" type="button" data-act="email-teacher" data-uid="${escapeHtml(uid)}" data-cid="${escapeHtml(a.courseId ?? '')}" data-aid="${escapeHtml(a.id ?? '')}" aria-label="Message the ${escapeHtml(a.courseName || 'class')} teacher about ${escapeHtml(a.title)}" title="Message the teacher">${ICON.mail}</button>`
      : '';
    return `<div class="missing-card" data-aid="${escapeHtml(a.id ?? '')}"><div class="grow">${titleLink(a)}<div class="sub">${sub}</div>${note}</div>` +
      mail +
      `<button class="check-btn" type="button" data-act="turned-in" data-uid="${escapeHtml(uid)}" data-aid="${escapeHtml(a.id ?? '')}" aria-label="Mark ${escapeHtml(a.title)} as turned in" title="Mark as turned in">${ICON.check}</button></div>`;
  });
  return section(`Missing · ${summary.missingItems.length}`, rows.join(''), SECTION_EMOJI.missing);
}

function renderDue(summary, uid) {
  const items = [
    // Within a day, largest point value first.
    ...byPointsDesc(summary.dueToday).map((a) => ({ a, when: 'Today', cls: 'today' })),
    ...byPointsDesc(summary.dueTomorrow).map((a) => ({ a, when: 'Tomorrow', cls: 'tomorrow' })),
  ];
  if (!items.length) return '';
  const rows = items.map(({ a, when, cls }) =>
    `<div class="row"><div class="grow">${titleLink(a, 'row-title')}<div class="sub">${[a.courseName, ptsText(a)].filter(Boolean).map(escapeHtml).join(' · ')}</div></div>` +
    `<span class="chip ${cls}">${when}</span>` +
    `<button class="check-btn" type="button" data-act="done" data-uid="${escapeHtml(uid)}" data-aid="${escapeHtml(a.id ?? '')}" aria-label="Mark ${escapeHtml(a.title)} as done" title="Mark as done">${ICON.check}</button></div>`);
  return section(`Due soon · ${items.length}`, rows.join(''), SECTION_EMOJI.due);
}

// Classes: only real classes, i.e. ones with grade data. Sections with no
// grades posted (advisory, house group) are left out.
export function visibleCourses(courses) {
  return (courses || []).filter((c) => hasGradeData(c));
}

// Grade histories of the charts currently drawn, for hover:
// key -> { history, gradeDisplay }.
const drawnCharts = new Map();
const CHEVRON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

// "▲ 6% vs Q1" for a class whose quarter grade is up on last quarter.
function upPill(course) {
  const ch = quarterChange(course);
  if (!ch) return '';
  const title = `Up ${ch.delta}% from ${ch.prevTitle} (${pctText(ch.prevGrade)})`;
  return `<span class="up-pill" title="${escapeHtml(title)}"><span aria-hidden="true">▲ ${ch.delta}% vs ${escapeHtml(ch.prevShort)}</span><span class="sr-only">${escapeHtml(title)}</span></span>`;
}

// A class's trend line: the same running grade as the grade chart, since
// school started, 60×20 px, with an amber band below the passing grade.
// Needs 5 graded items; before that the spot stays empty. It shares the
// spot left of the quarter grade with "▲ 6% vs Q1", so a class shows one or
// the other. Clicking it opens the grade chart.
const TREND_MIN_GRADES = 5;
function trendLine(history, threshold) {
  const W = 60;
  const H = 20;
  const lo = 40;
  const hi = 100;
  const span = Math.max(1, history.end - history.start);
  const x = (t) => ((Math.min(Math.max(t, history.start), history.end) - history.start) / span) * W;
  const y = (v) => H - 1 - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (H - 2);
  const passY = y(threshold);
  // One smooth, connected stroke through every point (as in the chart).
  const all = linePoints(history);
  const lines = all.length > 1
    ? `<path d="${smoothPath(all.map((p) => [x(p.t), y(p.grade)]))}" fill="none" stroke="#4f6a9a" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`
    : '';
  const last = all[all.length - 1];
  return `<svg class="trend-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">` +
    `<rect x="0" y="${passY.toFixed(1)}" width="${W}" height="${(H - passY).toFixed(1)}" fill="#fdf1d8"/>` +
    `<line x1="0" x2="${W}" y1="${passY.toFixed(1)}" y2="${passY.toFixed(1)}" stroke="#b9c0ca" stroke-width="1" stroke-dasharray="2 2"/>` +
    lines + (last ? `<circle cx="${x(last.t).toFixed(1)}" cy="${y(last.grade).toFixed(1)}" r="2.4" fill="#4f6a9a"/>` : '') + '</svg>';
}

// This week's assignments for one class, shown when the class is opened:
// one compact line each, with a check button (mark done or turned in, or
// undo the family's own mark), the title, a Missing or Submitted icon, the
// day it's due and, once graded, the grade. Work Schoology shows as graded or
// submitted (or past due without a Missing mark) is already checked.
const WEEK_ICON_TITLE = {
  submitted: 'Submitted, not graded yet',
  turnedIn: 'Marked turned in, not graded yet',
  done: 'Marked done, not graded yet',
  assumed: 'Past due and not marked Missing',
};
function weekSpan(now) {
  const { from, to } = weekRange(now);
  const a = new Date(from);
  const b = new Date(to - 1);
  const m = (d) => d.toLocaleDateString(undefined, { month: 'short' });
  return a.getMonth() === b.getMonth() ? `${m(a)} ${a.getDate()} to ${b.getDate()}` : `${m(a)} ${a.getDate()} to ${m(b)} ${b.getDate()}`;
}
function weekListHtml(wk, earlierMissing, uid, settings, showGrades, now) {
  const when = (i) => { const t = Date.parse(i.a.due || ''); return Number.isNaN(t) ? -Infinity : t; };
  const items = [...earlierMissing, ...wk.items].sort((x, y) => when(x) - when(y));
  if (!items.length) return '<div class="week-list"><p class="empty">Nothing due in this class this week.</p></div>';
  const rows = items.map(({ a, state }) => {
    const done = WEEK_DONE.has(state);
    const hasId = a.id !== undefined && a.id !== null;
    const marked = state === 'turnedIn' || state === 'done';
    const locked = !hasId || state === 'graded' || state === 'submitted' || state === 'assumed';
    const title = a.title || 'Assignment';
    let btn;
    if (locked) {
      const why = state === 'graded' ? 'graded' : state === 'submitted' ? 'submitted in Schoology' : done ? 'counted as turned in' : 'cannot be marked';
      btn = `<button class="wk-check${done ? ' on' : ''}" type="button" disabled aria-label="${escapeHtml(`${title}: ${why}`)}">${ICON.check}</button>`;
    } else if (marked) {
      btn = `<button class="wk-check on" type="button" data-act="undo" data-reason="${state}" data-uid="${escapeHtml(uid)}" data-aid="${escapeHtml(a.id)}" aria-pressed="true" aria-label="${escapeHtml(`Undo: ${title}`)}" title="Undo">${ICON.check}</button>`;
    } else {
      // Missing work is marked turned in (as in the Missing section), other
      // work done (as in Due soon).
      const act = state === 'missing' ? 'turned-in' : 'done';
      const verb = state === 'missing' ? 'turned in' : 'done';
      btn = `<button class="wk-check" type="button" data-act="${act}" data-uid="${escapeHtml(uid)}" data-aid="${escapeHtml(a.id)}" aria-pressed="false" aria-label="${escapeHtml(`Mark ${title} as ${verb}`)}" title="Mark as ${verb}">${ICON.check}</button>`;
    }
    let icon = '';
    if (state === 'missing') icon = `<span class="wk-icon" role="img" aria-label="Missing" title="Missing">${MISSING_IMG}</span>`;
    else if (WEEK_ICON_TITLE[state]) icon = `<span class="wk-icon wk-sub" role="img" aria-label="${WEEK_ICON_TITLE[state]}" title="${WEEK_ICON_TITLE[state]}">${ICON.tray}</span>`;
    // This week: the weekday ("Fri"); earlier Missing work: the date ("Nov 3").
    const t = new Date(a.due);
    const day = Number.isNaN(t.getTime()) ? ''
      : dueThisWeek(a, now) ? t.toLocaleDateString(undefined, { weekday: 'short' }) : t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const grade = state === 'graded' && showGrades ? gradeText(a, settings) : '';
    return `<li class="wk">${btn}${titleLink(a, `wk-title${done ? ' done' : ''}`)}${icon}<span class="wk-due">${escapeHtml(day)}</span>` +
      `<span class="wk-grade">${escapeHtml(grade)}</span></li>`;
  });
  return `<div class="week-list"><ul class="wk-rows">${rows.join('')}</ul></div>`;
}

function renderClasses(courses, settings, showGrades, uid, openClass = null, { marks = {}, summary = null, now = Date.now() } = {}) {
  const list = visibleCourses(courses);
  if (!list.length) return '';
  const t = settings.gradeThreshold;
  const cols = gradeColumns(list);
  const qHead = cols.quarter || 'Grade';
  const oHead = cols.overall;
  // "Nov 9 to 15": the week the class bars count, beside the grade columns.
  const weekHead = `<span class="col-h col-w">${escapeHtml(weekSpan(now))}</span>`;
  const head = `<div class="class-cols">${sectionHeading('Classes', SECTION_EMOJI.classes, ' grow')}${weekHead}` +
    (showGrades
      ? `<span class="col-h col-q">${escapeHtml(qHead)}</span>` + (oHead ? `<span class="col-h col-o">${escapeHtml(oHead)}</span>` : '')
      : '') + '</div>';
  const rows = list.map((c) => {
    const grade = typeof c.grade === 'number' ? c.grade : null;
    // With quarters, the first column is the quarter grade, or a dash while
    // the quarter has no grades (the semester grade then stands).
    const first = cols.quarter ? (typeof c.quarterGrade === 'number' ? c.quarterGrade : null) : grade;
    const firstLow = first !== null && first < t;
    const overallIsVerdict = cols.quarter && first === null && grade !== null;
    const overallLow = overallIsVerdict && grade < t;
    // Clicking anywhere on the class's row opens the grade chart; again
    // closes it.
    const key = `${uid}:${c.id || c.name}`;
    // Every class opens (its week list), grades hidden or not; the chart
    // inside is only there when grades are shown.
    const open = openClass === key;
    const toggle = (inner, cls, label) => `<button type="button" class="${cls}" data-act="toggle-chart" data-key="${escapeHtml(key)}" aria-expanded="${open}"${label ? ` aria-label="${escapeHtml(label)}"` : ''}>${inner}</button>`;
    const history = showGrades ? gradeHistory(c) : null;
    let trend = '';
    if (history) {
      const n = history.points.length;
      if (n >= TREND_MIN_GRADES && history.segments.length) {
        const first0 = history.segments[0].line[0].grade;
        const lastSeg = history.segments[history.segments.length - 1];
        const lastG = lastSeg.line[lastSeg.line.length - 1].grade;
        trend = `<span class="trend-line" role="img" aria-label="${escapeHtml(`${c.name} trend: from ${Math.round(first0)}% to ${Math.round(lastG)}% over ${n} grades`)}">${trendLine(history, t)}</span>`;
      }
    }
    const grades = showGrades
      // "▲ 6% vs Q1" sits just left of the quarter grade, so the grades
      // stay lined up in their columns.
      ? `${trend}${(cols.quarter && upPill(c)) || ''}<span class="class-grade col-q${firstLow ? ' low' : ''}">${pctText(first)}</span>` +
        (oHead ? `<span class="class-overall col-o${overallLow ? ' low' : ''}">${pctText(c.overallGrade)}</span>` : '')
      : '';
    // The bar is this week's work in the class: graded or turned in, out of
    // everything due Monday to Sunday (the same count as this week's ring).
    // A low grade shows as the red pill on the grade itself.
    const wk = classWeek(c, marks, now);
    // One segment per assignment due this week, filled left to right as
    // work is done; nothing due is one solid green bar, with no count.
    const weekLabel = wk.total ? `${wk.done} of ${wk.total}` : '';
    const ariaWeek = wk.total ? `${wk.done} of ${wk.total} done this week` : 'nothing due this week';
    const segs = wk.total
      ? Array.from({ length: wk.total }, (_, i) => `<i class="seg${i < wk.done ? ' on' : ''}"></i>`).join('')
      : '<i class="seg on"></i>';
    const cid = String(c.id ?? c.name);
    const missingN = summary ? summary.missingItems.filter((m) => String(m.courseId ?? m.courseName) === cid).length : 0;
    const missingTag = missingN
      ? `<span class="class-missing" role="img" aria-label="${missingN} missing" title="${missingN} missing">${MISSING_IMG}${missingN}</span>`
      : '';
    const bar = `<div class="week-row"><div class="seg-bar" role="img" aria-label="${escapeHtml(`${c.name}: ${ariaWeek}`)}">${segs}</div>` +
      `${missingTag}${weekLabel ? `<span class="week-label">${escapeHtml(weekLabel)}</span>` : ''}</div>`;
    const name = toggle(`<span class="chev${open ? ' open' : ''}">${CHEVRON}</span><span class="class-name">${escapeHtml(c.name)}</span>`, 'class-toggle');

    let chart = '';
    if (open && showGrades) {
      const svg = renderGradeChart(history, { threshold: t, name: c.name });
      if (svg) drawnCharts.set(key, { history, gradeDisplay: settings.gradeDisplay });
      const link = c.url ? `<a class="chart-link" href="${escapeHtml(c.url)}">Open ${escapeHtml(c.name)} in Schoology</a>` : '';
      chart = `<div class="chart-box" data-key="${escapeHtml(key)}">` +
        (svg || '<p class="empty">No graded assignments with dates yet.</p>') +
        (svg ? `<div class="chart-legend"><span><i class="lg-dot ok"></i>${t}% or above</span><span><i class="lg-dot low"></i>below ${t}%</span><span><i class="lg-size"><i></i><i></i></i>bigger dot, more points</span><span><i class="lg-line"></i>class grade</span><span><i class="lg-pass"></i>${t}%</span></div>` : '') +
        classBestHtml(c, settings) +
        link + '</div>';
    }
    // The whole row (name, trend line, grades and bar) opens the class; the
    // class name stays the keyboard and screen-reader control.
    const row = `<div class="class-head"><span class="grow">${name}</span>${grades}</div>${bar}`;
    // The opened list: this week's work, plus Missing work from any week.
    const earlierMissing = summary
      ? summary.missingItems.filter((m) => String(m.courseId ?? m.courseName) === cid && !wk.items.some((i) => i.a === m || (i.a.id != null && String(i.a.id) === String(m.id))))
        .map((a) => ({ a, state: 'missing' }))
      : [];
    const week = open ? weekListHtml(wk, earlierMissing, uid, settings, showGrades, now) : '';
    return `<div class="class${open ? ' open' : ''}">` +
      `<div class="class-row" data-act="toggle-chart" data-key="${escapeHtml(key)}">${row}</div>` +
      `${week}${chart}</div>`;
  });
  const dates = showGrades ? quarterDatesLine(list) : '';
  return `<section class="sec">${head}${rows.join('')}${dates ? `<p class="legend">${escapeHtml(dates)}</p>` : ''}</section>`;
}

// A list of graded work under a heading with its count ("Not so good · 2").
function renderGradedList(title, items, settings, showGrades, emoji) {
  if (!items.length) return '';
  const rows = items.map((a) => {
    const g = showGrades ? gradeText(a, settings) : '';
    const pct = assignmentPercent(a);
    const low = pct !== null && pct < settings.gradeThreshold;
    return `<div class="row"><div class="grow">${titleLink(a, 'row-title')}<div class="sub">${[a.courseName, ptsText(a)].filter(Boolean).map(escapeHtml).join(' · ')}</div></div>` +
      (g ? `<span class="row-grade${low ? ' low' : ''}">${escapeHtml(g)}</span>` : '') + '</div>';
  });
  return section(`${title} · ${items.length}`, rows.join(''), emoji);
}

// The class's highest score so far, under its grade chart:
// "⭐ Highest score · Unit 1 Test · Sep 22        100%".
function classBestHtml(course, settings) {
  const best = classHighScore(course);
  if (!best) return '';
  const a = best.a;
  const when = a.due ? shortDay(a.due) : '';
  return `<div class="class-best"><span class="class-best-icon" aria-hidden="true">⭐</span>` +
    `<div class="grow compact-line"><span class="class-best-label">Highest score</span> · ${titleLink(a, 'row-title')}${when ? ` <span class="compact-course">(${escapeHtml(when)})</span>` : ''}</div>` +
    `<span class="row-grade">${escapeHtml(gradeText(a, settings))}</span></div>`;
}

// Doing well: compact one-line rows, most recent first, at most 7:
// "Short Story Draft (American Literature)        84%".
const DOING_WELL_MAX = 7;
function renderDoingWell(items, settings, showGrades) {
  if (!items.length) return '';
  const when = (a) => {
    const t = Date.parse(a.due || '');
    return Number.isNaN(t) ? 0 : t;
  };
  const recent = [...items].sort((a, b) => when(b) - when(a)).slice(0, DOING_WELL_MAX);
  const rows = recent.map((a) => {
    const g = showGrades ? gradeText(a, settings) : '';
    const meta = [a.courseName, ptsText(a)].filter(Boolean).map(escapeHtml).join(' · ');
    const course = meta ? ` <span class="compact-course">(${meta})</span>` : '';
    const rocket = isBonus(a) ? '<span class="bonus" title="Extra credit" aria-label="Extra credit">🚀</span>' : '';
    return `<div class="row compact"><div class="grow compact-line">${titleLink(a, 'row-title')}${course}</div>` +
      rocket + (g ? `<span class="row-grade">${escapeHtml(g)}</span>` : '') + '</div>';
  });
  return section('Doing well', rows.join(''), SECTION_EMOJI.doingWell);
}

// The section title says "Submitted, not graded yet", so Schoology-reported
// submissions need no note; the family's own marks say which they are.
const WAITING_HOW = {
  turnedIn: 'Marked turned in',
  done: 'Marked done',
};

// Submitted, not graded yet: grouped by class (a heading with the class's
// count), one thin row per item. Classes with nothing waiting don't show.
// Within a class: Schoology-reported submissions first, then the family's
// own marks, each by due date.
function renderWaiting(summary, uid, courses = [], now = Date.now()) {
  // This week's work is listed under its class (Classes); this section keeps
  // the rest: earlier weeks' work still waiting for a grade (and anything
  // marked ahead of time), so it usually doesn't show.
  const waiting = summary.waiting.filter((a) => !dueThisWeek(a, now));
  const n = waiting.length;
  if (!n) return '';
  const order = { submitted: 0, turnedIn: 1, done: 2 };
  const due = (a) => {
    const t = Date.parse(a.due || '');
    return Number.isNaN(t) ? Infinity : t;
  };
  const groups = new Map(); // class name -> items
  for (const a of waiting) {
    const name = a.courseName || 'Other';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(a);
  }
  // Classes in the order the Classes section lists them.
  const rank = new Map(courses.map((c, i) => [c.name, i]));
  const names = [...groups.keys()].sort((x, y) => (rank.has(x) ? rank.get(x) : 1e9) - (rank.has(y) ? rank.get(y) : 1e9) || x.localeCompare(y));
  const blocks = names.map((name) => {
    const items = groups.get(name).sort((x, y) => order[x.waitingReason] - order[y.waitingReason] || due(x) - due(y));
    const rows = items.map((a) => {
      const meta = [dueLabel(a), ptsText(a), WAITING_HOW[a.waitingReason] || ''].filter(Boolean).map(escapeHtml).join(' · ');
      // Still marked Missing on Schoology (submitted or turned in, not yet graded).
      const missingTag = a.status === 'missing' ? `<span class="missing-tag">${MISSING_IMG}Missing</span>` : '';
      const undo = a.waitingReason === 'submitted'
        ? ''
        : `<button class="link-btn" type="button" data-act="undo" data-reason="${a.waitingReason}" data-uid="${escapeHtml(uid)}" data-aid="${escapeHtml(a.id ?? '')}" aria-label="Undo: ${escapeHtml(a.title)}">Undo</button>`;
      return `<div class="waiting"><div class="grow compact-line">${titleLink(a, 'waiting-title')}${meta ? ` <span class="compact-course">(${meta})</span>` : ''}</div>${missingTag}${undo}</div>`;
    });
    return `<div class="wait-class"><h3 class="wait-h">${escapeHtml(name)} · ${items.length}</h3>${rows.join('')}</div>`;
  });
  const manual = waiting.some((a) => a.waitingReason === 'turnedIn' || a.waitingReason === 'done');
  const disclaimer = manual ? '<p class="fineprint">Marking something done or turned in is for your own use — nobody is notified.</p>' : '';
  return section(`Submitted, not graded yet · ${n}`, blocks.join('') + disclaimer, SECTION_EMOJI.waiting);
}

// This week's ring: graded (dark blue), then turned in and waiting for a
// grade (light blue), out of everything due Monday to Sunday. No legend:
// on desktop, hovering a part of the ring says what it is ("3 graded",
// "2 turned in", "1 remaining"), via invisible, wider hit arcs on top.
function weekRing(w) {
  if (!w.total) return '';
  const R = 42;
  const C = 2 * Math.PI * R;
  const g = (w.graded / w.total) * C;
  const sub = (w.submitted / w.total) * C;
  const gap = w.graded && w.submitted ? 3 : 0; // a hairline between the two
  const n = w.graded + w.submitted;
  const left = Math.max(0, w.total - n);
  const label = `${n} of ${w.total} assignments this week: ${w.graded} graded, ${w.submitted} turned in, ${left} remaining`;
  const rot = 'transform="rotate(-90 50 50)"';
  const arc = (len, color, offset) => (len > 0
    ? `<circle cx="50" cy="50" r="${R}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${Math.max(0.01, len - gap).toFixed(1)} ${C.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}" ${rot}/>`
    : '');
  const hit = (start, len, tip) => (len > 0
    ? `<circle class="ring-hit" data-tip="${escapeHtml(tip)}" cx="50" cy="50" r="${R}" fill="none" stroke="transparent" stroke-width="16" stroke-dasharray="${len.toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-start).toFixed(2)}" ${rot}/>`
    : '');
  return `<div class="week" role="img" aria-label="${escapeHtml(label)}"><div class="ring">` +
    `<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="${R}" fill="none" stroke="#ffffff" stroke-opacity="0.85" stroke-width="10"/>` +
    arc(sub, '#93b4f5', -(g + gap / 2)) + arc(g, '#1d4ed8', 0) +
    hit(0, g, `${w.graded} graded`) + hit(g, sub, `${w.submitted} turned in`) + hit(g + sub, C - g - sub, `${left} remaining`) + '</svg>' +
    `<div class="ring-text" aria-hidden="true"><div class="ring-n${String(n).length + String(w.total).length >= 4 ? ' long' : ''}">${n} of ${w.total}</div><div class="ring-l">assignments this week</div></div>` +
    '<div class="ring-tip" aria-hidden="true" hidden></div></div></div>';
}

function shortDay(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Records: personal bests this school year, saved so they only go up.
function renderRecords(records, showGrades, now) {
  if (!records) return '';
  const rows = [];
  const add = (icon, title, detail, value, rec) => rows.push(
    `<div class="record"><span class="record-icon" aria-hidden="true">${icon}</span>` +
    `<div class="grow"><div class="record-title">${escapeHtml(title)}${isNewRecord(rec, now) ? '<span class="new-tag">NEW</span>' : ''}</div>` +
    `<div class="sub record-detail">${escapeHtml(detail)}</div></div><span class="record-value">${escapeHtml(value)}</span></div>`);
  // Highest score is shown per class, under each class's grade chart.
  const { bestWeek: bw, cleanRun: cr, classGrade: cg, extraCredit: ec } = records;
  if (bw) add('🗓️', 'Best week', `Everything turned in · week of ${shortDay(bw.info.start)}`, `${bw.value} of ${bw.value}`, bw);
  if (cr) {
    const weeks = Math.floor(cr.value / 7);
    const value = cr.value >= 14 ? `${weeks} weeks` : `${cr.value} days`;
    const detail = cr.info.ongoing ? `Since ${shortDay(cr.info.start)} · still going` : `${shortDay(cr.info.start)} to ${shortDay(cr.info.end)}`;
    add('🔥', 'Longest run with nothing missing', detail, value, cr);
  }
  if (ec && showGrades) {
    const i = ec.info || {};
    const detail = `${i.classes} ${i.classes === 1 ? 'class' : 'classes'} · ${i.items} ${i.items === 1 ? 'assignment' : 'assignments'}`;
    add('🚀', 'Extra credit this year', detail, `+${ec.value} ${ec.value === 1 ? 'pt' : 'pts'}`, ec);
  }
  if (cg && showGrades) add('📈', 'Highest class grade', [cg.info.course, cg.info.period].filter(Boolean).join(' · '), pctText(cg.value), cg);
  if (!rows.length) return '';
  return section('Records', rows.join(''), SECTION_EMOJI.records);
}

export const FEEDBACK_EMAIL = 'schoologydashboard@gmail.com';
// The promo site (footer "About" link).
export const ABOUT_URL = 'https://megahirt.github.io/schoology-grades-extension/';

// "Send feedback": the family's own mail app, with the version and browser
// in the subject. Never any grades or names.
export function feedbackHref(browser) {
  let version = '';
  try { version = browser.runtime.getManifest().version || ''; } catch { version = ''; }
  const ua = (globalThis.navigator && navigator.userAgent) || '';
  const name = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'browser';
  const subject = `Grades Dashboard feedback (${['v' + version, name].filter((x) => x && x !== 'v').join(', ')})`;
  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}`;
}

function verdictPill(verdict) {
  const cls = verdict === 'GO' ? 'go' : verdict === 'NO-GO' ? 'nogo' : 'unknown';
  return `<span class="pill ${cls}">${verdict}</span>`;
}

// A red NO-GO disc that takes the place of a child's picture (any size).
export function noGoCircle(cls = 'avatar nogo-circle') {
  return `<svg class="${cls}" viewBox="0 0 40 40" role="img" aria-label="NO-GO">` +
    '<circle cx="20" cy="20" r="20" fill="#b42318"/>' +
    '<circle cx="20" cy="20" r="17.5" fill="none" stroke="#ffffff" stroke-opacity="0.35" stroke-width="1.2"/>' +
    '<text x="20" y="18.2" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="11" font-weight="800" fill="#ffffff" letter-spacing="0.4">NO</text>' +
    '<text x="20" y="29" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="11" font-weight="800" fill="#ffffff" letter-spacing="0.4">GO</text>' +
    '</svg>';
}

function avatarHtml(d) {
  return d.pictureUrl
    ? `<img class="avatar" src="${escapeHtml(d.pictureUrl)}" alt="" data-initials="${escapeHtml(initials(d.studentName))}">`
    : `<span class="avatar" aria-hidden="true">${escapeHtml(initials(d.studentName))}</span>`;
}

// One child's (or the student's own) dashboard body.
export function renderStudentBody(d, uid, settings, marks, { isParentView, openClass = null, records = null, now = Date.now() }) {
  // Tidy class names ("07 English" -> "English") for everything below.
  const courses = cleanCourseNames(d.courses || []);
  const summary = summarizeStudent(courses, settings, marks.turnedIn, marks.done);
  const showGrades = settings.gradeVisibility === 'both'
    || (settings.gradeVisibility === 'parent' && isParentView)
    || (settings.gradeVisibility === 'student' && !isParentView);
  const failed = Boolean(d.error);
  const partial = !failed && isPartial(d);
  let html = '';

  if (failed) {
    html += `<div class="card unknown"><div class="card-head">${avatarHtml(d)}<div class="grow"><div class="card-name">${escapeHtml(d.studentName || 'Student')}</div>` +
      `<div class="card-reason">Could not read these grades just now. Press Refresh to try again.</div></div>${isParentView ? verdictPill('UNKNOWN') : ''}</div></div>`;
  } else {
    // The same card for parents and students: picture, name, the Missing and
    // Due soon chips and this week's ring. Only the GO/NO-GO verdict is for
    // parents (when the badge is on).
    const verdictsOn = isParentView && settings.showGoNoGo;
    const verdict = partial ? 'UNKNOWN' : summary.verdict.verdict;
    const good = verdict === 'GO';
    // Only a NO-GO earns a badge (GO is the quiet default). UNKNOWN keeps its
    // badge too, since its line underneath explains why there's no verdict.
    // NO-GO replaces the child's picture with the NO-GO circle (no separate
    // badge). UNKNOWN keeps a badge, explained by the line under the name.
    const showNoGo = verdictsOn && verdict === 'NO-GO';
    const pill = verdictsOn && verdict === 'UNKNOWN' ? verdictPill(verdict) : '';
    // Compact metrics, only when non-zero: Missing and Due soon. (Classes
    // below the passing grade show in the Classes section, in red.)
    const stats = [];
    if (summary.missingCount > 0) {
      stats.push({ value: String(summary.missingCount), icon: MISSING_IMG, label: 'Missing', bad: summary.missingCount >= settings.missingThreshold });
    }
    const dueCount = summary.dueToday.length + summary.dueTomorrow.length;
    if (dueCount > 0) stats.push({ value: String(dueCount), icon: '<span class="stat-hg">⌛</span>', label: 'Due soon', bad: false });
    const cardTone = !verdictsOn ? 'plain' : partial ? 'unknown' : good ? 'go' : 'nogo';
    // Just the picture, name and (when on) the GO/NO-GO badge. The only
    // line under the name is for an UNKNOWN verdict, which needs a reason.
    const reason = partial ? `<div class="card-reason">Only part of the grades loaded${verdictsOn ? ', so no verdict yet' : ''}. Press Refresh.</div>` : '';
    const ring = partial ? '' : weekRing(weekProgress(courses, marks, now));
    html += `<div class="card ${cardTone}${ring ? ' with-ring' : ''}"><div class="card-main">` +
      `<div class="card-head">${showNoGo ? noGoCircle() : avatarHtml(d)}<div class="grow"><div class="card-name">${escapeHtml(d.studentName || 'Student')}</div>` +
      `${reason}</div>${pill}</div>` +
      (stats.length
        ? `<div class="stats">${stats.map((st) => `<div class="stat"><span class="stat-v${st.bad ? ' low' : ''}">${escapeHtml(st.value)}</span>` +
          (st.icon ? `<span class="stat-icon" aria-hidden="true">${st.icon}</span>` : '') +
          `<span class="stat-l">${escapeHtml(st.label)}</span></div>`).join('')}</div>`
        : '') + `</div>${ring}</div>`;
  }

  if (Array.isArray(d.parseWarnings) && d.parseWarnings.length) {
    html += `<p class="warn">${d.parseWarnings.map(escapeHtml).join('<br>')}</p>`;
  }
  if (!failed) {
    html += renderMissing(summary, uid, isParentView);
    html += renderDue(summary, uid);
    html += renderClasses(courses, settings, showGrades, uid, openClass, { marks, summary, now });
    html += renderGradedList('Not so good', summary.notSoGood, settings, showGrades, SECTION_EMOJI.notSoGood);
    html += renderDoingWell(summary.doingWell, settings, showGrades);
    html += renderRecords(records, showGrades, now);
    html += renderWaiting(summary, uid, visibleCourses(courses), now);
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
      for (const p of c.periods || []) {
        if (p.start) p.start = new Date(new Date(p.start).getTime() + shiftMs).toISOString();
        if (p.end) p.end = new Date(new Date(p.end).getTime() + shiftMs).toISOString();
      }
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
  const dashboards = (await getDashboards()) || {};
  const account = await storageGet('account', null);
  // Links and refreshes go to the site this page shows.
  const settings = { schoologyBase: REAL_SCHOOLOGY, ...effectiveSettings(await getSettings(), { isStudent: isStudentAccount(account, dashboards) }) };
  if (getSite()) settings.schoologyBase = getSite();
  return {
    settings,
    dashboards,
    turnedIn: (await getTurnedIn()) || {},
    done: (await getMarkedDone()) || {},
    refreshState: (await storageGet('refreshState', null)) || null,
    // The child last picked in any popup or panel (storage key dashboardChild).
    lastChild: (await storageGet('dashboardChild', null)) || null,
    records: (await storageGet('records', null)) || {},
    // Who is signed in on this site (signedOut: the data shown is old).
    user: (await getUser()) || null,
  };
}

// Signed out of Schoology: the dashboard keeps showing the last data, under
// a banner saying it is old and linking to Schoology's sign-in.
export function signedOutHtml(latest, base) {
  const when = latest ? new Date(latest) : null;
  const from = when && !Number.isNaN(when.getTime())
    ? ` (from ${when.toDateString() === new Date().toDateString() ? 'today' : shortDate(latest)}, ${when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })})`
    : '';
  return '<div class="signed-out" role="alert">' +
    `<b>Please <a href="${escapeHtml(`${base}/`)}">log in to Schoology</a> to see the latest.</b> ` +
    `This is old data${escapeHtml(from)}.</div>`;
}

// The popup's switch between Schoology sites with data: "Parent" for a
// parent account, the student's first name for a student account (the
// site's address as the tooltip). Empty with one site.
async function siteSwitchHtml() {
  const sites = (await getSites()) || [];
  if (sites.length < 2) return '';
  const here = getSite();
  const buttons = [];
  for (const site of sites) {
    const account = await storageGet('account', null, site);
    const dashboards = (await storageGet('dashboards', {}, site)) || {};
    const first = Object.values(dashboards)[0];
    const host = (() => { try { return new URL(site).host; } catch { return site; } })();
    const label = account && account.type === 'parent' ? 'Parent' : first ? firstName(first.studentName) : host;
    const sel = site === here;
    buttons.push(`<button class="site${sel ? ' sel' : ''}" type="button" data-act="site" data-site="${escapeHtml(site)}" aria-pressed="${sel}" title="${escapeHtml(host)}">${escapeHtml(label)}</button>`);
  }
  return `<div class="sites" role="group" aria-label="Schoology account">${buttons.join('')}</div>`;
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
// siteSwitch (the toolbar popup): when more than one Schoology site has data
// (a parent on app.schoology.com and a student on the school's address),
// show a switch between them above the dashboard.
export function mountDashboard(container, { browser, showDemo = true, openOptions, onClose, openLinksInActiveTab = false, siteSwitch = false } = {}) {
  const root = container.ownerDocument.createElement('div');
  root.className = 'sgd';
  container.replaceChildren(root);
  let pickedUid = null;
  let openClass = null; // "<uid>:<courseId>" whose grade chart is open
  let statusText = '';
  let viewIsParent = false;

  // Message the teacher about a Missing item (parents only): Schoology's
  // compose form for the class, with the subject and message filled in by
  // the content script (see teacher-email.js). The parent reads it and
  // presses Send. A class with several admins first asks which teacher;
  // the pick is remembered per class (storage key `classTeacher`) and
  // preselected next time.
  let chooser = null; // { uid, courseId, aid, result, course, a, d, picked }

  async function emailTeacher(uid, courseId, aid) {
    chooser = null;
    drawChooser();
    setStatus('Opening a message to the teacher…');
    const { dashboards } = await loadState();
    const d = dashboards[uid];
    const course = d && (d.courses || []).find((c) => String(c.id) === String(courseId));
    const a = course && (course.assignments || []).find((x) => String(x.id) === String(aid));
    if (!a) { setStatus('Couldn’t find that assignment. Press Refresh and try again.'); return; }
    let result;
    try {
      result = await browser.runtime.sendMessage({ type: 'teacher-compose-url', uid, courseId, site: getSite() });
    } catch (err) {
      result = { ok: false, error: err.message || String(err) };
    }
    if (!result || !result.ok) { setStatus(`Couldn’t open a message: ${(result && result.error) || 'unknown error'}`); return; }
    const admins = result.admins || [];
    if (admins.length <= 1) {
      await openCompose({ uid, courseId, result, course, a, d }, admins[0] ? admins[0].uid : null);
      return;
    }
    const saved = ((await storageGet('classTeacher', null)) || {})[String(courseId)];
    const picked = admins.some((t) => t.uid === saved) ? saved : result.likely || null;
    chooser = { uid, courseId, aid, result, course, a, d, picked, saved: picked === saved ? saved : null };
    setStatus('');
    drawChooser();
    const first = root.querySelector('.teacher-chooser input:checked') || root.querySelector('.teacher-chooser input');
    if (first) first.focus();
  }

  async function openCompose({ courseId, result, course, a, d }, teacherUid) {
    const [tidy] = cleanCourseNames([course]);
    const msg = composeMessage({ studentName: d.studentName, parentName: result.parentName || '', title: a.title, courseName: tidy.name, dueText: a.due ? shortDate(a.due) : a.dueText || '' });
    const url = (teacherUid ? composeUrlFor(result.url, teacherUid) : result.url) + composeHash(msg);
    if (teacherUid && (result.admins || []).length > 1) {
      const all = (await storageGet('classTeacher', null)) || {};
      all[String(courseId)] = teacherUid;
      await storageSet('classTeacher', all).catch(() => {});
    }
    chooser = null;
    setStatus('');
    if (openLinksInActiveTab) {
      await browser.tabs.update({ url });
      container.ownerDocument.defaultView.close();
    } else {
      container.ownerDocument.defaultView.location.assign(url);
    }
  }

  // The "Email which teacher?" box, under its Missing item. Drawn after
  // every render so a refresh doesn't drop it.
  function drawChooser() {
    for (const el of root.querySelectorAll('.teacher-chooser')) el.remove();
    if (!chooser) return;
    const card = [...root.querySelectorAll('.missing-card')].find((el) => el.dataset.aid === String(chooser.aid));
    if (!card) return;
    const [tidy] = cleanCourseNames([chooser.course]);
    const admins = chooser.result.admins || [];
    const opts = admins.map((t, i) => {
      const tag = t.uid === chooser.saved ? 'Last emailed' : t.uid === chooser.result.likely ? 'Likely teacher' : '';
      return `<label class="tc-opt"><input type="radio" name="sgd-teacher" value="${escapeHtml(t.uid)}"${t.uid === chooser.picked ? ' checked' : ''}>` +
        `<span class="tc-name">${escapeHtml(t.name || `Class admin ${i + 1}`)}</span>${tag ? `<span class="tc-tag">${tag}</span>` : ''}</label>`;
    }).join('');
    const box = root.ownerDocument.createElement('div');
    box.className = 'teacher-chooser';
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Email which teacher?');
    box.innerHTML = `<div class="tc-title">Email which teacher?</div>` +
      `<div class="tc-sub">Schoology lists ${admins.length} people for ${escapeHtml(tidy.name || 'this class')}.</div>` +
      `<div class="tc-opts">${opts}</div>` +
      `<div class="tc-actions"><button class="btn" type="button" data-act="tc-cancel">Cancel</button>` +
      `<button class="btn primary" type="button" data-act="tc-go"${chooser.picked ? '' : ' disabled'}>Write email</button></div>`;
    box.addEventListener('change', (e) => {
      if (!chooser || !e.target.matches('input[name="sgd-teacher"]')) return;
      chooser.picked = e.target.value;
      const go = box.querySelector('[data-act="tc-go"]');
      if (go) go.disabled = false;
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { chooser = null; drawChooser(); }
    });
    card.after(box);
  }

  async function render() {
    const { settings, dashboards, turnedIn, done, refreshState, lastChild, records, user } = await loadState();
    const running = refreshRunning(refreshState);
    // Signed out: Schoology said so (user.signedOut), or the last refresh
    // failed because nobody is signed in. Either way the data shown is old,
    // so the dashboard asks to log in instead of saying "Press Refresh".
    const signedOut = Boolean(user && user.signedOut)
      || Boolean(refreshState && !running && refreshState.ok === false && isSignedOutError(refreshState.error));
    const uids = Object.keys(dashboards);
    const isParentView = uids.length > 1 || (uids.length === 1 && uids[0] !== 'self');
    viewIsParent = isParentView;
    // Stay on the child picked last (also after a page load or in another
    // popup/panel); fall back to the first child.
    if (lastChild && uids.includes(lastChild)) pickedUid = lastChild;
    if (!uids.includes(pickedUid)) pickedUid = uids[0] || null;
    const current = pickedUid ? dashboards[pickedUid] : null;
    lastDashboards = dashboards;

    let latest = null;
    for (const d of Object.values(dashboards)) {
      if (d.updatedAt && (!latest || d.updatedAt > latest)) latest = d.updatedAt;
    }
    const stale = latest && Date.now() - new Date(latest).getTime() > STALE_MS;
    const heading = isParentView || !current
      ? '<h1 class="title">Grades Dashboard</h1>'
      : `<h1 class="title">Hi, ${escapeHtml(firstName(current.studentName))}</h1>`;

    let header = `<header class="head">${siteSwitch ? await siteSwitchHtml() : ''}<div class="head-row"><div class="grow">${heading}` +
      `<div class="muted">${latest ? escapeHtml(updatedLabel(latest)) : 'Not updated yet'}</div></div>` +
      (running
        ? `<button class="icon-btn busy" type="button" data-act="refresh" disabled aria-label="Refreshing grades" title="Refreshing grades">${ICON.spinner}</button>`
        : `<button class="icon-btn" type="button" data-act="refresh" aria-label="Refresh grades" title="Refresh grades">${ICON.refresh}</button>`) +
      (current ? `<button class="icon-btn" type="button" data-act="share" aria-label="${SHARE_LABEL}" title="${SHARE_LABEL}">${shareIcon()}</button>` : '') +
      `<button class="icon-btn" type="button" data-act="options" aria-label="Settings" title="Settings">${ICON.cog}</button>` +
      (onClose ? `<button class="icon-btn ghost" type="button" data-act="close" aria-label="Close dashboard panel" title="Close">${ICON.close}</button>` : '') +
      '</div>';

    if (isParentView && uids.length > 1) {
      const tabs = uids.map((uid) => {
        const d = dashboards[uid];
        const s = summarizeStudent(d.courses || [], settings, turnedIn[uid], done[uid]);
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
      body = `<p class="empty">No Schoology data yet. Sign in to Schoology in this browser (your school\'s Schoology page, if it has its own address) and press Refresh${showDemo ? ', or load the demo data to see how the dashboard looks' : ''}.</p>`;
    } else {
      const marks = { turnedIn: turnedIn[pickedUid], done: done[pickedUid] };
      drawnCharts.clear();
      body = renderStudentBody(current, pickedUid, settings, marks, { isParentView, openClass, records: records[pickedUid] }).html;
    }
    if (signedOut && current) body = signedOutHtml(latest, settings.schoologyBase) + body;
    else if (stale && !running) body = '<p class="stale">These grades are more than a day old. Press Refresh.</p>' + body;
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
    if (failedRecently && !statusText && !(signedOut && current)) statusText = friendlyRefreshError(refreshState.error);
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
        `<b>${usingMock ? 'Mock server (localhost:8123)' : escapeHtml((() => { try { return new URL(settings.schoologyBase).host; } catch { return 'Real Schoology'; } })())}</b>` +
        (buildStamp ? `<span class="dev-build"> · built ${escapeHtml(buildStamp)} UTC</span>` : '') + '</span>' +
        `<button class="btn btn-sm" type="button" data-act="switch-source">${usingMock ? 'Use real Schoology' : 'Use mock server'}</button></div>`
      : '';
    const footer = '<footer class="foot">' + devSwitch +
      `<div class="status" role="status">${escapeHtml(statusText)}</div>` +
      (showDemo ? '<div class="foot-row"><button class="btn btn-sm" type="button" data-act="demo">Load demo data</button></div>' : '') +
      '</footer>' +
      `<div class="credit"><span>Made with <span role="img" aria-label="love">❤️</span> for</span><img class="credit-logo" src="${npcLogo}" alt="NPC" width="20" height="20"><span>by Chris Hirt</span>` +
      `<span aria-hidden="true">·</span><a class="feedback-link" href="${escapeHtml(feedbackHref(browser))}">Send feedback</a>` +
      `<span class="credit-end"><a class="about-link" href="${ABOUT_URL}" target="_blank" rel="noopener">About</a></span></div>`;

    // Re-rendering replaces the whole view; keep where the reader was
    // scrolled (the panel scrolls .body, the popup scrolls the page), so
    // opening a class's chart or marking an item never jumps to the top.
    const win = container.ownerDocument.defaultView;
    const prevBody = root.querySelector('.body');
    const bodyTop = prevBody ? prevBody.scrollTop : 0;
    const pageTop = win ? win.scrollY : 0;
    root.innerHTML = header + `<main class="body">${body}</main>` + footer;
    const nextBody = root.querySelector('.body');
    if (nextBody && bodyTop) nextBody.scrollTop = bodyTop;
    if (win && pageTop && win.scrollY !== pageTop) win.scrollTo(win.scrollX, pageTop);
    // A profile picture that fails to load falls back to the initials.
    drawChooser();
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

  // Share: copy a picture of the whole dashboard to the clipboard, then
  // open the system share menu with it where the browser has one. The
  // clipboard gets the picture while it's still being drawn, so the click
  // still counts as the user's own. If the share menu then needs a fresh
  // click (Safari allows only a moment), the finished picture waits for a
  // second press, which shares it at once.
  let lastDashboards = null;
  let readyToShare = null; // { blob, fileName, title, until, uid }

  function shareNames() {
    const d = pickedUid && lastDashboards ? lastDashboards[pickedUid] : null;
    const first = d && d.studentName ? String(d.studentName).trim().split(/\s+/)[0] : '';
    const day = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const date = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
    const slug = first.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return {
      fileName: `grades-dashboard${slug ? `-${slug}` : ''}-${date}.png`,
      title: first ? `Grades Dashboard: ${first}` : 'Grades Dashboard',
    };
  }

  // The check mark and "Copied" for a moment, with a status line.
  function showShared(btn, text) {
    btn.innerHTML = ICON.check;
    btn.classList.add('done');
    btn.setAttribute('aria-label', 'Copied');
    btn.title = 'Copied';
    setStatus(text);
    clearTimeout(showShared.timer);
    showShared.timer = setTimeout(() => {
      if (btn.isConnected) resetShareBtn(btn);
      if (statusText === text) setStatus('');
    }, 2500);
  }

  function resetShareBtn(btn) {
    btn.innerHTML = shareIcon();
    btn.classList.remove('done');
    btn.setAttribute('aria-label', SHARE_LABEL);
    btn.title = SHARE_LABEL;
  }

  async function share(btn, blob, names, copied) {
    const win = container.ownerDocument.defaultView;
    let result;
    try {
      result = await shareImage(blob, win, names);
    } catch {
      result = 'failed';
    }
    if (result === 'needs-click') {
      readyToShare = { blob, ...names, uid: pickedUid, until: Date.now() + 60000 };
      clearTimeout(showShared.timer);
      if (btn.isConnected) resetShareBtn(btn);
      setStatus(copied ? 'Picture copied. Press Share again to send it.' : 'Picture ready. Press Share again to send it.');
    } else if (result === 'shared') {
      showShared(btn, copied ? 'Picture copied and shared.' : 'Picture shared.');
    } else if (copied && result !== 'cancelled') {
      showShared(btn, 'Picture copied. Paste it into a message or note.');
    } else if (!copied && result !== 'cancelled') {
      setStatus('Couldn’t copy or share the picture in this browser.');
    }
  }

  async function sharePicture(btn) {
    const win = container.ownerDocument.defaultView;
    // Second press after the share menu needed a fresh click.
    if (readyToShare && readyToShare.uid === pickedUid && Date.now() < readyToShare.until) {
      const { blob, fileName, title } = readyToShare;
      readyToShare = null;
      await share(btn, blob, { fileName, title }, true);
      return;
    }
    readyToShare = null;
    const names = shareNames();
    const blobPromise = captureDashboard(root, DASHBOARD_CSS);
    let copied = false;
    try {
      copied = await copyImage(blobPromise, win);
    } catch {
      copied = false;
    }
    if (copied) showShared(btn, 'Picture copied.');
    let blob;
    try {
      blob = await blobPromise;
    } catch (err) {
      setStatus(`Couldn’t make the picture: ${err.message || err}`);
      return;
    }
    await share(btn, blob, names, copied);
  }

  // The Share icon people know on this device.
  function shareIcon() {
    return isApplePlatform(container.ownerDocument.defaultView.navigator) ? ICON.shareApple : ICON.shareDots;
  }

  async function onClick(e) {
    const link = openLinksInActiveTab && e.target.closest('a[href]');
    if (link && root.contains(link) && !link.href.startsWith('mailto:')) {
      e.preventDefault();
      // Cmd/Ctrl/Shift-click or middle-click still opens a new tab, and so
      // do links meant for one (the footer's About).
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1 || link.target === '_blank') await browser.tabs.create({ url: link.href });
      else {
        await browser.tabs.update({ url: link.href });
        container.ownerDocument.defaultView.close();
      }
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn || !root.contains(btn)) return;
    const { act, uid, aid } = btn.dataset;
    if (act === 'share') {
      await sharePicture(btn);
      return;
    }
    if (act === 'email-teacher' && uid && aid) {
      await emailTeacher(uid, btn.dataset.cid, aid);
      return;
    }
    if (act === 'tc-cancel') {
      chooser = null;
      drawChooser();
      return;
    }
    if (act === 'tc-go' && chooser && chooser.picked) {
      await openCompose(chooser, chooser.picked);
      return;
    }
    if (act === 'toggle-chart') {
      // Opening a chart closes any other one. When that one is above, the
      // rows below would shift up: keep the clicked class's row where it
      // was on screen instead.
      const key = btn.dataset.key;
      const rowTop = () => {
        const row = [...root.querySelectorAll('.class-row, .class-toggle')].find((el) => el.dataset.key === key);
        return row ? row.getBoundingClientRect().top : null;
      };
      const before = rowTop();
      openClass = openClass === key ? null : key;
      await render();
      const after = rowTop();
      if (before !== null && after !== null && Math.abs(after - before) > 0.5) {
        const body = root.querySelector('.body');
        const win = container.ownerDocument.defaultView;
        if (body && body.scrollHeight > body.clientHeight) body.scrollTop += after - before;
        else if (win) win.scrollBy(0, after - before);
      }
      return;
    }
    if (act === 'site' && btn.dataset.site) {
      setSite(btn.dataset.site);
      pickedUid = null;
      const s = (await getSettings()) || {};
      await setSettings({ ...s, schoologyBase: btn.dataset.site }).catch(() => {});
      await render();
    } else if (act === 'pick') {
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
        const result = await browser.runtime.sendMessage({ type: 'refresh-now', site: getSite() });
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
      // Swap the data source and refresh. Each source keeps its own data
      // (per site), so this view just shows the other site.
      const settings = (await getSettings()) || {};
      const toMock = (getSite() || settings.schoologyBase) !== MOCK_SCHOOLOGY;
      const target = toMock ? MOCK_SCHOOLOGY : REAL_SCHOOLOGY;
      await setSettings({ ...settings, schoologyBase: target });
      setSite(target);
      setStatus(toMock ? 'Switched to the mock server. Refreshing…' : 'Switched to real Schoology. Refreshing…');
      try {
        const result = await browser.runtime.sendMessage({ type: 'refresh-now', site: getSite() });
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
  // Desktop hover on a grade chart: the nearest assignment's date, title and grade.
  // Desktop hover on this week's ring: what that part of the ring is.
  root.addEventListener('pointerover', (e) => {
    const part = e.target.closest && e.target.closest('.ring-hit');
    if (!part) return;
    const tip = part.closest('.ring').querySelector('.ring-tip');
    tip.textContent = part.dataset.tip;
    tip.hidden = false;
  });
  root.addEventListener('pointerout', (e) => {
    const part = e.target.closest && e.target.closest('.ring-hit');
    if (!part) return;
    const next = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.ring-hit');
    if (!next) part.closest('.ring').querySelector('.ring-tip').hidden = true;
  });
  root.addEventListener('pointermove', (e) => {
    const svg = e.target.closest && e.target.closest('svg.gchart');
    if (!svg || e.pointerType === 'touch') return;
    const box = svg.closest('.chart-box');
    const drawn = box && drawnCharts.get(box.dataset.key);
    if (drawn) chartHover(svg, drawn.history, e.clientX, drawn.gradeDisplay);
  });
  root.addEventListener('pointerout', (e) => {
    const svg = e.target.closest && e.target.closest('svg.gchart');
    if (svg && !svg.contains(e.relatedTarget)) chartUnhover(svg);
  });
  if (openLinksInActiveTab) root.addEventListener('auxclick', onClick); // middle-click

  // Only this site's data (and who is signed in there), plus the shared settings.
  const WATCHED = ['dashboards', 'settings', 'turnedIn', 'markedDone', 'refreshState', 'dashboardChild', 'records', 'sites'];
  function onStorageChanged(changes, area) {
    if (area === 'local' && changedFor(changes, WATCHED)) render();
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
