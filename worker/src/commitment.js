// ─────────────────────────────────────────────────────────────────────────────
// commitment.js — transfer commitment (S42c binding, keyed at Cred-Fix-1).
//
// commitment = HMAC-SHA256(COMMITMENT_KEY,
//                utf8("refueler.share.commit.v1") ‖ 0x00 ‖ uuid (16 raw bytes)
//                ‖ expiry window (uint64 BE) ‖ utf8(tier))
// → 64-char lowercase hex. Same wire shape as before; clients echo it unchanged.
//
// Encoding follows the B12-SR rule: tag ‖ 0x00 ‖ fixed-length binary fields,
// variable-length field (tier) last.
//
// Only the Worker holds COMMITMENT_KEY, so only the Worker can mint a
// (uuid, commitment) pair. Missing key → throw; callers fail closed. There is
// no unkeyed fallback.
// ─────────────────────────────────────────────────────────────────────────────

export const COMMITMENT_TAG = 'refueler.share.commit.v1';

const ENC = new TextEncoder();

function uuidBytes(uuid) {
  const hex = String(uuid).replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error('computeCommitment: invalid uuid');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function commitmentMessage(uuid, tier, expiryWindow) {
  const tag    = ENC.encode(COMMITMENT_TAG);
  const tierB  = ENC.encode(String(tier));
  const msg    = new Uint8Array(tag.length + 1 + 16 + 8 + tierB.length);
  let o = 0;
  msg.set(tag, o);             o += tag.length;
  msg[o] = 0x00;               o += 1;
  msg.set(uuidBytes(uuid), o); o += 16;
  new DataView(msg.buffer).setBigUint64(o, BigInt(expiryWindow), false); o += 8;
  msg.set(tierB, o);
  return msg;
}

export async function computeCommitment(key, uuid, tier, expiryWindow) {
  if (!key) throw new Error('computeCommitment: COMMITMENT_KEY not configured');
  const k = await crypto.subtle.importKey(
    'raw', ENC.encode(String(key)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', k, commitmentMessage(uuid, tier, expiryWindow));
  return Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('');
}
