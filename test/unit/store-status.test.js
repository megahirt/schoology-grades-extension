// store-status.mjs: is any store still reviewing an earlier version?
import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, createHmac } from 'node:crypto';
import { chromeStatus, firefoxStatus, safariStatus, storeStatus, amoJwt, blocking, report } from '../../scripts/store-status.mjs';

// Throwaway keys, made for the test (never real store keys).
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const cwsKey = { client_email: 'ci@example.iam.gserviceaccount.com', private_key: rsa, token_uri: 'https://oauth2.googleapis.com/token' };
const ascKey = { keyId: 'ABC123DEFG', issuerId: '00000000-1111-2222-3333-444444444444', p8: ec };
const ITEM = 'nglbmnaepjadllenolmliglnonjkdhjp';

// A fake API: answers by URL path, records each request.
function fake(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ path: u.pathname, search: u.search, headers: init.headers || {} });
    const hit = Object.keys(routes).find((p) => u.pathname.endsWith(p) && (!routes[p].query || u.search.includes(routes[p].query)));
    if (!hit) throw new Error(`unexpected ${u.pathname}${u.search}`);
    const r = routes[hit];
    return { ok: (r.status || 200) < 400, status: r.status || 200, text: async () => JSON.stringify(r.body) };
  };
  return { calls, fetchImpl };
}
const rev = (state, v) => ({ state, distributionChannels: [{ deployPercentage: 100, crxVersion: v }] });
const cws = (status) => fake({ '/token': { body: { access_token: 'tok' } }, [`/items/${ITEM}:fetchStatus`]: { body: status } }).fetchImpl;
const chrome = (status, version) => chromeStatus({ key: cwsKey, publisherId: 'pub', itemId: ITEM, version, fetchImpl: cws(status) });

describe('Chrome', () => {
  it('busy while an earlier version is in review or staged', async () => {
    expect(await chrome({ publishedItemRevisionStatus: rev('PUBLISHED', '1.4.1'), submittedItemRevisionStatus: rev('PENDING_REVIEW', '1.5.0') }, '1.6.0'))
      .toEqual({ store: 'Chrome', status: 'busy', text: '1.5.0 is in review; 1.4.1 is live.' });
    expect((await chrome({ submittedItemRevisionStatus: rev('STAGED', '1.5.0') }, '1.6.0')).status).toBe('busy');
  });
  it('ready when nothing is pending, or the pending one is this release', async () => {
    expect(await chrome({ publishedItemRevisionStatus: rev('PUBLISHED', '1.5.0') }, '1.6.0'))
      .toEqual({ store: 'Chrome', status: 'ready', text: '1.5.0 is live, nothing in review.' });
    expect((await chrome({ submittedItemRevisionStatus: rev('REJECTED', '1.5.0') }, '1.6.0')).status).toBe('ready');
    expect((await chrome({ submittedItemRevisionStatus: rev('PENDING_REVIEW', '1.6.0') }, '1.6.0')).status).toBe('ready');
  });
});

describe('Firefox', () => {
  const amo = (results) => fake({ '/versions/': { body: { results } } });
  const v = (version, status, channel = 'listed') => ({ version, channel, file: { status }, is_disabled: false });
  it('signs an HS256 JWT with the API secret', () => {
    const [h, c, s] = amoJwt('user:1:2', 'sekret', Date.UTC(2026, 10, 21)).split('.');
    expect(JSON.parse(Buffer.from(c, 'base64url'))).toMatchObject({ iss: 'user:1:2', exp: Date.UTC(2026, 10, 21) / 1000 + 60 });
    expect(s).toBe(createHmac('sha256', 'sekret').update(`${h}.${c}`).digest('base64url'));
  });
  it('busy while an earlier listed version is unreviewed; unlisted and this release don\'t count', async () => {
    const f = amo([v('1.5.0', 'unreviewed'), v('1.4.1', 'public'), v('9.0.0', 'unreviewed', 'unlisted')]);
    expect(await firefoxStatus({ issuer: 'i', secret: 's', version: '1.6.0', fetchImpl: f.fetchImpl }))
      .toEqual({ store: 'Firefox', status: 'busy', text: '1.5.0 is waiting for review; 1.4.1 is live.' });
    expect(f.calls[0].path).toBe('/api/v5/addons/addon/grades-dashboard%40hirtfamily.net/versions/');
    expect(f.calls[0].headers.Authorization).toMatch(/^JWT /);
    expect((await firefoxStatus({ issuer: 'i', secret: 's', version: '1.5.0', fetchImpl: amo([v('1.5.0', 'unreviewed')]).fetchImpl })).status).toBe('ready');
    expect((await firefoxStatus({ issuer: 'i', secret: 's', version: '1.6.0', fetchImpl: amo([v('1.5.0', 'public')]).fetchImpl })).text).toBe('1.5.0 is live, nothing in review.');
  });
});

describe('Safari', () => {
  const asv = (versionString, s) => ({ id: versionString, attributes: { versionString, appVersionState: s } });
  // Versions per platform, read from the request's filter[platform].
  const run = (ios, mac, version) => {
    const fetchImpl = async (url) => {
      const u = new URL(url);
      let body;
      if (u.pathname === '/v1/apps') body = { data: [{ id: 'app1' }] };
      else if (u.pathname.endsWith('/appStoreVersions')) body = { data: u.searchParams.get('filter[platform]') === 'IOS' ? ios : mac };
      else throw new Error(`unexpected ${u.pathname}`);
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    };
    return safariStatus({ key: ascKey, version, fetchImpl });
  };
  it('busy while either platform has an earlier version on its way; drafts and live ones don\'t count', async () => {
    const r = await run([asv('1.5.0', 'WAITING_FOR_REVIEW'), asv('1.4.1', 'READY_FOR_DISTRIBUTION')], [asv('1.5.0', 'READY_FOR_DISTRIBUTION'), asv('1.6.0', 'PREPARE_FOR_SUBMISSION')], '1.6.0');
    expect(r).toEqual({ store: 'Safari', status: 'busy', text: 'iPhone and iPad: 1.5.0 is waiting for review; 1.4.1 is live. Mac: 1.5.0 is live, nothing in review.' });
    expect((await run([asv('1.6.0', 'IN_REVIEW')], [], '1.6.0')).status).toBe('ready');
  });
});

describe('storeStatus and the report', () => {
  it('stores without keys are skipped; Edge is never busy; an error blocks', async () => {
    const env = { CWS_SERVICE_ACCOUNT_JSON_B64: 'not base64 json', CWS_PUBLISHER_ID: 'p', CWS_EXTENSION_ID: ITEM, EDGE_API_KEY: 'k', EDGE_PRODUCT_ID: 'x', EDGE_CLIENT_ID: 'c' };
    const r = await storeStatus({ env, fetchImpl: async () => { throw new Error('no network in tests'); } });
    expect(r.map((x) => [x.store, x.status])).toEqual([['Chrome', 'error'], ['Edge', 'unknown'], ['Firefox', 'not-set-up'], ['Safari', 'not-set-up']]);
    expect(blocking(r).map((x) => x.store)).toEqual(['Chrome']);
    expect(report(r)).toMatch(/Not safe to release yet: Chrome still couldn't be checked/);
  });
  it('all clear', () => {
    expect(report([{ store: 'Chrome', status: 'ready', text: '1.5.0 is live, nothing in review.' }]))
      .toBe('✅ Chrome: 1.5.0 is live, nothing in review.\n\nSafe to release: no store has a review in progress.');
  });
});
