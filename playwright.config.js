// Playwright config — e2e tests live in test/e2e/ and run serially
// (one Chromium + extension instance at a time). The mock Schoology server
// is started inside the spec file itself (test/e2e/extension.spec.js).
// Run: npm run test:e2e   (from the repo root)
// NOTE: tests run in Chromium via Playwright. Safari cannot be automated
// here; the Safari build is verified separately.
import { defineConfig } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Playwright 1.49 headless launches use the headless shell. If its download
// failed in this environment but the full Chromium build is present, fall
// back to it (same engine, `--headless=new`). On a machine where
// `npx playwright install chromium` succeeds, this fallback is inert.
function headlessShellFallback() {
  const browsersPath =
    process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), '.cache', 'ms-playwright');
  if (!existsSync(browsersPath)) return {};
  const entries = readdirSync(browsersPath);
  const hasShell = entries.some((e) => e.startsWith('chromium_headless_shell-'));
  if (hasShell) return {};
  const full = entries
    .filter((e) => /^chromium-\d+$/.test(e))
    .map((e) => path.join(browsersPath, e, 'chrome-linux64', 'chrome'))
    .find((p) => existsSync(p));
  return full ? { executablePath: full } : {};
}

export default defineConfig({
  testDir: './test/e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    headless: true,
    launchOptions: headlessShellFallback(),
  },
});
