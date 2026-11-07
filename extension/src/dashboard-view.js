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

import { summarizeStudent, DEFAULT_SETTINGS, assignmentPercent, hasGradeData } from './rules.js';
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
} from './storage.js';
import css from './dashboard.css';

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

// The one-line reason under the child's name.
export function reasonLine(summary, settings) {
  const parts = [];
  parts.push(summary.missingCount ? `${summary.missingCount} missing` : 'Nothing missing');
  if (summary.lowClasses.length === 1) {
    parts.push(`${summary.lowClasses[0].name} below ${settings.gradeThreshold}%`);
  } else if (summary.lowClasses.length > 1) {
    parts.push(`${summary.lowClasses.length} classes below ${settings.gradeThreshold}%`);
  } else if (summary.lowestClassGrade !== null) {
    parts.push(`every class ${settings.gradeThreshold}% or above`);
  }
  return parts.join(' · ');
}

// The student view's "what to do first" line.
function studentNote(summary, settings) {
  const todo = [];
  if (summary.missingCount === 1) todo.push(`turn in ${summary.missingItems[0].title}`);
  else if (summary.missingCount > 1) todo.push(`turn in ${summary.missingCount} missing assignments`);
  for (const c of summary.lowClasses.slice(0, 2)) todo.push(`bring ${c.name} up past ${settings.gradeThreshold}%`);
  if (!todo.length) return null;
  const n = summary.missingCount + summary.lowClasses.length;
  const text = todo.join(' and ');
  return { title: `${plural(n, 'thing', 'things')} to finish first`, body: text.charAt(0).toUpperCase() + text.slice(1) + '.' };
}

function section(title, inner) {
  return `<section class="sec"><h2 class="sec-h">${escapeHtml(title)}</h2>${inner}</section>`;
}

function titleLink(a, cls = 'item-title') {
  return a.url
    ? `<a class="${cls}" href="${escapeHtml(a.url)}" target="_blank" rel="noopener">${escapeHtml(a.title)}</a>`
    : `<span class="${cls}">${escapeHtml(a.title)}</span>`;
}

function renderMissing(summary, uid) {
  if (!summary.missingItems.length) return section('Missing · 0', '<p class="empty">Nothing missing.</p>');
  const rows = summary.missingItems.map((a) => {
    const sub = [a.courseName, dueLabel(a)].filter(Boolean).map(escapeHtml).join(' · ');
    const note = a.submitted ? '<span class="note">Submitted, not graded yet</span>' : '';
    return `<div class="missing-card"><div class="grow">${titleLink(a)}<div class="sub">${sub}</div>${note}</div>` +
      `<button class="btn btn-sm" type="button" data-act="turned-in" data-uid="${escapeHtml(uid)}" data-aid="${escapeHtml(a.id ?? '')}">Turned in</button></div>`;
  });
  return section(`Missing · ${summary.missingItems.length}`, rows.join(''));
}

function renderDue(summary, uid) {
  const items = [
    ...summary.dueToday.map((a) => ({ a, when: 'Today', cls: 'today' })),
    ...summary.dueTomorrow.map((a) => ({ a, when: 'Tomorrow', cls: 'tomorrow' })),
  ];
  if (!items.length) return section('Due soon', '<p class="empty">Nothing due in the next two days.</p>');
  const rows = items.map(({ a, when, cls }) =>
    `<div class="row"><div class="grow">${titleLink(a, 'row-title')}<div class="sub">${escapeHtml(a.courseName || '')}</div></div>` +
    `<span class="chip ${cls}">${when}</span>` +
    `<button class="check-btn" type="button" data-act="done" data-uid="${escapeHtml(uid)}" data-aid="${escapeHtml(a.id ?? '')}" aria-label="Mark ${escapeHtml(a.title)} as done" title="Mark as done">${ICON.check}</button></div>`);
  return section('Due soon', rows.join(''));
}

// Classes: only real classes (with grade data), minus any the family
// unticked in the setup wizard (settings.realClasses[`${uid}:${id}`] false).
export function visibleCourses(courses, settings, uid) {
  const real = settings.realClasses || {};
  return (courses || []).filter((c) => hasGradeData(c) && real[`${uid}:${c.id || c.name}`] !== false);
}

function renderClasses(courses, settings, showGrades, uid) {
  const list = visibleCourses(courses, settings, uid);
  if (!list.length) return '';
  const t = settings.gradeThreshold;
  const rows = list.map((c) => {
    const pct = typeof c.grade === 'number' ? c.grade : null;
    const low = pct !== null && pct < t;
    const grade = showGrades && pct !== null ? `<span class="class-grade${low ? ' low' : ''}">${Math.round(pct * 10) / 10}%</span>` : '';
    const bar = showGrades && pct !== null
      ? `<div class="bar" aria-hidden="true"><div class="bar-fill${low ? ' low' : ''}" style="width:${Math.max(0, Math.min(100, pct))}%"></div><div class="bar-line" style="left:${t}%"></div></div>`
      : '';
    return `<div class="class"><div class="class-head"><span class="grow">${escapeHtml(c.name)}</span>${grade}</div>${bar}</div>`;
  });
  const legend = showGrades ? `<p class="legend">Line marks ${t}%, the passing grade.</p>` : '';
  return section('Classes', rows.join('') + legend);
}

function renderGradedList(title, items, settings, showGrades) {
  if (!items.length) return '';
  const rows = items.map((a) => {
    const g = showGrades ? gradeText(a, settings) : '';
    const pct = assignmentPercent(a);
    const low = pct !== null && pct < settings.gradeThreshold;
    return `<div class="row"><div class="grow">${titleLink(a, 'row-title')}<div class="sub">${escapeHtml(a.courseName || '')}</div></div>` +
      (g ? `<span class="row-grade${low ? ' low' : ''}">${escapeHtml(g)}</span>` : '') + '</div>';
  });
  return section(title, rows.join(''));
}

function renderWaiting(summary, uid) {
  const n = summary.waiting.length;
  if (!n) {
    return section('Waiting on teacher · 0', '<p class="empty">Nothing waiting. Items marked turned in or done show here until the teacher grades them.</p>');
  }
  const rows = summary.waiting.map((a) => {
    const how = a.waitingReason === 'done' ? 'Marked done' : 'Marked turned in';
    return `<div class="waiting"><span class="waiting-icon">${ICON.checkSmall}</span>` +
      `<div class="grow"><div class="waiting-title">${escapeHtml(a.title)}</div><div class="sub">${escapeHtml(a.courseName || '')} · ${how}</div></div>` +
      `<button class="link-btn" type="button" data-act="undo" data-reason="${a.waitingReason}" data-uid="${escapeHtml(uid)}" data-aid="${escapeHtml(a.id ?? '')}" aria-label="Undo: ${escapeHtml(a.title)}">Undo</button></div>`;
  });
  return section(`Waiting on teacher · ${n}`, rows.join(''));
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
  const summary = summarizeStudent(d.courses || [], settings, marks.turnedIn, marks.done);
  const showGrades = settings.gradeVisibility === 'both'
    || (settings.gradeVisibility === 'parent' && isParentView)
    || (settings.gradeVisibility === 'student' && !isParentView);
  const failed = Boolean(d.error);
  const partial = !failed && isPartial(d);
  let html = '';

  if (failed) {
    html += `<div class="card unknown"><div class="card-head">${avatarHtml(d)}<div class="grow"><div class="card-name">${escapeHtml(d.studentName || 'Student')}</div>` +
      `<div class="card-reason">Could not read these grades just now. Press Refresh to try again.</div></div>${verdictPill('UNKNOWN')}</div></div>`;
  } else if (isParentView || settings.showGoNoGo) {
    const verdict = partial ? 'UNKNOWN' : summary.verdict.verdict;
    const good = verdict === 'GO';
    const pill = settings.showGoNoGo ? verdictPill(verdict) : '';
    const lowest = summary.lowestClassGrade;
    const lowestBad = lowest !== null && lowest < settings.gradeThreshold;
    const stats = [
      { value: String(summary.missingCount), label: 'Missing', bad: summary.missingCount >= settings.missingThreshold },
      { value: lowest !== null && showGrades ? `${Math.round(lowest)}%` : '—', label: 'Lowest class', bad: lowestBad && showGrades },
      { value: String(summary.dueToday.length + summary.dueTomorrow.length), label: 'Due soon', bad: false },
    ];
    const cardTone = !settings.showGoNoGo ? 'plain' : partial ? 'unknown' : good ? 'go' : 'nogo';
    const reason = partial ? 'Only part of the grades loaded, so no verdict yet. Press Refresh.' : reasonLine(summary, settings);
    html += `<div class="card ${cardTone}">` +
      `<div class="card-head">${avatarHtml(d)}<div class="grow"><div class="card-name">${escapeHtml(d.studentName || 'Student')}</div>` +
      `<div class="card-reason">${escapeHtml(reason)}</div></div>${pill}</div>` +
      `<div class="stats">${stats.map((s) => `<div class="stat"><div class="stat-v${s.bad ? ' low' : ''}">${escapeHtml(s.value)}</div><div class="stat-l">${s.label}</div></div>`).join('')}</div></div>`;
  } else {
    const note = studentNote(summary, settings);
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
    html += renderGradedList('Not so good', summary.notSoGood, settings, showGrades);
    if (!isParentView) html += renderGradedList('Doing well', summary.doingWell.slice(0, 5), settings, showGrades);
    html += renderWaiting(summary, uid);
  }
  return { html, summary };
}

// Demo data with due dates shifted so "today"/"tomorrow" line up with the
// day the demo is loaded (demo anchor: 2026-11-06).
async function loadDemo(browser) {
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
// Returns { render, destroy }.
export function mountDashboard(container, { browser, showDemo = true, openOptions, onClose } = {}) {
  const root = container.ownerDocument.createElement('div');
  root.className = 'sgd';
  container.replaceChildren(root);
  let pickedUid = null;
  let statusText = '';

  async function render() {
    const { settings, dashboards, turnedIn, done, refreshState } = await loadState();
    const running = refreshRunning(refreshState);
    const uids = Object.keys(dashboards);
    const isParentView = uids.length > 1 || (uids.length === 1 && uids[0] !== 'self');
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
    const devSwitch = IS_DEV
      ? '<div class="dev-row"><span class="dev-tag">DEV</span><span class="grow">Data: ' +
        `<b>${usingMock ? 'Mock server (localhost:8123)' : 'Real Schoology'}</b></span>` +
        `<button class="btn btn-sm" type="button" data-act="switch-source">${usingMock ? 'Use real Schoology' : 'Use mock server'}</button></div>`
      : '';
    const footer = '<footer class="foot">' + devSwitch +
      `<div class="status" role="status">${escapeHtml(statusText)}</div>` +
      '<div class="foot-row"><p class="fineprint grow">Read from Schoology in this browser only. Missing means the teacher marked it Missing.</p>' +
      (showDemo ? '<button class="btn btn-sm" type="button" data-act="demo">Demo data</button>' : '') +
      '<button class="btn btn-sm" type="button" data-act="options">Settings</button></div></footer>';

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
    const btn = e.target.closest('[data-act]');
    if (!btn || !root.contains(btn)) return;
    const { act, uid, aid } = btn.dataset;
    if (act === 'pick') {
      pickedUid = uid;
      await render();
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

  const WATCHED = ['dashboards', 'settings', 'turnedIn', 'markedDone', 'refreshState'];
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
      root.remove();
    },
  };
}
