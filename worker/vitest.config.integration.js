import { defineConfig } from 'vitest/config';

// Integration tests only — the main suite (test/) runs under vitest.config.js.
// `include` is the Vitest option; the old `testMatch` was ignored, so every
// test file ran here.
export default defineConfig({
  test: {
    name: 'integration',
    include: ['tests/integration/**/*.test.js'],
    globalSetup: './tests/integration/helpers/wrangler-lifecycle.js',
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false,
    sequence: { concurrent: false },
    reporters: ['verbose'],
  },
});
