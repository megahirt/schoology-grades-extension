// Unit tests for the web feature suite's helpers (test/web/helpers.mjs):
// which errors count as a driver/session error (retried once in a fresh
// session) and which are real failures (never retried).
import assert from 'node:assert/strict';
import { describe, expect, it } from 'vitest';
import { WAIT_PREFIX, capabilitiesFor, isSessionError, shouldQuitSafari, waitMessage } from '../web/helpers.mjs';

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

describe('the suite\'s own waits are never session errors', () => {
  it('a waitForPanel timeout is not retried, whatever the panel says', () => {
    // The exact message waitForPanel throws (webdriverio throws timeoutMsg as is).
    const err = new Error(waitMessage('parent dashboard did not show', 'Could not create a session ECONNREFUSED invalid session id'));
    expect(err.message.startsWith(WAIT_PREFIX)).toBe(true);
    expect(isSessionError(err)).toBe(false);
  });
});

describe('shouldQuitSafari', () => {
  const connectTimeout = Object.assign(new Error('Could not create a session: The session timed out while connecting to a Safari instance'), { name: 'SessionNotCreatedError' });
  it('quits only a running Safari after a connect timeout', () => {
    expect(shouldQuitSafari(connectTimeout, true)).toBe(true);
    expect(shouldQuitSafari(connectTimeout, false)).toBe(false);
    const requestTimeout = Object.assign(new Error('Could not create a session: Request timed out! Consider increasing the "connectionRetryTimeout" option.'), { name: 'SessionNotCreatedError' });
    expect(shouldQuitSafari(requestTimeout, true)).toBe(true);
  });
  it('does not quit for other session errors or for failures', () => {
    expect(shouldQuitSafari(new Error('connect ECONNREFUSED 127.0.0.1:4444'), true)).toBe(false);
    expect(shouldQuitSafari(new Error('invalid session id'), true)).toBe(false);
    expect(shouldQuitSafari(new assert.AssertionError({ message: 'timed out while connecting to a Safari instance' }), true)).toBe(false);
  });
});
