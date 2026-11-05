// Worker-Keys-1 (4 Nov 2026) — download tokens stop using the mint key (F3), and the signature
// check compares bytes, not base64url text read as hex.
//
//   K     = HKDF-SHA256(DL_TOKEN_KEY, salt = empty, info = "refueler.share.dltoken.v1" ‖ 0x00, 32 B)
//   token = "dl1." + payload + "." + b64url(HMAC-SHA256(K, tag ‖ 0x00 ‖ payload))
//
// The known-answer vector below was worked out separately with node:crypto (hkdfSync, createHmac).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import worker from '../src/index.js';
import {
  issueDownloadToken, verifyDownloadToken, timingSafeEqual, hashSecret,
} from '../src/download_gate.js';
import indexSrc from '../src/index.js?raw';
import downloadSrc from '../src/handlers/download.js?raw';
import deleteSrc from '../src/handlers/delete_transfer.js?raw';
import confirmSrc from '../src/handlers/confirm_transfer.js?raw';
import { makeBucket, makeKV } from './_r2_mock.js';
import { transferRequest } from './helpers/transfer-request.js';

const ORIGIN = 'https://api.share.refueler.io';
const ctx = { waitUntil() {}, passThroughOnException() {} };

const KEY_B64 = 'QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI='; // 32 × 0x42
const OTHER_KEY_B64 = 'Q0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0M='; // 32 × 0x43
const MINT = 'ab'.repeat(32);
const NOW = Math.floor(Date.now() / 1000);
const FAR = 4102444800; // 1 Jan 2100
const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e';

const b64url = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
const payloadFor = (uuid, exp) => b64url(JSON.stringify({ uuid, exp }));

/** The old form, HMAC-SHA256(mint key, payload): gone at Worker-Keys-2. Tests sign one, with a test key, to prove it stays refused. */
async function mintSigned(uuid, exp, mintHex = MINT) {
  const payload = payloadFor(uuid, exp);
  const bytes = Uint8Array.from(mintHex.match(/../g), (h) => parseInt(h, 16));
  const key = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
  return `${payload}.${b64url(String.fromCharCode(...sig))}`;
}

describe('new tokens', () => {
  const env = { DL_TOKEN_KEY: KEY_B64 };

  it('known-answer vector', async () => {
    const token = await issueDownloadToken('11111111-1111-4111-8111-111111111111', env, FAR);
    expect(token).toBe(
      'dl1.eyJ1dWlkIjoiMTExMTExMTEtMTExMS00MTExLTgxMTEtMTExMTExMTExMTExIiwiZXhwIjo0MTAyNDQ0ODAwfQ'
      + '.ksZ4nqEMs8GZ78rubPUgJ3voJc8m5edQXQH6xKZq2XY',
    );
  });

  it('verifies, and names its transfer', async () => {
    const token = await issueDownloadToken(UUID, env, FAR);
    expect(await verifyDownloadToken(token, env)).toEqual({ valid: true, uuid: UUID });
  });

  it('every changed character of the signature is refused', async () => {
    const token = await issueDownloadToken(UUID, env, FAR);
    const at = token.lastIndexOf('.') + 1;
    for (let i = at; i < token.length; i++) {
      const swapped = token[i] === 'A' ? 'B' : 'A';
      const tampered = token.slice(0, i) + swapped + token.slice(i + 1);
      expect((await verifyDownloadToken(tampered, env)).valid, `position ${i}`).toBe(false);
    }
  });

  it('the spare bits of the last signature character cannot spell the same token twice', async () => {
    const token = await issueDownloadToken(UUID, env, FAR);
    const last = token.at(-1);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const others = [...alphabet].filter((c) => c !== last);
    for (const c of others) {
      expect((await verifyDownloadToken(token.slice(0, -1) + c, env)).valid, c).toBe(false);
    }
  });

  it('a changed payload is refused: another transfer, a later expiry', async () => {
    const token = await issueDownloadToken(UUID, env, NOW + 60);
    const sig = token.split('.')[2];
    expect((await verifyDownloadToken(`dl1.${payloadFor('other', NOW + 60)}.${sig}`, env)).valid).toBe(false);
    expect((await verifyDownloadToken(`dl1.${payloadFor(UUID, FAR)}.${sig}`, env)).valid).toBe(false);
  });

  it('an expired token is refused', async () => {
    const token = await issueDownloadToken(UUID, env, NOW - 1);
    expect((await verifyDownloadToken(token, env)).valid).toBe(false);
  });

  it('a signed token with no usable expiry or transfer is refused', async () => {
    for (const exp of [undefined, null, 'never', 1.5]) {
      expect((await verifyDownloadToken(await issueDownloadToken(UUID, env, exp), env)).valid, String(exp)).toBe(false);
    }
    expect((await verifyDownloadToken(await issueDownloadToken(undefined, env, FAR), env)).valid).toBe(false);
  });

  it('a token from another DL_TOKEN_KEY is refused (replacing the key ends every token)', async () => {
    const token = await issueDownloadToken(UUID, { DL_TOKEN_KEY: OTHER_KEY_B64 }, FAR);
    expect((await verifyDownloadToken(token, env)).valid).toBe(false);
  });

  it('junk is refused', async () => {
    for (const t of [undefined, null, 42, '', '.', '..', 'dl1', 'dl1.', 'dl1..', 'dl1.a.b', 'a.b.c.d', 'dl2.a.b']) {
      expect((await verifyDownloadToken(t, env)).valid, String(t)).toBe(false);
    }
  });
});

describe('fails closed without DL_TOKEN_KEY', () => {
  const unusable = [undefined, '', 'not base64 !!', btoa('short'), btoa('x'.repeat(33))];

  it('issues nothing, and never signs with the mint key', async () => {
    for (const k of unusable) {
      const env = { DL_TOKEN_KEY: k, MINT_PRIVATE_KEY: MINT };
      expect(await issueDownloadToken(UUID, env, FAR), String(k)).toBeNull();
    }
  });

  it('a new-form token does not verify, and the mint key does not stand in', async () => {
    const token = await issueDownloadToken(UUID, { DL_TOKEN_KEY: KEY_B64 }, FAR);
    for (const k of unusable) {
      const env = { DL_TOKEN_KEY: k, MINT_PRIVATE_KEY: MINT };
      expect((await verifyDownloadToken(token, env)).valid, String(k)).toBe(false);
    }
  });
});

describe('the old mint-keyed form is gone', () => {
  const env = { DL_TOKEN_KEY: KEY_B64, MINT_PRIVATE_KEY: MINT };

  it('DONE-PROOF: a genuine mint-signed token is refused, with the mint key set', async () => {
    expect((await verifyDownloadToken(await mintSigned(UUID, FAR), env)).valid).toBe(false);
  });

  it('DONE-PROOF: the old setting reopens nothing, if it were ever set again', async () => {
    const token = await mintSigned(UUID, FAR);
    const stale = { ...env, DL_TOKEN_LEGACY_UNTIL: String(NOW + 3600) };
    expect((await verifyDownloadToken(token, stale)).valid).toBe(false);
  });

  it('a mint-keyed signature inside the new form is refused', async () => {
    const [payload, sig] = (await mintSigned(UUID, FAR)).split('.');
    expect((await verifyDownloadToken(`dl1.${payload}.${sig}`, env)).valid).toBe(false);
  });

  it('a new-key signature in the old form is refused', async () => {
    const [, payload, sig] = (await issueDownloadToken(UUID, env, FAR)).split('.');
    expect((await verifyDownloadToken(`${payload}.${sig}`, env)).valid).toBe(false);
  });
});

// The comparison treated base64url as hex: most characters read as zero, so a fixed junk signature
// passed about 1 time in 10,000 with no key at all. This exact token passed the old check under
// MINT = 'ab' × 32 (found by trying expiries; exp 4102448735). Its genuine signature is unrelated.
describe('regression: a junk signature never passes', () => {
  const FORGED = 'eyJ1dWlkIjoiMGY4ZmFkNWItZDljYi00NjlmLWExNjUtNzA4Njc3Mjg5NTBlIiwiZXhwIjo0MTAyNDQ4NzM1fQ'
    + '.zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz';
  const env = { DL_TOKEN_KEY: KEY_B64, MINT_PRIVATE_KEY: MINT };

  it('the token the old check accepted is refused', async () => {
    expect((await verifyDownloadToken(FORGED, env)).valid).toBe(false);
  });

  it('the same junk signature in the new form is refused; a genuine one for those claims verifies', async () => {
    expect((await verifyDownloadToken(`dl1.${FORGED}`, env)).valid).toBe(false);
    expect((await verifyDownloadToken(await issueDownloadToken(UUID, env, 4102448735), env)).valid).toBe(true);
  });

  it('20,000 tries at one junk signature, both forms: none pass', async () => {
    let passed = 0;
    for (let i = 0; i < 20000; i++) {
      const p = payloadFor(UUID, FAR + i);
      if ((await verifyDownloadToken(`${p}.${'z'.repeat(43)}`, env)).valid) passed++;
      if ((await verifyDownloadToken(`dl1.${p}.${'z'.repeat(43)}`, env)).valid) passed++;
    }
    expect(passed).toBe(0);
  }, 120000);

  it('timingSafeEqual is hex only: different non-hex strings no longer compare equal', () => {
    expect(timingSafeEqual('zz', 'yy')).toBe(false);
    expect(timingSafeEqual('zz', 'zz')).toBe(false);
    expect(timingSafeEqual('zz', '00')).toBe(false);
    expect(timingSafeEqual('abc', 'abc')).toBe(false);
    expect(timingSafeEqual('ab'.repeat(32), 'ab'.repeat(32))).toBe(true);
    expect(timingSafeEqual('AB', 'ab')).toBe(true);
    expect(timingSafeEqual('ab'.repeat(32), 'ac'.repeat(32))).toBe(false);
  });

  it('timingSafeEqual: one changed hex digit anywhere in a digest is unequal', () => {
    const digest = '0123456789abcdef'.repeat(4);
    for (let i = 0; i < digest.length; i++) {
      const other = digest.slice(0, i) + (digest[i] === 'a' ? 'b' : 'a') + digest.slice(i + 1);
      expect(timingSafeEqual(digest, other), `digit ${i}`).toBe(false);
    }
  });

  it('timingSafeEqual: every pair of byte values stays distinct', () => {
    const hex = (n) => n.toString(16).padStart(2, '0');
    for (let a = 0; a < 256; a++) {
      for (let b = 0; b < 256; b++) expect(timingSafeEqual(hex(a), hex(b))).toBe(a === b);
    }
  });
});

describe('the mint key leaves every token path', () => {
  it('no caller hands the mint key to a token function', () => {
    for (const src of [indexSrc, downloadSrc, deleteSrc, confirmSrc]) {
      expect(src).not.toMatch(/(issue|verify)DownloadToken\([^)]*MINT_PRIVATE_KEY/);
    }
  });
});

describe('every route, with real tokens', () => {
  const PASSWORD = 'correct horse';
  let bucket, env, manifest;

  const call = (path, method, headers = {}, body) => worker.fetch(transferRequest(`${ORIGIN}${path}`, UUID, {
    method, headers: { 'CF-Connecting-IP': '198.51.100.7', ...headers }, ...(body ? { body } : {}),
  }, path === '/download' ? 0 : undefined), env, ctx);
  const bearer = (t) => ({ Authorization: `Bearer ${t}` });
  const unlock = () => call('/unlock', 'POST', { 'Content-Type': 'application/json' }, JSON.stringify({ passphrase: PASSWORD }));
  const forged = () => `${payloadFor(UUID, FAR)}.${'z'.repeat(43)}`;

  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    manifest = {
      uuid: UUID, total_chunks: 1, expiry_timestamp: NOW + 86400,
      file_name: 'encrypted-payload', p2sh_secret_hash: await hashSecret(PASSWORD),
    };
    bucket = makeBucket({
      [`${UUID}/manifest.json`]: { uploaded: NOW, body: JSON.stringify(manifest) },
      [`${UUID}/0000`]: { uploaded: NOW, body: 'ciphertext' },
    });
    env = {
      BUCKET: bucket, STATUS_KV: makeKV(), ENVIRONMENT: 'test',
      DL_TOKEN_KEY: KEY_B64, MINT_PRIVATE_KEY: MINT,
    };
  });
  afterEach(() => vi.restoreAllMocks());

  it('POST /unlock issues a new-form token that opens GET /download', async () => {
    const res = await unlock();
    expect(res.status).toBe(200);
    const { token } = await res.json();
    expect(token.startsWith('dl1.')).toBe(true);
    expect((await call('/download', 'GET', bearer(token))).status).not.toBe(401);
  });

  it('POST /unlock with no DL_TOKEN_KEY answers 503 and hands out nothing', async () => {
    delete env.DL_TOKEN_KEY;
    const res = await unlock();
    expect(res.status).toBe(503);
    expect((await res.json()).token).toBeUndefined();
  });

  it('a wrong password still answers 401, with or without the key', async () => {
    const wrong = () => call('/unlock', 'POST', { 'Content-Type': 'application/json' }, JSON.stringify({ passphrase: 'nope' }));
    expect((await wrong()).status).toBe(401);
    delete env.DL_TOKEN_KEY;
    expect((await wrong()).status).toBe(401);
  }, 20000);

  it('GET /download: a genuine old-form token and a forged one: both 401', async () => {
    expect((await call('/download', 'GET', bearer(await mintSigned(UUID, FAR)))).status).toBe(401);
    expect((await call('/download', 'GET', bearer(forged()))).status).toBe(401);
  });

  it('GET /download with no token on a password transfer: 401', async () => {
    expect((await call('/download', 'GET')).status).toBe(401);
  });

  it('a token for another transfer opens nothing', async () => {
    const token = await issueDownloadToken('6a1b0c3e-1f2d-4e5f-8a9b-0c1d2e3f4a5b', env, FAR);
    expect((await call('/download', 'GET', bearer(token))).status).toBe(401);
    expect((await call('/confirm', 'POST', bearer(token))).status).toBe(403);
    expect((await call('/transfer', 'DELETE', bearer(token))).status).toBe(403);
  });

  it('POST /confirm: forged and old-form tokens refused, a real one accepted', async () => {
    expect((await call('/confirm', 'POST', bearer(await mintSigned(UUID, FAR)))).status).toBe(403);
    expect((await call('/confirm', 'POST', bearer(forged()))).status).toBe(403);
    const real = await issueDownloadToken(UUID, env, FAR);
    expect((await call('/confirm', 'POST', bearer(real))).status).toBe(200);
  });

  it('DELETE /transfer: a forged token destroys nothing; a real one does', async () => {
    expect((await call('/transfer', 'DELETE', bearer(forged()))).status).toBe(403);
    expect((await call('/transfer', 'DELETE', bearer(await mintSigned(UUID, FAR)))).status).toBe(403);
    const before = JSON.parse(await (await bucket.get(`${UUID}/manifest.json`)).text());
    expect(before.consumed).toBeUndefined();
    const real = await issueDownloadToken(UUID, env, FAR);
    expect((await call('/transfer', 'DELETE', bearer(real))).status).toBe(200);
    const after = JSON.parse(await (await bucket.get(`${UUID}/manifest.json`)).text());
    expect(after.consumed).toBe(true);
  });

  it('DELETE /transfer: forged tokens cannot destroy a transfer with no password either', async () => {
    delete manifest.p2sh_secret_hash;
    await bucket.put(`${UUID}/manifest.json`, JSON.stringify(manifest));
    expect((await call('/transfer', 'DELETE', bearer(forged()))).status).toBe(403);
  });
});
