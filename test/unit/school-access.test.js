import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  KNOWN_SCHOOL_HOSTS,
  SCHOOL_HOSTS,
  isKnownSchoolHost,
  isSchoologySite,
  siteForPage,
  schoolOrigin,
  addedSchoolHosts,
  looksLikeSchoology,
  SCHOOLOGY_FINGERPRINT,
  schoolScriptId,
} from '../../extension/src/sites.js';
import { canAddSchools, schoolOfferForTab, addedSchools, syncSchoolScripts } from '../../extension/src/school-access.js';

const manifest = JSON.parse(readFileSync(new URL('../../extension/manifest.json', import.meta.url), 'utf8'));

describe('known school addresses (school-hosts.json)', () => {
  it('is a sorted list of plain host names, none on schoology.com', () => {
    expect(KNOWN_SCHOOL_HOSTS.length).toBeGreaterThan(100);
    expect([...KNOWN_SCHOOL_HOSTS].sort()).toEqual(KNOWN_SCHOOL_HOSTS);
    expect(new Set(KNOWN_SCHOOL_HOSTS).size).toBe(KNOWN_SCHOOL_HOSTS.length);
    for (const h of KNOWN_SCHOOL_HOSTS) {
      expect(h).toMatch(/^([a-z0-9-]+\.)+[a-z]{2,}$/);
      expect(h.endsWith('schoology.com')).toBe(false);
    }
  });
  it('recognises listed and manifest addresses', () => {
    expect(isKnownSchoolHost('schoology.npchristian.org')).toBe(true);
    expect(isKnownSchoolHost('lms.lausd.net')).toBe(true);
    expect(isKnownSchoolHost('LMS.LAUSD.NET')).toBe(true);
    expect(isKnownSchoolHost('example.com')).toBe(false);
  });
  it('is not a permission: the manifest only lists *.schoology.com and SCHOOL_HOSTS', () => {
    expect(manifest.host_permissions.length).toBe(1 + SCHOOL_HOSTS.length);
    expect(manifest.optional_host_permissions).toEqual(['https://*/*']);
    expect(manifest.permissions).toContain('activeTab');
  });
});

describe('schoolOrigin (what a family types)', () => {
  it('accepts a host name or a pasted link', () => {
    expect(schoolOrigin('schoology.example.org')).toBe('https://schoology.example.org');
    expect(schoolOrigin('  Schoology.Example.org/ ')).toBe('https://schoology.example.org');
    expect(schoolOrigin('https://lms.example.net/grades/grades?x=1')).toBe('https://lms.example.net');
  });
  it('rejects what cannot be a school address', () => {
    for (const bad of ['', 'schoology', 'http://lms.example.net', 'https://localhost', 'https://10.0.0.1',
      'https://lms.example.net:8443', 'ftp://lms.example.net', 'https://user:pw@lms.example.net', 'not a url']) {
      expect(schoolOrigin(bad)).toBe(null);
    }
  });
});

describe('addedSchoolHosts (from permissions.getAll)', () => {
  it('keeps exact https school addresses only', () => {
    expect(addedSchoolHosts([
      'https://*.schoology.com/*',
      'https://schoology.npchristian.org/*',
      'https://*/*',
      'http://localhost/*',
      'https://lms.example.net/*',
      'https://LMS.example.net/*',
      'https://app.schoology.com/*',
      '<all_urls>',
    ])).toEqual(['lms.example.net']);
    expect(addedSchoolHosts()).toEqual([]);
  });
  it('an added address counts as a Schoology site', () => {
    expect(isSchoologySite('https://lms.example.net/home')).toBe(false);
    expect(isSchoologySite('https://lms.example.net/home', ['lms.example.net'])).toBe(true);
    expect(siteForPage('https://lms.example.net/home', 'https://app.schoology.com')).toBe('ignore');
    expect(siteForPage('https://lms.example.net/home', 'https://app.schoology.com', ['lms.example.net'])).toBe('other');
    expect(siteForPage('https://lms.example.net/login', 'https://app.schoology.com', ['lms.example.net'])).toBe('ignore');
  });
  it('script ids are per host', () => {
    expect(schoolScriptId('lms.example.net')).toBe('school:lms.example.net');
  });
});

describe('looksLikeSchoology', () => {
  const doc = (hit) => ({ querySelector: (sel) => (sel === SCHOOLOGY_FINGERPRINT && hit ? {} : null) });
  it('uses the fingerprint selector', () => {
    expect(looksLikeSchoology(doc(true))).toBe(true);
    expect(looksLikeSchoology(doc(false))).toBe(false);
    expect(looksLikeSchoology({ querySelector: () => { throw new Error('bad'); } })).toBe(false);
  });
  it('names Schoology asset paths, not generic Drupal ones', () => {
    expect(SCHOOLOGY_FINGERPRINT).toContain('asset-cdn.schoology.com');
    expect(SCHOOLOGY_FINGERPRINT).toContain('#s-user-login-form');
    expect(SCHOOLOGY_FINGERPRINT).not.toContain('drupal');
  });
});

// A stand-in for the browser APIs school-access.js uses.
function fakeBrowser({ optional = ['https://*/*'], granted = [], pageLooks = false } = {}) {
  return {
    runtime: { getManifest: () => ({ optional_host_permissions: optional }) },
    permissions: {
      request: vi.fn(async () => true),
      getAll: async () => ({ origins: granted }),
    },
    scripting: { executeScript: vi.fn(async () => [{ result: pageLooks }]) },
  };
}

describe('school-access', () => {
  it('only offers adding schools when the build has the optional permission (not Safari)', () => {
    expect(canAddSchools(fakeBrowser())).toBe(true);
    expect(canAddSchools(fakeBrowser({ optional: [] }))).toBe(false);
  });
  it('lists added schools', async () => {
    expect(await addedSchools(fakeBrowser({ granted: ['https://b.example.org/*', 'https://a.example.org/*'] })))
      .toEqual(['a.example.org', 'b.example.org']);
  });
  it('offers a known school address without looking at the page', async () => {
    const b = fakeBrowser();
    expect(await schoolOfferForTab(b, { id: 1, url: 'https://lms.lausd.net/home' }))
      .toEqual({ origin: 'https://lms.lausd.net', host: 'lms.lausd.net', known: true });
    expect(b.scripting.executeScript).not.toHaveBeenCalled();
  });
  it('offers an unknown address only when the page looks like Schoology', async () => {
    expect(await schoolOfferForTab(fakeBrowser({ pageLooks: true }), { id: 1, url: 'https://learn.example.org/home' }))
      .toEqual({ origin: 'https://learn.example.org', host: 'learn.example.org', known: false });
    expect(await schoolOfferForTab(fakeBrowser({ pageLooks: false }), { id: 1, url: 'https://news.example.org/' })).toBe(null);
  });
  it('no offer where the extension already works, on http, or without the permission', async () => {
    expect(await schoolOfferForTab(fakeBrowser(), { id: 1, url: 'https://app.schoology.com/home' })).toBe(null);
    expect(await schoolOfferForTab(fakeBrowser(), { id: 1, url: 'https://schoology.npchristian.org/home' })).toBe(null);
    expect(await schoolOfferForTab(fakeBrowser({ granted: ['https://lms.lausd.net/*'] }), { id: 1, url: 'https://lms.lausd.net/home' })).toBe(null);
    expect(await schoolOfferForTab(fakeBrowser(), { id: 1, url: 'http://lms.lausd.net/home' })).toBe(null);
    expect(await schoolOfferForTab(fakeBrowser({ optional: [] }), { id: 1, url: 'https://lms.lausd.net/home' })).toBe(null);
    expect(await schoolOfferForTab(fakeBrowser(), null)).toBe(null);
  });
});

describe('syncSchoolScripts (background)', () => {
  function scriptingBrowser(granted, registered) {
    const b = fakeBrowser({ granted });
    let scripts = registered.map((id) => ({ id }));
    b.scripting.getRegisteredContentScripts = async () => scripts;
    b.scripting.registerContentScripts = vi.fn(async (list) => { scripts = [...scripts, ...list]; });
    b.scripting.unregisterContentScripts = vi.fn(async ({ ids }) => { scripts = scripts.filter((s) => !ids.includes(s.id)); });
    return b;
  }
  it('registers the content script on a newly allowed school address', async () => {
    const b = scriptingBrowser(['https://*.schoology.com/*', 'https://lms.example.net/*'], []);
    expect(await syncSchoolScripts(b)).toEqual(['lms.example.net']);
    expect(b.scripting.registerContentScripts).toHaveBeenCalledWith([{
      id: 'school:lms.example.net',
      matches: ['https://lms.example.net/*'],
      js: ['content.js'],
      runAt: 'document_idle',
      persistAcrossSessions: true,
    }]);
  });
  it('drops scripts for removed addresses and leaves others alone', async () => {
    const b = scriptingBrowser(['https://a.example.org/*'], ['school:a.example.org', 'school:gone.example.org', 'other-script']);
    expect(await syncSchoolScripts(b)).toEqual([]);
    expect(b.scripting.unregisterContentScripts).toHaveBeenCalledWith({ ids: ['school:gone.example.org'] });
    expect(b.scripting.registerContentScripts).not.toHaveBeenCalled();
  });
});
