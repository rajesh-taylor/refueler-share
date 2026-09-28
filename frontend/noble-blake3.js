/*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) */
// ── frontend/noble-blake3.js — VENDORED, do not edit (Share-Deps-1 · 28 Sep 2026) ──
// Pure-JS BLAKE3 from @noble/hashes 1.7.2. Fallback only: crypto.js loadBlake3() imports this
// when the WASM bundle (frontend/blake3/) can't run, e.g. Vanadium with the JIT off (F-20).
// Source:  https://registry.npmjs.org/@noble/hashes/-/hashes-1.7.2.tgz
//          sha512-biZ0NUSxyjLLqo6KxEJ1b+C2NAx0wtDoFvCaXHGgUkeHzf3Xc1xKumFKREuT7f7DARNZ/slvYUwFG6B0f2b6hQ== (= npm dist.integrity)
// Built:   esbuild 0.28.1, entry `export { blake3 } from '@noble/hashes/blake3';`
//          --bundle --format=esm --platform=browser --target=es2020 --legal-comments=none
//          Output below is unmodified. No imports, no network.
//
// The MIT License (MIT)
//
// Copyright (c) 2022 Paul Miller (https://paulmillr.com)
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.
// ─────────────────────────────────────────────────────────────────────────────
// node_modules/@noble/hashes/esm/_assert.js
function anumber(n) {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new Error("positive integer expected, got " + n);
}
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
}
function abytes(b, ...lengths) {
  if (!isBytes(b))
    throw new Error("Uint8Array expected");
  if (lengths.length > 0 && !lengths.includes(b.length))
    throw new Error("Uint8Array expected of length " + lengths + ", got length=" + b.length);
}
function aexists(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("Hash instance has been destroyed");
  if (checkFinished && instance.finished)
    throw new Error("Hash#digest() has already been called");
}
function aoutput(out, instance) {
  abytes(out);
  const min = instance.outputLen;
  if (out.length < min) {
    throw new Error("digestInto() expects output buffer of length at least " + min);
  }
}

// node_modules/@noble/hashes/esm/utils.js
function u8(arr) {
  return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
}
function u32(arr) {
  return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
}
function rotr(word, shift) {
  return word << 32 - shift | word >>> shift;
}
var isLE = /* @__PURE__ */ (() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
function byteSwap(word) {
  return word << 24 & 4278190080 | word << 8 & 16711680 | word >>> 8 & 65280 | word >>> 24 & 255;
}
var byteSwapIfBE = isLE ? (n) => n : (n) => byteSwap(n);
function byteSwap32(arr) {
  for (let i = 0; i < arr.length; i++) {
    arr[i] = byteSwap(arr[i]);
  }
}
var hasHexBuiltin = (
  // @ts-ignore
  typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function"
);
function utf8ToBytes(str) {
  if (typeof str !== "string")
    throw new Error("utf8ToBytes expected string, got " + typeof str);
  return new Uint8Array(new TextEncoder().encode(str));
}
function toBytes(data) {
  if (typeof data === "string")
    data = utf8ToBytes(data);
  abytes(data);
  return data;
}
var Hash = class {
  // Safe version that clones internal state
  clone() {
    return this._cloneInto();
  }
};
function wrapXOFConstructorWithOpts(hashCons) {
  const hashC = (msg, opts) => hashCons(opts).update(toBytes(msg)).digest();
  const tmp = hashCons({});
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.create = (opts) => hashCons(opts);
  return hashC;
}

// node_modules/@noble/hashes/esm/_blake.js
var BLAKE = class extends Hash {
  constructor(blockLen, outputLen, opts = {}, keyLen, saltLen, persLen) {
    super();
    this.length = 0;
    this.pos = 0;
    this.finished = false;
    this.destroyed = false;
    anumber(blockLen);
    anumber(outputLen);
    anumber(keyLen);
    if (outputLen < 0 || outputLen > keyLen)
      throw new Error("outputLen bigger than keyLen");
    if (opts.key !== void 0 && (opts.key.length < 1 || opts.key.length > keyLen))
      throw new Error("key length must be undefined or 1.." + keyLen);
    if (opts.salt !== void 0 && opts.salt.length !== saltLen)
      throw new Error("salt must be undefined or " + saltLen);
    if (opts.personalization !== void 0 && opts.personalization.length !== persLen)
      throw new Error("personalization must be undefined or " + persLen);
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.buffer = new Uint8Array(blockLen);
    this.buffer32 = u32(this.buffer);
  }
  update(data) {
    aexists(this);
    const { blockLen, buffer, buffer32 } = this;
    data = toBytes(data);
    const len = data.length;
    const offset = data.byteOffset;
    const buf = data.buffer;
    for (let pos = 0; pos < len; ) {
      if (this.pos === blockLen) {
        if (!isLE)
          byteSwap32(buffer32);
        this.compress(buffer32, 0, false);
        if (!isLE)
          byteSwap32(buffer32);
        this.pos = 0;
      }
      const take = Math.min(blockLen - this.pos, len - pos);
      const dataOffset = offset + pos;
      if (take === blockLen && !(dataOffset % 4) && pos + take < len) {
        const data32 = new Uint32Array(buf, dataOffset, Math.floor((len - pos) / 4));
        if (!isLE)
          byteSwap32(data32);
        for (let pos32 = 0; pos + blockLen < len; pos32 += buffer32.length, pos += blockLen) {
          this.length += blockLen;
          this.compress(data32, pos32, false);
        }
        if (!isLE)
          byteSwap32(data32);
        continue;
      }
      buffer.set(data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      this.length += take;
      pos += take;
    }
    return this;
  }
  digestInto(out) {
    aexists(this);
    aoutput(out, this);
    const { pos, buffer32 } = this;
    this.finished = true;
    this.buffer.subarray(pos).fill(0);
    if (!isLE)
      byteSwap32(buffer32);
    this.compress(buffer32, 0, true);
    if (!isLE)
      byteSwap32(buffer32);
    const out32 = u32(out);
    this.get().forEach((v, i) => out32[i] = byteSwapIfBE(v));
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneInto(to) {
    const { buffer, length, finished, destroyed, outputLen, pos } = this;
    to || (to = new this.constructor({ dkLen: outputLen }));
    to.set(...this.get());
    to.length = length;
    to.finished = finished;
    to.destroyed = destroyed;
    to.outputLen = outputLen;
    to.buffer.set(buffer);
    to.pos = pos;
    return to;
  }
};

// node_modules/@noble/hashes/esm/_u64.js
var U32_MASK64 = /* @__PURE__ */ BigInt(2 ** 32 - 1);
var _32n = /* @__PURE__ */ BigInt(32);
function fromBig(n, le = false) {
  if (le)
    return { h: Number(n & U32_MASK64), l: Number(n >> _32n & U32_MASK64) };
  return { h: Number(n >> _32n & U32_MASK64) | 0, l: Number(n & U32_MASK64) | 0 };
}

// node_modules/@noble/hashes/esm/blake2s.js
var B2S_IV = /* @__PURE__ */ new Uint32Array([
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
]);
function G1s(a, b, c, d, x) {
  a = a + b + x | 0;
  d = rotr(d ^ a, 16);
  c = c + d | 0;
  b = rotr(b ^ c, 12);
  return { a, b, c, d };
}
function G2s(a, b, c, d, x) {
  a = a + b + x | 0;
  d = rotr(d ^ a, 8);
  c = c + d | 0;
  b = rotr(b ^ c, 7);
  return { a, b, c, d };
}
function compress(s, offset, msg, rounds, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15) {
  let j = 0;
  for (let i = 0; i < rounds; i++) {
    ({ a: v0, b: v4, c: v8, d: v12 } = G1s(v0, v4, v8, v12, msg[offset + s[j++]]));
    ({ a: v0, b: v4, c: v8, d: v12 } = G2s(v0, v4, v8, v12, msg[offset + s[j++]]));
    ({ a: v1, b: v5, c: v9, d: v13 } = G1s(v1, v5, v9, v13, msg[offset + s[j++]]));
    ({ a: v1, b: v5, c: v9, d: v13 } = G2s(v1, v5, v9, v13, msg[offset + s[j++]]));
    ({ a: v2, b: v6, c: v10, d: v14 } = G1s(v2, v6, v10, v14, msg[offset + s[j++]]));
    ({ a: v2, b: v6, c: v10, d: v14 } = G2s(v2, v6, v10, v14, msg[offset + s[j++]]));
    ({ a: v3, b: v7, c: v11, d: v15 } = G1s(v3, v7, v11, v15, msg[offset + s[j++]]));
    ({ a: v3, b: v7, c: v11, d: v15 } = G2s(v3, v7, v11, v15, msg[offset + s[j++]]));
    ({ a: v0, b: v5, c: v10, d: v15 } = G1s(v0, v5, v10, v15, msg[offset + s[j++]]));
    ({ a: v0, b: v5, c: v10, d: v15 } = G2s(v0, v5, v10, v15, msg[offset + s[j++]]));
    ({ a: v1, b: v6, c: v11, d: v12 } = G1s(v1, v6, v11, v12, msg[offset + s[j++]]));
    ({ a: v1, b: v6, c: v11, d: v12 } = G2s(v1, v6, v11, v12, msg[offset + s[j++]]));
    ({ a: v2, b: v7, c: v8, d: v13 } = G1s(v2, v7, v8, v13, msg[offset + s[j++]]));
    ({ a: v2, b: v7, c: v8, d: v13 } = G2s(v2, v7, v8, v13, msg[offset + s[j++]]));
    ({ a: v3, b: v4, c: v9, d: v14 } = G1s(v3, v4, v9, v14, msg[offset + s[j++]]));
    ({ a: v3, b: v4, c: v9, d: v14 } = G2s(v3, v4, v9, v14, msg[offset + s[j++]]));
  }
  return { v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15 };
}

// node_modules/@noble/hashes/esm/blake3.js
var B3_Flags = {
  CHUNK_START: 1 << 0,
  CHUNK_END: 1 << 1,
  PARENT: 1 << 2,
  ROOT: 1 << 3,
  KEYED_HASH: 1 << 4,
  DERIVE_KEY_CONTEXT: 1 << 5,
  DERIVE_KEY_MATERIAL: 1 << 6
};
var SIGMA = /* @__PURE__ */ (() => {
  const Id = Array.from({ length: 16 }, (_, i) => i);
  const permute = (arr) => [2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8].map((i) => arr[i]);
  const res = [];
  for (let i = 0, v = Id; i < 7; i++, v = permute(v))
    res.push(...v);
  return Uint8Array.from(res);
})();
var BLAKE3 = class _BLAKE3 extends BLAKE {
  constructor(opts = {}, flags = 0) {
    const olen = opts.dkLen === void 0 ? 32 : opts.dkLen;
    super(64, olen, {}, Number.MAX_SAFE_INTEGER, 0, 0);
    this.flags = 0 | 0;
    this.chunkPos = 0;
    this.chunksDone = 0;
    this.stack = [];
    this.posOut = 0;
    this.bufferOut32 = new Uint32Array(16);
    this.chunkOut = 0;
    this.enableXOF = true;
    anumber(this.outputLen);
    if (opts.key !== void 0 && opts.context !== void 0)
      throw new Error("Blake3: only key or context can be specified at same time");
    else if (opts.key !== void 0) {
      const key = toBytes(opts.key).slice();
      if (key.length !== 32)
        throw new Error("Blake3: key should be 32 byte");
      this.IV = u32(key);
      if (!isLE)
        byteSwap32(this.IV);
      this.flags = flags | B3_Flags.KEYED_HASH;
    } else if (opts.context !== void 0) {
      const context_key = new _BLAKE3({ dkLen: 32 }, B3_Flags.DERIVE_KEY_CONTEXT).update(opts.context).digest();
      this.IV = u32(context_key);
      if (!isLE)
        byteSwap32(this.IV);
      this.flags = flags | B3_Flags.DERIVE_KEY_MATERIAL;
    } else {
      this.IV = B2S_IV.slice();
      this.flags = flags;
    }
    this.state = this.IV.slice();
    this.bufferOut = u8(this.bufferOut32);
  }
  // Unused
  get() {
    return [];
  }
  set() {
  }
  b2Compress(counter, flags, buf, bufPos = 0) {
    const { state: s, pos } = this;
    const { h, l } = fromBig(BigInt(counter), true);
    const { v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15 } = compress(SIGMA, bufPos, buf, 7, s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], B2S_IV[0], B2S_IV[1], B2S_IV[2], B2S_IV[3], h, l, pos, flags);
    s[0] = v0 ^ v8;
    s[1] = v1 ^ v9;
    s[2] = v2 ^ v10;
    s[3] = v3 ^ v11;
    s[4] = v4 ^ v12;
    s[5] = v5 ^ v13;
    s[6] = v6 ^ v14;
    s[7] = v7 ^ v15;
  }
  compress(buf, bufPos = 0, isLast = false) {
    let flags = this.flags;
    if (!this.chunkPos)
      flags |= B3_Flags.CHUNK_START;
    if (this.chunkPos === 15 || isLast)
      flags |= B3_Flags.CHUNK_END;
    if (!isLast)
      this.pos = this.blockLen;
    this.b2Compress(this.chunksDone, flags, buf, bufPos);
    this.chunkPos += 1;
    if (this.chunkPos === 16 || isLast) {
      let chunk = this.state;
      this.state = this.IV.slice();
      for (let last, chunks = this.chunksDone + 1; isLast || !(chunks & 1); chunks >>= 1) {
        if (!(last = this.stack.pop()))
          break;
        this.buffer32.set(last, 0);
        this.buffer32.set(chunk, 8);
        this.pos = this.blockLen;
        this.b2Compress(0, this.flags | B3_Flags.PARENT, this.buffer32, 0);
        chunk = this.state;
        this.state = this.IV.slice();
      }
      this.chunksDone++;
      this.chunkPos = 0;
      this.stack.push(chunk);
    }
    this.pos = 0;
  }
  _cloneInto(to) {
    to = super._cloneInto(to);
    const { IV, flags, state, chunkPos, posOut, chunkOut, stack, chunksDone } = this;
    to.state.set(state.slice());
    to.stack = stack.map((i) => Uint32Array.from(i));
    to.IV.set(IV);
    to.flags = flags;
    to.chunkPos = chunkPos;
    to.chunksDone = chunksDone;
    to.posOut = posOut;
    to.chunkOut = chunkOut;
    to.enableXOF = this.enableXOF;
    to.bufferOut32.set(this.bufferOut32);
    return to;
  }
  destroy() {
    this.destroyed = true;
    this.state.fill(0);
    this.buffer32.fill(0);
    this.IV.fill(0);
    this.bufferOut32.fill(0);
    for (let i of this.stack)
      i.fill(0);
  }
  // Same as b2Compress, but doesn't modify state and returns 16 u32 array (instead of 8)
  b2CompressOut() {
    const { state: s, pos, flags, buffer32, bufferOut32: out32 } = this;
    const { h, l } = fromBig(BigInt(this.chunkOut++));
    if (!isLE)
      byteSwap32(buffer32);
    const { v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15 } = compress(SIGMA, 0, buffer32, 7, s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], B2S_IV[0], B2S_IV[1], B2S_IV[2], B2S_IV[3], l, h, pos, flags);
    out32[0] = v0 ^ v8;
    out32[1] = v1 ^ v9;
    out32[2] = v2 ^ v10;
    out32[3] = v3 ^ v11;
    out32[4] = v4 ^ v12;
    out32[5] = v5 ^ v13;
    out32[6] = v6 ^ v14;
    out32[7] = v7 ^ v15;
    out32[8] = s[0] ^ v8;
    out32[9] = s[1] ^ v9;
    out32[10] = s[2] ^ v10;
    out32[11] = s[3] ^ v11;
    out32[12] = s[4] ^ v12;
    out32[13] = s[5] ^ v13;
    out32[14] = s[6] ^ v14;
    out32[15] = s[7] ^ v15;
    if (!isLE) {
      byteSwap32(buffer32);
      byteSwap32(out32);
    }
    this.posOut = 0;
  }
  finish() {
    if (this.finished)
      return;
    this.finished = true;
    this.buffer.fill(0, this.pos);
    let flags = this.flags | B3_Flags.ROOT;
    if (this.stack.length) {
      flags |= B3_Flags.PARENT;
      if (!isLE)
        byteSwap32(this.buffer32);
      this.compress(this.buffer32, 0, true);
      if (!isLE)
        byteSwap32(this.buffer32);
      this.chunksDone = 0;
      this.pos = this.blockLen;
    } else {
      flags |= (!this.chunkPos ? B3_Flags.CHUNK_START : 0) | B3_Flags.CHUNK_END;
    }
    this.flags = flags;
    this.b2CompressOut();
  }
  writeInto(out) {
    aexists(this, false);
    abytes(out);
    this.finish();
    const { blockLen, bufferOut } = this;
    for (let pos = 0, len = out.length; pos < len; ) {
      if (this.posOut >= blockLen)
        this.b2CompressOut();
      const take = Math.min(blockLen - this.posOut, len - pos);
      out.set(bufferOut.subarray(this.posOut, this.posOut + take), pos);
      this.posOut += take;
      pos += take;
    }
    return out;
  }
  xofInto(out) {
    if (!this.enableXOF)
      throw new Error("XOF is not possible after digest call");
    return this.writeInto(out);
  }
  xof(bytes) {
    anumber(bytes);
    return this.xofInto(new Uint8Array(bytes));
  }
  digestInto(out) {
    aoutput(out, this);
    if (this.finished)
      throw new Error("digest() was already called");
    this.enableXOF = false;
    this.writeInto(out);
    this.destroy();
    return out;
  }
  digest() {
    return this.digestInto(new Uint8Array(this.outputLen));
  }
};
var blake3 = /* @__PURE__ */ wrapXOFConstructorWithOpts((opts) => new BLAKE3(opts));
export {
  blake3
};
