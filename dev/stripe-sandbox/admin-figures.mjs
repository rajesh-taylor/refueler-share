// node dev/stripe-sandbox/admin-figures.mjs — the subscriber figures Navy Office
// shows, read from the local Worker (Navy Office itself only talks to production).
// Needs a sandbox-only ADMIN_KEY in .dev.vars.
import { env, WORKER_PORT } from './lib.mjs';
const r = await fetch(`http://localhost:${WORKER_PORT}/admin/metrics`, { headers: { 'X-Admin-Key': env.ADMIN_KEY } });
const j = await r.json();
console.log(r.status, { subscribers_by_tier: j.subscribers_by_tier, paid_total: j.paid_total, mrr_gbp: j.mrr_gbp, cancelled_mtd: j.cancelled_mtd });
