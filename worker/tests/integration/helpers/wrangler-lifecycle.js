/**
 * worker/tests/integration/helpers/wrangler-lifecycle.js
 * Vitest globalSetup — starts the Supabase mock, boots wrangler dev --local.
 * Pure Node — no Vitest imports.
 *
 * worker/.dev.vars is never read or written (Integration-Repair-1, 28 Oct 2026).
 * The run gets its own vars file, .wrangler-test-state/integration.env, made of
 * fresh random keys, and wrangler is started with --env-file pointing at it —
 * with --env-file, wrangler does not load .dev.vars at all. A crash leaves only
 * that throwaway file behind (git-ignored, wiped at the next run).
 *
 * Order of operations:
 *   1. Start Supabase mock HTTP server (binds to random port)
 *   2. Write the run's vars file (mock SUPABASE_URL, random keys)
 *   3. Spawn wrangler dev --local --env-file
 *   4. Poll /status until ready
 *   5. provide() what the tests need: workerUrl, persistDir, envFile, adminKey,
 *      stripeWebhookSecret (process.env does not cross into the test workers)
 *
 * Teardown: kill wrangler → close mock. wrangler runs in its own process group
 * and the whole group is killed — on teardown, on Ctrl-C, and (via the pid
 * file) at the start of the next run if a crash left one behind on port 8788.
 */

import { spawn }                         from 'node:child_process';
import { randomBytes }                   from 'node:crypto';
import { rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join }                          from 'node:path';
import { startSupabaseMock }             from '../fixtures/supabase-mock.js';

const PORT        = 8788;
const PERSIST_DIR = join(process.cwd(), '.wrangler-test-state');
const ENV_FILE    = join(PERSIST_DIR, 'integration.env');
const PID_FILE    = join(PERSIST_DIR, 'wrangler.pid');
const WORKER_URL  = `http://localhost:${PORT}`;

// Cloudflare's published Turnstile test secret: siteverify answers success for
// any token, so the Worker's real verify + nonce-replay code runs unchanged.
const TURNSTILE_TEST_SECRET = '1x0000000000000000000000000000000AA';

const POLL_INTERVAL_MS = 500;
const MAX_POLLS        = 60; // 30 seconds

let wranglerProcess = null;
let supabaseMock    = null;

async function pollReady() {
  for (let i = 0; i < MAX_POLLS; i++) {
    if (wranglerProcess?.exitCode !== null) throw new Error('wrangler dev exited during start-up');
    try {
      const res = await fetch(`${WORKER_URL}/status`);
      if (res.ok) return;
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Worker did not become ready within ${MAX_POLLS * POLL_INTERVAL_MS / 1000}s`);
}

/** Kill wrangler's whole process group (npx → wrangler → workerd). */
function killGroup(pid, signal = 'SIGTERM') {
  try { process.kill(-pid, signal); return true; } catch { return false; }
}

/** A run that crashed or was interrupted may have left its wrangler behind. */
async function killStaleWrangler() {
  let pid;
  try { pid = parseInt(await readFile(PID_FILE, 'utf8'), 10); } catch { return; }
  // Only when something still answers on our port: never signal a reused pid.
  try { await fetch(`${WORKER_URL}/status`); } catch { return; }
  if (Number.isInteger(pid) && killGroup(pid)) {
    console.log(`[wrangler-lifecycle] Stopped a wrangler left by an earlier run (pid ${pid}).`);
    await new Promise(r => setTimeout(r, 1000));
  }
}

function onSignal(signal) {
  if (wranglerProcess) killGroup(wranglerProcess.pid);
  process.exit(signal === 'SIGINT' ? 130 : 143);
}

const hex = (n = 32) => randomBytes(n).toString('hex');
const b64 = (n = 32) => randomBytes(n).toString('base64');

export async function setup({ provide }) {
  // ── 1. Start Supabase mock ──────────────────────────────────────────────
  supabaseMock = await startSupabaseMock();
  console.log(`[wrangler-lifecycle] Supabase mock at ${supabaseMock.url}`);

  // ── 2. Fresh state + the run's own vars file ───────────────────────────
  await killStaleWrangler();
  await rm(PERSIST_DIR, { recursive: true, force: true });
  await mkdir(PERSIST_DIR, { recursive: true });

  const adminKey            = hex();
  const stripeWebhookSecret = `whsec_${hex(24)}`;
  const vars = {
    SUPABASE_URL:               supabaseMock.url,
    SUPABASE_SERVICE_KEY:       hex(),                 // the mock ignores auth headers
    ADMIN_KEY:                  adminKey,
    TURNSTILE_SECRET_KEY:       TURNSTILE_TEST_SECRET,
    STRIPE_WEBHOOK_SECRET:      stripeWebhookSecret,
    MINT_PRIVATE_KEY:           hex(),
    COMMITMENT_KEY:             b64(),
    UPLOAD_SESSION_KEY:         b64(),
    KV_MAC_KEY:                 b64(),
    QUOTA_REF_KEY:              b64(),
    TEST_CRED_KEY:              b64(),
    AUTH_PEPPER:                b64(),
    WEBHOOK_SIGNING_MASTER_KEY: b64(),
    SHARE_SEAL_KEY_1:           b64(),
    // The presigner needs these to sign URLs; nothing is ever sent to them.
    // Tests write chunk bytes straight into the local bucket (client.js).
    CF_ACCOUNT_ID:              hex(16),
    R2_S3_ACCESS_KEY_ID:        hex(16),
    R2_S3_SECRET_ACCESS_KEY:    hex(),
  };
  const text = Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  await writeFile(ENV_FILE, text, { encoding: 'utf8', mode: 0o600 });

  // ── 3. Spawn wrangler ──────────────────────────────────────────────────
  const env = { ...process.env };
  delete env.CLOUDFLARE_INCLUDE_PROCESS_ENV;   // only the vars file, never the shell's env
  wranglerProcess = spawn(
    'npx',
    ['wrangler', 'dev', '--local', `--port=${PORT}`, `--persist-to=${PERSIST_DIR}`, `--env-file=${ENV_FILE}`],
    { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], env, detached: true }
  );
  await writeFile(PID_FILE, String(wranglerProcess.pid), 'utf8');
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  process.once('exit', () => { if (wranglerProcess?.exitCode === null) killGroup(wranglerProcess.pid); });

  wranglerProcess.stdout.on('data', d => process.stdout.write(`[wrangler] ${d}`));
  wranglerProcess.stderr.on('data', d => process.stderr.write(`[wrangler] ${d}`));
  wranglerProcess.on('error', err => { throw new Error(`Failed to spawn wrangler: ${err.message}`); });

  // ── 4. Wait for ready ──────────────────────────────────────────────────
  await pollReady();
  console.log(`[wrangler-lifecycle] Worker ready at ${WORKER_URL}`);

  // ── 5. Provide to test processes ───────────────────────────────────────
  provide('workerUrl', WORKER_URL);
  provide('persistDir', PERSIST_DIR);
  provide('envFile', ENV_FILE);
  provide('adminKey', adminKey);
  provide('stripeWebhookSecret', stripeWebhookSecret);
}

export async function teardown() {
  if (wranglerProcess && wranglerProcess.exitCode === null) {
    const closed = new Promise(r => wranglerProcess.on('close', r));
    killGroup(wranglerProcess.pid);
    await closed;
    await rm(PID_FILE, { force: true });
    console.log('[wrangler-lifecycle] Worker stopped.');
  }
  if (supabaseMock?.server) {
    supabaseMock.server.close();
    console.log('[wrangler-lifecycle] Supabase mock stopped.');
  }
}
