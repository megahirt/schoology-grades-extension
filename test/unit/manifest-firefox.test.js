import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { forFirefox, FIREFOX_ID } from '../../scripts/manifest-firefox.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const base = () => JSON.parse(readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8'));

describe('Firefox manifest', () => {
  it('keeps the add-on ID that addons.mozilla.org knows', () => {
    expect(FIREFOX_ID).toBe('grades-dashboard@hirtfamily.net');
    expect(forFirefox(base()).browser_specific_settings.gecko).toMatchObject({ id: FIREFOX_ID, strict_min_version: '128.0' });
  });

  it('declares that no data is collected', () => {
    expect(forFirefox(base()).browser_specific_settings.gecko.data_collection_permissions).toEqual({ required: ['none'] });
  });

  it('is listed for Firefox for Android', () => {
    expect(forFirefox(base()).browser_specific_settings.gecko_android).toEqual({});
  });

  it('uses a background script and options_ui, as Firefox expects', () => {
    const m = forFirefox(base());
    expect(m.background).toEqual({ scripts: ['background.js'] });
    expect(m.options_ui).toEqual({ page: 'options/options.html', open_in_tab: true });
    expect(m).not.toHaveProperty('options_page');
  });

  it('drops the port from localhost patterns (dev builds)', () => {
    const dev = base();
    dev.host_permissions.push('http://localhost:*/*');
    dev.content_scripts[0].matches.push('http://localhost:*/*');
    const m = forFirefox(dev);
    expect(m.host_permissions).toContain('http://localhost/*');
    expect(m.content_scripts[0].matches).toContain('http://localhost/*');
    expect(JSON.stringify(m)).not.toContain('localhost:*');
  });

  it('leaves the manifest it was given unchanged', () => {
    const input = base();
    const before = JSON.stringify(input);
    forFirefox(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
