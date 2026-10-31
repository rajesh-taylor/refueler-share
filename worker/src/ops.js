// ─────────────────────────────────────────────────────────────────────────────
// ops.js — alerting without tracking anyone (Ops-Alerts-1 · 1 Nov 2026, row 30b)
//
// Rule: watch our own machinery, never users. What is kept is seven integers per
// hour — how many times something worked or failed — in one STATUS_KV record
// (`ops:h:<hour>`, 3 days). Never an IP, transfer ID, email, customer ID or payload.
//
// The hourly cron (:15) adds up the last 24 hours and checks RULES. Each problem
// sends ONE plain email per UTC day to OPS_ALERT_TO (a secret, so the address stays
// out of the repo), from OPS_MAIL_FROM over the same Email Sending binding as the
// sign-in mail: counts and route name only. The day's mark is written only after a
// send succeeds, so a failed alert is retried the next hour. The first run after a
// deploy sends one "alerts are on" email, which proves the route.
//
// Counts are read-modify-write on KV: two writes in the same second can lose one.
// That is fine — every rule asks "any?" or "at least", never an exact figure.
// Outside Cloudflare, .github/workflows/heartbeat.yml calls GET /health hourly.
// ─────────────────────────────────────────────────────────────────────────────

export const COUNTERS = [
  'webhook_ok', 'webhook_sig_fail', 'webhook_error',
  'sweep_ok', 'sweep_fail', 'r2_error', 'email_send_fail',
];

const HOUR = 3600;
const DAY = 86400;
const KEEP_SECONDS = 3 * DAY;
export const SWEEP_STALE_SECONDS = 26 * HOUR; // the sweep runs at 03:30 daily
export const R2_ERROR_THRESHOLD = 10;
const SWEEP_LAST_OK = 'ops:sweep_last_ok';
const HELLO = 'ops:hello';

const nowS = () => Math.floor(Date.now() / 1000);
const hourKey = (t) => `ops:h:${Math.floor(t / HOUR)}`;

/** Adds n to one counter in this hour's record. Never throws. */
export async function count(env, name, n = 1, now = nowS()) {
  if (!env?.STATUS_KV || !COUNTERS.includes(name)) return;
  try {
    const key = hourKey(now);
    const rec = (await env.STATUS_KV.get(key, { type: 'json' })) ?? {};
    rec[name] = (Number.isInteger(rec[name]) ? rec[name] : 0) + n;
    await env.STATUS_KV.put(key, JSON.stringify(rec), { expirationTtl: KEEP_SECONDS });
  } catch {
    console.error('ops: count failed');
  }
}

/** Stripe webhook response status → its counter. */
export function webhookOutcome(status) {
  if (status === 200) return 'webhook_ok';
  if (status === 401) return 'webhook_sig_fail';
  return 'webhook_error';
}

/** The nightly sweep's result, called from scheduled(). */
export async function recordSweep(env, ok, now = nowS()) {
  await count(env, ok ? 'sweep_ok' : 'sweep_fail', 1, now);
  if (ok) await env.STATUS_KV.put(SWEEP_LAST_OK, String(now)).catch(() => {});
}

/**
 * The R2 binding with every thrown or rejected call counted as r2_error.
 * A null from get() is not an error. Results and errors pass through unchanged.
 */
export function countingBucket(bucket, onError) {
  if (!bucket) return bucket;
  return new Proxy(bucket, {
    get(target, prop) {
      const v = Reflect.get(target, prop);
      if (typeof v !== 'function') return v;
      return (...args) => {
        let r;
        try { r = v.apply(target, args); } catch (e) { onError(); throw e; }
        if (r && typeof r.then === 'function') r.then(undefined, () => onError());
        return r;
      };
    },
  });
}

/** Sum of each counter over the 24 hours up to and including now's hour. */
export async function sums(env, now = nowS()) {
  const out = Object.fromEntries(COUNTERS.map(c => [c, 0]));
  const recs = await Promise.all(Array.from({ length: 24 }, (_, i) =>
    env.STATUS_KV.get(hourKey(now - i * HOUR), { type: 'json' }).catch(() => null)));
  for (const rec of recs) {
    for (const c of COUNTERS) if (Number.isInteger(rec?.[c])) out[c] += rec[c];
  }
  return out;
}

// Each rule: when it fires, and the one email it sends. Counts and route only.
export const RULES = [
  {
    id: 'stripe_sig',
    route: 'POST /webhook/stripe',
    fires: (s) => s.webhook_sig_fail > 0 && s.webhook_ok === 0,
    subject: 'Stripe webhooks failing the signature check',
    body: (s) => [
      `${s.webhook_sig_fail} Stripe webhook(s) answered 401 (signature) in the last 24 hours, and none answered 200.`,
      'Check: the endpoint secret in Stripe matches STRIPE_WEBHOOK_SECRET; then send a signed test event.',
    ],
  },
  {
    id: 'webhook_error',
    route: 'POST /webhook/stripe',
    fires: (s) => s.webhook_error > 0,
    subject: 'Stripe webhook handler errors',
    body: (s) => [
      `${s.webhook_error} Stripe webhook(s) answered with an error other than 401 in the last 24 hours (${s.webhook_ok} answered 200).`,
      'Stripe retries for 3 days. Check: Supabase reachable, Stripe API key valid; then resend from the Stripe dashboard.',
    ],
  },
  {
    id: 'sweep',
    route: 'nightly sweep (03:30 UTC cron)',
    fires: (s, x) => s.sweep_fail > 0 || x.sweepStale,
    subject: 'Nightly sweep failed or missed',
    body: (s, x) => [
      `Nightly sweep in the last 24 hours: ${s.sweep_ok} finished, ${s.sweep_fail} failed.`,
      x.sweepStale ? 'No sweep has finished for more than 26 hours.' : '',
      'Check: POST /admin/nightly-sweep (dry run) from Navy Office or Terminal.',
    ].filter(Boolean),
  },
  {
    id: 'email',
    route: 'Cloudflare Email Sending (EMAIL binding)',
    fires: (s) => s.email_send_fail > 0,
    subject: 'Email sending failed',
    body: (s) => [
      `${s.email_send_fail} email send(s) failed in the last 24 hours (sign-in links or these alerts).`,
      'Check: Email Sending for mail.refueler.io in the Cloudflare dashboard.',
    ],
  },
  {
    id: 'r2',
    route: 'R2 bucket binding',
    fires: (s) => s.r2_error >= R2_ERROR_THRESHOLD,
    subject: 'R2 errors',
    body: (s) => [
      `${s.r2_error} R2 call(s) from the Worker failed in the last 24 hours (alert at ${R2_ERROR_THRESHOLD}).`,
      'Check: Cloudflare status page (R2); then a test upload and download.',
    ],
  },
];

const FOOTER = [
  '',
  'One email per problem per day. Counts only: no addresses, transfer IDs or payloads.',
  'Sent by the refueler-share Worker (src/ops.js).',
];

async function sendOps(env, subject, lines, now) {
  if (!env.EMAIL?.send || !env.OPS_ALERT_TO || !env.OPS_MAIL_FROM) {
    console.error('ops: alert route not configured');
    return false;
  }
  try {
    await env.EMAIL.send({
      from: env.OPS_MAIL_FROM,
      to: env.OPS_ALERT_TO,
      subject: `Share: ${subject}`,
      text: [...lines, ...FOOTER].join('\n'),
    });
    return true;
  } catch {
    console.error('ops: alert send failed');
    await count(env, 'email_send_fail', 1, now);
    return false;
  }
}

/** The :15 check. Returns the rule ids that fired and whether each email went. */
export async function runOpsCheck(env, now = nowS()) {
  const kv = env.STATUS_KV;
  const sent = [];

  if (!(await kv.get(HELLO))) {
    const ok = await sendOps(env, 'ops alerts are on', [
      'Ops alerts are on. This is the only email you get while nothing is wrong.',
      `Watched: Stripe webhooks, the nightly sweep, email sending, R2 (${R2_ERROR_THRESHOLD}+ errors a day).`,
    ], now);
    if (ok) await kv.put(HELLO, String(now));
  }

  // First run: no sweep yet, so today is the baseline; a sweep that never runs
  // still alerts 26 hours from now.
  let last = Number(await kv.get(SWEEP_LAST_OK));
  if (!Number.isFinite(last) || last <= 0) {
    last = now;
    await kv.put(SWEEP_LAST_OK, String(now));
  }
  const x = { sweepStale: now - last > SWEEP_STALE_SECONDS };
  const s = await sums(env, now);
  const day = Math.floor(now / DAY);

  for (const rule of RULES) {
    if (!rule.fires(s, x)) continue;
    const mark = `ops:sent:${rule.id}:${day}`;
    if (await kv.get(mark)) { sent.push({ id: rule.id, sent: false, already: true }); continue; }
    const ok = await sendOps(env, rule.subject, [...rule.body(s, x), `Route: ${rule.route}`], now);
    if (ok) await kv.put(mark, '1', { expirationTtl: 2 * DAY });
    sent.push({ id: rule.id, sent: ok });
  }
  return sent;
}
