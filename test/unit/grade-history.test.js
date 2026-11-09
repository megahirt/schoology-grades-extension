// grade-history.test.js — the class grade over time (extension/src/grade-history.js).
import { describe, it, expect } from 'vitest';
import { gradeHistory } from '../../extension/src/grade-history.js';

const day = (m, d) => new Date(2026, m - 1, d, 12).toISOString();
const NOW = new Date(2026, 10, 7, 14).getTime();
const periods = (q2grade = null) => [
  { id: 'S1', title: 'Semester 1: 8/24/26 - 12/19/26', topLevel: true, start: day(8, 24), end: day(12, 19), grade: null },
  { id: 'Q1', title: 'Quarter 1: 8/24/2026 - 10/14/2026', topLevel: false, start: day(8, 24), end: day(10, 14), grade: null },
  { id: 'Q2', title: 'Quarter 2: 10/19/2026 - 12/15/2026', topLevel: false, start: day(10, 19), end: day(12, 15), grade: q2grade },
];
const item = (id, cat, due, score, max, extra = {}) => ({ id, title: id, categoryId: cat, due, score, maxPoints: max, status: 'graded', ...extra });
const last = (seg) => seg.line[seg.line.length - 1].grade;

describe('gradeHistory', () => {
  it('points-based: running points earned / possible, each quarter starting fresh', () => {
    const h = gradeHistory({
      periods: periods(),
      categories: [{ id: 'Q1-1', parentId: 'Q1', weight: null }, { id: 'Q2-1', parentId: 'Q2', weight: null }],
      assignments: [
        item('a', 'Q1-1', day(9, 1), 8, 10),
        item('b', 'Q1-1', day(9, 15), 20, 20),
        item('c', 'Q2-1', day(10, 25), 6, 10),
      ],
    }, { now: NOW });
    expect(h.segments.map((s) => s.label)).toEqual(['Quarter 1', 'Quarter 2']);
    expect(h.segments[0].line.map((p) => Math.round(p.grade))).toEqual([80, 93]); // 8/10, 28/30
    expect(last(h.segments[1])).toBe(60); // fresh start: 6/10
    expect(h.points.map((p) => p.pct)).toEqual([80, 100, 60]);
    expect(h.points.map((p) => [p.got, p.max])).toEqual([[8, 10], [20, 20], [6, 10]]); // points, for the dot sizes
    expect(h.start).toBe(Date.parse(day(8, 24)));
  });

  it('weighted categories combine by weight', () => {
    const h = gradeHistory({
      periods: periods(),
      categories: [{ id: 'Q2-t', parentId: 'Q2', weight: 60 }, { id: 'Q2-h', parentId: 'Q2', weight: 40 }],
      assignments: [item('test', 'Q2-t', day(10, 20), 50, 100), item('hw', 'Q2-h', day(10, 21), 10, 10)],
    }, { now: NOW });
    const line = h.segments[0].line.map((p) => p.grade);
    expect(line[0]).toBe(50); // only tests graded yet
    expect(line[1]).toBeCloseTo(70); // 0.6*50 + 0.4*100
  });

  it('counts Missing work as zero, sized from the grade Schoology shows', () => {
    const h = gradeHistory({
      periods: periods(55),
      categories: [{ id: 'Q2-1', parentId: 'Q2', weight: null }],
      assignments: [
        item('a', 'Q2-1', day(10, 20), 40, 50),
        item('b', 'Q2-1', day(10, 30), 45, 50),
        { id: 'm', title: 'm', categoryId: 'Q2-1', due: day(11, 3), score: null, maxPoints: null, status: 'missing' },
      ],
    }, { now: NOW });
    const seg = h.segments[0];
    expect(seg.line.length).toBe(3);
    expect(seg.line[2].missing).toBe(true);
    expect(last(seg)).toBeCloseTo(55, 5); // ends on Schoology's number
    expect(h.points.length).toBe(2); // Missing work has no dot of its own
  });

  it('leaves out excused, ungraded, letter-only and future work', () => {
    const h = gradeHistory({
      periods: periods(),
      categories: [{ id: 'Q2-1', parentId: 'Q2', weight: null }],
      assignments: [
        item('a', 'Q2-1', day(10, 20), 9, 10),
        item('x', 'Q2-1', day(10, 21), null, 10, { status: 'excused' }),
        item('p', 'Q2-1', day(10, 22), null, 10, { status: 'pending' }),
        item('l', 'Q2-1', day(10, 23), null, null, { letterGrade: 'A' }),
        item('f', 'Q2-1', day(11, 30), 10, 10),
      ],
    }, { now: NOW });
    expect(h.points.map((p) => p.pct)).toEqual([90]);
    expect(last(h.segments[0])).toBe(90);
  });
});

describe('extra credit (a score out of 0 points)', () => {
  it('adds its points to what was earned and nothing to what was possible, with no dot', () => {
    const h = gradeHistory({
      periods: periods(),
      categories: [{ id: 'Q1-1', parentId: 'Q1', weight: null }],
      assignments: [
        item('quiz', 'Q1-1', day(9, 1), 29, 30),
        item('review', 'Q1-1', day(9, 10), 2, 0), // extra credit
        item('test', 'Q1-1', day(9, 15), 60, 60),
      ],
    }, { now: NOW });
    // 29/30, then 31/30 (not a 2% score worth 100 points), then 91/90.
    expect(h.segments[0].line.map((p) => Math.round(p.grade * 10) / 10)).toEqual([96.7, 103.3, 101.1]);
    expect(h.points.map((p) => p.title)).toEqual(['quiz', 'test']);
  });
  it('first in a weighted category: no grade yet rather than a division by zero', () => {
    const h = gradeHistory({
      periods: periods(),
      categories: [{ id: 'Q1-1', parentId: 'Q1', weight: 50 }],
      assignments: [item('bonus', 'Q1-1', day(9, 1), 2, 0), item('quiz', 'Q1-1', day(9, 2), 8, 10)],
    }, { now: NOW });
    expect(h.segments[0].line.map((p) => p.grade)).toEqual([100]);
  });
});

describe('quarter dividers', () => {
  it('mark where each later grading period starts', () => {
    const h = gradeHistory({
      periods: periods(),
      categories: [{ id: 'Q1-1', parentId: 'Q1', weight: null }, { id: 'Q2-1', parentId: 'Q2', weight: null }],
      assignments: [item('a', 'Q1-1', day(9, 1), 8, 10), item('c', 'Q2-1', day(10, 25), 6, 10)],
    }, { now: NOW });
    expect(h.dividers).toEqual([{ t: Date.parse(day(10, 19)), label: 'Q2' }]);
    expect(h.segments[1].line[0]).toMatchObject({ got: 6, max: 10 });
  });
});
