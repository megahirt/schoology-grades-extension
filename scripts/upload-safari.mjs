#!/usr/bin/env node
// upload-safari.mjs — archive the Mac and iOS apps from the Xcode project
// that `npm run build:safari` made, sign them for the App Store, and upload
// them to App Store Connect. Run by the release workflow's `safari` job on a
// macOS runner; also works on a Mac. See docs/safari.md.
//
//   node scripts/upload-safari.mjs [--platforms macOS,iOS] [--no-upload | --compile-only]
//
// --no-upload signs and exports the .pkg/.ipa into safari/build/export-*
// instead of uploading (a dry run that still proves signing works).
// --compile-only builds both apps unsigned and needs no key or team: the
// release workflow's `safari-build` job runs it before any approval, so a
// broken Safari build stops the release before anything reaches a store.
//
// Environment:
//   APPLE_TEAM_ID         the Apple developer team (10 characters)
//   ASC_API_KEY_ID, ASC_API_ISSUER_ID, ASC_API_KEY_P8_B64
//                         the App Store Connect API key. Signing is
//                         cloud-managed through it (-allowProvisioningUpdates):
//                         no certificate or profile is stored anywhere. The
//                         key needs the Admin role (or App Manager with
//                         access to cloud-managed certificates).
//
// Build number and version are whatever build:safari wrote into the project
// (BUILD_NUMBER, RELEASE_VERSION).

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_NAME = 'Grades Dashboard for Schoology';
const PROJECT = path.join(repoRoot, 'safari', APP_NAME, `${APP_NAME}.xcodeproj`);
const BUILD_DIR = path.join(repoRoot, 'safari', 'build');
const DESTINATIONS = { macOS: 'generic/platform=macOS', iOS: 'generic/platform=iOS' };

// exportOptions(teamId, upload) -> the ExportOptions.plist text.
export function exportOptions(teamId, upload) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>${upload ? 'upload' : 'export'}</string>
  <key>teamID</key><string>${teamId}</string>
  <key>signingStyle</key><string>automatic</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
  <key>uploadSymbols</key><true/>
</dict>
</plist>
`;
}

// xcodebuildArgs(step, platform, opts) -> the xcodebuild arguments.
export function xcodebuildArgs(step, platform, { teamId, keyPath, keyId, issuerId, optionsPath } = {}) {
  if (step === 'compile') {
    return ['build', '-project', PROJECT, '-scheme', `${APP_NAME} (${platform})`, '-configuration', 'Release',
      '-destination', DESTINATIONS[platform], '-derivedDataPath', path.join(BUILD_DIR, 'compile'),
      'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO', 'CODE_SIGN_IDENTITY='];
  }
  const archive = path.join(BUILD_DIR, `${platform}.xcarchive`);
  const auth = ['-allowProvisioningUpdates', '-authenticationKeyPath', keyPath, '-authenticationKeyID', keyId, '-authenticationKeyIssuerID', issuerId];
  if (step === 'archive') {
    return ['archive', '-project', PROJECT, '-scheme', `${APP_NAME} (${platform})`, '-configuration', 'Release',
      '-destination', DESTINATIONS[platform], '-archivePath', archive, ...auth,
      `DEVELOPMENT_TEAM=${teamId}`, 'CODE_SIGN_STYLE=Automatic'];
  }
  return ['-exportArchive', '-archivePath', archive, '-exportPath', path.join(BUILD_DIR, `export-${platform}`), '-exportOptionsPlist', optionsPath, ...auth];
}

function main() {
  const i = process.argv.indexOf('--platforms');
  const platforms = (i > 0 ? process.argv[i + 1] : 'macOS,iOS').split(',').map((s) => s.trim()).filter(Boolean);
  for (const p of platforms) if (!DESTINATIONS[p]) throw new Error(`Unknown platform ${p} (use macOS, iOS).`);
  if (process.argv.includes('--compile-only')) {
    for (const platform of platforms) {
      console.log(`\n== ${platform}: compile (unsigned) ==`);
      const r = spawnSync('xcodebuild', xcodebuildArgs('compile', platform), { stdio: 'inherit' });
      if (r.status !== 0) throw new Error(`xcodebuild build for ${platform} failed (exit ${r.status}).`);
    }
    console.log(`\nDone: ${platforms.join(' and ')} compiled (unsigned, nothing uploaded).`);
    return;
  }
  const upload = !process.argv.includes('--no-upload');
  const teamId = (process.env.APPLE_TEAM_ID || '').trim();
  const keyId = process.env.ASC_API_KEY_ID;
  const issuerId = process.env.ASC_API_ISSUER_ID;
  const p8 = Buffer.from(process.env.ASC_API_KEY_P8_B64 || '', 'base64').toString('utf8');
  if (!/^[A-Z0-9]{10}$/.test(teamId)) throw new Error('APPLE_TEAM_ID must be the 10-character Apple team ID.');
  if (!keyId || !issuerId || !p8.includes('PRIVATE KEY')) throw new Error('ASC_API_KEY_ID, ASC_API_ISSUER_ID and ASC_API_KEY_P8_B64 (a base64 .p8) must all be set.');

  // The key goes in a private temp folder for xcodebuild, and is removed after.
  const keyDir = mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'asc-'));
  const keyPath = path.join(keyDir, `AuthKey_${keyId}.p8`);
  writeFileSync(keyPath, p8, { mode: 0o600 });
  mkdirSync(BUILD_DIR, { recursive: true });
  const optionsPath = path.join(BUILD_DIR, 'ExportOptions.plist');
  writeFileSync(optionsPath, exportOptions(teamId, upload));
  try {
    for (const platform of platforms) {
      for (const step of ['archive', 'export']) {
        console.log(`\n== ${platform}: ${step === 'archive' ? 'archive' : upload ? 'sign and upload to App Store Connect' : 'sign and export'} ==`);
        const r = spawnSync('xcodebuild', xcodebuildArgs(step, platform, { teamId, keyPath, keyId, issuerId, optionsPath }), { stdio: 'inherit' });
        if (r.status !== 0) throw new Error(`xcodebuild ${step} for ${platform} failed (exit ${r.status}). Signing errors usually mean the API key's role is too low (it needs Admin).`);
      }
    }
  } finally {
    rmSync(keyDir, { recursive: true, force: true });
  }
  console.log(`\nDone: ${platforms.join(' and ')} ${upload ? 'uploaded to App Store Connect' : `exported to ${BUILD_DIR}`}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(`::error::${err.message}`);
    process.exit(1);
  }
}
