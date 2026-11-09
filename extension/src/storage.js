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
// PER SITE AND PER USER: one browser can be signed in to different
// Schoology accounts on different sites (NPC: the parent on
// app.schoology.com, a student on schoology.npchristian.org), and on one
// site people sign out and in as someone else (two children sharing a
// laptop, two parents). Everything about an account (USER_KEYS) is kept per
// site AND per signed-in user, stored as "<key>@<origin>#<uid>"; a few
// things about the site itself (ORIGIN_KEYS: its refresh progress, and
// `user`, who is signed in there) are stored as "<key>@<origin>". Settings
// (family rules, display) and the panel's open state are shared.
//
// `user@<origin>` = { uid, name, signedOut, checkedAt } says whose data a
// site shows: the person signed in now, or, after signing out, the last
// person (signedOut: true; their old data stays visible with a banner).
// Reads and writes with a site pick that user's keys themselves. The
// background, which must not mix two people's data when someone signs in
// mid-refresh, passes a scope "<origin>#<uid>" instead to pin the user.
//
// Each page picks its site once with setSite() (the content script: its own
// origin; the popup and options: the active tab's site or the last one
// used). With no site set (unit tests) keys are used as they are. `sites`
// lists the sites that have data, for the popup's site switch.

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

// Keys about one person's account on one site, and about the site itself
// (see PER SITE AND PER USER above).
export const USER_KEYS = ['dashboards', 'account', 'records', 'dailyLog', 'turnedIn', 'markedDone', 'classAdmins', 'classTeacher', 'dashboardChild'];
export const ORIGIN_KEYS = ['refreshState', 'user'];
export const SITE_KEYS = [...USER_KEYS, ...ORIGIN_KEYS];

let currentSite = null;
// setSite(origin): the Schoology site this page shows ("https://app.schoology.com").
export function setSite(origin) {
  currentSite = originOf(origin);
}
export const getSite = () => currentSite;

// "https://app.schoology.com/home" or "https://app.schoology.com#123" ->
// "https://app.schoology.com"; null when it isn't a URL.
export function originOf(siteOrScope) {
  try {
    return siteOrScope ? new URL(String(siteOrScope)).origin : null;
  } catch {
    return null;
  }
}
// scopeOf(origin, uid) -> "<origin>#<uid>" (the background pins a user).
export function scopeOf(origin, uid) {
  const o = originOf(origin);
  return o && uid ? `${o}#${uid}` : o;
}
function uidOfScope(scope) {
  const i = String(scope || '').indexOf('#');
  return i >= 0 ? String(scope).slice(i + 1) || null : null;
}

// siteKey('refreshState') -> "refreshState@https://app.schoology.com". A
// user key with a scope -> "dashboards@<origin>#<uid>"; without one, the
// site's key without a user (no one detected yet). Shared keys come back
// as they are. For checking storage.onChanged, use changedFor().
export function siteKey(key, site = currentSite) {
  const o = originOf(site);
  if (!o || !SITE_KEYS.includes(key)) return key;
  const uid = USER_KEYS.includes(key) ? uidOfScope(site) : null;
  return uid ? `${key}@${o}#${uid}` : `${key}@${o}`;
}

// The storage key for a read or write: a user key on a site without a
// pinned user goes to whoever `user@<origin>` says is signed in there.
async function resolveKey(key, site) {
  if (!site || !USER_KEYS.includes(key) || uidOfScope(site)) return siteKey(key, site);
  const user = await rawGet(siteKey('user', site));
  return siteKey(key, user && user.uid ? scopeOf(site, user.uid) : site);
}

// changedFor(changes, keys, site): did a storage.onChanged change touch one
// of these keys for this site (any user's copy, or who is signed in there)?
export function changedFor(changes, keys, site = currentSite) {
  const o = originOf(site);
  return Object.keys(changes || {}).some((k) => {
    if (!o) return keys.includes(k);
    if (k === `user@${o}`) return true;
    const at = k.indexOf('@');
    const name = at >= 0 ? k.slice(0, at) : k;
    if (!keys.includes(name)) return false;
    if (!SITE_KEYS.includes(name)) return at < 0;
    const rest = k.slice(at + 1);
    return rest === o || rest.startsWith(`${o}#`);
  });
}

async function rawGet(k, fallback = undefined) {
  if (hasBrowserStorage()) {
    const result = await globalThis.browser.storage.local.get(k);
    if (result && Object.prototype.hasOwnProperty.call(result, k)) return result[k];
    return fallback;
  }
  return memoryStore.has(k) ? memoryStore.get(k) : fallback;
}

export async function storageGet(key, fallback = undefined, site = currentSite) {
  return rawGet(await resolveKey(key, site), fallback);
}

export async function storageSet(key, value, site = currentSite) {
  const k = await resolveKey(key, site);
  if (hasBrowserStorage()) {
    await globalThis.browser.storage.local.set({ [k]: value });
    return;
  }
  memoryStore.set(k, value);
}

export async function storageRemove(key, site = currentSite) {
  const k = await resolveKey(key, site);
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
    const origin = originOf(site);
    if (origin) {
      const sites = (await storageGet('sites', [])) || [];
      if (!sites.includes(origin)) await storageSet('sites', [...sites, origin]);
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
// Who is signed in on a site (see PER SITE AND PER USER above).
export const getUser = (site = currentSite) => storageGet('user', null, originOf(site));
export const setUser = (v, site = currentSite) => storageSet('user', v, originOf(site));
