#!/usr/bin/env node
// find-schoology-hosts.mjs — `npm run school-hosts`
//
// Rebuilds extension/src/school-hosts.json: schools' own Schoology
// addresses (e.g. schoology.npchristian.org, lms.lausd.net). The extension
// uses the list to recognise a school's Schoology site and to suggest
// addresses in Settings. It is NOT a list of permissions: the extension
// asks the family for access to their one school's address when they click
// to use it there (see extension/src/sites.js and docs/schoology-domains-research.md).
//
// Where the names come from:
//   1. PowerSchool's shared TLS certificates. A school's own domain is a
//      CNAME to domain-ssl.schoology.com / domain-ssl-1.schoology.com (or the
//      older domain.schoology.com), and Schoology serves those from a few
//      certificates that list every school domain in their SANs. We connect
//      to each endpoint IP with a few SNI names and read the SANs.
//   2. scripts/school-hosts-extra.txt: addresses found by hand (district
//      help pages and the like), one per line.
//   3. The current school-hosts.json, so a school is only dropped when it
//      stops checking out.
//   (Certificate transparency, crt.sh, adds nothing here: a search by name
//   only returns that name, and it is often down.)
//
// Every candidate must then still be Schoology today: its DNS has to point
// at Schoology (a CNAME chain reaching *.schoology.com, or A records on the
// custom-domain endpoints' IPs), or, for a school behind its own proxy such
// as Cloudflare, its /login page must answer with Schoology's own
// x-schoology-server header. Anything else (a school that left Schoology, a
// domain that changed hands, a name that no longer exists) is dropped.
//
// Options: --dry-run (print, don't write).

import tls from 'node:tls';
import dns from 'node:dns/promises';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'extension', 'src', 'school-hosts.json');
const EXTRA = path.join(root, 'scripts', 'school-hosts-extra.txt');
const ENDPOINTS = ['domain-ssl.schoology.com', 'domain-ssl-1.schoology.com', 'domain.schoology.com'];
const args = new Set(process.argv.slice(2));

const HOST_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const clean = (h) => String(h || '').trim().toLowerCase().replace(/\.$/, '');
const isCandidate = (h) => HOST_RE.test(h) && !h.startsWith('*.') && h !== 'schoology.com' && !h.endsWith('.schoology.com');

// SANs of the certificate an IP serves for one SNI name.
function certSans(ip, servername) {
  return new Promise((resolve) => {
    const socket = tls.connect({ host: ip, port: 443, servername, rejectUnauthorized: false, timeout: 10000 }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      const sans = String((cert && cert.subjectaltname) || '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.startsWith('DNS:'))
        .map((s) => clean(s.slice(4)));
      resolve({ sans, notAfter: cert && cert.valid_to });
    });
    socket.on('error', () => resolve({ sans: [] }));
    socket.on('timeout', () => { socket.destroy(); resolve({ sans: [] }); });
  });
}

async function fromCertificates(seeds, endpointIps) {
  const found = new Set();
  const seen = new Set();
  for (const endpoint of ENDPOINTS) {
    let ips = [];
    try { ips = await dns.resolve4(endpoint); } catch { continue; }
    for (const ip of ips) endpointIps.add(ip);
    for (const ip of ips) {
      for (const sni of [endpoint, ...seeds]) {
        const { sans, notAfter } = await certSans(ip, sni);
        const schools = sans.filter(isCandidate);
        const id = `${schools.length}/${notAfter}`;
        if (schools.length && !seen.has(id)) {
          seen.add(id);
          console.log(`  certificate on ${endpoint}: ${schools.length} school names, expires ${notAfter}`);
        }
        for (const h of schools) found.add(h);
      }
    }
  }
  return found;
}

// true when the host's CNAME chain reaches a *.schoology.com host, or its
// A records are the custom-domain endpoints' IPs.
async function dnsPointsToSchoology(host, endpointIps) {
  let name = host;
  for (let i = 0; i < 6; i += 1) {
    let cnames = [];
    try { cnames = await dns.resolveCname(name); } catch { break; }
    if (!cnames.length) break;
    name = clean(cnames[0]);
    if (name === 'schoology.com' || name.endsWith('.schoology.com')) return true;
  }
  try {
    const ips = await dns.resolve4(host);
    return ips.length > 0 && ips.every((ip) => endpointIps.has(ip));
  } catch {
    return false;
  }
}

// true when https://host/login answers as Schoology (its own header).
async function answersAsSchoology(host) {
  try {
    const res = await fetch(`https://${host}/login`, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(15000) });
    return res.headers.has('x-schoology-server');
  } catch {
    return false;
  }
}

async function isSchoologyNow(host, endpointIps) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (await dnsPointsToSchoology(host, endpointIps)) return true;
  }
  return answersAsSchoology(host);
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

async function main() {
  let previous = [];
  try { previous = JSON.parse(await readFile(OUT, 'utf8')).hosts || []; } catch { /* first run */ }
  let extra = [];
  try {
    extra = (await readFile(EXTRA, 'utf8')).split('\n').map((l) => clean(l.replace(/#.*/, ''))).filter(isCandidate);
  } catch { /* no extras */ }
  const seeds = [...new Set(['schoology.npchristian.org', 'lms.lausd.net', ...extra.slice(0, 5)])];

  console.log('Certificates:');
  const endpointIps = new Set();
  const candidates = new Set([...(await fromCertificates(seeds, endpointIps)), ...extra, ...previous]);

  const list = [...candidates].sort();
  console.log(`Checking that ${list.length} candidates are still Schoology...`);
  const ok = await mapLimit(list, 16, (h) => isSchoologyNow(h, endpointIps));
  const hosts = list.filter((_, i) => ok[i]);
  const dropped = list.filter((_, i) => !ok[i]);
  const gone = previous.filter((h) => !hosts.includes(h));
  const added = hosts.filter((h) => !previous.includes(h));
  console.log(`${hosts.length} school addresses point to Schoology (${added.length} new, ${gone.length} no longer).`);
  if (dropped.length) console.log(`Dropped (not Schoology now): ${dropped.join(', ')}`);
  if (gone.length) console.log(`No longer checking out: ${gone.join(', ')}`);

  if (args.has('--dry-run')) return;
  const data = {
    about: 'Schools\' own Schoology addresses, from PowerSchool\'s shared certificates, checked in DNS. Generated by scripts/find-schoology-hosts.mjs; not permissions.',
    generated: new Date().toISOString().slice(0, 10),
    hosts,
  };
  await writeFile(OUT, `${JSON.stringify(data, null, 1)}\n`);
  console.log(`Wrote ${path.relative(root, OUT)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
