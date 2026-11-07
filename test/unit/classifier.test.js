// classifier.test.js — unit tests for extension/src/classifier.js (SPEC:
// Real-vs-skip classifier). Scoring: +40 if a period grade is posted,
// +3 per graded item (cap +30), +1 per assignment (cap +10), -15 if the
// name matches advisory/study-hall/house-group/homeroom/mentor patterns
// (case-insensitive). Thresholds: score >= 60 'include', 25-59 'check',
// < 25 'skip'. The wizard shows the recommendation; the user decides.

import { describe, it, expect } from 'vitest';
import { classifySection } from '../../extension/src/classifier.js';

describe('classifySection', () => {
  it('grade-dense real class => include', () => {
    const result = classifySection({
      name: 'Algebra 2',
      gradedItemCount: 12,
      hasPeriodGrade: true,
      assignmentCount: 15,
    });
    expect(result.recommendation).toBe('include');
    expect(result.score).toBeGreaterThanOrEqual(60);
  });

  it('advisory / study-hall with no grades => skip', () => {
    const result = classifySection({
      name: 'Advisory 11',
      gradedItemCount: 0,
      hasPeriodGrade: false,
      assignmentCount: 1,
    });
    expect(result.recommendation).toBe('skip');
    expect(result.score).toBeLessThan(25);
  });

  it('study hall name penalty applies even with a few assignments', () => {
    const result = classifySection({
      name: 'SU Study Hall',
      gradedItemCount: 0,
      hasPeriodGrade: false,
      assignmentCount: 5,
    });
    expect(result.recommendation).toBe('skip');
    expect(result.reasons.join(' ').toLowerCase()).toContain('study-hall');
  });

  it('house group and homeroom names are penalised (case-insensitive)', () => {
    for (const name of ['House Group 3', 'HOUSE GROUP 1', 'Homeroom', 'Communications Block']) {
      const result = classifySection({
        name,
        gradedItemCount: 0,
        hasPeriodGrade: false,
        assignmentCount: 2,
      });
      expect(result.score).toBeLessThan(25);
      expect(result.recommendation).toBe('skip');
    }
  });

  it('in-between class (some grades, no period grade) => check', () => {
    const result = classifySection({
      name: 'Band',
      gradedItemCount: 8,
      hasPeriodGrade: false,
      assignmentCount: 10,
    });
    expect(result.recommendation).toBe('check');
    expect(result.score).toBeGreaterThanOrEqual(25);
    expect(result.score).toBeLessThan(60);
  });

  it('period grade alone is not enough for include without graded items', () => {
    const result = classifySection({
      name: 'Chemistry A & B',
      gradedItemCount: 2,
      hasPeriodGrade: true,
      assignmentCount: 4,
    });
    // 40 + 6 + 4 = 50 => check, not include.
    expect(result.score).toBe(50);
    expect(result.recommendation).toBe('check');
  });

  it('caps apply: graded items cap at +30, assignments cap at +10', () => {
    const result = classifySection({
      name: 'United States History',
      gradedItemCount: 100,
      hasPeriodGrade: true,
      assignmentCount: 100,
    });
    // 40 + 30 (capped) + 10 (capped) = 80.
    expect(result.score).toBe(80);
    expect(result.recommendation).toBe('include');
  });

  it('mentor-group name is penalised', () => {
    const result = classifySection({
      name: 'Marketplace Mentor Group',
      gradedItemCount: 1,
      hasPeriodGrade: false,
      assignmentCount: 3,
    });
    expect(result.recommendation).toBe('skip');
  });
});
