#!/usr/bin/env node
// store-status.mjs — is it safe to release? Asks each store whether an
// earlier version is still in review (or approved and not out yet). A new
// release waits for those to finish; this never cancels or removes a
// review.
//
//   node scripts/store-status.mjs [--version 1.6.0]
//
// Exit 0: no store is busy, release away. Exit 1: a store is still busy
// (or couldn't be asked): wait and run it again. --version is the version
// about to be released: that version already in review (a re-run of the
// same release) doesn't count as busy.
//
// Run by .github/workflows/store-status.yml (any time, by hand) and by the
// release workflow's `stores` job before anything is published. Uses the
// same store keys as the release jobs, from the environment; a store
// without its keys is reported as not set up and doesn't block.
//   Chrome:  CWS_SERVICE_ACCOUNT_JSON_B64, CWS_PUBLISHER_ID, CWS_EXTENSION_ID
//            (API v2 fetchStatus: the submitted revision's state)
//   Firefox: AMO_JWT_ISSUER, AMO_JWT_SECRET
//            (AMO API v5: listed versions whose file is still unreviewed)
//   Safari:  ASC_API_KEY_ID, ASC_API_ISSUER_ID, ASC_API_KEY_P8_B64
//            (App Store Connect: versions in progress, per platform)
//   Edge:    EDGE_API_KEY, EDGE_PRODUCT_ID, EDGE_CLIENT_ID. Edge's API can't
//            report a submission's state, so it is never "busy" here. The
//            release's publish call is refused while a review is in
//            progress (InProgressSubmission), leaving the new package in the
//            draft; the `edge` job is re-run once the review is done.
// Keys and tokens are never printed.

import { createHmac, randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { accessToken } from './publish-chrome.mjs';
import { ascJwt, BUNDLE_ID, PLATFORMS, NAMES, EDITABLE, SETTLED, describe, state } from './submit-appstore.mjs';
import { FIREFOX_ID } from './manifest-firefox.mjs';

const CWS_API = 'https://chromewebstore.googleapis.com';
const AMO_API = 'https://addons.mozilla.org/api/v5';
const ASC_API = 'https://api.appstoreconnect.apple.com';

// One store's answer: { store, status: 'ready' | 'busy' | 'not-set-up' | 'unknown' | 'error', text }.
const answer = (store, status, text) => ({ store, status, text });

async function getJson(fetchImpl, url, headers, what) {
  const res = await fetchImpl(url, { headers });
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  if (!res.ok) {
    const e = body.error || (body.errors && body.errors[0]) || {};
    const msg = e.message || e.detail || e.title || body.detail || body.raw || '';
    throw new Error(`${what} failed (HTTP ${res.status})${msg ? `: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}` : ''}`);
  }
  return body;
}

// Chrome Web Store: the submitted revision, if any, and what's live.
const CWS_BUSY = {
  PENDING_REVIEW: 'in review',
  STAGED: 'approved and waiting for Publish in the Developer Dashboard',
};
export async function chromeStatus({ key, publisherId, itemId, version, fetchImpl = fetch }) {
  const token = await accessToken(key, fetchImpl);
  const st = await getJson(fetchImpl, `${CWS_API}/v2/publishers/${encodeURIComponent(publisherId)}/items/${itemId}:fetchStatus`, { Authorization: `Bearer ${token}` }, 'Chrome Web Store status');
  const ver = (rev) => (rev && rev.distributionChannels && rev.distributionChannels[0] && rev.distributionChannels[0].crxVersion) || '';
  const live = ver(st.publishedItemRevisionStatus);
  const sub = st.submittedItemRevisionStatus;
  const liveText = live ? `${live} is live` : 'nothing live yet';
  if (st.takenDown) return answer('Chrome', 'busy', `the item has been taken down; see the Developer Dashboard (${liveText}).`);
  if (sub && CWS_BUSY[sub.state]) {
    const v = ver(sub) || 'a version';
    if (version && v === version) return answer('Chrome', 'ready', `${v} (this release) is already ${CWS_BUSY[sub.state]}; ${liveText}.`);
    return answer('Chrome', 'busy', `${v} is ${CWS_BUSY[sub.state]}; ${liveText}.`);
  }
  const last = sub && sub.state ? ` Last submission: ${ver(sub) || '?'} ${sub.state.toLowerCase().replace(/_/g, ' ')}.` : '';
  return answer('Chrome', 'ready', `${liveText}, nothing in review.${last}`);
}

// addons.mozilla.org: a JWT signed with the API secret, then the add-on's
// listed versions with their file's review status.
export function amoJwt(issuer, secret, now = Date.now()) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const iat = Math.floor(now / 1000);
  const head = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: issuer, jti: randomUUID(), iat, exp: iat + 60 })}`;
  return `${head}.${createHmac('sha256', secret).update(head).digest('base64url')}`;
}
export async function firefoxStatus({ issuer, secret, version, fetchImpl = fetch, now = Date.now }) {
  const url = `${AMO_API}/addons/addon/${encodeURIComponent(FIREFOX_ID)}/versions/?filter=all_with_unlisted&page_size=25`;
  const body = await getJson(fetchImpl, url, { Authorization: `JWT ${amoJwt(issuer, secret, now())}` }, 'addons.mozilla.org versions');
  const listed = (body.results || []).filter((v) => v.channel === 'listed');
  const live = listed.find((v) => v.file && v.file.status === 'public');
  const liveText = live ? `${live.version} is live` : 'nothing live yet';
  const waiting = listed.filter((v) => v.file && v.file.status === 'unreviewed' && !v.is_disabled).map((v) => v.version);
  const others = waiting.filter((v) => v !== version);
  if (others.length) return answer('Firefox', 'busy', `${others.join(', ')} ${others.length === 1 ? 'is' : 'are'} waiting for review; ${liveText}.`);
  if (waiting.length) return answer('Firefox', 'ready', `${version} (this release) is already waiting for review; ${liveText}.`);
  return answer('Firefox', 'ready', `${liveText}, nothing in review.`);
}

// App Store: per platform, any version that isn't live/gone and isn't an
// editable draft is still on its way (Apple allows one at a time).
export async function safariStatus({ key, version, fetchImpl = fetch, now = Date.now }) {
  const auth = () => ({ Authorization: `Bearer ${ascJwt(key, now())}` });
  const apps = await getJson(fetchImpl, `${ASC_API}/v1/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}&limit=1`, auth(), 'App Store Connect apps');
  const app = apps.data && apps.data[0];
  if (!app) throw new Error(`No app with bundle ID ${BUNDLE_ID} in App Store Connect (or the key can't see it).`);
  const parts = [];
  let busy = false;
  for (const platform of PLATFORMS) {
    const versions = (await getJson(fetchImpl, `${ASC_API}/v1/apps/${app.id}/appStoreVersions?filter[platform]=${platform}&limit=20`, auth(), 'App Store Connect versions')).data || [];
    const live = versions.find((v) => ['READY_FOR_DISTRIBUTION', 'READY_FOR_SALE'].includes(state(v)));
    const going = versions.filter((v) => !SETTLED.includes(state(v)) && !EDITABLE.includes(state(v)));
    const liveText = live ? `${live.attributes.versionString} is live` : 'nothing live yet';
    const others = going.filter((v) => v.attributes.versionString !== version);
    if (others.length) {
      busy = true;
      parts.push(`${NAMES[platform]}: ${others.map((v) => `${v.attributes.versionString} is ${describe(state(v))}`).join(', ')}; ${liveText}`);
    } else if (going.length) {
      parts.push(`${NAMES[platform]}: ${version} (this release) is already ${describe(state(going[0]))}; ${liveText}`);
    } else {
      parts.push(`${NAMES[platform]}: ${liveText}, nothing in review`);
    }
  }
  return answer('Safari', busy ? 'busy' : 'ready', `${parts.join('. ')}.`);
}

// Every store, from the environment's keys. Never throws: a store that
// can't be asked is reported as an error (which blocks: it might be busy).
export async function storeStatus({ env = process.env, version = '', fetchImpl = fetch } = {}) {
  const ask = async (store, fn) => {
    try {
      return await fn();
    } catch (err) {
      return answer(store, 'error', `couldn't check: ${err.message}`);
    }
  };
  const out = [];
  if (env.CWS_SERVICE_ACCOUNT_JSON_B64 && env.CWS_PUBLISHER_ID && env.CWS_EXTENSION_ID) {
    out.push(await ask('Chrome', () => {
      let key;
      try {
        key = JSON.parse(Buffer.from(env.CWS_SERVICE_ACCOUNT_JSON_B64, 'base64').toString('utf8'));
      } catch {
        throw new Error('CWS_SERVICE_ACCOUNT_JSON_B64 is not a base64-encoded JSON key.');
      }
      return chromeStatus({ key, publisherId: env.CWS_PUBLISHER_ID, itemId: env.CWS_EXTENSION_ID, version, fetchImpl });
    }));
  } else out.push(answer('Chrome', 'not-set-up', 'no store keys here, not checked.'));
  if (env.EDGE_API_KEY && env.EDGE_PRODUCT_ID && env.EDGE_CLIENT_ID) {
    out.push(answer('Edge', 'unknown', "its API can't report reviews; Partner Center shows them. If one is in progress, the release's edge job fails at publish (the new package stays in the draft): re-run it once the review is done."));
  } else out.push(answer('Edge', 'not-set-up', 'no store keys here, not checked.'));
  if (env.AMO_JWT_ISSUER && env.AMO_JWT_SECRET) {
    out.push(await ask('Firefox', () => firefoxStatus({ issuer: env.AMO_JWT_ISSUER, secret: env.AMO_JWT_SECRET, version, fetchImpl })));
  } else out.push(answer('Firefox', 'not-set-up', 'no store keys here, not checked.'));
  if (env.ASC_API_KEY_ID && env.ASC_API_ISSUER_ID && env.ASC_API_KEY_P8_B64) {
    out.push(await ask('Safari', () => safariStatus({ key: { keyId: env.ASC_API_KEY_ID, issuerId: env.ASC_API_ISSUER_ID, p8: Buffer.from(env.ASC_API_KEY_P8_B64, 'base64').toString('utf8') }, version, fetchImpl })));
  } else out.push(answer('Safari', 'not-set-up', 'no store keys here, not checked.'));
  return out;
}

export const blocking = (results) => results.filter((r) => r.status === 'busy' || r.status === 'error');
const ICON = { ready: '✅', busy: '⏳', 'not-set-up': '➖', unknown: '❔', error: '⚠️' };

export function report(results) {
  const lines = results.map((r) => `${ICON[r.status]} ${r.store}: ${r.text}`);
  const block = blocking(results);
  lines.push('', block.length
    ? `Not safe to release yet: ${block.map((r) => r.store).join(', ')} still ${block.some((r) => r.status === 'busy') ? 'busy' : "couldn't be checked"}. Let the review finish, then check again.`
    : 'Safe to release: no store has a review in progress.');
  return lines.join('\n');
}

async function main() {
  const i = process.argv.indexOf('--version');
  const version = i > 0 ? String(process.argv[i + 1] || '').replace(/^v/, '') : '';
  const results = await storeStatus({ version });
  const text = report(results);
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Store status${version ? ` for ${version}` : ''}\n\n${text.split('\n').map((l) => (l ? `${l}  ` : '')).join('\n')}\n`);
  if (blocking(results).length) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`::error::${err.message}`);
    process.exit(1);
  });
}
