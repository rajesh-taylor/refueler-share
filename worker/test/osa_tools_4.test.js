// OSA-Tools-4 (23 Oct 2026) — the Execution Dock's Upload column.
// Plan: private docs/OSA-Tools-plan-v1.md §7 "Execution Dock redesign".
//
//   • upload_complete is true only for an entry finalise enriched (it carries merkle_root);
//     an initiate-only entry reads false; the root itself is still withheld (null)

import { describe, it, expect } from 'vitest';
import { handleExecutionDock } from '../src/handlers/execution_dock.js';
import { makeKv } from './helpers/kv-mock.js';

const NOW = () => Math.floor(Date.now() / 1000);
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const dockReq = () => new Request('https://w.test/admin/execution-dock', { headers: { 'X-Admin-Key': 'k' } });

describe('Execution Dock — upload_complete', () => {
  it('true after finalise (merkle_root present), false at initiate; the root stays withheld', async () => {
    const kv = makeKv();
    const initiated = { uuid: id(1), expiry_timestamp: NOW() + 86400, created_at: NOW() - 10, tier: 'free', file_name: 'encrypted-payload' };
    const finalised = { uuid: id(2), expiry_timestamp: NOW() + 86400, created_at: NOW() - 20, tier: 'free', file_name: 'encrypted-payload',
                        rail: null, merkle_root: 'r'.repeat(43) };
    for (const e of [initiated, finalised]) await kv.put(`dock_index:${e.uuid}`, JSON.stringify(e), { metadata: e });
    const j = await (await handleExecutionDock(dockReq(), { ADMIN_KEY: 'k', STATUS_KV: kv })).json();
    const by = Object.fromEntries(j.transfers.map((t) => [t.uuid, t]));
    expect(by[id(1)].upload_complete).toBe(false);
    expect(by[id(2)].upload_complete).toBe(true);
    expect(by[id(2)].merkle_root).toBeNull();
    expect(JSON.stringify(j)).not.toContain('r'.repeat(43));
  });

  it('a legacy entry with an empty or missing root reads false', async () => {
    const kv = makeKv();
    await kv.put(`dock_index:${id(3)}`, JSON.stringify({ expiry_timestamp: NOW() + 86400, created_at: NOW(), tier: 'free', merkle_root: '' }));
    const j = await (await handleExecutionDock(dockReq(), { ADMIN_KEY: 'k', STATUS_KV: kv })).json();
    expect(j.transfers[0].upload_complete).toBe(false);
  });
});
