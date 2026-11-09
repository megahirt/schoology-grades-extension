// storage.js — thin wrappers over browser.storage.local.
//
// The webextension-polyfill is imported by the entry points
// (background.js, content.js, popup.js, options.js); importing it sets the
// global `browser` namespace. This module reads that global instead of
// statically importing the polyfill itself, because the polyfill throws at
// import time in Node ("This script should only be loaded in a browser
// extension") — a static import here would make this module unimportable by
// unit tests. In the extension the global IS the polyfill's browser.*
// namespace (Promise-based APIs); in Node, or whenever browser.storage is
// unavailable, an in-memory store is used instead so tests can import this
// module and exercise the same get/set surface.
//
// Storage keys (SPEC.md): settings, dashboards, liveTest, account, records,
// dailyLog.
// Extra key: turnedIn — { [studentUid]: [assignmentId, ...] } for items
// manually marked as turned in.
//
// PER SITE: one browser can be signed in to different Schoology accounts on
// different sites (NPC: the parent on app.schoology.com, a student on
// schoology.npchristian.org). Everything about an account (SITE_KEYS) is
// kept per site, stored as "<key>@<origin>"; settings (family rules,
// display) and the panel's open state are shared. Each page picks its site
// once with setSite() (the content script: its own origin; the popup and
// options: the active tab's site or the last one used); the background
// passes the site explicitly, since it serves every site at once. With no
// site set (unit tests) keys are used as they are. `sites` lists the sites
// that have data, for the popup's site switch.

import { mergeAllRecords } from './rewards.js';
import { mergeDailyLog } from './daily-log.js';
import { effectiveSettings, isStudentAccount } from './rules.js';

const memoryStore = new Map();

function hasBrowserStorage() {
  try {
    return (
      typeof globalThis !== 'undefined' &&
      globalThis.browser &&
      globalThis.browser.storage &&
      globalThis.browser.storage.local &&
      typeof globalThis.browser.storage.local.get === 'function'
    );
  } catch {
    return false;
  }
}

// Keys that belong to one Schoology site (see PER SITE above).
export const SITE_KEYS = ['dashboards', 'account', 'records', 'dailyLog', 'turnedIn', 'markedDone', 'refreshState', 'classAdmins', 'classTeacher', 'dashboardChild'];

let currentSite = null;
// setSite(origin): the Schoology site this page shows ("https://app.schoology.com").
export function setSite(origin) {
  let o = null;
  try {
    o = origin ? new URL(origin).origin : null;
  } catch {
    o = null;
  }
  currentSite = o;
}
export const getSite = () => currentSite;
// siteKey('dashboards') -> "dashboards@https://app.schoology.com" (for
// storage.onChanged checks); shared keys come back as they are.
export function siteKey(key, site = currentSite) {
  return site && SITE_KEYS.includes(key) ? `${key}@${site}` : key;
}

export async function storageGet(key, fallback = undefined, site = currentSite) {
  const k = siteKey(key, site);
  if (hasBrowserStorage()) {
    const result = await globalThis.browser.storage.local.get(k);
    if (result && Object.prototype.hasOwnProperty.call(result, k)) return result[k];
    return fallback;
  }
  return memoryStore.has(k) ? memoryStore.get(k) : fallback;
}

export async function storageSet(key, value, site = currentSite) {
  const k = siteKey(key, site);
  if (hasBrowserStorage()) {
    await globalThis.browser.storage.local.set({ [k]: value });
    return;
  }
  memoryStore.set(k, value);
}

export async function storageRemove(key, site = currentSite) {
  const k = siteKey(key, site);
  if (hasBrowserStorage()) {
    await globalThis.browser.storage.local.remove(k);
    return;
  }
  memoryStore.delete(k);
}

// Test helper: clear the in-memory fallback store.
export function __clearMemoryStore() {
  memoryStore.clear();
}

export const getSettings = () => storageGet('settings', null);
export const setSettings = (v) => storageSet('settings', v);
export const getSites = () => storageGet('sites', []);
export const getDashboards = (site = currentSite) => storageGet('dashboards', {}, site);
// Saving dashboards also updates each child's records (personal bests that
// only go up; see rewards.js) and today's entry in the daily log
// (daily-log.js), for the same site, and adds the site to `sites`.
export async function setDashboards(v, site = currentSite) {
  await storageSet('dashboards', v, site);
  if (v && Object.keys(v).length) {
    if (site) {
      const sites = (await storageGet('sites', [])) || [];
      if (!sites.includes(site)) await storageSet('sites', [...sites, site]);
    }
    const settings = effectiveSettings(await storageGet('settings', null), { isStudent: isStudentAccount(await storageGet('account', null, site), v) });
    const log = mergeDailyLog(await storageGet('dailyLog', {}, site), v, {
      settings,
      turnedIn: (await storageGet('turnedIn', {}, site)) || {},
      done: (await storageGet('markedDone', {}, site)) || {},
    });
    await storageSet('dailyLog', log, site);
    const records = mergeAllRecords(await storageGet('records', {}, site), v, Date.now(), log);
    await storageSet('records', records, site);
  }
}
export const getDailyLog = (site = currentSite) => storageGet('dailyLog', {}, site);
export const getRecords = (site = currentSite) => storageGet('records', {}, site);
export const getLiveTest = () => storageGet('liveTest', null);
export const setLiveTest = (v) => storageSet('liveTest', v);
export const getAccount = (site = currentSite) => storageGet('account', null, site);
export const setAccount = (v, site = currentSite) => storageSet('account', v, site);
export const getTurnedIn = (site = currentSite) => storageGet('turnedIn', {}, site);
export const setTurnedIn = (v, site = currentSite) => storageSet('turnedIn', v, site);
// markedDone — { [studentUid]: [assignmentId, ...] } for not-yet-graded items
// (usually Due soon) marked done. See summarizeStudent in rules.js.
export const getMarkedDone = (site = currentSite) => storageGet('markedDone', {}, site);
export const setMarkedDone = (v, site = currentSite) => storageSet('markedDone', v, site);
