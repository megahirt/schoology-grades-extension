// sites.js — the Schoology sites the extension works on (pure, no browser
// APIs). Most schools use app.schoology.com; some put Schoology on their
// own address too (NPC students sign in at schoology.npchristian.org while
// parents use app.schoology.com). The extension follows whichever of these
// sites the family is signed in to: loading a Schoology page on one of them
// points the extension there (see siteForPage and background.js,
// maybeAutoRefresh), except that a parent account is never swapped for a
// student account signed in on another site (the parent view already shows
// that child).
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

// siteForPage(pageUrl, base) -> what a loaded Schoology page means for the
// site the extension reads from:
//   'same'   the page is on that site;
//   'other'  a page on another Schoology site the family is signed in to
//            (follow it, subject to the parent-account rule);
//   'ignore' anything else: a login page (not signed in there yet), a page
//            that isn't Schoology, or a dev build pointed at the mock server.
export function siteForPage(pageUrl, base) {
  let page;
  let current;
  try {
    page = new URL(pageUrl);
    current = new URL(base);
  } catch {
    return 'ignore';
  }
  if (page.origin === current.origin) return 'same';
  if (/\/login(\b|\?|#|$)/i.test(page.pathname + page.search)) return 'ignore';
  if (!isSchoologySite(page.href) || !isSchoologySite(current.href)) return 'ignore';
  return 'other';
}
