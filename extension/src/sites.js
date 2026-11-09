// sites.js — the Schoology sites the extension works on (pure, no browser
// APIs). Most schools use app.schoology.com; some put Schoology on their
// own address too (NPC students sign in at schoology.npchristian.org while
// parents use app.schoology.com). The extension follows whichever of these
// sites: each site keeps its own account and data (storage.js, PER SITE),
// so a parent on app.schoology.com and a student on the school's address
// can share one browser. See siteForPage and background.js,
// maybeAutoRefresh.
//
// To add a school's own Schoology address, add it to SCHOOL_HOSTS; the
// manifest (extension/manifest.json) must list the same sites, which a unit
// test checks.

export const REAL_SCHOOLOGY = 'https://app.schoology.com';

// Schools' own Schoology addresses (exact host names).
export const SCHOOL_HOSTS = ['schoology.npchristian.org'];

// Match patterns for the manifest's host_permissions and content script.
export const SCHOOLOGY_MATCHES = ['https://*.schoology.com/*', ...SCHOOL_HOSTS.map((h) => `https://${h}/*`)];

// isSchoologySite(url) -> true for an https page on one of those sites.
export function isSchoologySite(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  return host === 'schoology.com' || host.endsWith('.schoology.com') || SCHOOL_HOSTS.includes(host);
}

// siteForPage(pageUrl, base) -> what a loaded page means, given the site
// used last (`base`):
//   'same'   the page is on that site (this covers the dev mock server);
//   'other'  a page on another Schoology site (each site keeps its own
//            account and data, so it is refreshed on its own);
//   'ignore' anything else: a login page (not signed in there yet) or a
//            page that isn't Schoology.
export function siteForPage(pageUrl, base) {
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
  return isSchoologySite(page.href) ? 'other' : 'ignore';
}
