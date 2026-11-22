// release-notes.mjs — RELEASE_NOTES.md, one section per release, read for:
//   - the What's new dialog after an update (build.mjs bundles the section
//     for the version being built: whatsNewFor);
//   - the store notes: Safari's What's New and Firefox's release notes
//     (--format plain / amo);
//   - the GitHub Release text (--format github; the workflow adds the
//     merged-PR list after it).
//
// The format (kept small on purpose):
//   ## 1.5.1 — November 21, 2026
//   ### ✨ New
//   - 🖨️ **Print** one page … the ![Print button](docs/release-notes/print-button.png) at the top.
//   ### 🛠️ Fixed
//   - 😬 Overdue leaves out …
// Items are one line each and start with an emoji. Inside an item only
// **bold** and images (a picture of a button, say, written so the sentence
// still reads with the image's alt text in its place) are understood.
//
// CLI (the release workflow):
//   node scripts/release-notes.mjs --version 1.5.1 --format check|plain|amo|github

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const NOTES_FILE = path.join(ROOT, 'RELEASE_NOTES.md');
const REPO = 'megahirt/schoology-grades-extension';

// An item's text as parts: { t: 'text' | 'b', v } or { t: 'img', alt, src }.
export function parseInline(s) {
  const parts = [];
  const re = /\*\*(.+?)\*\*|!\[([^\]]*)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > last) parts.push({ t: 'text', v: s.slice(last, m.index) });
    parts.push(m[1] !== undefined ? { t: 'b', v: m[1] } : { t: 'img', alt: m[2], src: m[3] });
    last = re.lastIndex;
  }
  if (last < s.length) parts.push({ t: 'text', v: s.slice(last) });
  return parts;
}

// [{ version, date, sections: [{ title, items: [{ md, parts }] }] }], newest first (file order).
export function parseReleaseNotes(md) {
  const releases = [];
  let rel = null;
  let sec = null;
  for (const raw of String(md || '').split(/\r?\n/)) {
    const line = raw.trimEnd();
    let m;
    if ((m = line.match(/^## +v?(\d+\.\d+\.\d+)\b\s*(?:[—–-]\s*)?(.*)$/))) {
      rel = { version: m[1], date: m[2].trim(), sections: [] };
      releases.push(rel);
      sec = null;
    } else if (/^## /.test(line)) {
      rel = null; // some other heading: not a release
      sec = null;
    } else if (rel && (m = line.match(/^### +(.+)$/))) {
      sec = { title: m[1].trim(), items: [] };
      rel.sections.push(sec);
    } else if (rel && sec && (m = line.match(/^[-*] +(.+)$/))) {
      sec.items.push({ md: m[1].trim(), parts: parseInline(m[1].trim()) });
    }
  }
  for (const r of releases) r.sections = r.sections.filter((s) => s.items.length);
  return releases;
}

export function releaseFor(md, version) {
  return parseReleaseNotes(md).find((r) => r.version === version) || null;
}

const plainItem = (item) => item.parts.map((p) => (p.t === 'img' ? p.alt : p.v)).join('').replace(/\s+/g, ' ').trim();
// "✨ New" -> "New" (the store text keeps each item's own emoji only).
const plainTitle = (title) => title.replace(/^[^\p{L}\p{N}]+/u, '').trim() || title;

// Store text (App Store What's New, AMO release notes): plain lines.
export function toPlain(release) {
  return release.sections.map((s) => [`${plainTitle(s.title)}:`, ...s.items.map(plainItem)].join('\n')).join('\n\n');
}

// GitHub Release text: the section as Markdown, images from the tag.
export function toGithub(release, tag = `v${release.version}`) {
  const abs = (src) => (/^https?:/.test(src) ? src : `https://raw.githubusercontent.com/${REPO}/${tag}/${src.replace(/^\.?\//, '')}`);
  const item = (it) => it.parts.map((p) => (p.t === 'img' ? `<img src="${abs(p.src)}" alt="${p.alt.replace(/"/g, '&quot;')}" height="22">` : p.t === 'b' ? `**${p.v}**` : p.v)).join('');
  return release.sections.map((s) => [`### ${s.title}`, ...s.items.map((it) => `- ${item(it)}`)].join('\n')).join('\n\n');
}

// For the What's new dialog: the release built into the extension, images
// read in as data: URLs (no files to look up at run time). Release builds
// need the section for their own version; dev builds fall back to the
// newest one so the dialog can always be tried.
export function whatsNewFor(md, version, { dev = false, readImage } = {}) {
  const all = parseReleaseNotes(md);
  const rel = all.find((r) => r.version === version) || (dev ? all[0] : null);
  if (!rel) return null;
  const read = readImage || ((src) => {
    const file = path.join(ROOT, src);
    const type = src.endsWith('.svg') ? 'image/svg+xml' : src.endsWith('.jpg') || src.endsWith('.jpeg') ? 'image/jpeg' : 'image/png';
    return `data:${type};base64,${readFileSync(file).toString('base64')}`;
  });
  return {
    version: rel.version,
    sections: rel.sections.map((s) => ({
      title: s.title,
      items: s.items.map((it) => it.parts.map((p) => (p.t === 'img' ? { ...p, src: read(p.src) } : p))),
    })),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (name) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : '';
  };
  const version = arg('version').replace(/^v/, '');
  const format = arg('format') || 'plain';
  const rel = releaseFor(readFileSync(NOTES_FILE, 'utf8'), version);
  if (!rel || !rel.sections.length) {
    console.error(`RELEASE_NOTES.md has no notes for ${version || '(no --version)'}. Write the "## ${version}" section before tagging the release.`);
    process.exit(1);
  }
  const out = format === 'check' ? `RELEASE_NOTES.md has notes for ${version}.`
    : format === 'github' ? toGithub(rel)
    : format === 'amo' ? JSON.stringify({ version: { release_notes: { 'en-US': toPlain(rel) } } }, null, 2)
    : toPlain(rel);
  process.stdout.write(`${out}\n`);
}
