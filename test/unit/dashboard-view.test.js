import { describe, it, expect } from 'vitest';
import { renderStudentBody } from '../../extension/src/dashboard-view.js';
import { DEFAULT_SETTINGS } from '../../extension/src/rules.js';

// Made-up data only.
const now = new Date();
const iso = (days, h = 23) => { const d = new Date(now); d.setDate(d.getDate() + days); d.setHours(h, 59, 0, 0); return d.toISOString(); };

const courses = [{
  id: 'c1',
  name: 'American Literature',
  grade: 88,
  assignments: [
    { id: 'm1', title: 'Small Missing', status: 'missing', due: iso(-2) },
    { id: 'm2', title: 'Big Missing', status: 'missing', due: iso(-3), maxPoints: 50 },
    { id: 'm3', title: 'Medium Missing', status: 'missing', due: iso(-1), maxPoints: 20 },
    { id: 'd1', title: 'Due Small', status: 'pending', due: iso(1, 10), maxPoints: 5 },
    { id: 'd2', title: 'Due Big', status: 'pending', due: iso(1, 20), maxPoints: 30 },
    { id: 'g1', title: 'Great Quiz', status: 'graded', score: 9, maxPoints: 10, due: iso(-1) },
  ],
}];

function body() {
  return renderStudentBody({ studentName: 'Sam Rivera', courses }, 'u1', { ...DEFAULT_SETTINGS }, { turnedIn: [], done: [] }, { isParentView: true }).html;
}

describe('assignment point values', () => {
  it('shows what graded work is worth, not what was earned', () => {
    const html = body();
    expect(html).toContain('Great Quiz');
    expect(html).toMatch(/American Literature · 10 pts/);
    expect(html).not.toMatch(/9\/10/);
  });
  it('sorts Missing by point value, largest first, unknown last', () => {
    const html = body();
    const order = ['Big Missing', 'Medium Missing', 'Small Missing'].map((t) => html.indexOf(t));
    expect(order.every((i) => i > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
  it('sorts Due soon within a day by point value, largest first', () => {
    const html = body();
    expect(html.indexOf('Due Big')).toBeLessThan(html.indexOf('Due Small'));
  });
});

describe('trend line next to each class', () => {
  const start = new Date(now); start.setDate(start.getDate() - 70);
  const qStart = new Date(now); qStart.setDate(qStart.getDate() - 20);
  const periods = [
    { id: 'S1', title: 'Semester 1', topLevel: true, grade: 85, start: start.toISOString(), end: iso(60) },
    { id: 'Q1', parentId: 'S1', title: 'Quarter 1', topLevel: false, grade: 80, start: start.toISOString(), end: iso(-21) },
    { id: 'Q2', parentId: 'S1', title: 'Quarter 2', topLevel: false, grade: 90, start: qStart.toISOString(), end: iso(60) },
  ];
  const graded = (n, pfx) => Array.from({ length: n }, (_, i) => ({ id: `${pfx}${i}`, title: `Item ${i}`, status: 'graded', score: 8 + (i % 3), maxPoints: 10, due: iso(-2 - i * 3), periodId: 'Q2', categoryId: 'Q2-1' }));
  const cls = (over) => ({ grade: 90, quarterGrade: 90, overallGrade: 85, gradeLabel: 'Quarter 2', gradeSource: 'Quarter 2', periods, ...over });
  const html = (list) => renderStudentBody({ studentName: 'Sam Rivera', courses: list }, 'u1', { ...DEFAULT_SETTINGS }, { turnedIn: [], done: [] }, { isParentView: true }).html;

  it('shows the ▲ pill instead of a trend line when the class is up on last quarter', () => {
    const out = html([cls({ id: 'a', name: 'Up Class', assignments: graded(6, 'a') })]);
    expect(out).toContain('up-pill');
    expect(out).not.toContain('trend-toggle');
  });
  it('shows a trend line (opening the chart) when there is no pill and 5+ grades', () => {
    const out = html([cls({ id: 'b', name: 'Flat Class', quarterGrade: 80, grade: 80, assignments: graded(6, 'b') })]);
    expect(out).not.toContain('up-pill');
    expect(out).toMatch(/class="trend-toggle" data-act="toggle-chart"[^>]*aria-label="Flat Class trend: from \d+% to \d+% over 6 grades\./);
  });
  it('says "trend after 5 grades" until there are enough grades', () => {
    const out = html([cls({ id: 'c', name: 'New Class', quarterGrade: 80, grade: 80, assignments: graded(3, 'c') })]);
    expect(out).toContain('trend after 5 grades');
  });
});
