import { describe, it, expect } from 'vitest';
import { isApplePlatform } from '../../extension/src/screenshot.js';

describe('Share icon platform', () => {
  it('uses the platform the browser reports when it has one (Chrome, Edge)', () => {
    expect(isApplePlatform({ userAgentData: { platform: 'macOS' } })).toBe(true);
    expect(isApplePlatform({ userAgentData: { platform: 'Android' } })).toBe(false);
    expect(isApplePlatform({ userAgentData: { platform: 'Windows' } })).toBe(false);
    expect(isApplePlatform({ userAgentData: { platform: 'Chrome OS' } })).toBe(false);
  });
  it('falls back to the user agent (Safari, Firefox)', () => {
    expect(isApplePlatform({ platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15' })).toBe(true);
    expect(isApplePlatform({ platform: 'iPhone', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)' })).toBe(true);
    expect(isApplePlatform({ platform: 'Linux armv8l', userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/140.0 Mobile' })).toBe(false);
    expect(isApplePlatform({ platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0' })).toBe(false);
    expect(isApplePlatform(null)).toBe(false);
  });
});
