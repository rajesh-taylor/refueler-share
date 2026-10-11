// B.6 relay behaviour test (Research-Review-3). Throwaway keys, encrypted junk content.
// Usage: node b6.mjs publish   |   node b6.mjs check <label>
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(new URL('./package.json', import.meta.url));
const { generateSecretKey, getPublicKey, finalizeEvent } = require('nostr-tools/pure');
const nip44 = require('nostr-tools/nip44');
const nip59 = require('nostr-tools/nip59');

const RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://inbox.nostr.wine',
  'wss://auth.nostr1.com', 'wss://relay.westernbtc.com', 'wss://relay.ditto.pub', 'wss://nostr.mom', 'wss://offchain.pub'];
const STATE = new URL('./state.json', import.meta.url);
const hex = (b) => Buffer.from(b).toString('hex');
const unhex = (h) => Uint8Array.from(Buffer.from(h, 'hex'));
const now = () => Math.floor(Date.now() / 1000);

function wrap(rPub, expiration) {
  const A = generateSecretKey(), W = generateSecretKey();
  const rumor = nip59.createRumor({ kind: 14, content: 'relay behaviour test, please ignore', tags: [['p', rPub]] }, A);
  const seal = nip59.createSeal(rumor, A, rPub);
  const tags = [['p', rPub]];
  if (expiration) tags.push(['expiration', String(expiration)]);
  return finalizeEvent({ kind: 1059, created_at: now() - Math.floor(Math.random() * 3600), tags,
    content: nip44.encrypt(JSON.stringify(seal), nip44.getConversationKey(W, rPub)) }, W);
}

class Conn {
  constructor(url) { this.url = url; this.challenge = null; this.waiters = []; this.log = []; }
  open() {
    return new Promise((res) => {
      const t = setTimeout(() => res(false), 10000);
      try { this.ws = new WebSocket(this.url); } catch (e) { clearTimeout(t); return res(false); }
      this.ws.onopen = () => { clearTimeout(t); res(true); };
      this.ws.onerror = () => { clearTimeout(t); res(false); };
      this.ws.onmessage = (m) => {
        let msg; try { msg = JSON.parse(m.data); } catch { return; }
        if (msg[0] === 'AUTH') this.challenge = msg[1];
        this.waiters.forEach((w) => w(msg));
      };
    });
  }
  wait(pred, ms = 8000) {
    return new Promise((res) => {
      const w = (msg) => { const r = pred(msg); if (r !== undefined) { done(r); } };
      const done = (r) => { clearTimeout(t); this.waiters = this.waiters.filter((x) => x !== w); res(r); };
      const t = setTimeout(() => done({ timeout: true }), ms);
      this.waiters.push(w);
    });
  }
  async publish(ev) {
    const p = this.wait((m) => (m[0] === 'OK' && m[1] === ev.id ? { ok: m[2], msg: m[3] } : undefined));
    this.ws.send(JSON.stringify(['EVENT', ev]));
    return p;
  }
  async req(filter) {
    const sub = 's' + Math.random().toString(36).slice(2, 8), ids = [];
    const p = this.wait((m) => {
      if (m[1] !== sub) return undefined;
      if (m[0] === 'EVENT') { ids.push(m[2].id); return undefined; }
      if (m[0] === 'EOSE') return { ids };
      if (m[0] === 'CLOSED') return { ids, closed: m[2] };
    });
    this.ws.send(JSON.stringify(['REQ', sub, filter]));
    const r = await p;
    this.ws.send(JSON.stringify(['CLOSE', sub]));
    return r;
  }
  async auth(sk) {
    if (!this.challenge) { await new Promise((r) => setTimeout(r, 1500)); }
    if (!this.challenge) return { noChallenge: true };
    const ev = finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', this.url], ['challenge', this.challenge]], content: '' }, sk);
    const p = this.wait((m) => (m[0] === 'OK' && m[1] === ev.id ? { ok: m[2], msg: m[3] } : undefined));
    this.ws.send(JSON.stringify(['AUTH', ev]));
    return p;
  }
  close() { try { this.ws.close(); } catch {} }
}

const short = (r) => (r.timeout ? 'timeout' : r.ok === undefined ? JSON.stringify(r) : `${r.ok ? 'OK' : 'NO'}${r.msg ? ' ' + r.msg : ''}`);

async function publish() {
  const r1 = generateSecretKey(), r2 = generateSecretKey();
  const R1 = getPublicKey(r1), R2 = getPublicKey(r2);
  const ev = { a: wrap(R1, now() + 120), b: wrap(R1), c: wrap(R1, now() - 60), e: wrap(R1), d: wrap(R2) };
  const out = { t0: now(), r1: hex(r1), r2: hex(r2), ids: Object.fromEntries(Object.entries(ev).map(([k, v]) => [k, v.id])), relays: {} };
  await Promise.all(RELAYS.map(async (url) => {
    const c = new Conn(url), rec = (out.relays[url] = {});
    if (!(await c.open())) { rec.connect = 'FAILED'; return; }
    for (const k of ['a', 'b', 'c', 'e', 'd']) rec['pub_' + k] = short(await c.publish(ev[k]));
    const q = await c.req({ kinds: [1059], '#p': [R1, R2] });
    rec.read_noauth = q.closed ? `CLOSED ${q.closed} (${q.ids.length})` : labels(q.ids, out.ids);
    const a = await c.auth(r1);
    rec.auth_r1 = short(a);
    if (a.ok) { const q2 = await c.req({ kinds: [1059], '#p': [R1] }); rec.read_auth_r1 = q2.closed ? `CLOSED ${q2.closed}` : labels(q2.ids, out.ids); }
    const del = finalizeEvent({ kind: 5, created_at: now(), tags: [['e', ev.b.id], ['k', '1059']], content: '' }, r1);
    rec.nip09_by_p = short(await c.publish(del));
    if (!a.ok) { const a2 = await c.auth(r2); rec.auth_r2 = short(a2); } else { rec.auth_r2 = short(await c.auth(r2)); }
    const vanish = finalizeEvent({ kind: 62, created_at: now(), tags: [['relay', url]], content: 'test' }, r2);
    rec.nip62 = short(await c.publish(vanish));
    c.close();
  }));
  fs.writeFileSync(STATE, JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out.relays, null, 1));
}

function labels(ids, map) {
  const inv = Object.fromEntries(Object.entries(map).map(([k, v]) => [v, k]));
  return ids.map((i) => inv[i] || '?').sort().join('') || '(none)';
}

async function check(label) {
  const s = JSON.parse(fs.readFileSync(STATE));
  const ids = Object.values(s.ids), res = {};
  await Promise.all(RELAYS.map(async (url) => {
    const c = new Conn(url), rec = (res[url] = {});
    if (!(await c.open())) { rec.connect = 'FAILED'; return; }
    const q = await c.req({ ids });
    rec.by_id_noauth = q.closed ? `CLOSED ${q.closed} (${labels(q.ids, s.ids)})` : labels(q.ids, s.ids);
    const a = await c.auth(unhex(s.r1));
    if (a.ok) { const q2 = await c.req({ ids }); rec.by_id_auth_r1 = q2.closed ? `CLOSED ${q2.closed}` : labels(q2.ids, s.ids); }
    else rec.auth = short(a);
    c.close();
  }));
  console.log(`check ${label} at t0+${now() - s.t0}s`);
  console.log(JSON.stringify(res, null, 1));
}

const [, , cmd, label] = process.argv;
if (cmd === 'publish') await publish(); else await check(label || 'now');
process.exit(0);
