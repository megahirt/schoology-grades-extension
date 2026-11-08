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
