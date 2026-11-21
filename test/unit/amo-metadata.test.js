// amo-metadata.mjs: the release notes sent to addons.mozilla.org.
import { describe, it, expect } from 'vitest';
import { amoMetadata } from '../../scripts/amo-metadata.mjs';

describe('amoMetadata', () => {
  it("uses the tag's message as this version's release notes, and nothing else", () => {
    expect(amoMetadata('  Thin refresh bar.\nSmarter Overdue.\n', '1.5.1')).toEqual({ version: { release_notes: { 'en-US': 'Thin refresh bar.\nSmarter Overdue.' } } });
  });
  it('without a message, points at the GitHub release', () => {
    expect(amoMetadata('', '1.5.1').version.release_notes['en-US']).toBe('Improvements and fixes. Full notes: https://github.com/megahirt/schoology-grades-extension/releases/tag/v1.5.1');
    expect(amoMetadata(undefined, '2.0.0').version.release_notes['en-US']).toMatch(/tag\/v2\.0\.0$/);
  });
});
