// demo-mode.js — demo mode: made-up students in place of Schoology.
//
// Offered only when nothing is saved (Settings → Privacy & data → Show demo
// data). It loads the made-up family (popup/demo-data.json) for every
// Schoology site the extension knows, and sets `demoMode`. While it is set,
// the background reads nothing from Schoology (background.js): no
// refreshes, no reading the page's signed-in person, no scraping. Every
// dashboard shows one centered "Exit demo mode"
// link. Exiting clears everything saved, back to the empty state demo mode
// started from, and the next Schoology page reads the real grades again.

import { setDashboards, storageGet, storageSet } from './storage.js';
import { REAL_SCHOOLOGY, SCHOOL_HOSTS } from './sites.js';
import { DEFAULT_SETTINGS } from './rules.js';

// The mock Schoology server (dev builds; same as dashboard-view.js).
const MOCK_SCHOOLOGY = 'http://localhost:8123';

export const DEMO_KEY = 'demoMode';

// Due dates in the demo data are anchored on this day; loading shifts them
// so "today" and "tomorrow" line up with the day the demo is loaded.
const DEMO_ANCHOR = new Date('2026-11-06T00:00:00');

export async function isDemoMode() {
  return Boolean(await storageGet(DEMO_KEY, false, null));
}

// The made-up family, with dates shifted to today.
export async function demoDashboards(browser) {
  const res = await fetch(browser.runtime.getURL('popup/demo-data.json'));
  const data = await res.json();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const shiftMs = todayStart.getTime() - DEMO_ANCHOR.getTime();
  const dashboards = data.dashboards || {};
  for (const d of Object.values(dashboards)) {
    for (const c of d.courses || []) {
      for (const p of c.periods || []) {
        if (p.start) p.start = new Date(new Date(p.start).getTime() + shiftMs).toISOString();
        if (p.end) p.end = new Date(new Date(p.end).getTime() + shiftMs).toISOString();
      }
      for (const a of c.assignments || []) {
        if (a.due) {
          const shifted = new Date(new Date(a.due).getTime() + shiftMs);
          a.due = shifted.toISOString();
          a.dueText = shifted.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        }
      }
    }
    d.updatedAt = new Date().toISOString();
  }
  return dashboards;
}

// Load the demo data for one site (the dashboard page's own button).
export async function loadDemo(browser, site) {
  const dashboards = await demoDashboards(browser);
  if (site === undefined) await setDashboards(dashboards);
  else await setDashboards(dashboards, site);
}

// The Schoology sites demo mode fills: real Schoology and the schools'
// own addresses in the manifest (and the mock server in dev builds).
export function demoSites({ dev = false } = {}) {
  return [REAL_SCHOOLOGY, ...SCHOOL_HOSTS.map((h) => `https://${h}`), ...(dev ? [MOCK_SCHOOLOGY] : [])];
}

// Turn demo mode on: the flag first, so nothing reads Schoology while the
// demo data is written.
export async function enterDemoMode(browser, { dev = false } = {}) {
  await storageSet(DEMO_KEY, true, null);
  // Also the site picked in Settings (the dev builds' mock server, say).
  const picked = ((await storageGet('settings', null, null)) || {}).schoologyBase;
  const sites = demoSites({ dev });
  if (picked && !sites.includes(picked)) sites.push(picked);
  for (const site of sites) {
    // Fresh copies per site: setDashboards keeps a log and records per site.
    await setDashboards(await demoDashboards(browser), site);
  }
}

// Turn demo mode off: clear everything (demo mode only starts from nothing
// saved), so the next Schoology page reads the real grades.
export async function exitDemoMode(browser) {
  await browser.storage.local.clear();
}

// Nothing saved yet (or everything cleared): no keys at all, or only the
// default settings the extension writes when it is installed, and where
// the in-page panel is docked. Clear data is greyed out then, and Show demo
// data is offered.
const HARMLESS = new Set(['panelOpen']);
export async function hasNoSavedData(browser) {
  const all = await browser.storage.local.get(null);
  for (const [key, value] of Object.entries(all || {})) {
    if (HARMLESS.has(key)) continue;
    if (key === 'settings' && isDefaultSettings(value)) continue;
    return false;
  }
  return true;
}

function isDefaultSettings(s) {
  if (!s || typeof s !== 'object') return true;
  // Which Schoology site is picked isn't something to clear.
  return Object.entries(s).every(([k, v]) => k === 'schoologyBase' || JSON.stringify(v) === JSON.stringify(DEFAULT_SETTINGS[k]));
}
