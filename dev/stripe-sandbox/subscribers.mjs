// node dev/stripe-sandbox/subscribers.mjs — the sandbox subscribers table.
import { rest } from './lib.mjs';
console.table(await rest('subscribers?select=email,tier,status,current_period_end,cancelled_at&order=created_at'));
