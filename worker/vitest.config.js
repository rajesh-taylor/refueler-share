import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';
import { fileURLToPath } from 'node:url';

// Route bare @noble/hashes/* to the package's root (CJS) entry points. The workerd
// pool cannot serve the ESM copies under esm/ (Error: No such module ".../esm/x.js").
const hashes = (m) => fileURLToPath(new URL(`./node_modules/@noble/hashes/${m}.js`, import.meta.url));

export default defineWorkersConfig({
  resolve: {
    alias: [{ find: /^@noble\/hashes\/(\w+)$/, replacement: '$1', customResolver: (id) => hashes(id) }],
  },
  test: {
    include: ['test/**/*.test.js'],
    reporter: process.env.CI ? 'verbose' : 'default',
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
      },
    },
  },
});
