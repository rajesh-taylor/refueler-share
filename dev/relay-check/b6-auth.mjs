// B.6 part 2: AUTH-gated relay. Publisher logs in with a one-time key, then reads as stranger / recipient.
import { createRequire } from 'node:module';
const require = createRequire(new URL('./package.json', import.meta.url));
const { generateSecretKey, getPublicKey, finalizeEvent } = require('nostr-tools/pure');
const nip44 = require('nostr-tools/nip44');
const nip59 = require('nostr-tools/nip59');
const url = process.argv[2] || 'wss://auth.nostr1.com';
const now = () => Math.floor(Date.now() / 1000);

function conn() {
  return new Promise((res) => {
    const ws = new WebSocket(url); const c = { ws, challenge: null, w: [] };
    ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg[0] === 'AUTH') c.challenge = msg[1]; c.w.forEach((f) => f(msg)); };
    ws.onopen = () => setTimeout(() => res(c), 1500);
    ws.onerror = () => res(null);
  });
}
const wait = (c, pred, ms = 8000) => new Promise((res) => {
  const f = (m) => { const r = pred(m); if (r !== undefined) { clearTimeout(t); c.w = c.w.filter((x) => x !== f); res(r); } };
  const t = setTimeout(() => { c.w = c.w.filter((x) => x !== f); res('timeout'); }, ms); c.w.push(f);
});
async function auth(c, sk) {
  if (!c.challenge) return 'no challenge';
  const ev = finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', url], ['challenge', c.challenge]], content: '' }, sk);
  const p = wait(c, (m) => (m[0] === 'OK' && m[1] === ev.id ? `${m[2]} ${m[3]}` : undefined)); c.ws.send(JSON.stringify(['AUTH', ev])); return p;
}
async function pub(c, ev) { const p = wait(c, (m) => (m[0] === 'OK' && m[1] === ev.id ? `${m[2]} ${m[3]}` : undefined)); c.ws.send(JSON.stringify(['EVENT', ev])); return p; }
async function req(c, f) {
  const s = 'q' + Math.random().toString(36).slice(2, 7); const ids = [];
  const p = wait(c, (m) => (m[1] !== s ? undefined : m[0] === 'EVENT' ? (ids.push(m[2].id), undefined) : m[0] === 'EOSE' ? `${ids.length} events` : `CLOSED ${m[2]} (${ids.length})`));
  c.ws.send(JSON.stringify(['REQ', s, f])); return p;
}

const r = generateSecretKey(), R = getPublicKey(r), A = generateSecretKey(), W = generateSecretKey();
const seal = nip59.createSeal(nip59.createRumor({ kind: 14, content: 'relay behaviour test, please ignore', tags: [['p', R]] }, A), A, R);
const wrapEv = finalizeEvent({ kind: 1059, created_at: now() - 600, tags: [['p', R], ['expiration', String(now() + 3600)]],
  content: nip44.encrypt(JSON.stringify(seal), nip44.getConversationKey(W, R)) }, W);

const c1 = await conn(); if (!c1) { console.log('connect failed'); process.exit(0); }
console.log('publisher AUTH as one-time W:', await auth(c1, W));
console.log('publish wrap:', await pub(c1, wrapEv));
c1.ws.close();
const c2 = await conn();
console.log('read, no AUTH:', await req(c2, { kinds: [1059], '#p': [R] }));
console.log('stranger AUTH:', await auth(c2, generateSecretKey()));
console.log('read as stranger:', await req(c2, { kinds: [1059], '#p': [R] }));
console.log('read by id as stranger:', await req(c2, { ids: [wrapEv.id] }));
c2.ws.close();
const c3 = await conn();
console.log('recipient AUTH:', await auth(c3, r));
console.log('read as recipient:', await req(c3, { kinds: [1059], '#p': [R] }));
const del = finalizeEvent({ kind: 5, created_at: now(), tags: [['e', wrapEv.id], ['k', '1059']], content: '' }, r);
console.log('NIP-09 by recipient:', await pub(c3, del));
await new Promise((x) => setTimeout(x, 2000));
console.log('read after NIP-09:', await req(c3, { kinds: [1059], '#p': [R] }));
c3.ws.close();
process.exit(0);
