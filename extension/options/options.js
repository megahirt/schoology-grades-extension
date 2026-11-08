// options.js — the settings page (see the "Schoology Dashboard Settings"
// design): one page, saved automatically on every change.
//   Account · Family rules · Display · Privacy & data ·
//   Developer (dev builds only) · credit footer.

import browser from 'webextension-polyfill';
import { DEFAULT_SETTINGS, hasGradeData } from '../src/rules.js';
import { getSettings, setSettings, getDashboards, getAccount, getLiveTest, storageRemove } from '../src/storage.js';
import { loadDemo, initials, feedbackHref, REAL_SCHOOLOGY, MOCK_SCHOOLOGY } from '../src/dashboard-view.js';
import npcLogo from '../icons/npc_icon_tiny.png';

const IS_DEV = typeof __DEV__ !== 'undefined' && __DEV__; // eslint-disable-line no-undef
const $ = (id) => document.getElementById(id);

let settings = { ...DEFAULT_SETTINGS, schoologyBase: REAL_SCHOOLOGY };

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

// A slider with its value shown beside it. Saved values outside the range
// (from an older version) show at the nearest end.
function bindSlider(id, key) {
  const input = $(id);
  const out = $(`${id}-out`);
  const min = Number(input.min);
  const max = Number(input.max);
  const show = () => { out.textContent = `${input.value}%`; };
  input.value = Math.min(max, Math.max(min, Math.round(Number(settings[key]) || min)));
  show();
  input.addEventListener('input', show);
  input.addEventListener('change', () => {
    show();
    save({ [key]: Number(input.value) });
  });
}

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
  // Family rules are for parents only; a student's dashboard uses the defaults.
  const uids = Object.keys((await getDashboards()) || {});
  const isParent = account ? account.type === 'parent' : uids.length > 0 && !(uids.length === 1 && uids[0] === 'self');
  $('rules').hidden = !isParent;
  $('rules-link').hidden = !isParent;
  const known = account && (account.type === 'parent' || account.type === 'student');
  $('account-status').classList.toggle('ok', Boolean(known));
  $('account-title').textContent = !account
    ? 'Not checked yet'
    : account.type === 'parent' ? 'Connected as a parent'
      : account.type === 'student' ? 'Connected as a student'
        : 'Not signed in to Schoology';
  const who = account && account.type === 'parent' ? ` · ${kids.length} ${kids.length === 1 ? 'child' : 'children'}` : '';
  $('account-detail').textContent = `${site}${who} · ${updatedText(dashboards)}`;
  $('kids').innerHTML = kids.map(([, d]) => {
    // Classes with grades posted (the ones the dashboard shows).
    const shown = (d.courses || []).filter((c) => hasGradeData(c)).length;
    const pic = d.pictureUrl
      ? `<img class="avatar" src="${escapeHtml(d.pictureUrl)}" alt="">`
      : `<span class="avatar" aria-hidden="true">${escapeHtml(initials(d.studentName))}</span>`;
    return `<div class="kid">${pic}<div class="grow"><div class="strong">${escapeHtml(d.studentName || 'Student')}</div>` +
      `<div class="muted">${shown} ${shown === 1 ? 'class' : 'classes'}</div></div></div>`;
  }).join('');
}

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
});

$('clear-btn').addEventListener('click', async () => {
  // eslint-disable-next-line no-alert
  if (!window.confirm('Clear everything this extension saved in this browser: grades, records, the daily log, your turned-in and done marks, and your settings? This cannot be undone.')) return;
  await browser.storage.local.clear();
  // Reload so every setting shows its default again.
  window.location.reload();
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
  settings = { ...settings, ...stored };
  bindSlider('grade-threshold', 'gradeThreshold');
  bindNumber('missing-threshold', 'missingThreshold', { min: 1, max: 20 });
  bindSlider('doing-well-percent', 'doingWellPercent');
  for (const seg of document.querySelectorAll('.seg[data-setting]')) bindSeg(seg, seg.dataset.setting);
  $('credit-logo').src = npcLogo;
  $('feedback-link').href = feedbackHref(browser);
  $('version').textContent = `Homework Dashboard ${browser.runtime.getManifest().version}`;
  setupDev();
  setupMenu();
  await renderAccount();
  requestAnimationFrame(() => document.body.classList.add('ready'));
  // Keep the account box and class list current if a refresh finishes.
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && ('dashboards' in changes || 'account' in changes)) renderAccount();
  });
}

init();
