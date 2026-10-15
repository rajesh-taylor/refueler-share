import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { fileURLToPath } from 'node:url';

// Route bare @noble/hashes/* to the package's root (CJS) entry points. The workerd
// pool cannot serve the ESM copies under esm/ (Error: No such module ".../esm/x.js").
const hashes = (m) => fileURLToPath(new URL(`./node_modules/@noble/hashes/${m}.js`, import.meta.url));

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
    }),
  ],
  resolve: {
    alias: [
      // Tests import 'src/…' as a bare name (the old pool resolved it from the project root).
      { find: /^src\//, replacement: fileURLToPath(new URL('./src/', import.meta.url)) },
      { find: /^@noble\/hashes\/(\w+)$/, replacement: '$1', customResolver: (id) => hashes(id) },
      // frontend/crypto.js (imported by part-crypto.test.js) names '@noble/curves/secp256k1'
      // in its B8 stub; the Worker's @noble/curves v2 exports it as './secp256k1.js'.
      { find: /^@noble\/curves\/secp256k1$/, replacement: '@noble/curves/secp256k1.js' },
    ],
  },
  test: {
    include: ['test/**/*.test.js'],
    reporters: process.env.CI ? ['verbose'] : ['default'],
  },
});
