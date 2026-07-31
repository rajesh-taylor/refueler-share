/**
 * worker/tests/integration/helpers/wrangler-lifecycle.js
 * Vitest globalSetup — starts Supabase mock, writes .dev.vars, boots wrangler dev --local.
 * Pure Node — no Vitest imports.
 *
 * Order of operations:
 *   1. Start Supabase mock HTTP server (binds to random port)
 *   2. Write mock URL into worker/.dev.vars so wrangler picks it up as SUPABASE_URL
 *   3. Spawn wrangler dev --local
 *   4. Poll /status until ready
 *   5. Expose WORKER_BASE_URL + SUPABASE_MOCK_URL via process.env for tests
 *   6. provide('stripeWebhookSecret') so test processes can inject it via Vitest API
 *
 * Teardown reverses the order: kill wrangler → close mock → restore .dev.vars
 */

import { spawn }                  from 'node:child_process';
import { rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync }              from 'node:fs';
import { join }                    from 'node:path';
import { startSupabaseMock }       from '../fixtures/supabase-mock.js';

const PORT        = 8788;
const PERSIST_DIR = join(process.cwd(), '.wrangler-test-state');
const DEV_VARS    = join(process.cwd(), '.dev.vars');
const WORKER_URL  = `http://localhost:${PORT}`;

const POLL_INTERVAL_MS = 500;
const MAX_POLLS        = 40; // 20 seconds

let wranglerProcess = null;
let supabaseMock    = null;
let originalDevVars = null; // content of .dev.vars before we touched it

// Exported so tests can call supabaseMock.reset() in beforeEach
export let mockHandle = null;

async function pollReady() {
  for (let i = 0; i < MAX_POLLS; i++) {
    try {
      const res = await fetch(`${WORKER_URL}/status`);
      if (res.ok) return;
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Worker did not become ready within ${MAX_POLLS * POLL_INTERVAL_MS / 1000}s`);
}

/**
 * Parse .dev.vars (KEY=value lines) into an object.
 * Ignores blank lines and # comments.
 */
function parseDevVars(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    out[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return out;
}

/**
 * Serialise an object back to KEY=value lines.
 */
function serialiseDevVars(obj) {
  return Object.entries(obj).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
}

export async function setup({ provide }) {
  // ── 1. Start Supabase mock ──────────────────────────────────────────────
  supabaseMock = await startSupabaseMock();
  mockHandle   = supabaseMock;
  console.log(`[wrangler-lifecycle] Supabase mock at ${supabaseMock.url}`);

  // ── 2. Patch .dev.vars ─────────────────────────────────────────────────
  if (existsSync(DEV_VARS)) {
    originalDevVars = await readFile(DEV_VARS, 'utf8');
  } else {
    originalDevVars = null;
  }

  const vars = originalDevVars ? parseDevVars(originalDevVars) : {};
  vars['SUPABASE_URL'] = supabaseMock.url;
  // SUPABASE_SERVICE_KEY can be anything — mock ignores auth headers
  vars['SUPABASE_SERVICE_KEY'] = vars['SUPABASE_SERVICE_KEY'] ?? 'test-service-key';

  await writeFile(DEV_VARS, serialiseDevVars(vars), 'utf8');
  console.log(`[wrangler-lifecycle] Wrote SUPABASE_URL=${supabaseMock.url} to .dev.vars`);

  // ── 3. Clean previous persist state ────────────────────────────────────
  try {
    await rm(PERSIST_DIR, { recursive: true, force: true });
  } catch { /* ignore */ }

  // ── 4. Spawn wrangler ──────────────────────────────────────────────────
  wranglerProcess = spawn(
    'npx',
    ['wrangler', 'dev', '--local', `--port=${PORT}`, `--persist-to=${PERSIST_DIR}`],
    {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    }
  );

  wranglerProcess.stdout.on('data', d => process.stdout.write(`[wrangler] ${d}`));
  wranglerProcess.stderr.on('data', d => process.stderr.write(`[wrangler] ${d}`));
  wranglerProcess.on('error', err => { throw new Error(`Failed to spawn wrangler: ${err.message}`); });

  // ── 5. Wait for ready ──────────────────────────────────────────────────
  await pollReady();
  console.log(`[wrangler-lifecycle] Worker ready at ${WORKER_URL}`);

  process.env.WORKER_BASE_URL    = WORKER_URL;
  process.env.SUPABASE_MOCK_URL  = supabaseMock.url;

  // ── 6. Provide stripeWebhookSecret to test processes ───────────────────
  // process.env set here does not cross the globalSetup → Vitest worker boundary.
  // provide/inject is the only mechanism that does.
  const stripeWebhookSecret = vars['STRIPE_WEBHOOK_SECRET'] ?? '';
  provide('stripeWebhookSecret', stripeWebhookSecret);
  console.log(`[wrangler-lifecycle] stripeWebhookSecret provided (${stripeWebhookSecret ? 'present' : 'MISSING — check .dev.vars'})`);
}

export async function teardown() {
  // Kill wrangler
  if (wranglerProcess) {
    wranglerProcess.kill('SIGTERM');
    await new Promise(r => wranglerProcess.on('close', r));
    console.log('[wrangler-lifecycle] Worker stopped.');
  }

  // Close Supabase mock
  if (supabaseMock?.server) {
    supabaseMock.server.close();
    console.log('[wrangler-lifecycle] Supabase mock stopped.');
  }

  // Restore .dev.vars
  try {
    if (originalDevVars === null) {
      await rm(DEV_VARS, { force: true });
    } else {
      await writeFile(DEV_VARS, originalDevVars, 'utf8');
    }
    console.log('[wrangler-lifecycle] .dev.vars restored.');
  } catch (e) {
    console.error('[wrangler-lifecycle] Failed to restore .dev.vars:', e.message);
  }
}
