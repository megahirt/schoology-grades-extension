import { describe, it, expect, beforeEach } from 'vitest';
import { dayKey, buildEntry, mergeDailyLog, KEEP_DAYS } from '../../extension/src/daily-log.js';
import { DEFAULT_SETTINGS } from '../../extension/src/rules.js';
import { setDashboards, storageGet, storageSet, __clearMemoryStore } from '../../extension/src/storage.js';

// Made-up data only. "Today" is Friday 2026-11-06 at noon.
const NOW = new Date(2026, 10, 6, 12, 0).getTime();
const d = (m, day, h = 23) => new Date(2026, m, day, h, 59).toISOString();

function dashboard() {
  return {
    studentName: 'Sam Rivera',
    courses: [
      {
        id: 'c1',
        name: '07 American Literature',
        grade: 55,
        quarterGrade: 55,
        overallGrade: 66,
        gradeLabel: 'Quarter 2',
        assignments: [
          { id: 'm1', title: 'Essay', status: 'missing', due: d(10, 3) },
          { id: 'm2', title: 'Draft', status: 'missing', submitted: true, due: d(10, 4) },
          { id: 'm3', title: 'Vocab', status: 'missing', due: d(10, 2) },
          { id: 'g1', title: 'Quiz', status: 'graded', score: 9, maxPoints: 10, due: d(10, 5) },
          { id: 'p1', title: 'Reading', status: 'pending', due: d(10, 6, 22) },
        ],
      },
      { id: 'c2', name: '07 House Group', grade: null, assignments: [] }, // no grades: left out
    ],
  };
}

describe('daily log entry', () => {
  it('holds the day\'s counts, verdict, ring and class grades', () => {
    const e = buildEntry(dashboard(), DEFAULT_SETTINGS, { turnedIn: ['m3'] }, NOW);
    expect(e.v).toBe(1);
    expect(e.verdict).toBe('NO-GO');
    expect(e.missing).toBe(1); // m1 (m2 submitted, m3 marked turned in)
    expect(e.teacherMissing).toBe(2); // m1 + m3, still marked Missing on Schoology
    expect(e.waiting).toEqual({ submitted: 1, turnedIn: 1, done: 0 });
    expect(e.dueSoon).toEqual({ today: 1, tomorrow: 0 });
    expect(e.lowClasses).toBe(1);
    expect(e.week.total).toBe(5);
    expect(e.classes).toEqual([{ id: 'c1', name: 'American Literature', quarter: 55, overall: 66, grade: 55, label: 'Quarter 2' }]);
  });
  it('is skipped for a failed or partial load', () => {
    expect(buildEntry({ error: 'FETCH_FAILED', courses: [] }, DEFAULT_SETTINGS, {}, NOW)).toBeNull();
    expect(buildEntry({ ...dashboard(), parseWarnings: ['2 rows could not be read'] }, DEFAULT_SETTINGS, {}, NOW)).toBeNull();
  });
});

describe('mergeDailyLog', () => {
  it('one entry per child per local day; the latest refresh of the day wins', () => {
    let log = mergeDailyLog({}, { u1: dashboard() }, { settings: DEFAULT_SETTINGS }, NOW);
    expect(Object.keys(log.u1)).toEqual(['2026-11-06']);
    const later = NOW + 3 * 3600000;
    log = mergeDailyLog(log, { u1: dashboard() }, { settings: DEFAULT_SETTINGS, turnedIn: { u1: ['m1', 'm3'] } }, later);
    expect(Object.keys(log.u1)).toEqual(['2026-11-06']);
    expect(log.u1['2026-11-06'].missing).toBe(0);
    log = mergeDailyLog(log, { u1: dashboard() }, { settings: DEFAULT_SETTINGS }, NOW + 86400000);
    expect(Object.keys(log.u1).sort()).toEqual(['2026-11-06', '2026-11-07']);
  });
  it('keeps other children and failed loads as they were, and drops very old days', () => {
    const old = dayKey(NOW - (KEEP_DAYS + 5) * 86400000);
    const log = mergeDailyLog(
      { u1: { [old]: { v: 1 }, '2026-11-01': { v: 1 } }, u2: { '2026-11-01': { v: 1 } } },
      { u1: dashboard(), u2: { error: 'FETCH_FAILED', courses: [] } },
      { settings: DEFAULT_SETTINGS },
      NOW,
    );
    expect(Object.keys(log.u1).sort()).toEqual(['2026-11-01', '2026-11-06']);
    expect(log.u2).toEqual({ '2026-11-01': { v: 1 } });
  });
});

describe('the daily log is saved with the dashboards', () => {
  beforeEach(() => __clearMemoryStore());
  it('setDashboards writes today\'s entry using the stored rules and marks', async () => {
    await storageSet('settings', { gradeThreshold: 50 });
    await storageSet('turnedIn', { u1: ['m3'] });
    await setDashboards({ u1: dashboard() });
    const log = await storageGet('dailyLog');
    const entry = Object.values(log.u1)[0];
    expect(entry.missing).toBe(1);
    expect(entry.lowClasses).toBe(0); // 55% passes a 50% rule
  });
});
