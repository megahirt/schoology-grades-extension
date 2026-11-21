// Unit tests for the web feature suite's helpers (test/web/helpers.mjs):
// which errors count as a driver/session error (retried once in a fresh
// session) and which are real failures (never retried).
import assert from 'node:assert/strict';
import { describe, expect, it } from 'vitest';
import { capabilitiesFor, isSessionError } from '../web/helpers.mjs';

describe('isSessionError', () => {
  it('is true for session and driver errors', () => {
    expect(isSessionError(new Error('Could not create a session: The session timed out while connecting to a Safari instance'))).toBe(true);
    expect(isSessionError(Object.assign(new Error('x'), { name: 'SessionNotCreatedError' }))).toBe(true);
    expect(isSessionError(new Error('connect ECONNREFUSED 127.0.0.1:4444'))).toBe(true);
    expect(isSessionError(new Error('read ECONNRESET'))).toBe(true);
    expect(isSessionError(new Error('invalid session id'))).toBe(true);
  });

  it('is false for failed assertions and waitUntil timeouts', () => {
    expect(isSessionError(new assert.AssertionError({ message: 'x' }))).toBe(false);
    expect(isSessionError(new Error('waitUntil condition timed out after 30000ms'))).toBe(false);
    expect(isSessionError(undefined)).toBe(false);
  });
});

describe('capabilitiesFor', () => {
  it('gives each browser its capabilities', () => {
    expect(capabilitiesFor('safari')).toEqual({ browserName: 'safari' });
    expect(capabilitiesFor('chrome')).toEqual({ browserName: 'chrome', 'goog:chromeOptions': { args: ['--headless=new', '--window-size=1280,900'] } });
    expect(capabilitiesFor('firefox')).toEqual({ browserName: 'firefox', 'moz:firefoxOptions': { args: ['-headless', '-width=1280', '-height=900'] } });
  });
});
