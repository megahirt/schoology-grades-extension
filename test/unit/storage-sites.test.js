// Per-site storage (storage.js, PER SITE): a parent on app.schoology.com and
// a student on the school's own address keep separate data in one browser.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setSite, getSite, siteKey, storageGet, storageSet, getSites,
  getDashboards, setDashboards, getAccount, setAccount, getTurnedIn, setTurnedIn, getSettings, setSettings, __clearMemoryStore,
  getUser, setUser, scopeOf, changedFor,
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

// Per user (storage.js, PER SITE AND PER USER): on one site, each person who
// signs in has their own data; the site shows whoever `user@<origin>` names.
describe('per-user storage', () => {
  beforeEach(() => __clearMemoryStore());
  afterEach(() => setSite(null));

  it('keeps two students on one site apart, and switches with who is signed in', async () => {
    setSite(NPC);
    await setUser({ uid: '11', signedOut: false });
    await setDashboards({ self: dash('Sam Rivera') });
    await setTurnedIn({ self: ['a'] });
    expect(await storageGet('dashboards', null, `${NPC}#11`)).toBeTruthy();

    // Someone else signs in: their (empty) data, not the first student's.
    await setUser({ uid: '22', signedOut: false });
    expect(await getDashboards()).toEqual({});
    expect(await getTurnedIn()).toEqual({});
    await setDashboards({ self: dash('Jamie Rivera') });
    expect((await getDashboards()).self.studentName).toBe('Jamie Rivera');

    // The first student back: their data is still there.
    await setUser({ uid: '11', signedOut: false });
    expect((await getDashboards()).self.studentName).toBe('Sam Rivera');
    expect(await getTurnedIn()).toEqual({ self: ['a'] });
    expect(await getSites()).toEqual([NPC]);
  });

  it('two parents on one site keep their own children', async () => {
    await setUser({ uid: 'p1' }, APP);
    await setAccount({ type: 'parent' }, APP);
    await setDashboards({ k1: dash('Sam Rivera') }, APP);
    await setUser({ uid: 'p2' }, APP);
    expect(await getAccount(APP)).toBe(null);
    await setDashboards({ k9: dash('Pat Rivera') }, APP);
    expect(Object.keys(await getDashboards(APP))).toEqual(['k9']);
    expect(Object.keys(await getDashboards(`${APP}#p1`))).toEqual(['k1']);
  });

  it('a scope pins the user, whoever signs in meanwhile', async () => {
    await setUser({ uid: '11' }, NPC);
    const scope = scopeOf(NPC, '11');
    expect(scope).toBe(`${NPC}#11`);
    await setUser({ uid: '22' }, NPC);
    await setDashboards({ self: dash('Sam Rivera') }, scope);
    expect(await getDashboards(NPC)).toEqual({});
    expect(Object.keys(await getDashboards(scope))).toEqual(['self']);
    // Site-level keys ignore the user part of a scope.
    await storageSet('refreshState', { running: true }, scope);
    expect(await storageGet('refreshState', null, NPC)).toEqual({ running: true });
  });

  it('signing out keeps the last person\'s data (shown as old)', async () => {
    await setUser({ uid: '11' }, NPC);
    await setDashboards({ self: dash('Sam Rivera') }, NPC);
    await setUser({ ...(await getUser(NPC)), signedOut: true }, NPC);
    expect(Object.keys(await getDashboards(NPC))).toEqual(['self']);
    expect((await getUser(NPC)).signedOut).toBe(true);
  });

  it('changedFor matches any user\'s copy on the site, who is signed in, and shared keys', () => {
    setSite(NPC);
    expect(changedFor({ [`dashboards@${NPC}#11`]: {} }, ['dashboards'])).toBe(true);
    expect(changedFor({ [`dashboards@${NPC}`]: {} }, ['dashboards'])).toBe(true);
    expect(changedFor({ [`user@${NPC}`]: {} }, ['dashboards'])).toBe(true);
    expect(changedFor({ settings: {} }, ['settings'])).toBe(true);
    expect(changedFor({ [`dashboards@${APP}#11`]: {} }, ['dashboards'])).toBe(false);
    expect(changedFor({ [`dashboards@${NPC}x#1`]: {} }, ['dashboards'])).toBe(false);
    expect(changedFor({ [`records@${NPC}#11`]: {} }, ['dashboards'])).toBe(false);
    setSite(null);
    expect(changedFor({ dashboards: {} }, ['dashboards'])).toBe(true);
  });
});
