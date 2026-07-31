/**
 * start-mock.mjs — standalone Supabase mock for load testing.
 *
 * Starts the Supabase mock server, patches SUPABASE_URL in .dev.vars,
 * and keeps running until Ctrl+C. Restores .dev.vars on exit.
 *
 * Usage (three terminals):
 *   Terminal 1: node worker/tests/load/start-mock.mjs
 *               (wait for "Mock ready" message)
 *   Terminal 2: npx wrangler dev --local --port 8787
 *               (starts AFTER mock is ready — picks up patched .dev.vars)
 *   Terminal 3: node worker/tests/load/preissue-credentials.mjs
 *               k6 run worker/tests/load/concurrent-transfers.js
 *
 * Ctrl+C in Terminal 1 stops the mock and restores .dev.vars.
 * You must also Ctrl+C wrangler in Terminal 2.
 */

import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT      = join(dirname(fileURLToPath(import.meta.url)), '..', '..'); // worker/
const VARS_PATH = join(ROOT, '.dev.vars');

// ── In-memory state (reset between runs if needed) ────────────────────────────

const spentSerials = new Set();
const subscribers  = new Map();

// ── Mock server (mirrors supabase-mock.js exactly) ────────────────────────────

function startMock() {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url  = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      let body   = '';
      req.on('data', d => { body += d; });
      req.on('end', () => {

        // GET /rest/v1/spent_tokens
        if (req.method === 'GET' && path === '/rest/v1/spent_tokens') {
          const serial = (url.searchParams.get('serial') ?? '').replace(/^eq\./, '');
          const rows   = spentSerials.has(serial) ? [{ serial }] : [];
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(rows));
          return;
        }

        // POST /rest/v1/spent_tokens (melt)
        if (req.method === 'POST' && path === '/rest/v1/spent_tokens') {
          try {
            const { serial } = JSON.parse(body);
            if (spentSerials.has(serial)) {
              res.writeHead(409, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'duplicate' }));
              return;
            }
            spentSerials.add(serial);
            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end('[]');
          } catch { res.writeHead(400); res.end('{}'); }
          return;
        }

        // POST /rest/v1/double_spend_attempts
        if (req.method === 'POST' && path === '/rest/v1/double_spend_attempts') {
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end('[]');
          return;
        }

        // GET /rest/v1/double_spend_attempts
        if (req.method === 'GET' && path === '/rest/v1/double_spend_attempts') {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Range': '0-0/0' });
          res.end('[]');
          return;
        }

        // POST /rest/v1/subscribers
        if (req.method === 'POST' && path === '/rest/v1/subscribers') {
          try {
            const row = JSON.parse(body);
            subscribers.set(row.stripe_customer_id ?? row.email, row);
            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end('[]');
          } catch { res.writeHead(400); res.end('{}'); }
          return;
        }

        // GET /rest/v1/subscribers
        if (req.method === 'GET' && path === '/rest/v1/subscribers') {
          const email = (url.searchParams.get('email') ?? '').replace(/^eq\./, '');
          const match = [...subscribers.values()].find(s => s.email === email);
          const rows  = match ? [match] : [];
          res.writeHead(200, {
            'Content-Type':  'application/json',
            'Content-Range': `0-${Math.max(0, rows.length - 1)}/${rows.length}`,
          });
          res.end(JSON.stringify(rows));
          return;
        }

        console.error(`[mock] No handler: ${req.method} ${path}`);
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `no handler for ${req.method} ${path}` }));
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}`, server });
    });

    server.on('error', reject);
  });
}

// ── .dev.vars patching ────────────────────────────────────────────────────────

function patchDevVars(mockUrl) {
  const original = readFileSync(VARS_PATH, 'utf8');
  const patched  = original.replace(
    /^SUPABASE_URL=.*/m,
    `SUPABASE_URL=${mockUrl}`
  );
  writeFileSync(VARS_PATH, patched);
  return original;
}

function restoreDevVars(original) {
  writeFileSync(VARS_PATH, original);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const { url, server } = await startMock();
const originalVars    = patchDevVars(url);

console.log(`\n✓ Supabase mock running at ${url}`);
console.log(`✓ SUPABASE_URL patched in .dev.vars`);
console.log(`\nNow start wrangler in Terminal 2:`);
console.log(`  cd /Users/rajeshtaylor/Documents/refueler-share/worker && npx wrangler dev --local --port 8787`);
console.log(`\nPress Ctrl+C here to stop the mock and restore .dev.vars.\n`);

// ── Graceful shutdown ─────────────────────────────────────────────────────────

function shutdown() {
  console.log('\nShutting down mock...');
  server.close(() => {
    restoreDevVars(originalVars);
    console.log('✓ .dev.vars restored.');
    process.exit(0);
  });
}

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
