// background.js — MV3 service worker (Safari-first, Chrome second).
// Top-level listeners only. Never holds grades in globals —
// browser.storage.local is the source of truth (the worker terminates
// after ~30s idle). Delegates fetching to schoology.js and parsing to
// parser.js. Uses browser.* (webextension-polyfill) Promise APIs everywhere.

import browser from 'webextension-polyfill';
import { createClient } from './src/schoology.js';
import { parseGradesHtml } from './src/parser.js';
import { summarizeStudent, DEFAULT_SETTINGS } from './src/rules.js';
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
} from './src/storage.js';

const ALARM_NAME = 'refresh-grades';
const REFRESH_PERIOD_MINUTES = 60;

async function loadSettings() {
  const stored = (await getSettings()) || {};
  return { ...DEFAULT_SETTINGS, schoologyBase: 'https://app.schoology.com', ...stored };
}

async function writeDashboard(uid, dashboard) {
  const dashboards = (await getDashboards()) || {};
  dashboards[uid] = { ...dashboard, updatedAt: new Date().toISOString() };
  await setDashboards(dashboards);
  return dashboards;
}

// Full refresh: detect account, fetch dashboards, parse, summarize, store.
async function refreshGrades() {
  const settings = await loadSettings();
  const turnedIn = (await getTurnedIn()) || {};
  const markedDone = (await getMarkedDone()) || {};
  const client = createClient({ baseUrl: settings.schoologyBase });
  const account = await client.detectAccount();
  await setAccount({ ...account, detectedAt: new Date().toISOString() });

  if (account.type === 'parent') {
    const dashboards = await client.fetchParentDashboards({ turnedInIdsByStudent: turnedIn });
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
  const settings = await loadSettings();
  await setSettings(settings);
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
    await refreshGrades();
  } catch (e) {
    // Alarm refresh is best-effort; the popup shows the stale warning.
    console.warn('Schoology Dashboard refresh failed:', e);
  }
});

browser.runtime.onMessage.addListener(async (message, sender) => {
  if (!message || typeof message.type !== 'string') return undefined;
  switch (message.type) {
    case 'refresh-now': {
      try {
        return await refreshGrades();
      } catch (e) {
        return { ok: false, error: String(e && e.message ? e.message : e) };
      }
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
      const settings = await loadSettings();
      if (message.url && message.url !== settings.lastGradesUrl) {
        await setSettings({ ...settings, lastGradesUrl: message.url });
      }
      return { ok: true };
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
