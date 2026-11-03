// dev/supabase-split/copy.test.mjs — Supabase-Split-1. A small PostgREST in memory.
//   node --test /Users/rajeshtaylor/Documents/refueler-share/dev/supabase-split/copy.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { TABLES, OLD_REF, Stop, connect, copy, digest, readAll, refusal, verify } from './copy.mjs';

const NEW_REF = 'n'.repeat(20);
const EMAIL = 'someone@example.com';

function world({ held = true, deniedOnNew = ['api_keys', 'api_credit_pools'], bearerRejectedOnNew = false } = {}) {
  const db = { [OLD_REF]: {}, [NEW_REF]: {} };
  for (const t of TABLES) { db[OLD_REF][t.name] = []; db[NEW_REF][t.name] = []; }
  db[OLD_REF].subscribers = [{ stripe_customer_id: 'cus_1', email: EMAIL, tier: 'citizen', status: 'inactive' }];
  db[OLD_REF].spent_tokens = Array.from({ length: 2500 }, (_, i) => ({ serial: `s${i}`, melted_at: '2026-10-28T18:47:08.625498+00:00' }));
  db[OLD_REF].quota_accounts = [{ quota_ref: '\\xabcd', kind: 'registered' }];
  db[OLD_REF].report_register = [{ case_ref: 'T-2026-012', training: true }];
  db[OLD_REF].report_events = [24, 25, 26].map((id) => ({ id, case_ref: 'T-2026-012', fields: ['category'] }));
  db[OLD_REF].report_counters = [{ prefix: 'T', year: 2026, last: 12 }];
  const writes = [];

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    if (url.hostname === 'api.share.refueler.io') return new Response('{}', { status: held ? 503 : 401 });
    const ref = url.hostname.split('.')[0];
    const path = url.pathname.replace('/rest/v1/', '');
    const h = init.headers ?? {};
    if (path === 'rpc/quota_now') {
      if (ref === NEW_REF && bearerRejectedOnNew && h.Authorization) return new Response('{}', { status: 401 });
      return new Response('123', { status: 200 });
    }
    if (ref === NEW_REF && deniedOnNew.includes(path)) return new Response(JSON.stringify({ code: '42501', message: 'denied' }), { status: 401 });
    const rows = db[ref][path];
    if (init.method === 'POST') {
      writes.push({ ref, path });
      const incoming = JSON.parse(init.body);
      const list = Array.isArray(incoming) ? incoming : [incoming];
      if (path === 'spent_tokens' && list.some((r) => rows.some((x) => x.serial === r.serial))) {
        return new Response(JSON.stringify({ code: '23505', message: `Key (serial)=(${list[0].serial}) exists` }), { status: 409 });
      }
      let next = 1;
      for (const r of list) rows.push('id' in r || path !== 'report_events' ? r : { id: next++, ...r });
      return new Response(null, { status: 201 });
    }
    const limit = Number(url.searchParams.get('limit'));
    const offset = Number(url.searchParams.get('offset') ?? 0);
    return new Response(JSON.stringify(rows.slice(offset, offset + limit)), { status: 200 });
  };
  return { db, writes };
}

const both = async () => [await connect(OLD_REF, 'old', 'old'), await connect(NEW_REF, 'new', 'new')];

test('copies every table, past one page, and everything matches', async () => {
  const { db } = world();
  const [o, n] = await both();
  const report = await copy(o, n);
  assert.equal(db[NEW_REF].spent_tokens.length, 2500);
  assert.equal(db[NEW_REF].report_counters[0].last, 12);
  assert.ok(report.every((r) => r.match !== 'NO'));
  assert.equal(report.find((r) => r.table === 'api_keys').match, 'empty, RPCs only');
});

test('never writes the shared project', async () => {
  const { writes } = world();
  const [o, n] = await both();
  await copy(o, n);
  await refusal(o, n);
  assert.ok(writes.length > 0);
  assert.ok(writes.every((w) => w.ref === NEW_REF));
});

test('refuses to copy unless the live Worker is held', async () => {
  const { writes } = world({ held: false });
  const [o, n] = await both();
  await assert.rejects(copy(o, n), (e) => e instanceof Stop && /not held/.test(e.message));
  assert.equal(writes.length, 0);
});

test('identity ids are not sent; report order survives', async () => {
  const { db } = world();
  const [o, n] = await both();
  await copy(o, n);
  assert.deepEqual(db[NEW_REF].report_events.map((r) => r.id), [1, 2, 3]);
  assert.equal(digest(db[OLD_REF].report_events, 'id'), digest(db[NEW_REF].report_events, 'id'));
});

test('a re-run skips what already matches', async () => {
  const { writes } = world();
  const [o, n] = await both();
  await copy(o, n);
  const first = writes.length;
  await copy(o, n);
  assert.equal(writes.length, first);
});

test('a difference stops the copy, and verify reports it', async () => {
  const { db } = world();
  db[NEW_REF].subscribers = [{ stripe_customer_id: 'cus_other' }];
  const [o, n] = await both();
  const log = console.log; console.log = () => {};
  await assert.rejects(copy(o, n), /subscribers: the two sides differ/);
  console.log = log;
  assert.equal((await verify(o, n)).find((r) => r.table === 'subscribers').match, 'NO');
});

test('rows on a table the new key cannot read stop the run', async () => {
  const { db } = world();
  db[OLD_REF].api_keys = [{ key_hash: '\\x00' }];
  const [o, n] = await both();
  await assert.rejects(copy(o, n), /no table access/);
});

test('a spent serial is refused on the new side', async () => {
  world();
  const [o, n] = await both();
  await copy(o, n);
  assert.equal(await refusal(o, n), 409);
});

test('falls back to apikey only when a project rejects Bearer', async () => {
  world({ bearerRejectedOnNew: true });
  const db = await connect(NEW_REF, 'new', 'new');
  assert.equal(db.form, 'apikey only');
  assert.equal(db.headers.Authorization, undefined);
});

test('errors carry status and code, never the row', async () => {
  const { db } = world();
  const [o, n] = await both();
  db[NEW_REF].subscribers = [];
  globalThis.fetch = ((inner) => async (input, init) => {
    if (init?.method === 'POST' && String(input).includes('subscribers')) {
      return new Response(JSON.stringify({ code: '23514', message: `row ${EMAIL} fails`, details: EMAIL }), { status: 400 });
    }
    return inner(input, init);
  })(globalThis.fetch);
  await assert.rejects(copy(o, n), (e) => {
    assert.ok(!e.message.includes(EMAIL));
    assert.match(e.message, /400 \(23514\)/);
    return true;
  });
});

test('readAll reports denied only for the permission code', async () => {
  world();
  const n = await connect(NEW_REF, 'new', 'new');
  assert.deepEqual(await readAll(n, TABLES.find((t) => t.name === 'api_keys')), { denied: true });
});
