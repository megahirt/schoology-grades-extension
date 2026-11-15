#!/usr/bin/env node
// publish-edge.mjs — upload a release ZIP to Microsoft Edge Add-ons as a
// DRAFT (Edge Add-ons Update REST API v1.1). Run by the release workflow's
// `edge` job; see docs/edge-add-ons-setup.md.
//
//   node scripts/publish-edge.mjs <path/to/…-chrome.zip>
//
// Edge takes the Chrome ZIP as is. This only uploads the package into the
// product's draft submission and waits for the store to accept it. It never
// calls the publish endpoint: the owner clicks Publish in Partner Center,
// which sends the draft to certification.
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

const API = 'https://api.addons.microsoftedge.microsoft.com';
const GUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

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

// publishEdge({ zip, productId, clientId, apiKey }) -> the finished upload
// operation ({ id, status: 'Succeeded', message, … }). log() reports progress.
export async function publishEdge({ zip, productId, clientId, apiKey, fetchImpl = fetch, log = console.log, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), pollMs = 5000, pollTries = 36 }) {
  if (!GUID.test(productId || '')) throw new Error('EDGE_PRODUCT_ID must be the product\'s GUID (Partner Center → the extension → Extension identity).');
  if (!clientId) throw new Error('EDGE_CLIENT_ID is not set (Partner Center → Microsoft Edge → Publish API).');
  if (!apiKey) throw new Error('EDGE_API_KEY is not set (Partner Center → Microsoft Edge → Publish API).');
  const auth = { Authorization: `ApiKey ${apiKey}`, 'X-ClientID': clientId };
  const draft = `${API}/v1/products/${productId}/submissions/draft/package`;

  log(`Uploading ${zip.name} (${Math.round(zip.data.length / 1024)} KB) to the Edge draft…`);
  const up = await fetchImpl(draft, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/zip' }, body: zip.data });
  await check(up, 'Upload');
  // The operation ID comes back in Location (the bare ID, or a path ending in it).
  const operationId = String((up.headers && up.headers.get('Location')) || '').split('?')[0].split('/').filter(Boolean).pop();
  if (!operationId) throw new Error('Upload was accepted, but the store sent no Location header with the operation ID.');

  let last = null;
  for (let i = 0; i < pollTries; i++) {
    if (i > 0) await sleep(pollMs);
    last = await check(await fetchImpl(`${draft}/operations/${encodeURIComponent(operationId)}`, { method: 'GET', headers: auth }), 'Checking the upload');
    if (last.status === 'Succeeded') {
      log(`Draft updated${last.message ? `: ${last.message}` : '.'}`);
      log('Not published: open Partner Center and click Publish to send it to certification.');
      return last;
    }
    if (last.status === 'Failed') {
      const parts = [last.message, last.errorCode && `(${last.errorCode})`, ...errorList(last.errors)].filter(Boolean);
      throw new Error(`Edge rejected the upload: ${parts.join(' ') || 'no reason given'}`);
    }
  }
  throw new Error(`The upload was still in progress after ${pollTries} checks (last status: ${(last && last.status) || 'unknown'}). Check the draft in Partner Center.`);
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: node scripts/publish-edge.mjs <chrome.zip>');
  await publishEdge({
    zip: { name: path.basename(file), data: await readFile(file) },
    productId: process.env.EDGE_PRODUCT_ID,
    clientId: process.env.EDGE_CLIENT_ID,
    apiKey: process.env.EDGE_API_KEY,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`::error::${err.message}`);
    process.exit(1);
  });
}
