// fuzz.test.js — H5 Fuzz-1 (Test-Hardening-1, 4 Nov 2026). Property tests with fast-check on what
// reads untrusted input: never crash, never hang, never accept the wrong thing.
//
// CI runs one fixed seed, so a public red run only ever comes from a code change, and never
// publishes a new failing input before its fix. Random seeds run on the Mac:
//   VITE_FUZZ_SEED=$RANDOM VITE_FUZZ_RUNS=5000 npx vitest run test/fuzz.test.js
// A failure prints its seed and shrunk input. Once FIXED, its input goes in fuzz-corpus/.
//
// The old mint-keyed token form goes when the overlap does (Worker-Keys-2, on or after 12 Nov):
// delete the tests marked OLD FORM then. They set DL_TOKEN_LEGACY_UNTIL themselves, so they don't
// depend on today's date, and nothing here changes the fallback.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';

import worker from '../src/index.js';
import { issueDownloadToken, verifyDownloadToken, timingSafeEqual } from '../src/nut11.js';
import { makeSessionToken, verifySessionToken, MAX_TRANSFER_CHUNKS } from '../src/upload_session.js';
import { parseRange, transferUuid, UUID_RE } from '../src/utils.js';
import { getManifest, requiresPassphrase } from '../src/manifest.js';
import { safeGetManifest } from '../src/utils.js';
import { verifyProofV2, keysetIdFor } from '../src/nut00.js';
import { parseHmacCredentials } from '../src/api_auth.js';
import { hashToCurve } from '@cashu/cashu-ts';
import { assembleFragment, parseFragment, classifyLink } from '../../frontend/fragment.js';
import { makeBucket } from './_r2_mock.js';
import { makeEnv, makeSupabase, ctx, ADMIN, ORIGIN } from './helpers/api-fake.js';
import { transferRequest } from './helpers/transfer-request.js';
import corpus from './fuzz-corpus/corpus.json';

const SEED = Number(import.meta.env.VITE_FUZZ_SEED ?? 20261104);
const RUNS = Number(import.meta.env.VITE_FUZZ_RUNS ?? 500);
const cfg = (runs = RUNS, examples = []) => ({ seed: SEED, numRuns: runs, examples, endOnFailure: false });
const SLOW = Math.max(50, Math.floor(RUNS / 5));   // properties doing curve maths

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const utf8 = (s) => new TextEncoder().encode(s);
const NOW = () => Math.floor(Date.now() / 1000);
const FAR = 4102444800;
const REFUSED = { valid: false, uuid: null };
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.split('');

const DL_KEY = 'QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI=';   // 32 × 0x42, test only
const DL_KEY_2 = 'Q0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0M=';
const MINT = 'ab'.repeat(32);
const SESSION_KEY = 'c2Vzc2lvbi1rZXktdGVzdC1vbmx5LTMyLWJ5dGVzLSE=';
const SESSION_KEY_2 = 'b3RoZXItc2Vzc2lvbi1rZXktdGVzdC1vbmx5LTMyLWI=';
const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e';

const uuidArb = fc.uuid().map((u) => u.toLowerCase());
const b64Char = fc.constantFrom(...B64URL);
const b64Str = (min, max) => fc.array(b64Char, { minLength: min, maxLength: max }).map((a) => a.join(''));
const unicode = fc.string({ unit: 'binary', maxLength: 200 });
// Strings shaped like the thing, as well as noise: a junk generator that never gets past the first
// check proves nothing.
const tokenLike = fc.oneof(
  unicode,
  b64Str(0, 200),
  fc.tuple(b64Str(0, 60), b64Str(0, 60)).map(([a, b]) => `${a}.${b}`),
  fc.tuple(b64Str(0, 60), b64Str(43, 43)).map(([a, b]) => `${a}.${b}`),
  fc.tuple(b64Str(0, 60), b64Str(43, 43)).map(([a, b]) => `dl1.${a}.${b}`),
  fc.array(unicode, { maxLength: 6 }).map((a) => a.join('.')),
);
const anyJson = fc.jsonValue({ maxDepth: 3 });

async function dlMacKey(keyB64) {
  const TAG = utf8('refueler.share.dltoken.v1\0');
  const raw = Uint8Array.from(atob(keyB64), (c) => c.charCodeAt(0));
  const ikm = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: TAG }, ikm, 256);
  return crypto.subtle.importKey('raw', bits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}
async function signDl1(payload, keyB64 = DL_KEY) {
  const key = await dlMacKey(keyB64);
  const tag = utf8('refueler.share.dltoken.v1\0');
  const p = utf8(payload);
  const msg = new Uint8Array(tag.length + p.length);
  msg.set(tag); msg.set(p, tag.length);
  return `dl1.${payload}.${b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, msg)))}`;
}
async function signOld(payload, mintHex = MINT) {
  const raw = Uint8Array.from(mintHex.match(/../g), (h) => parseInt(h, 16));
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `${payload}.${b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8(payload))))}`;
}
const payloadOf = (obj) => b64url(utf8(JSON.stringify(obj)));

// ── Download tokens ──────────────────────────────────────────────────────────
describe('download tokens, new form', () => {
  const env = { DL_TOKEN_KEY: DL_KEY };

  it('junk never throws and is always refused', async () => {
    await fc.assert(fc.asyncProperty(tokenLike, async (t) => {
      expect(await verifyDownloadToken(t, env)).toEqual(REFUSED);
    }), cfg(RUNS, corpus.dl_token_junk.map((x) => [x])));
    await fc.assert(fc.asyncProperty(anyJson, async (t) => {
      if (typeof t !== 'string') expect(await verifyDownloadToken(t, env)).toEqual(REFUSED);
    }), cfg());
  });

  it('what it issues verifies, for any transfer and any future expiry', async () => {
    await fc.assert(fc.asyncProperty(uuidArb, fc.integer({ min: NOW() + 60, max: FAR }), async (uuid, exp) => {
      expect(await verifyDownloadToken(await issueDownloadToken(uuid, env, exp), env)).toEqual({ valid: true, uuid });
    }), cfg());
  });

  it('an expired token is refused', async () => {
    await fc.assert(fc.asyncProperty(uuidArb, fc.integer({ min: 0, max: NOW() - 2 }), async (uuid, exp) => {
      expect(await verifyDownloadToken(await issueDownloadToken(uuid, env, exp), env)).toEqual(REFUSED);
    }), cfg());
  });

  it('any one changed character anywhere is refused', async () => {
    const token = await issueDownloadToken(UUID, env, FAR);
    await fc.assert(fc.asyncProperty(fc.nat({ max: token.length - 1 }), b64Char, async (i, c) => {
      fc.pre(token[i] !== c);
      expect((await verifyDownloadToken(token.slice(0, i) + c + token.slice(i + 1), env)).valid).toBe(false);
    }), cfg());
  });

  it('a well-formed wrong signature is refused (the Worker-Keys-1 class of bug)', async () => {
    const token = await issueDownloadToken(UUID, env, FAR);
    const head = token.slice(0, token.lastIndexOf('.') + 1);
    const realSig = token.slice(head.length);
    await fc.assert(fc.asyncProperty(fc.uint8Array({ minLength: 32, maxLength: 32 }), async (sig) => {
      const s = b64url(sig);
      fc.pre(s !== realSig);
      expect(await verifyDownloadToken(head + s, env)).toEqual(REFUSED);
    }), cfg(RUNS * 4));
  });

  it("another key's token, however it is built, is refused", async () => {
    await fc.assert(fc.asyncProperty(uuidArb, async (uuid) => {
      const other = await issueDownloadToken(uuid, { DL_TOKEN_KEY: DL_KEY_2 }, FAR);
      expect(await verifyDownloadToken(other, env)).toEqual(REFUSED);
    }), cfg());
  });

  it('a good MAC over a bad payload never throws, and bad claims are refused', async () => {
    const badClaims = fc.oneof(
      anyJson,
      fc.record({ uuid: anyJson, exp: anyJson }),
      fc.record({ uuid: fc.string(), exp: fc.oneof(fc.double(), fc.string(), fc.constant(null), fc.constant(true)) }),
    );
    await fc.assert(fc.asyncProperty(fc.oneof(badClaims.map(payloadOf), b64Str(0, 60)), async (payload) => {
      const r = await verifyDownloadToken(await signDl1(payload), env);
      if (r.valid) {
        const c = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
        expect(typeof c.uuid).toBe('string');
        expect(Number.isInteger(c.exp) && c.exp >= NOW()).toBe(true);
      } else {
        expect(r).toEqual(REFUSED);
      }
    }), cfg());
  });

  it('an unusable key issues nothing and verifies nothing', async () => {
    const good = await issueDownloadToken(UUID, env, FAR);
    await fc.assert(fc.asyncProperty(fc.oneof(unicode, anyJson, b64Str(0, 44)), async (k) => {
      fc.pre(k !== DL_KEY);
      const bad = { DL_TOKEN_KEY: k };
      // A different usable key may issue; it must still not open a token made under the real one.
      expect(await verifyDownloadToken(good, bad)).toEqual(REFUSED);
    }), cfg());
  });
});

describe('download tokens, OLD FORM (delete with the overlap at Worker-Keys-2)', () => {
  const open = () => ({ DL_TOKEN_KEY: DL_KEY, MINT_PRIVATE_KEY: MINT, DL_TOKEN_LEGACY_UNTIL: String(NOW() + 3600) });
  const shut = () => ({ DL_TOKEN_KEY: DL_KEY, MINT_PRIVATE_KEY: MINT, DL_TOKEN_LEGACY_UNTIL: String(NOW() - 1) });

  it('junk is refused while the overlap is open', async () => {
    await fc.assert(fc.asyncProperty(tokenLike, async (t) => {
      expect(await verifyDownloadToken(t, open())).toEqual(REFUSED);
    }), cfg());
  });

  it('a real old token passes only while the overlap is open', async () => {
    await fc.assert(fc.asyncProperty(uuidArb, async (uuid) => {
      const t = await signOld(payloadOf({ uuid, exp: FAR }));
      expect(await verifyDownloadToken(t, open())).toEqual({ valid: true, uuid });
      expect(await verifyDownloadToken(t, shut())).toEqual(REFUSED);
      expect(await verifyDownloadToken(t, { DL_TOKEN_KEY: DL_KEY, MINT_PRIVATE_KEY: MINT })).toEqual(REFUSED);
    }), cfg());
  });

  it('a well-formed wrong signature on the old form is refused', async () => {
    const payload = payloadOf({ uuid: UUID, exp: FAR });
    const realSig = (await signOld(payload)).split('.')[1];
    await fc.assert(fc.asyncProperty(fc.uint8Array({ minLength: 32, maxLength: 32 }), async (sig) => {
      const s = b64url(sig);
      fc.pre(s !== realSig);
      expect(await verifyDownloadToken(`${payload}.${s}`, open())).toEqual(REFUSED);
    }), cfg(RUNS * 4));
  });

  it('the two forms do not stand in for each other', async () => {
    await fc.assert(fc.asyncProperty(uuidArb, async (uuid) => {
      const payload = payloadOf({ uuid, exp: FAR });
      const fresh = await signDl1(payload);
      const old = await signOld(payload);
      expect(await verifyDownloadToken(fresh.slice(4), open())).toEqual(REFUSED);   // new, "dl1." off
      expect(await verifyDownloadToken(`dl1.${old}`, open())).toEqual(REFUSED);      // old, "dl1." on
    }), cfg());
  });

  it('a bad mint key is never used', async () => {
    await fc.assert(fc.asyncProperty(fc.oneof(unicode, anyJson), async (m) => {
      fc.pre(m !== MINT);
      const env = { DL_TOKEN_KEY: DL_KEY, MINT_PRIVATE_KEY: m, DL_TOKEN_LEGACY_UNTIL: String(NOW() + 3600) };
      expect(await verifyDownloadToken(await signOld(payloadOf({ uuid: UUID, exp: FAR })), env)).toEqual(REFUSED);
    }), cfg());
  });
});

describe('timingSafeEqual', () => {
  const hexStr = fc.array(fc.constantFrom(...'0123456789abcdefABCDEF'), { maxLength: 64 }).map((a) => a.join(''));
  const parse = (s) => s.toLowerCase();

  it('true only for the same even-length hex, never throws', () => {
    fc.assert(fc.property(fc.oneof(hexStr, unicode, anyJson), fc.oneof(hexStr, unicode, anyJson), (a, b) => {
      const r = timingSafeEqual(a, b);
      const shape = (x) => typeof x === 'string' && x.length % 2 === 0 && /^[0-9a-fA-F]*$/.test(x);
      expect(r).toBe(shape(a) && shape(b) && parse(a) === parse(b));
    }), cfg(RUNS * 4));
  });

  it('a string equals itself when it is hex', () => {
    fc.assert(fc.property(hexStr.filter((s) => s.length % 2 === 0), (a) => timingSafeEqual(a, a) === true), cfg());
  });
});

// ── Upload session tokens ────────────────────────────────────────────────────
describe('upload session tokens', () => {
  const env = { UPLOAD_SESSION_KEY: SESSION_KEY };
  const chunks = fc.integer({ min: 1, max: MAX_TRANSFER_CHUNKS });
  const future = fc.integer({ min: NOW() + 60, max: FAR });
  const sessionLike = fc.oneof(
    unicode,
    fc.tuple(fc.integer({ min: 0, max: FAR }), fc.integer({ min: 0, max: 20000 }), b64Str(43, 43)).map(([e, n, m]) => `v1.${e}.${n}.${m}`),
    fc.tuple(fc.string(), fc.string(), fc.string()).map(([e, n, m]) => `v1.${e}.${n}.${m}`),
  );

  it('junk never throws and is always refused', async () => {
    await fc.assert(fc.asyncProperty(sessionLike, uuidArb, async (t, uuid) => {
      expect(await verifySessionToken(env, t, uuid, NOW())).toBeNull();
    }), cfg());
    await fc.assert(fc.asyncProperty(anyJson, uuidArb, async (t, uuid) => {
      if (typeof t !== 'string') expect(await verifySessionToken(env, t, uuid, NOW())).toBeNull();
    }), cfg());
  });

  it('what it makes verifies with the same values', async () => {
    await fc.assert(fc.asyncProperty(uuidArb, chunks, future, async (uuid, n, exp) => {
      const t = await makeSessionToken(env, uuid, n, exp);
      expect(await verifySessionToken(env, t, uuid, NOW())).toEqual({ totalChunks: n, sessionExp: exp });
    }), cfg());
  });

  it('it is bound to its transfer, its key, its part count and its expiry', async () => {
    await fc.assert(fc.asyncProperty(uuidArb, uuidArb, chunks, future, async (u1, u2, n, exp) => {
      fc.pre(u1 !== u2);
      const t = await makeSessionToken(env, u1, n, exp);
      expect(await verifySessionToken(env, t, u2, NOW())).toBeNull();
      expect(await verifySessionToken({ UPLOAD_SESSION_KEY: SESSION_KEY_2 }, t, u1, NOW())).toBeNull();
      const [v, e, c, m] = t.split('.');
      expect(await verifySessionToken(env, [v, e, Number(c) === 1 ? 2 : Number(c) - 1, m].join('.'), u1, NOW())).toBeNull();
      expect(await verifySessionToken(env, [v, Number(e) + 1, c, m].join('.'), u1, NOW())).toBeNull();
      expect(await verifySessionToken(env, t, u1, exp)).toBeNull();   // at its expiry
    }), cfg());
  });

  it('a well-formed wrong MAC is refused', async () => {
    const t = await makeSessionToken(env, UUID, 3, FAR);
    const head = t.slice(0, t.lastIndexOf('.') + 1);
    const real = t.slice(head.length);
    await fc.assert(fc.asyncProperty(fc.uint8Array({ minLength: 32, maxLength: 32 }), async (m) => {
      const s = b64url(m);
      fc.pre(s !== real);
      expect(await verifySessionToken(env, head + s, UUID, NOW())).toBeNull();
    }), cfg(RUNS * 2));
  });

  it('a part count over the limit is refused even with a good MAC', async () => {
    const t = await makeSessionToken(env, UUID, MAX_TRANSFER_CHUNKS + 1, FAR);
    expect(await verifySessionToken(env, t, UUID, NOW())).toBeNull();
  });
});

// ── Range ────────────────────────────────────────────────────────────────────
describe('parseRange', () => {
  const rangeLike = fc.oneof(
    unicode,
    fc.tuple(fc.nat(), fc.nat()).map(([a, b]) => `bytes=${a}-${b}`),
    fc.nat().map((a) => `bytes=${a}-`),
    fc.nat().map((a) => `bytes=-${a}`),
    fc.tuple(fc.bigInt({ min: 0n, max: 10n ** 400n }), fc.bigInt({ min: 0n, max: 10n ** 400n })).map(([a, b]) => `bytes=${a}-${b}`),
    fc.tuple(unicode, fc.nat(), fc.nat(), unicode).map(([x, a, b, y]) => `${x}bytes=${a}-${b}${y}`),
  );

  it('never throws', () => {
    fc.assert(fc.property(rangeLike, (h) => { parseRange(h); }), cfg(RUNS * 2));
  });

  it('a well-formed range reads as itself', () => {
    fc.assert(fc.property(fc.nat(), fc.nat(), (a, n) => {
      expect(parseRange(`bytes=${a}-${a + n}`)).toEqual({ offset: a, length: n + 1 });
      expect(parseRange(`bytes=${a}-`)).toEqual({ offset: a, length: undefined });
    }), cfg());
  });
});

// ── Manifest ─────────────────────────────────────────────────────────────────
describe('manifest reading', () => {
  const stored = fc.oneof(unicode, anyJson.map((v) => JSON.stringify(v)));

  it('whatever is stored, reading never throws: parsed or null', async () => {
    await fc.assert(fc.asyncProperty(stored, async (text) => {
      const r2 = { get: async () => ({ size: text.length, text: async () => text }) };
      const m = await getManifest(r2, UUID);
      let want = null;
      try { want = JSON.parse(text); } catch { /* stays null */ }
      expect(m).toEqual(want);
    }), cfg());
  });

  it('an oversize manifest is never parsed', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    await fc.assert(fc.asyncProperty(fc.integer({ min: 64 * 1024 + 1, max: 2 ** 40 }), async (size) => {
      const bucket = { get: async () => ({ size, text: async () => { throw new Error('read an oversize manifest'); } }) };
      const out = await safeGetManifest(bucket, UUID, {});
      expect(out).toEqual({ manifest: null, oversize: true });
    }), cfg());
    quiet.mockRestore();
  });

  it('a password is required only by a 64-character hash', () => {
    fc.assert(fc.property(fc.dictionary(fc.constantFrom('p2sh_secret_hash', 'status'), anyJson), (m) => {
      expect(requiresPassphrase(m)).toBe(typeof m.p2sh_secret_hash === 'string' && m.p2sh_secret_hash.length === 64);
    }), cfg());
  });
});

// ── Link fragment ────────────────────────────────────────────────────────────
describe('link fragment', () => {
  const key = fc.uint8Array({ minLength: 32, maxLength: 32 });
  const fileName = fc.string({ unit: 'grapheme', minLength: 1, maxLength: 120 });
  const size = fc.maxSafeNat().filter((n) => n >= 1);
  const seal = fc.option(fc.uint8Array({ minLength: 1, maxLength: 32 }), { nil: undefined });
  const blobOf = (o) => b64url(utf8(JSON.stringify(o)));
  const fragLike = fc.oneof(
    unicode,
    b64Str(0, 200),
    anyJson.map(blobOf),
    fc.record({
      v: fc.constantFrom(1, 2, 3, '2', null),
      k: fc.oneof(key.map(b64url), unicode, anyJson),
      n: fc.oneof(fc.string(), anyJson),
      z: fc.oneof(fc.integer(), fc.double(), anyJson),
      s: fc.oneof(key.map(b64url), unicode, anyJson),
      i: fc.oneof(key.map(b64url), unicode),
    }, { requiredKeys: ['v'] }).map(blobOf),
  );

  it('what is assembled parses back exactly', () => {
    fc.assert(fc.property(key, fileName, size, seal, (k, n, z, s) => {
      const p = parseFragment(assembleFragment({ keyBytes: k, filename: n, sizeBytes: z, sealNonce: s }));
      expect(p.v).toBe(2);
      expect([...p.keyBytes]).toEqual([...k]);
      expect(p.filename).toBe(n);
      expect(p.sizeBytes).toBe(z);
      expect(p.sealNonce ? [...p.sealNonce] : undefined).toEqual(s ? [...s] : undefined);
      expect(p.legacy).toBe(false);
    }), cfg());
  });

  it('parseFragment accepts a v2 link only when every field is sound', () => {
    fc.assert(fc.property(fragLike, (f) => {
      let p;
      try { p = parseFragment(f); } catch (e) {
        expect(e).toBeInstanceOf(Error);
        return;
      }
      if (p.v === 2) {
        expect(p.keyBytes.length).toBe(32);
        expect(typeof p.filename === 'string' && p.filename.length > 0).toBe(true);
        expect(Number.isSafeInteger(p.sizeBytes) && p.sizeBytes >= 1).toBe(true);
      } else if (p.legacy) {
        expect(p.keyBytes.length).toBeGreaterThan(0);
      }
    }), cfg(RUNS * 2));
  });

  it('classifyLink never throws, and half a link hands back no key material', () => {
    const search = fc.oneof(fc.constant(''), uuidArb.map((u) => `?uuid=${u}`), unicode);
    fc.assert(fc.property(search, fragLike, (s, h) => {
      const r = classifyLink(s, '#' + h);
      expect(['download', 'incomplete', 'upload']).toContain(r.mode);
      if (r.mode === 'incomplete') expect(Object.keys(r).sort()).toEqual(['code', 'mode']);
      if (r.mode === 'upload') expect(Object.keys(r)).toEqual(['mode']);
      if (r.mode === 'download') expect(r.detected.uuid).toBeTruthy();
    }), cfg(RUNS * 2));
  });

  it('a plain visit is upload, a bare ?uuid= is incomplete', () => {
    fc.assert(fc.property(uuidArb, (u) => {
      expect(classifyLink('', '')).toEqual({ mode: 'upload' });
      expect(classifyLink(`?uuid=${u}`, '')).toEqual({ mode: 'incomplete', code: 'no_fragment' });
    }), cfg(50));
  });
});

// ── Cashu proofs ─────────────────────────────────────────────────────────────
describe('verifyProofV2', () => {
  const secretHex = fc.uint8Array({ minLength: 32, maxLength: 32 }).map((b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(''));
  const pointLike = fc.oneof(fc.constant('02'), fc.constant('03')).chain((p) => secretHex.map((h) => p + h));
  const ID = keysetIdFor(MINT);

  it('junk always throws an Error, never returns', () => {
    const junk = fc.oneof(
      anyJson,
      fc.record({ id: fc.oneof(fc.constant(ID), unicode), amount: anyJson, secret: fc.oneof(secretHex, unicode), C: fc.oneof(pointLike, unicode) }, { requiredKeys: [] }),
      fc.record({ id: fc.constant(ID), secret: secretHex, C: pointLike, extra: anyJson }),
    );
    fc.assert(fc.property(junk, (p) => {
      expect(() => verifyProofV2(p, MINT)).toThrow(Error);
    }), cfg(SLOW));
  });

  it('a well-formed proof with the wrong C is refused', () => {
    fc.assert(fc.property(secretHex, pointLike, (secret, C) => {
      expect(() => verifyProofV2({ id: ID, secret, C }, MINT)).toThrow(Error);
    }), cfg(SLOW));
  });

  it('a right proof passes once and names its serial; any change breaks it', () => {
    const k = BigInt('0x' + MINT);
    fc.assert(fc.property(secretHex, fc.nat({ max: 65 }), (secret, i) => {
      const Y = hashToCurve(utf8(secret));
      const C = Y.multiply(k).toHex(true);
      expect(verifyProofV2({ id: ID, amount: 1, secret, C }, MINT)).toEqual({ serial: Y.toHex(true) });
      const flipped = C.slice(0, i) + (C[i] === '0' ? '1' : '0') + C.slice(i + 1);
      fc.pre(flipped !== C);
      expect(() => verifyProofV2({ id: ID, amount: 1, secret, C: flipped }, MINT)).toThrow(Error);
    }), cfg(SLOW));
  });
});

// ── Headers ──────────────────────────────────────────────────────────────────
describe('request headers', () => {
  const headerSafe = fc.string({ unit: fc.integer({ min: 0x20, max: 0x7e }).map((c) => String.fromCharCode(c)), maxLength: 120 });

  it('X-Transfer-UUID: a canonical lower-case UUID, or null', () => {
    fc.assert(fc.property(fc.oneof(headerSafe, uuidArb, uuidArb.map((u) => u.toUpperCase()), uuidArb.map((u) => `  ${u} `)), (v) => {
      const r = transferUuid(new Request('https://x.test/', { headers: { 'X-Transfer-UUID': v } }));
      if (r !== null) {
        expect(UUID_RE.test(r)).toBe(true);
        expect(r).toBe(r.toLowerCase());
        expect(r).toBe(v.trim().toLowerCase());
      }
    }), cfg());
  });

  it('HMAC Authorization: three named values with a real key prefix, or null', () => {
    const value = fc.oneof(headerSafe.filter((s) => !/[,=]/.test(s)), fc.constantFrom('__proto__', 'constructor'));
    const header = fc.oneof(
      headerSafe,
      fc.tuple(value, value, value).map(([k, s, t]) => `HMAC-SHA256 key=${k}, sig=${s}, ts=${t}`),
      fc.tuple(value, value, value).map(([k, s, t]) => `HMAC-SHA256 key=rfs_live_${k},sig=${s},ts=${t}`),
      fc.array(fc.tuple(fc.constantFrom('key', 'sig', 'ts', '__proto__', 'x'), value).map(([a, b]) => `${a}=${b}`), { maxLength: 6 }).map((a) => 'HMAC-SHA256 ' + a.join(',')),
    );
    fc.assert(fc.property(header, (h) => {
      const r = parseHmacCredentials(new Request('https://x.test/', { headers: { Authorization: h } }));
      if (r === null) return;
      expect(Object.keys(r).sort()).toEqual(['apiKey', 'sig', 'ts']);
      expect(r.apiKey.startsWith('rfs_live_') || r.apiKey.startsWith('rfs_test_')).toBe(true);
      for (const v of Object.values(r)) expect(typeof v === 'string' && v.length > 0).toBe(true);
    }), cfg());
  });
});

// ── Whole routes: whatever arrives, a 5xx is never the answer ────────────────
describe('routes, through worker.fetch', { timeout: 180_000 }, () => {
  const headerSafe = fc.string({ unit: fc.integer({ min: 0x20, max: 0x7e }).map((c) => String.fromCharCode(c)), maxLength: 60 });
  const partLike = fc.oneof(headerSafe, fc.nat({ max: 12000 }).map((n) => String(n).padStart(4, '0')), fc.constantFrom('-001', '0x10', '1e3', '00.5', '٠٠٠١'.normalize('NFKD')).filter((s) => /^[\x20-\x7e]*$/.test(s)));
  const NOW_S = Math.floor(Date.now() / 1000);
  const manifest = {
    uuid: UUID, tier: 'free', total_chunks: 2, total_bytes: 100, expiry_timestamp: NOW_S + 86400,
    created_at: NOW_S - 60, status: 'complete', p2sh_secret_hash: 'a'.repeat(64),
  };
  const liveEnv = () => makeEnv({
    DL_TOKEN_KEY: DL_KEY, UPLOAD_SESSION_KEY: SESSION_KEY,
    BUCKET: makeBucket({
      [`${UUID}/manifest.json`]: { uploaded: NOW_S, body: JSON.stringify(manifest) },
      [`${UUID}/0000`]: { size: 100, uploaded: NOW_S },
      [`${UUID}/0001`]: { size: 100, uploaded: NOW_S },
    }),
  });
  const noServerError = async (req, env = liveEnv()) => {
    const res = await worker.fetch(req, env, ctx);
    expect(res.status, `${req.method} ${new URL(req.url).pathname}`).toBeLessThan(500);
    return res;
  };

  beforeEach(() => {
    const sb = makeSupabase();
    vi.stubGlobal('fetch', async (url, opts = {}) => sb.fetchImpl(url, opts));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  const R = Math.max(50, Math.floor(RUNS / 5));

  it('GET /meta and GET /download: any UUID, part and token', async () => {
    await fc.assert(fc.asyncProperty(fc.oneof(headerSafe, fc.constant(UUID), uuidArb), partLike, fc.oneof(headerSafe, fc.constant('Bearer x')), async (u, part, auth) => {
      await noServerError(new Request(`${ORIGIN}/meta`, { headers: { 'X-Transfer-UUID': u } }));
      await noServerError(new Request(`${ORIGIN}/download`, { headers: { 'X-Transfer-UUID': u, 'X-Part': part, Authorization: auth } }));
    }), cfg(R));
  });

  it('POST /unlock: any password value', async () => {
    const body = fc.oneof(fc.string().map((v) => `x${v}`), fc.record({ passphrase: anyJson }).map((v) => JSON.stringify(v)));
    await fc.assert(fc.asyncProperty(body, async (b) => {
      await noServerError(transferRequest(`${ORIGIN}/unlock`, UUID, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.7' }, body: b }));
    }), cfg(R));
  });

  it('DELETE /transfer and POST /confirm: any token', async () => {
    await fc.assert(fc.asyncProperty(tokenLike.filter((t) => /^[\x20-\x7e]*$/.test(t)), async (t) => {
      const headers = { Authorization: `Bearer ${t}`, 'CF-Connecting-IP': '198.51.100.8' };
      const env = liveEnv();
      const del = await noServerError(transferRequest(`${ORIGIN}/transfer`, UUID, { method: 'DELETE', headers }), env);
      const con = await noServerError(transferRequest(`${ORIGIN}/confirm`, UUID, { method: 'POST', headers }), env);
      expect(del.status).not.toBe(200);
      expect(con.status).not.toBe(200);
    }), cfg(R));
  });

  it('POST /upload/initiate: any headers', async () => {
    const value = fc.oneof(headerSafe, fc.nat().map(String), fc.constantFrom('-1', '0', '1e9', '9007199254740993', 'NaN', 'Infinity', '0x10', ' 5 '));
    await fc.assert(fc.asyncProperty(fc.oneof(headerSafe, uuidArb), value, value, value, async (u, n, bytes, exp) => {
      await noServerError(new Request(`${ORIGIN}/upload/initiate`, { method: 'POST', headers: {
        'X-Transfer-UUID': u, 'X-Total-Chunks': n, 'X-Total-Bytes': bytes, 'X-Expiry-Timestamp': exp,
        'CF-Connecting-IP': '198.51.100.9',
      } }));
    }), cfg(R));
  });

  it('POST /upload/urls: any numbers; POST /upload/finalise: any body; good session token', async () => {
    const num = fc.oneof(fc.integer(), fc.double(), fc.nat().map(String), fc.string());
    const urls = fc.record({ from: num, count: num }).map((v) => JSON.stringify(v));
    const finalise = fc.oneof(unicode, anyJson.map((v) => JSON.stringify(v)),
      fc.record({ hashes: anyJson, merkle_root: anyJson }).map((v) => JSON.stringify(v)));
    await fc.assert(fc.asyncProperty(urls, finalise, async (u, f) => {
      const env = liveEnv();
      const tok = await makeSessionToken(env, UUID, 2, NOW_S + 3600);
      const headers = { 'Content-Type': 'application/json', 'X-Upload-Session': tok, 'CF-Connecting-IP': '198.51.100.10' };
      await noServerError(transferRequest(`${ORIGIN}/upload/urls`, UUID, { method: 'POST', headers, body: u }), env);
      await noServerError(transferRequest(`${ORIGIN}/upload/finalise`, UUID, { method: 'POST', headers, body: f }), env);
    }), cfg(R));
  });

  it('POST /admin/reports/takedown: any body with the admin key', async () => {
    const body = fc.oneof(unicode, anyJson.map((v) => JSON.stringify(v)),
      fc.record({ case_ref: fc.oneof(fc.string(), anyJson), confirm: fc.oneof(fc.constant(UUID.slice(0, 8)), anyJson) }).map((v) => JSON.stringify(v)));
    await fc.assert(fc.asyncProperty(body, async (b) => {
      await noServerError(transferRequest(`${ORIGIN}/admin/reports/takedown`, UUID, { method: 'POST', headers: { 'X-Admin-Key': ADMIN, 'Content-Type': 'application/json' }, body: b }));
    }), cfg(R));
  });
});
