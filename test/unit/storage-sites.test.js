// Per-site storage (storage.js, PER SITE): a parent on app.schoology.com and
// a student on the school's own address keep separate data in one browser.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setSite, getSite, siteKey, storageGet, storageSet, getSites,
  getDashboards, setDashboards, getAccount, setAccount, getTurnedIn, setTurnedIn, getSettings, setSettings, __clearMemoryStore,
} from '../../extension/src/storage.js';

const APP = 'https://app.schoology.com';
const NPC = 'https://schoology.npchristian.org';
const dash = (name) => ({ studentName: name, courses: [{ id: 'c1', name: 'Math', assignments: [{ id: 'q', title: 'Quiz', status: 'graded', score: 9, maxPoints: 10, due: '2026-10-01T12:00:00Z' }] }] });

describe('per-site storage', () => {
  beforeEach(() => __clearMemoryStore());
  afterEach(() => setSite(null));

  it('names keys by site; shared keys stay as they are', () => {
    setSite(`${APP}/home`);
    expect(getSite()).toBe(APP);
    expect(siteKey('dashboards')).toBe(`dashboards@${APP}`);
    expect(siteKey('settings')).toBe('settings');
    expect(siteKey('panelOpen')).toBe('panelOpen');
    setSite(null);
    expect(siteKey('dashboards')).toBe('dashboards');
  });

  it('keeps each site\'s account, dashboards and marks apart, and shares settings', async () => {
    await setSettings({ gradeThreshold: 70 });
    await setAccount({ type: 'parent' }, APP);
    await setDashboards({ k1: dash('Sam Rivera'), k2: dash('Jamie Rivera') }, APP);
    await setTurnedIn({ k1: ['a'] }, APP);
    await setAccount({ type: 'student' }, NPC);
    await setDashboards({ self: dash('Jamie Rivera') }, NPC);

    expect(Object.keys(await getDashboards(APP))).toEqual(['k1', 'k2']);
    expect(Object.keys(await getDashboards(NPC))).toEqual(['self']);
    expect((await getAccount(NPC)).type).toBe('student');
    expect(await getTurnedIn(NPC)).toEqual({});
    expect(await getSites()).toEqual([APP, NPC]);

    // A page's own site is the default.
    setSite(NPC);
    expect(Object.keys(await getDashboards())).toEqual(['self']);
    expect((await getSettings()).gradeThreshold).toBe(70);
    // Records are per site too.
    expect(Object.keys(await storageGet('records', {}, APP))).toEqual(['k1', 'k2']);
    expect(Object.keys(await storageGet('records'))).toEqual(['self']);
  });

  it('a site with no data is not listed', async () => {
    await setDashboards({}, APP);
    await storageSet('refreshState', { running: true }, NPC);
    expect(await getSites()).toEqual([]);
  });
});
