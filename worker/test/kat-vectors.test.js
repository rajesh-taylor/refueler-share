/**
 * kat-vectors.test.js — test-vectors/v1.json in workerd (H2 Browser-KAT-1, 4 Nov 2026).
 *
 * The same file and the same checks (test-vectors/run.mjs) run in Chromium, Firefox and WebKit
 * through the harness's /kat/ page, so the browser and the Worker agree on one set of answers.
 * Every value in v1.json was computed by test-vectors/gen.py, which imports nothing of Share's.
 * The second block is the Worker's own side of the same values.
 */
import { describe, it, expect } from 'vitest';
import vectors from '../../test-vectors/v1.json';
import { runVectors } from '../../test-vectors/run.mjs';
import * as frontendCrypto from '../../frontend/crypto.js';
import * as fragment from '../../frontend/fragment.js';
import * as cashu from '../../frontend/cashu-crypto.js';
import * as noble from '../../frontend/noble-blake3.js';
import { issueBlindSig, keysetIdFor, verifyProofV2 } from '../src/nut00.js';
import { blake3Hash as workerBlake3 } from '../src/blake3_worker.js';

const hex = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');

describe('test-vectors/v1.json, frontend modules in workerd', () => {
  it('every check passes', async () => {
    const results = await runVectors(vectors, { crypto: frontendCrypto, fragment, cashu, noble, skipLoadedBlake3: true });
    expect(results.filter((r) => !r.ok)).toEqual([]);
    expect(results.length).toBeGreaterThan(60);
  }, 60_000);
});

describe('test-vectors/v1.json, the Worker side of BLAKE3', () => {
  it('the Worker hashes the published inputs to the published digests', async () => {
    for (const t of vectors.blake3.cases) {
      const input = Uint8Array.from({ length: t.input_len }, (_, i) => i % 251);
      const got = await workerBlake3(input);
      expect(typeof got === 'string' ? got : hex(got)).toBe(t.hash);
    }
  });
});

describe('test-vectors/v1.json, the Worker side of the credential', () => {
  const fl = vectors.nut00.flow;

  it('signs the blinded message to the independent C_', () => {
    expect(issueBlindSig(fl.B_, fl.mint_k).signed_point).toBe(fl.C_);
    expect(issueBlindSig(fl.B_, fl.mint_k).mint_pubkey).toBe(fl.mint_pub);
  });

  it('published NUT-00 signatures', () => {
    for (const t of vectors.nut00.signed) expect(issueBlindSig(t.B_, t.k).signed_point).toBe(t.C_);
  });

  it('accepts the independent proof; serial = Y', () => {
    const proof = { id: keysetIdFor(fl.mint_k), amount: 1, secret: fl.secret, C: fl.C };
    expect(verifyProofV2(proof, fl.mint_k).serial).toBe(fl.Y);
  });

  it('refuses a well-formed proof signed by another key', () => {
    const other = vectors.nut00.signed[1].k;
    const proof = { id: keysetIdFor(other), amount: 1, secret: fl.secret, C: fl.C };
    expect(() => verifyProofV2(proof, other)).toThrow('Proof signature invalid');
  });
});
