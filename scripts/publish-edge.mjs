#!/usr/bin/env node
// publish-edge.mjs — upload a release ZIP to Microsoft Edge Add-ons and
// publish it (Edge Add-ons Update REST API v1.1). Run by the release
// workflow's `edge` job; see docs/edge-add-ons-setup.md.
//
//   node scripts/publish-edge.mjs <path/to/…-chrome.zip> [--version X.Y.Z] [--draft-only]
//
// Edge takes the Chrome ZIP as is. Two steps, each an operation the store
// finishes in the background, so each is followed until it is done:
//   1. upload the package into the product's draft submission;
//   2. publish the draft, which sends it to certification with the notes
//      for certification (store/edge/certification-notes.txt, plus this
//      version's release notes). It goes live when certification passes.
// --draft-only stops after step 1 (the owner then clicks Publish in Partner
// Center).
//
// Environment (GitHub `release` environment; never in the repo):
//   EDGE_PRODUCT_ID   the product's GUID (Partner Center → Microsoft Edge →
//                     Overview → the extension → Extension identity)
//   EDGE_CLIENT_ID    Partner Center → Microsoft Edge → Publish API
//   EDGE_API_KEY      same page; it expires, the page shows when
//
// Only Node's own fetch: no third-party action or CLI. The API key is never
// printed.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NOTES_FILE, releaseFor, toPlain } from './release-notes.mjs';

const API = 'https://api.addons.microsoftedge.microsoft.com';
const GUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CERT_NOTES_FILE = path.join(ROOT, 'store/edge/certification-notes.txt');

// What to do about the publish errors Edge names (API reference, "Check the
// publishing status").
const PUBLISH_HINTS = {
  InProgressSubmission: 'An earlier submission is still in certification. Wait for it to finish (Partner Center shows it), then re-run this job: the draft already holds the new package.',
  NoModulesUpdated: 'The draft is the same as what is already published. Was this version submitted before?',
  UnpublishInProgress: 'The extension is being unpublished in Partner Center. Wait for that to finish, then re-run this job.',
  ModuleStateUnPublishable: 'A part of the draft (Availability, Properties, Privacy, Store listings) is not valid. Fix it in Partner Center, then re-run this job or click Publish there.',
  SubmissionValidationError: 'Partner Center found problems with the draft. Fix them there, then re-run this job or click Publish there.',
  CreateNotAllowed: 'The API can only update an existing extension; the first submission is made by hand (docs/edge-add-ons-setup.md §2).',
};

// The body as JSON if it is JSON, else { raw } (error pages can be HTML).
async function readBody(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text.slice(0, 300) };
  }
}

async function check(res, what) {
  const body = await readBody(res);
  if (!res.ok) {
    const msg = body.message || (body.error && (body.error.message || body.error)) || body.raw || res.statusText || '';
    throw new Error(`${what} failed (HTTP ${res.status})${msg ? `: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}` : ''}`);
  }
  return body;
}

const errorList = (errors) => (Array.isArray(errors) ? errors : []).map((e) => (typeof e === 'string' ? e : (e && e.message) || JSON.stringify(e)));

// The operation ID comes back in Location (the bare ID, or a path ending in it).
const operationIdOf = (res) => String((res.headers && res.headers.get('Location')) || '').split('?')[0].split('/').filter(Boolean).pop();

// The notes for certification: the reviewer text, then what changed.
export function certificationNotes({ reviewerText, version, releaseNotes }) {
  const parts = [String(reviewerText || '').trim()];
  if (version) parts.push(`What's new in ${version}:\n${String(releaseNotes || '').trim() || 'Small fixes.'}`);
  return parts.filter(Boolean).join('\n\n');
}

// publishEdge({ zip, productId, clientId, apiKey, notes, draftOnly }) ->
// { upload, publish } (the finished operations; publish is null with
// draftOnly). log() reports progress.
export async function publishEdge({ zip, productId, clientId, apiKey, notes = '', draftOnly = false, fetchImpl = fetch, log = console.log, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), pollMs = 5000, pollTries = 36 }) {
  if (!GUID.test(productId || '')) throw new Error('EDGE_PRODUCT_ID must be the product\'s GUID (Partner Center → the extension → Extension identity).');
  if (!clientId) throw new Error('EDGE_CLIENT_ID is not set (Partner Center → Microsoft Edge → Publish API).');
  if (!apiKey) throw new Error('EDGE_API_KEY is not set (Partner Center → Microsoft Edge → Publish API).');
  const auth = { Authorization: `ApiKey ${apiKey}`, 'X-ClientID': clientId };
  const submissions = `${API}/v1/products/${productId}/submissions`;
  const draft = `${submissions}/draft/package`;

  // Follows an operation until it finishes; returns it, or throws.
  async function follow(statusUrl, what, failed) {
    let last = null;
    for (let i = 0; i < pollTries; i++) {
      if (i > 0) await sleep(pollMs);
      last = await check(await fetchImpl(statusUrl, { method: 'GET', headers: auth }), `Checking the ${what}`);
      if (last.status === 'Succeeded') return last;
      if (last.status === 'Failed') throw new Error(failed(last));
    }
    throw new Error(`The ${what} was still in progress after ${pollTries} checks (last status: ${(last && last.status) || 'unknown'}). Check the extension in Partner Center.`);
  }
  const reason = (op) => [op.message, op.errorCode && `(${op.errorCode})`, ...errorList(op.errors)].filter(Boolean).join(' ') || 'no reason given';

  // 1. Upload into the draft.
  log(`Uploading ${zip.name} (${Math.round(zip.data.length / 1024)} KB) to the Edge draft…`);
  const up = await fetchImpl(draft, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/zip' }, body: zip.data });
  await check(up, 'Upload');
  const uploadId = operationIdOf(up);
  if (!uploadId) throw new Error('Upload was accepted, but the store sent no Location header with the operation ID.');
  const upload = await follow(`${draft}/operations/${encodeURIComponent(uploadId)}`, 'upload', (op) => `Edge rejected the upload: ${reason(op)}`);
  log(`Draft updated${upload.message ? `: ${upload.message}` : '.'}`);

  if (draftOnly) {
    log('Not published (--draft-only): open Partner Center and click Publish to send it to certification.');
    return { upload, publish: null };
  }

  // 2. Publish the draft: it goes to certification.
  log('Publishing the draft (sends it to certification)…');
  const pub = await fetchImpl(submissions, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ notes }) });
  await check(pub, 'Publish');
  const publishId = operationIdOf(pub);
  if (!publishId) throw new Error('Publish was accepted, but the store sent no Location header with the operation ID. Check the extension in Partner Center.');
  const publish = await follow(`${submissions}/operations/${encodeURIComponent(publishId)}`, 'publish', (op) => {
    const hint = PUBLISH_HINTS[op.errorCode];
    return `Edge didn't publish the draft (the new package is in the draft): ${reason(op)}${hint ? `\n${hint}` : ''}`;
  });
  log(`Submitted for certification${publish.message ? `: ${publish.message}` : '.'}`);
  log('It goes live when certification passes (up to seven business days). Partner Center shows its progress.');
  return { upload, publish };
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name) => args.includes(`--${name}`);
  const value = (name) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] || '' : '';
  };
  const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--version');
  if (!file) throw new Error('Usage: node scripts/publish-edge.mjs <chrome.zip> [--version X.Y.Z] [--draft-only]');
  const version = value('version').replace(/^v/, '');
  const draftOnly = flag('draft-only');
  let notes = '';
  if (!draftOnly) {
    const rel = version ? releaseFor(await readFile(NOTES_FILE, 'utf8'), version) : null;
    if (version && !rel) throw new Error(`RELEASE_NOTES.md has no section for ${version}.`);
    notes = certificationNotes({ reviewerText: await readFile(CERT_NOTES_FILE, 'utf8'), version, releaseNotes: rel ? toPlain(rel) : '' });
  }
  await publishEdge({
    zip: { name: path.basename(file), data: await readFile(file) },
    productId: process.env.EDGE_PRODUCT_ID,
    clientId: process.env.EDGE_CLIENT_ID,
    apiKey: process.env.EDGE_API_KEY,
    notes,
    draftOnly,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`::error::${err.message.split('\n').join('%0A')}`);
    process.exit(1);
  });
}
