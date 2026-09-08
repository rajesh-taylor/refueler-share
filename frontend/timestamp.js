// ── frontend/timestamp.js — Tower Hill / Permanent Record (TH-1) ─────────────
// All OpenTimestamps client logic lives here. Never imported into share.js wholesale —
// share.js calls only the named exports it needs.
//
// Architectural locks (TH-Opus-3a):
//   commitment = SHA-256(blake3_root ‖ seal_nonce)
//   blake3_root = BLAKE3-256 of assembled plaintext captured at assembly
//   seal_nonce  = 16-byte crypto.getRandomValues, fragment-only, Sovereign+ only
//   Worker sees 32-byte digest only — no OTS library in Worker
//   Worker stores encrypted .ots blob (AES-GCM, own AAD)
//   No GET /timestamp/upgrade in Share — upgrade belongs to Legend
//
// Privacy: seal_nonce carries all privacy, BLAKE3 carries none.
// Never conflate: BLAKE3 = integrity · SHA-256 = OTS commitment · Cashu = auth
// ─────────────────────────────────────────────────────────────────────────────

// ── OTS wire format constants ─────────────────────────────────────────────────
// Magic: 0x004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294
// Spec: https://github.com/opentimestamps/opentimestamps-client/blob/master/doc/ots-file-format.md
const OTS_MAGIC = new Uint8Array([
  0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d,
  0x65, 0x73, 0x74, 0x61, 0x6d, 0x70, 0x73, 0x00,
  0x00, 0x50, 0x72, 0x6f, 0x6f, 0x66, 0x00, 0xbf,
  0x89, 0xe2, 0xe8, 0x84, 0xe8, 0x92, 0x94,
]);
const OTS_MAJOR_VERSION  = 0x01;
const OTS_OP_SHA256      = 0x08; // file_hash_op = SHA256
// 0xff = "more operations follow for this timestamp" continuation byte
// The .ots multi-attestation format concatenates calendar bodies with 0xff separators.
// Each body is terminated by a 0x00 attestation marker — so we simply concatenate
// both calendar bodies (they are already self-delimiting by the attestation record length).
// No 0xff needed at the outer wrapper level — the two bodies concatenate cleanly.
// Confirmed from live alice/bob calendar response inspection (TH-1 spike).

// Calendar URLs — both used on every submit for redundancy.
// "A dishonest calendar cannot forge a Bitcoin attestation and cannot prevent anchoring
// while one honest calendar remains." — B9 whitepaper §calendar-trust
const CALENDAR_ALICE = 'https://alice.btc.calendar.opentimestamps.org';
const CALENDAR_BOB   = 'https://bob.btc.calendar.opentimestamps.org';

// AES-GCM AAD for the .ots blob: 4 bytes, ASCII "seal" = [0x73, 0x65, 0x61, 0x6c]
// Different from chunk AAD (4-byte big-endian uint32 chunk index) — no collision possible.
const SEAL_AAD = new Uint8Array([0x73, 0x65, 0x61, 0x6c]);

const WORKER_URL = 'https://api.share.refueler.io';

// ─────────────────────────────────────────────────────────────────────────────
// generateSealNonce()
// Returns a 16-byte random nonce as a lowercase hex string.
// Lives in the URL fragment only — never in any request, header, or manifest.
// Never reuse the AES-GCM IV as the seal nonce (entanglement risk — locked TH-Opus-3a).
// ─────────────────────────────────────────────────────────────────────────────
export function generateSealNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return bufToHex(bytes);
}

// ─────────────────────────────────────────────────────────────────────────────
// buildCommitment(blake3RootHex, sealNonceHex)
// commitment = SHA-256(blake3_root_bytes ‖ seal_nonce_bytes)
// Returns 32-byte Uint8Array.
//
// blake3_root: BLAKE3-256 of assembled plaintext, captured at file assembly.
// seal_nonce:  16-byte, fragment-only. Provides unlinkability at credential layer.
// ─────────────────────────────────────────────────────────────────────────────
export async function buildCommitment(blake3RootHex, sealNonceHex) {
  const root  = hexToBytes(blake3RootHex);   // 32 bytes
  const nonce = hexToBytes(sealNonceHex);    // 16 bytes
  const input = new Uint8Array(root.length + nonce.length);
  input.set(root, 0);
  input.set(nonce, root.length);
  const hashBuf = await crypto.subtle.digest('SHA-256', input);
  return new Uint8Array(hashBuf);            // 32 bytes
}

// ─────────────────────────────────────────────────────────────────────────────
// submitToCalendars(commitment32)
// POSTs the 32-byte commitment to both calendars concurrently.
// Returns { alice: Uint8Array | null, bob: Uint8Array | null, ok: boolean }
// ok = true if at least one calendar responded with a valid body.
// Each calendar body is an opaque binary blob (the timestamp operations chain
// terminated by a PendingAttestation). The Worker stores it encrypted — it
// never interprets the bytes.
// ─────────────────────────────────────────────────────────────────────────────
export async function submitToCalendars(commitment32) {
  async function hitCalendar(url) {
    try {
      const res = await fetch(`${url}/digest`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body:    commitment32,
      });
      if (!res.ok) {
        console.warn(`OTS calendar ${url} returned ${res.status}`);
        return null;
      }
      const buf = await res.arrayBuffer();
      if (buf.byteLength === 0) {
        console.warn(`OTS calendar ${url} returned empty body`);
        return null;
      }
      return new Uint8Array(buf);
    } catch (e) {
      console.warn(`OTS calendar ${url} fetch failed:`, e);
      return null;
    }
  }

  const [alice, bob] = await Promise.all([
    hitCalendar(CALENDAR_ALICE),
    hitCalendar(CALENDAR_BOB),
  ]);

  return { alice, bob, ok: alice !== null || bob !== null };
}

// ─────────────────────────────────────────────────────────────────────────────
// buildPendingOts(commitment32, aliceBody, bobBody)
// Assembles a valid pending .ots file from the two calendar response bodies.
// At least one body must be non-null (caller checks submitToCalendars().ok first).
//
// Wire format:
//   OTS_MAGIC (31 bytes)
//   version   (1 byte = 0x01)
//   op_sha256 (1 byte = 0x08)  ← file_hash_op: the timestamp operates on SHA256(file)
//   digest    (32 bytes)       ← our commitment (already the "hashed file")
//   body_alice (if present)    ← calendar response, self-delimiting
//   body_bob   (if present)    ← calendar response, self-delimiting
//
// The two calendar bodies concatenate cleanly — each is self-delimiting via
// the PendingAttestation length varint. Confirmed from live wire inspection.
// Legend reads standard OTS format — no custom deserialiser required.
// ─────────────────────────────────────────────────────────────────────────────
export function buildPendingOts(commitment32, aliceBody, bobBody) {
  const bodies = [];
  if (aliceBody) bodies.push(aliceBody);
  if (bobBody)   bodies.push(bobBody);
  if (bodies.length === 0) throw new Error('buildPendingOts: no calendar bodies');

  // Total length: magic(31) + version(1) + op(1) + digest(32) + sum(bodies)
  const totalLen = 33 + commitment32.length + bodies.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(totalLen);
  let offset = 0;

  out.set(OTS_MAGIC, offset);          offset += OTS_MAGIC.length;      // 31
  out[offset++] = OTS_MAJOR_VERSION;                                     // 1
  out[offset++] = OTS_OP_SHA256;                                         // 1
  out.set(commitment32, offset);       offset += commitment32.length;    // 32
  for (const body of bodies) {
    out.set(body, offset);             offset += body.length;
  }

  return out; // Uint8Array, ~307–614 bytes depending on calendar availability
}

// ─────────────────────────────────────────────────────────────────────────────
// encryptOts(otsBytes, aesKey)
// Encrypts the .ots blob under AES-GCM-256 using the transfer's session key.
// AAD = SEAL_AAD (4 bytes "seal") — distinct from chunk AAD (uint32 index).
// Returns { iv: Uint8Array (12 bytes), ciphertext: Uint8Array }
// ─────────────────────────────────────────────────────────────────────────────
async function encryptOts(otsBytes, aesKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: SEAL_AAD },
    aesKey,
    otsBytes
  );
  return { iv, ciphertext: new Uint8Array(cipherBuf) };
}

// ─────────────────────────────────────────────────────────────────────────────
// decryptOts(encryptedBlob, aesKey)
// encryptedBlob: Uint8Array = iv(12) ‖ ciphertext
// Returns Uint8Array (plaintext .ots bytes) or throws on auth failure.
// Called by the download path when timestamp_state === 'pending' | 'complete'.
// ─────────────────────────────────────────────────────────────────────────────
export async function decryptOts(encryptedBlob, aesKey) {
  if (encryptedBlob.length < 13) throw new Error('decryptOts: blob too short');
  const iv         = encryptedBlob.slice(0, 12);
  const ciphertext = encryptedBlob.slice(12);
  const plaintextBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: SEAL_AAD },
    aesKey,
    ciphertext
  );
  return new Uint8Array(plaintextBuf);
}

// ─────────────────────────────────────────────────────────────────────────────
// submitTimestamp(uuid, otsBytes, aesKey)
// Encrypts the .ots blob and POSTs it to the Worker relay endpoint.
// Worker stores it as {uuid}/date-seal.ots.enc and sets timestamp_state: 'pending'.
// Worker never sees plaintext — it receives iv ‖ ciphertext as an opaque blob.
//
// Returns { ok: true } or { ok: false, error: string }
// Never throws — errors are returned as { ok: false, error }.
// ─────────────────────────────────────────────────────────────────────────────
export async function submitTimestamp(uuid, otsBytes, aesKey) {
  let encrypted;
  try {
    encrypted = await encryptOts(otsBytes, aesKey);
  } catch (e) {
    return { ok: false, error: `OTS encrypt failed: ${e.message}` };
  }

  // Wire format: iv(12) ‖ ciphertext — single binary blob
  const blob = new Uint8Array(12 + encrypted.ciphertext.length);
  blob.set(encrypted.iv, 0);
  blob.set(encrypted.ciphertext, 12);

  try {
    const res = await fetch(`${WORKER_URL}/timestamp/submit`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Transfer-UUID': uuid,
      },
      body: blob,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `Worker ${res.status}: ${text.slice(0, 100)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Network error: ${e.message}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// runPermanentRecord(uuid, blake3RootHex, sealNonceHex, aesKey)
// Full pipeline: commitment → calendar submit → .ots assembly → encrypt → Worker relay.
// Called from share.js upload completion when permanent-record toggle is on.
//
// Returns { ok: true } or { ok: false, error: string }
// Fire-and-forget safe — upload is already complete before this runs.
// On failure: timestamp_state stays 'none'; sender can retry via dashboard (TH-2).
// ─────────────────────────────────────────────────────────────────────────────
export async function runPermanentRecord(uuid, blake3RootHex, sealNonceHex, aesKey) {
  // Step 1: Build 32-byte commitment = SHA-256(blake3_root ‖ seal_nonce)
  let commitment32;
  try {
    commitment32 = await buildCommitment(blake3RootHex, sealNonceHex);
  } catch (e) {
    return { ok: false, error: `commitment failed: ${e.message}` };
  }

  // Step 2: Submit to both calendars concurrently
  const { alice, bob, ok: calOk } = await submitToCalendars(commitment32);
  if (!calOk) {
    return { ok: false, error: 'Both OTS calendars failed — timestamp not recorded' };
  }

  // Step 3: Assemble pending .ots file
  let otsBytes;
  try {
    otsBytes = buildPendingOts(commitment32, alice, bob);
  } catch (e) {
    return { ok: false, error: `OTS assembly failed: ${e.message}` };
  }

  // Step 4: Encrypt and relay to Worker
  return submitTimestamp(uuid, otsBytes, aesKey);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (local — not exported)
// ─────────────────────────────────────────────────────────────────────────────
function bufToHex(buf) {
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return out;
}
