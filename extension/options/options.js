// options.js — settings + 6-step setup wizard
// (Connect → Profile → Classes → Icons → Rules → Review).
// Classes step uses classifier.js; Profile uses the Schoology pictureUrl
// by default, upload/pick-from-list is fallback only.

import browser from 'webextension-polyfill';
import { DEFAULT_SETTINGS } from '../src/rules.js';
import { classifySection } from '../src/classifier.js';
import {
  getSettings,
  setSettings,
  getDashboards,
  getAccount,
  getLiveTest,
} from '../src/storage.js';

let currentStep = 1;
let settings = { ...DEFAULT_SETTINGS, schoologyBase: 'https://app.schoology.com', classIcons: {}, avatarOverride: null, realClasses: {} };
let dashboards = {};
let account = null;

const AVATAR_CHOICES = ['🧒', '👦', '👧', '🦊', '🐶', '🐱', '🦉', '🚀', '⚽', '🎸'];

function showStep(n) {
  currentStep = Math.min(6, Math.max(1, n));
  document.querySelectorAll('.step').forEach((el) => el.classList.remove('active'));
  document.querySelectorAll('.step-btn').forEach((el) => el.classList.remove('active'));
  document.getElementById(`step-${currentStep}`).classList.add('active');
  document.querySelector(`.step-btn[data-step="${currentStep}"]`).classList.add('active');
  if (currentStep === 3) renderClasses();
  if (currentStep === 4) renderIcons();
  if (currentStep === 6) renderReview();
}

function allCourses() {
  const out = [];
  for (const [uid, d] of Object.entries(dashboards)) {
    for (const c of d.courses || []) {
      out.push({ uid, studentName: d.studentName, ...c });
    }
  }
  return out;
}

function courseStats(course) {
  const graded = (course.assignments || []).filter((a) => a.score !== null && a.score !== undefined).length;
  return {
    name: course.name || '',
    gradedItemCount: graded,
    hasPeriodGrade: typeof course.grade === 'number',
    assignmentCount: (course.assignments || []).length,
  };
}

function renderClasses() {
  const el = document.getElementById('class-list');
  const courses = allCourses();
  if (!courses.length) {
    el.innerHTML = '<p class="muted">No classes loaded yet — refresh grades first, or load the demo data from the popup.</p>';
    return;
  }
  el.innerHTML = courses.map((c) => {
    const rec = classifySection(courseStats(c));
    const key = `${c.uid}:${c.id || c.name}`;
    const checked = settings.realClasses[key] !== false && rec.recommendation !== 'skip';
    return `<div class="class-row"><input type="checkbox" data-class-key="${key.replace(/"/g, '&quot;')}" ${checked ? 'checked' : ''}>` +
      `<span>${c.name} <span class="muted">(${c.studentName})</span></span>` +
      `<span class="rec ${rec.recommendation}">${rec.recommendation} · ${rec.score}</span>` +
      `<span class="muted" title="${rec.reasons.join('; ')}">ⓘ</span></div>`;
  }).join('');
  el.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      settings.realClasses[cb.dataset.classKey] = cb.checked;
    });
  });
}

function renderIcons() {
  const el = document.getElementById('icon-list');
  const courses = allCourses();
  if (!courses.length) {
    el.innerHTML = '<p class="muted">No classes loaded yet.</p>';
    return;
  }
  el.innerHTML = courses.map((c) => {
    const current = (settings.classIcons && settings.classIcons[c.name]) || '';
    return `<div class="icon-row"><span>${c.name}</span><select data-icon-for="${c.name.replace(/"/g, '&quot;')}">` +
      ['', '📖', '🔢', '🔬', '🏛️', '💬', '🎵', '✝️', '🏃', '🎨', '📘'].map((ic) =>
        `<option value="${ic}" ${ic === current ? 'selected' : ''}>${ic || '(auto)'}</option>`).join('') +
      `</select></div>`;
  }).join('');
  el.querySelectorAll('select').forEach((sel) => {
    sel.addEventListener('change', () => {
      settings.classIcons[sel.dataset.iconFor] = sel.value;
    });
  });
}

function renderProfile() {
  const el = document.getElementById('profile-preview');
  const first = Object.values(dashboards)[0];
  const pic = settings.avatarOverride || (first && first.pictureUrl);
  el.innerHTML = pic
    ? `<img class="avatar" src="${pic}" alt="Profile picture">`
    : '<p class="muted">No Schoology picture found yet — refresh grades first.</p>';
  const choices = document.getElementById('avatar-choices');
  choices.innerHTML = AVATAR_CHOICES.map((a) =>
    `<button type="button" class="avatar-choice${settings.avatarOverride === a ? ' selected' : ''}" data-avatar="${a}">${a}</button>`).join('');
  choices.querySelectorAll('.avatar-choice').forEach((b) => {
    b.addEventListener('click', () => {
      settings.avatarOverride = b.dataset.avatar;
      renderProfile();
    });
  });
}

function renderReview() {
  const courses = allCourses();
  const real = courses.filter((c) => settings.realClasses[`${c.uid}:${c.id || c.name}`] !== false).length;
  document.getElementById('review').innerHTML =
    `<ul><li>Grade threshold: <b>${settings.gradeThreshold}</b> (below = NO-GO)</li>` +
    `<li>Missing threshold: <b>${settings.missingThreshold}</b> Missing item(s) = NO-GO</li>` +
    `<li>"Not so good" window: <b>${settings.notSoGoodDays}</b> day(s)</li>` +
    `<li>Show GO/NO-GO badge: <b>${settings.showGoNoGo ? 'yes' : 'no'}</b></li>` +
    `<li>Panel on Schoology pages: <b>${settings.showPanel !== false ? 'yes' : 'no'}</b></li>` +
    `<li>Grades visible to: <b>${settings.gradeVisibility}</b>; display: <b>${settings.gradeDisplay}</b></li>` +
    `<li>Classes kept: <b>${real} of ${courses.length}</b></li>` +
    `<li>Schoology base: <b>${settings.schoologyBase}</b></li></ul>`;
}

function readRulesForm() {
  settings.gradeThreshold = Number(document.getElementById('grade-threshold').value) || 75;
  settings.missingThreshold = Number(document.getElementById('missing-threshold').value) || 2;
  settings.notSoGoodDays = Number(document.getElementById('notsogood-days').value) || 7;
  settings.showGoNoGo = document.getElementById('show-gonogo').checked;
  settings.showPanel = document.getElementById('show-panel').checked;
  settings.gradeVisibility = document.getElementById('grade-visibility').value;
  settings.gradeDisplay = document.getElementById('grade-display').value;
  settings.schoologyBase = document.getElementById('schoology-base').value.trim() || 'https://app.schoology.com';
}

function fillForm() {
  document.getElementById('grade-threshold').value = settings.gradeThreshold;
  document.getElementById('missing-threshold').value = settings.missingThreshold;
  document.getElementById('notsogood-days').value = settings.notSoGoodDays;
  document.getElementById('show-gonogo').checked = settings.showGoNoGo;
  document.getElementById('show-panel').checked = settings.showPanel !== false;
  document.getElementById('grade-visibility').value = settings.gradeVisibility;
  document.getElementById('grade-display').value = settings.gradeDisplay;
  document.getElementById('schoology-base').value = settings.schoologyBase;
  const acc = document.getElementById('account-line');
  acc.textContent = account
    ? `Account: ${account.type}${account.children && account.children.length ? ` — ${account.children.map((c) => c.name).join(', ')}` : ''} (detected ${account.detectedAt || 'unknown'})`
    : 'Account: not checked yet.';
}

async function init() {
  const stored = (await getSettings()) || {};
  settings = { ...settings, ...stored, classIcons: stored.classIcons || {}, realClasses: stored.realClasses || {} };
  dashboards = (await getDashboards()) || {};
  account = await getAccount();
  fillForm();
  renderProfile();

  document.querySelectorAll('.step-btn').forEach((b) => {
    b.addEventListener('click', () => showStep(Number(b.dataset.step)));
  });
  document.getElementById('prev-btn').addEventListener('click', () => showStep(currentStep - 1));
  document.getElementById('next-btn').addEventListener('click', () => { readRulesForm(); showStep(currentStep + 1); });
  document.getElementById('save-btn').addEventListener('click', async () => {
    readRulesForm();
    await setSettings(settings);
    document.getElementById('save-status').textContent = 'Saved.';
  });
  document.getElementById('check-account-btn').addEventListener('click', async () => {
    const el = document.getElementById('connect-status');
    el.textContent = 'Checking…';
    try {
      const result = await browser.runtime.sendMessage({ type: 'refresh-now' });
      account = await getAccount();
      dashboards = (await getDashboards()) || {};
      fillForm();
      renderProfile();
      el.textContent = result && result.ok
        ? `Connected (${result.accountType}).`
        : `Could not fetch grades in the background: ${result && result.error ? result.error : 'unknown'}. Try visiting a Schoology Grades page instead.`;
    } catch (err) {
      el.textContent = `Check failed: ${err.message || err}`;
    }
  });
  document.getElementById('refresh-btn').addEventListener('click', async () => {
    const el = document.getElementById('connect-status');
    el.textContent = 'Refreshing…';
    try {
      const result = await browser.runtime.sendMessage({ type: 'refresh-now' });
      dashboards = (await getDashboards()) || {};
      renderClasses();
      el.textContent = result && result.ok ? 'Refreshed.' : `Refresh issue: ${result && result.error ? result.error : 'unknown'}`;
    } catch (err) {
      el.textContent = `Refresh failed: ${err.message || err}`;
    }
  });
  document.getElementById('avatar-upload').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      settings.avatarOverride = reader.result;
      renderProfile();
    };
    reader.readAsDataURL(file);
  });
  document.getElementById('live-test-btn').addEventListener('click', async () => {
    const out = document.getElementById('live-test-result');
    out.textContent = 'Running live connection test…';
    try {
      readRulesForm();
      const stored2 = (await getSettings()) || {};
      const gradesUrl = stored2.lastGradesUrl || `${settings.schoologyBase}/home`;
      const evidence = await browser.runtime.sendMessage({ type: 'run-live-probe', url: gradesUrl });
      out.textContent = JSON.stringify(evidence, null, 2);
      const saved = await getLiveTest();
      if (saved) out.textContent += `\n\nStored as liveTest at ${new Date().toISOString()}.`;
    } catch (err) {
      out.textContent = `Live test failed: ${err.message || err}`;
    }
  });
}

init();
