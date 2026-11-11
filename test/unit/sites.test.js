import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isSchoologySite, siteForPage, SCHOOLOGY_MATCHES } from '../../extension/src/sites.js';

describe('Schoology sites', () => {
  it('app.schoology.com and the school\'s own Schoology address', () => {
    expect(isSchoologySite('https://app.schoology.com/home')).toBe(true);
    expect(isSchoologySite('https://schoology.npchristian.org/grades/grades')).toBe(true);
    expect(isSchoologySite('https://SCHOOLOGY.npchristian.org/')).toBe(true);
  });
  it('nothing else', () => {
    expect(isSchoologySite('https://npchristian.org/')).toBe(false);
    expect(isSchoologySite('https://schoology.npchristian.org.evil.com/')).toBe(false);
    expect(isSchoologySite('https://notschoology.com/')).toBe(false);
    expect(isSchoologySite('http://app.schoology.com/')).toBe(false);
    expect(isSchoologySite('http://localhost:8123/home')).toBe(false);
    expect(isSchoologySite('not a url')).toBe(false);
  });
  it('pinned (release builds): app.schoology.com and the school address only', () => {
    expect(isSchoologySite('https://app.schoology.com/home', [], false)).toBe(true);
    expect(isSchoologySite('https://schoology.npchristian.org/home', [], false)).toBe(true);
    expect(isSchoologySite('https://district.schoology.com/home', [], false)).toBe(false);
    expect(isSchoologySite('https://district.schoology.com/home', [], true)).toBe(true);
  });
  it('the manifest lists the same sites for access and the content script', () => {
    const m = JSON.parse(readFileSync(new URL('../../extension/manifest.json', import.meta.url), 'utf8'));
    expect(m.host_permissions).toEqual(SCHOOLOGY_MATCHES);
    expect(m.content_scripts[0].matches).toEqual(SCHOOLOGY_MATCHES);
  });
});

describe('siteForPage', () => {
  const APP = 'https://app.schoology.com';
  const NPC = 'https://schoology.npchristian.org';
  it('same site, another Schoology site, or neither', () => {
    expect(siteForPage(`${APP}/home`, APP)).toBe('same');
    expect(siteForPage(`${NPC}/home`, APP)).toBe('other');
    expect(siteForPage(`${APP}/grades/grades`, NPC)).toBe('other');
  });
  it('ignores login pages and other websites', () => {
    expect(siteForPage(`${NPC}/login?destination=home`, APP)).toBe('ignore');
    expect(siteForPage(`${NPC}/login/saml/initial`, APP)).toBe('ignore');
    expect(siteForPage('https://example.com/', APP)).toBe('ignore');
    expect(siteForPage(`${APP}/home`, 'http://localhost:8123')).toBe('other'); // each site has its own data
    expect(siteForPage('http://localhost:9999/home', APP)).toBe('ignore');
    expect(siteForPage('http://localhost:8123/home', 'http://localhost:8123')).toBe('same');
  });
});
