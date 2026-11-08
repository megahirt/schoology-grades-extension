// Playwright config — e2e tests live in test/e2e/ and run serially (one
// browser + extension instance at a time). The mock Schoology server is
// started inside the spec file itself (test/e2e/extension.spec.js).
// Run: npm run test:e2e   (from the repo root; builds both first)
//
// Two projects: Chromium (dist/, `npm run build:dev`) and Firefox
// (dist-firefox/, `npm run build:firefox`). Run one with
// `npx playwright test --project=firefox`. Safari can't be automated here;
// see test/README.md.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { headless: true },
  projects: [
    {
      name: 'chromium',
      // Full Chromium (new headless). The headless shell cannot load extensions.
      use: { browserName: 'chromium', channel: 'chromium' },
    },
    {
      name: 'firefox',
      // Playwright's own Firefox build (`npx playwright install firefox`).
      use: { browserName: 'firefox' },
    },
  ],
});
