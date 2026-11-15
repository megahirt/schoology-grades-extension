import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The Edge listing kit is pasted into Partner Center by hand. These checks
// hold it to Microsoft's limits, so a later edit can't quietly break them.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const kit = readFileSync(path.join(ROOT, 'store/edge/README.md'), 'utf8');

// The first ```text block after a marker line.
function blockAfter(marker) {
  const at = kit.indexOf(marker);
  expect(at, `"${marker}" is in the kit`).toBeGreaterThan(-1);
  const m = /```text\n([\s\S]*?)\n```/.exec(kit.slice(at));
  expect(m, `a text block follows "${marker}"`).not.toBeNull();
  return m[1];
}

describe('Edge listing kit', () => {
  it('has a description within Edge\'s 250 to 10,000 characters', () => {
    const text = blockAfter('**Description**');
    expect(text.length).toBeGreaterThanOrEqual(250);
    expect(text.length).toBeLessThanOrEqual(10000);
  });

  it('never says "Chrome" in text that gets pasted into the listing', () => {
    // Certification rejects listings that name Chrome. Every ```text block
    // is something the owner pastes in.
    const pasted = [...kit.matchAll(/```text\n([\s\S]*?)\n```/g)].map((m) => m[1]);
    expect(pasted.length).toBeGreaterThan(5);
    for (const text of pasted) expect(text).not.toMatch(/chrome/i);
  });

  it('keeps search terms within 7 terms, 30 characters each, 21 words in all', () => {
    const terms = blockAfter('**Search terms**').split('\n').map((t) => t.trim()).filter(Boolean);
    expect(terms.length).toBeGreaterThan(0);
    expect(terms.length).toBeLessThanOrEqual(7);
    for (const t of terms) expect(t.length, t).toBeLessThanOrEqual(30);
    expect(terms.join(' ').split(/\s+/).length).toBeLessThanOrEqual(21);
  });

  it('points at images that exist', () => {
    const files = [...kit.matchAll(/`((?:\.\.\/chrome\/)?[\w-]+\.png)`/g)].map((m) => m[1]);
    expect(files.length).toBeGreaterThan(3);
    for (const f of files) expect(existsSync(path.join(ROOT, 'store/edge', f)), f).toBe(true);
  });
});
