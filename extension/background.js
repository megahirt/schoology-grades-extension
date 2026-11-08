// background.js — MV3 service worker (Safari-first, Chrome second).
// Top-level listeners only. Never holds grades in globals —
// browser.storage.local is the source of truth (the worker terminates
// after ~30s idle). Delegates fetching to schoology.js and parsing to
// parser.js. Uses browser.* (webextension-polyfill) Promise APIs everywhere.

import browser from 'webextension-polyfill';
import { createClient } from './src/schoology.js';
import { parseGradesHtml } from './src/parser.js';
import { summarizeStudent, DEFAULT_SETTINGS, effectiveSettings, isStudentAccount } from './src/rules.js';
import { coursePagePath, findComposeHref, findCourseAdmins, findParentName, likelyTeacher } from './src/teacher-email.js';
import {
  getSettings,
  setSettings,
  getDashboards,
  setDashboards,
  setLiveTest,
  setAccount,
  getAccount,
  getTurnedIn,
  getMarkedDone,
  storageGet,
  storageSet,
} from './src/storage.js';

const ALARM_NAME = 'refresh-grades';
const REFRESH_PERIOD_MINUTES = 60;

async function loadSettings() {
  const stored = (await getSettings()) || {};
  const settings = effectiveSettings(stored, { isStudent: isStudentAccount(await getAccount(), await getDashboards()) });
  return { schoologyBase: 'https://app.schoology.com', ...settings };
}

async function writeDashboard(uid, dashboard) {
  const dashboards = (await getDashboards()) || {};
  dashboards[uid] = { ...dashboard, updatedAt: new Date().toISOString() };
  await setDashboards(dashboards);
  return dashboards;
}

// Full refresh: detect account, fetch dashboards, parse, summarize, store.
// progress({ done, total, label }) reports steps for the UI (see startRefresh).
async function refreshGrades(progress = () => {}) {
  const settings = await loadSettings();
  progress({ done: 0, total: 1, label: 'Checking your Schoology account' });
  const turnedIn = (await getTurnedIn()) || {};
  const markedDone = (await getMarkedDone()) || {};
  const client = createClient({ baseUrl: settings.schoologyBase });
  const account = await client.detectAccount();
  await setAccount({ ...account, detectedAt: new Date().toISOString() });

  if (account.type === 'parent') {
    const dashboards = await client.fetchParentDashboards({
      turnedInIdsByStudent: turnedIn,
      // +1: the account check above counts as the first step.
      onProgress: ({ done, total, label }) => progress({ done: done + 1, total: total + 1, label }),
    });
    const byUid = {};
    for (const d of dashboards) {
      // Re-summarize with the family's settings (fetch layer used defaults).
      let summary = summarizeStudent(d.courses, settings, turnedIn[d.studentUid], markedDone[d.studentUid]);
      if (d.error) {
        // Keep the UNKNOWN verdict — empty courses would recompute to a false GO.
        summary = { ...summary, verdict: { verdict: 'UNKNOWN', reasons: ['Could not read this child’s grades.'] } };
      }
      byUid[d.studentUid] = { ...d, summary, updatedAt: new Date().toISOString() };
    }
    if (Object.keys(byUid).length > 0) await setDashboards(byUid);
    return { ok: true, accountType: 'parent', students: Object.keys(byUid) };
  }

  if (account.type === 'student') {
    progress({ done: 1, total: 2, label: 'Reading your grades' });
    const result = await client.fetchStudentDashboard({ turnedInIds: turnedIn.self });
    if (result.error === 'LOGGED_OUT') {
      return { ok: false, accountType: 'student', error: 'LOGGED_OUT', fallback: 'hidden-tab' };
    }
    if (result.error === 'PARSE_EMPTY' || result.error === 'NO_GRADES') {
      return { ok: false, accountType: 'student', error: result.error, fallback: 'hidden-tab' };
    }
    const summary = summarizeStudent(result.courses, settings, turnedIn.self, markedDone.self);
    const uid = account.children?.[0]?.uid || 'self';
    const name = result.studentName || account.studentName || 'Student';
    await writeDashboard(uid, {
      studentUid: uid,
      studentName: name,
      pictureUrl: account.children?.[0]?.pictureUrl || null,
      courses: result.courses,
      summary,
      source: result.source,
      parseWarnings: result.parseWarnings || [],
      error: result.error || null,
    });
    return { ok: true, accountType: 'student', students: [uid] };
  }

  // loggedOut / unknown: nothing to fetch from the service worker.
  return { ok: false, accountType: account.type, error: 'NOT_LOGGED_IN', fallback: 'hidden-tab' };
}

// ---------------------------------------------------------------------------
// ONE REFRESH AT A TIME, WITH PROGRESS
// Every refresh (Refresh button, Schoology page load, alarm) goes through
// startRefresh. A second request while one is running joins it instead of
// starting another. Progress lives in storage under `refreshState`
//   { running, startedAt, done, total, label, finishedAt?, ok?, error? }
// so every open popup and panel shows the same banner and progress bar.
// ---------------------------------------------------------------------------
let currentRefresh = null;
const REFRESH_TIMEOUT_MS = 2 * 60 * 1000;
// Auto-refresh on a Schoology page load only when the data is older than this.
// Each click in Schoology loads a new page, and a parent refresh briefly
// switches Schoology's "viewing as" child, so it must not run on every click.
const AUTO_REFRESH_MIN_AGE_MS = 5 * 60 * 1000;

async function setRefreshState(state) {
  await browser.storage.local.set({ refreshState: state });
}

function startRefresh(reason = 'manual') {
  if (currentRefresh) return currentRefresh;
  const startedAt = new Date().toISOString();
  let last = { done: 0, total: 1, label: 'Starting' };
  const progress = (p) => {
    last = { done: Math.min(p.done, p.total), total: Math.max(1, p.total), label: p.label || last.label };
    setRefreshState({ running: true, reason, startedAt, ...last }).catch(() => {});
  };
  currentRefresh = (async () => {
    await setRefreshState({ running: true, reason, startedAt, ...last });
    let result;
    let timer;
    try {
      // A refresh that never settles (a Schoology request that hangs) must not
      // block every later refresh: give up after REFRESH_TIMEOUT_MS.
      result = await Promise.race([
        refreshGrades(progress),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve({ ok: false, error: 'Schoology took too long to answer' }), REFRESH_TIMEOUT_MS);
        }),
      ]);
    } catch (e) {
      result = { ok: false, error: String(e && e.message ? e.message : e) };
    } finally {
      clearTimeout(timer);
    }
    await setRefreshState({
      running: false,
      reason,
      startedAt,
      finishedAt: new Date().toISOString(),
      done: last.total,
      total: last.total,
      label: result && result.ok ? 'Done' : 'Failed',
      ok: Boolean(result && result.ok),
      error: result && !result.ok ? result.error || 'unknown error' : null,
    });
    return result;
  })().finally(() => {
    currentRefresh = null;
  });
  return currentRefresh;
}

// A Schoology page finished loading in a tab (content script). Refresh when
// the stored data is missing or older than AUTO_REFRESH_MIN_AGE_MS, and only
// for the Schoology site the extension is pointed at (real vs mock).
async function maybeAutoRefresh(pageUrl) {
  if (currentRefresh) return { started: false, reason: 'already running' };
  const settings = await loadSettings();
  let sameSite = false;
  try {
    sameSite = new URL(pageUrl).origin === new URL(settings.schoologyBase).origin;
  } catch {
    sameSite = false;
  }
  if (!sameSite) return { started: false, reason: 'other site' };
  const dashboards = (await getDashboards()) || {};
  let newest = 0;
  for (const d of Object.values(dashboards)) {
    const t = Date.parse(d.updatedAt || '');
    if (t > newest) newest = t;
  }
  if (newest && Date.now() - newest < AUTO_REFRESH_MIN_AGE_MS) return { started: false, reason: 'fresh' };
  startRefresh('page-load');
  return { started: true };
}

// ---------------------------------------------------------------------------
// HIDDEN-TAB FALLBACK (only on demand, never silent mass tab opening).
// If the fetch path returns loggedOut or PARSE_EMPTY, open the Grades page
// in an inactive tab, let the content script scrape the RENDERED DOM, then
// close the tab. The tab IS visible in the tab strip while open; this is a
// fallback, not the primary path. The caller must supply the exact Grades
// URL captured from the logged-in UI — never a guessed URL.
// ---------------------------------------------------------------------------
let pendingScrape = null; // { url, resolve, reject, timer, tabId }

function refreshViaHiddenTab(url, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    if (pendingScrape) {
      reject(new Error('A hidden-tab scrape is already running'));
      return;
    }
    const timer = setTimeout(() => {
      finish(new Error('Hidden-tab scrape timed out'));
    }, timeoutMs);
    const state = { url, resolve, reject, timer, tabId: null };
    pendingScrape = state;
    async function finish(result, isError = false) {
      if (pendingScrape !== state) return;
      pendingScrape = null;
      clearTimeout(timer);
      if (state.tabId !== null) {
        try {
          await browser.tabs.remove(state.tabId);
        } catch {
          // Tab already gone; nothing to do.
        }
      }
      if (isError) reject(result);
      else resolve(result);
    }
    state.finish = finish;
    browser.tabs
      .create({ url, active: false })
      .then((tab) => {
        state.tabId = tab.id;
      })
      .catch((err) => finish(err, true));
  });
}

// Content script reports a scrape from the hidden tab; resolve the waiter.
async function handleGradesScraped(message, sender) {
  const tabId = sender && sender.tab ? sender.tab.id : null;
  const courses = Array.isArray(message.courses) ? message.courses : [];
  // A parent browsing a child's Grades page must not create a bogus
  // "Student" dashboard: only store page scrapes for student accounts or
  // for a hidden-tab fallback scrape this worker asked for.
  const account = await getAccount();
  const expected = pendingScrape && (tabId === null || pendingScrape.tabId === tabId);
  if (!expected && account && account.type === 'parent') return { ok: true, ignored: 'parent-account' };
  const settings = await loadSettings();
  const turnedIn = (await getTurnedIn()) || {};
  const markedDone = (await getMarkedDone()) || {};
  const uid = 'self';
  // A page scrape may cover only ONE course (a course Grades page). Merge it
  // into the stored dashboard by course id instead of replacing it, so the
  // verdict is never computed from a partial course list.
  const existing = ((await getDashboards()) || {})[uid];
  const byId = new Map((existing && Array.isArray(existing.courses) ? existing.courses : []).map((c) => [String(c.id), c]));
  for (const c of courses) byId.set(String(c.id), c);
  const merged = [...byId.values()];
  const summary = summarizeStudent(merged, settings, turnedIn.self, markedDone.self);
  await writeDashboard(uid, {
    ...(existing || {}),
    studentUid: uid,
    studentName: (existing && existing.studentName) || 'Student',
    pictureUrl: (existing && existing.pictureUrl) || null,
    courses: merged,
    summary,
    source: existing ? existing.source : 'page-scrape',
  });
  if (pendingScrape && (tabId === null || pendingScrape.tabId === tabId)) {
    pendingScrape.finish({ ok: true, via: 'hidden-tab', courses: courses.length });
  }
  return { ok: true };
}

// --- Top-level listeners only ------------------------------------------------

browser.runtime.onInstalled.addListener(async () => {
  await browser.alarms.create(ALARM_NAME, { periodInMinutes: REFRESH_PERIOD_MINUTES });
  // Save the stored settings with any new defaults filled in (never the
  // effective, per-account values: those are worked out on each read).
  await setSettings({ ...DEFAULT_SETTINGS, schoologyBase: 'https://app.schoology.com', ...((await getSettings()) || {}) });
});

browser.runtime.onStartup.addListener(async () => {
  await browser.alarms.create(ALARM_NAME, { periodInMinutes: REFRESH_PERIOD_MINUTES });
});

browser.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  try {
    // A parent refresh switches Schoology's "viewing as" child. Don't do
    // that underneath someone who is using Schoology right now; the next
    // alarm (or the popup's Refresh button) catches up.
    const account = await getAccount();
    if (account && account.type === 'parent') {
      const active = await browser.tabs.query({ active: true, url: 'https://*.schoology.com/*' });
      if (active.length > 0) return;
    }
    await startRefresh('alarm');
  } catch (e) {
    // Alarm refresh is best-effort; the popup shows the stale warning.
    console.warn('Schoology Dashboard refresh failed:', e);
  }
});

// "Email the teacher" on a Missing item: read the class's course page
// (read-only GET) for Schoology's "Message Admins" link, the compose form
// addressed to the class's teachers. Returns { ok, url, parentName }.
// Each class's admin list (storage key `classAdmins`: { [courseId]:
// { uids, at } }), kept a month, for guessing which admin teaches a class.
const ADMINS_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

async function fetchCoursePage(base, isParent, uid, courseId) {
  const res = await fetch(base + coursePagePath({ isParent, childUid: uid, courseId }), { credentials: 'include' });
  if (!res.ok) throw new Error(`Schoology answered ${res.status}`);
  return res.text();
}

// How many of the family's classes list each admin: { [adminUid]: n }.
// Reads course pages not seen in the past month (a few at a time).
async function adminClassCounts(base, isParent, known) {
  const now = Date.now();
  const cache = { ...((await storageGet('classAdmins', {})) || {}), ...known };
  const dashboards = (await getDashboards()) || {};
  const todo = [];
  const current = new Set();
  for (const [uid, d] of Object.entries(dashboards)) {
    for (const c of (d && d.courses) || []) {
      if (c.id === undefined || c.id === null) continue;
      const id = String(c.id);
      current.add(id);
      const hit = cache[id];
      if (!hit || !(now - Date.parse(hit.at) < ADMINS_KEEP_MS)) todo.push({ uid, id });
    }
  }
  const queue = [...todo];
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      try {
        const html = await fetchCoursePage(base, isParent, job.uid, job.id);
        cache[job.id] = { uids: findCourseAdmins(html).map((a) => a.uid), at: new Date().toISOString() };
      } catch {
        // Skip this class; the guess just has less to go on.
      }
    }
  }));
  for (const id of Object.keys(cache)) if (!current.has(id)) delete cache[id];
  await storageSet('classAdmins', cache);
  const counts = {};
  for (const id of current) for (const a of (cache[id] && cache[id].uids) || []) counts[a] = (counts[a] || 0) + 1;
  return counts;
}

// The compose link for a class plus its admins, for the parent's "Email
// the teacher": { ok, url, admins: [{ uid, name }], likely, parentName }.
async function teacherComposeUrl({ uid, courseId }) {
  if (!courseId) return { ok: false, error: 'No class' };
  try {
    const settings = await loadSettings();
    const account = (await getAccount()) || {};
    const isParent = account.type === 'parent';
    const base = settings.schoologyBase.replace(/\/$/, '');
    const html = await fetchCoursePage(base, isParent, uid, courseId);
    const href = findComposeHref(html);
    if (!href) return { ok: false, error: 'No teacher to message for this class' };
    const admins = findCourseAdmins(html);
    let likely = admins.length === 1 ? admins[0].uid : null;
    if (admins.length > 1) {
      const counts = await adminClassCounts(base, isParent, {
        [String(courseId)]: { uids: admins.map((a) => a.uid), at: new Date().toISOString() },
      });
      likely = likelyTeacher(admins, counts);
    }
    return { ok: true, url: new URL(href, base + '/').href, admins, likely, parentName: isParent ? findParentName(html) : '' };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

browser.runtime.onMessage.addListener(async (message, sender) => {
  if (!message || typeof message.type !== 'string') return undefined;
  switch (message.type) {
    case 'refresh-now': {
      return startRefresh('manual');
    }
    case 'schoology-page-loaded': {
      return maybeAutoRefresh(message.url || (sender && sender.tab && sender.tab.url) || '');
    }
    case 'run-live-probe': {
      const settings = await loadSettings();
      const client = createClient({ baseUrl: settings.schoologyBase });
      const evidence = await client.runLiveProbe(message.url, {
        assignmentTitle: message.assignmentTitle || null,
      });
      await setLiveTest({ ...evidence, gradesUrl: message.url });
      return evidence;
    }
    case 'open-options': {
      // From the in-page panel: content scripts cannot open the options page.
      await browser.runtime.openOptionsPage();
      return { ok: true };
    }
    case 'get-dashboards': {
      return { dashboards: (await getDashboards()) || {}, settings: await loadSettings() };
    }
    case 'grades-scraped': {
      return handleGradesScraped(message, sender);
    }
    case 'grades-page-url': {
      // Probe URL capture: remember the exact Grades URL the user visited.
      const settings = (await getSettings()) || {};
      if (message.url && message.url !== settings.lastGradesUrl) {
        await setSettings({ ...settings, lastGradesUrl: message.url });
      }
      return { ok: true };
    }
    case 'teacher-compose-url': {
      return teacherComposeUrl(message);
    }
    case 'refresh-via-hidden-tab': {
      if (!message.url) return { ok: false, error: 'No Grades URL supplied' };
      try {
        return await refreshViaHiddenTab(message.url);
      } catch (e) {
        return { ok: false, error: String(e && e.message ? e.message : e) };
      }
    }
    default:
      return undefined;
  }
});

// Re-exported for the build's sake (keeps the parser import used in this
// module's dependency graph explicit for bundlers that tree-shake).
export { parseGradesHtml };
