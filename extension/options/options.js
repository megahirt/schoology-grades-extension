// options.js — the settings page (see the "Schoology Dashboard Settings"
// design): one page, saved automatically on every change.
//   Account · Family rules · Display · Privacy & data ·
//   Developer (dev builds only) · credit footer.

import browser from 'webextension-polyfill';
import { DEFAULT_SETTINGS, hasGradeData } from '../src/rules.js';
import { getSettings, setSettings, getDashboards, getAccount, getLiveTest, setSite, siteKey } from '../src/storage.js';
import { loadDemo, initials, feedbackHref, REAL_SCHOOLOGY, MOCK_SCHOOLOGY } from '../src/dashboard-view.js';
import npcLogo from '../icons/npc_icon_tiny.png';
import { KNOWN_SCHOOL_HOSTS, isKnownSchoolHost, isSchoologySite, schoolOrigin } from '../src/sites.js';
import { addedSchools, canAddSchools, removeSchool, requestSchool } from '../src/school-access.js';

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
function bindSlider(id, key, label = (v) => `${v}%`) {
  const input = $(id);
  const out = $(`${id}-out`);
  const min = Number(input.min);
  const max = Number(input.max);
  const show = () => { out.textContent = label(Number(input.value)); };
  input.value = Math.min(max, Math.max(min, Math.round(Number(settings[key]) || min)));
  show();
  input.addEventListener('input', show);
  input.addEventListener('change', () => {
    show();
    save({ [key]: Number(input.value) });
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
    setSite(settings.schoologyBase);
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

// --- School address -------------------------------------------------------------
// A school's own Schoology address (src/school-access.js): the browser asks
// the family for that one site; background.js sets it up.

async function renderSchools() {
  const hosts = await addedSchools(browser);
  const list = $('school-added');
  list.textContent = '';
  for (const host of hosts) {
    const row = document.createElement('div');
    row.className = 'row';
    const name = document.createElement('div');
    name.className = 'grow host';
    name.textContent = host;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove ${host}`);
    remove.addEventListener('click', async () => {
      try {
        await removeSchool(browser, host);
        $('school-status').textContent = `Removed ${host}.`;
      } catch (e) {
        $('school-status').textContent = `Couldn't remove ${host}: ${e && e.message ? e.message : e}`;
      }
      renderSchools();
    });
    row.append(name, remove);
    list.append(row);
  }
}

function setupSchools() {
  if (!canAddSchools(browser)) {
    $('school-form').hidden = true;
    $('school-unsupported').hidden = false;
    return;
  }
  const options = document.createDocumentFragment();
  for (const host of KNOWN_SCHOOL_HOSTS) {
    const o = document.createElement('option');
    o.value = host;
    options.append(o);
  }
  $('school-list').append(options);
  $('school-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const status = $('school-status');
    const origin = schoolOrigin($('school-input').value);
    if (!origin) {
      status.textContent = 'That doesn\'t look like a web address. Try something like schoology.yourschool.org.';
      return;
    }
    const host = new URL(origin).hostname;
    if (isSchoologySite(origin)) {
      status.textContent = `Schoology Dashboard already works on ${host}.`;
      return;
    }
    // Ask first, inside the submit: the prompt needs the user's gesture.
    const asking = requestSchool(browser, origin);
    status.textContent = `Asking your browser for ${host}…`;
    asking.then(async (ok) => {
      if (!ok) {
        status.textContent = `Not added: ${host} wasn't allowed.`;
        return;
      }
      $('school-input').value = '';
      status.textContent = isKnownSchoolHost(host)
        ? `Added ${host}. Open it and sign in to see your dashboard there.`
        : `Added ${host}. It isn't on our list of schools' Schoology addresses, so the dashboard only appears if it really is Schoology.`;
      renderSchools();
    }, (err) => {
      status.textContent = `Couldn't ask for ${host}: ${err && err.message ? err.message : err}`;
    });
  });
  renderSchools();
  // Access can also change in the browser's own site settings.
  if (browser.permissions.onAdded) browser.permissions.onAdded.addListener(() => renderSchools());
  if (browser.permissions.onRemoved) browser.permissions.onRemoved.addListener(() => renderSchools());
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
  // The account box shows the Schoology site used last (each site has its
  // own account and data).
  setSite(settings.schoologyBase);
  bindSlider('grade-threshold', 'gradeThreshold');
  bindSlider('missing-threshold', 'missingThreshold', (v) => `${v} ${v === 1 ? 'item' : 'items'}`);
  bindSlider('doing-well-percent', 'doingWellPercent');
  for (const seg of document.querySelectorAll('.seg[data-setting]')) bindSeg(seg, seg.dataset.setting);
  $('credit-logo').src = npcLogo;
  $('feedback-link').href = feedbackHref(browser);
  $('version').textContent = `Homework Dashboard ${browser.runtime.getManifest().version}`;
  setupDev();
  setupSchools();
  setupMenu();
  await renderAccount();
  requestAnimationFrame(() => document.body.classList.add('ready'));
  // Keep the account box and class list current if a refresh finishes.
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if ('settings' in changes) {
      const base = (changes.settings.newValue || {}).schoologyBase;
      if (base && base !== settings.schoologyBase) { settings = { ...settings, schoologyBase: base }; setSite(base); renderAccount(); }
    }
    if (siteKey('dashboards') in changes || siteKey('account') in changes) renderAccount();
  });
}

init();
