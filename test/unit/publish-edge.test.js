import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { publishEdge, certificationNotes, CERT_NOTES_FILE } from '../../scripts/publish-edge.mjs';

const PRODUCT = '0a1b2c3d-1111-2222-3333-444455556666';
const API = 'https://api.addons.microsoftedge.microsoft.com';
const SUBMISSIONS = `${API}/v1/products/${PRODUCT}/submissions`;
const UPLOAD = `${SUBMISSIONS}/draft/package`;
const zip = { name: 'x-chrome.zip', data: Buffer.from('PK fake zip') };
const KEY = 'secret-api-key-value';

// A fake store: records each request and answers from a script. An answer
// has a status, optional headers, and a JSON body or raw text.
function fakeStore(answers) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body });
    const next = answers.length > 1 ? answers.shift() : answers[0];
    const headers = Object.fromEntries(Object.entries(next.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    return {
      ok: next.status < 400,
      status: next.status,
      statusText: '',
      headers: { get: (name) => headers[name.toLowerCase()] ?? null },
      text: async () => (next.text !== undefined ? next.text : JSON.stringify(next.body ?? {})),
    };
  };
  return { calls, fetchImpl };
}
const accepted = (location = 'op-1') => ({ status: 202, headers: { Location: location } });
const op = (status, extra = {}) => ({ status: 200, body: { id: 'op-1', status, message: null, errorCode: null, errors: null, ...extra } });
// Draft-only by default: most tests are about the upload. The publish tests
// below turn it off.
const opts = (fetchImpl, extra = {}) => ({ zip, productId: PRODUCT, clientId: 'cid', apiKey: KEY, draftOnly: true, fetchImpl, log: () => {}, sleep: async () => {}, ...extra });
const publishing = (fetchImpl, extra = {}) => opts(fetchImpl, { draftOnly: false, notes: 'Reviewer notes', ...extra });

describe('publish-edge', () => {
  it('with draftOnly, uploads the ZIP as a draft, waits for it, and does not publish', async () => {
    const { calls, fetchImpl } = fakeStore([accepted(), op('Succeeded', { message: 'Successfully updated package to x-chrome.zip' })]);
    const done = await publishEdge(opts(fetchImpl));
    expect(done.upload.status).toBe('Succeeded');
    expect(done.publish).toBeNull();
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ url: UPLOAD, method: 'POST', body: zip.data });
    expect(calls[0].headers).toMatchObject({ Authorization: `ApiKey ${KEY}`, 'X-ClientID': 'cid', 'Content-Type': 'application/zip' });
    expect(calls[1]).toMatchObject({ url: `${UPLOAD}/operations/op-1`, method: 'GET' });
    expect(calls[1].headers).toMatchObject({ Authorization: `ApiKey ${KEY}`, 'X-ClientID': 'cid' });
    expect(calls.some((c) => c.url.endsWith('/submissions'))).toBe(false);
  });

  it('reads the operation ID from a Location that is a whole path', async () => {
    const { calls, fetchImpl } = fakeStore([accepted(`/v1/products/${PRODUCT}/submissions/draft/package/operations/op-1`), op('Succeeded')]);
    await publishEdge(opts(fetchImpl));
    expect(calls[1].url).toBe(`${UPLOAD}/operations/op-1`);
  });

  it('keeps checking while the store is still processing the upload', async () => {
    const { calls, fetchImpl } = fakeStore([accepted(), op('InProgress'), op('InProgress'), op('Succeeded')]);
    await publishEdge(opts(fetchImpl));
    expect(calls.filter((c) => c.url.includes('/operations/'))).toHaveLength(3);
  });

  it('reports the store\'s reason when the upload fails', async () => {
    const { fetchImpl } = fakeStore([accepted(), op('Failed', { message: 'Bad package', errorCode: 'X', errors: ['e1', { message: 'e2' }] })]);
    const err = await publishEdge(opts(fetchImpl)).catch((e) => e);
    expect(err.message).toContain('Bad package');
    expect(err.message).toContain('X');
    expect(err.message).toContain('e1');
    expect(err.message).toContain('e2');
  });

  it('stops when the store accepts the upload but names no operation', async () => {
    const { calls, fetchImpl } = fakeStore([{ status: 202 }]);
    await expect(publishEdge(opts(fetchImpl))).rejects.toThrow('Location');
    expect(calls).toHaveLength(1);
  });

  it('gives up, as a failure, when the upload never finishes', async () => {
    const { calls, fetchImpl } = fakeStore([accepted(), op('InProgress')]);
    await expect(publishEdge(opts(fetchImpl, { pollTries: 2 }))).rejects.toThrow('still in progress');
    expect(calls.filter((c) => c.url.includes('/operations/'))).toHaveLength(2);
  });

  it('survives an error page that is not JSON', async () => {
    const { fetchImpl } = fakeStore([{ status: 401, text: '<html>nope</html>' }]);
    await expect(publishEdge(opts(fetchImpl))).rejects.toThrow('Upload failed (HTTP 401)');
  });

  it('checks its settings before contacting the store', async () => {
    const { calls, fetchImpl } = fakeStore([accepted()]);
    await expect(publishEdge(opts(fetchImpl, { productId: 'nope' }))).rejects.toThrow('EDGE_PRODUCT_ID');
    await expect(publishEdge(opts(fetchImpl, { clientId: '' }))).rejects.toThrow('EDGE_CLIENT_ID');
    await expect(publishEdge(opts(fetchImpl, { apiKey: '' }))).rejects.toThrow('EDGE_API_KEY');
    expect(calls).toHaveLength(0);
  });

  it('never prints the API key', async () => {
    const lines = [];
    const { fetchImpl } = fakeStore([accepted(), op('Succeeded')]);
    await publishEdge(opts(fetchImpl, { log: (l) => lines.push(String(l)) }));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain(KEY);
  });

  it('publishes the draft after the upload, with the notes, and waits for it', async () => {
    const { calls, fetchImpl } = fakeStore([
      accepted('up-1'), op('Succeeded'),
      accepted('pub-1'), op('InProgress'), op('Succeeded', { message: 'Successfully created submission with ID 42' }),
    ]);
    const done = await publishEdge(publishing(fetchImpl));
    expect(done.publish.status).toBe('Succeeded');
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ['POST', UPLOAD],
      ['GET', `${UPLOAD}/operations/up-1`],
      ['POST', SUBMISSIONS],
      ['GET', `${SUBMISSIONS}/operations/pub-1`],
      ['GET', `${SUBMISSIONS}/operations/pub-1`],
    ]);
    expect(calls[2].headers).toMatchObject({ Authorization: `ApiKey ${KEY}`, 'X-ClientID': 'cid', 'Content-Type': 'application/json' });
    expect(JSON.parse(calls[2].body)).toEqual({ notes: 'Reviewer notes' });
  });

  it('does not publish when the upload fails', async () => {
    const { calls, fetchImpl } = fakeStore([accepted(), op('Failed', { message: 'Bad package' })]);
    await expect(publishEdge(publishing(fetchImpl))).rejects.toThrow('Bad package');
    expect(calls.some((c) => c.url === SUBMISSIONS)).toBe(false);
  });

  it('explains a publish refused because a review is still in progress', async () => {
    const { fetchImpl } = fakeStore([accepted('up-1'), op('Succeeded'), accepted('pub-1'),
      op('Failed', { message: "Can't publish extension as your extension submission is in progress.", errorCode: 'InProgressSubmission' })]);
    const err = await publishEdge(publishing(fetchImpl)).catch((e) => e);
    expect(err.message).toContain('InProgressSubmission');
    expect(err.message).toContain('re-run this job');
  });

  it('lists the store\'s validation errors when the publish fails', async () => {
    const { fetchImpl } = fakeStore([accepted('up-1'), op('Succeeded'), accepted('pub-1'),
      op('Failed', { message: 'validation failures', errorCode: 'SubmissionValidationError', errors: ['Missing privacy policy'] })]);
    await expect(publishEdge(publishing(fetchImpl))).rejects.toThrow('Missing privacy policy');
  });

  it('stops when the store accepts the publish but names no operation', async () => {
    const { fetchImpl } = fakeStore([accepted('up-1'), op('Succeeded'), { status: 202 }]);
    await expect(publishEdge(publishing(fetchImpl))).rejects.toThrow('Location');
  });

  it('reports an HTTP error from the publish call', async () => {
    const { fetchImpl } = fakeStore([accepted('up-1'), op('Succeeded'), { status: 401, body: { message: 'Key expired' } }]);
    await expect(publishEdge(publishing(fetchImpl))).rejects.toThrow('Publish failed (HTTP 401): Key expired');
  });

  it('never prints the API key while publishing', async () => {
    const lines = [];
    const { fetchImpl } = fakeStore([accepted('up-1'), op('Succeeded'), accepted('pub-1'), op('Succeeded')]);
    await publishEdge(publishing(fetchImpl, { log: (l) => lines.push(String(l)) }));
    expect(lines.join('\n')).toContain('certification');
    expect(lines.join('\n')).not.toContain(KEY);
  });
});

describe('certificationNotes', () => {
  it('puts the reviewer text first, then what changed in this version', () => {
    const notes = certificationNotes({ reviewerText: 'How to test.\n', version: '1.6.0', releaseNotes: 'New:\n🖨️ Print' });
    expect(notes).toBe("How to test.\n\nWhat's new in 1.6.0:\nNew:\n🖨️ Print");
  });

  it('the reviewer text in the repo explains the demo mode', () => {
    const text = readFileSync(CERT_NOTES_FILE, 'utf8');
    expect(text).toContain('demo');
    expect(text).not.toMatch(/```/);
  });
});
