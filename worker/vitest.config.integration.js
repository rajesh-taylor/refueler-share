import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'integration',
    testMatch: ['**/tests/integration/**/*.test.js'],
    globalSetup: './tests/integration/helpers/wrangler-lifecycle.js',
    testTimeout: 30000,
    hookTimeout: 60000,
    sequence: { concurrent: false },
    reporters: ['verbose'],
  },
});
