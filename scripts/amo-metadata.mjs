// amo-metadata.mjs — the --amo-metadata JSON for `web-ext sign` in the
// release workflow: only this version's release notes on addons.mozilla.org
// (nothing about the listing itself). The notes come from NOTES (the
// release tag's message, the same text as the App Store's What's New);
// without one, a line pointing at the GitHub release notes.
//   NOTES="…" VERSION=1.5.1 node scripts/amo-metadata.mjs > amo-metadata.json

export function amoMetadata(notes, version) {
  const text = (notes || '').trim() ||
    `Improvements and fixes. Full notes: https://github.com/megahirt/schoology-grades-extension/releases/tag/v${version}`;
  return { version: { release_notes: { 'en-US': text } } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(`${JSON.stringify(amoMetadata(process.env.NOTES, process.env.VERSION), null, 2)}\n`);
}
