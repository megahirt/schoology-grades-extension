import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_SETTINGS } from '../../extension/src/rules.js';
import { renderPrintSheet, fitToOnePage, PAGE, PRINT_CSS } from '../../extension/src/print-view.js';

// The made-up demo family (anchored on 2026-11-06).
const demo = JSON.parse(readFileSync(new URL('../../extension/popup/demo-data.json', import.meta.url), 'utf8')).dashboards;
const NOW = Date.parse('2026-11-06T12:00:00');
const settings = { ...DEFAULT_SETTINGS, showGoNoGo: true, gradeVisibility: 'both' };

describe('print sheet', () => {
  it('lays out one child: name, verdict for a parent, the lists and the class grades', () => {
    const html = renderPrintSheet({ d: demo['demo-sam'], settings, isParentView: true, now: NOW });
    expect(html).toContain('Sam Rivera');
    expect(html).toMatch(/class="p-verdict nogo">NO-GO</);
    expect(html).toContain('Missing · 2');
    expect(html).toContain('Persuasive Essay Draft');
    expect(html).toMatch(/<th class="n">Quarter 2<\/th>/);
    expect(html).toMatch(/<td class="n low">55%<\/td>/); // below the passing grade, in red
    expect(html).not.toContain('Waiting on the teacher');
    expect(html).toContain('<section class="p-sec well">');
    expect(html).toMatch(/<section class="p-sec missing">.*?<span class="p-box"/);
    expect(html).not.toMatch(/<section class="p-sec well">(?:(?!<\/section>).)*p-box/); // boxes only on work to do
  });

  it('shows no verdict to a student and no grades where grades are hidden', () => {
    const student = renderPrintSheet({ d: demo['demo-sam'], settings, isParentView: false, now: NOW });
    expect(student).not.toContain('p-verdict');
    const hidden = renderPrintSheet({ d: demo['demo-sam'], settings: { ...settings, gradeVisibility: 'parent' }, isParentView: false, now: NOW });
    expect(hidden).not.toMatch(/\d+%<\/td>/);
    expect(hidden).not.toContain('Recent low grades');
  });

  it('leaves out work the student marked turned in', () => {
    const before = renderPrintSheet({ d: demo['demo-sam'], settings, isParentView: false, now: NOW });
    const id = String(demo['demo-sam'].courses.flatMap((c) => c.assignments).find((a) => a.title === 'Persuasive Essay Draft').id);
    const after = renderPrintSheet({ d: demo['demo-sam'], settings, marks: { turnedIn: [id] }, isParentView: false, now: NOW });
    expect(before).toContain('Missing · 2');
    expect(after).toContain('Missing · 1');
  });

  it('prints on Letter paper', () => {
    expect(PRINT_CSS).toContain('@page { size: letter; margin: 0.4in; }');
    expect(PAGE).toEqual({ width: 739, height: 979 });
  });
});

// A stand-in for the laid-out sheet: each list item is 20 px tall.
function fakeSheet(counts, base = 100) {
  const doc = { createElement: () => fakeLi('more') };
  function fakeLi(cls = '') {
    const li = { className: cls, textContent: '', parent: null, remove() { this.parent.items.splice(this.parent.items.indexOf(this), 1); } };
    return li;
  }
  const uls = counts.map((n) => {
    const ul = { items: [], dataset: { total: String(n) } };
    ul.querySelectorAll = () => ul.items.filter((li) => li.className !== 'more');
    ul.querySelector = () => ul.items.find((li) => li.className === 'more') || null;
    ul.append = (li) => { li.parent = ul; ul.items.push(li); };
    for (let i = 0; i < n; i++) ul.append(fakeLi());
    return ul;
  });
  return {
    uls,
    style: {},
    ownerDocument: doc,
    querySelectorAll: () => uls,
    get scrollHeight() { return base + 20 * uls.reduce((t, ul) => t + ul.items.length, 0); },
  };
}

describe('fitToOnePage', () => {
  it('leaves a sheet that fits alone', () => {
    const sheet = fakeSheet([3, 2]);
    expect(fitToOnePage(sheet, 500)).toEqual({ trimmed: 0, scale: 1 });
    expect(sheet.style.zoom).toBeUndefined();
  });

  it('cuts the longest list first, keeping a "+N more" line, until it fits', () => {
    const sheet = fakeSheet([30, 5]);
    const r = fitToOnePage(sheet, 500); // room for 20 lines
    expect(r.scale).toBe(1);
    expect(sheet.scrollHeight).toBeLessThanOrEqual(500);
    const [long, short] = sheet.uls;
    expect(short.items).toHaveLength(5); // the short list keeps everything
    const more = long.items.at(-1);
    expect(more.className).toBe('more');
    expect(more.textContent).toBe(`+${30 - (long.items.length - 1)} more (see the dashboard)`);
  });

  it('shrinks the sheet when cutting every list to 3 still is not enough', () => {
    const sheet = fakeSheet([10, 10], 900);
    const r = fitToOnePage(sheet, 979);
    expect(sheet.uls.map((u) => u.items.filter((li) => li.className !== 'more').length)).toEqual([3, 3]);
    expect(r.scale).toBeLessThan(1);
    expect(sheet.scrollHeight * r.scale).toBeLessThanOrEqual(979);
    expect(sheet.style.zoom).toBe(String(r.scale));
  });
});
