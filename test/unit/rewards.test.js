import { describe, it, expect, beforeEach } from 'vitest';
import { quarterChange, weekProgress, weekStart, computeRecords, mergeRecords, isNewRecord, mergeAllRecords } from '../../extension/src/rewards.js';
import { setDashboards, storageGet, __clearMemoryStore } from '../../extension/src/storage.js';

// Made-up data only. "Today" is Friday 2026-11-06 at noon.
const NOW = new Date(2026, 10, 6, 12, 0).getTime();
const d = (m, day, h = 23) => new Date(2026, m, day, h, 59).toISOString();

const periods = [
  { id: 'S1', parentId: 'c1', title: 'Semester 1: 08/24/2026 - 01/15/2027', grade: 84, topLevel: true, start: d(7, 24, 0), end: d(0, 15) },
  { id: 'Q1', parentId: 'S1', title: 'Quarter 1: 08/24/2026 - 10/16/2026', grade: 78, topLevel: false, start: d(7, 24, 0), end: d(9, 16) },
  { id: 'Q2', parentId: 'S1', title: 'Quarter 2: 10/19/2026 - 12/15/2026', grade: 84.4, topLevel: false, start: d(9, 19, 0), end: d(11, 15) },
];

function course(over = {}) {
  return {
    id: 'c1',
    name: 'Algebra 2',
    quarterGrade: 84.4,
    gradeSource: 'Quarter 2: 10/19/2026 - 12/15/2026',
    periods,
    assignments: [],
    ...over,
  };
}

describe('quarterChange', () => {
  it('shows how much the quarter grade is up on the previous quarter', () => {
    expect(quarterChange(course())).toEqual({ delta: 6, prevGrade: 78, prevShort: 'Q1', prevTitle: 'Quarter 1' });
  });
  it('shows nothing for a drop, no change, or no earlier quarter', () => {
    expect(quarterChange(course({ quarterGrade: 70 }))).toBeNull();
    expect(quarterChange(course({ quarterGrade: 78.4 }))).toBeNull();
    expect(quarterChange(course({ gradeSource: 'Quarter 1: 08/24/2026 - 10/16/2026', quarterGrade: 78 }))).toBeNull();
    expect(quarterChange(course({ quarterGrade: null }))).toBeNull();
  });
});

describe('weekProgress', () => {
  it('counts this week (Monday to Sunday): graded, then turned in waiting for a grade', () => {
    // Past due and not marked Missing counts as turned in (as everywhere on
    // the dashboard); teacher-marked Missing without a submission does not.
    expect(new Date(weekStart(NOW)).getDay()).toBe(1);
    const c = course({
      assignments: [
        { id: 'a1', status: 'graded', score: 9, maxPoints: 10, due: d(10, 2) }, // Monday
        { id: 'a2', status: 'missing', submitted: true, due: d(10, 3) }, // submitted
        { id: 'a3', status: 'pending', due: d(10, 7) }, // Saturday, not in yet
        { id: 'a4', status: 'overdue', due: d(10, 4) }, // marked turned in
        { id: 'a5', status: 'excused', due: d(10, 4) },
        { id: 'a6', status: 'graded', score: 5, maxPoints: 5, due: d(9, 30) }, // last week
        { id: 'a7', status: 'overdue', due: d(10, 5) }, // past due, no Missing mark
        { id: 'a8', status: 'missing', due: d(10, 5) }, // teacher-marked Missing
        { id: 'a9', status: 'pending', due: d(10, 8) }, // Sunday 11:59 pm, still this week
      ],
    });
    expect(weekProgress([c], { turnedIn: [] }, NOW)).toEqual({ total: 7, graded: 1, submitted: 3 });
    expect(weekProgress([c], { turnedIn: ['a3'] }, NOW)).toEqual({ total: 7, graded: 1, submitted: 4 });
  });
});

describe('computeRecords', () => {
  const c = course({
    assignments: [
      { id: 'x1', title: 'Quiz 1', status: 'graded', score: 18, maxPoints: 20, due: d(8, 2) },
      { id: 'x2', title: 'Quiz 2', status: 'graded', score: 20, maxPoints: 20, due: d(8, 9) },
      { id: 'x3', title: 'Quiz 3', status: 'graded', score: 20, maxPoints: 20, due: d(9, 7) },
      { id: 'x4', title: 'Worksheet', status: 'missing', due: d(9, 14) },
      { id: 'x5', title: 'Lab', status: 'graded', score: 7, maxPoints: 10, due: d(9, 13) },
      { id: 'x6', title: 'Essay', status: 'missing', submitted: true, due: d(9, 26) },
      { id: 'x7', title: 'Future', status: 'graded', score: 50, maxPoints: 20, due: d(10, 20) },
    ],
  });
  const r = computeRecords([c], NOW);

  it('highest score: the earliest of the best, never future work', () => {
    expect(r.highestScore.value).toBe(100);
    expect(r.highestScore.info.title).toBe('Quiz 2');
  });
  it('best week: most turned in with nothing Missing', () => {
    // Week of Oct 12 has a Missing item, so it never counts.
    expect(r.bestWeek.value).toBe(1);
    expect(new Date(r.bestWeek.info.start).getDate()).toBe(31); // Aug 31, the earliest 1-item week
  });
  it('longest run with nothing Missing: from school start, or since the last Missing', () => {
    // Aug 24 -> Oct 13 (51 days) beats Oct 15 -> today (23 days, ongoing).
    expect(r.cleanRun.value).toBe(51);
    expect(r.cleanRun.info.ongoing).toBe(false);
  });
  it('highest class grade: best quarter', () => {
    expect(r.classGrade.value).toBe(84.4);
    expect(r.classGrade.info).toEqual({ course: 'Algebra 2', period: 'Quarter 2' });
  });
});

describe('mergeRecords', () => {
  const rec = (value, key) => ({ value, key, info: {} });
  it('only ever goes up', () => {
    const stored = mergeRecords({}, { highestScore: rec(95, 'a') }, NOW);
    expect(stored.highestScore.newAt).toBeNull(); // the first one seen is not NEW
    const lower = mergeRecords(stored, { highestScore: rec(80, 'b') }, NOW);
    expect(lower.highestScore.value).toBe(95);
    expect(lower.highestScore.key).toBe('a');
  });
  it('a different event beating it is NEW for a week', () => {
    const stored = mergeRecords({}, { highestScore: rec(95, 'a') }, NOW);
    const beat = mergeRecords(stored, { highestScore: rec(100, 'b') }, NOW);
    expect(beat.highestScore.value).toBe(100);
    expect(isNewRecord(beat.highestScore, NOW + 6 * 86400000)).toBe(true);
    expect(isNewRecord(beat.highestScore, NOW + 8 * 86400000)).toBe(false);
  });
  it('the same event growing (an ongoing run) keeps its NEW date', () => {
    const a = { cleanRun: { value: 10, key: 's', info: {}, newAt: null } };
    const grown = mergeRecords(a, { cleanRun: rec(12, 's') }, NOW);
    expect(grown.cleanRun.value).toBe(12);
    expect(grown.cleanRun.newAt).toBeNull();
  });
});

describe('records are saved with the dashboards', () => {
  beforeEach(() => __clearMemoryStore());
  it('setDashboards updates each child; failed or partial loads keep what they had', async () => {
    const good = { courses: [course({ assignments: [{ id: 'q', title: 'Quiz', status: 'graded', score: 9, maxPoints: 10, due: d(9, 1) }] })] };
    await setDashboards({ u1: good });
    expect((await storageGet('records')).u1.highestScore.value).toBe(90);
    await setDashboards({ u1: { error: 'FETCH_FAILED', courses: [] } });
    expect((await storageGet('records')).u1.highestScore.value).toBe(90);
    const merged = mergeAllRecords({}, { u2: { ...good, parseWarnings: ['3 rows could not be read'] } });
    expect(merged.u2).toBeUndefined();
  });
});
