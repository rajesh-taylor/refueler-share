// node dev/stripe-sandbox/citizen-upload.mjs <paid email> <cancelled email>
// Citizen initiate checks against the local Worker: cap, 90-day ceiling,
// commitment, and that an unpaid or signed-out sender gets the free limits.
// Needs SHARE_SEAL_KEY_1 and placeholder CF_ACCOUNT_ID / R2_S3_* in .dev.vars
// (URLs are signed but never used — no bytes reach R2).
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { worker } from './lib.mjs';
import { signIn } from './signin.mjs';

const require = createRequire(new URL('../../worker/package.json', import.meta.url));
const { secp256k1 } = await import(require.resolve('@noble/curves/secp256k1.js'));
const Point = secp256k1.Point;
const GiB = 1024 ** 3, CHUNK = 33_554_432, DAY = 86400;
const sha256 = b => crypto.createHash('sha256').update(b).digest();
const DST = Buffer.from('Secp256k1_HashToCurve_Cashu_');

function hashToCurve(msg) {
  const m = sha256(Buffer.concat([DST, msg]));
  for (let c = 0; ; c++) {
    const cb = Buffer.alloc(4); cb.writeUInt32LE(c);
    try { return Point.fromHex(Buffer.concat([Buffer.from([2]), sha256(Buffer.concat([m, cb]))]).toString('hex')); } catch {}
  }
}

async function credential(tier) {
  const secret = crypto.randomBytes(32).toString('hex');
  const r = BigInt(`0x${crypto.randomBytes(32).toString('hex')}`) % Point.Fn.ORDER;
  const B_ = hashToCurve(Buffer.from(secret)).add(Point.BASE.multiply(r));
  const res = await worker('POST', '/credential/issue', { 'Content-Type': 'application/json' },
    JSON.stringify({ blinded_message: B_.toHex(true), tier, turnstile_token: `sandbox.${crypto.randomUUID()}` }));
  if (res.status !== 200) throw new Error(`issue ${res.status}`);
  const b = res.body;
  const C = Point.fromHex(b.signed_point).subtract(Point.fromHex(b.mint_pubkey).multiply(r)).toHex(true);
  return { ...b, proof: JSON.stringify({ id: b.keyset_id, amount: 1, secret, C }) };
}

async function initiate({ bytes, days, sess, tierHeader }) {
  const c = await credential('citizen');
  const h = {
    'X-Transfer-UUID': c.uuid, 'X-Cashu-Credential': c.proof, 'X-Credential-Commitment': c.commitment,
    'X-Issued-Tier': tierHeader ?? c.issued_tier, 'X-Total-Chunks': String(Math.ceil(bytes / CHUNK)),
    'X-Total-Bytes': String(bytes), 'X-Expiry-Timestamp': String(Math.floor(Date.now() / 1000 + days * DAY)),
    'X-Blake3-Root': crypto.randomBytes(32).toString('hex'),
  };
  if (sess) { h.Cookie = sess.cookie; h['X-CSRF'] = sess.csrf; }
  const r = await worker('POST', '/upload/initiate', h);
  return `${r.status}  ${typeof r.body === 'object' ? (r.body.error ?? 'accepted') : ''}`;
}

const [paidEmail, cancelledEmail] = process.argv.slice(2);
if (!paidEmail || !cancelledEmail) throw new Error('usage: citizen-upload.mjs <paid email> <cancelled email>');
const paid = await signIn(paidEmail), cancelled = await signIn(cancelledEmail);
const cases = [
  ['paid, 50 GiB, 89 days                 (200)', { bytes: 50 * GiB, days: 89, sess: paid }],
  ['paid, 100 GiB more                    (402 full)', { bytes: 100 * GiB, days: 30, sess: paid }],
  ['paid, 101 GiB                         (413)', { bytes: 101 * GiB, days: 30, sess: paid }],
  ['paid, 91 days                         (400)', { bytes: GiB, days: 91, sess: paid }],
  ['paid, tier header changed             (401)', { bytes: GiB, days: 5, sess: paid, tierHeader: 'free' }],
  ['cancelled, 50 GiB, 30 days            (400, free)', { bytes: 50 * GiB, days: 30, sess: cancelled }],
  ['signed out, 1 GiB, 30 days            (400, free)', { bytes: GiB, days: 30, sess: null }],
];
for (const [name, c] of cases) console.log(name.padEnd(52), await initiate(c).catch(e => `ERR ${e.message}`));
