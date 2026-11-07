// Playwright config — e2e tests live in test/e2e/ and run serially
// (one Chromium + extension instance at a time). The mock Schoology server
// is started inside the spec file itself (test/e2e/extension.spec.js).
// Run: npm run test:e2e   (from the repo root)
// NOTE: tests run in Chromium via Playwright. Safari cannot be automated
// here; the Safari build is verified separately.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    headless: true,
    // Full Chromium (new headless). The headless shell cannot load extensions.
    channel: 'chromium',
  },
});
