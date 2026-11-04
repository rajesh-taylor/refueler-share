// test-vectors/run.mjs — the checks for v1.json (H2 Browser-KAT-1, 4 Nov 2026).
// One file run in two places: worker/test/kat-vectors.test.js (workerd) and the harness's
// /kat/ page (real engines, real built files, real CSP). Takes the modules it checks as
// arguments, so it imports nothing and works from either place. Never part of a release.
//
// Returns [{ name, ok, detail }]. A throw inside a check is a failed check, never a crash.

const hex = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (h) => Uint8Array.from((h || '').match(/../g) || [], (x) => parseInt(x, 16));
const utf8 = (s) => new TextEncoder().encode(s);
const b3Input = (n) => Uint8Array.from({ length: n }, (_, i) => i % 251);

/**
 * mods = {
 *   crypto:   frontend/crypto.js,   fragment: frontend/fragment.js,
 *   cashu:    frontend/cashu-crypto.js,   noble: frontend/noble-blake3.js,
 *   merkle:   frontend/merkle.js (optional),
 *   skipLoadedBlake3: true where the page's WASM loader can't run (workerd),
 * }
 */
export async function runVectors(v, mods) {
  const { crypto: c, fragment: f, cashu, noble, merkle, skipLoadedBlake3 } = mods;
  const out = [];
  const check = async (name, fn) => {
    try {
      const r = await fn();
      out.push(r === true ? { name, ok: true } : { name, ok: false, detail: String(r) });
    } catch (e) {
      out.push({ name, ok: false, detail: `threw ${e?.name}: ${e?.message}` });
    }
  };
  const eq = (a, b) => a === b || `got ${a}, want ${b}`;
  const refuses = async (fn) => {
    try { await fn(); } catch { return true; }
    return 'accepted';
  };

  // ── Part encryption ────────────────────────────────────────────────────────
  const K = unhex(v.part.k), K2 = unhex(v.part.k2);
  const enc = { K: await c.derivePartKey(K, ['encrypt']), K2: await c.derivePartKey(K2, ['encrypt']) };
  const dec = { K: await c.derivePartKey(K, ['decrypt']), K2: await c.derivePartKey(K2, ['decrypt']) };

  await check('HKDF: the part key is the independent value', async () => {
    const ikm = await crypto.subtle.importKey('raw', K, 'HKDF', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: unhex(v.part.info) }, ikm, 256);
    return eq(hex(bits), v.part.part_key);
  });
  // The derived key is not extractable, so derivePartKey's own output is proved by decrypting
  // ciphertext the independent generator made with that key (below).
  for (const t of v.part.cases) {
    await check(`part: nonce and AAD, ${t.name}`, () => {
      const r = eq(hex(c.partNonce(t.i, t.i === t.n - 1)), t.nonce);
      return r === true ? eq(hex(c.partAad(t.i)), t.aad) : r;
    });
    await check(`part: encrypt, ${t.name}`, async () => eq(hex(await c.encryptPart(enc[t.key], unhex(t.pt), t.i, t.n)), t.ct));
    await check(`part: decrypt, ${t.name}`, async () => eq(hex(await c.decryptPart(dec[t.key], unhex(t.ct), t.i, t.n)), t.pt));
  }
  for (const t of v.part.refuse) {
    await check(`part: refused, ${t.name}`, () => refuses(() => c.decryptPart(dec.K, unhex(t.ct), t.i, t.n)));
  }
  await check(`part: ${v.part.big.name}`, async () => {
    const ct = await c.encryptPart(enc.K, new Uint8Array(v.part.big.plain_len), 0, 2);
    let r = eq(ct.length, v.part.big.ct_len);
    if (r === true) r = eq(await c.sha256Hex(ct), v.part.big.sha256);
    if (r === true) r = eq(hex(ct.subarray(ct.length - 16)), v.part.big.tag);
    return r;
  });
  for (const n of v.part.bad_k_lengths) {
    await check(`part: refuses a K of ${n} bytes`, () => refuses(() => c.derivePartKey(new Uint8Array(n), ['encrypt'])));
  }
  await check(`part: ${v.part.v1.name}`, async () => {
    const key = await crypto.subtle.importKey('raw', unhex(v.part.v1.k), 'AES-GCM', false, ['decrypt']);
    return eq(hex(await c.decryptPartV1(key, unhex(v.part.v1.iv), unhex(v.part.v1.ct), v.part.v1.i)), v.part.v1.pt);
  });

  // ── BLAKE3: whichever loads first (the WASM, in a browser), then noble directly ─
  let impl = null;
  if (!skipLoadedBlake3) {
    await c.loadBlake3();
    impl = c.blake3Impl();
    out.push({ name: 'BLAKE3: implementation loaded', ok: true, detail: impl });
  }
  for (const t of v.blake3.cases) {
    const input = b3Input(t.input_len);
    if (impl) {
      await check(`BLAKE3 (${impl}): ${t.input_len} bytes`, () => eq(c.blake3Hash(input), t.hash));
      await check(`BLAKE3 (${impl}, in pieces): ${t.input_len} bytes`, () => {
        const h = c.blake3CreateHash();
        const mid = t.input_len >> 1;
        h.update(input.subarray(0, mid)); h.update(input.subarray(mid));
        return eq(h.digest('hex'), t.hash);
      });
    }
    await check(`BLAKE3 (noble): ${t.input_len} bytes`, () => eq(hex(noble.blake3(input)), t.hash));
  }

  // ── SHA-256 (the date record's hash) ───────────────────────────────────────
  for (const t of v.sha256.cases) {
    await check(`SHA-256: ${t.msg.length / 2} bytes`, async () => eq(await c.sha256Hex(unhex(t.msg)), t.digest));
  }
  await check('SHA-256: a million a', async () => eq(await c.sha256Hex(new Uint8Array(1000000).fill(0x61)), v.sha256.million_a));

  // ── Link fragment ──────────────────────────────────────────────────────────
  for (const t of v.fragment.assemble) {
    const params = { keyBytes: unhex(t.k), filename: t.n, sizeBytes: t.z };
    if (t.s) params.sealNonce = unhex(t.s);
    await check(`fragment: assemble, ${t.name}`, () => eq(f.assembleFragment(params), t.blob));
    await check(`fragment: parse, ${t.name}`, () => {
      const p = f.parseFragment(t.blob);
      if (p.v !== 2 || hex(p.keyBytes) !== t.k || p.filename !== t.n || p.sizeBytes !== t.z || p.legacy !== false) return `got ${JSON.stringify({ ...p, keyBytes: hex(p.keyBytes), sealNonce: null })}`;
      return eq(p.sealNonce ? hex(p.sealNonce) : null, t.s);
    });
  }
  for (const t of v.fragment.parse_ok) {
    await check(`fragment: parse, ${t.name}`, () => {
      const p = f.parseFragment(t.blob);
      const got = { v: p.v ?? null, k: hex(p.keyBytes), n: p.filename, iv: p.ivBytes ? hex(p.ivBytes) : null, z: p.sizeBytes ?? null, legacy: p.legacy };
      return eq(JSON.stringify(got), JSON.stringify({ v: t.v, k: t.k, n: t.n, iv: t.iv, z: t.z, legacy: t.legacy }));
    });
  }
  for (const t of v.fragment.parse_refuse) {
    await check(`fragment: refused, ${t.name}`, () => refuses(() => f.parseFragment(t.blob)));
  }

  // ── NUT-00, NUT-12, and Share's credential path ────────────────────────────
  await c.loadCashu();
  for (const t of v.nut00.hash_to_curve) {
    await check(`NUT-00 hash_to_curve: ${t.msg.slice(-2)}`, () => eq(cashu.hashToCurve(unhex(t.msg)).toHex(true), t.point));
  }
  for (const t of v.nut00.blinded) {
    await check(`NUT-00 blinded message: ${t.x.slice(0, 8)}`, () => eq(cashu.blindMessage(unhex(t.x), BigInt('0x' + t.r)).B_.toHex(true), t.B_));
  }
  const dleq = (d) => cashu.verifyDLEQProof({ e: unhex(d.e), s: unhex(d.s) }, cashu.pointFromHex(d.B_), cashu.pointFromHex(d.C_), cashu.pointFromHex(d.A));
  await check('NUT-12 DLEQ: valid proof passes', () => eq(dleq(v.nut00.dleq_valid), true));
  await check('NUT-12 DLEQ: changed s fails', () => eq(dleq(v.nut00.dleq_invalid), false));

  const fl = v.nut00.flow;
  const blinded = { blindedMsg: fl.B_, blindingFactor: fl.r, secret: fl.secret };
  const issued = { signed_point: fl.C_, mint_pubkey: fl.mint_pub, keyset_id: 'kat-keyset', dleq: { e: fl.e, s: fl.s } };
  await check('credential: blinds the secret string to the independent B_', () => eq(cashu.blindMessage(utf8(fl.secret), BigInt('0x' + fl.r)).B_.toHex(true), fl.B_));
  await check('credential: unblindSignature gives the independent proof', async () => {
    const p = JSON.parse(await c.unblindSignature(issued, blinded));
    return eq(JSON.stringify(p), JSON.stringify({ id: 'kat-keyset', amount: 1, secret: fl.secret, C: fl.C }));
  });
  await check('credential: a changed DLEQ proof is refused', () => refuses(() => c.unblindSignature({ ...issued, dleq: { e: fl.e, s: '00' + fl.s.slice(2) } }, blinded)));
  await check('credential: a signature from another key is refused', () => refuses(() => c.unblindSignature({ ...issued, mint_pubkey: v.nut00.dleq_valid.A }, blinded)));

  // ── Merkle: the module's own published-format vectors, per engine ──────────
  if (merkle) await check('Merkle: selfTest', async () => {
    const r = await merkle.selfTest();   // throws on any wrong root
    return eq(r.length, 4);
  });

  return out;
}
