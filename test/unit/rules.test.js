// rules.test.js — unit tests for extension/src/rules.js (SPEC: Rules engine).
// Defaults are the shipped default rules: gradeThreshold 75 (75 passes),
// missingThreshold 2 (NO-GO if missingCount >= 2; one Missing alone is GO).
// Badge wording (SPEC): "NO-GO — Missing work", "NO-GO — Low grades",
// "NO-GO — Missing work + Low grades", otherwise "GO".

import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, computeVerdict, summarizeStudent, hasGradeData, assignmentPercent, isExtraCredit, isBonus, extraCreditPercent, extraCreditPoints } from '../../extension/src/rules.js';

describe('DEFAULT_SETTINGS', () => {
  it('uses the shipped defaults (75 / 2)', () => {
    expect(DEFAULT_SETTINGS.gradeThreshold).toBe(75);
    expect(DEFAULT_SETTINGS.missingThreshold).toBe(2);
    expect(DEFAULT_SETTINGS.notSoGoodDays).toBe(7);
    expect(DEFAULT_SETTINGS.showGoNoGo).toBe(true);
  });
});

describe('computeVerdict', () => {
  const defaults = DEFAULT_SETTINGS;

  it('2 Missing => NO-GO with reason "Missing work"', () => {
    const result = computeVerdict({ missingCount: 2, lowestClassGrade: 90, settings: defaults });
    expect(result.verdict).toBe('NO-GO');
    expect(result.reasons.join(' ')).toContain('Missing work');
    expect(result.reasons.join(' ')).not.toContain('Low grades');
  });

  it('1 Missing + all grades >= 75 => GO (one Missing alone is not NO-GO)', () => {
    const result = computeVerdict({ missingCount: 1, lowestClassGrade: 92, settings: defaults });
    expect(result.verdict).toBe('GO');
    expect(result.reasons).toEqual([]);
  });

  it('0 Missing + all grades >= 75 => GO', () => {
    const result = computeVerdict({ missingCount: 0, lowestClassGrade: 95, settings: defaults });
    expect(result.verdict).toBe('GO');
  });

  it('class grade 74 => NO-GO with reason "Low grades"', () => {
    const result = computeVerdict({ missingCount: 0, lowestClassGrade: 74, settings: defaults });
    expect(result.verdict).toBe('NO-GO');
    expect(result.reasons.join(' ')).toContain('Low grades');
  });

  it('class grade exactly 75 => GO (75 passes)', () => {
    const result = computeVerdict({ missingCount: 0, lowestClassGrade: 75, settings: defaults });
    expect(result.verdict).toBe('GO');
  });

  it('both problems => NO-GO with both reasons', () => {
    const result = computeVerdict({ missingCount: 3, lowestClassGrade: 55, settings: defaults });
    expect(result.verdict).toBe('NO-GO');
    expect(result.reasons.join(' ')).toContain('Missing work');
    expect(result.reasons.join(' ')).toContain('Low grades');
  });

  it('no class grade posted at all => GO on grades (cannot fail what does not exist)', () => {
    const result = computeVerdict({ missingCount: 0, lowestClassGrade: null, settings: defaults });
    expect(result.verdict).toBe('GO');
  });

  it('respects custom thresholds', () => {
    const custom = { ...defaults, gradeThreshold: 80, missingThreshold: 1 };
    // 1 Missing is NO-GO when the family sets missingThreshold to 1.
    expect(computeVerdict({ missingCount: 1, lowestClassGrade: 95, settings: custom }).verdict).toBe('NO-GO');
    // 79 is NO-GO when the family sets gradeThreshold to 80, but GO at 75.
    expect(computeVerdict({ missingCount: 0, lowestClassGrade: 79, settings: custom }).verdict).toBe('NO-GO');
    expect(computeVerdict({ missingCount: 0, lowestClassGrade: 79, settings: defaults }).verdict).toBe('GO');
    // 80 passes under the custom threshold.
    expect(computeVerdict({ missingCount: 0, lowestClassGrade: 80, settings: custom }).verdict).toBe('GO');
  });
});

describe('summarizeStudent', () => {
  // Courses shaped like parser output: { id, name, grade, assignments: [...] }.
  const courses = [
    {
      id: '4042',
      name: 'American Literature',
      grade: 55,
      assignments: [
        { id: '1', title: 'Persuasive Essay Draft', status: 'missing', score: 0, maxPoints: 50, due: '2026-11-03T23:59:00' },
        { id: '2', title: 'Unit 2 Essay', status: 'missing', score: 0, maxPoints: 50, due: '2026-11-05T23:59:00' },
        { id: '3', title: 'Rhetoric Analysis', status: 'graded', score: 42, maxPoints: 50, due: '2026-10-30T23:59:00' },
      ],
    },
    {
      id: '4043',
      name: 'United States History',
      grade: 88,
      assignments: [
        { id: '4', title: 'Civil War Essay', status: 'graded', score: 44, maxPoints: 50, due: '2026-10-29T23:59:00' },
      ],
    },
  ];

  it('counts Missing items and finds the lowest class grade (two-Missing child)', () => {
    const summary = summarizeStudent(courses, DEFAULT_SETTINGS);
    expect(summary.missingCount).toBe(2);
    expect(summary.missingItems.map((a) => a.title)).toEqual(
      expect.arrayContaining(['Persuasive Essay Draft', 'Unit 2 Essay']),
    );
    expect(summary.lowestClassGrade).toBe(55);
    // lowClasses are course objects ({ id, name, grade }), not bare names.
    expect(summary.lowClasses.map((c) => c.name)).toEqual(
      expect.arrayContaining(['American Literature']),
    );
    expect(summary.verdict.verdict).toBe('NO-GO');
  });

  it('GO summary for one Missing and all classes >= 75 (one-Missing child)', () => {
    const oneMissing = [
      {
        id: '4050',
        name: '07 English',
        grade: 92,
        assignments: [
          { id: '1', title: 'Poetry Analysis Essay', status: 'missing', score: 0, maxPoints: 50, due: '2026-11-04T23:59:00' },
          { id: '2', title: 'Grammar Quiz 5', status: 'graded', score: 19, maxPoints: 20, due: '2026-10-30T23:59:00' },
        ],
      },
      { id: '4051', name: '07 Math', grade: 94, assignments: [] },
    ];
    const summary = summarizeStudent(oneMissing, DEFAULT_SETTINGS);
    expect(summary.missingCount).toBe(1);
    expect(summary.lowestClassGrade).toBe(92);
    expect(summary.verdict.verdict).toBe('GO');
  });

  it('ignores ungraded, not-Missing items when counting Missing', () => {
    const summary = summarizeStudent(
      [{
        id: '1004',
        name: 'Advisory 11',
        grade: null,
        assignments: [
          { id: '1', title: 'Advisory Check-in', status: 'pending', score: null, maxPoints: null, due: '2026-11-06T23:59:00' },
        ],
      }],
      DEFAULT_SETTINGS,
    );
    expect(summary.missingCount).toBe(0);
    expect(summary.lowestClassGrade).toBeNull();
    expect(summary.verdict.verdict).toBe('GO');
  });

  it('puts outstanding items due today / tomorrow in dueToday / dueTomorrow', () => {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    // Local calendar date (not toISOString, which is UTC and rolls to the
    // next day in the evening west of Greenwich).
    const pad = (n) => String(n).padStart(2, '0');
    const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T23:59:00`;
    const summary = summarizeStudent(
      [{
        id: '1002',
        name: 'American Literature',
        grade: 82,
        assignments: [
          { id: '1', title: 'Due Today Item', status: 'pending', score: null, maxPoints: 10, due: iso(today) },
          { id: '2', title: 'Due Tomorrow Item', status: 'pending', score: null, maxPoints: 10, due: iso(tomorrow) },
          { id: '3', title: 'Graded Item', status: 'graded', score: 9, maxPoints: 10, due: iso(today) },
        ],
      }],
      DEFAULT_SETTINGS,
    );
    expect(summary.dueToday.map((a) => a.title)).toContain('Due Today Item');
    expect(summary.dueTomorrow.map((a) => a.title)).toContain('Due Tomorrow Item');
    expect(summary.dueToday.map((a) => a.title)).not.toContain('Graded Item');
  });
  it('counts letter grades as graded: A/B doing well, D/F not so good, never due soon', () => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const today = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}T08:00:00`;
    const summary = summarizeStudent(
      [{
        id: '1', name: 'Art', grade: 95,
        assignments: [
          { id: 'a', title: 'Map Project', status: 'graded', score: null, letterGrade: 'A', due: today },
          { id: 'b', title: 'Sketchbook', status: 'graded', score: null, letterGrade: 'D+', due: null },
        ],
      }],
      DEFAULT_SETTINGS,
    );
    expect(summary.doingWell.map((a) => a.title)).toEqual(['Map Project']);
    expect(summary.notSoGood.map((a) => a.title)).toEqual(['Sketchbook']);
    expect(summary.dueToday).toEqual([]);
  });
});

describe('Waiting on teacher (turned-in and done marks)', () => {
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T23:59:00`;
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const lastWeek = new Date(today);
  lastWeek.setDate(today.getDate() - 7);
  const course = (assignments) => [{ id: '10', name: 'Algebra 2', grade: 90, assignments }];

  it('a Missing item marked turned in waits on the teacher and stops counting as Missing', () => {
    const s = summarizeStudent(course([
      { id: '1', title: 'Worksheet', status: 'missing', score: null, due: iso(lastWeek) },
      { id: '2', title: 'Quiz', status: 'missing', score: null, due: iso(lastWeek) },
    ]), DEFAULT_SETTINGS, ['1']);
    expect(s.missingCount).toBe(1);
    expect(s.waiting.map((a) => [a.title, a.waitingReason])).toEqual([['Worksheet', 'turnedIn']]);
    expect(s.verdict.verdict).toBe('GO');
  });

  it('a turned-in item drops out of Waiting once graded, or once the Missing mark is removed', () => {
    const s = summarizeStudent(course([
      { id: '1', title: 'Graded Now', status: 'graded', score: 8, maxPoints: 10, due: iso(lastWeek) },
      { id: '2', title: 'Missing Removed', status: 'pending', score: null, due: iso(lastWeek) },
    ]), DEFAULT_SETTINGS, ['1', '2']);
    expect(s.waiting).toEqual([]);
    expect(s.doingWell.map((a) => a.title)).toEqual(['Graded Now']);
  });

  it('a Due soon item marked done leaves Due soon and waits on the teacher', () => {
    const s = summarizeStudent(course([
      { id: '1', title: 'Due Today', status: 'pending', score: null, due: iso(today) },
      { id: '2', title: 'Due Tomorrow', status: 'pending', score: null, due: iso(tomorrow) },
    ]), DEFAULT_SETTINGS, [], ['1']);
    expect(s.dueToday).toEqual([]);
    expect(s.dueTomorrow.map((a) => a.title)).toEqual(['Due Tomorrow']);
    expect(s.waiting.map((a) => [a.title, a.waitingReason])).toEqual([['Due Today', 'done']]);
  });

  it('a done item stays in Waiting after its due date passes, until graded', () => {
    const s = summarizeStudent(course([
      { id: '1', title: 'Past Due Done', status: 'pending', score: null, due: iso(lastWeek) },
    ]), DEFAULT_SETTINGS, [], ['1']);
    expect(s.waiting.map((a) => a.title)).toEqual(['Past Due Done']);
  });

  it('a done item the teacher marks Missing counts as Missing again', () => {
    const s = summarizeStudent(course([
      { id: '1', title: 'Marked Missing Later', status: 'missing', score: null, due: iso(lastWeek) },
      { id: '2', title: 'Also Missing', status: 'missing', score: null, due: iso(lastWeek) },
    ]), DEFAULT_SETTINGS, [], ['1']);
    expect(s.missingCount).toBe(2);
    expect(s.waiting).toEqual([]);
    expect(s.verdict.verdict).toBe('NO-GO');
  });

  it('a done item that gets graded leaves Waiting', () => {
    const s = summarizeStudent(course([
      { id: '1', title: 'Graded', status: 'graded', score: 9, maxPoints: 10, due: iso(today) },
    ]), DEFAULT_SETTINGS, [], ['1']);
    expect(s.waiting).toEqual([]);
    expect(s.dueToday).toEqual([]);
  });
});

describe('hasGradeData', () => {
  it('is true for a course grade or any graded assignment', () => {
    expect(hasGradeData({ grade: 88, assignments: [] })).toBe(true);
    expect(hasGradeData({ grade: null, assignments: [{ status: 'graded', score: 9, maxPoints: 10 }] })).toBe(true);
    expect(hasGradeData({ grade: null, assignments: [{ status: 'graded', letterGrade: 'A' }] })).toBe(true);
  });

  it('is false for sections with no grades (advisory, house group)', () => {
    expect(hasGradeData({ grade: null, assignments: [] })).toBe(false);
    expect(hasGradeData({ grade: null, assignments: [{ status: 'pending', score: null }] })).toBe(false);
    expect(hasGradeData({ grade: null, assignments: [{ status: 'missing', score: null }] })).toBe(false);
    expect(hasGradeData(null)).toBe(false);
  });
});

describe('Submitted work and Doing well', () => {
  const pad = (n) => String(n).padStart(2, '0');
  const at = (daysAgo) => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T08:00:00`;
  };
  const course = (assignments, grade = 90) => [{ id: '10', name: 'History', grade, assignments }];

  it('a submitted item still marked Missing waits on the teacher and is not Missing', () => {
    const s = summarizeStudent(course([
      { id: '1', title: 'Script', status: 'missing', score: null, submitted: true, due: at(4) },
      { id: '2', title: 'Essay', status: 'missing', score: null, submitted: true, due: at(9) },
    ]), DEFAULT_SETTINGS);
    expect(s.missingCount).toBe(0);
    expect(s.waiting.map((a) => [a.title, a.waitingReason])).toEqual([['Script', 'submitted'], ['Essay', 'submitted']]);
    expect(s.verdict.verdict).toBe('GO');
  });

  it('extra credit (2 out of 0 points) is graded, has no percent, and is never a low score', () => {
    const bonus = { id: '1', title: 'Test Review', status: 'graded', score: 2, maxPoints: 0, due: at(1) };
    expect(assignmentPercent(bonus)).toBeNull();
    expect(isExtraCredit(bonus)).toBe(true);
    const s = summarizeStudent(course([bonus, { ...bonus, id: '2', title: 'Bonus due', due: at(-1) }]), DEFAULT_SETTINGS);
    expect(s.notSoGood).toEqual([]);
    expect(s.dueTomorrow).toEqual([]);
    expect(s.waiting).toEqual([]);
    expect(hasGradeData({ assignments: [bonus] })).toBe(true);
  });

  it('extra credit shows in Doing well: points out of 0, or a score over 100%', () => {
    const s = summarizeStudent(course([
      { id: '1', title: 'Bonus points', status: 'graded', score: 2, maxPoints: 0, due: at(1) },
      { id: '2', title: 'Over the top', status: 'graded', score: 53, maxPoints: 50, due: at(2) },
      { id: '3', title: 'Zero bonus', status: 'graded', score: 0, maxPoints: 0, due: at(2) },
    ]), DEFAULT_SETTINGS);
    expect(s.doingWell.map((a) => a.title)).toEqual(['Bonus points', 'Over the top']);
    expect(isBonus(s.doingWell[0])).toBe(true);
    expect(extraCreditPercent({ score: 53, maxPoints: 50 })).toBeCloseTo(6);
    expect(extraCreditPercent({ score: 50, maxPoints: 50 })).toBeNull();
    expect(isBonus({ status: 'graded', score: 0, maxPoints: 0 })).toBe(false);
    expect(extraCreditPoints({ score: 53, maxPoints: 50 })).toBe(3);
    expect(extraCreditPoints({ score: 2, maxPoints: 0 })).toBe(2);
    expect(extraCreditPoints({ score: 9, maxPoints: 10 })).toBe(0);
  });

  it('a submitted, ungraded item that is not Missing also waits (not Due soon)', () => {
    const s = summarizeStudent(course([
      { id: '1', title: 'Lab', status: 'pending', score: null, submitted: true, due: at(-1) },
    ]), DEFAULT_SETTINGS);
    expect(s.dueTomorrow).toEqual([]);
    expect(s.waiting.map((a) => a.waitingReason)).toEqual(['submitted']);
  });

  it('a Missing item without a submission still counts as Missing', () => {
    const s = summarizeStudent(course([
      { id: '1', title: 'Quiz', status: 'missing', score: null, submitted: null, due: at(3) },
    ]), DEFAULT_SETTINGS);
    expect(s.missingCount).toBe(1);
    expect(s.waiting).toEqual([]);
  });

  it('Doing well: graded B (80%) or higher in the past 10 days', () => {
    const s = summarizeStudent(course([
      { id: '1', title: 'A recent', status: 'graded', score: 9, maxPoints: 10, due: at(2) },
      { id: '2', title: 'B edge', status: 'graded', score: 8, maxPoints: 10, due: at(10) },
      { id: '3', title: 'C recent', status: 'graded', score: 7.9, maxPoints: 10, due: at(1) },
      { id: '4', title: 'A old', status: 'graded', score: 10, maxPoints: 10, due: at(11) },
      { id: '5', title: 'Letter B', status: 'graded', score: null, letterGrade: 'B+', due: at(3) },
      { id: '6', title: 'Letter C', status: 'graded', score: null, letterGrade: 'C', due: at(3) },
    ]), DEFAULT_SETTINGS);
    expect(s.doingWell.map((a) => a.title)).toEqual(['A recent', 'B edge', 'Letter B']);
  });
});


describe('Missing work from an earlier grading period', () => {
  const at = (m, d) => new Date(2026, m - 1, d, 12).toISOString();
  const periods = [
    { id: 'S1', title: 'Semester 1: 8/24/26 - 12/19/26', topLevel: true, start: at(8, 24), end: at(12, 19) },
    { id: 'Q1', title: 'Quarter 1: 8/24/2026 - 10/14/2026', topLevel: false, start: at(8, 24), end: at(10, 14) },
    { id: 'Q2', title: 'Quarter 2: 10/19/2026 - 12/15/2026', topLevel: false, start: at(10, 19), end: at(12, 15) },
    { id: 'E1', title: 'Exam 1: 12/16/2026 - 12/18/2026', topLevel: false, start: at(12, 16), end: at(12, 18) },
  ];
  const settings = { ...DEFAULT_SETTINGS, now: new Date(2026, 10, 7, 12) };
  const course = (assignments, extra = {}) => [{ id: '1', name: 'Algebra 2', grade: 90, periods, assignments, ...extra }];

  it('hides Missing work due before the current quarter (it can no longer be turned in)', () => {
    const s = summarizeStudent(course([
      { id: 'old', title: 'Q1 Worksheet', status: 'missing', score: null, due: at(9, 30) },
      { id: 'new', title: 'Q2 Quiz', status: 'missing', score: null, due: at(11, 2) },
    ]), settings);
    expect(s.missingItems.map((a) => a.title)).toEqual(['Q2 Quiz']);
    expect(s.missingCount).toBe(1);
  });

  it('keeps submitted work from last quarter waiting on the teacher', () => {
    const s = summarizeStudent(course([
      { id: 'old', title: 'Q1 Essay', status: 'missing', score: null, due: at(10, 1), submitted: true },
    ]), settings);
    expect(s.waiting.map((a) => a.title)).toEqual(['Q1 Essay']);
  });

  it('uses the semester start when a class has no quarters, and keeps everything without dates', () => {
    const noQuarters = [{ id: '1', name: 'Band', grade: 90, periods: [periods[0]], assignments: [
      { id: 'a', title: 'September Log', status: 'missing', score: null, due: at(9, 30) },
      { id: 'b', title: 'Undated', status: 'missing', score: null, due: null },
    ] }];
    expect(summarizeStudent(noQuarters, settings).missingCount).toBe(2);
    const noPeriods = [{ id: '1', name: 'Band', grade: 90, assignments: [{ id: 'a', title: 'Old', status: 'missing', score: null, due: at(9, 1) }] }];
    expect(summarizeStudent(noPeriods, settings).missingCount).toBe(1);
  });
});

describe('effective settings', () => {
  it('removed choices always use the defaults, whatever was saved', async () => {
    const { effectiveSettings, DEFAULT_SETTINGS } = await import('../../extension/src/rules.js');
    const s = effectiveSettings({ gradeVisibility: 'parent', notSoGoodDays: 30, doingWellDays: 2, showGoNoGo: false, doingWellPercent: 90 });
    expect(s.gradeVisibility).toBe(DEFAULT_SETTINGS.gradeVisibility);
    expect(s.notSoGoodDays).toBe(DEFAULT_SETTINGS.notSoGoodDays);
    expect(s.doingWellDays).toBe(10);
    expect(s.showGoNoGo).toBe(true);
    expect(s.doingWellPercent).toBe(90); // still a choice
  });
  it('family rules apply to parents; a student gets the defaults', async () => {
    const { effectiveSettings, isStudentAccount } = await import('../../extension/src/rules.js');
    const saved = { gradeThreshold: 70, missingThreshold: 4 };
    expect(effectiveSettings(saved).gradeThreshold).toBe(70);
    expect(effectiveSettings(saved, { isStudent: true })).toMatchObject({ gradeThreshold: 75, missingThreshold: 2 });
    expect(isStudentAccount({ type: 'student' }, {})).toBe(true);
    expect(isStudentAccount({ type: 'parent' }, { self: {} })).toBe(false);
    expect(isStudentAccount(null, { self: {} })).toBe(true);
    expect(isStudentAccount(null, { u1: {}, u2: {} })).toBe(false);
  });
  it('holds the slider settings to their ranges', async () => {
    const { effectiveSettings } = await import('../../extension/src/rules.js');
    expect(effectiveSettings({ gradeThreshold: 95, doingWellPercent: 50, missingThreshold: 12 })).toMatchObject({ gradeThreshold: 80, doingWellPercent: 75, missingThreshold: 6 });
    expect(effectiveSettings({ gradeThreshold: 40, doingWellPercent: 99, missingThreshold: 0 })).toMatchObject({ gradeThreshold: 60, doingWellPercent: 90, missingThreshold: 1 });
    expect(effectiveSettings({ gradeThreshold: 'x' }).gradeThreshold).toBe(75);
  });
});
