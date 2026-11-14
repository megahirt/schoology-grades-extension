import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { serviceAccountJwt, publishChrome } from '../../scripts/publish-chrome.mjs';

// A throwaway key, made for the test (never a real service account).
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const key = { client_email: 'ci@example.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth2.googleapis.com/token' };
const ITEM = 'nglbmnaepjadllenolmliglnonjkdhjp';
const zip = { name: 'x-chrome.zip', data: Buffer.from('PK fake zip') };

// A fake store: records each request and answers from a script.
function fakeStore(answers) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body });
    const next = answers.shift();
    return { ok: next.status < 400, status: next.status, statusText: '', text: async () => JSON.stringify(next.body) };
  };
  return { calls, fetchImpl };
}
const opts = (fetchImpl, extra = {}) => ({ zip, key, publisherId: 'pub-123', itemId: ITEM, fetchImpl, log: () => {}, sleep: async () => {}, ...extra });

describe('publish-chrome', () => {
  it('signs a JWT for the store scope with the service account key', () => {
    const jwt = serviceAccountJwt(key, Date.UTC(2026, 10, 11));
    const [h, c, sig] = jwt.split('.');
    const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
    expect(claims).toMatchObject({ iss: key.client_email, scope: 'https://www.googleapis.com/auth/chromewebstore', aud: key.token_uri });
    expect(claims.exp - claims.iat).toBe(3600);
    const v = createVerify('RSA-SHA256');
    v.update(`${h}.${c}`);
    expect(v.verify(publicKey, Buffer.from(sig, 'base64url'))).toBe(true);
  });

  it('signs in, uploads the ZIP, then publishes staged (waits for the owner\'s click)', async () => {
    const { calls, fetchImpl } = fakeStore([
      { status: 200, body: { access_token: 'tok' } },
      { status: 200, body: { uploadState: 'SUCCEEDED', crxVersion: '1.1.2' } },
      { status: 200, body: { state: 'PENDING_REVIEW' } },
    ]);
    const pub = await publishChrome(opts(fetchImpl));
    expect(pub.state).toBe('PENDING_REVIEW');
    expect(calls[0].url).toBe('https://oauth2.googleapis.com/token');
    expect(String(calls[0].body)).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer');
    expect(calls[1]).toMatchObject({ url: `https://chromewebstore.googleapis.com/upload/v2/publishers/pub-123/items/${ITEM}:upload`, method: 'POST', body: zip.data });
    expect(calls[1].headers.Authorization).toBe('Bearer tok');
    expect(calls[2].url).toBe(`https://chromewebstore.googleapis.com/v2/publishers/pub-123/items/${ITEM}:publish`);
    expect(JSON.parse(calls[2].body)).toEqual({ publishType: 'STAGED_PUBLISH' });
  });

  it('waits for an upload the store processes in the background', async () => {
    const { calls, fetchImpl } = fakeStore([
      { status: 200, body: { access_token: 'tok' } },
      { status: 200, body: { uploadState: 'IN_PROGRESS' } },
      { status: 200, body: { lastAsyncUploadState: 'IN_PROGRESS' } },
      { status: 200, body: { lastAsyncUploadState: 'SUCCEEDED' } },
      { status: 200, body: { state: 'PENDING_REVIEW' } },
    ]);
    await publishChrome(opts(fetchImpl));
    expect(calls.filter((c) => c.url.endsWith(':fetchStatus'))).toHaveLength(2);
  });

  it('stops with a clear error, and never publishes after a failed upload', async () => {
    const { calls, fetchImpl } = fakeStore([
      { status: 200, body: { access_token: 'tok' } },
      { status: 400, body: { error: { message: 'Invalid version' } } },
    ]);
    await expect(publishChrome(opts(fetchImpl))).rejects.toThrow('Upload failed (HTTP 400): Invalid version');
    expect(calls.some((c) => c.url.endsWith(':publish'))).toBe(false);
  });

  it('checks its settings before contacting the store', async () => {
    const { calls, fetchImpl } = fakeStore([]);
    await expect(publishChrome(opts(fetchImpl, { itemId: 'nope' }))).rejects.toThrow('CWS_EXTENSION_ID');
    await expect(publishChrome(opts(fetchImpl, { publisherId: '' }))).rejects.toThrow('CWS_PUBLISHER_ID');
    await expect(publishChrome(opts(fetchImpl, { publishType: 'NOW' }))).rejects.toThrow('CWS_PUBLISH_TYPE');
    expect(calls).toHaveLength(0);
  });
});
