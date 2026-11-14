#!/usr/bin/env node
// publish-chrome.mjs — upload a release ZIP to the Chrome Web Store and
// submit it for review (Chrome Web Store API v2). Run by the release
// workflow's `chrome` job; see docs/release-plan.md §2.
//
//   node scripts/publish-chrome.mjs <path/to/…-chrome.zip>
//
// Environment (GitHub `release` environment; never in the repo):
//   CWS_SERVICE_ACCOUNT_JSON_B64  the service account's JSON key, base64
//   CWS_PUBLISHER_ID              Developer Dashboard → Publisher → Settings
//   CWS_EXTENSION_ID              the store item (32 letters)
//   CWS_PUBLISH_TYPE              optional: STAGED_PUBLISH (default) waits
//                                 after review for the owner's Publish click
//                                 in the dashboard; DEFAULT_PUBLISH goes live
//                                 as soon as review passes.
//
// Signs in as the service account (a JWT signed with its key, exchanged for
// an access token with the chromewebstore scope), uploads the ZIP, waits for
// the upload if the store processes it in the background, then publishes.
// Only Node's own crypto and fetch: no third-party action or CLI. The access
// token and key are never printed.

import { createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://chromewebstore.googleapis.com';
const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';
const PUBLISH_TYPES = ['STAGED_PUBLISH', 'DEFAULT_PUBLISH'];

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

// serviceAccountJwt(key, now) -> a signed JWT asking for the store scope.
export function serviceAccountJwt(key, now = Date.now()) {
  if (!key || !key.client_email || !key.private_key) throw new Error('The service account key has no client_email or private_key.');
  const iat = Math.floor(now / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: key.client_email,
    scope: SCOPE,
    aud: key.token_uri || 'https://oauth2.googleapis.com/token',
    iat,
    exp: iat + 3600,
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${b64url(signer.sign(key.private_key))}`;
}

async function json(res, what) {
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  if (!res.ok) {
    const msg = (body && body.error && (body.error.message || body.error)) || body.raw || res.statusText;
    throw new Error(`${what} failed (HTTP ${res.status}): ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  }
  return body;
}

export async function accessToken(key, fetchImpl = fetch, now = Date.now()) {
  const res = await fetchImpl(key.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: serviceAccountJwt(key, now) }),
  });
  const body = await json(res, 'Signing in as the service account');
  if (!body.access_token) throw new Error('Signing in as the service account returned no access token.');
  return body.access_token;
}

// publishChrome({ zip, key, publisherId, itemId, publishType }) -> the
// publish response ({ state, warningInfo, … }). log() reports progress.
export async function publishChrome({ zip, key, publisherId, itemId, publishType = 'STAGED_PUBLISH', fetchImpl = fetch, log = console.log, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), pollMs = 5000, pollTries = 36 }) {
  if (!PUBLISH_TYPES.includes(publishType)) throw new Error(`CWS_PUBLISH_TYPE must be one of ${PUBLISH_TYPES.join(', ')}.`);
  if (!/^[a-p]{32}$/.test(itemId || '')) throw new Error('CWS_EXTENSION_ID must be the 32-letter store item ID.');
  if (!publisherId) throw new Error('CWS_PUBLISHER_ID is not set (Developer Dashboard → Publisher → Settings).');
  const token = await accessToken(key, fetchImpl);
  const auth = { Authorization: `Bearer ${token}` };
  const item = `publishers/${encodeURIComponent(publisherId)}/items/${itemId}`;

  log(`Uploading ${zip.name} (${Math.round(zip.data.length / 1024)} KB)…`);
  const up = await json(await fetchImpl(`${API}/upload/v2/${item}:upload`, { method: 'POST', headers: auth, body: zip.data }), 'Upload');
  let state = up.uploadState;
  for (let i = 0; state === 'IN_PROGRESS' && i < pollTries; i++) {
    await sleep(pollMs);
    const st = await json(await fetchImpl(`${API}/v2/${item}:fetchStatus`, { headers: auth }), 'Checking the upload');
    state = st.lastAsyncUploadState || state;
  }
  if (state !== 'SUCCEEDED') throw new Error(`Upload did not succeed (state: ${state || 'unknown'}). Is the version higher than the store's?`);
  log(`Uploaded${up.crxVersion ? ` version ${up.crxVersion}` : ''}.`);

  const pub = await json(await fetchImpl(`${API}/v2/${item}:publish`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ publishType }),
  }), 'Publish');
  log(`Submitted for review (${publishType}); store state: ${pub.state || 'unknown'}.`);
  for (const w of (pub.warningInfo && pub.warningInfo.warnings) || []) log(`Warning: ${w.reason || ''} ${w.description || ''}`.trim());
  if (pub.state === 'REJECTED' || pub.state === 'CANCELLED') throw new Error(`The store answered ${pub.state}.`);
  return pub;
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: node scripts/publish-chrome.mjs <chrome.zip>');
  const raw = process.env.CWS_SERVICE_ACCOUNT_JSON_B64 || '';
  let key;
  try {
    key = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  } catch {
    throw new Error('CWS_SERVICE_ACCOUNT_JSON_B64 is not a base64-encoded JSON key.');
  }
  await publishChrome({
    zip: { name: path.basename(file), data: await readFile(file) },
    key,
    publisherId: process.env.CWS_PUBLISHER_ID,
    itemId: process.env.CWS_EXTENSION_ID,
    publishType: process.env.CWS_PUBLISH_TYPE || 'STAGED_PUBLISH',
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`::error::${err.message}`);
    process.exit(1);
  });
}
