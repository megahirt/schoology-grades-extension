// sites.js — the Schoology sites the extension works on (pure, no browser
// APIs). Most schools use app.schoology.com; some put Schoology on their
// own address too (NPC students sign in at schoology.npchristian.org while
// parents use app.schoology.com). The extension follows whichever of these
// sites: each site keeps its own account and data (storage.js, PER SITE),
// so a parent on app.schoology.com and a student on the school's address
// can share one browser. See siteForPage and background.js,
// maybeAutoRefresh.
//
// Three kinds of school site (docs/schoology-domains-research.md):
//   app.schoology.com    always allowed (manifest). Only that address, not
//                        every *.schoology.com: the Chrome Web Store sends a
//                        wildcard host to an in-depth review;
//   SCHOOL_HOSTS         a few schools' own addresses, also in the manifest
//                        (a unit test keeps the two in step). Keep this list
//                        short: on Chrome, each new manifest address turns
//                        the extension off until the family re-approves it;
//   any other school     the family allows their one school's address when
//                        they click "Use Grades Dashboard here" (popup) or
//                        add it in Settings; the browser's optional host
//                        permission is the record of it (addedSchoolHosts),
//                        and background.js registers the content script there.
// KNOWN_SCHOOL_HOSTS (school-hosts.json, from scripts/find-schoology-hosts.mjs)
// lists schools' own addresses found on PowerSchool's certificates. It is not
// a permission: it only lets the popup and Settings recognise and suggest a
// school's address.

import schoolHostList from './school-hosts.json';

export const REAL_SCHOOLOGY = 'https://app.schoology.com';

// Schools' own Schoology addresses in the manifest (exact host names).
export const SCHOOL_HOSTS = ['schoology.npchristian.org'];

// Schools' own Schoology addresses known to point at Schoology.
export const KNOWN_SCHOOL_HOSTS = schoolHostList.hosts;

// Match patterns for the manifest's host_permissions and content script.
export const SCHOOLOGY_MATCHES = [`${REAL_SCHOOLOGY}/*`, ...SCHOOL_HOSTS.map((h) => `https://${h}/*`)];

// isSchoologySite(url, addedHosts) -> true for an https page on one of those
// sites, or on a school address the family allowed (addedHosts).
export function isSchoologySite(url, addedHosts = []) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  return host === 'app.schoology.com' || SCHOOL_HOSTS.includes(host) || addedHosts.includes(host);
}

// isKnownSchoolHost('schoology.example.org') -> on the list of schools' own
// Schoology addresses (or in the manifest).
export function isKnownSchoolHost(host) {
  const h = String(host || '').toLowerCase();
  return SCHOOL_HOSTS.includes(h) || KNOWN_SCHOOL_HOSTS.includes(h);
}

// schoolOrigin(typed) -> "https://host" for what a family typed as their
// school's Schoology address ("schoology.example.org", a pasted link, ...),
// or null if it can't be one: not https, a bare word, an IP address or
// localhost.
export function schoolOrigin(typed) {
  let text = String(typed || '').trim();
  if (!text) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
  let u;
  try {
    u = new URL(text);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.port || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (!/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(host)) return null;
  return `https://${host}`;
}

// The match pattern for one school address ("https://host/*").
export const originPattern = (origin) => `${origin}/*`;

// addedSchoolHosts(origins) -> the school addresses the family allowed, from
// browser.permissions.getAll().origins: exact https hosts outside the
// manifest's list (never a wildcard such as "https://*/*").
export function addedSchoolHosts(origins = []) {
  const out = [];
  for (const pattern of origins) {
    const m = /^https:\/\/([^/*:]+)\/\*$/.exec(String(pattern));
    if (!m) continue;
    const host = m[1].toLowerCase();
    if (host === 'schoology.com' || host.endsWith('.schoology.com') || SCHOOL_HOSTS.includes(host)) continue;
    if (!out.includes(host)) out.push(host);
  }
  return out;
}

// The id of the content script registered for an added school address.
export const SCHOOL_SCRIPT_PREFIX = 'school:';
export const schoolScriptId = (host) => `${SCHOOL_SCRIPT_PREFIX}${host}`;

// What every Schoology page has, on any address (fingerprints in
// docs/schoology-domains-research.md): Schoology's asset CDN, its theme or
// core module files, or its login form.
export const SCHOOLOGY_FINGERPRINT = [
  'link[href*="asset-cdn.schoology.com"]',
  'script[src*="asset-cdn.schoology.com"]',
  'img[src*="asset-cdn.schoology.com"]',
  'link[href*="/sites/all/themes/schoology_theme/"]',
  'script[src*="/sites/all/themes/schoology_theme/"]',
  'script[src*="/sites/all/modules/schoology_core/"]',
  'form#s-user-login-form',
].join(',');

// looksLikeSchoology(document) -> the page carries a Schoology fingerprint.
export function looksLikeSchoology(doc) {
  try {
    return Boolean(doc.querySelector(SCHOOLOGY_FINGERPRINT));
  } catch {
    return false;
  }
}

// siteForPage(pageUrl, base) -> what a loaded page means, given the site
// used last (`base`):
//   'same'   the page is on that site (this covers the dev mock server);
//   'other'  a page on another Schoology site (each site keeps its own
//            account and data, so it is refreshed on its own);
//   'ignore' anything else: a login page (not signed in there yet) or a
//            page that isn't Schoology.
// addedHosts: school addresses the family allowed (addedSchoolHosts).
export function siteForPage(pageUrl, base, addedHosts = []) {
  let page;
  try {
    page = new URL(pageUrl);
  } catch {
    return 'ignore';
  }
  let current = null;
  try {
    current = new URL(base);
  } catch {
    current = null;
  }
  if (current && page.origin === current.origin) return 'same';
  if (/\/login(\b|\?|#|$)/i.test(page.pathname + page.search)) return 'ignore';
  return isSchoologySite(page.href, addedHosts) ? 'other' : 'ignore';
}
