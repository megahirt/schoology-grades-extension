// rules.test.js — unit tests for extension/src/rules.js (SPEC: Rules engine).
// Defaults are the shipped default rules: gradeThreshold 75 (75 passes),
// missingThreshold 2 (NO-GO if missingCount >= 2; one Missing alone is GO).
// Badge wording (SPEC): "NO-GO — Missing work", "NO-GO — Low grades",
// "NO-GO — Missing work + Low grades", otherwise "GO".

import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, computeVerdict, summarizeStudent } from '../../extension/src/rules.js';

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
  it('counts letter grades as graded: A/B/C doing well, D/F not so good, never due soon', () => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T23:59:00`;
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
