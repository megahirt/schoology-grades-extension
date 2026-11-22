#!/usr/bin/env node
// submit-appstore.mjs — after the release workflow's `safari` job uploads
// the Mac and iOS builds, this sends version X.Y.Z to App Review through the
// App Store Connect API. Run by .github/workflows/release.yml; see
// docs/safari.md ("Releases from GitHub Actions").
//
//   node scripts/submit-appstore.mjs --version 1.4.0 --build 16 [--platforms IOS,MAC_OS]
//
// Environment (GitHub `release` environment; never in the repo):
//   ASC_API_KEY_ID        the key's ID (App Store Connect → Users and Access → Integrations)
//   ASC_API_ISSUER_ID     the issuer ID on the same page
//   ASC_API_KEY_P8_B64    the downloaded AuthKey_….p8, base64
//   WHATS_NEW             optional: the "What's New" text. Default: a short
//                         line pointing at the GitHub release notes.
//
// For each platform it: waits for Apple to finish processing the uploaded
// build, answers the export-compliance question (no non-exempt encryption),
// finds or creates the App Store version X.Y.Z (released automatically once
// approved), attaches the build, sets "What's New" in every language, and
// submits it for review. Run again after a failure: every step checks what
// is already done. Only Node's own crypto and fetch. The key and tokens are
// never printed.

import { createSign } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://api.appstoreconnect.apple.com';
export const BUNDLE_ID = 'net.hirtfamily.schoology-dashboard';
export const PLATFORMS = ['IOS', 'MAC_OS'];
export const NAMES = { IOS: 'iPhone and iPad', MAC_OS: 'Mac' };
// Versions App Store Connect still lets us edit (and so attach a build to).
export const EDITABLE = ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY'];

const b64url = (buf) => Buffer.from(buf).toString('base64url');

// ascJwt({ keyId, issuerId, p8 }, now) -> a 20-minute ES256 token for the API.
export function ascJwt({ keyId, issuerId, p8 }, now = Date.now()) {
  if (!keyId || !issuerId || !p8) throw new Error('ASC_API_KEY_ID, ASC_API_ISSUER_ID and ASC_API_KEY_P8_B64 must all be set.');
  const iat = Math.floor(now / 1000);
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: issuerId, iat, exp: iat + 1200, aud: 'appstoreconnect-v1' }));
  const signer = createSign('SHA256');
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${b64url(signer.sign({ key: p8, dsaEncoding: 'ieee-p1363' }))}`;
}

// state(version) -> its App Store state (appVersionState is the newer name).
// States of a version that is finished with (live, or gone): anything else
// still blocks a new version on that platform.
export const SETTLED = ['READY_FOR_DISTRIBUTION', 'READY_FOR_SALE', 'REPLACED_WITH_NEW_VERSION', 'REMOVED_FROM_SALE', 'DEVELOPER_REMOVED_FROM_SALE'];
const DESCRIBE = {
  WAITING_FOR_REVIEW: 'waiting for review', IN_REVIEW: 'in review',
  PENDING_DEVELOPER_RELEASE: 'approved and waiting for you to release it',
  PENDING_APPLE_RELEASE: 'approved and waiting for Apple to release it',
  PROCESSING_FOR_DISTRIBUTION: 'approved and being prepared for release',
  PROCESSING_FOR_APP_STORE: 'approved and being prepared for release',
};
export const describe = (s) => DESCRIBE[s] || `in state ${s || 'unknown'}`;
export const state = (v) => (v && v.attributes && (v.attributes.appVersionState || v.attributes.appStoreState)) || '';

export async function submitAppStore({
  version, build, platforms = PLATFORMS, key, whatsNew, fetchImpl = fetch, log = console.log,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)), pollMs = 30000, pollTries = 120, now = Date.now,
}) {
  if (!/^\d+\.\d+\.\d+$/.test(version || '')) throw new Error(`--version must be X.Y.Z (got "${version}").`);
  if (!/^\d+$/.test(String(build || ''))) throw new Error(`--build must be a number (got "${build}").`);
  for (const p of platforms) if (!PLATFORMS.includes(p)) throw new Error(`Unknown platform ${p} (use ${PLATFORMS.join(', ')}).`);
  ascJwt(key, now()); // fail early on a bad key

  async function api(method, url, body) {
    const res = await fetchImpl(`${API}${url}`, {
      method,
      headers: { Authorization: `Bearer ${ascJwt(key, now())}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text.slice(0, 500) };
    }
    if (!res.ok) {
      const errs = (json.errors || []).map((e) => e.detail || e.title).filter(Boolean).join('; ');
      throw new Error(`${method} ${url.split('?')[0]} failed (HTTP ${res.status}): ${errs || json.raw || 'no details'}`);
    }
    return json;
  }

  const apps = await api('GET', `/v1/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}&limit=1`);
  const app = apps.data && apps.data[0];
  if (!app) throw new Error(`No app with bundle ID ${BUNDLE_ID} in App Store Connect (or the key can't see it).`);
  const text = (whatsNew || '').trim() || `Improvements and fixes. Full notes: https://github.com/megahirt/schoology-grades-extension/releases/tag/v${version}`;
  const results = {};
  const busy = [];

  for (const platform of platforms) {
    const name = NAMES[platform];

    // 1. The uploaded build, once Apple has processed it.
    const q = `/v1/builds?filter[app]=${app.id}&filter[version]=${build}&filter[preReleaseVersion.version]=${version}&filter[preReleaseVersion.platform]=${platform}&limit=1`;
    let b = null;
    for (let i = 0; i <= pollTries; i++) {
      b = (await api('GET', q)).data?.[0] || null;
      const s = b && b.attributes.processingState;
      if (s === 'VALID') break;
      if (s === 'INVALID' || s === 'FAILED') throw new Error(`Apple rejected the ${name} build ${version} (${build}) while processing it (${s}). Check the email from App Store Connect.`);
      if (i === pollTries) throw new Error(`The ${name} build ${version} (${build}) was not ready after ${Math.round((pollTries * pollMs) / 60000)} minutes. Run this job again later.`);
      if (i === 0) log(`${name}: waiting for Apple to process build ${version} (${build})…`);
      await sleep(pollMs);
    }
    log(`${name}: build ${version} (${build}) is processed.`);
    if (b.attributes.usesNonExemptEncryption == null) {
      await api('PATCH', `/v1/builds/${b.id}`, { data: { type: 'builds', id: b.id, attributes: { usesNonExemptEncryption: false } } });
      log(`${name}: answered export compliance (no non-exempt encryption).`);
    }

    // 2. The App Store version X.Y.Z: reuse it, rename an editable draft, or create it.
    const versions = (await api('GET', `/v1/apps/${app.id}/appStoreVersions?filter[platform]=${platform}&limit=20`)).data || [];
    let v = versions.find((x) => x.attributes.versionString === version);
    if (v && !EDITABLE.includes(state(v))) {
      log(`${name}: version ${version} is already ${state(v)}; nothing to submit.`);
      results[platform] = state(v);
      continue;
    }
    if (!v) {
      const draft = versions.find((x) => EDITABLE.includes(state(x)));
      if (draft) {
        v = (await api('PATCH', `/v1/appStoreVersions/${draft.id}`, { data: { type: 'appStoreVersions', id: draft.id, attributes: { versionString: version, releaseType: 'AFTER_APPROVAL' } } })).data;
        log(`${name}: renamed the draft version ${draft.attributes.versionString} to ${version}.`);
      } else {
        try {
          v = (await api('POST', '/v1/appStoreVersions', { data: { type: 'appStoreVersions', attributes: { platform, versionString: version, releaseType: 'AFTER_APPROVAL' }, relationships: { app: { data: { type: 'apps', id: app.id } } } } })).data;
        } catch (err) {
          // 409: Apple allows one version in progress per platform.
          const other = /HTTP 409/.test(err.message) && versions.find((x) => !SETTLED.includes(state(x)));
          if (!other) throw err;
          busy.push(`${name}: version ${other.attributes.versionString} is ${describe(state(other))}, and Apple allows only one version in progress at a time. Build ${build} is uploaded; re-run this job once ${other.attributes.versionString} is released (it uploads a fresh build), or remove ${other.attributes.versionString} from review in App Store Connect and re-run to send ${version} instead.`);
          log(`${name}: can't add ${version} yet: ${other.attributes.versionString} is ${describe(state(other))}.`);
          results[platform] = 'BLOCKED';
          continue;
        }
        log(`${name}: created version ${version}.`);
      }
    }

    // 3. Attach the build and set "What's New" in every language.
    await api('PATCH', `/v1/appStoreVersions/${v.id}/relationships/build`, { data: { type: 'builds', id: b.id } });
    const locs = (await api('GET', `/v1/appStoreVersions/${v.id}/appStoreVersionLocalizations?limit=50`)).data || [];
    for (const l of locs) {
      await api('PATCH', `/v1/appStoreVersionLocalizations/${l.id}`, { data: { type: 'appStoreVersionLocalizations', id: l.id, attributes: { whatsNew: text } } });
    }
    log(`${name}: attached build ${build} and set What's New (${locs.length} language${locs.length === 1 ? '' : 's'}).`);

    // 4. Submit for review (reusing an unsent submission if one is open).
    const open = (await api('GET', `/v1/reviewSubmissions?filter[app]=${app.id}&filter[platform]=${platform}&filter[state]=READY_FOR_REVIEW&limit=1`)).data?.[0];
    const sub = open || (await api('POST', '/v1/reviewSubmissions', { data: { type: 'reviewSubmissions', attributes: { platform }, relationships: { app: { data: { type: 'apps', id: app.id } } } } })).data;
    try {
      await api('POST', '/v1/reviewSubmissionItems', { data: { type: 'reviewSubmissionItems', relationships: { reviewSubmission: { data: { type: 'reviewSubmissions', id: sub.id } }, appStoreVersion: { data: { type: 'appStoreVersions', id: v.id } } } } });
    } catch (err) {
      // Already in this submission (a re-run): carry on and send it.
      if (!open || !/HTTP 409/.test(err.message)) throw err;
    }
    await api('PATCH', `/v1/reviewSubmissions/${sub.id}`, { data: { type: 'reviewSubmissions', id: sub.id, attributes: { submitted: true } } });
    log(`${name}: submitted ${version} for review. It goes live by itself once Apple approves it.`);
    results[platform] = 'WAITING_FOR_REVIEW';
  }
  if (busy.length) throw new Error(busy.join(' '));
  return results;
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  await submitAppStore({
    version: arg('version'),
    build: arg('build'),
    platforms: (arg('platforms') || PLATFORMS.join(',')).split(',').map((s) => s.trim()).filter(Boolean),
    key: {
      keyId: process.env.ASC_API_KEY_ID,
      issuerId: process.env.ASC_API_ISSUER_ID,
      p8: Buffer.from(process.env.ASC_API_KEY_P8_B64 || '', 'base64').toString('utf8'),
    },
    whatsNew: process.env.WHATS_NEW,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`::error::${err.message}`);
    process.exit(1);
  });
}
