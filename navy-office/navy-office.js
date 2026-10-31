/* ─── navy-office.js — refueler-share · Navy Office admin ───────────────────
 * OSA-Tools-4 (23 Oct 2026): each sidebar section is its own page (showPage; the address ends
 *   #overview · #metrics · #data · #reports · #ops · #api). The Execution Dock moved to dock-view.js.
 * OSA-Tools-3 (22 Oct 2026): unlock by role (GET /admin/reports/whoami); a helper key sees
 *   Reports only (reports-view.js) and never calls a metrics route.
 * Last updated: B12-2 (Client errors split into real / Expected events with
 *   plain explanations; Storage & Billing row from /admin/storage; nudge badge
 *   retired; Sign out moved to the header).
 *
 * Share-Dash-3 changes (this file):
 *   (1) Rename: dashboard → navy-office throughout. document.title set to
 *       "refueler-share · Navy Office".
 *   (2) Chambers rename: no JS in this file references harbourmaster.
 *   (3a) Client-errors modal: AE/KV source toggle above existing AE table.
 *        KV source: GET /admin/client-errors-log (X-Admin-Key).
 *        Toggle state: in-memory only (no cookie, no localStorage).
 *   (3b) API & MCP card (6th card row-3): replaces CPU-time stub.
 *        Source: GET /admin/api-stats (X-Admin-Key). Degrades gracefully.
 *        by_rail none → "Pro Bono" (carry-in from Share-Dash-2).
 *   (3c) Growth signal card: inline SVG sparkline. Three series (paid/free/api).
 *        Annotation ticks. Add-event form. Delete. Source: /admin/news-events.
 *   (4)  Execution Dock detail: size_bytes human-readable, rail label map,
 *        merkle_root "pending (available at Share-6-5)", download count pending.
 *
 * Speed-View-Opus (17 Oct 2026) — strict CSP on /share/admin/* (src/_headers):
 *   no inline handlers: every control carries data-* and one delegated listener (bottom of
 *   this file) acts on it; no style= in markup or in HTML strings (classes, the hidden
 *   attribute, or CSSOM element.style for data-driven sizes); every Worker value that goes
 *   into an HTML string passes escHtml() or is a Number. Speed is drawn by speed-view.js.
 * ─────────────────────────────────────────────────────────────────────────── */

const WORKER = 'https://api.share.refueler.io';
let adminKey    = '';
let refreshTimer = null;
let countdown   = 60;
let lastMetrics  = null;
let lastAe       = null;
let lastSnapshot = null;
let clientErrorsDetail = []; // AE detail rows from /admin/ae-metrics
let kvErrorsCache = null;    // KV log rows from /admin/client-errors-log

// (3a) CE source toggle: 'ae' | 'kv' — in-memory only
let ceSource = 'ae';

// (B10-1) Growth chart caches. Fixed to the last 90 days — the maximum
// Analytics Engine retains — so there is no range toggle; archive via print.
let _growthRange    = 'Y';   // 'Y' = last ~90 days (AE retention ceiling)
let _growthSnapshot = null;  // GET /admin/growth-snapshot (three lines)
let _btcPrice       = null;  // GET /admin/btc-price (right-axis overlay)

// ── Theme ──────────────────────────────────────────────────────────────────
// Privacy-Share-1: theme in localStorage, never a cookie; the old cookie moves over once.
function getTheme() {
  let t = null;
  try { t = localStorage.getItem('rs-theme'); } catch { /* default */ }
  const cookie = document.cookie.split(';').map(c => c.trim())
    .find(c => c.startsWith('rs-theme='));
  if (cookie && !t) t = cookie.split('=')[1];
  return t === 'paper' ? 'paper' : 'carbon';
}
function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  document.getElementById('theme-paper').classList.toggle('active', t === 'paper');
  document.getElementById('theme-carbon').classList.toggle('active', t === 'carbon');
  try { localStorage.setItem('rs-theme', t); } catch { /* not kept; fine */ }
  document.cookie = 'rs-theme=;path=/;domain=.refueler.io;max-age=0;SameSite=Lax';
}
setTheme(getTheme());

// ── Sign out ───────────────────────────────────────────────────────────────
function signOut() {
  sessionStorage.removeItem('dash_key');
  location.reload();
}

// ── Gate ───────────────────────────────────────────────────────────────────
document.getElementById('key-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') tryUnlock();
});
document.getElementById('unlock-btn').addEventListener('click', () => tryUnlock());

// OSA-Tools-3: the key unlocks by role — GET /admin/reports/whoami → { role } (never /admin/metrics,
// which a helper key must never pass). Admin sees every section; helper sees Reports only (the
// elements marked data-staff). The page only hides what the Worker already refuses a helper.
async function whoami(key) {
  const res = await fetch(`${WORKER}/admin/reports/whoami`, { headers: { 'X-Admin-Key': key }, cache: 'no-store' });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`whoami ${res.status}`);
  const { role } = await res.json();
  return role === 'admin' || role === 'helper' ? role : null;
}

function showDashboard(role) {
  document.getElementById('gate').style.display = 'none';
  document.getElementById('dashboard').style.display = 'block';
  document.title = 'refueler-share · Navy Office';
  document.body.dataset.role = role;
  if (role === 'helper') {
    const staffOnly = (parent) => { for (const el of parent.children) if (!el.hasAttribute('data-staff')) el.hidden = true; };
    staffOnly(document.querySelector('.sb-nav'));
    staffOnly(document.getElementById('dashboard'));
    staffOnly(document.querySelector('#dashboard .header-right'));
    for (const el of document.querySelectorAll('[data-admin-only]')) el.hidden = true;
    const chip = document.getElementById('role-chip');
    chip.textContent = 'Helper key · Reports only';
    chip.hidden = false;
  } else {
    initLightningToggle();
    DockView.mount({ worker: WORKER, key: adminKey });
  }
  NavyReports.mount({ worker: WORKER, key: adminKey, role });
  showPage(pageFromHash());
}

// ── Pages (OSA-Tools-4) ─────────────────────────────────────────────────────
// One section on screen at a time; the address keeps it (#data …) so a reload or Back stays put.
// A helper key has the Reports page only, whatever the address says.
const PAGES = ['overview', 'metrics', 'data', 'reports', 'ops', 'api'];
function pageFromHash() {
  if (document.body.dataset.role === 'helper') return 'reports';
  const h = location.hash.slice(1);
  return PAGES.includes(h) ? h : 'overview';
}
function showPage(name, scrollId) {
  if (document.body.dataset.role === 'helper') name = 'reports';
  let title = '';
  for (const sec of document.querySelectorAll('#dashboard > .page')) {
    const on = sec.dataset.page === name;
    sec.hidden = !on;
    if (on) title = sec.dataset.title;
  }
  setText('section-title', title);
  const items = [...document.querySelectorAll('.sb-item[data-page]')];
  const current = items.find((a) => a.dataset.page === name && scrollId && a.dataset.scroll === scrollId)
    ?? items.find((a) => a.dataset.page === name);
  for (const a of items) {
    a.classList.toggle('active', a === current);
    if (a === current) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  if (location.hash.slice(1) !== name) history.replaceState(null, '', `#${name}`);
  const changed = currentPage !== name;
  currentPage = name;
  if (changed && document.body.dataset.role === 'admin' && refreshTimer !== null) refreshAll();
  if (scrollId) scrollToCard(scrollId);
  else window.scrollTo(0, 0);
  if (name === 'overview' && typeof renderGrowth === 'function' && _growthSnapshot) renderGrowth();
  if (name === 'reports') NavyReports.shown();
}
window.addEventListener('hashchange', () => { if (document.body.dataset.role) showPage(pageFromHash()); });

async function enter(key, role) {
  adminKey = key;
  sessionStorage.setItem('dash_key', adminKey);
  showDashboard(role);
  if (role !== 'admin') return;   // a helper gets no metrics, no timer
  await refreshAll();
  startTimer();
}

async function tryUnlock() {
  const input = document.getElementById('key-input').value.trim();
  if (!input) return;
  try {
    const role = await whoami(input);
    if (!role) {
      document.getElementById('gate-error').textContent = 'Invalid key.';
      return;
    }
    await enter(input, role);
  } catch {
    document.getElementById('gate-error').textContent = 'Worker unreachable.';
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  const stored = sessionStorage.getItem('dash_key');
  if (stored) {
    try {
      const role = await whoami(stored);
      if (!role) { sessionStorage.removeItem('dash_key'); return; }
      await enter(stored, role);
    } catch {}
  }
});

// ── Refresh ────────────────────────────────────────────────────────────────
// OSA-Tools-4: only the page on screen is refreshed — Overview (and the Metrics shortcuts) the
// figures and the growth chart, Metrics the storage, Data the dock; Reports, Ops and API fetch
// nothing here (Reports keeps its own calls).
let currentPage = 'overview';
async function refreshAll() {
  clearInterval(refreshTimer);
  countdown = 60;
  updateCountdown();
  const p = currentPage;
  const figures = p === 'overview' || p === 'metrics';
  const none = async () => null;
  const [m, ae, snap, , hh, dock, kvLog] = await Promise.all([
    figures ? fetchMetrics() : none(),
    figures ? fetchAeMetrics() : none(),
    figures ? fetchSnapshot() : none(),
    figures ? fetchKvStats() : none(),
    figures ? fetchHostnameHealth() : none(),
    p === 'data' ? fetchExecutionDock() : none(),
    figures ? fetchKvErrorsLog() : none(),
  ]);
  if (m)    { lastMetrics  = m;    renderMetrics(m); }
  if (ae)   { lastAe       = ae;   renderAeMetrics(ae); }
  if (kvLog) kvErrorsCache = kvLog;
  if (figures) renderErrorCards(lastAe, kvErrorsCache);
  // B12-2: storage lists the whole R2 bucket — every 15 min, not every 60 s.
  if (p === 'metrics' && (!_storageAt || Date.now() - _storageAt > 15 * 60 * 1000)) fetchStorage();
  if (snap) { lastSnapshot = snap; renderSnapshot(snap); }
  if (hh)   { renderHostnameHealth(hh); }
  if (dock) { DockView.render(dock); }
  if (m || ae) renderFarming(lastMetrics, lastAe);
  if (p === 'overview') {
    // (3b) API & MCP card
    fetchApiStats();
    // (3c/B10-1) Growth card — annotations + AE lines + BTC overlay
    fetchGrowthAll();
  }
  const ts = new Date();
  setText('refreshed-at', `Refreshed ${ts.toLocaleTimeString('en-GB')}`);
  document.getElementById('main').setAttribute('data-print-ts', ts.toUTCString());
  startTimer();
}

async function fetchMetrics() {
  try {
    const res = await fetch(`${WORKER}/admin/metrics`, { headers: { 'X-Admin-Key': adminKey } });
    if (res.status === 401) { sessionStorage.removeItem('dash_key'); location.reload(); return null; }
    return res.json();
  } catch (e) { showError(`/admin/metrics: ${e.message}`); return null; }
}
async function fetchAeMetrics() {
  try {
    const res = await fetch(`${WORKER}/admin/ae-metrics`, { headers: { 'X-Admin-Key': adminKey } });
    if (!res.ok) { showError(`/admin/ae-metrics ${res.status}`); return null; }
    return res.json();
  } catch (e) { showError(`/admin/ae-metrics: ${e.message}`); return null; }
}
async function fetchSnapshot() {
  try {
    const res = await fetch(`${WORKER}/admin/snapshot`, { headers: { 'X-Admin-Key': adminKey } });
    if (!res.ok) { showError(`/admin/snapshot ${res.status}`); return null; }
    return res.json();
  } catch (e) { showError(`/admin/snapshot: ${e.message}`); return null; }
}

// ── SW8: Hostname health ──────────────────────────────────────────────────
async function fetchHostnameHealth() {
  try {
    const res = await fetch(`${WORKER}/admin/hostname-health`, { headers: { 'X-Admin-Key': adminKey } });
    if (!res.ok) { showError(`/admin/hostname-health ${res.status}`); return null; }
    return res.json();
  } catch (e) { showError(`/admin/hostname-health: ${e.message}`); return null; }
}

function renderHostnameHealth(data) {
  const countEl   = document.getElementById('hh-count');
  const healthyEl = document.getElementById('hh-healthy');
  const tsEl      = document.getElementById('hh-checked-at');

  if (countEl)   countEl.textContent   = data.count   ?? 0;
  if (healthyEl) {
    const healthy = data.healthy ?? 0;
    const count   = data.count   ?? 0;
    healthyEl.textContent = `${healthy}/${count}`;
    healthyEl.className   = 'card-value ' + (
      count === 0         ? '' :
      healthy < count     ? 'val-warn' : 'val-green'
    );
  }
  if (tsEl) {
    tsEl.textContent = data.checked_at
      ? new Date(data.checked_at * 1000).toLocaleTimeString('en-GB', {
          hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short',
        })
      : 'never';
  }

  const tbody = document.getElementById('hh-tbody');
  if (!tbody) return;

  const results = Array.isArray(data.results) ? data.results : [];
  if (results.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="hh-empty">No custom hostnames provisioned yet.</td></tr>';
    return;
  }

  tbody.innerHTML = results.map(r => {
    const statusClass =
      r.status === 'ok'      ? 'hh-ok'      :
      r.status === 'timeout' ? 'hh-timeout' : 'hh-error';
    const httpCol = Number(r.http_status) > 0 ? String(Number(r.http_status)) : '—';
    const latCol  = Number(r.latency_ms)  > 0 ? `${Number(r.latency_ms)} ms` : '—';
    return `<tr>
      <td class="hh-host">${escHtml(r.hostname)}</td>
      <td class="${statusClass}">${escHtml(r.status)}</td>
      <td class="hh-http">${httpCol}</td>
      <td class="hh-lat">${latCol}</td>
    </tr>`;
  }).join('');
}

// ── Render: /admin/metrics ─────────────────────────────────────────────────
function renderMetrics(d) {
  const mrrEl = document.getElementById('snap-mrr');
  mrrEl.textContent = d.mrr_gbp !== null && d.mrr_gbp !== undefined ? `£${d.mrr_gbp}` : 'n/a';
  mrrEl.className = 'sm-value' + (d.mrr_gbp > 0 ? ' blue' : '');

  const paidEl = document.getElementById('snap-paid');
  paidEl.textContent = d.paid_total ?? 0;
  paidEl.className = 'sm-value' + (d.paid_total > 0 ? ' blue' : '');

  const rate = d.credential_uniqueness_rate;
  const uEl  = document.getElementById('snap-uniqueness');
  uEl.textContent = rate !== null && rate !== undefined ? `${(rate * 100).toFixed(2)}%` : 'n/a';
  uEl.className = 'sm-value' + (
    rate === null || rate === undefined ? '' :
    rate < 0.99  ? ' red'   :
    rate < 0.999 ? ' amber' : ' green'
  );

  const churn   = d.churn_rate_mtd_pct ?? 0;
  const churnEl = document.getElementById('snap-churn');
  churnEl.textContent = `${churn}%`;
  churnEl.className = 'sm-value' + (churn > 0 ? ' red' : ' green');

  const freeEl = document.getElementById('snap-free-users');
  freeEl.textContent = d.subscribers_by_tier?.free ?? 'n/a';
  freeEl.className = 'sm-value';

  lastMetrics = d;
}

// ── Render: /admin/ae-metrics ──────────────────────────────────────────────
function renderAeMetrics(d) {
  const iss      = d.credential_issuances_by_tier;
  const issTotal = iss ? (iss.free ?? 0) + (iss.citizen ?? 0) : null;
  const issEl    = document.getElementById('snap-issuances');
  issEl.textContent = issTotal !== null ? issTotal : 'n/a';
  issEl.className = 'sm-value';

  const errs   = d.error_rate_by_endpoint;
  const errEl  = document.getElementById('snap-error-rate');
  if (errs && !d.error_rate_note) {
    let totalErrors = 0, totalReqs = 0;
    for (const ep of Object.values(errs)) {
      totalErrors += ep.error_count; totalReqs += ep.total_count;
    }
    const aggRate = totalReqs > 0 ? totalErrors / totalReqs : 0;
    errEl.textContent = `${(aggRate * 100).toFixed(2)}%`;
    errEl.className = 'sm-value' + (aggRate > 0.01 ? ' red' : aggRate > 0 ? ' amber' : ' green');
  } else {
    errEl.textContent = 'n/a'; errEl.className = 'sm-value';
  }

  const lat  = d.latency_by_endpoint;
  const ul   = lat?.upload;
  const dl   = lat?.download;

  const ulEl = document.getElementById('snap-upload-speed');
  if (ul) {
    ulEl.textContent = `${ul.p95_ms} ms`;
    ulEl.className = 'sm-value' + (ul.p95_ms > 500 ? ' red' : ul.p95_ms > 200 ? ' amber' : '');
  } else { ulEl.textContent = 'n/a'; ulEl.className = 'sm-value'; }

  const dlEl = document.getElementById('snap-download-speed');
  if (dl) {
    dlEl.textContent = `${dl.p95_ms} ms`;
    dlEl.className = 'sm-value' + (dl.p95_ms > 500 ? ' red' : dl.p95_ms > 200 ? ' amber' : '');
  } else { dlEl.textContent = 'n/a'; dlEl.className = 'sm-value'; }

  const ulP99El = document.getElementById('snap-upload-speed-p99');
  if (ul) {
    ulP99El.textContent = `${ul.p99_ms} ms`;
    ulP99El.className = 'sm-value' + (ul.p99_ms > 1000 ? ' red' : ul.p99_ms > 500 ? ' amber' : '');
  } else { ulP99El.textContent = 'n/a'; ulP99El.className = 'sm-value'; }

  const dlP99El = document.getElementById('snap-download-speed-p99');
  if (dl) {
    dlP99El.textContent = `${dl.p99_ms} ms`;
    dlP99El.className = 'sm-value' + (dl.p99_ms > 1000 ? ' red' : dl.p99_ms > 500 ? ' amber' : '');
  } else { dlP99El.textContent = 'n/a'; dlP99El.className = 'sm-value'; }

  const retEl    = document.getElementById('snap-retrieval');
  const ret      = d.r2_chunk_retrieval_success_rate;
  const retTotal = d.r2_chunk_total_chunks ?? 0;
  if (retTotal === 0) {
    retEl.textContent = 'n/a'; retEl.className = 'sm-value';
  } else if (ret !== null && ret !== undefined) {
    retEl.textContent = `${(ret * 100).toFixed(2)}%`;
    retEl.className = 'sm-value' + (ret < 0.99 ? ' red' : ret < 0.999 ? ' amber' : ' green');
  } else { retEl.textContent = 'n/a'; retEl.className = 'sm-value'; }

  clientErrorsDetail = Array.isArray(d.client_errors_detail) ? d.client_errors_detail : [];

  lastAe = d;
}

// ── B12-2: Client errors (real only) + Expected events cards ──────────────
function renderErrorCards(ae, kv) {
  const ceEl = document.getElementById('snap-client-errors');
  const exEl = document.getElementById('snap-expected-events');
  if (!ceEl || !exEl) return;
  if (!ae?.client_errors_by_context_24h && !kv) {
    ceEl.textContent = 'n/a'; ceEl.className = 'sm-value';
    exEl.textContent = 'n/a'; exEl.className = 'sm-value';
    return;
  }
  const c = ceCounts(ae, kv);
  ceEl.textContent = c.real;
  ceEl.className = 'sm-value' + (c.real > 10 ? ' red' : c.real > 0 ? ' amber' : ' green');
  exEl.textContent = c.expected;
  exEl.className = 'sm-value';
}

// ── B12-2: Storage & Billing ──────────────────────────────────────────────
// Source: GET /admin/storage — aggregates of what R2 holds now. No UUIDs.
// R2 Standard: first 10 GB-month free, then $0.015 per GB-month (Oct 2026).
const R2_FREE_GB = 10, R2_USD_PER_GB_MONTH = 0.015;
// Wire tier names (Stripe-Account-1): free · citizen · api. The Worker folds older stored names into
// citizen before they reach here, as it does for the dock and Cases.
const TIER_LABEL = { free: 'Pro Bono', citizen: 'Citizen', api: 'Chartered' };
let _storage = null, _storageAt = 0;

async function fetchStorage() {
  try {
    const res = await fetch(`${WORKER}/admin/storage`, { headers: { 'X-Admin-Key': adminKey } });
    if (!res.ok) { console.warn('[navy-office] /admin/storage', res.status); return; }
    _storage = await res.json(); _storageAt = Date.now();
    renderStorage(_storage);
  } catch (e) { console.warn('[navy-office] /admin/storage', e.message); }
}

function _gib(bytes) { return (bytes / 1024 ** 3); }
function _fmtGib(bytes) {
  const g = _gib(bytes);
  return g >= 10 ? `${Math.round(g)} GiB` : `${g.toFixed(1)} GiB`;
}
function _storageCostUsd(bytes) { return Math.max(0, bytes / 1e9 - R2_FREE_GB) * R2_USD_PER_GB_MONTH; }
function _fmtDay(isoDay) {
  return new Date(isoDay + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function renderStorage(s) {
  const el = document.getElementById('snap-bytes');
  if (!el) return;
  const band = s.budget_band_pct ?? 0;
  el.textContent = _fmtGib(s.total_bytes);
  el.className = 'sm-value' + (band >= 100 ? ' red' : band >= 90 ? ' amber' : '');
  setText('snap-fleet-plain', `${band} % of ${s.budget_gib} GiB budget`);
  setText('snap-fleet-cost', `≈ $${_storageCostUsd(s.total_bytes).toFixed(2)} a month`);
  setText('storage-asof', `as of ${_fmtDay(s.as_of_day)}`);
  const tierLine = (t) => {
    const v = s.live?.[t];
    return v ? `${v.transfers} · ${_fmtGib(v.bytes)}` : '0';
  };
  setText('snap-citizen', tierLine('citizen'));
  setText('snap-probono',   tierLine('free'));
}

function _storageModalHtml(s) {
  const row = (k, v) => _apiRow(k, v);
  const live = Object.entries(s.live ?? {}).sort((a, b) => b[1].bytes - a[1].bytes);
  const liveRows = live.length
    ? live.map(([t, v]) => row(TIER_LABEL[t] ?? t, `${v.transfers} · ${_fmtGib(v.bytes)}`)).join('')
    : row('Live transfers', 'none');
  // B12-SR S2.5: soak tests on their own line, always shown — never hidden in a total.
  const soak = s.soak ?? { transfers: 0, bytes: 0 };
  const soakRow = row('Soak (test credentials)', `${soak.transfers} live · ${_fmtGib(soak.bytes)}`);
  const other = [
    ['Uploading or abandoned', s.uploading],
    ['Expired, not yet swept', s.expired],
    ['Deleted, objects left over', s.deleted],
    ['No manifest (orphan sweep)', s.unattached],
    ['Manifest unreadable', s.unreadable],
  ].filter(([, v]) => v && v.transfers > 0)
   .map(([k, v]) => row(k, `${v.transfers} · ${_fmtGib(v.bytes)}`)).join('');
  return `
    <div class="api-modal-section">
      <div class="api-modal-section-title">Live transfers by tier</div>
      ${liveRows}
      ${soakRow}
    </div>
    <div class="api-modal-section">
      <div class="api-modal-section-title">Other objects in R2</div>
      ${other || row('Nothing else', '—')}
    </div>
    <div class="api-modal-section">
      <div class="api-modal-section-title">Budget and cost</div>
      ${row('Budget', `${s.budget_gib} GiB · amber at 90 %`)}
      ${row('Held', `${s.budget_band_pct} % (5 % steps)`)}
      ${row('Storage cost', `≈ $${_storageCostUsd(s.total_bytes).toFixed(2)} a month`)}
      ${row('How', `first ${R2_FREE_GB} GB free, then $${R2_USD_PER_GB_MONTH}/GB-month`)}
    </div>
    <p class="ce-provenance-note">Ciphertext as stored, listed from R2 on ${escHtml(_fmtDay(s.as_of_day))}. Totals only — no transfer IDs or sizes.</p>`;
}

// ── (3b) API & MCP card ───────────────────────────────────────────────────
// Source: GET /admin/api-stats (X-Admin-Key)
// Response shape: {
//   active_keys: { provisioned, active, by_plan: {...} },
//   requests_30d: { total, by_rail: { identity, anonymous, none } },
//   api_attach_rate: { api_transfers, total_transfers, rate },
//   sandbox_to_live: { available: false, reason: "..." },
//   ae_available: bool, kv_available: bool
// }
let _apiStatsCache = null;

async function fetchApiStats() {
  try {
    const res = await fetch(`${WORKER}/admin/api-stats`, { headers: { 'X-Admin-Key': adminKey } });
    if (!res.ok) { console.warn('[navy-office] /admin/api-stats', res.status); return; }
    const data = await res.json();
    _apiStatsCache = data;
    renderApiStatsCard(data);
  } catch (e) { console.warn('[navy-office] /admin/api-stats', e.message); }
}

function renderApiStatsCard(data) {
  const activeKeys = data?.active_keys?.active ?? null;
  const r30        = data?.requests_30d ?? null;

  const keysEl = document.getElementById('snap-api-keys');
  const reqsEl = document.getElementById('snap-api-reqs');

  if (keysEl) {
    keysEl.textContent = activeKeys !== null ? String(activeKeys) : 'n/a';
    keysEl.className   = 'sm-value';
  }
  if (reqsEl) {
    // B10-1: the headline request count is BILLABLE traffic only (Registered +
    // Bearer). `total` is dominated by Pro Bono and reads as if the API tier is
    // busy when it is not. Pro Bono is shown as a separate, muted sub-line.
    if (r30 && r30.ae_available !== false) {
      const billable = _n(r30.billable ?? (_n(r30.by_rail?.identity) + _n(r30.by_rail?.anonymous)));
      const proBono  = _n(r30.pro_bono ?? r30.by_rail?.none);
      reqsEl.replaceChildren(`${billable.toLocaleString('en-GB')} billable reqs (30d)`, document.createElement('br'),
        Object.assign(document.createElement('span'), { className: 'text-muted', textContent: `+ ${proBono.toLocaleString('en-GB')} Pro Bono` }));
    } else {
      reqsEl.textContent = '';
    }
  }
}

// (3a) KV client errors log ──────────────────────────────────────────────
async function fetchKvErrorsLog() {
  try {
    const res = await fetch(`${WORKER}/admin/client-errors-log`, { headers: { 'X-Admin-Key': adminKey } });
    if (!res.ok) { return null; }
    return res.json();
  } catch { return null; }
}

// ── B12-2: what each client-error code means ──────────────────────────────
// kind: 'real'     — something failed for a person. Counted on Client errors.
//       'detail'   — the step that failed behind an "Upload stopped" line; the
//                    stop is the count, so these are listed but not counted.
//       'expected' — retries, closed links and the page refusing a changed
//                    file. Counted on the quiet Expected events card.
const _RETRY = 'One try at sending a part failed; the page waits and tries again by itself.';
const _RETRY_WORRY = 'Only if “Upload stopped” lines appear alongside.';
const _REFUSED_RESUME = 'Working as designed: the page refused to continue an upload with a different file.';
const CE_CODES = {
  'upload_stopped:network':    { kind: 'real', label: 'Upload stopped · couldn’t reach Refueler', means: 'Several tries failed in a row and the upload stopped. Usually the person’s connection.', worry: 'Several in a day, or from different people — check Status and R2.' },
  'upload_stopped:check':      { kind: 'real', label: 'Upload stopped · security check failed', means: 'The Cloudflare check (Turnstile) didn’t go through.', worry: 'A run of them — Turnstile keys or a Cloudflare outage.' },
  'upload_stopped:refused':    { kind: 'real', label: 'Upload stopped · Refueler refused it', means: 'The Worker or R2 said no (bad link, limit, server error).', worry: 'Any. Look at the detail lines just before it.' },
  'upload_stopped:missing':    { kind: 'real', label: 'Upload stopped · parts didn’t arrive', means: 'Finishing found parts missing in R2.', worry: 'Any — parts were acknowledged but not stored.' },
  'upload_stopped:unfinished': { kind: 'real', label: 'Upload stopped · finishing failed', means: 'Everything was sent but the finish step failed; Try again finishes it.', worry: 'More than one a day.' },
  'upload_stopped:browser':    { kind: 'real', label: 'Upload stopped · error in the browser', means: 'Something broke in the page itself (out of memory, a code fault).', worry: 'Any — read the message; it may be a bug.' },
  'upload_stopped':            { kind: 'real', label: 'Upload stopped · error in the browser', means: 'Older form of the line above.', worry: 'Any — read the message.' },
  'upload_stopped:changed':    { kind: 'expected', label: 'Upload stopped · a different file was picked', means: _REFUSED_RESUME, worry: 'Never by itself.' },
  'upload_stopped:gone':       { kind: 'expected', label: 'Upload stopped · nothing left to continue', means: 'The saved upload had expired or already finished.', worry: 'Never by itself.' },
  direct_put_err:      { kind: 'expected', label: 'Part retry · connection dropped', means: _RETRY + ' Safari says “Load failed”.', worry: _RETRY_WORRY },
  direct_put_timeout:  { kind: 'expected', label: 'Part retry · timed out', means: _RETRY, worry: _RETRY_WORRY },
  direct_put_5xx:      { kind: 'expected', label: 'Part retry · R2 server error', means: _RETRY, worry: 'Many in an hour — R2 trouble; check Cloudflare status.' },
  direct_put_429:      { kind: 'expected', label: 'Part retry · R2 asked us to slow down', means: _RETRY, worry: _RETRY_WORRY },
  resume_folder_changed: { kind: 'expected', label: 'Continue refused · folder had changed', means: _REFUSED_RESUME, worry: 'Never by itself.' },
  resume_folder_tz:      { kind: 'expected', label: 'Continue refused · time zone changed', means: 'The device’s time zone changed, so the zip’s dates would differ. Refused as designed.', worry: 'Never by itself.' },
  resume_part_mismatch:  { kind: 'expected', label: 'Continue refused · file differs from what was sent', means: _REFUSED_RESUME, worry: 'Never by itself.' },
  resume_chunk_count:    { kind: 'expected', label: 'Continue refused · file is a different size', means: _REFUSED_RESUME, worry: 'Never by itself.' },
  resume_folder_size:    { kind: 'expected', label: 'Continue refused · folder zips to a different size', means: _REFUSED_RESUME, worry: 'Never by itself.' },
  direct_put_403:   { kind: 'detail', label: 'Upload link refused (403)', means: 'R2 rejected a signed upload link. Followed by “Upload stopped · refused”.', worry: 'Any — signing or clock problem in the Worker.' },
  direct_put_4xx:   { kind: 'detail', label: 'Upload part refused (4xx)', means: 'R2 refused a part. Followed by “Upload stopped · refused”.', worry: 'Any.' },
  url_batch_fetch:  { kind: 'detail', label: 'Couldn’t fetch upload links', means: 'Connection dropped asking for the next links.', worry: 'Only with a stop line.' },
  url_batch_status: { kind: 'detail', label: 'Upload links refused', means: 'The Worker refused to hand out the next links.', worry: 'Any.' },
  credential_issue: { kind: 'detail', label: 'Upload pass refused', means: 'The Worker refused the upload pass. Followed by a check or refused stop.', worry: 'A run of them.' },
  initiate:         { kind: 'detail', label: 'Upload start refused', means: 'The Worker refused to start the transfer. Followed by a refused stop.', worry: 'Any.' },
  credential_dleq:  { kind: 'real', label: 'Upload pass proof didn’t check out', means: 'The browser rejected the mint’s signature proof (DLEQ).', worry: 'Any — mint key config or tampering. Urgent.' },
  turnstile_load:   { kind: 'real', label: 'Security check didn’t load', means: 'Turnstile’s script didn’t arrive in 15 s; often a content blocker.', worry: 'A run of them from different browsers.' },
  load_deps:        { kind: 'real', label: 'Page code failed to load', means: 'BLAKE3 or curve code couldn’t load, so nothing was sent.', worry: 'Any — check the last ship.' },
  folder_zip:       { kind: 'real', label: 'Couldn’t zip the folder', means: 'Zipping a picked folder failed in the browser.', worry: 'Repeats — memory or a file-name edge case.' },
  folder_read:      { kind: 'real', label: 'Couldn’t read a dropped folder', means: 'The browser wouldn’t list a dragged folder.', worry: 'Repeats.' },
  resume_folder_print: { kind: 'real', label: 'Couldn’t check the re-picked folder', means: 'Reading the folder to compare it failed.', worry: 'Repeats.' },
  resume_folder_zip:   { kind: 'real', label: 'Couldn’t re-zip the folder', means: 'Re-zipping to continue failed.', worry: 'Repeats.' },
  idb_write:        { kind: 'real', label: 'Couldn’t save the resume record', means: 'Browser storage refused a write (private mode, full disk).', worry: 'Repeats — continue won’t work for those people.' },
  idb_clear:        { kind: 'real', label: 'Couldn’t clear the resume record', means: 'Harmless leftover in browser storage.', worry: 'Rarely.' },
  permanent_record: { kind: 'real', label: 'Permanent record step failed', means: 'The date-seal step didn’t complete for a transfer.', worry: 'Any — that transfer has no seal.' },
  decrypt:          { kind: 'real', label: 'Download couldn’t decrypt', means: 'A part failed to decrypt, or the size didn’t match.', worry: 'Any — a broken link or a crypto bug.' },
  integrity_check_failed: { kind: 'real', label: 'Stored file failed its integrity check', means: 'The ciphertext didn’t match its recorded root.', worry: 'Any. Urgent.' },
  download_chunk_retry_exhausted: { kind: 'real', label: 'Download stopped after retries', means: 'A part wouldn’t download after every retry.', worry: 'Several in a day.' },
  download_unhandled: { kind: 'real', label: 'Download hit an unexpected error', means: 'Something in the download page threw.', worry: 'Any — read the message.' },
  part_count:       { kind: 'real', label: 'Link and stored file disagree', means: 'The link’s size doesn’t match the stored part count.', worry: 'Any — a mangled link or a bug.' },
  fsaa_picker_error:{ kind: 'real', label: 'Save picker failed', means: 'Chrome’s save dialog failed; the download fell back to memory.', worry: 'Repeats.' },
  receiver_setup:   { kind: 'real', label: 'Receiver page failed to set up', means: 'The download page couldn’t start.', worry: 'Any.' },
};
function ceCode(ctx) {
  const c = String(ctx || '');
  if (CE_CODES[c]) return CE_CODES[c];
  if (c.endsWith('_fetch')) return { kind: 'detail', label: 'Couldn’t reach Refueler', means: 'A request dropped; followed by “Upload stopped · couldn’t reach Refueler”.', worry: 'Only with a stop line.' };
  return { kind: 'real', label: c || 'Unlabelled', means: 'No explanation recorded for this code yet.', worry: 'Look at the message.' };
}

// Worker-observed (KV log) entries: status + endpoint.
function workerCode(e) {
  const s = e.status, ep = e.endpoint;
  if (s === 410) return { kind: 'expected', key: `410 ${ep}`, label: 'Closed link reopened', means: 'Someone opened a link that was deleted after download or had run out of time.', worry: 'Never by itself.' };
  if (s === 404 && ep === 'meta') return { kind: 'expected', key: '404 meta', label: 'Unknown link opened', means: 'A link to a transfer that no longer exists (swept or mistyped).', worry: 'Hundreds an hour — someone guessing links.' };
  if (s === 404 && ep === 'unknown') return { kind: 'expected', key: '404 unknown', label: 'Bot probing for files', means: 'Scanners asking for /.env, /.git/config and so on. No longer logged here.', worry: 'Never.' };
  if (ep === 'admin_btc_price') return { kind: 'expected', key: `${s} admin_btc_price`, label: 'BTC price feed down', means: 'CoinGecko didn’t answer; only the chart overlay is missing. No longer logged here.', worry: 'Never.' };
  if (s === 401 && String(ep).startsWith('admin')) return { kind: 'real', key: `401 ${ep}`, label: 'Admin key refused', means: 'A request to an admin route with a wrong or missing key.', worry: 'If it wasn’t you — someone is trying admin routes.' };
  if (s >= 500) return { kind: 'real', key: `${s} ${ep}`, label: `Server error on ${ep}`, means: 'The Worker failed while answering.', worry: 'Any.' };
  return { kind: 'real', key: `${s} ${ep}`, label: `${s} on ${ep}`, means: 'The Worker refused a request.', worry: 'Repeats, or a sudden run.' };
}

// Counts for the two cards: browser (AE, 24h) + Worker (KV log, last 24h).
function ceCounts(ae, kv) {
  const out = { real: 0, expected: 0, detail: 0 };
  for (const [ctx, n] of Object.entries(ae?.client_errors_by_context_24h ?? {})) out[ceCode(ctx).kind] += n;
  const since = Date.now() / 1000 - 86400;
  for (const e of kv?.entries ?? []) if (e.ts >= since) out[workerCode(e).kind] += 1;
  return out;
}

function _ceGroupHtml(groups) {
  return '<div class="ce-groups">' + groups.map(g => `
    <div class="ce-code">
      <div class="ce-code-head"><span class="ce-code-label">${escHtml(g.label)}</span><span class="ce-code-n">${escHtml(g.n)}</span></div>
      <div class="ce-code-id">${escHtml(g.key)}</div>
      <div class="ce-code-means">${escHtml(g.means)}</div>
      <div class="ce-code-worry">${escHtml(g.worry)}</div>
    </div>`).join('') + '</div>';
}
function _groupsFromAe(ae, kinds) {
  return Object.entries(ae?.client_errors_by_context_24h ?? {})
    .map(([key, n]) => ({ key, n, ...ceCode(key) }))
    .filter(g => g.n > 0 && kinds.includes(g.kind))
    .sort((a, b) => b.n - a.n);
}
function _groupsFromKv(kv, kinds, sinceTs = 0) {
  const m = new Map();
  for (const e of kv?.entries ?? []) {
    if (e.ts < sinceTs) continue;
    const c = workerCode(e);
    if (!kinds.includes(c.kind)) continue;
    const g = m.get(c.key) ?? { ...c, n: 0 };
    g.n++; m.set(c.key, g);
  }
  return [...m.values()].sort((a, b) => b.n - a.n);
}
function _kvCoverage(kv) {
  if (!kv?.oldest_ts) return 'Worker log is empty.';
  const d = new Date(kv.oldest_ts * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return kv.total >= (kv.max_entries ?? 500)
    ? `Worker log keeps the last ${kv.max_entries ?? 500} entries — back to ${d}.`
    : `Worker log covers ${kv.total} entries back to ${d}.`;
}

// Expected-events modal body: browser (24h) and Worker (24h), quiet.
function _renderExpectedModal(sparkEl, ae, kv) {
  const since = Date.now() / 1000 - 86400;
  const b = _groupsFromAe(ae, ['expected']);
  const w = _groupsFromKv(kv, ['expected'], since);
  sparkEl.innerHTML =
    `<p class="ce-count-line">Normal running. These are counted so the red card stays for real failures.</p>` +
    `<div class="modal-section-title">Reported by browser · 24h</div>` +
    (b.length ? _ceGroupHtml(b) : '<div class="ce-empty">None.</div>') +
    `<div class="modal-section-title">Observed by Worker · 24h</div>` +
    (w.length ? _ceGroupHtml(w) : '<div class="ce-empty">None.</div>');
}

// ── Render: farming signal ─────────────────────────────────────────────────
function renderFarming(m, ae) {
  const el = document.getElementById('snap-farming');
  if (!el) return;

  const iss    = ae?.credential_issuances_by_tier;
  const issued = iss ? (iss.free ?? 0) + (iss.citizen ?? 0) : null;

  if (issued === null || issued === 0) {
    el.textContent = 'n/a'; el.className = 'sm-value'; return;
  }

  const completed = ae?.uploads_completed_24h ?? issued;
  const ratio     = completed > 0 ? issued / completed : null;

  if (ratio === null) {
    el.textContent = 'n/a'; el.className = 'sm-value'; return;
  }

  el.textContent = ratio.toFixed(2);
  el.className = 'sm-value' + (
    ratio > 3.0         ? ' red'   :
    ratio >= 1.2        ? ' amber' :
    ratio >= 0.5        ? ' green' : ' red'
  );
}

// ── Render: /admin/snapshot ────────────────────────────────────────────────
function renderSnapshot(d) { lastSnapshot = d; }

// ── Snapshot copy ──────────────────────────────────────────────────────────
async function copySnapshot() {
  const btn = document.getElementById('snapshot-copy-btn');
  try {
    await navigator.clipboard.writeText(JSON.stringify(lastSnapshot ?? {}, null, 2));
    const prev = btn.innerHTML;
    btn.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="2,8 6,12 14,4"/></svg> Copied`;
    btn.classList.add('copied');
    setTimeout(() => { btn.innerHTML = prev; btn.classList.remove('copied'); }, 2000);
  } catch {
    showError('Clipboard write failed');
  }
}

// ── Modal ──────────────────────────────────────────────────────────────────
const MODAL_DEFS = {
  mrr:                  { label: 'Monthly run rate',          plain: 'Revenue this month' },
  paid:                 { label: 'Paid subscribers',          plain: 'Paying customers' },
  uniqueness:           { label: 'Credential uniqueness rate',plain: 'Upload tokens used only once' },
  issuances:            { label: 'Credential issuances (30d)',plain: 'Uploads started in 30 days' },
  storage:              { label: 'Fleet occupancy',           plain: 'What R2 holds right now' },
  errors:               { label: 'Server errors',             plain: 'Worker error rate across all endpoints' },
  'upload-speed':       { label: 'Upload speed · p95',        plain: 'p95 latency on uploads' },
  'upload-speed-p99':   { label: 'Upload speed · p99',        plain: 'Worst-case upload tail latency' },
  'download-speed':     { label: 'Download speed · p95',      plain: 'p95 latency on downloads' },
  'download-speed-p99': { label: 'Download speed · p99',      plain: 'Worst-case download tail latency' },
  retrieval:            { label: 'Download success rate',     plain: 'Chunk retrieval success in last 24h' },
  churn:                { label: 'Churn rate',                plain: 'Cancellations' },
  'free-users':         { label: 'Free users',                plain: 'Total accounts on free tier' },
  'client-errors':      { label: 'Client errors',             plain: 'Real failures — browser-reported and Worker-observed' },
  'expected-events':    { label: 'Expected events',           plain: 'Retries, closed links and refusals — working as designed' },
  farming:              { label: 'Farming signal',            plain: 'Credential-to-upload ratio (normal: 0.8–1.2 · alarm: >3.0)' },
  lightning:            { label: 'Lightning settlement',      plain: 'Sats vs fiat payment mix' },
  'kv-monitor':         { label: 'KV quota monitor',         plain: 'Cloudflare Workers KV free-plan usage' },
  'api-mcp':            { label: 'Requests (all tiers)',                plain: 'API keys and request volumes' },
};

let _modalTrigger = null;

function openModal(key, triggerEl) {
  const def = MODAL_DEFS[key];
  if (!def) return;
  _modalTrigger = triggerEl ?? document.activeElement;
  if (_modalTrigger) _modalTrigger.classList.add('modal-active');

  setText('modal-label', def.label);
  setText('modal-plain', def.plain);

  const deferredNote = document.getElementById('modal-deferred-note');
  const isLightning  = key === 'lightning';
  deferredNote.hidden = !isLightning;
  if (isLightning) {
    deferredNote.innerHTML = '<strong>B7</strong><span class="deferred-badge">deferred</span><br><br>This metric is live at Block 7 when Lightning/Blink integration ships.';
  }

  const mv = document.getElementById('modal-value');
  const ms = document.getElementById('modal-sub');
  if (lastMetrics === null && lastAe === null && key !== 'lightning' && key !== 'api-mcp') {
    mv.textContent = '\u00A0';
    mv.className = 'modal-value skeleton';
    ms.textContent = '\u00A0';
    ms.className = 'modal-sub skeleton';
    _openModalShell();
    return;
  }

  const m  = lastMetrics ?? {};
  const ae = lastAe ?? {};
  let value, sub = '', colorClass = '', isNA = false;

  switch (key) {
    case 'mrr': {
      const v = m.mrr_gbp;
      if (v !== null && v !== undefined) { value = `£${v}`; colorClass = v > 0 ? ' blue' : ''; }
      else { value = 'n/a'; isNA = true; }
      sub = 'Gross MRR from Stripe active subscriptions';
      break;
    }
    case 'paid': {
      const v = m.paid_total;
      if (v !== null && v !== undefined) { value = String(v); colorClass = v > 0 ? ' blue' : ''; }
      else { value = 'n/a'; isNA = true; }
      const tiers   = m.subscribers_by_tier ?? {};
      const tierStr = Object.entries(tiers).filter(([t]) => t !== 'free')
        .map(([t, n]) => `${n} ${t}`).join(' · ');
      const conv = m.free_to_paid_conversion_rate;
      sub = [tierStr, conv != null ? `${conv}% conversion` : ''].filter(Boolean).join(' · ');
      break;
    }
    case 'uniqueness': {
      const r = m.credential_uniqueness_rate;
      if (r !== null && r !== undefined) {
        value = `${(r * 100).toFixed(2)}%`;
        colorClass = r < 0.99 ? ' red' : r < 0.999 ? ' amber' : ' green';
      } else { value = 'n/a'; isNA = true; }
      sub = `${m.credential_uniqueness_total_melts ?? 0} melts · ${m.credential_uniqueness_total_attempts ?? 0} replays`;
      break;
    }
    case 'issuances': {
      const iss   = ae.credential_issuances_by_tier;
      const total = iss ? (iss.free ?? 0) + (iss.citizen ?? 0) : null;
      if (total !== null) { value = String(total); }
      else { value = 'n/a'; isNA = true; }
      sub = iss ? `free ${iss.free ?? 0} · citizen ${iss.citizen ?? 0}` : 'No AE data';
      // B10-1: replace the placeholder Trend stub with a real daily line graph.
      const sparkEl = document.getElementById('modal-sparkline');
      if (sparkEl) {
        sparkEl.classList.remove('modal-sparkline-stub');
        sparkEl.innerHTML = '<div class="modal-loading">Loading daily trend…</div>';
        _renderIssuanceTrend(sparkEl);
      }
      break;
    }
    case 'storage': {
      const s = _storage;
      const sparkEl = document.getElementById('modal-sparkline');
      sparkEl.classList.remove('modal-sparkline-stub');
      sparkEl.closest('.modal-body').querySelectorAll('.modal-section-title').forEach(el => { el.style.display = 'none'; });
      document.getElementById('modal-csv-btn').style.display  = 'none';
      document.getElementById('modal-csv-note').hidden = true;
      if (s) {
        value = _fmtGib(s.total_bytes);
        sub = `${s.budget_band_pct} % of ${s.budget_gib} GiB budget · as of ${_fmtDay(s.as_of_day)}`;
        colorClass = s.budget_band_pct >= 100 ? ' red' : s.budget_band_pct >= 90 ? ' amber' : '';
        sparkEl.innerHTML = _storageModalHtml(s);
      } else {
        value = 'n/a'; isNA = true; sub = '/admin/storage not reached yet';
        sparkEl.innerHTML = '';
      }
      break;
    }
    case 'errors': {
      const errs = ae.error_rate_by_endpoint;
      if (errs) {
        let te = 0, tr = 0;
        for (const ep of Object.values(errs)) { te += ep.error_count; tr += ep.total_count; }
        const ag = tr > 0 ? te / tr : 0;
        value = `${(ag * 100).toFixed(2)}%`;
        sub = `${te} errors · ${tr.toLocaleString()} total requests`;
        colorClass = ag > 0.01 ? ' red' : ag > 0 ? ' amber' : ' green';
      } else { value = 'n/a'; isNA = true; sub = 'No AE data'; }
      break;
    }
    case 'upload-speed': {
      const ul = ae.latency_by_endpoint?.upload;
      if (ul) {
        value = `${ul.p95_ms} ms`;
        sub = `${ul.requests?.toLocaleString()} requests in last 24h`;
        colorClass = ul.p95_ms > 500 ? ' red' : ul.p95_ms > 200 ? ' amber' : '';
      } else { value = 'n/a'; isNA = true; sub = 'No data in last 24h'; }
      break;
    }
    case 'upload-speed-p99': {
      const ul = ae.latency_by_endpoint?.upload;
      if (ul) {
        value = `${ul.p99_ms} ms`;
        sub = `p95: ${ul.p95_ms} ms · ${ul.requests?.toLocaleString()} requests`;
        colorClass = ul.p99_ms > 1000 ? ' red' : ul.p99_ms > 500 ? ' amber' : '';
      } else { value = 'n/a'; isNA = true; sub = 'No data in last 24h'; }
      break;
    }
    case 'download-speed': {
      const dl = ae.latency_by_endpoint?.download;
      if (dl) {
        value = `${dl.p95_ms} ms`;
        sub = `${dl.requests?.toLocaleString()} requests in last 24h`;
        colorClass = dl.p95_ms > 500 ? ' red' : dl.p95_ms > 200 ? ' amber' : '';
      } else { value = 'n/a'; isNA = true; sub = 'No data in last 24h'; }
      break;
    }
    case 'download-speed-p99': {
      const dl = ae.latency_by_endpoint?.download;
      if (dl) {
        value = `${dl.p99_ms} ms`;
        sub = `p95: ${dl.p95_ms} ms · ${dl.requests?.toLocaleString()} requests`;
        colorClass = dl.p99_ms > 1000 ? ' red' : dl.p99_ms > 500 ? ' amber' : '';
      } else { value = 'n/a'; isNA = true; sub = 'No data in last 24h'; }
      break;
    }
    case 'retrieval': {
      const ret   = ae.r2_chunk_retrieval_success_rate;
      const total = ae.r2_chunk_total_chunks ?? 0;
      if (total === 0) {
        value = 'n/a'; isNA = true;
        sub = 'No downloads in the last 24h — nothing to measure yet';
      } else if (ret !== null && ret !== undefined) {
        value = `${(ret * 100).toFixed(2)}%`;
        sub = `${ae.r2_chunk_successful_chunks ?? 0} / ${total} chunks`;
        colorClass = ret < 0.99 ? ' red' : ret < 0.999 ? ' amber' : ' green';
      } else { value = 'n/a'; isNA = true; sub = 'No R2 retrieval data in AE'; }
      break;
    }
    case 'churn': {
      const pct = m.churn_rate_mtd_pct ?? 0;
      value = `${pct}%`;
      sub = `${m.cancelled_mtd ?? 0} cancelled this month`;
      colorClass = pct > 0 ? ' red' : ' green';
      break;
    }
    case 'free-users': {
      const v = m.subscribers_by_tier?.free;
      if (v !== null && v !== undefined) { value = String(v); }
      else { value = 'n/a'; isNA = true; }
      sub = 'Supabase · subscribers where tier = free';
      break;
    }

    // ── (3a) Client errors modal with AE/KV toggle ─────────────────────
    case 'client-errors': {
      // B12-2: the headline follows the tab (it used to show the browser count on both).
      ({ value, colorClass } = _ceHeadline(ae, kvErrorsCache));

      // Hide standard Trend / Export chrome — this modal owns its layout
      const sparkEl = document.getElementById('modal-sparkline');
      sparkEl.classList.remove('modal-sparkline-stub');
      sparkEl.closest('.modal-body').querySelectorAll('.modal-section-title').forEach(el => {
        el.style.display = 'none';
      });
      document.getElementById('modal-csv-btn').style.display  = 'none';
      document.getElementById('modal-csv-note').hidden = true;

      // Render the toggle + content
      _renderCeModalContent(sparkEl, ae);
      sub = _ceSub();
      break;
    }

    case 'expected-events': {
      const c = ceCounts(ae, kvErrorsCache);
      value = String(c.expected);
      sub = 'Last 24 hours · browser and Worker';
      const sparkEl = document.getElementById('modal-sparkline');
      sparkEl.classList.remove('modal-sparkline-stub');
      sparkEl.closest('.modal-body').querySelectorAll('.modal-section-title').forEach(el => { el.style.display = 'none'; });
      document.getElementById('modal-csv-btn').style.display  = 'none';
      document.getElementById('modal-csv-note').hidden = true;
      _renderExpectedModal(sparkEl, ae, kvErrorsCache);
      break;
    }

    case 'farming': {
      const farmIss      = ae.credential_issuances_by_tier;
      const farmIssued   = farmIss ? (farmIss.free ?? 0) + (farmIss.citizen ?? 0) : null;
      const farmCompleted = ae.uploads_completed_24h ?? farmIssued;
      const ratio        = farmIssued !== null && farmCompleted > 0 ? farmIssued / farmCompleted : null;
      if (ratio !== null) {
        value = ratio.toFixed(2);
        sub = `${farmIssued} issued · ${farmCompleted} uploads completed · proxy — B6`;
        colorClass = ratio > 3.0 || ratio < 0.5 ? ' red' : ratio >= 1.2 ? ' amber' : ' green';
      } else { value = 'n/a'; isNA = true; sub = 'No credential issuances in last 24h'; }
      break;
    }
    case 'lightning': {
      value = '—'; sub = 'Deferred to Block 7'; isNA = true;
      break;
    }
    case 'kv-monitor': {
      const kv = window._kvCache ?? {};
      const writes   = _n(kv.writes_today);
      const reads    = _n(kv.reads_today);
      const storage  = _n(kv.storage_bytes);
      const keys     = _n(kv.key_count);
      const W_LIMIT = 1_000;
      const R_LIMIT = 100_000;
      const S_LIMIT = 1_073_741_824;

      const writePct   = Math.min((writes  / W_LIMIT)  * 100, 100);
      const readPct    = Math.min((reads   / R_LIMIT)   * 100, 100);
      const storagePct = Math.min((storage / S_LIMIT)   * 100, 100);

      function _barClass(pct) { return pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : ''; }
      function _fmtBytes(b) {
        if (b >= 1_073_741_824) return (b / 1_073_741_824).toFixed(2) + ' GB';
        if (b >= 1_048_576)     return (b / 1_048_576).toFixed(1) + ' MB';
        if (b >= 1024)          return (b / 1024).toFixed(0) + ' KB';
        return b + ' B';
      }

      const sparkEl = document.getElementById('modal-sparkline');
      sparkEl.classList.remove('modal-sparkline-stub');
      sparkEl.closest('.modal-body').querySelectorAll('.modal-section-title').forEach(el => {
        el.style.display = 'none';
      });
      document.getElementById('modal-csv-btn').style.display  = 'none';
      document.getElementById('modal-csv-note').hidden = true;

      value = keys.toLocaleString('en-GB');
      sub   = 'Keys stored (no cap — Cloudflare does not limit key count)';

      sparkEl.innerHTML = `
        <div class="kv-bars">
          <div class="kv-bar-row">
            <div class="kv-bar-header">
              <span class="kv-bar-label">Writes today</span>
              <span class="kv-bar-figure">${writes.toLocaleString('en-GB')} / ${W_LIMIT.toLocaleString('en-GB')}</span>
            </div>
            <div class="kv-bar-track">
              <div class="kv-bar-fill ${_barClass(writePct)}" data-w="${writePct.toFixed(1)}"></div>
            </div>
            <div class="kv-bar-caption">${writePct.toFixed(1)}% of daily free-plan allowance · resets midnight UTC</div>
          </div>
          <div class="kv-bar-row">
            <div class="kv-bar-header">
              <span class="kv-bar-label">Reads today</span>
              <span class="kv-bar-figure">${reads.toLocaleString('en-GB')} / ${R_LIMIT.toLocaleString('en-GB')}</span>
            </div>
            <div class="kv-bar-track">
              <div class="kv-bar-fill ${_barClass(readPct)}" data-w="${readPct.toFixed(1)}"></div>
            </div>
            <div class="kv-bar-caption">${readPct.toFixed(1)}% of daily free-plan allowance · resets midnight UTC</div>
          </div>
          <div class="kv-bar-row">
            <div class="kv-bar-header">
              <span class="kv-bar-label">Storage</span>
              <span class="kv-bar-figure">${_fmtBytes(storage)} / 1 GB</span>
            </div>
            <div class="kv-bar-track">
              <div class="kv-bar-fill ${_barClass(storagePct)}" data-w="${storagePct.toFixed(1)}"></div>
            </div>
            <div class="kv-bar-caption">${storagePct.toFixed(2)}% of 1 GB cap · persistent</div>
          </div>
        </div>
        <div class="kv-keys-row">
          <span class="kv-keys-label">Keys stored</span>
          <span class="kv-keys-value">${keys.toLocaleString('en-GB')}</span>
        </div>
        <div class="kv-plan-note">
          Plan: FREE · Ops limits reset DAILY at midnight UTC.<br>
          Upgrade to Workers Paid ($5/mo) to move to MONTHLY accrual with 10× higher allowances.<br>
          Flip <code>PLAN='paid'</code> in navy-office.js after upgrade — no GraphQL auto-detect yet.
        </div>`;
      _applyWidths(sparkEl);
      break;
    }

    // ── (3b) API & MCP modal ──────────────────────────────────────────────
    case 'api-mcp': {
      const d = _apiStatsCache;
      const activeCount = d?.active_keys?.active ?? null;
      value = activeCount !== null ? String(activeCount) : 'n/a';
      isNA  = activeCount === null;
      sub   = 'Active API keys · all plans';

      const sparkEl = document.getElementById('modal-sparkline');
      sparkEl.classList.remove('modal-sparkline-stub');
      sparkEl.closest('.modal-body').querySelectorAll('.modal-section-title').forEach(el => {
        el.style.display = 'none';
      });
      document.getElementById('modal-csv-btn').style.display  = 'none';
      document.getElementById('modal-csv-note').hidden = true;

      sparkEl.innerHTML = _buildApiMcpModalHtml(d);
      break;
    }

    default:
      value = 'n/a'; isNA = true; sub = 'Unknown metric key';
  }

  mv.textContent = value;
  mv.className   = 'modal-value' + (isNA ? ' na' : colorClass);
  ms.textContent = sub;
  ms.className   = 'modal-sub';
  _openModalShell();
}

// ── (3b) API & MCP modal HTML builder ─────────────────────────────────────
// by_rail none → "Pro Bono" (carry-in Share-Dash-2)
function _railLabel(rail) {
  if (rail === 'identity')  return 'Registered';
  if (rail === 'anonymous') return 'Bearer';
  if (rail === 'none')      return 'Pro Bono';
  return escHtml(String(rail ?? '—'));
}

// v is escaped; _apiRowHtml takes markup built here (never Worker text unescaped).
function _apiRow(k, v, cls) { return _apiRowHtml(k, escHtml(v ?? '—'), cls); }
function _apiRowHtml(k, html, cls) {
  return `<div class="api-row"><span class="api-row-k">${escHtml(k)}</span><span class="api-row-v${cls ? ' ' + cls : ''}">${html}</span></div>`;
}

function _buildApiMcpModalHtml(d) {
  if (!d) {
    return `<div class="api-modal-section"><p class="modal-loading">No data — /admin/api-stats not yet reached.</p></div>`;
  }

  const aeWarn  = d.ae_available  === false ? '<span class="api-row-v unavail">AE unavailable</span>' : null;
  const kvWarn  = d.kv_available  === false ? '<span class="api-row-v unavail">KV unavailable</span>' : null;

  // Section 1: Active keys
  const ak = d.active_keys ?? {};
  const byPlan = ak.by_plan ?? {};
  const keyRows = [
    _apiRow('Provisioned', ak.provisioned ?? '—'),
    _apiRow('Active',      ak.active      ?? '—'),
    ...Object.entries(byPlan).map(([plan, n]) => _apiRow(`  ${plan}`, String(n))),
  ];

  // Section 2: Requests 30d — B10-1: lead with billable (Registered + Bearer),
  // then the rail breakdown, then Pro Bono and the all-in total for reference.
  const r30 = d.requests_30d ?? {};
  const byRail = r30.by_rail ?? {};
  const billable = _n(r30.billable ?? (_n(byRail.identity) + _n(byRail.anonymous)));
  const proBono  = _n(r30.pro_bono ?? byRail.none);
  const reqRows = (r30.ae_available === false)
    ? [ aeWarn ? _apiRowHtml('Requests (30d)', aeWarn) : _apiRow('Requests (30d)', 'Analytics Engine unavailable') ]
    : [
        _apiRow('Billable (30d)', billable.toLocaleString('en-GB')),
        _apiRow('  Registered',   String(byRail.identity ?? 0)),
        _apiRow('  Bearer',       String(byRail.anonymous ?? 0)),
        _apiRow('Pro Bono',       proBono.toLocaleString('en-GB')),
        _apiRow('All requests',   _n(r30.total).toLocaleString('en-GB')),
      ];

  // Section 3: Attach rate
  const ar = d.api_attach_rate ?? {};
  const attachRows = [
    _apiRow('API transfers',   ar.api_transfers   != null ? _n(ar.api_transfers).toLocaleString('en-GB')   : '—'),
    _apiRow('Total transfers', ar.total_transfers != null ? _n(ar.total_transfers).toLocaleString('en-GB') : '—'),
    ar.rate != null ? _apiRow('Attach rate', `${(_n(ar.rate) * 100).toFixed(1)}%`) : kvWarn ? _apiRowHtml('Attach rate', kvWarn) : _apiRow('Attach rate', '—'),
  ];

  // Section 4: Sandbox → live
  const s2l = d.sandbox_to_live ?? {};
  const s2lVal = s2l.available === false
    ? `<span class="api-row-v pending">pending — ${escHtml(s2l.reason ?? 'no reason given')}</span>`
    : `<span class="api-row-v">available</span>`;

  return `
    <div class="api-modal-section">
      <div class="api-modal-section-title">Active keys</div>
      ${keyRows.join('')}
    </div>
    <div class="api-modal-section">
      <div class="api-modal-section-title">Requests · 30d</div>
      ${reqRows.join('')}
    </div>
    <div class="api-modal-section">
      <div class="api-modal-section-title">API attach rate</div>
      ${attachRows.join('')}
    </div>
    <div class="api-modal-section">
      <div class="api-modal-section-title">Sandbox → live</div>
      ${_apiRowHtml('Status', s2lVal)}
    </div>
  `;
}

// ── (3a) CE modal content renderer ────────────────────────────────────────
// B12-2: each tab lists REAL failures, grouped by code with a plain label and
// "when to worry"; raw rows follow. Expected events live on their own card.
function _ceHeadline(ae, kv) {
  let n;
  if (ceSource === 'ae') {
    if (!ae?.client_errors_by_context_24h) return { value: 'n/a', colorClass: '' };
    n = _groupsFromAe(ae, ['real']).reduce((t, g) => t + g.n, 0);
  } else {
    if (!kv) return { value: 'n/a', colorClass: '' };
    n = _groupsFromKv(kv, ['real']).reduce((t, g) => t + g.n, 0);
  }
  return { value: String(n), colorClass: n > 10 ? ' red' : n > 0 ? ' amber' : ' green' };
}
function _ceSub() {
  return ceSource === 'ae'
    ? 'Real failures reported by browsers · last 24 hours'
    : 'Real failures the Worker answered with 4xx/5xx · whole log';
}

function _ceRowsHtml(rows) {
  if (!rows.length) return '';
  return `
    <div class="modal-section-title">Lines</div>
    <div class="ce-table-wrap">
      <table class="ce-table">
        <thead><tr><th>Time</th><th>Code</th><th>Message</th></tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>`;
}
const _ceTime = (d) => d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

function _renderCeModalContent(sparkEl, ae) {
  const toggleHtml = `
    <div class="ce-source-toggle">
      <button type="button" class="ce-source-btn${ceSource === 'ae' ? ' active' : ''}" data-ce-source="ae">
        Reported by browser (24h)
      </button>
      <button type="button" class="ce-source-btn${ceSource === 'kv' ? ' active' : ''}" data-ce-source="kv">
        Observed by Worker
      </button>
    </div>`;

  if (ceSource === 'ae') {
    const line = '<p class="ce-count-line">Counts a person’s upload or download failing. Per-try retries and refusals are on Expected events; “detail” lines explain a stop and aren’t counted twice.</p>';
    const real   = _groupsFromAe(ae, ['real']);
    const detail = _groupsFromAe(ae, ['detail']);
    const rows = clientErrorsDetail
      .filter(r => ceCode(r.context).kind !== 'expected')
      .map(r => {
        const ts  = r.ts ? _ceTime(new Date(r.ts)) : '—';
        const m   = r.message == null ? '' : String(r.message);
        const msg = m ? escHtml(m.slice(0, 80)) + (m.length > 80 ? '&hellip;' : '') : '—';
        return `<tr><td class="ce-ts">${escHtml(ts)}</td><td class="ce-ctx">${escHtml(r.context || '—')}</td><td class="ce-msg">${msg}</td></tr>`;
      });
    sparkEl.innerHTML = toggleHtml + line +
      (real.length ? _ceGroupHtml(real) : '<div class="ce-empty">No real failures in the last 24 hours.</div>') +
      (detail.length ? '<div class="modal-section-title">Detail behind a stop · not counted</div>' + _ceGroupHtml(detail) : '') +
      _ceRowsHtml(rows);
    return;
  }

  // Worker tab — KV log (refreshed every minute with the page).
  const render = (data) => {
    if (!data) {
      sparkEl.innerHTML = toggleHtml + '<div class="ce-empty ce-empty-warn">Worker log unavailable — /admin/client-errors-log returned an error.</div>';
      return;
    }
    const line = `<p class="ce-count-line">Counts requests the Worker refused or failed, except closed links, bot probes and the price feed (see Expected events). ${escHtml(_kvCoverage(data))}</p>`;
    const real = _groupsFromKv(data, ['real']);
    const rows = (data.entries ?? [])
      .filter(e => workerCode(e).kind === 'real')
      .slice(0, 100)
      .map(r => {
        const ts = r.ts ? _ceTime(new Date(r.ts * 1000)) : '—';
        return `<tr><td class="ce-ts">${escHtml(ts)}</td><td class="ce-ctx">${escHtml(`${r.status} ${r.endpoint ?? ''}`)}</td><td class="ce-msg">${escHtml(r.path ?? '—')}</td></tr>`;
      });
    sparkEl.innerHTML = toggleHtml + line +
      (real.length ? _ceGroupHtml(real) : '<div class="ce-empty">No real failures in the log.</div>') +
      _ceRowsHtml(rows);
  };
  if (kvErrorsCache) { render(kvErrorsCache); return; }
  sparkEl.innerHTML = toggleHtml + '<div class="ce-empty text-muted">Loading Worker log…</div>';
  fetchKvErrorsLog().then(data => { kvErrorsCache = data; render(data); });
}

// Toggle handler — in-memory only. Headline + sub follow the tab (B12-2).
function _setCeSource(src) {
  ceSource = src;
  const sparkEl = document.getElementById('modal-sparkline');
  if (sparkEl) _renderCeModalContent(sparkEl, lastAe ?? {});
  const { value, colorClass } = _ceHeadline(lastAe, kvErrorsCache);
  const mv = document.getElementById('modal-value');
  if (mv) { mv.textContent = value; mv.className = 'modal-value' + (value === 'n/a' ? ' na' : colorClass); }
  setText('modal-sub', _ceSub());
}

function _openModalShell() {
  const modal = document.getElementById('modal');
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => { document.getElementById('modal-close').focus(); });
  modal.addEventListener('keydown', _trapFocus);
}

function _trapFocus(e) {
  if (e.key !== 'Tab') return;
  const modal    = document.getElementById('modal');
  const focusable = Array.from(modal.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )).filter(el => !el.disabled && el.offsetParent !== null);
  if (!focusable.length) { e.preventDefault(); return; }
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (e.shiftKey) {
    if (document.activeElement === first) { e.preventDefault(); last.focus(); }
  } else {
    if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
  }
}

function onCsvClick() {
  document.getElementById('modal-csv-note').hidden = false;
}

function closeModal() {
  const modal = document.getElementById('modal');
  modal.classList.remove('open');
  modal.removeEventListener('keydown', _trapFocus);
  document.body.style.overflow = '';
  document.getElementById('modal-csv-note').hidden = true;

  // Restore elements hidden by client-errors / kv-monitor / api-mcp modals
  const sparkEl = document.getElementById('modal-sparkline');
  if (sparkEl) {
    sparkEl.classList.add('modal-sparkline-stub');
    sparkEl.innerHTML = 'Trend history — coming B5 polish pass';
    sparkEl.closest('.modal-body').querySelectorAll('.modal-section-title').forEach(el => {
      el.style.display = '';
    });
    const csvBtn = document.getElementById('modal-csv-btn');
    if (csvBtn) csvBtn.style.display = '';
    const csvNote = document.getElementById('modal-csv-note');
    if (csvNote) csvNote.hidden = true;
  }

  if (_modalTrigger) {
    _modalTrigger.classList.remove('modal-active');
    const t = _modalTrigger;
    requestAnimationFrame(() => { if (typeof t.focus === 'function') t.focus(); });
  }
  _modalTrigger = null;
  // Reset CE source toggle to AE on close so next open is fresh
  ceSource = 'ae';
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSoonModal(); });

// ── Helpers ────────────────────────────────────────────────────────────────
function parseUA(ua) {
  if (!ua || ua.length < 4) return '—';
  let browser = 'Unknown', os = 'Unknown';

  if      (/Edg\/(\d+)/.test(ua))                   browser = 'Edge '    + ua.match(/Edg\/(\d+)/)[1];
  else if (/OPR\/(\d+)/.test(ua))                   browser = 'Opera '   + ua.match(/OPR\/(\d+)/)[1];
  else if (/Firefox\/(\d+)/.test(ua))               browser = 'Firefox ' + ua.match(/Firefox\/(\d+)/)[1];
  else if (/Chrome\/(\d+)/.test(ua))                browser = 'Chrome '  + ua.match(/Chrome\/(\d+)/)[1];
  else if (/Version\/(\d+)[^)]*Safari/.test(ua))    browser = 'Safari '  + ua.match(/Version\/(\d+)/)[1];
  else if (/Safari\//.test(ua))                     browser = 'Safari';
  else if (/Trident\//.test(ua))                    browser = 'IE';

  if      (/Windows NT 10/.test(ua))  os = 'Windows 10/11';
  else if (/Windows NT/.test(ua))     os = 'Windows';
  else if (/iPhone/.test(ua))         os = 'iOS';
  else if (/iPad/.test(ua))           os = 'iPadOS';
  else if (/Android/.test(ua))        os = 'Android';
  else if (/CrOS/.test(ua))           os = 'ChromeOS';
  else if (/Mac OS X/.test(ua))       os = 'macOS';
  else if (/Linux/.test(ua))          os = 'Linux';

  return `${browser} / ${os}`;
}

// The one escape for HTML strings (text and attribute values, either quote).
function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
// A Worker value used as a number: anything else becomes 0, never text.
function _n(x) { const v = Number(x); return Number.isFinite(v) ? v : 0; }
// Sizes that come from data: data-w="<percent>" set through CSSOM after the HTML is in place.
function _applyWidths(root) {
  root.querySelectorAll('[data-w]').forEach(el => { el.style.width = `${Math.max(0, Math.min(100, Number(el.dataset.w) || 0))}%`; });
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text ?? '';
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return { val: '0', unit: 'B' };
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const raw = bytes / Math.pow(1024, i);
  const val = parseFloat(raw.toFixed(i >= 4 ? 2 : 1)).toString();
  return { val, unit: units[i] };
}

function showError(msg) {
  const el = document.querySelector('#error-banner');
  if (!el) return;
  el.style.display = 'block'; el.textContent = msg;
  setTimeout(() => { el.style.display = 'none'; }, 8000);
}

function startTimer() {
  clearInterval(refreshTimer);
  countdown = 60;
  refreshTimer = setInterval(() => {
    countdown--;
    updateCountdown();
    if (countdown <= 0) refreshAll();
  }, 1000);
}

function updateCountdown() {
  const el = document.getElementById('countdown');
  if (el) el.textContent = `↻ ${countdown}s`;
}

// ── Lightning availability toggle (S71) ────────────────────────────────────
const LIGHTNING_STATE_LABELS = {
  phoenixd: { display: 'Phoenixd', sub: 'Lightning live — Phoenixd backend active' },
  true:     { display: 'On',       sub: 'Lightning live — all backends accepted' },
  false:    { display: 'Off',      sub: 'Lightning hidden — Stripe path only' },
};

function renderLightningToggle(val) {
  const info    = LIGHTNING_STATE_LABELS[val] ?? { display: val, sub: '' };
  const stateEl = document.getElementById('lightning-toggle-state');
  const subEl   = document.getElementById('lightning-toggle-sub');
  if (!stateEl) return;
  stateEl.textContent = info.display;
  stateEl.className   = 'card-value ' + (val === 'false' ? 'val-warn' : 'val-green');
  subEl.textContent   = info.sub;
  document.querySelectorAll('#card-lightning-toggle .toggle-btn').forEach(btn => {
    btn.classList.toggle('toggle-btn--active', btn.dataset.value === val);
  });
}

async function loadLightningToggleState() {
  try {
    const res  = await fetch(`${WORKER}/status`);
    const data = await res.json();
    const val  = String(data.lightning_available ?? 'phoenixd');
    renderLightningToggle(val);
  } catch {
    const subEl = document.getElementById('lightning-toggle-sub');
    if (subEl) subEl.textContent = 'error reading state';
  }
}

async function setLightningAvailability(value) {
  try {
    const res = await fetch(`${WORKER}/admin/status`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
      body:    JSON.stringify({ lightning_available: value }),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    renderLightningToggle(value);
  } catch (err) {
    showError(`Lightning toggle: ${err.message}`);
  }
}

function initLightningToggle() {
  document.querySelectorAll('#card-lightning-toggle .toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => setLightningAvailability(btn.dataset.value));
  });
  loadLightningToggleState();
}

// ── Smoke test ─────────────────────────────────────────────────────────────
window.smokeTest = async function() {
  console.group('11-metric smoke test');
  const [m, ae] = await Promise.all([
    fetch(`${WORKER}/admin/metrics`,    { headers: { 'X-Admin-Key': adminKey } }).then(r => r.json()),
    fetch(`${WORKER}/admin/ae-metrics`, { headers: { 'X-Admin-Key': adminKey } }).then(r => r.json()),
  ]);
  const iss          = ae.credential_issuances_by_tier;
  const farmIssued   = iss ? (iss.free ?? 0) + (iss.citizen ?? 0) : null;
  const farmCompleted = ae.uploads_completed_24h ?? farmIssued;
  const farmRatio    = farmIssued !== null && farmCompleted > 0 ? farmIssued / farmCompleted : null;
  const checks = [
    { id: 1,  label: 'Credential uniqueness rate',    val: m.credential_uniqueness_rate },
    { id: 2,  label: 'Credential issuances (30d)',    val: farmIssued },
    { id: 3,  label: 'R2 held now (GiB)',             val: _storage ? +_gib(_storage.total_bytes).toFixed(1) : null },
    { id: 4,  label: 'Chunk retrieval success (24h)', val: ae.r2_chunk_retrieval_success_rate },
    { id: 5,  label: 'p95 upload latency',            val: ae.latency_by_endpoint?.upload?.p95_ms },
    { id: 6,  label: 'p99 download latency',          val: ae.latency_by_endpoint?.download?.p99_ms },
    { id: 7,  label: 'Worker error rate',             val: (() => { const e = ae.error_rate_by_endpoint; if (!e) return null; let err=0,tot=0; for (const ep of Object.values(e)){err+=ep.error_count;tot+=ep.total_count;} return tot>0?err/tot:0; })() },
    { id: 8,  label: 'Lightning vs Stripe mix',       val: null, deferred: 'B7' },
    { id: 9,  label: 'Free-to-paid conversion rate',  val: m.free_to_paid_conversion_rate },
    { id: 10, label: 'MRR (GBP floor)',               val: m.mrr_gbp },
    { id: 11, label: 'Farming signal ratio',          val: farmRatio },
  ];
  let pass = 0, deferred = 0, fail = 0;
  for (const c of checks) {
    if (c.deferred)                              { console.log(`⏸  [${c.id}] ${c.label} — deferred (${c.deferred})`); deferred++; }
    else if (c.val !== null && c.val !== undefined) { console.log(`✅ [${c.id}] ${c.label} → ${c.val}`); pass++; }
    else                                           { console.warn(`❌ [${c.id}] ${c.label} — null`); fail++; }
  }
  console.log(`Result: ${pass} pass · ${deferred} deferred · ${fail} fail`);
  console.groupEnd();
  return { pass, deferred, fail };
};

// ─── Sandbox card ────────────────────────────────────────────────────────────

const SANDBOX_TOKEN_COUNT = 10;

const escapeHtml = escHtml;   // one escape (Speed-View-Opus)

function scrollToCard(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Coming-soon micro-modal (Share-Dash-1) ────────────────────────────────
const SOON_COPY = {
  'Subscribers':      'A dedicated subscriber view — per-tier lists, lifecycle and Stripe status. Paying-customer counts are already live in System Summary.',
  'Maintenance mode': 'A one-switch maintenance banner for the public Share pages, driven from here.',
  'Rate limits':      'Live per-endpoint rate-limit thresholds and current usage, editable from the dashboard.',
};

function openSoonModal(feature) {
  document.getElementById('soon-modal-title').textContent = feature;
  document.getElementById('soon-modal-body').innerHTML =
    `${escHtml(SOON_COPY[feature] ?? 'A dedicated view for this section.')}` +
    `<br><br><span class="text-faint">Coming in a future session.</span>`;
  document.getElementById('soon-modal').classList.add('open');
}
function closeSoonModal() {
  document.getElementById('soon-modal').classList.remove('open');
}

function updateSandboxState(label) {
  const el = document.getElementById('sandbox-state');
  if (!el) return;
  el.textContent = label;
  el.classList.toggle('sandbox-ok', label === 'Active');
  el.classList.toggle('sandbox-err', label === 'Error');
}

async function sandboxActivate() {
  if (!adminKey) { alert('Not authenticated — unlock the Navy Office first.'); return; }

  const rail = document.getElementById('sandbox-rail-select').value;
  const ref  = (document.getElementById('sandbox-ref-input').value || 'sandbox').trim();
  const btn  = document.getElementById('btn-sandbox-activate');
  btn.disabled = true; btn.textContent = 'Issuing…';

  try {
    const res  = await fetch(`${WORKER}/api/v1/sandbox/activate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
      body:    JSON.stringify({ rail, transfer_ref_prefix: ref }),
    });
    const data = await res.json();
    const resultEl = document.getElementById('sandbox-result');
    resultEl.hidden = false;

    if (!res.ok) {
      resultEl.innerHTML = `<span class="sandbox-err">Error ${res.status}: ${escapeHtml(data.error ?? 'Unknown error')}</span>`;
      updateSandboxState('Error');
      return;
    }

    const lines = [
      `<strong class="sandbox-head">✓ Sandbox client issued</strong>`,
      ``,
      `Rail:      <strong>${escapeHtml(data.rail)}</strong>`,
      `Live key:  <span class="sandbox-key">${escapeHtml(data.live_key)}</span>`,
      `Sign key:  <span class="sandbox-key">${escapeHtml(data.sign_key)}</span>  ← shown once`,
      data.credits !== null
        ? `Credits:   ${escapeHtml(data.credits)}`
        : `Tokens:    ${_n(data.test_tokens?.length)} test tokens issued`,
      `Expires:   ${new Date(data.expires_at * 1000).toISOString()}`,
      ``,
      `<span class="sandbox-small">Full response (copy before timer clears):</span>`,
      `<span class="sandbox-dim">${escapeHtml(JSON.stringify(data, null, 2))}</span>`,
    ];
    window._sandboxRaw = data;
    resultEl.innerHTML =
      `<div class="sandbox-result-head"><button type="button" class="ghost-btn" data-action="copy-sandbox">Copy JSON</button></div>` +
      lines.join('<br>');

    updateSandboxState('Active');
    document.getElementById('sandbox-sub').textContent =
      `${String(data.rail)} rail · ${data.credits !== null ? data.credits + ' credits' : SANDBOX_TOKEN_COUNT + ' test tokens'} · expires ${new Date(data.expires_at * 1000).toLocaleDateString()}`;

    setTimeout(() => {
      resultEl.innerHTML = '<span class="text-faint">Result cleared after 5 min — record credentials immediately next time.</span>';
    }, 5 * 60 * 1000);

  } catch (e) {
    const resultEl = document.getElementById('sandbox-result');
    resultEl.hidden = false;
    resultEl.innerHTML = `<span class="sandbox-err">Network error: ${escapeHtml(String(e))}</span>`;
  } finally {
    btn.disabled = false; btn.textContent = 'Issue keypair';
  }
}

async function sandboxReset() {
  if (!adminKey) { alert('Not authenticated — unlock the Navy Office first.'); return; }

  const liveKey = (document.getElementById('sandbox-reset-key-input').value ?? '').trim();
  if (!liveKey.startsWith('rfs_test_live_')) {
    alert('Paste an rfs_test_live_ key into the reset field first.');
    return;
  }

  const btn = document.getElementById('btn-sandbox-reset');
  btn.disabled = true; btn.textContent = 'Resetting…';

  try {
    const res  = await fetch(`${WORKER}/api/v1/sandbox/reset`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
      body:    JSON.stringify({ live_key: liveKey }),
    });
    const data     = await res.json();
    const resultEl = document.getElementById('sandbox-result');
    resultEl.hidden = false;

    if (!res.ok) {
      resultEl.innerHTML = `<span class="sandbox-err">Error ${res.status}: ${escapeHtml(data.error ?? 'Unknown error')}</span>`;
      return;
    }

    const lines = [
      `<strong class="sandbox-head">✓ Sandbox reset</strong>`,
      `Rail:     ${escapeHtml(data.rail)}`,
      data.credits !== null
        ? `Credits reissued: ${escapeHtml(data.credits)}`
        : `Test tokens reissued: ${_n(data.test_tokens?.length)}`,
      `Reset at: ${new Date(data.reset_at * 1000).toISOString()}`,
    ];
    if (data.test_tokens?.length) {
      lines.push(``, `<span class="sandbox-dim">${escapeHtml(JSON.stringify(data.test_tokens, null, 2))}</span>`);
    }
    window._sandboxRaw = data;
    resultEl.innerHTML =
      `<div class="sandbox-result-head"><button type="button" class="ghost-btn" data-action="copy-sandbox">Copy JSON</button></div>` +
      lines.join('<br>');

  } catch (e) {
    const resultEl = document.getElementById('sandbox-result');
    resultEl.hidden = false;
    resultEl.innerHTML = `<span class="sandbox-err">Network error: ${escapeHtml(String(e))}</span>`;
  } finally {
    btn.disabled = false; btn.textContent = 'Reset credits';
  }
}

// ── KV monitor card ───────────────────────────────────────────────────────────
async function fetchKvStats() {
  try {
    const res  = await fetch(`${WORKER}/admin/kv-stats`, { headers: { 'X-Admin-Key': adminKey } });
    const data = await res.json();
    const el   = document.getElementById('snap-kv-keys');
    if (!el) return;
    const count = _n(data.key_count);
    el.textContent = count.toLocaleString('en-GB');
    el.className = 'sm-value' + (count > 500_000 ? ' red' : count > 100_000 ? ' amber' : '');
    window._kvCache = data;
  } catch (e) { console.warn('[kv-stats]', e); }
}

// ── Execution Dock (Share-Dash-1/2/3) — drawn by dock-view.js (OSA-Tools-4) ─────
async function fetchExecutionDock() {
  try {
    const res = await fetch(`${WORKER}/admin/execution-dock`, { headers: { 'X-Admin-Key': adminKey } });
    if (!res.ok) { showError(`/admin/execution-dock ${res.status}`); return null; }
    return res.json();
  } catch (e) { showError(`/admin/execution-dock: ${e.message}`); return null; }
}

// ── Sandbox result copy (Share-Dash-1) ────────────────────────────────────
async function copySandboxResult(btn) {
  try {
    await navigator.clipboard.writeText(JSON.stringify(window._sandboxRaw ?? {}, null, 2));
    if (btn) {
      const prev = btn.textContent;
      btn.textContent = 'Copied';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = prev; btn.classList.remove('copied'); }, 1500);
    }
  } catch { showError('Clipboard write failed'); }
}

// ── (3c) Growth signal card ────────────────────────────────────────────────
// Source: GET /admin/news-events (X-Admin-Key)
// Response: { events: [{ id, date, label?, note?, free?, paid?, api? }] }
// POST /admin/news-events  { date, label?, note?, free?, paid?, api? }
// DELETE /admin/news-events/:id

let _growthEvents = [];

// ── (B10-1) Growth data fetchers ───────────────────────────────────────────
// Three sources, one render:
//   · annotations   — GET /admin/news-events   (vertical tick marks)
//   · the lines     — GET /admin/growth-snapshot?range= (AE, cumulative/tier)
//   · BTC overlay   — GET /admin/btc-price      (single spot value)

async function fetchGrowthEvents() {
  try {
    const res = await fetch(`${WORKER}/admin/news-events`, { headers: { 'X-Admin-Key': adminKey } });
    if (!res.ok) { console.warn('[navy-office] /admin/news-events', res.status); return; }
    const data = await res.json();
    _growthEvents = Array.isArray(data.events) ? data.events : [];
  } catch (e) { console.warn('[navy-office] /admin/news-events', e.message); }
}

async function fetchGrowthSnapshot() {
  try {
    const res = await fetch(`${WORKER}/admin/growth-snapshot?range=${encodeURIComponent(_growthRange)}`,
      { headers: { 'X-Admin-Key': adminKey } });
    if (!res.ok) { console.warn('[navy-office] /admin/growth-snapshot', res.status); _growthSnapshot = null; return; }
    _growthSnapshot = await res.json();
  } catch (e) { console.warn('[navy-office] /admin/growth-snapshot', e.message); _growthSnapshot = null; }
}

async function fetchBtcPrice() {
  try {
    const res = await fetch(`${WORKER}/admin/btc-price`, { headers: { 'X-Admin-Key': adminKey } });
    if (!res.ok) { _btcPrice = null; return; }        // 503 = unavailable; overlay hidden
    _btcPrice = await res.json();
  } catch (e) { console.warn('[navy-office] /admin/btc-price', e.message); _btcPrice = null; }
}

// Orchestrator — load all three in parallel, then render once.
async function fetchGrowthAll() {
  await Promise.all([fetchGrowthEvents(), fetchGrowthSnapshot(), fetchBtcPrice()]);
  renderGrowth();
}

// Print / archive just the growth chart as a one-card PDF. @media print in the
// stylesheet isolates #card-growth while body carries .printing-growth.
function printGrowthChart() {
  document.body.classList.add('printing-growth');
  window.print();
}
window.addEventListener('afterprint', () => document.body.classList.remove('printing-growth'));

// Nominal window in seconds per range — fixes the x-axis to the selected window
// so the axis and annotation ticks are stable even when AE has sparse buckets.
const _GROWTH_WINDOW_SEC = { D: 86400, W: 7 * 86400, M: 30 * 86400, Y: 90 * 86400 };

function renderGrowth() {
  const svg  = document.getElementById('growth-svg');
  const list = document.getElementById('growth-events-list');
  const body = document.getElementById('growth-events-body');
  const noteEl = document.getElementById('growth-range-note');
  if (!svg) return;

  const annotations = _growthEvents.filter(e => e.label);
  const snap   = _growthSnapshot;
  const series = Array.isArray(snap?.series) ? snap.series : [];

  // Range note — flags AE unavailability and the truncated Year view.
  if (noteEl) {
    noteEl.textContent = (snap && snap.ae_available === false) ? '· Analytics Engine unavailable' : '';
  }

  const W = 800, H = 120, PAD_L = 0, PAD_R = 0, PAD_T = 12, PAD_B = 20;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  // x domain: fixed to the selected window ending now.
  const nowSec = Math.floor(Date.now() / 1000);
  const t1 = nowSec;
  const t0 = nowSec - (_GROWTH_WINDOW_SEC[_growthRange] ?? _GROWTH_WINDOW_SEC.M);
  function xOfT(t) {
    if (t1 === t0) return PAD_L + chartW / 2;
    const frac = Math.max(0, Math.min(1, (t - t0) / (t1 - t0)));
    return PAD_L + frac * chartW;
  }

  // Theme-aware colours (SVG strokes can't resolve CSS vars).
  const isPaper    = document.documentElement.getAttribute('data-theme') !== 'carbon';
  const goldColor  = '#C8A96E';                          // Free
  const greenColor = isPaper ? '#1C7C4A' : '#3DCA7A';    // Paid
  const amberColor = isPaper ? '#B85C00' : '#E8A23A';    // API
  const mutedColor = isPaper ? '#9A948D' : '#5A5751';    // BTC overlay
  const bgStroke   = isPaper ? '#E8E2D8' : '#1A1A1A';

  // Empty / degraded state — no AE line data. Still draw annotation ticks.
  if (series.length === 0) {
    const emptyMsg = (snap && snap.ae_available === false)
      ? 'Analytics Engine unavailable — lines cannot be drawn.'
      : 'No credentials issued in this range yet.';
    const ticks = _growthTickMarks(annotations, xOfT, t0, t1, PAD_T, H, PAD_B, [], null);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = ticks +
      `<text x="400" y="64" text-anchor="middle" font-family="var(--mono)" font-size="11" fill="${mutedColor}">${escHtml(emptyMsg)}</text>`;
    _wireGrowthTicks(svg);
    _renderGrowthList(list, body, annotations);
    return;
  }

  // y domain (left axis): cumulative credentials issued.
  const maxVal = Math.max(1, ...series.flatMap(p => [p.free_cum ?? 0, p.paid_cum ?? 0, p.api_cum ?? 0]));
  function yOf(v) { return PAD_T + chartH - ((v ?? 0) / maxVal) * chartH; }

  function polyPoints(key) {
    return series.map(p => `${xOfT(p.t).toFixed(1)},${yOf(p[key] ?? 0).toFixed(1)}`).join(' ');
  }
  function lastDot(key, fill) {
    const p = series[series.length - 1];
    if (!p) return '';
    return `<circle cx="${xOfT(p.t).toFixed(1)}" cy="${yOf(p[key] ?? 0).toFixed(1)}" r="3" fill="${fill}" stroke="${bgStroke}" stroke-width="1.5"/>`;
  }

  // BTC/GBP overlay — a single spot value (no historical series exists), drawn as
  // a horizontal reference line near the top of the right axis with a label. It is
  // deliberately NOT a curve: we do not fabricate price history we do not store.
  let btcOverlay = '';
  if (_btcPrice && typeof _btcPrice.price_gbp === 'number') {
    const yBtc = (PAD_T + chartH * 0.10).toFixed(1);
    const priceStr = '£' + Math.round(_btcPrice.price_gbp).toLocaleString('en-GB');
    const staleTag = _btcPrice.stale ? ' (cached)' : '';
    btcOverlay = `
      <line x1="0" y1="${yBtc}" x2="${W}" y2="${yBtc}" stroke="${mutedColor}" stroke-width="1" stroke-dasharray="2,3" opacity="0.8"/>
      <text x="${W - 4}" y="${(PAD_T + chartH * 0.10 - 4).toFixed(1)}" text-anchor="end" font-family="var(--mono)" font-size="9" fill="${mutedColor}">BTC ${escHtml(priceStr)}${escHtml(staleTag)}</text>`;
  }

  // y-max label (left) for the cumulative axis.
  const yMaxLabel = `<text x="2" y="${(PAD_T + 8).toFixed(1)}" text-anchor="start" font-family="var(--mono)" font-size="9" fill="${mutedColor}">${maxVal.toLocaleString('en-GB')}</text>`;

  const ticks = _growthTickMarks(annotations, xOfT, t0, t1, PAD_T, H, PAD_B, series, yOf);

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = `
    ${btcOverlay}
    ${ticks}
    <polyline points="${polyPoints('free_cum')}" fill="none" stroke="${goldColor}"  stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
    <polyline points="${polyPoints('paid_cum')}" fill="none" stroke="${greenColor}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
    <polyline points="${polyPoints('api_cum')}"  fill="none" stroke="${amberColor}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${lastDot('free_cum', goldColor)}
    ${lastDot('paid_cum', greenColor)}
    ${lastDot('api_cum',  amberColor)}
    ${yMaxLabel}
  `;

  _wireGrowthTicks(svg);
  _renderGrowthList(list, body, annotations);
}

// Annotation FLAG markers, mapped by date onto the fixed time x-axis and seated
// on the Free line (interpolated). A faint guide drops to the x-axis. Hovering a
// flag shows its tooltip and highlights the matching row in the list below (and
// vice-versa). Annotations outside the current window are skipped.
function _growthTickMarks(annotations, xOfT, t0, t1, PAD_T, H, PAD_B, series, yOf) {
  const baseY = H - PAD_B;
  const hasLine = Array.isArray(series) && series.length > 0 && typeof yOf === 'function';

  // Interpolate the Free cumulative line's y at time t (so the flag sits on it).
  function lineY(t) {
    if (!hasLine) return PAD_T + 18;
    const s = series;
    if (t <= s[0].t) return yOf(s[0].free_cum ?? 0);
    if (t >= s[s.length - 1].t) return yOf(s[s.length - 1].free_cum ?? 0);
    for (let i = 1; i < s.length; i++) {
      if (t <= s[i].t) {
        const a = s[i - 1], b = s[i];
        const f = (t - a.t) / ((b.t - a.t) || 1);
        const va = a.free_cum ?? 0, vb = b.free_cum ?? 0;
        return yOf(va + (vb - va) * f);
      }
    }
    return yOf(s[s.length - 1].free_cum ?? 0);
  }

  return annotations.map(ev => {
    if (!ev.date) return '';
    const t = Math.floor(Date.parse(`${ev.date}T00:00:00Z`) / 1000);
    if (!Number.isFinite(t) || t < t0 || t > t1) return '';
    const x  = xOfT(t);
    const y  = lineY(t);
    const xs = x.toFixed(1), ys = y.toFixed(1);
    const poleTop = (y - 17).toFixed(1);
    // Pennant points LEFT (toward earlier dates) so right-edge flags don't clip.
    const pennant = `M ${xs} ${poleTop} L ${(x - 12).toFixed(1)} ${(y - 14).toFixed(1)} L ${xs} ${(y - 10).toFixed(1)} Z`;
    const data = `data-annot-id="${escHtml(ev.id ?? '')}" data-tick-date="${escHtml(ev.date)}" data-tick-label="${escHtml(ev.label ?? '')}" data-tick-note="${escHtml(ev.note ?? '')}"`;
    return `<g class="growth-flag" ${data}>
      <line x1="${xs}" y1="${ys}" x2="${xs}" y2="${baseY}" stroke="#C8A96E" stroke-width="0.75" stroke-dasharray="2,3" opacity="0.45"/>
      <line class="growth-flag-pole" x1="${xs}" y1="${ys}" x2="${xs}" y2="${poleTop}" stroke="#C8A96E" stroke-width="1.25"/>
      <path class="growth-flag-pennant" d="${pennant}" fill="#C8A96E"/>
      <circle cx="${xs}" cy="${ys}" r="3" fill="#C8A96E"/>
      <circle cx="${xs}" cy="${ys}" r="9" fill="transparent"/>
    </g>`;
  }).join('');
}

function _wireGrowthTicks(svg) {
  svg.querySelectorAll('.growth-flag').forEach(flag => {
    const id = flag.getAttribute('data-annot-id');
    flag.addEventListener('mouseenter', e => { _showGrowthTooltip(e, flag); _setAnnotHi(id, true); });
    flag.addEventListener('mouseleave', ()  => { _hideGrowthTooltip();      _setAnnotHi(id, false); });
    flag.addEventListener('click',      e => _showGrowthTooltip(e, flag));
  });
}

// Two-way highlight between a flag marker and its list row.
function _setAnnotHi(id, on) {
  if (!id) return;
  let sel;
  try { sel = CSS.escape(id); } catch { sel = id.replace(/"/g, '\\"'); }
  const row = document.querySelector(`.growth-event-row[data-annot-id="${sel}"]`);
  if (row) row.classList.toggle('growth-annot-hi', on);
  document.querySelectorAll(`.growth-flag[data-annot-id="${sel}"]`)
    .forEach(f => f.classList.toggle('growth-flag-hi', on));
}

function _renderGrowthList(list, body, annotations) {
  if (!list || !body) return;
  if (annotations.length > 0) {
    list.hidden = false;
    body.innerHTML = _buildEventListHtml(annotations);
    // Row hover → highlight the flag on the chart.
    body.querySelectorAll('.growth-event-row').forEach(row => {
      const id = row.getAttribute('data-annot-id');
      row.addEventListener('mouseenter', () => _setAnnotHi(id, true));
      row.addEventListener('mouseleave', () => _setAnnotHi(id, false));
    });
  } else {
    list.hidden = true;
  }
}

// (B10-1) Credential Issuances card modal — daily line graph. Sources the same
// AE data as the growth chart (range=M, daily buckets) and plots NEW issuances
// per day (free + paid + api), replacing the old "coming B5" placeholder stub.
async function _renderIssuanceTrend(sparkEl) {
  let snap;
  try {
    const res = await fetch(`${WORKER}/admin/growth-snapshot?range=M`, { headers: { 'X-Admin-Key': adminKey } });
    if (!res.ok) { sparkEl.innerHTML = `<div class="ce-empty">Daily trend unavailable (${res.status}).</div>`; return; }
    snap = await res.json();
  } catch { sparkEl.innerHTML = '<div class="ce-empty">Daily trend unavailable.</div>'; return; }

  if (snap && snap.ae_available === false) {
    sparkEl.innerHTML = '<div class="ce-empty">Analytics Engine unavailable — trend cannot be drawn.</div>';
    return;
  }
  const series = Array.isArray(snap?.series) ? snap.series : [];
  if (series.length === 0) {
    sparkEl.innerHTML = '<div class="ce-empty">No credential issuances in the last 30 days.</div>';
    return;
  }

  const pts = series.map(p => ({ t: _n(p.t), n: _n(p.free) + _n(p.paid) + _n(p.api) }));
  const totalNew = pts.reduce((s, p) => s + p.n, 0);
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const maxN = Math.max(1, ...pts.map(p => p.n));

  // Chart box with gutters for a Y-axis (count/day) and an X-axis (date).
  const W = 480, H = 180;
  const PAD_L = 42, PAD_R = 16, PAD_T = 16, PAD_B = 34;
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
  const xOf = t => (t1 === t0) ? PAD_L + plotW / 2 : PAD_L + ((t - t0) / (t1 - t0)) * plotW;
  const yOf = n => PAD_T + plotH - (n / maxN) * plotH;

  const stroke  = '#C8A96E';
  const isPaper = document.documentElement.getAttribute('data-theme') !== 'carbon';
  const muted   = isPaper ? '#9A948D' : '#5A5751';
  const axis    = isPaper ? '#7A746D' : '#6A675F';

  const poly  = pts.map(p => `${xOf(p.t).toFixed(1)},${yOf(p.n).toFixed(1)}`).join(' ');
  const baseY = yOf(0);
  const dfmt  = t => new Date(t * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

  // Y ticks: 0, mid, max (deduped) — gridline + left-aligned count label.
  const yTicks = [...new Set([0, Math.round(maxN / 2), maxN])];
  const yGrid = yTicks.map(v => {
    const y = yOf(v).toFixed(1);
    return `<line x1="${PAD_L}" y1="${y}" x2="${W - PAD_R}" y2="${y}" stroke="${muted}" stroke-width="0.5" stroke-opacity="0.25"/>` +
           `<text x="${PAD_L - 6}" y="${(parseFloat(y) + 3).toFixed(1)}" text-anchor="end" font-family="var(--mono)" font-size="10" fill="${muted}">${v}</text>`;
  }).join('');

  sparkEl.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" width="100%" class="modal-trend-svg">
      ${yGrid}
      <!-- axes -->
      <line x1="${PAD_L}" y1="${PAD_T}" x2="${PAD_L}" y2="${baseY.toFixed(1)}" stroke="${axis}" stroke-width="0.75"/>
      <line x1="${PAD_L}" y1="${baseY.toFixed(1)}" x2="${W - PAD_R}" y2="${baseY.toFixed(1)}" stroke="${axis}" stroke-width="0.75"/>
      <!-- data -->
      <polyline points="${poly}" fill="none" stroke="${stroke}" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round"/>
      <!-- axis titles -->
      <text transform="rotate(-90)" x="${(-(PAD_T + plotH / 2)).toFixed(1)}" y="12" text-anchor="middle" font-family="var(--mono)" font-size="9" fill="${muted}">issued / day</text>
      <!-- x labels -->
      <text x="${PAD_L}" y="${(baseY + 16).toFixed(1)}" text-anchor="start" font-family="var(--mono)" font-size="10" fill="${muted}">${dfmt(t0)}</text>
      <text x="${((PAD_L + W - PAD_R) / 2).toFixed(1)}" y="${(baseY + 16).toFixed(1)}" text-anchor="middle" font-family="var(--mono)" font-size="9" fill="${muted}">date</text>
      <text x="${W - PAD_R}" y="${(baseY + 16).toFixed(1)}" text-anchor="end" font-family="var(--mono)" font-size="10" fill="${muted}">${dfmt(t1)}</text>
    </svg>
    <div class="modal-trend-caption">Credentials issued per day · last 30 days · ${totalNew.toLocaleString('en-GB')} total · peak ${maxN.toLocaleString('en-GB')}/day</div>`;
}

function _buildEventListHtml(events) {
  return [...events].sort((a, b) => a.date < b.date ? 1 : -1).map(ev => `
    <div class="growth-event-row" data-annot-id="${escHtml(ev.id ?? '')}">
      <span class="growth-event-date">${escHtml(ev.date ?? '—')}</span>
      ${ev.label ? `<span class="growth-event-label">${escHtml(ev.label)}</span>` : ''}
      <span class="growth-event-note">${escHtml(ev.note ?? '')}</span>
      <button type="button" class="growth-event-delete" data-delete-id="${escHtml(ev.id ?? '')}" title="Delete">✕</button>
    </div>`
  ).join('');
}

function _showGrowthTooltip(e, line) {
  const tip   = document.getElementById('growth-tooltip');
  if (!tip) return;
  const label = line.dataset.tickLabel || '';
  const note  = line.dataset.tickNote  || '';
  const date  = line.dataset.tickDate  || '';
  tip.textContent = [date, label, note].filter(Boolean).join('\n');
  tip.style.display = 'block';
  // Position relative to growth-chart-wrap
  const wrap = line.closest('.growth-chart-wrap') ?? document.body;
  const wRect = wrap.getBoundingClientRect();
  const x = e.clientX - wRect.left + 10;
  const y = e.clientY - wRect.top  - 8;
  tip.style.left = `${x}px`;
  tip.style.top  = `${y}px`;
}
function _hideGrowthTooltip() {
  const tip = document.getElementById('growth-tooltip');
  if (tip) tip.style.display = 'none';
}

async function growthAddEvent() {
  if (!adminKey) { alert('Not authenticated.'); return; }
  const date   = (document.getElementById('growth-date').value ?? '').trim();
  const label  = (document.getElementById('growth-label').value ?? '').trim() || undefined;
  const note   = (document.getElementById('growth-note').value ?? '').trim() || undefined;

  if (!date) { alert('Date is required.'); return; }
  if (!label && !note) { alert('Add a label or a note for the annotation.'); return; }

  // B10-1: annotations only. The three lines come from Analytics Engine, so the
  // manual free/paid/api count fields were removed. (The endpoint still accepts
  // them for backward compatibility, but this form no longer sends them.)
  const body = { date };
  if (label) body.label = label;
  if (note)  body.note  = note;

  const statusEl = document.getElementById('growth-form-status');
  statusEl.hidden = false;
  statusEl.className = 'growth-form-status';
  statusEl.textContent = 'Saving…';

  try {
    const res = await fetch(`${WORKER}/admin/news-events`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
      body:    JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      statusEl.textContent = `Error ${res.status}: ${err.error ?? 'unknown'}`;
      statusEl.classList.add('growth-status-err');
      return;
    }
    statusEl.textContent = '✓ Saved.';
    statusEl.classList.add('growth-status-ok');
    // Clear fields
    ['growth-date','growth-label','growth-note']
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    setTimeout(() => { statusEl.hidden = true; statusEl.className = 'growth-form-status'; }, 3000);
    // Re-fetch (annotations + lines + overlay)
    await fetchGrowthAll();
  } catch (e) {
    statusEl.textContent = `Network error: ${e.message}`;
    statusEl.classList.add('growth-status-err');
  }
}

async function growthDeleteEvent(id, btn) {
  if (!adminKey) { alert('Not authenticated.'); return; }
  if (!id) return;
  const orig = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const res = await fetch(`${WORKER}/admin/news-events/${encodeURIComponent(id)}`, {
      method:  'DELETE',
      headers: { 'X-Admin-Key': adminKey },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showError(`Delete failed ${res.status}: ${err.error ?? 'unknown'}`);
      if (btn) { btn.disabled = false; btn.textContent = orig; }
      return;
    }
    await fetchGrowthAll();
  } catch (e) {
    showError(`Delete error: ${e.message}`);
    if (btn) { btn.disabled = false; btn.textContent = orig; }
  }
}
// ── Speed (Speed-View-Opus · 17 Oct 2026; Share-Release-1c) ──────────────────
// summary.json (+ places.md) from the Mac → speed-view.js. Clicking Speed in the sidebar opens the
// picker straight away; dropping the files on the panel works too. Nothing fetched, sent or kept.
(() => {
  const input = document.getElementById('speed-file');
  const panel = document.getElementById('card-speed');
  const root  = document.getElementById('speed-root');
  const status = document.getElementById('speed-status');
  if (!input || !panel || typeof SpeedView === 'undefined') return;
  let data = null, names = {};
  async function read(files) {
    if (!files || !files.length) return;
    const r = await SpeedView.readFiles(files);
    if (r.names) names = r.names;
    if (r.data) data = r.data;
    const read = [r.summaryFile, r.placesFile].filter(Boolean).join(' + ');
    status.textContent = r.errors.length ? `${r.errors.join(' · ')}` : `${read} · read in this page only; nothing sent or kept.`;
    if (data) SpeedView.mount(root, data, names);
  }
  document.getElementById('speed-open').addEventListener('click', () => input.click());
  // Speed in the sidebar: the Metrics page at the Speed panel, then the picker (the delegated
  // listener below shows the page first).
  document.getElementById('sb-speed')?.addEventListener('click', () => input.click());
  input.addEventListener('change', () => { const f = [...input.files]; input.value = ''; read(f); });
  panel.addEventListener('dragover', (e) => { e.preventDefault(); panel.classList.add('sv-dragging'); });
  panel.addEventListener('dragleave', (e) => { if (!panel.contains(e.relatedTarget)) panel.classList.remove('sv-dragging'); });
  panel.addEventListener('drop', (e) => { e.preventDefault(); panel.classList.remove('sv-dragging'); read([...e.dataTransfer.files]); });
})();

// ── Wiring (strict CSP: no inline handlers) ──────────────────────────────────
// One listener for every data-* control, including those inside HTML built above.
const ACTIONS = {
  refresh:        () => refreshAll(),
  print:          () => window.print(),
  'sign-out':     () => signOut(),
  'print-growth': () => printGrowthChart(),
  'growth-add':   () => growthAddEvent(),
  'close-soon':   () => closeSoonModal(),
  'copy-sandbox': (el) => copySandboxResult(el),
};
document.addEventListener('click', (e) => {
  // .sb-item only: the page sections carry data-page too, and a click inside one must not re-show it
  // (that put the cursor back on the step's first button and blocked typing — OSA-Tools-4 live run).
  const el = e.target.closest('[data-action],.sb-item[data-page],[data-modal],[data-scroll],[data-soon],[data-theme-set],[data-ce-source],[data-dock-more],[data-delete-id]');
  if (!el) return;
  const d = el.dataset;
  if (d.action && ACTIONS[d.action]) ACTIONS[d.action](el);
  else if (d.page) { e.preventDefault(); showPage(d.page, d.scroll); }
  else if (d.modal) openModal(d.modal, el);
  else if (d.scroll) scrollToCard(d.scroll);
  else if (d.soon) openSoonModal(d.soon);
  else if (d.themeSet) setTheme(d.themeSet === 'paper' ? 'paper' : 'carbon');
  else if (d.ceSource) _setCeSource(d.ceSource === 'kv' ? 'kv' : 'ae');
  else if (d.dockMore != null) DockView.more();
  else if (d.deleteId != null) growthDeleteEvent(d.deleteId, el);
});
// Keyboard: Enter / Space on the focusable cards and dock rows, as the old onkeydown did.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const el = e.target.closest?.('.snap-metric[data-modal],.sb-item[data-modal],tr[data-dock-more]');
  if (!el || el !== e.target) return;
  e.preventDefault();
  if (el.dataset.modal) openModal(el.dataset.modal, el);
  else DockView.more();
});
document.getElementById('btn-sandbox-activate').addEventListener('click', () => sandboxActivate());
document.getElementById('btn-sandbox-reset').addEventListener('click', () => sandboxReset());
document.getElementById('snapshot-copy-btn').addEventListener('click', () => copySnapshot());
document.getElementById('modal-close').addEventListener('click', () => closeModal());
document.getElementById('modal-csv-btn').addEventListener('click', () => onCsvClick());
document.getElementById('soon-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeSoonModal();
});
