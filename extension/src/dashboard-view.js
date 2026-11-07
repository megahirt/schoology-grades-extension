// dashboard-view.js — the dashboard UI, shared by the toolbar popup
// (popup/popup.js) and the in-page panel on Schoology pages (src/panel.js).
// Parent view: one section per child + GO/NO-GO badge with reason.
// Student view: own dashboard, Schoology avatar, class icons, badge hidden
// unless settings.showGoNoGo. All verdicts are recomputed locally with
// rules.js so a manual "mark as turned in" is reflected immediately.
//
// mountDashboard(container, options) renders into any element (a popup
// body or a shadow root) and re-renders whenever the stored dashboards,
// settings or turned-in marks change, so every open popup and panel stays
// in sync. It uses only APIs that work in content scripts as well as
// extension pages: browser.storage, browser.runtime.sendMessage/getURL.

import { summarizeStudent, DEFAULT_SETTINGS, assignmentPercent } from './rules.js';
import {
  getSettings,
  getDashboards,
  setDashboards,
  getTurnedIn,
  setTurnedIn,
} from './storage.js';
import css from './dashboard.css';

export const DASHBOARD_CSS = css;

const DEMO_ANCHOR = new Date('2026-11-06T00:00:00');

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function classIcon(courseName, classIcons = {}) {
  if (classIcons[courseName]) return classIcons[courseName];
  const n = (courseName || '').toLowerCase();
  if (n.includes('math') || n.includes('algebra') || n.includes('geometry')) return '🔢';
  if (n.includes('english') || n.includes('literature') || n.includes('language')) return '📖';
  if (n.includes('history') || n.includes('government') || n.includes('social')) return '🏛️';
  if (n.includes('science') || n.includes('chemistry') || n.includes('biology') || n.includes('physics')) return '🔬';
  if (n.includes('spanish') || n.includes('sign language') || n.includes('french')) return '💬';
  if (n.includes('band') || n.includes('orchestra') || n.includes('music')) return '🎵';
  if (n.includes('bible') || n.includes('theology')) return '✝️';
  if (n.includes('physical') || n.includes('gym')) return '🏃';
  if (n.includes('art')) return '🎨';
  return '📘';
}

function formatDue(a) {
  if (a.dueText) return escapeHtml(a.dueText);
  if (a.due) return escapeHtml(new Date(a.due).toLocaleDateString());
  return '';
}

function gradeLabel(a, settings) {
  const pct = assignmentPercent(a);
  if (pct === null) return '';
  if (settings.gradeDisplay === 'points' && a.maxPoints) {
    return `${a.score}/${a.maxPoints}`;
  }
  return `${Math.round(pct)}%`;
}

function statusLine(a) {
  if (a.status === 'missing') return 'Missing';
  if (a.status === 'excused') return 'Excused';
  if (a.status === 'incomplete') return 'Incomplete';
  return '';
}

function renderAssignment(a, settings, { showTurnedIn = false, uid = null } = {}) {
  const pct = assignmentPercent(a);
  const low = pct !== null && pct < settings.gradeThreshold;
  const grade = settings._hideGrades ? '' : gradeLabel(a, settings);
  const turnBtn = showTurnedIn
    ? ` <button class="turned-in-btn" type="button" data-uid="${escapeHtml(uid)}" data-aid="${escapeHtml(a.id ?? '')}" title="Mark as turned in">✓</button>`
    : '';
  return `<li><span class="title">${escapeHtml(a.title)}${turnBtn}</span>` +
    `<span class="sub">${escapeHtml(a.courseName || '')}</span>` +
    `<span class="sub">${formatDue(a)}</span>` +
    (grade ? `<span class="sub${low ? ' low' : ''}">${escapeHtml(grade)}</span>` : '') +
    (statusLine(a) ? `<span class="sub low">${escapeHtml(statusLine(a))}</span>` : '') +
    `</li>`;
}

function renderSection(title, items, settings, opts = {}) {
  if (!items || items.length === 0) return '';
  return `<h3>${escapeHtml(title)}</h3><ul>${items.map((a) => renderAssignment(a, settings, opts)).join('')}</ul>`;
}

function renderStudent(d, settings, turnedInForStudent, isParentView) {
  const summary = summarizeStudent(d.courses || [], settings, turnedInForStudent);
  const showBadge = settings.showGoNoGo;
  const showGrades = settings.gradeVisibility === 'both'
    || (settings.gradeVisibility === 'parent' && isParentView)
    || (settings.gradeVisibility === 'student' && !isParentView);
  const effectiveSettings = { ...settings, _hideGrades: !showGrades };
  // Awaiting teacher: Missing items manually marked turned in.
  const turnedInIds = turnedInForStudent;
  const awaiting = [];
  for (const c of d.courses || []) {
    for (const a of c.assignments || []) {
      if (a.status === 'missing' && a.id !== null && turnedInIds.has(String(a.id))) {
        awaiting.push({ ...a, courseId: c.id, courseName: c.name });
      }
    }
  }
  const verdict = summary.verdict;
  const hasError = d.error === 'NO_CHILD_ATTRIBUTION';
  const badge = hasError
    ? `<span class="badge unknown">UNKNOWN</span><span class="badge-reason">Could not read this child’s grades</span>`
    : showBadge
      ? `<span class="badge ${verdict.verdict === 'GO' ? 'go' : 'nogo'}">${verdict.verdict}</span>` +
        (verdict.reasons.length ? `<span class="badge-reason">${escapeHtml(verdict.reasons[0])}</span>` : '')
      : '';
  const avatar = d.pictureUrl
    ? `<img class="avatar" src="${escapeHtml(d.pictureUrl)}" alt="">`
    : `<span class="avatar">🧒</span>`;
  const classRows = (d.courses || []).map((c) => {
    const grade = showGrades && typeof c.grade === 'number'
      ? `<span class="class-grade ${c.grade < settings.gradeThreshold ? 'low' : ''}">${c.grade}%</span>`
      : '';
    return `<li><span class="title">${classIcon(c.name, settings.classIcons)} ${escapeHtml(c.name)}</span>${grade}</li>`;
  }).join('');

  let html = `<section class="student"><div class="student-head">${avatar}<h2>${escapeHtml(d.studentName || 'Student')}</h2>${badge}</div>`;
  if (Array.isArray(d.parseWarnings) && d.parseWarnings.length) {
    html += `<p class="warn">⚠ ${d.parseWarnings.map((w) => escapeHtml(w)).join('<br>⚠ ')}</p>`;
  }
  if (classRows) html += `<h3>Classes</h3><ul>${classRows}</ul>`;
  html += renderSection(`Missing · ${summary.missingCount}`, summary.missingItems, effectiveSettings, { showTurnedIn: true, uid: d.studentUid });
  // Due soon with Due today / Due tomorrow badges.
  let dueHtml = '';
  if (summary.dueToday.length || summary.dueTomorrow.length) {
    dueHtml += '<h3>Due soon</h3><ul>';
    for (const a of summary.dueToday) {
      dueHtml += renderAssignment(a, effectiveSettings).replace('</li>', ' <span class="chip today">Due today</span></li>');
    }
    for (const a of summary.dueTomorrow) {
      dueHtml += renderAssignment(a, effectiveSettings).replace('</li>', ' <span class="chip tomorrow">Due tomorrow</span></li>');
    }
    dueHtml += '</ul>';
  }
  html += dueHtml;
  html += renderSection('Doing well', summary.doingWell, effectiveSettings);
  html += renderSection('Not so good', summary.notSoGood, effectiveSettings);
  if (awaiting.length) {
    html += `<h3>Awaiting teacher</h3><ul>${awaiting.map((a) =>
      `<li><span class="title">${escapeHtml(a.title)}</span><span class="sub">${escapeHtml(a.courseName || '')}</span>` +
      `<button class="undo-btn" type="button" data-uid="${escapeHtml(d.studentUid)}" data-aid="${escapeHtml(a.id ?? '')}">Undo</button></li>`).join('')}</ul>`;
  }
  if (!hasError && !summary.missingItems.length && !summary.dueToday.length && !summary.dueTomorrow.length) {
    html += `<p class="empty">Nothing missing, nothing due soon. 🎉</p>`;
  }
  html += '</section>';
  return html;
}

const SHELL = `
<header>
  <h1>📚 Schoology Dashboard</h1>
  <div data-ref="updated" class="muted"></div>
  <div data-ref="stale" class="stale hidden">⚠️ Data is more than 24 hours old — press Refresh now.</div>
</header>
<main data-ref="app">
  <p class="muted">Loading…</p>
</main>
<footer>
  <button data-ref="refresh" type="button">↻ Refresh now</button>
  <button data-ref="demo" type="button">Load demo data</button>
  <button data-ref="options" type="button">⚙️ Settings</button>
  <div data-ref="status" class="muted" role="status"></div>
  <p class="fineprint">Grades are read from Schoology in this browser only and never leave this computer. Missing means explicitly marked Missing in Schoology — a 0 is never counted as Missing on its own.</p>
</footer>`;

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

// mountDashboard(container, { browser, showDemo = true, openOptions })
//   container   — element (or shadow root) to render into; its contents are replaced.
//   browser     — the webextension-polyfill namespace.
//   showDemo    — show the "Load demo data" button.
//   openOptions — how to open the settings page (content scripts cannot
//                 call runtime.openOptionsPage, so the panel asks the
//                 background service worker instead).
// Returns { render, destroy }.
export function mountDashboard(container, { browser, showDemo = true, openOptions } = {}) {
  const root = container.ownerDocument.createElement('div');
  root.className = 'sgd';
  root.innerHTML = SHELL;
  container.replaceChildren(root);
  const ref = (name) => root.querySelector(`[data-ref="${name}"]`);
  ref('demo').classList.toggle('hidden', !showDemo);

  async function render() {
    const app = ref('app');
    const settings = { ...DEFAULT_SETTINGS, schoologyBase: 'https://app.schoology.com', ...((await getSettings()) || {}) };
    const dashboards = (await getDashboards()) || {};
    const turnedIn = (await getTurnedIn()) || {};
    const uids = Object.keys(dashboards);

    // updatedAt + stale warning (>24h).
    let latest = null;
    for (const d of Object.values(dashboards)) {
      if (d.updatedAt && (!latest || d.updatedAt > latest)) latest = d.updatedAt;
    }
    if (latest) {
      const when = new Date(latest);
      ref('updated').textContent = `Updated ${when.toLocaleString()}`;
      ref('stale').classList.toggle('hidden', Date.now() - when.getTime() <= 24 * 60 * 60 * 1000);
    } else {
      ref('updated').textContent = '';
      ref('stale').classList.add('hidden');
    }

    if (uids.length === 0) {
      app.innerHTML = `<p class="empty">No Schoology data yet. Open Schoology in this browser and visit a Grades page, press Refresh now${showDemo ? ', or load the demo data to see how the dashboard looks' : ''}.</p>`;
      return;
    }
    const isParentView = uids.length > 1;
    app.innerHTML = uids
      .map((uid) => {
        const d = dashboards[uid];
        const turnedInForStudent = new Set((turnedIn[uid] || []).map(String));
        return renderStudent({ ...d, studentUid: uid }, settings, turnedInForStudent, isParentView);
      })
      .join('');
  }

  // "Mark as turned in" (✓), Undo and the footer buttons, via delegation.
  async function onClick(e) {
    const status = ref('status');
    const turnBtn = e.target.closest('.turned-in-btn');
    const undoBtn = e.target.closest('.undo-btn');
    if (turnBtn || undoBtn) {
      const btn = turnBtn || undoBtn;
      const { uid, aid } = btn.dataset;
      if (!uid || !aid) return;
      const turnedIn = (await getTurnedIn()) || {};
      const list = new Set((turnedIn[uid] || []).map(String));
      if (turnBtn) list.add(aid);
      else list.delete(aid);
      turnedIn[uid] = [...list];
      await setTurnedIn(turnedIn);
      await render();
      return;
    }
    const button = e.target.closest('[data-ref]');
    const action = button && button.dataset.ref;
    if (action === 'refresh') {
      status.textContent = 'Refreshing…';
      try {
        const result = await browser.runtime.sendMessage({ type: 'refresh-now' });
        if (result && result.ok) {
          status.textContent = 'Refreshed.';
        } else if (result && result.fallback === 'hidden-tab') {
          status.textContent = 'Could not fetch in the background (not logged in, or Schoology changed its page). Visit a Schoology Grades page and the dashboard will update from there.';
        } else {
          status.textContent = `Refresh failed: ${result && result.error ? result.error : 'unknown error'}`;
        }
      } catch (err) {
        status.textContent = `Refresh failed: ${err.message || err}`;
      }
      await render();
    } else if (action === 'demo') {
      try {
        await loadDemo(browser);
        status.textContent = 'Demo data loaded.';
        await render();
      } catch (err) {
        status.textContent = `Could not load demo data: ${err.message || err}`;
      }
    } else if (action === 'options') {
      if (openOptions) openOptions();
      else browser.runtime.openOptionsPage();
    }
  }
  root.addEventListener('click', onClick);

  // Re-render when another popup, panel or the background changes the data.
  const WATCHED = ['dashboards', 'settings', 'turnedIn'];
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
