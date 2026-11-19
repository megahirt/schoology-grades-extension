import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { ascJwt, submitAppStore } from '../../scripts/submit-appstore.mjs';

// A throwaway P-256 key, made for the test (never a real App Store Connect key).
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const key = { keyId: 'ABC123DEFG', issuerId: '00000000-1111-2222-3333-444444444444', p8: privateKey.export({ type: 'pkcs8', format: 'pem' }) };

// A fake App Store Connect: answers by "METHOD path" (query left out), in order.
function fakeAsc(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const k = `${init.method || 'GET'} ${u.pathname}`;
    calls.push({ k, url, body: init.body ? JSON.parse(init.body) : undefined, auth: init.headers.Authorization });
    const list = routes[k];
    if (!list || !list.length) throw new Error(`unexpected ${k}`);
    const next = list.length > 1 ? list.shift() : list[0];
    const status = next.status || 200;
    return { ok: status < 400, status, text: async () => JSON.stringify(next.body || {}) };
  };
  return { calls, fetchImpl };
}
const run = (fetchImpl, extra = {}) => submitAppStore({ version: '1.4.0', build: 16, platforms: ['IOS'], key, fetchImpl, log: () => {}, sleep: async () => {}, ...extra });
const APP = { body: { data: [{ id: 'app1' }] } };
const BUILD = (s, enc = null) => ({ body: { data: [{ id: 'b1', attributes: { processingState: s, usesNonExemptEncryption: enc } }] } });

describe('submit-appstore', () => {
  it('signs an ES256 token for App Store Connect', () => {
    const jwt = ascJwt(key, Date.UTC(2026, 10, 18));
    const [h, c, sig] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url'))).toEqual({ alg: 'ES256', kid: key.keyId, typ: 'JWT' });
    const claims = JSON.parse(Buffer.from(c, 'base64url'));
    expect(claims).toMatchObject({ iss: key.issuerId, aud: 'appstoreconnect-v1' });
    expect(claims.exp - claims.iat).toBe(1200);
    const v = createVerify('SHA256');
    v.update(`${h}.${c}`);
    expect(v.verify({ key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'))).toBe(true);
  });

  it('waits for the build, creates the version, attaches it and submits it', async () => {
    const { calls, fetchImpl } = fakeAsc({
      'GET /v1/apps': [APP],
      'GET /v1/builds': [BUILD('PROCESSING'), BUILD('VALID')],
      'PATCH /v1/builds/b1': [{}],
      'GET /v1/apps/app1/appStoreVersions': [{ body: { data: [{ id: 'old', attributes: { versionString: '1.2.4', appVersionState: 'READY_FOR_DISTRIBUTION' } }] } }],
      'POST /v1/appStoreVersions': [{ status: 201, body: { data: { id: 'v1' } } }],
      'PATCH /v1/appStoreVersions/v1/relationships/build': [{ status: 204 }],
      'GET /v1/appStoreVersions/v1/appStoreVersionLocalizations': [{ body: { data: [{ id: 'en' }, { id: 'es' }] } }],
      'PATCH /v1/appStoreVersionLocalizations/en': [{}],
      'PATCH /v1/appStoreVersionLocalizations/es': [{}],
      'GET /v1/reviewSubmissions': [{ body: { data: [] } }],
      'POST /v1/reviewSubmissions': [{ status: 201, body: { data: { id: 's1' } } }],
      'POST /v1/reviewSubmissionItems': [{ status: 201 }],
      'PATCH /v1/reviewSubmissions/s1': [{}],
    });
    expect(await run(fetchImpl, { whatsNew: 'New Overdue section.' })).toEqual({ IOS: 'WAITING_FOR_REVIEW' });
    expect(calls[0].url).toContain('filter[bundleId]=net.hirtfamily.schoology-dashboard');
    expect(calls[0].auth).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(calls.filter((c) => c.k === 'GET /v1/builds')).toHaveLength(2);
    expect(calls[1].url).toContain('filter[version]=16&filter[preReleaseVersion.version]=1.4.0&filter[preReleaseVersion.platform]=IOS');
    expect(calls.find((c) => c.k === 'PATCH /v1/builds/b1').body.data.attributes).toEqual({ usesNonExemptEncryption: false });
    expect(calls.find((c) => c.k === 'POST /v1/appStoreVersions').body.data.attributes).toEqual({ platform: 'IOS', versionString: '1.4.0', releaseType: 'AFTER_APPROVAL' });
    expect(calls.find((c) => c.k.endsWith('/relationships/build')).body).toEqual({ data: { type: 'builds', id: 'b1' } });
    expect(calls.find((c) => c.k.endsWith('Localizations/es')).body.data.attributes).toEqual({ whatsNew: 'New Overdue section.' });
    expect(calls.at(-1).body.data.attributes).toEqual({ submitted: true });
  });

  it('renames an editable draft instead of creating a second version, and reuses an open submission', async () => {
    const { calls, fetchImpl } = fakeAsc({
      'GET /v1/apps': [APP],
      'GET /v1/builds': [BUILD('VALID', false)],
      'GET /v1/apps/app1/appStoreVersions': [{ body: { data: [{ id: 'd1', attributes: { versionString: '1.3.0', appStoreState: 'PREPARE_FOR_SUBMISSION' } }] } }],
      'PATCH /v1/appStoreVersions/d1': [{ body: { data: { id: 'd1' } } }],
      'PATCH /v1/appStoreVersions/d1/relationships/build': [{ status: 204 }],
      'GET /v1/appStoreVersions/d1/appStoreVersionLocalizations': [{ body: { data: [{ id: 'en' }] } }],
      'PATCH /v1/appStoreVersionLocalizations/en': [{}],
      'GET /v1/reviewSubmissions': [{ body: { data: [{ id: 's9' }] } }],
      'POST /v1/reviewSubmissionItems': [{ status: 409, body: { errors: [{ detail: 'already added' }] } }],
      'PATCH /v1/reviewSubmissions/s9': [{}],
    });
    await run(fetchImpl);
    expect(calls.some((c) => c.k === 'PATCH /v1/builds/b1')).toBe(false); // compliance already answered
    expect(calls.find((c) => c.k === 'PATCH /v1/appStoreVersions/d1').body.data.attributes.versionString).toBe('1.4.0');
    expect(calls.find((c) => c.k.endsWith('Localizations/en')).body.data.attributes.whatsNew).toContain('/releases/tag/v1.4.0');
    expect(calls.some((c) => c.k === 'POST /v1/reviewSubmissions')).toBe(false);
    expect(calls.at(-1).k).toBe('PATCH /v1/reviewSubmissions/s9');
  });

  it('does nothing for a version already in review', async () => {
    const { calls, fetchImpl } = fakeAsc({
      'GET /v1/apps': [APP],
      'GET /v1/builds': [BUILD('VALID', false)],
      'GET /v1/apps/app1/appStoreVersions': [{ body: { data: [{ id: 'v1', attributes: { versionString: '1.4.0', appVersionState: 'WAITING_FOR_REVIEW' } }] } }],
    });
    expect(await run(fetchImpl)).toEqual({ IOS: 'WAITING_FOR_REVIEW' });
    expect(calls.map((c) => c.k)).toEqual(['GET /v1/apps', 'GET /v1/builds', 'GET /v1/apps/app1/appStoreVersions']);
  });

  it('explains a 409 when another version is still in progress', async () => {
    const logs = [];
    const { calls, fetchImpl } = fakeAsc({
      'GET /v1/apps': [APP],
      'GET /v1/builds': [BUILD('VALID', false)],
      'GET /v1/apps/app1/appStoreVersions': [{ body: { data: [
        { id: 'live', attributes: { versionString: '1.2.3', appVersionState: 'READY_FOR_DISTRIBUTION' } },
        { id: 'rev', attributes: { versionString: '1.2.4', appVersionState: 'IN_REVIEW' } },
      ] } }],
      'POST /v1/appStoreVersions': [{ status: 409, body: { errors: [{ detail: 'You cannot create a new version of the App in the current state.' }] } }],
    });
    await expect(run(fetchImpl, { platforms: ['MAC_OS'], log: (m) => logs.push(m) })).rejects.toThrow(/Mac: version 1\.2\.4 is in review, and Apple allows only one version in progress.*re-run this job once 1\.2\.4 is released/);
    expect(logs.at(-1)).toMatch(/can't add 1\.4\.0 yet/);
    expect(calls.at(-1).k).toBe('POST /v1/appStoreVersions');
  });

  it('stops with a clear message when Apple rejects the build or it never shows up', async () => {
    await expect(run(fakeAsc({ 'GET /v1/apps': [APP], 'GET /v1/builds': [BUILD('INVALID')] }).fetchImpl)).rejects.toThrow(/rejected the iPhone and iPad build/);
    await expect(run(fakeAsc({ 'GET /v1/apps': [APP], 'GET /v1/builds': [{ body: { data: [] } }] }).fetchImpl, { pollTries: 2 })).rejects.toThrow(/not ready after/);
    await expect(run(fakeAsc({ 'GET /v1/apps': [{ status: 401, body: { errors: [{ detail: 'Authentication credentials are missing or invalid.' }] } }] }).fetchImpl)).rejects.toThrow(/HTTP 401.*credentials/);
  });

  it('checks its inputs', async () => {
    await expect(run(fakeAsc({}).fetchImpl, { version: '1.4' })).rejects.toThrow(/X\.Y\.Z/);
    await expect(run(fakeAsc({}).fetchImpl, { platforms: ['TV_OS'] })).rejects.toThrow(/Unknown platform/);
    await expect(run(fakeAsc({}).fetchImpl, { key: { keyId: 'x' } })).rejects.toThrow(/must all be set/);
  });
});
