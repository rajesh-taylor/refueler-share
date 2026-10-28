// node dev/stripe-sandbox/webhook-checks.mjs <email>
// Signed events straight to the local Worker: a subscription Stripe doesn't
// have (re-fetch fails → 500, so Stripe retries), a 10-minute-old event (401),
// and the given customer's real subscription (200).
import crypto from 'node:crypto';
import { env, stripe, worker } from './lib.mjs';

const email = process.argv[2];
if (!email) throw new Error('usage: webhook-checks.mjs <email of a sandbox customer>');

async function send(subId, ageSeconds = 0) {
  const body = JSON.stringify({ id: `evt_local_${Date.now()}`, type: 'customer.subscription.updated', data: { object: { id: subId } } });
  const t = Math.floor(Date.now() / 1000) - ageSeconds;
  const v1 = crypto.createHmac('sha256', env.STRIPE_WEBHOOK_SECRET).update(`${t}.${body}`).digest('hex');
  return (await worker('POST', '/webhook/stripe', { 'Stripe-Signature': `t=${t},v1=${v1}`, 'Content-Type': 'application/json' }, body)).status;
}

const subs = await stripe('GET', 'subscriptions?status=all&limit=100&expand[]=data.customer');
const sub = subs.data.find(s => s.customer?.email === email);
if (!sub) throw new Error('no subscription for that email');
console.log('unknown subscription (expect 500):', await send('sub_doesnotexist000'));
console.log('10-minute-old event (expect 401): ', await send(sub.id, 600));
console.log('real subscription  (expect 200): ', await send(sub.id));
