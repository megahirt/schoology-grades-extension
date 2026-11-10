// background.js — MV3 service worker (Safari-first, Chrome second).
// Top-level listeners only. Never holds grades in globals —
// browser.storage.local is the source of truth (the worker terminates
// after ~30s idle). Delegates fetching to schoology.js and parsing to
// parser.js. Uses browser.* (webextension-polyfill) Promise APIs everywhere.
//
// PER SITE (see storage.js): every account's data is stored per Schoology
// site, and every function here that reads or writes it takes the site
// (an origin such as "https://app.schoology.com") explicitly. A request
// that names no site is about the last one used (settings.schoologyBase).

import browser from 'webextension-polyfill';
import { createClient } from './src/schoology.js';
import {
  REAL_SCHOOLOGY,
  siteForPage,
  isSchoologySite,
  addedSchoolHosts,
  originPattern,
} from './src/sites.js';
import { parseGradesHtml } from './src/parser.js';
import { syncSchoolScripts } from './src/school-access.js';
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
  getSites,
  getUser,
  setUser,
  scopeOf,
  originOf,
} from './src/storage.js';

const ALARM_NAME = 'refresh-grades';
const REFRESH_PERIOD_MINUTES = 60;

// The site a request is about: the one named, or the last one used.
async function siteOf(site) {
  try {
    if (site) return new URL(site).origin;
  } catch {
    // fall through to the last one used
  }
  const stored = (await getSettings()) || {};
  try {
    return new URL(stored.schoologyBase || REAL_SCHOOLOGY).origin;
  } catch {
    return REAL_SCHOOLOGY;
  }
}

// The family's settings as they apply to that site's account, with
// schoologyBase set to the site.
async function loadSettings(site) {
  const stored = (await getSettings()) || {};
  const settings = effectiveSettings(stored, { isStudent: isStudentAccount(await getAccount(site), await getDashboards(site)) });
  return { ...settings, schoologyBase: originOf(site) || site };
}

async function writeDashboard(uid, dashboard, site) {
  const dashboards = (await getDashboards(site)) || {};
  dashboards[uid] = { ...dashboard, updatedAt: new Date().toISOString() };
  await setDashboards(dashboards, site);
  return dashboards;
}

// Full refresh of one site: detect account, fetch dashboards, parse,
// summarize, store. progress({ done, total, label }) reports steps for the
// UI (see startRefresh).
//
// Who is signed in is checked FIRST: each person's data is kept apart
// (storage.js, PER SITE AND PER USER), so when someone else has signed in
// the site switches to their data before anything is read or written, and
// every write below is pinned to that person (`scope`), even if someone
// signs in as another person while this refresh runs. Signed out: the last
// person's data stays, marked signedOut (the dashboard shows it as old).
async function refreshGrades(site, progress = () => {}) {
  progress({ done: 0, total: 1, label: 'Checking your Schoology account' });
  const client = createClient({ baseUrl: site });
  const started = JSON.stringify((await getUser(site)) || null);
  const account = await client.detectAccount();
  const before = await getUser(site);
  const now = new Date().toISOString();
  if (account.type === 'loggedOut') {
    // A page reported who is signed in while this check ran: it knows better.
    if (JSON.stringify(before || null) === started) {
      await setUser({ ...(before || { uid: null, name: null }), signedOut: true, checkedAt: now }, site);
    }
    return { ok: false, accountType: 'loggedOut', error: 'NOT_LOGGED_IN', fallback: 'hidden-tab' };
  }
  // A network or server error says nothing about who is signed in.
  if (account.type !== 'parent' && account.type !== 'student') {
    return { ok: false, accountType: account.type, error: 'SCHOOLOGY_UNAVAILABLE', fallback: 'hidden-tab' };
  }
  const uid = String(account.userUid || (before && before.uid) || '') || null;
  await setUser({ uid, name: account.type === 'student' ? account.studentName : (before && before.uid === uid && before.name) || null, type: account.type, signedOut: false, checkedAt: now }, site);
  const scope = scopeOf(site, uid);
  await setAccount({ ...account, detectedAt: now }, scope);
  const settings = await loadSettings(scope);
  const turnedIn = (await getTurnedIn(scope)) || {};
  const markedDone = (await getMarkedDone(scope)) || {};

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
    if (Object.keys(byUid).length > 0) await setDashboards(byUid, scope);
    return { ok: true, accountType: 'parent', students: Object.keys(byUid) };
  }

  // A student account.
  {
    progress({ done: 1, total: 2, label: 'Reading your grades' });
    const result = await client.fetchStudentDashboard({ turnedInIds: turnedIn.self });
    if (result.error === 'LOGGED_OUT') {
      // Signed out between the account check and the grades page.
      await setUser({ ...((await getUser(site)) || { uid, name: null }), signedOut: true, checkedAt: new Date().toISOString() }, site);
      return { ok: false, accountType: 'student', error: 'LOGGED_OUT', fallback: 'hidden-tab' };
    }
    if (result.error === 'PARSE_EMPTY' || result.error === 'NO_GRADES') {
      return { ok: false, accountType: 'student', error: result.error, fallback: 'hidden-tab' };
    }
    const summary = summarizeStudent(result.courses, settings, turnedIn.self, markedDone.self);
    const self = account.children?.[0]?.uid || 'self';
    const name = result.studentName || account.studentName || 'Student';
    // A student account has one dashboard.
    await setDashboards({ [self]: {
      updatedAt: new Date().toISOString(),
      studentUid: self,
      studentName: name,
      pictureUrl: account.children?.[0]?.pictureUrl || account.pictureUrl || null,
      courses: result.courses,
      summary,
      source: result.source,
      parseWarnings: result.parseWarnings || [],
      error: result.error || null,
    } }, scope);
    return { ok: true, accountType: 'student', students: [self] };
  }
}

// ---------------------------------------------------------------------------
// ONE REFRESH AT A TIME PER SITE, WITH PROGRESS
// Every refresh (Refresh button, Schoology page load, alarm) goes through
// startRefresh. A second request for the same site while one is running
// joins it instead of starting another. Progress lives in that site's
// `refreshState`
//   { running, startedAt, done, total, label, finishedAt?, ok?, error? }
// so every open popup and panel shows the same banner and progress bar.
// ---------------------------------------------------------------------------
const running = new Map(); // site -> refresh promise
const REFRESH_TIMEOUT_MS = 2 * 60 * 1000;
// Auto-refresh on a Schoology page load only when the data is older than this.
// Each click in Schoology loads a new page, and a parent refresh briefly
// switches Schoology's "viewing as" child, so it must not run on every click.
const AUTO_REFRESH_MIN_AGE_MS = 5 * 60 * 1000;

async function setRefreshState(state, site) {
  await storageSet('refreshState', state, site);
}

// again: someone else signed in while a refresh runs. That refresh may have
// checked the account before the switch, so run another one after it.
function startRefresh(reason, site, { again = false } = {}) {
  if (running.has(site)) {
    const current = running.get(site);
    return again ? current.then(() => startRefresh(reason, site), () => startRefresh(reason, site)) : current;
  }
  const startedAt = new Date().toISOString();
  let last = { done: 0, total: 1, label: 'Starting' };
  const progress = (p) => {
    last = { done: Math.min(p.done, p.total), total: Math.max(1, p.total), label: p.label || last.label };
    setRefreshState({ running: true, reason, startedAt, ...last }, site).catch(() => {});
  };
  const refresh = (async () => {
    await setRefreshState({ running: true, reason, startedAt, ...last }, site);
    let result;
    let timer;
    try {
      // A refresh that never settles (a Schoology request that hangs) must not
      // block every later refresh: give up after REFRESH_TIMEOUT_MS.
      result = await Promise.race([
        refreshGrades(site, progress),
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
    }, site);
    return result;
  })().finally(() => {
    running.delete(site);
  });
  running.set(site, refresh);
  return refresh;
}

// A Schoology page finished loading in a tab (content script). Refresh that
// page's site when its data is missing or older than AUTO_REFRESH_MIN_AGE_MS.
// Each site keeps its own account and data, so a parent on
// app.schoology.com and a student on the school's own address can use the
// same browser. Pages on another listed Schoology site also become the
// "last used" site (what the popup shows on a non-Schoology tab), unless a
// dev build is pointed at the mock server.
async function maybeAutoRefresh(pageUrl) {
  const stored = (await getSettings()) || {};
  const base = await siteOf(null);
  const where = siteForPage(pageUrl, base, await addedHosts());
  if (where === 'ignore') return { started: false, reason: 'other site' };
  // The sign-in page: nothing to read (content.js marks the site signed out).
  if (/\/login(\b|\?|#|$)/i.test(new URL(pageUrl).pathname)) return { started: false, reason: 'sign-in page' };
  const site = new URL(pageUrl).origin;
  if (running.has(site)) return { started: false, reason: 'already running' };
  // The last-used site follows real Schoology pages (a dev build pointed at
  // the mock server stays there).
  if (where === 'other' && isSchoologySite(base, await addedHosts())) await setSettings({ ...stored, schoologyBase: site });
  const dashboards = (await getDashboards(site)) || {};
  let newest = 0;
  for (const d of Object.values(dashboards)) {
    const t = Date.parse(d.updatedAt || '');
    if (t > newest) newest = t;
  }
  if (newest && Date.now() - newest < AUTO_REFRESH_MIN_AGE_MS) return { started: false, reason: 'fresh' };
  startRefresh('page-load', site);
  return { started: true };
}

// A Schoology page says who is signed in on it (content.js, before it shows
// the panel): { uid } from the page's own settings, or { signedOut } on the
// sign-in page. Someone else signed in (or the same person back after
// signing out): switch the site to their data now, so the panel never shows
// one person's data on another person's page, and refresh it. On the
// sign-in page, mark the site signed out: the last person's data stays
// visible, shown as old.
async function handlePageUser(message, sender) {
  const url = message.url || (sender && sender.tab && sender.tab.url) || '';
  const site = originOf(url);
  if (!site) return { ok: false };
  if (site !== (await siteOf(null)) && !isSchoologySite(url, await addedHosts())) return { ok: false, ignored: 'other site' };
  const before = await getUser(site);
  const now = new Date().toISOString();
  if (message.signedOut) {
    if (!before || !before.signedOut) await setUser({ ...(before || { uid: null, name: null }), signedOut: true, checkedAt: now }, site);
    return { ok: true, signedOut: true };
  }
  const uid = message.uid ? String(message.uid) : null;
  if (!uid) return { ok: true };
  if (before && before.uid === uid && !before.signedOut) return { ok: true };
  const same = before && before.uid === uid;
  await setUser({ uid, name: same ? before.name : null, type: same ? before.type : null, signedOut: false, checkedAt: now }, site);
  // A refresh already running checks who is signed in first, so it only has
  // to run again when it may have started for someone else (a different
  // person was known here before), not on the first visit to a site.
  const someoneElse = Boolean(before && before.uid && before.uid !== uid);
  startRefresh('signed-in', site, { again: someoneElse });
  return { ok: true, changed: true };
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
  const site = await siteOf(message.url || (sender && sender.tab && sender.tab.url));
  // A parent browsing a child's Grades page must not create a bogus
  // "Student" dashboard: only store page scrapes for student accounts or
  // for a hidden-tab fallback scrape this worker asked for.
  const account = await getAccount(site);
  const expected = pendingScrape && (tabId === null || pendingScrape.tabId === tabId);
  if (!expected && account && account.type === 'parent') return { ok: true, ignored: 'parent-account' };
  const settings = await loadSettings(site);
  const turnedIn = (await getTurnedIn(site)) || {};
  const markedDone = (await getMarkedDone(site)) || {};
  const uid = 'self';
  // A page scrape may cover only ONE course (a course Grades page). Merge it
  // into the stored dashboard by course id instead of replacing it, so the
  // verdict is never computed from a partial course list.
  const existing = ((await getDashboards(site)) || {})[uid];
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
  }, site);
  if (pendingScrape && (tabId === null || pendingScrape.tabId === tabId)) {
    pendingScrape.finish({ ok: true, via: 'hidden-tab', courses: courses.length });
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// SCHOOLS' OWN ADDRESSES (see src/sites.js). The manifest covers
// *.schoology.com and SCHOOL_HOSTS. For any other school, the family allows
// that one address (popup or Settings: permissions.request, an optional host
// permission). The granted permissions are the record: this keeps a content
// script registered for exactly those addresses, however access was given or
// taken away (our UI, or the browser's own site-access settings).
// ---------------------------------------------------------------------------

// The school addresses the family allowed (host names).
async function addedHosts() {
  try {
    return addedSchoolHosts(((await browser.permissions.getAll()) || {}).origins || []);
  } catch {
    return [];
  }
}

// Whether the extension may read a site now (the family can remove a school
// address, or, on Chrome, limit any site to "on click").
async function hasSiteAccess(site) {
  try {
    return await browser.permissions.contains({ origins: [originPattern(new URL(site).origin)] });
  } catch {
    return true; // no permissions API to ask: let the fetch decide
  }
}

// A school address was just allowed: register the content script, then
// reload its open tabs so the dashboard appears there right away.
browser.permissions.onAdded.addListener(async () => {
  try {
    const added = await syncSchoolScripts(browser);
    for (const host of added) {
      for (const tab of await browser.tabs.query({ url: originPattern(`https://${host}`) })) {
        browser.tabs.reload(tab.id).catch(() => {});
      }
    }
  } catch (e) {
    console.warn('Grades Dashboard: could not set up the school address:', e);
  }
});

browser.permissions.onRemoved.addListener(() => {
  syncSchoolScripts(browser).catch((e) => console.warn('Grades Dashboard: could not remove the school address:', e));
});

// --- Top-level listeners only ------------------------------------------------

browser.runtime.onInstalled.addListener(async () => {
  await browser.alarms.create(ALARM_NAME, { periodInMinutes: REFRESH_PERIOD_MINUTES });
  await syncSchoolScripts(browser).catch(() => {});
  // Save the stored settings with any new defaults filled in (never the
  // effective, per-account values: those are worked out on each read).
  await setSettings({ ...DEFAULT_SETTINGS, schoologyBase: REAL_SCHOOLOGY, ...((await getSettings()) || {}) });
});

browser.runtime.onStartup.addListener(async () => {
  await browser.alarms.create(ALARM_NAME, { periodInMinutes: REFRESH_PERIOD_MINUTES });
  await syncSchoolScripts(browser).catch(() => {});
});

browser.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  try {
    // Every site that has data, one after another. A parent refresh
    // switches Schoology's "viewing as" child: don't do that underneath
    // someone using that site right now; the next alarm catches up.
    const sites = (await getSites()) || [];
    for (const site of sites.length ? sites : [await siteOf(null)]) {
      // A school address the family has since removed: leave it alone.
      if (!(await hasSiteAccess(site))) continue;
      const account = await getAccount(site);
      if (account && account.type === 'parent') {
        const active = await browser.tabs.query({ active: true, url: `${site}/*` });
        if (active.length > 0) continue;
      }
      await startRefresh('alarm', site);
    }
  } catch (e) {
    // Alarm refresh is best-effort; the popup shows the stale warning.
    console.warn('Grades Dashboard refresh failed:', e);
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
  const cache = { ...((await storageGet('classAdmins', {}, base)) || {}), ...known };
  const dashboards = (await getDashboards(base)) || {};
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
  await storageSet('classAdmins', cache, base);
  const counts = {};
  for (const id of current) for (const a of (cache[id] && cache[id].uids) || []) counts[a] = (counts[a] || 0) + 1;
  return counts;
}

// The compose link for a class plus its admins, for the parent's "Email
// the teacher": { ok, url, admins: [{ uid, name }], likely, parentName }.
async function teacherComposeUrl({ uid, courseId, site }) {
  if (!courseId) return { ok: false, error: 'No class' };
  try {
    const base = await siteOf(site);
    const account = (await getAccount(base)) || {};
    const isParent = account.type === 'parent';
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
      return startRefresh('manual', await siteOf(message.site));
    }
    case 'page-user': {
      return handlePageUser(message, sender);
    }
    case 'schoology-page-loaded': {
      return maybeAutoRefresh(message.url || (sender && sender.tab && sender.tab.url) || '');
    }
    case 'run-live-probe': {
      const client = createClient({ baseUrl: await siteOf(message.url || message.site) });
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
      const site = await siteOf(message.site);
      return { dashboards: (await getDashboards(site)) || {}, settings: await loadSettings(site) };
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
