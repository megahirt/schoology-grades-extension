import { describe, it, expect } from 'vitest';
import { smoothPath, linePoints, renderGradeChart, dotRadius, DOT_R, hoverText } from '../../extension/src/grade-chart.js';

// Sample a cubic Bézier path "M…C…C…" at many t values.
function samples(d) {
  const nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
  let [x0, y0] = nums.slice(0, 2);
  const out = [];
  for (let i = 2; i < nums.length; i += 6) {
    const [x1, y1, x2, y2, x3, y3] = nums.slice(i, i + 6);
    for (let k = 0; k <= 20; k++) {
      const t = k / 20; const u = 1 - t;
      out.push({ seg: (i - 2) / 6, y: u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3 });
    }
    x0 = x3; y0 = y3;
  }
  return out;
}

describe('smooth class-grade line', () => {
  const pts = [[0, 50], [10, 40], [20, 40], [30, 70], [40, 65]];
  it('passes through every point', () => {
    const d = smoothPath(pts);
    for (const [x, y] of pts.slice(1)) expect(d).toContain(`${x.toFixed(1)},${y.toFixed(1)}`);
    expect(d.startsWith('M0.0,50.0')).toBe(true);
  });
  it('never overshoots between two grades', () => {
    for (const s of samples(smoothPath(pts))) {
      const [a, b] = [pts[s.seg][1], pts[s.seg + 1][1]];
      expect(s.y).toBeGreaterThanOrEqual(Math.min(a, b) - 0.06);
      expect(s.y).toBeLessThanOrEqual(Math.max(a, b) + 0.06);
    }
  });
  it('joins every grading period into one connected stroke', () => {
    const history = {
      start: 0, end: 100,
      points: [{ t: 10, pct: 80, title: 'a' }, { t: 60, pct: 90, title: 'b' }],
      segments: [
        { periodId: 'Q1', label: 'Quarter 1', line: [{ t: 10, grade: 80 }, { t: 30, grade: 85 }] },
        { periodId: 'Q2', label: 'Quarter 2', line: [{ t: 60, grade: 90 }, { t: 80, grade: 88 }] },
      ],
    };
    expect(linePoints(history).map((p) => p.t)).toEqual([10, 30, 60, 80]);
    const svg = renderGradeChart(history, { threshold: 75, name: 'Math' });
    expect(svg.match(/class="gc-line"/g)).toHaveLength(1);
    expect(svg).not.toContain('<polyline');
  });
});

describe('assignment dots sized by points', () => {
  const NOW = new Date(2026, 10, 7).getTime();
  const START = new Date(2026, 7, 24).getTime();
  const pt = (day, got, max, title) => ({ t: new Date(2026, 9, day).getTime(), pct: (got / max) * 100, title, got, max });
  const history = {
    start: START,
    end: NOW,
    points: [pt(1, 9, 10, 'Check-in'), pt(5, 80, 100, 'Unit Test'), { t: new Date(2026, 9, 9).getTime(), pct: 90, title: 'Bare', got: 90, max: null }],
    segments: [{ periodId: 'Q1', label: 'Quarter 1', line: [{ t: new Date(2026, 9, 1).getTime(), grade: 90 }, { t: new Date(2026, 9, 5).getTime(), grade: 80.9 }] }],
  };
  const radius = (svg, title) => Number(svg.match(new RegExp(`r="([\\d.]+)" class="gc-dot[^"]*"><title>${title}`))[1]);

  it('area grows with points: a 10-point item is a third the width of a 100-point one', () => {
    expect(dotRadius(100, 100)).toBe(DOT_R.max);
    expect(dotRadius(10, 100)).toBeCloseTo(DOT_R.max * Math.sqrt(0.1));
    expect(dotRadius(1, 1000)).toBe(DOT_R.min);
    expect(dotRadius(null, 100)).toBe(DOT_R.unknown);
  });
  it('draws the biggest dots first and shows the points in the tooltip', () => {
    const svg = renderGradeChart(history, { threshold: 75, name: 'Math' });
    expect(radius(svg, 'Unit Test')).toBe(7);
    expect(radius(svg, 'Check-in')).toBeCloseTo(2.2, 1);
    expect(svg.indexOf('Unit Test')).toBeLessThan(svg.indexOf('Check-in'));
    expect(svg).toContain('Unit Test · Oct 5 · 80/100 pts · 80%');
    expect(svg).toContain('Bare · Oct 9 · 90%');
  });
});

describe('hover text and quarter lines', () => {
  const t = new Date(2026, 9, 22).getTime();
  it('date, shortened title and the assignment grade (percent or points)', () => {
    const p = { t, title: '3.5 Lesson Check on Balancing Equations', got: 2.5, max: 3, grade: 91 };
    expect(hoverText(p)).toBe('Oct 22 · 3.5 Lesson Check on Bal… · 83%');
    expect(hoverText(p, 'points')).toBe('Oct 22 · 3.5 Lesson Check on Bal… · 2.5/3 pts');
    expect(hoverText({ t, title: 'Binder Check', missing: true, got: 0, max: 4 })).toBe('Oct 22 · Binder Check · Missing');
    expect(hoverText({ t, title: 'Test Review', got: 2, max: 0 })).toBe('Oct 22 · Test Review · +2 pts');
  });
  it('draws a dotted, labelled line where each later quarter starts', () => {
    const START = new Date(2026, 7, 24).getTime();
    const NOW = new Date(2026, 10, 7).getTime();
    const q2 = new Date(2026, 9, 19).getTime();
    const svg = renderGradeChart({
      start: START,
      end: NOW,
      points: [{ t: q2 + 86400000, pct: 90, title: 'Quiz', got: 9, max: 10 }],
      segments: [{ periodId: 'Q2', label: 'Quarter 2', line: [{ t: q2 + 86400000, grade: 90 }] }],
      dividers: [{ t: q2, label: 'Q2' }],
    });
    expect(svg).toMatch(/<line [^>]*class="gc-period"\/><text [^>]*class="gc-plab">Q2<\/text>/);
  });
});
