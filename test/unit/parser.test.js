// parser.test.js — unit tests for extension/src/parser.js (SPEC: Grades HTML
// parser). Parses the fixture HTML files in test/mock-server/fixtures/.
// Fixtures are MODELLED on the known Schoology Grades structure — NOT verified
// live Schoology DOM (see SPEC.md and each fixture's header comment).

import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGradesHtml } from '../../extension/src/parser.js';

const FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../mock-server/fixtures',
);

async function loadFixture(name) {
  return readFile(path.join(FIXTURES_DIR, name), 'utf8');
}

describe('parseGradesHtml — student fixtures (Alex Student)', () => {
  it('parses American Literature: 1 course, grade 82, 5 assignments, exactly 1 Missing', async () => {
    const html = await loadFixture('student-grades-american-literature.html');
    const { courses, parseWarnings } = parseGradesHtml(html);
    expect(parseWarnings).toEqual([]);
    expect(courses).toHaveLength(1);
    const [course] = courses;
    expect(course.id).toBe('1002');
    expect(course.name).toBe('American Literature');
    expect(course.grade).toBe(82);
    expect(course.assignments).toHaveLength(5);

    const missing = course.assignments.filter((a) => a.status === 'missing');
    expect(missing).toHaveLength(1);
    expect(missing[0].title).toBe('Propaganda Script');
    // Parser stores no-time dues as end of day in the school timezone, so the
    // UTC ISO string can roll to the next calendar day; check the date in
    // America/New_York instead of matching the raw string.
    expect(
      new Date(missing[0].due).toLocaleDateString('en-CA', {
        timeZone: 'America/New_York',
      }),
    ).toBe('2026-11-03');

    const graded = course.assignments.filter((a) => a.status === 'graded');
    expect(graded.map((a) => a.title)).toEqual(
      expect.arrayContaining(['Rhetoric Analysis', 'Vocabulary Quiz 7']),
    );
    const rhetoric = graded.find((a) => a.title === 'Rhetoric Analysis');
    expect(rhetoric.score).toBe(42);
    expect(rhetoric.maxPoints).toBe(50);

    expect(course.assignments.find((a) => a.title === 'Discussion Post: Week 9').status).toBe('incomplete');
    expect(course.assignments.find((a) => a.title === 'Poetry Response Draft').status).toBe('pending');
  });

  it('parses Algebra 2: grade 68 (below 75), graded scores, and a 0/10 is NOT Missing', async () => {
    const html = await loadFixture('student-grades-algebra2.html');
    const { courses } = parseGradesHtml(html);
    expect(courses).toHaveLength(1);
    expect(courses[0].grade).toBe(68);
    expect(courses[0].assignments).toHaveLength(4);
    expect(courses[0].assignments.filter((a) => a.status === 'missing')).toHaveLength(0);
    // A plain numeric 0 is NEVER Missing (SPEC) — the 0/10 homework is graded.
    const zero = courses[0].assignments.find((a) => a.title === 'Polynomials Homework');
    expect(zero.status).toBe('graded');
    expect(zero.score).toBe(0);
    expect(zero.maxPoints).toBe(10);
  });

  it('parses US History: grade 95, excused status detected', async () => {
    const html = await loadFixture('student-grades-us-history.html');
    const { courses } = parseGradesHtml(html);
    expect(courses).toHaveLength(1);
    expect(courses[0].grade).toBe(95);
    const excused = courses[0].assignments.find((a) => a.title === 'Primary Source Analysis');
    expect(excused.status).toBe('excused');
    expect(excused.score).toBeNull();
  });

  it('parses the advisory course: no period grade (null), no graded items', async () => {
    const html = await loadFixture('student-grades-advisory.html');
    const { courses } = parseGradesHtml(html);
    expect(courses).toHaveLength(1);
    expect(courses[0].name).toBe('BPL Advisory 11');
    expect(courses[0].grade).toBeNull();
    expect(courses[0].assignments.filter((a) => a.status === 'graded')).toHaveLength(0);
    expect(courses[0].assignments).toHaveLength(1);
  });
});

describe('parseGradesHtml — parent fixtures', () => {
  it('parses Luis: 2 courses, exactly 2 Missing, lowest class grade 55', async () => {
    const html = await loadFixture('parent-grades-luis.html');
    const { courses } = parseGradesHtml(html);
    expect(courses).toHaveLength(2);
    const lit = courses.find((c) => c.name === 'BPL American Literature');
    expect(lit.grade).toBe(55);
    const missing = courses.flatMap((c) => c.assignments).filter((a) => a.status === 'missing');
    expect(missing.map((a) => a.title).sort()).toEqual(
      ['Propaganda Script', 'Unit 2 Contexts Essay'],
    );
    const history = courses.find((c) => c.name === 'United States History');
    expect(history.grade).toBe(88);
    expect(Math.min(...courses.map((c) => c.grade))).toBe(55);
  });

  it('parses Emma: 2 courses, exactly 1 Missing, lowest class grade >= 90', async () => {
    const html = await loadFixture('parent-grades-emma.html');
    const { courses } = parseGradesHtml(html);
    expect(courses).toHaveLength(2);
    const missing = courses.flatMap((c) => c.assignments).filter((a) => a.status === 'missing');
    expect(missing).toHaveLength(1);
    expect(missing[0].title).toBe('Poetry Analysis Essay');
    expect(Math.min(...courses.map((c) => c.grade))).toBe(92);
  });

  it('parses the combined parent report: 4 courses, 3 Missing total', async () => {
    const html = await loadFixture('parent-grades-all.html');
    const { courses } = parseGradesHtml(html);
    expect(courses).toHaveLength(4);
    const missing = courses.flatMap((c) => c.assignments).filter((a) => a.status === 'missing');
    expect(missing).toHaveLength(3);
  });
});

describe('parseGradesHtml — PARSE_EMPTY self-check', () => {
  it('returns error PARSE_EMPTY for a grades-looking page with no parseable rows', () => {
    const html = `<!doctype html><html><body>
      <div class="gradebook">
        <section class="course-grades" data-course-id="9999" data-course-name="Empty Course">
          <h2 class="course-name">Empty Course</h2>
          <table class="grades-table"><tbody></tbody></table>
        </section>
      </div>
    </body></html>`;
    const result = parseGradesHtml(html);
    expect(result.courses).toEqual([]);
    expect(result.error).toBe('PARSE_EMPTY');
    expect(result.parseWarnings.length).toBeGreaterThan(0);
  });

  it('does NOT return PARSE_EMPTY for a page that is not a grades page at all', () => {
    const result = parseGradesHtml('<!doctype html><html><body><h1>Welcome</h1></body></html>');
    expect(result.error).toBeUndefined();
    expect(result.courses).toEqual([]);
  });
});
