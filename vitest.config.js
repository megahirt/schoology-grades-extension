// Vitest config — unit tests only (test/unit/*.test.js, node environment).
// Scoped explicitly so `npm test` does NOT pick up the Playwright e2e spec
// (test/e2e/extension.spec.js), which needs a real Chromium + extension build.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.js'],
    environment: 'node',
  },
});
