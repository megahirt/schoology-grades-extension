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
// Storage keys (SPEC.md): settings, dashboards, liveTest, account, records.
// Extra key: turnedIn — { [studentUid]: [assignmentId, ...] } for items
// manually marked as turned in.

import { mergeAllRecords } from './rewards.js';

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

export async function storageGet(key, fallback = undefined) {
  if (hasBrowserStorage()) {
    const result = await globalThis.browser.storage.local.get(key);
    if (result && Object.prototype.hasOwnProperty.call(result, key)) return result[key];
    return fallback;
  }
  return memoryStore.has(key) ? memoryStore.get(key) : fallback;
}

export async function storageSet(key, value) {
  if (hasBrowserStorage()) {
    await globalThis.browser.storage.local.set({ [key]: value });
    return;
  }
  memoryStore.set(key, value);
}

export async function storageRemove(key) {
  if (hasBrowserStorage()) {
    await globalThis.browser.storage.local.remove(key);
    return;
  }
  memoryStore.delete(key);
}

// Test helper: clear the in-memory fallback store.
export function __clearMemoryStore() {
  memoryStore.clear();
}

export const getSettings = () => storageGet('settings', null);
export const setSettings = (v) => storageSet('settings', v);
export const getDashboards = () => storageGet('dashboards', {});
// Saving dashboards also updates each child's records (personal bests that
// only go up; see rewards.js).
export async function setDashboards(v) {
  await storageSet('dashboards', v);
  if (v && Object.keys(v).length) {
    const records = mergeAllRecords(await storageGet('records', {}), v);
    await storageSet('records', records);
  }
}
export const getRecords = () => storageGet('records', {});
export const getLiveTest = () => storageGet('liveTest', null);
export const setLiveTest = (v) => storageSet('liveTest', v);
export const getAccount = () => storageGet('account', null);
export const setAccount = (v) => storageSet('account', v);
export const getTurnedIn = () => storageGet('turnedIn', {});
export const setTurnedIn = (v) => storageSet('turnedIn', v);
// markedDone — { [studentUid]: [assignmentId, ...] } for not-yet-graded items
// (usually Due soon) marked done. See summarizeStudent in rules.js.
export const getMarkedDone = () => storageGet('markedDone', {});
export const setMarkedDone = (v) => storageSet('markedDone', v);
