import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: __dirname,
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    reporter: process.env.CI ? 'verbose' : 'default',
  },
  resolve: {
    alias: {
      src: resolve(__dirname, 'src'),
    },
  },
});
