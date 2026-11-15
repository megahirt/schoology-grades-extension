import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The Firefox listing kit is pasted into addons.mozilla.org by hand. These
// checks hold it to Mozilla's limits and to what the package really says.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const kit = readFileSync(path.join(ROOT, 'store/firefox/README.md'), 'utf8');
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8'));

function blockAfter(marker) {
  const at = kit.indexOf(marker);
  expect(at, `"${marker}" is in the kit`).toBeGreaterThan(-1);
  const m = /```text\n([\s\S]*?)\n```/.exec(kit.slice(at));
  expect(m, `a text block follows "${marker}"`).not.toBeNull();
  return m[1];
}

describe('Firefox listing kit', () => {
  it('has a summary within 250 characters that matches the manifest', () => {
    const summary = blockAfter('**Summary**');
    expect(summary.length).toBeLessThanOrEqual(250);
    expect(summary).toBe(manifest.description);
  });

  it('names no other browser in text that gets pasted into the listing', () => {
    const pasted = [...kit.matchAll(/```text\n([\s\S]*?)\n```/g)].map((m) => m[1]);
    expect(pasted.length).toBeGreaterThanOrEqual(3);
    for (const text of pasted) expect(text).not.toMatch(/chrome|\bedge\b|safari/i);
  });

  it('points at images and build notes that exist', () => {
    const files = [...kit.matchAll(/`((?:\.\.\/chrome\/)?[\w-]+\.png)`/g)].map((m) => m[1]);
    expect(files.length).toBeGreaterThan(3);
    for (const f of files) expect(existsSync(path.join(ROOT, 'store/firefox', f)), f).toBe(true);
    expect(existsSync(path.join(ROOT, 'store/firefox/SOURCE.md'))).toBe(true);
  });
});
