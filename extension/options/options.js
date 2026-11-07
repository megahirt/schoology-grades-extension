// options.js — the settings page (see the "Schoology Dashboard Settings"
// design): one page, saved automatically on every change.
//   Account · Family rules · Display · Classes · Privacy & data ·
//   Developer (dev builds only) · credit footer.

import browser from 'webextension-polyfill';
import { DEFAULT_SETTINGS, hasGradeData } from '../src/rules.js';
import { getSettings, setSettings, getDashboards, getAccount, getLiveTest, storageRemove } from '../src/storage.js';
import { loadDemo, initials, REAL_SCHOOLOGY, MOCK_SCHOOLOGY } from '../src/dashboard-view.js';
import npcLogo from '../icons/npc_icon_tiny.png';

const IS_DEV = typeof __DEV__ !== 'undefined' && __DEV__; // eslint-disable-line no-undef
const $ = (id) => document.getElementById(id);

let settings = { ...DEFAULT_SETTINGS, schoologyBase: REAL_SCHOOLOGY, realClasses: {} };

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- Saving -----------------------------------------------------------------

let saveTimer = null;
function showSaved(state) {
  const el = $('save-state');
  el.classList.toggle('saving', state === 'saving');
  el.querySelector('span').textContent = state === 'saving' ? 'Saving…' : 'Changes save automatically';
}

async function save(patch) {
  settings = { ...settings, ...patch };
  showSaved('saving');
  await setSettings(settings);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => showSaved('saved'), 400);
}

// --- Controls -----------------------------------------------------------------

function bindNumber(id, key, { min, max }) {
  const input = $(id);
  input.value = settings[key];
  input.addEventListener('change', () => {
    const n = Number(input.value);
    if (!Number.isFinite(n)) {
      input.value = settings[key];
      return;
    }
    const v = Math.min(max, Math.max(min, Math.round(n)));
    input.value = v;
    save({ [key]: v });
  });
}

function setSwitch(btn, on) {
  btn.setAttribute('aria-checked', String(Boolean(on)));
}

function bindSwitch(id, key) {
  const btn = $(id);
  setSwitch(btn, settings[key] !== false);
  btn.addEventListener('click', () => {
    const on = btn.getAttribute('aria-checked') !== 'true';
    setSwitch(btn, on);
    save({ [key]: on });
  });
}

function setSeg(seg, value) {
  for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.value === value));
}

function bindSeg(seg, key) {
  setSeg(seg, settings[key]);
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-value]');
    if (!b) return;
    setSeg(seg, b.dataset.value);
    save({ [key]: b.dataset.value });
  });
}

// --- Account -------------------------------------------------------------------

function updatedText(dashboards) {
  let latest = null;
  for (const d of Object.values(dashboards)) if (d.updatedAt && (!latest || d.updatedAt > latest)) latest = d.updatedAt;
  if (!latest) return 'not refreshed yet';
  const when = new Date(latest);
  const time = when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return when.toDateString() === new Date().toDateString()
    ? `last refreshed today, ${time}`
    : `last refreshed ${when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
}

async function renderAccount() {
  const account = await getAccount();
  const dashboards = (await getDashboards()) || {};
  const site = (() => {
    try {
      return new URL(settings.schoologyBase).host;
    } catch {
      return settings.schoologyBase;
    }
  })();
  const kids = Object.entries(dashboards);
  const known = account && (account.type === 'parent' || account.type === 'student');
  $('account-status').classList.toggle('ok', Boolean(known));
  $('account-title').textContent = !account
    ? 'Not checked yet'
    : account.type === 'parent' ? 'Connected as a parent'
      : account.type === 'student' ? 'Connected as a student'
        : 'Not signed in to Schoology';
  const who = account && account.type === 'parent' ? ` · ${kids.length} ${kids.length === 1 ? 'child' : 'children'}` : '';
  $('account-detail').textContent = `${site}${who} · ${updatedText(dashboards)}`;
  $('kids').innerHTML = kids.map(([uid, d]) => {
    const shown = (d.courses || []).filter((c) => isShown(uid, c)).length;
    const hidden = (d.courses || []).length - shown;
    const pic = d.pictureUrl
      ? `<img class="avatar" src="${escapeHtml(d.pictureUrl)}" alt="">`
      : `<span class="avatar" aria-hidden="true">${escapeHtml(initials(d.studentName))}</span>`;
    return `<div class="kid">${pic}<div class="grow"><div class="strong">${escapeHtml(d.studentName || 'Student')}</div>` +
      `<div class="muted">${shown} ${shown === 1 ? 'class' : 'classes'}${hidden ? ` · ${hidden} hidden` : ''}</div></div></div>`;
  }).join('');
}

// --- Classes -------------------------------------------------------------------

const classKey = (uid, c) => `${uid}:${c.id || c.name}`;

// Shown unless hidden by hand; sections with no grades start hidden.
function isShown(uid, c) {
  const choice = (settings.realClasses || {})[classKey(uid, c)];
  if (choice === true || choice === false) return choice;
  return hasGradeData(c);
}

function pct(n) {
  return typeof n === 'number' ? `${Math.round(n * 10) / 10}%` : '—';
}

function classDetail(c) {
  if (!hasGradeData(c)) return 'No grades · hidden automatically';
  const parts = [];
  if (typeof c.quarterGrade === 'number') parts.push(`${c.gradeLabel || 'Quarter'} ${pct(c.quarterGrade)}`);
  if (typeof c.overallGrade === 'number') parts.push(`${c.overallLabel || 'Semester'} ${pct(c.overallGrade)}`);
  if (!parts.length && typeof c.grade === 'number') parts.push(pct(c.grade));
  return parts.join(' · ');
}

async function renderClasses() {
  const dashboards = (await getDashboards()) || {};
  const groups = Object.entries(dashboards).filter(([, d]) => (d.courses || []).length);
  if (!groups.length) {
    $('class-groups').innerHTML = '<p class="muted">No classes yet. Press Refresh now above.</p>';
    return;
  }
  $('class-groups').innerHTML = groups.map(([uid, d]) =>
    `<div class="group"><div class="group-h">${escapeHtml(d.studentName || 'Student')}</div>` +
    d.courses.map((c) => {
      const on = isShown(uid, c);
      return `<div class="class-row${on ? '' : ' off'}"><div class="grow"><div class="name">${escapeHtml(c.name)}</div>` +
        `<div class="muted">${escapeHtml(classDetail(c))}</div></div>` +
        `<button type="button" role="switch" class="switch" aria-checked="${on}" aria-label="Show ${escapeHtml(c.name)}" data-key="${escapeHtml(classKey(uid, c))}" data-auto="${hasGradeData(c)}"><span></span></button></div>`;
    }).join('') + '</div>').join('');
}

$('class-groups').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-key]');
  if (!btn) return;
  const on = btn.getAttribute('aria-checked') !== 'true';
  const realClasses = { ...(settings.realClasses || {}) };
  // Store only choices that differ from the automatic default.
  if (on === (btn.dataset.auto === 'true')) delete realClasses[btn.dataset.key];
  else realClasses[btn.dataset.key] = on;
  await save({ realClasses });
  await renderClasses();
  await renderAccount();
});

// --- Buttons -------------------------------------------------------------------

$('refresh-btn').addEventListener('click', async () => {
  const btn = $('refresh-btn');
  btn.disabled = true;
  btn.textContent = 'Refreshing…';
  try {
    await browser.runtime.sendMessage({ type: 'refresh-now' });
  } catch {
    // The account box shows the result either way.
  }
  btn.disabled = false;
  btn.textContent = 'Refresh now';
  await renderAccount();
  await renderClasses();
});

$('clear-btn').addEventListener('click', async () => {
  // eslint-disable-next-line no-alert
  if (!window.confirm('Clear the saved grades and your turned-in and done marks from this browser? Settings stay. This cannot be undone.')) return;
  for (const key of ['dashboards', 'turnedIn', 'markedDone', 'refreshState', 'account', 'liveTest']) await storageRemove(key);
  $('clear-status').textContent = 'Saved grades and marks cleared.';
  await renderAccount();
  await renderClasses();
});

// --- Developer (dev builds only) ------------------------------------------------

function setupDev() {
  if (!IS_DEV) return;
  for (const el of document.querySelectorAll('.dev-only')) el.hidden = false;
  const v = browser.runtime.getManifest().version_name || '';
  const stamp = v.includes('-dev.') ? v.split('-dev.')[1].replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2}).*$/, '$2/$3 $4:$5') : '';
  $('dev-build').textContent = stamp ? `Dev builds only · built ${stamp} UTC` : 'Dev builds only';
  const seg = $('source-seg');
  setSeg(seg, settings.schoologyBase === MOCK_SCHOOLOGY ? 'mock' : 'real');
  seg.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-value]');
    if (!b) return;
    setSeg(seg, b.dataset.value);
    await save({ schoologyBase: b.dataset.value === 'mock' ? MOCK_SCHOOLOGY : REAL_SCHOOLOGY });
    await storageRemove('dashboards');
    await renderAccount();
    await renderClasses();
  });
  const out = $('dev-result');
  $('live-test-btn').addEventListener('click', async () => {
    out.hidden = false;
    out.textContent = 'Running live connection test…';
    try {
      const stored = (await getSettings()) || {};
      const url = stored.lastGradesUrl || `${settings.schoologyBase}/home`;
      const evidence = await browser.runtime.sendMessage({ type: 'run-live-probe', url });
      out.textContent = JSON.stringify(evidence, null, 2);
      if (await getLiveTest()) out.textContent += `\n\nStored as liveTest at ${new Date().toISOString()}.`;
    } catch (err) {
      out.textContent = `Live test failed: ${err.message || err}`;
    }
  });
  $('demo-btn').addEventListener('click', async () => {
    out.hidden = false;
    try {
      await loadDemo(browser);
      out.textContent = 'Demo data loaded (made-up families).';
    } catch (err) {
      out.textContent = `Could not load demo data: ${err.message || err}`;
    }
    await renderAccount();
    await renderClasses();
  });
}

// --- Menu highlight ---------------------------------------------------------------

function setupMenu() {
  const links = [...document.querySelectorAll('.side a')];
  const mark = () => {
    const id = (location.hash || '#account').slice(1);
    for (const a of links) a.classList.toggle('active', a.getAttribute('href') === `#${id}`);
  };
  window.addEventListener('hashchange', mark);
  mark();
}

// --- Start ------------------------------------------------------------------------

async function init() {
  const stored = (await getSettings()) || {};
  settings = { ...settings, ...stored, realClasses: stored.realClasses || {} };
  bindNumber('grade-threshold', 'gradeThreshold', { min: 0, max: 100 });
  bindNumber('missing-threshold', 'missingThreshold', { min: 1, max: 20 });
  bindNumber('doing-well-percent', 'doingWellPercent', { min: 0, max: 100 });
  bindNumber('doing-well-days', 'doingWellDays', { min: 1, max: 60 });
  bindNumber('notsogood-days', 'notSoGoodDays', { min: 1, max: 60 });
  bindSwitch('show-gonogo', 'showGoNoGo');
  bindSwitch('show-panel', 'showPanel');
  bindSwitch('auto-refresh', 'autoRefresh');
  for (const seg of document.querySelectorAll('.seg[data-setting]')) bindSeg(seg, seg.dataset.setting);
  $('credit-logo').src = npcLogo;
  $('version').textContent = `Homework Dashboard ${browser.runtime.getManifest().version}`;
  setupDev();
  setupMenu();
  await renderAccount();
  await renderClasses();
  requestAnimationFrame(() => document.body.classList.add('ready'));
  // Keep the account box and class list current if a refresh finishes.
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && ('dashboards' in changes || 'account' in changes)) {
      renderAccount();
      renderClasses();
    }
  });
}

init();
