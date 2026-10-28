// node dev/stripe-sandbox/signin.mjs <email>…
// Signs in each sandbox Citizen against the local Worker and prints the
// /chambers/session tier. Skips the email: the sign-in token goes straight into
// sandbox Supabase (auth_token_issue), then /auth/verify as the link would.
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { rpc, worker } from './lib.mjs';

const require = createRequire(new URL('../../worker/package.json', import.meta.url));
const { blake3 } = await import(require.resolve('@noble/hashes/blake3'));

export async function signIn(email) {
  const p = ((await rpc('auth_principals_for_email', { p_email: email })) ?? []).find(x => x.kind === 'citizen');
  if (!p) return { email, error: 'no citizen principal' };
  const raw = crypto.randomBytes(32);
  await rpc('auth_token_issue', { p_token_hash: Buffer.from(blake3(raw)).toString('hex'), p_kind: p.kind, p_ref: p.ref });
  const v = await worker('POST', '/auth/verify', { 'Content-Type': 'application/json' }, JSON.stringify({ token: raw.toString('base64url') }));
  const cookie = (v.headers['set-cookie'] ?? [])[0]?.split(';')[0];
  const s = await worker('GET', '/chambers/session', cookie ? { Cookie: cookie } : {});
  return { email, verify: v.status, session: s.status, kind: s.body?.kind, tier: s.body?.tier, cookie, csrf: v.body?.csrf };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const e of process.argv.slice(2)) {
    const { cookie, csrf, ...shown } = await signIn(e);
    console.log(shown);
  }
}
