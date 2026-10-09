/**
 * part-crypto.test.js — part key schedule and link format v2 (Share-Crypto-1)
 *
 * Imports the browser's own modules (frontend/crypto.js, config.js, fragment.js):
 * WebCrypto here is the same API the page calls.
 *
 *   part_key = HKDF-SHA256(K, salt = empty, info = utf8("refueler.share.payload.v2") ‖ 0x00)
 *   nonce_i  = 0x00 ×7 ‖ BE32(i) ‖ last      AAD_i = BE32(i)
 *
 * Known-answer vectors were produced two independent ways (WebCrypto and node:crypto).
 */

import { describe, it, expect } from 'vitest';
import {
  derivePartKey, partNonce, partAad, encryptPart, decryptPart, decryptPartV1,
} from '../../frontend/crypto.js';
import { CHUNK_SIZE } from '../../frontend/config.js';
import { assembleFragment, parseFragment } from '../../frontend/fragment.js';

const hex = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (h) => Uint8Array.from(h.match(/../g) || [], (x) => parseInt(x, 16));
const utf8 = (s) => new TextEncoder().encode(s);
const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const frag = (obj) => b64u(utf8(JSON.stringify(obj)));
const sha256 = async (b) => hex(await crypto.subtle.digest('SHA-256', b));

// ─── Vectors ─────────────────────────────────────────────────────────────────
const K        = Uint8Array.from({ length: 32 }, (_, i) => i);   // 00 01 .. 1f
const INFO     = '72656675656c65722e73686172652e7061796c6f61642e763200';
const PART_KEY = '071ab966413cac37cbf2a65ebe81ad4da4049b2ecf665ce219891f073c231727';
const P = [new Uint8Array(64), Uint8Array.from({ length: 64 }, (_, i) => i), utf8('refueler share v2 tail')];
const T1 = {
  nonces: ['000000000000000000000000', '000000000000000000000100', '000000000000000000000201'],
  aads:   ['00000000', '00000001', '00000002'],
  C: [
    'cf47ee88c5c37583842f70540588361ba8d0431f7d6759d7dc28e8c861d6367fbde366c2d2cc88a8daab89fda2943b962c327fae94522385539c91c46cbd55dddfa4ea7f052da674b103f22c01d2453b',
    '78c1270ac7411c536825378da89b0d3b57cfff1ef5b68268352c5d6a9410ea5bf9b3d1f9dd89b9257b7b57163a7a72e54940845b6f576af1f6d9e9fbdab0bdf40a2a7f8ccf7c623fa9b7c2ef59ca517e',
    '61122800f308c8ca48965584e0d6085da38bb5bad574a434760d80aacb1a3ce67124232ab404',
  ],
};
const T2 = { nonce: '000000000000000000000001', C: '88b66ec651266c7222c3d1da3f5d544d85688199515e75129211588dc55681e47c833567470c' };
const T3 = { len: 33554448, sha256: '41ab6071f878149bc764b6e78d14b9fe12fa70397e504cedf998a400a3d7439a', tag: '8cbbb1515c359c14696240207fe6b3c5' };
const T4 = 'eyJ2IjoyLCJrIjoiQUFFQ0F3UUZCZ2NJQ1FvTERBME9EeEFSRWhNVUZSWVhHQmthR3h3ZEhoOCIsIm4iOiJ0ZXN0LmJpbiIsInoiOjMzNTU0NDU1fQ';

const encKey = () => derivePartKey(K, ['encrypt']);
const decKey = () => derivePartKey(K, ['decrypt']);

// ─── 1. Known answers ────────────────────────────────────────────────────────
describe('part key schedule — known answers', () => {
  it('HKDF info and part key match the vector (independent derivation, same parameters)', async () => {
    expect(hex(new Uint8Array([...utf8('refueler.share.payload.v2'), 0]))).toBe(INFO);
    const ikm  = await crypto.subtle.importKey('raw', K, 'HKDF', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: unhex(INFO) }, ikm, 256);
    expect(hex(bits)).toBe(PART_KEY);
  });

  it('T1: nonces, AADs and ciphertexts for N = 3', async () => {
    const pk = await encKey();
    for (let i = 0; i < 3; i++) {
      expect(hex(partNonce(i, i === 2))).toBe(T1.nonces[i]);
      expect(hex(partAad(i))).toBe(T1.aads[i]);
      expect(hex(await encryptPart(pk, P[i], i, 3))).toBe(T1.C[i]);
    }
  });

  it('T2: a single part carries the last flag on index 0', async () => {
    expect(hex(partNonce(0, true))).toBe(T2.nonce);
    expect(hex(await encryptPart(await encKey(), P[2], 0, 1))).toBe(T2.C);
  });

  it('T3: full-size part (CHUNK_SIZE zeros, index 0 of 2) — length, sha256, tag', async () => {
    expect(CHUNK_SIZE).toBe(33554432);
    const c = await encryptPart(await encKey(), new Uint8Array(CHUNK_SIZE), 0, 2);
    expect(c.length).toBe(T3.len);
    expect(await sha256(c)).toBe(T3.sha256);
    expect(hex(c.subarray(c.length - 16))).toBe(T3.tag);
  });

  it('the part key is not K: a K-keyed decrypt of a part fails', async () => {
    const kKey = await crypto.subtle.importKey('raw', K, 'AES-GCM', false, ['decrypt']);
    await expect(crypto.subtle.decrypt({ name: 'AES-GCM', iv: partNonce(0, false), additionalData: partAad(0) }, kKey, unhex(T1.C[0]))).rejects.toThrow();
  });

  it('derivePartKey refuses a K that is not 32 bytes', async () => {
    await expect(derivePartKey(new Uint8Array(31), ['encrypt'])).rejects.toThrow(TypeError);
  });
});

// ─── 2–4. Properties ─────────────────────────────────────────────────────────
describe('part encryption — properties', () => {
  it('keystreams differ across parts: C0 ⊕ C1 ≠ P0 ⊕ P1', async () => {
    const pk = await encKey();
    const p0 = crypto.getRandomValues(new Uint8Array(4096));
    const p1 = crypto.getRandomValues(new Uint8Array(4096));
    const c0 = await encryptPart(pk, p0, 0, 2);
    const c1 = await encryptPart(pk, p1, 1, 2);
    let same = true;
    for (let j = 0; j < 4096; j++) if ((c0[j] ^ c1[j]) !== (p0[j] ^ p1[j])) { same = false; break; }
    expect(same).toBe(false);
  });

  it('stored part = plaintext + 16 bytes', async () => {
    const c = await encryptPart(await encKey(), new Uint8Array(1000), 0, 1);
    expect(c.length).toBe(1016);
  });

  it('re-encrypting part i with a freshly derived key gives identical bytes (resume re-check)', async () => {
    const p = crypto.getRandomValues(new Uint8Array(2048));
    const a = await encryptPart(await encKey(), p, 1, 3);
    const b = await encryptPart(await encKey(), p, 1, 3);
    expect(hex(a)).toBe(hex(b));
  });

  it('round trip for every part', async () => {
    const pk = await decKey();
    for (let i = 0; i < 3; i++) {
      expect(hex(await decryptPart(pk, unhex(T1.C[i]), i, 3))).toBe(hex(P[i]));
    }
  });

  it('truncation refused: part 1 of 3 opened as the last of 2 throws', async () => {
    await expect(decryptPart(await decKey(), unhex(T1.C[1]), 1, 2)).rejects.toThrow();
  });

  it('extension refused: the last part opened as a middle part throws', async () => {
    await expect(decryptPart(await decKey(), unhex(T1.C[2]), 2, 4)).rejects.toThrow();
  });

  it('reorder refused: part 1 served as part 0 throws', async () => {
    await expect(decryptPart(await decKey(), unhex(T1.C[1]), 0, 3)).rejects.toThrow();
  });

  it('the old decrypt path fails closed on a v2 part', async () => {
    const kKey = await crypto.subtle.importKey('raw', K, 'AES-GCM', false, ['decrypt']);
    await expect(decryptPartV1(kKey, crypto.getRandomValues(new Uint8Array(12)), unhex(T1.C[0]), 0)).rejects.toThrow();
  });
});

// ─── 5. Fragment ─────────────────────────────────────────────────────────────
describe('link format v2 — fragment', () => {
  it('assembles v2 (v, k, n, z; no i) and parses back', () => {
    const f = assembleFragment({ keyBytes: K, filename: 'test.bin', sizeBytes: 33554455 });
    expect(f).toBe(T4);
    const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(f.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))));
    expect(Object.keys(json)).toEqual(['v', 'k', 'n', 'z']);
    const p = parseFragment(f);
    expect(p).toMatchObject({ v: 2, filename: 'test.bin', sizeBytes: 33554455, ivBytes: null, sealNonce: null, legacy: false });
    expect(hex(p.keyBytes)).toBe(hex(K));
  });

  it('assembles s between n and z when a seal nonce is given, and parses it back', () => {
    const sn = Uint8Array.from({ length: 32 }, (_, i) => 255 - i);
    const f = assembleFragment({ keyBytes: K, filename: 'a.txt', sealNonce: sn, sizeBytes: 5 });
    const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(f.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))));
    expect(Object.keys(json)).toEqual(['v', 'k', 'n', 's', 'z']);
    expect(hex(parseFragment(f).sealNonce)).toBe(hex(sn));
  });

  it('T4 vector parses', () => {
    const p = parseFragment(T4);
    expect(p.v).toBe(2);
    expect(p.sizeBytes).toBe(33554455);
    expect(Math.ceil(p.sizeBytes / CHUNK_SIZE)).toBe(2);
  });

  it('assembleFragment refuses a missing size or a short key', () => {
    expect(() => assembleFragment({ keyBytes: K, filename: 'x' })).toThrow(TypeError);
    expect(() => assembleFragment({ keyBytes: K.slice(0, 31), filename: 'x', sizeBytes: 1 })).toThrow(TypeError);
  });

  const k = b64u(K);
  it.each([
    ['no z',            { v: 2, k, n: 'x' }],
    ['z = 0',           { v: 2, k, n: 'x', z: 0 }],
    ['z not integer',   { v: 2, k, n: 'x', z: 1.5 }],
    ['z as string',     { v: 2, k, n: 'x', z: '10' }],
    ['31-byte k',       { v: 2, k: b64u(K.slice(0, 31)), n: 'x', z: 1 }],
    ['33-byte k',       { v: 2, k: b64u(new Uint8Array(33)), n: 'x', z: 1 }],
    ['no k',            { v: 2, n: 'x', z: 1 }],
    ['no n',            { v: 2, k, z: 1 }],
    ['empty n',         { v: 2, k, n: '', z: 1 }],
    ['empty s',         { v: 2, k, n: 'x', s: '', z: 1 }],
  ])('v2 with %s throws (never read as a legacy key)', (_, obj) => {
    expect(() => parseFragment(frag(obj))).toThrow();
  });

  it('v1 links still parse as before (key, IV, name, optional z)', () => {
    const iv = Uint8Array.from({ length: 12 }, (_, i) => 100 + i);
    const p = parseFragment(frag({ v: 1, k: b64u(K), i: b64u(iv), n: 'old.bin', z: 42 }));
    expect(p).toMatchObject({ v: 1, filename: 'old.bin', sizeBytes: 42, legacy: false });
    expect(hex(p.ivBytes)).toBe(hex(iv));
    expect(parseFragment(frag({ v: 1, k: b64u(K), i: b64u(iv), n: 'old.bin' })).sizeBytes).toBeNull();
  });

  it('pre-v1 links (raw key, no JSON) still parse as legacy', () => {
    const p = parseFragment(b64u(K));
    expect(p.legacy).toBe(true);
    expect(hex(p.keyBytes)).toBe(hex(K));
  });
});

// ─── 6. Old links ────────────────────────────────────────────────────────────
describe('links before v2 still decrypt', () => {
  it('a v1-encrypted 2-part transfer (K + one IV + BE32 AAD) opens with decryptPartV1', async () => {
    const iv   = Uint8Array.from({ length: 12 }, (_, i) => 0xa0 + i);
    const kEnc = await crypto.subtle.importKey('raw', K, 'AES-GCM', false, ['encrypt']);
    const kDec = await crypto.subtle.importKey('raw', K, 'AES-GCM', false, ['decrypt']);
    const parts = [crypto.getRandomValues(new Uint8Array(4096)), utf8('tail of an old transfer')];
    const stored = await Promise.all(parts.map(async (p, i) => new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: partAad(i) }, kEnc, p))));
    for (let i = 0; i < 2; i++) {
      expect(hex(await decryptPartV1(kDec, iv, stored[i], i))).toBe(hex(parts[i]));
    }
    // and the v2 path refuses it
    await expect(decryptPart(await decKey(), stored[1], 1, 2)).rejects.toThrow();
  });
});
