// school-access.js — letting the extension work on a school's own Schoology
// address (see src/sites.js). Used by the popup ("Use Grades Dashboard
// here") and Settings ("Your school's Schoology address").
//
// The family allows one address at a time. That is an optional host
// permission (manifest optional_host_permissions "https://*/*"), asked for
// from a click; background.js then registers the content script there and
// reloads the school's open tabs. Removing it takes the permission away.
//
// The Safari build has no optional permission (WebKit bug 290508), so
// canAddSchools() is false there and the UI says so instead.

import {
  addedSchoolHosts,
  isKnownSchoolHost,
  isSchoologySite,
  originPattern,
  schoolScriptId,
  SCHOOL_SCRIPT_PREFIX,
  SCHOOLOGY_FINGERPRINT,
} from './sites.js';

// Can this build ask for a school's own address?
export function canAddSchools(browser) {
  try {
    const optional = browser.runtime.getManifest().optional_host_permissions || [];
    return optional.includes('https://*/*') && Boolean(browser.permissions && browser.permissions.request);
  } catch {
    return false;
  }
}

// Ask for one school address. Call it straight from the click handler,
// before any other await: browsers only show the prompt for a user gesture.
// Resolves true if the family allowed it.
export function requestSchool(browser, origin) {
  return browser.permissions.request({ origins: [originPattern(origin)] });
}

// The school addresses the family allowed (host names, sorted).
export async function addedSchools(browser) {
  try {
    return addedSchoolHosts(((await browser.permissions.getAll()) || {}).origins || []).sort();
  } catch {
    return [];
  }
}

export function removeSchool(browser, host) {
  return browser.permissions.remove({ origins: [originPattern(`https://${host}`)] });
}

// The offer for the tab the popup was opened on: null, or
// { origin, host, known } when the tab is an https page outside the sites
// the extension already covers that is on the list of schools' own
// Schoology addresses or carries a Schoology fingerprint. Opening the popup
// gives the extension the current tab (activeTab), which is what lets it
// look at the page.
export async function schoolOfferForTab(browser, tab) {
  if (!tab || !tab.url || !canAddSchools(browser)) return null;
  let u;
  try {
    u = new URL(tab.url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  if (isSchoologySite(u.href, await addedSchools(browser))) return null;
  const known = isKnownSchoolHost(host);
  if (!known) {
    try {
      const [result] = await browser.scripting.executeScript({
        target: { tabId: tab.id },
        func: (selector) => Boolean(document.querySelector(selector)),
        args: [SCHOOLOGY_FINGERPRINT],
      });
      if (!result || result.result !== true) return null;
    } catch {
      return null; // a page the extension can't look at (browser pages, the store)
    }
  }
  return { origin: u.origin, host, known };
}

// background.js: register the content script on every allowed school
// address and drop it from any address no longer allowed (the granted
// permissions are the record, however access was given or taken away).
// Returns the hosts newly registered.
export async function syncSchoolScripts(browser) {
  if (!browser.scripting || !browser.scripting.registerContentScripts) return [];
  const hosts = await addedSchools(browser);
  const registered = (await browser.scripting.getRegisteredContentScripts())
    .filter((s) => s.id.startsWith(SCHOOL_SCRIPT_PREFIX));
  const have = new Set(registered.map((s) => s.id));
  const want = new Set(hosts.map(schoolScriptId));
  const stale = [...have].filter((id) => !want.has(id));
  if (stale.length) await browser.scripting.unregisterContentScripts({ ids: stale });
  const added = hosts.filter((h) => !have.has(schoolScriptId(h)));
  if (added.length) {
    await browser.scripting.registerContentScripts(added.map((host) => ({
      id: schoolScriptId(host),
      matches: [originPattern(`https://${host}`)],
      js: ['content.js'],
      runAt: 'document_idle',
      persistAcrossSessions: true,
    })));
  }
  return added;
}
