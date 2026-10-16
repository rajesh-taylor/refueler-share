// ─────────────────────────────────────────────────────────────────────────────
// nightly_sweep.js — what happens to a transfer after it ends (Tombstone-30 · 16 Oct 2026)
//
// Runs from the 03:30 cron (index.js) and POST /admin/nightly-sweep. Three jobs:
//
//   1. Leftover record → deleted 30 days after the transfer ended (Privacy-Share-1).
//      The record is exactly { consumed: true, consumed_at } (buildTombstone), it
//      sits alone under {uuid}/, and consumed_at is ≥ 30 days old. Then the
//      manifest goes and the link reads as absent (404); the receiver page says
//      the same "Link closed" for 404 and 410. Nothing reads the record that late:
//      webhook retries and receipts both last 7 days, and a deleted id can't be
//      reused (random UUID, its credential stays spent).
//   2. Expired transfer → purged, past expiry + 48 h grace (Share-Expiry-1 core):
//      the same latch + executor as the admin sweep (sweep_rules.js
//      purgeExpiredTransfer), so only the winner releases quota.
//   3. Residue under a consumed manifest → deleted (orphan sweep rule 1). The
//      leftover record stays (a deletion that died part-way gets it written,
//      dated as it was); job 1 takes it once it is alone and old enough.
//
// Never touched: live transfers, unfinished uploads (the admin sweep's stale rule),
// an in-progress deletion's manifest (consumed but still carrying total_chunks),
// any manifest not exactly the leftover shape, SWEEP_PROTECTED_UUIDS.
//
// Budget (own cron, own invocation): one list() per 1000 objects; at most
// MAX_NIGHTLY_READS manifest reads — candidate leftover records first (filtered
// by size and age from the listing alone), then the rest in a window that moves
// each night; at most ACTION_CAP transfer actions (jobs 2 + 3); job 1 deletes
// in batches of 1000. R2's 92-day expiry rule stays as the backstop.
// ─────────────────────────────────────────────────────────────────────────────

import { requireAdmin, json, err } from './utils.js';
import {
  ACTION_CAP, SWEEP_PROTECTED_UUIDS, toSeconds, isPurgeableExpired,
  deleteKeys, deleteGroups, settleDockEntry, purgeExpiredTransfer,
} from './sweep_rules.js';
import { buildTombstone } from './manifest_tg.js';
import { putManifest } from './manifest.js';

export const TOMBSTONE_KEEP_SECONDS = 30 * 86400;
export const MAX_NIGHTLY_READS      = 500;
const TOMBSTONE_MAX_BYTES = 64; // {"consumed":true,"consumed_at":1800000000} is 42

const UUID_PREFIX_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i;
const CHUNK_RE = /^\d{4}$/;

/** Exactly the record buildTombstone writes — nothing more, nothing less. */
export function isFinalTombstone(m) {
  if (!m || typeof m !== 'object') return false;
  const keys = Object.keys(m);
  return keys.length === 2 && m.consumed === true && Number.isFinite(m.consumed_at);
}

function ae(env, d) {
  if (!env.AE) return;
  try {
    env.AE.writeDataPoint({
      blobs: ['nightly_sweep', '', '', ''],
      doubles: [d.tombstones_deleted, d.expired_purged, d.residue_cleared, d.manifests_read, d.read_capped || d.action_capped ? 1 : 0],
      indexes: ['nightly_sweep'],
    });
  } catch (e) { console.error('nightly_sweep: AE write failed:', e); }
}

/**
 * runNightlySweep(env, nowSeconds, { dryRun }) → summary (counts only, no ids).
 * Throws only if the bucket listing fails.
 */
export async function runNightlySweep(env, nowSeconds, { dryRun = false } = {}) {
  const cutoff = nowSeconds - TOMBSTONE_KEEP_SECONDS;

  // ── List everything once, grouped by transfer id ───────────────────────────
  const byUuid = new Map(); // uuid → { manifest: {size, uploaded} | null, others: string[] }
  let objectsScanned = 0;
  let cursor;
  do {
    const page = await env.BUCKET.list(cursor ? { limit: 1000, cursor } : { limit: 1000 });
    for (const obj of page.objects) {
      objectsScanned++;
      const m = UUID_PREFIX_RE.exec(obj.key);
      if (!m) continue;
      const uuid = m[1].toLowerCase();
      if (!byUuid.has(uuid)) byUuid.set(uuid, { manifest: null, others: [] });
      const e = byUuid.get(uuid);
      if (obj.key === `${m[1]}/manifest.json`) {
        e.manifest = { size: obj.size ?? Infinity, uploaded: toSeconds(obj.uploaded, nowSeconds) };
      } else {
        e.others.push(obj.key);
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  // ── Which manifests are worth a read ───────────────────────────────────────
  // A leftover record is never written before the transfer ended, so an object
  // R2 wrote inside the last 30 days can't hold a consumed_at older than that.
  const tombCandidates = [];
  const others = [];
  for (const [uuid, e] of byUuid) {
    if (!e.manifest || SWEEP_PROTECTED_UUIDS.has(uuid)) continue;
    if (e.others.length === 0) {
      if (e.manifest.size <= TOMBSTONE_MAX_BYTES && e.manifest.uploaded <= cutoff) tombCandidates.push(uuid);
    } else {
      others.push(uuid);
    }
  }
  const room = Math.max(0, MAX_NIGHTLY_READS - tombCandidates.length);
  const start = others.length ? (Math.floor(nowSeconds / 86400) * MAX_NIGHTLY_READS) % others.length : 0;
  const window = [...others.slice(start), ...others.slice(0, start)].slice(0, room);
  const toRead = [...tombCandidates.slice(0, MAX_NIGHTLY_READS), ...window];
  const readCapped = toRead.length < tombCandidates.length + others.length;

  // ── Read and classify ──────────────────────────────────────────────────────
  const tombDue = [];
  const actions = []; // { kind: 'expired' | 'residue', uuid, groups }
  for (const uuid of toRead) {
    let m = null;
    try {
      const o = await env.BUCKET.get(`${uuid}/manifest.json`);
      if (o) m = JSON.parse(await o.text());
    } catch (e) {
      console.error('nightly_sweep: manifest read failed:', e?.message ?? e);
      continue;
    }
    if (!m) continue;
    const e = byUuid.get(uuid);

    if (e.others.length === 0) {
      if (isFinalTombstone(m) && m.consumed_at <= cutoff) tombDue.push(`${uuid}/manifest.json`);
      continue;
    }
    if (m.consumed === true) {
      // A deletion that died part-way also leaves the full manifest: finish it
      // the way destroyTransfer would, with the leftover record dated as it was.
      const finish = isFinalTombstone(m) ? null : (Number.isFinite(m.consumed_at) ? m.consumed_at : nowSeconds);
      actions.push({ kind: 'residue', uuid, groups: [e.others], finish });
    } else if (isPurgeableExpired(m, nowSeconds)) {
      const chunks = e.others.filter(k => CHUNK_RE.test(k.slice(uuid.length + 1)));
      const rest   = e.others.filter(k => !CHUNK_RE.test(k.slice(uuid.length + 1)));
      actions.push({ kind: 'expired', uuid, groups: [chunks, rest] });
    }
  }

  const out = {
    swept_at: nowSeconds,
    dry_run: dryRun,
    objects_scanned: objectsScanned,
    manifests_read: toRead.length,
    read_capped: readCapped,
    tombstones_due: tombDue.length,
    tombstones_deleted: 0,
    expired_due: actions.filter(a => a.kind === 'expired').length,
    expired_purged: 0,
    residue_due: actions.filter(a => a.kind === 'residue').length,
    residue_cleared: 0,
    action_capped: actions.length > ACTION_CAP,
  };
  if (dryRun) return out;

  // ── Act ────────────────────────────────────────────────────────────────────
  out.tombstones_deleted = await deleteKeys(env.BUCKET, tombDue);

  for (const a of actions.slice(0, ACTION_CAP)) {
    if (a.kind === 'expired') {
      const r = await purgeExpiredTransfer(env, a.uuid, a.groups, nowSeconds);
      if (r.status === 'purged') out.expired_purged++;
      continue;
    }
    const n = await deleteGroups(env.BUCKET, a.groups);
    if (n === a.groups[0].length) {
      out.residue_cleared++;
      if (a.finish !== null) {
        try { await putManifest(env.BUCKET, a.uuid, buildTombstone(a.finish)); }
        catch (e) { console.error('nightly_sweep: leftover record write failed:', e?.message ?? e); }
        await env.STATUS_KV.delete(`root_verified:${a.uuid}`).catch(() => {});
      }
      await settleDockEntry(env.STATUS_KV, a.uuid, { mark: false, nowSeconds });
    }
  }

  ae(env, out);
  console.log(`nightly_sweep: ${out.tombstones_deleted} leftover record(s) deleted, ${out.expired_purged} expired purged, ${out.residue_cleared} residue cleared${out.read_capped || out.action_capped ? ' (capped; more tomorrow)' : ''}`);
  return out;
}

/** POST /admin/nightly-sweep[?dry_run=false] — admin-key gated; dry run unless asked. */
export async function handleNightlySweep(request, env) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  const dryRun = new URL(request.url).searchParams.get('dry_run') !== 'false';
  try {
    return json(await runNightlySweep(env, Math.floor(Date.now() / 1000), { dryRun }));
  } catch (e) {
    console.error('nightly_sweep: R2 list failed:', e?.message ?? e);
    return err(502, 'Storage list failed');
  }
}
