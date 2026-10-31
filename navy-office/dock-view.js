/* ─── dock-view.js — Navy Office → Data → Execution Dock (OSA-Tools-4 · 23 Oct 2026) ─────
 * Was in navy-office.js (Share-Dash-1/2/3). Design: private docs/OSA-Tools-plan-v1.md §7
 * "Execution Dock redesign", revised after the live run (23 Oct): no card — the row is the record.
 * Worker answers: refueler-share worker/src/handlers/execution_dock.js (the list, from the dock
 * index in KV) and handlers/reports.js (GET /admin/reports/lookup, the transfer itself in R2 — the
 * source of truth).
 *
 *   • eight columns at most: Transfer ID · Tier · Status · Upload · Created · Expires · Left · Collected;
 *     then two row actions, in order: Recheck (reads the transfer itself; the row shows ✓, or ⚑ on
 *     each cell the list has wrong) and Copy UUID. Ten rows, then "Show more" as the last row.
 *   • "Find a transfer": a listed transfer is scrolled to and marked; one not in the list gets a row
 *     of its own at the top, filled from the transfer itself
 *   • no size (never kept, B12-SR X4), no download count (it would record recipient activity), no
 *     merkle root (withheld, Share-Dash-2), no rail (follows from the tier)
 *   • a pasted link is cut at the # before anything runs (NavyReports.guard), so the key part
 *     after the # is never in a field or a request; the transfer ID travels in X-Transfer-UUID only
 *   • strict CSP, as navy-office.js: no inline handlers, no style=; every Worker value in an HTML
 *     string passes esc() or is a Number; times in London time
 * ─────────────────────────────────────────────────────────────────────────── */
'use strict';

const DockView = (() => {
  const S = { worker: '', key: '', rows: [], shown: 10, checks: {}, hit: null, extra: null };
  const PAGE = 10;

  // One display for every row (wire value → name; B12-4a-2: wire max = Citizen).
  const TIER   = { free: 'Pro Bono', citizen: 'Citizen', api: 'Chartered' };
  const STATUS = {
    active:       { cls: 'active',    label: 'active'    },
    active_nudge: { cls: 'active',    label: 'active'    },   // B12-2: nudge retired (spec §2.3 — not outreach)
    collected:    { cls: 'collected', label: 'collected' },
    expired:      { cls: 'expired',   label: 'expired'   },
    purged:       { cls: 'expired',   label: 'purged'    },
  };
  // The transfer itself (look-up states) in the list's words.
  const LIVE = { live: 'active', expired: 'expired', gone: 'gone', removed: 'removed', not_found: 'no such link' };
  // Which look-up states each list status agrees with.
  const AGREES = { active: ['live'], active_nudge: ['live'], expired: ['expired'], collected: ['gone'], purged: ['gone', 'not_found'] };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const fmt = (opts) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour12: false, ...opts });
  const F_ROW = fmt({ day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const F_CLOCK = fmt({ hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const t = (f, s) => (Number.isFinite(s) && s > 0 ? f.format(new Date(s * 1000)) : '—');
  const tierName = (k) => TIER[k] ?? k ?? '—';
  const upload = (v) => (v === true ? 'complete' : v === false ? 'in progress' : '—');
  const left = (n) => (Number.isFinite(n) ? `${n} d` : '—');
  const COPY_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M3 11V3a1 1 0 0 1 1-1h8"/></svg>';

  // ── The table ─────────────────────────────────────────────────────────────
  function render(data) {
    S.rows = Array.isArray(data?.transfers) ? data.transfers : [];
    draw();
  }

  function cell(field, html, uuid, cls = '') {
    const d = S.checks[uuid]?.diffs?.[field];
    return `<td class="${cls}${d ? ' dock-cell-diff' : ''}"${d ? ` title="The transfer itself: ${esc(d)}"` : ''}>${html}${d ? ' <span class="dock-flag">⚑</span>' : ''}</td>`;
  }

  function actions(uuid, recheck = true) {
    const c = S.checks[uuid];
    const n = c ? Object.keys(c.diffs).length : 0;
    const result = c ? `<span class="dock-check${n ? ' dock-check-diff' : ''}" title="Read from the transfer itself at ${esc(t(F_CLOCK, c.at))}">${n ? `⚑ ${n}` : '✓'}</span>` : '';
    return `<td class="dock-col-act"><span class="dock-acts">${recheck
      ? `<button class="dock-act" type="button" data-dock-recheck="${esc(uuid)}" title="Recheck: read the transfer itself and mark anything the list has wrong"><span class="dock-act-label">Recheck</span><span class="dock-act-icon" aria-hidden="true">↻</span></button>${result}` : ''}<button class="dock-act dock-act-copy" type="button" data-dock-copy="${esc(uuid)}" title="Copy UUID" aria-label="Copy UUID">${COPY_SVG}</button></span></td>`;
  }

  function rowHtml(r, i) {
    const pill = STATUS[r.status] ?? { cls: 'expired', label: r.status ?? '—' };
    const u = r.uuid ?? '';
    return `<tr data-dock-idx="${i}"${u && u === S.hit ? ' class="dock-hit"' : ''}>
      <td class="dock-uuid">${u ? esc(u.slice(0, 8)) : '—'}</td>
      ${cell('tier', esc(tierName(r.tier)), u)}
      ${cell('status', `<span class="dock-pill ${pill.cls}">${esc(pill.label)}</span>`, u)}
      ${cell('upload', upload(r.upload_complete), u)}
      ${cell('created', t(F_ROW, r.created_at), u, 'dock-col-created')}
      ${cell('expires', t(F_ROW, r.expiry_timestamp), u)}
      <td class="dock-col-left">${r.collected ? '—' : left(r.days_remaining)}</td>
      <td class="dock-col-collected">${t(F_ROW, r.collected_at)}</td>
      ${u ? actions(u) : '<td></td>'}
    </tr>`;
  }

  // A transfer found by "Find a transfer" that the list doesn't hold: its own row, from the transfer itself.
  function extraHtml() {
    const { uuid, L } = S.extra;
    const has = L.state === 'live' || L.state === 'expired';
    const now = Math.floor(Date.now() / 1000);
    return `<tr class="dock-extra">
      <td class="dock-uuid">${esc(uuid.slice(0, 8))}<span class="dock-tag">not in the list</span></td>
      <td>${has ? esc(tierName(L.tier)) : '—'}</td>
      <td><span class="dock-pill expired">${esc(LIVE[L.state] ?? L.state)}</span></td>
      <td>${has ? upload(L.upload_complete) : '—'}</td>
      <td class="dock-col-created">${has ? t(F_ROW, L.created_at) : '—'}</td>
      <td>${has ? t(F_ROW, L.expires_at) : '—'}</td>
      <td class="dock-col-left">${has ? left(Math.max(0, Math.ceil((L.expires_at - now) / 86400))) : '—'}</td>
      <td class="dock-col-collected">—</td>
      ${actions(uuid, false)}
    </tr>`;
  }

  function draw() {
    const tb = $('dock-tbody');
    if (!tb) return;
    const n = Math.min(S.shown, S.rows.length);
    $('dock-title').textContent = `Execution Dock · last ${n || PAGE} transfers`;
    if (!S.rows.length && !S.extra) { tb.innerHTML = '<tr><td colspan="9" class="dock-empty">No transfers on the dock.</td></tr>'; return; }
    const rows = S.extra ? [extraHtml()] : [];
    rows.push(...S.rows.slice(0, S.shown).map(rowHtml));
    if (S.rows.length > S.shown) {
      rows.push(`<tr class="dock-more" data-dock-more tabindex="0"><td colspan="9">Show more · ${n} of ${S.rows.length}</td></tr>`);
    }
    tb.innerHTML = rows.join('');
  }

  function more() {
    S.shown += PAGE;
    draw();
  }

  // ── Recheck (the list against the transfer itself) ────────────────────────
  // Times within a minute count as the same (the list and the record are written a moment apart).
  function compare(r, L) {
    const d = {};
    if (!(AGREES[r.status] ?? []).includes(L.state)) d.status = LIVE[L.state] ?? L.state;
    if (L.state === 'live' || L.state === 'expired') {
      if (L.tier !== r.tier) d.tier = tierName(L.tier);
      if (Math.abs((L.created_at ?? 0) - (r.created_at ?? 0)) > 60) d.created = t(F_ROW, L.created_at);
      if (Math.abs((L.expires_at ?? 0) - (r.expiry_timestamp ?? 0)) > 60) d.expires = t(F_ROW, L.expires_at);
      if (typeof r.upload_complete === 'boolean' && r.upload_complete !== L.upload_complete) d.upload = upload(L.upload_complete);
    }
    return d;
  }

  async function lookupLive(uuid) {
    try {
      const res = await fetch(`${S.worker}/admin/reports/lookup`, {
        headers: { 'X-Admin-Key': S.key, 'X-Transfer-UUID': uuid }, cache: 'no-store',
      });
      let data = {};
      try { data = await res.json(); } catch { /* not JSON */ }
      return { status: res.status, data };
    } catch { return { status: 0, data: {} }; }
  }
  function failed(status) {
    if (status === 0)   return 'Could not reach Share (network, or Mullvad?). Nothing was looked up.';
    if (status === 401) return 'The key was not accepted. Nothing was looked up.';
    if (status === 429) return 'Too many look-ups. Wait a minute and try again.';
    return `Share answered with an error (${status}). Try again shortly.`;
  }

  async function recheck(uuid, btn) {
    const r = S.rows.find((x) => x.uuid === uuid);
    if (!r) return;
    btn.disabled = true; btn.querySelector('.dock-act-label').textContent = 'Checking…';
    const res = await lookupLive(uuid);
    if (res.status !== 200) {
      btn.disabled = false; btn.querySelector('.dock-act-label').textContent = 'Recheck';
      $('dock-lookup-msg').textContent = failed(res.status);
      return;
    }
    S.checks[uuid] = { diffs: compare(r, res.data), at: Math.floor(Date.now() / 1000) };
    draw();
  }

  async function copyId(uuid, btn) {
    try { await navigator.clipboard.writeText(uuid); btn.classList.add('dock-copied'); btn.title = 'Copied'; }
    catch { btn.title = 'Copy failed'; }
    setTimeout(() => { btn.classList.remove('dock-copied'); btn.title = 'Copy UUID'; }, 1600);
  }

  // ── Find a transfer ───────────────────────────────────────────────────────
  function clearFind() {
    $('dock-lookup-input').value = '';
    $('dock-lookup-clear').hidden = true;
    $('dock-lookup-msg').textContent = '';
    S.hit = null; S.extra = null;
    draw();
  }

  async function go() {
    const input = $('dock-lookup-input'), msg = $('dock-lookup-msg');
    const text = input.value.trim();
    msg.textContent = '';
    $('dock-lookup-clear').hidden = !input.value;
    if (!text) return;
    const uuid = NavyReports.uuidIn(text);
    if (!uuid) {
      msg.textContent = /^[0-9a-f]{8}$/i.test(text) ? NavyReports.ONLY_8
        : 'That is not a Share link or transfer ID (UUID). Nothing was looked up.';
      return;
    }
    input.value = uuid;   // only the transfer ID part, whatever came with it
    $('dock-lookup-clear').hidden = false;
    S.extra = null;
    const idx = S.rows.findIndex((r) => r.uuid === uuid);
    if (idx >= 0) {
      S.hit = uuid;
      if (idx >= S.shown) S.shown = Math.ceil((idx + 1) / PAGE) * PAGE;
      draw();
      $('dock-tbody').querySelector('tr.dock-hit')?.scrollIntoView({ block: 'center' });
      return;
    }
    S.hit = null;
    msg.textContent = 'Looking up…';
    const r = await lookupLive(uuid);
    if (r.status !== 200) { msg.textContent = failed(r.status); return; }
    msg.textContent = '';
    S.extra = { uuid, L: r.data };
    draw();
  }

  let wired = false;
  function mount({ worker, key }) {
    Object.assign(S, { worker, key });
    if (wired) return;
    wired = true;
    const input = $('dock-lookup-input');
    NavyReports.guard(input);   // a paste only fills the box; Find or Enter runs it
    input.addEventListener('paste', () => setTimeout(() => { $('dock-lookup-clear').hidden = !input.value; }));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    input.addEventListener('input', () => { $('dock-lookup-clear').hidden = !input.value; });
    $('dock-lookup-clear').addEventListener('click', () => { clearFind(); input.focus(); });
    $('dock-lookup-go').addEventListener('click', go);
    $('dock-tbody').addEventListener('click', (e) => {
      const r = e.target.closest('[data-dock-recheck]'), c = e.target.closest('[data-dock-copy]');
      if (r) recheck(r.dataset.dockRecheck, r);
      else if (c) copyId(c.dataset.dockCopy, c);
    });
  }

  return { mount, render, more };
})();
