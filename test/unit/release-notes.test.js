// release-notes.mjs: RELEASE_NOTES.md read for the What's new dialog, the
// store notes and the GitHub Release.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseReleaseNotes, releaseFor, toPlain, toAppStore, noEmoji, toGithub, whatsNewFor, NOTES_FILE } from '../../scripts/release-notes.mjs';

const MD = `# Release notes

Intro text with a - dash line that isn't an item.

## 1.5.1 — November 21, 2026

### ✨ New
- 🖨️ **Print** one page. Look for the ![Print button](docs/release-notes/print-button.png) at the top.
- 📶 A thin bar while grades refresh.

### 🛠️ Fixed
- 😬 Overdue leaves out paper work.

## 1.5.0 — November 20, 2026

### ✨ New
- 👀 Demo data.

### 🛠️ Fixed
`;

describe('parseReleaseNotes', () => {
  it('reads each release, its sections and items, newest first; empty sections are dropped', () => {
    const all = parseReleaseNotes(MD);
    expect(all.map((r) => [r.version, r.date])).toEqual([['1.5.1', 'November 21, 2026'], ['1.5.0', 'November 20, 2026']]);
    expect(all[0].sections.map((s) => [s.title, s.items.length])).toEqual([['✨ New', 2], ['🛠️ Fixed', 1]]);
    expect(all[1].sections.map((s) => s.title)).toEqual(['✨ New']);
    expect(all[0].sections[0].items[0].parts).toEqual([
      { t: 'text', v: '🖨️ ' }, { t: 'b', v: 'Print' }, { t: 'text', v: ' one page. Look for the ' },
      { t: 'img', alt: 'Print button', src: 'docs/release-notes/print-button.png' }, { t: 'text', v: ' at the top.' },
    ]);
    expect(releaseFor(MD, '1.4.0')).toBe(null);
  });
});

describe('store and GitHub text', () => {
  const rel = releaseFor(MD, '1.5.1');
  it('plain text for the stores: a heading per list, one item per line, images read as their alt text', () => {
    expect(toPlain(rel)).toBe('New:\n🖨️ Print one page. Look for the Print button at the top.\n📶 A thin bar while grades refresh.\n\nFixed:\n😬 Overdue leaves out paper work.');
  });
  it("App Store What's New: no emoji (Apple refuses them), a bullet per item", () => {
    expect(toAppStore(rel)).toBe('New:\n• Print one page. Look for the Print button at the top.\n• A thin bar while grades refresh.\n\nFixed:\n• Overdue leaves out paper work.');
    expect(noEmoji('👨‍👩‍👧 A child 🇺🇸 page 👍🏽 1️⃣ ok')).toBe('A child page 1 ok');
  });
  it('Markdown for the GitHub Release, images from the tag', () => {
    expect(toGithub(rel)).toBe('### ✨ New\n- 🖨️ **Print** one page. Look for the <img src="https://raw.githubusercontent.com/megahirt/schoology-grades-extension/v1.5.1/docs/release-notes/print-button.png" alt="Print button" height="22"> at the top.\n- 📶 A thin bar while grades refresh.\n\n### 🛠️ Fixed\n- 😬 Overdue leaves out paper work.');
  });
});

describe('whatsNewFor (bundled into the extension)', () => {
  const readImage = (src) => `data:image/png;base64,${src}`;
  it("the built version's notes, with images as data: URLs", () => {
    const wn = whatsNewFor(MD, '1.5.1', { readImage });
    expect(wn.version).toBe('1.5.1');
    expect(wn.sections[0].items[0][3]).toEqual({ t: 'img', alt: 'Print button', src: 'data:image/png;base64,docs/release-notes/print-button.png' });
  });
  it('no notes for the version: none in a release build, the newest in a dev build', () => {
    expect(whatsNewFor(MD, '1.6.0', { readImage })).toBe(null);
    expect(whatsNewFor(MD, '0.0.0', { dev: true, readImage }).version).toBe('1.5.1');
  });
});

describe('RELEASE_NOTES.md itself', () => {
  const md = readFileSync(NOTES_FILE, 'utf8');
  const all = parseReleaseNotes(md);
  it('every release has items, each starting with an emoji, and its pictures exist', () => {
    expect(all.length).toBeGreaterThan(0);
    for (const r of all) {
      expect(r.sections.length, r.version).toBeGreaterThan(0);
      for (const s of r.sections) for (const it of s.items) expect(it.md, `${r.version}: ${it.md}`).toMatch(/^\p{Extended_Pictographic}/u);
    }
    // whatsNewFor reads every picture of every release: throws if one is missing.
    for (const r of all) expect(() => whatsNewFor(md, r.version)).not.toThrow();
  });
  it("every release's App Store text is free of emoji", () => {
    for (const r of all) expect(toAppStore(r), r.version).not.toMatch(/\p{Extended_Pictographic}|\u200D|\uFE0F/u);
  });
  it('versions are newest first', () => {
    const n = (v) => v.split('.').reduce((a, x) => a * 1000 + Number(x), 0);
    const vs = all.map((r) => n(r.version));
    expect([...vs].sort((a, b) => b - a)).toEqual(vs);
  });
});
