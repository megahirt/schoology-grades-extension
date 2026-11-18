import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOLIDAYS, holidayFor } from '../../extension/src/holidays.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const at = (y, m, d) => new Date(y, m - 1, d, 12, 0);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dateOf = (slug, year) => iso(HOLIDAYS.find((h) => h.slug === slug).date(year));

describe('holiday dates', () => {
  it('works out the moving days for the 2026-27 school year', () => {
    expect(dateOf('labor-day', 2026)).toBe('2026-09-07');
    expect(dateOf('grandparents-day', 2026)).toBe('2026-09-13');
    expect(dateOf('indigenous-peoples-day', 2026)).toBe('2026-10-12');
    expect(dateOf('election-day', 2026)).toBe('2026-11-03');
    expect(dateOf('thanksgiving', 2026)).toBe('2026-11-26');
    expect(dateOf('mlk-day', 2027)).toBe('2027-01-18');
    expect(dateOf('presidents-day', 2027)).toBe('2027-02-15');
    expect(dateOf('daylight-saving-time', 2027)).toBe('2027-03-14');
    expect(dateOf('easter', 2027)).toBe('2027-03-28');
    expect(dateOf('teacher-appreciation-week', 2027)).toBe('2027-05-03');
    expect(dateOf('mothers-day', 2027)).toBe('2027-05-09');
    expect(dateOf('memorial-day', 2027)).toBe('2027-05-31');
  });

  it('gets Easter right in other years', () => {
    expect(dateOf('easter', 2026)).toBe('2026-04-05');
    expect(dateOf('easter', 2028)).toBe('2028-04-16');
    expect(dateOf('easter', 2030)).toBe('2030-04-21');
  });

  it('has an icon for every holiday, and a holiday for every icon', () => {
    for (const h of HOLIDAYS) expect(existsSync(path.join(ROOT, 'extension/icons/holidays', `${h.slug}.png`)), h.slug).toBe(true);
    expect(new Set(HOLIDAYS.map((h) => h.slug)).size).toBe(HOLIDAYS.length);
  });
});

describe('holidayFor', () => {
  it('shows from three days before through the day itself', () => {
    expect(holidayFor(at(2026, 12, 21))?.slug).toBe('winter-solstice');
    expect(holidayFor(at(2026, 12, 22))?.slug).toBe('christmas');
    expect(holidayFor(at(2026, 12, 25))?.slug).toBe('christmas');
    expect(holidayFor(at(2026, 12, 26))).toBeNull();
    expect(holidayFor(at(2026, 12, 18))?.slug).toBe('winter-solstice');
    expect(holidayFor(at(2026, 12, 17))).toBeNull();
  });

  it('labels the day and its date for the hover', () => {
    expect(holidayFor(at(2026, 12, 23)).label).toBe('Christmas – Dec 25');
    expect(holidayFor(at(2027, 2, 13)).label).toBe("Valentine's Day – Feb 14");
  });

  it('looks ahead into the new year at the end of December', () => {
    const h = holidayFor(at(2026, 12, 29));
    expect(h.slug).toBe('new-years-day');
    expect(iso(h.date)).toBe('2027-01-01');
  });

  it('picks the sooner day when two overlap', () => {
    expect(holidayFor(at(2026, 9, 11)).slug).toBe('patriot-day');
    expect(holidayFor(at(2026, 9, 12)).slug).toBe('grandparents-day');
    expect(holidayFor(at(2026, 10, 31)).slug).toBe('halloween');
    expect(holidayFor(at(2026, 11, 1)).slug).toBe('election-day');
    expect(holidayFor(at(2027, 3, 14)).slug).toBe('pi-day');
    expect(holidayFor(at(2027, 3, 15)).slug).toBe('st-patricks-day');
  });

  it('shows nothing on ordinary days, including summer', () => {
    expect(holidayFor(at(2026, 11, 18))).toBeNull();
    expect(holidayFor(at(2027, 7, 15))).toBeNull();
  });
});
