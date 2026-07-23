/* ─── dashboard.js — refueler-share admin dashboard ────────────────────────
 * Last updated: S46a
 * ─────────────────────────────────────────────────────────────────────────── */

const WORKER = 'https://refueler-share.rt-fc4.workers.dev';
let adminKey    = '';
let refreshTimer = null;
let countdown   = 60;
let lastMetrics  = null;
let lastAe       = null;
let lastSnapshot = null;

// ── Theme ──────────────────────────────────────────────────────────────────
function getTheme() {
  const cookie = document.cookie.split(';').map(c => c.trim())
    .find(c => c.startsWith('theme='));
  return cookie ? cookie.split('=')[1] : 'carbon';
}
function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  document.getElementById('theme-paper').classList.toggle('active', t === 'paper');
  document.getElementById('theme-carbon').classList.toggle('active', t === 'carbon');
  document.cookie = `theme=${t};path=/;domain=.refueler.io;max-age=31536000;SameSite=Lax`;
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

function showDashboard() {
  document.getElementById('gate').style.display = 'none';
  document.getElementById('dashboard').style.display = 'block';
  document.getElementById('sb-auth').textContent = 'admin · authenticated';
}

async function tryUnlock() {
  const input = document.getElementById('key-input').value.trim();
  if (!input) return;
  try {
    const res = await fetch(`${WORKER}/admin/metrics`, {
      headers: { 'X-Admin-Key': input }
    });
    if (res.status === 401) {
      document.getElementById('gate-error').textContent = 'Invalid key.';
      return;
    }
    adminKey = input;
    sessionStorage.setItem('dash_key', adminKey);
    showDashboard();
    await refreshAll();
    startTimer();
  } catch {
    document.getElementById('gate-error').textContent = 'Worker unreachable.';
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  const stored = sessionStorage.getItem('dash_key');
  if (stored) {
    adminKey = stored;
    try {
      const res = await fetch(`${WORKER}/admin/metrics`, {
        headers: { 'X-Admin-Key': adminKey }
      });
      if (res.status === 401) { sessionStorage.removeItem('dash_key'); return; }
      showDashboard();
      await refreshAll();
      startTimer();
    } catch {}
  }
});

// ── Refresh ────────────────────────────────────────────────────────────────
async function refreshAll() {
  clearInterval(refreshTimer);
  countdown = 60;
  updateCountdown();
  const [m, ae, snap] = await Promise.all([fetchMetrics(), fetchAeMetrics(), fetchSnapshot()]);
  if (m)    { lastMetrics  = m;    renderMetrics(m); }
  if (ae)   { lastAe       = ae;   renderAeMetrics(ae); }
  if (snap) { lastSnapshot = snap; renderSnapshot(snap); }
  if (m || ae) renderFarming(lastMetrics, lastAe);
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
  churnEl.className = 'sm-value' + (churn > 0 ? ' red' : '');

  const freeEl = document.getElementById('snap-free-users');
  freeEl.textContent = d.subscribers_by_tier?.free ?? 'n/a';
  freeEl.className = 'sm-value';

  lastMetrics = d;
}

// ── Render: /admin/ae-metrics ──────────────────────────────────────────────
function renderAeMetrics(d) {
  const iss      = d.credential_issuances_by_tier;
  const issTotal = iss ? (iss.free ?? 0) + (iss.creative ?? 0) + (iss.max ?? 0) : null;
  const issEl    = document.getElementById('snap-issuances');
  issEl.textContent = issTotal !== null ? issTotal : 'n/a';
  issEl.className = 'sm-value';

  const bytesEl = document.getElementById('snap-bytes');
  if (d.r2_bytes_uploaded !== null && d.r2_bytes_uploaded !== undefined) {
    const { val, unit } = formatBytes(d.r2_bytes_uploaded);
    bytesEl.textContent = `${val} ${unit}`;
  } else {
    bytesEl.textContent = 'n/a';
  }
  bytesEl.className = 'sm-value';

  const errs   = d.error_rate_by_endpoint;
  const errEl  = document.getElementById('snap-error-rate');
  if (errs && !d.error_rate_note) {
    let totalErrors = 0, totalReqs = 0;
    for (const ep of Object.values(errs)) {
      totalErrors += ep.error_count; totalReqs += ep.total_count;
    }
    const aggRate = totalReqs > 0 ? totalErrors / totalReqs : 0;
    errEl.textContent = `${(aggRate * 100).toFixed(2)}%`;
    errEl.className = 'sm-value' + (aggRate > 0.01 ? ' red' : aggRate > 0 ? ' amber' : '');
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

  const retEl = document.getElementById('snap-retrieval');
  const ret   = d.r2_chunk_retrieval_success_rate;
  if (ret !== null && ret !== undefined) {
    retEl.textContent = `${(ret * 100).toFixed(2)}%`;
    retEl.className = 'sm-value' + (ret < 0.99 ? ' red' : ret < 0.999 ? ' amber' : ' green');
  } else { retEl.textContent = 'n/a'; retEl.className = 'sm-value'; }

  const ceEl = document.getElementById('snap-client-errors');
  const ce   = d.client_errors_24h;
  if (ce !== null && ce !== undefined) {
    ceEl.textContent = ce;
    ceEl.className = 'sm-value' + (ce > 10 ? ' red' : ce > 0 ? ' amber' : ' green');
  } else { ceEl.textContent = 'n/a'; ceEl.className = 'sm-value'; }

  lastAe = d;
}

// ── Render: farming signal ─────────────────────────────────────────────────
// credentials_issued_24h = sum of credential_issuances_by_tier from AE.
// uploads_completed_24h: proxy (ratio against itself = 1.00) until B6 lands real field.
function renderFarming(m, ae) {
  const el = document.getElementById('snap-farming');
  if (!el) return;

  const iss    = ae?.credential_issuances_by_tier;
  const issued = iss ? (iss.free ?? 0) + (iss.creative ?? 0) + (iss.max ?? 0) : null;

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
  storage:              { label: 'Data stored (90d)',         plain: 'Total encrypted data uploaded' },
  errors:               { label: 'Server errors',             plain: 'Worker error rate across all endpoints' },
  'upload-speed':       { label: 'Upload speed · p95',        plain: 'p95 latency on uploads' },
  'upload-speed-p99':   { label: 'Upload speed · p99',        plain: 'Worst-case upload tail latency' },
  'download-speed':     { label: 'Download speed · p95',      plain: 'p95 latency on downloads' },
  'download-speed-p99': { label: 'Download speed · p99',      plain: 'Worst-case download tail latency' },
  retrieval:            { label: 'Download success rate',     plain: 'Chunk retrieval success in last 24h' },
  churn:                { label: 'Churn rate',                plain: 'Cancellations' },
  'free-users':         { label: 'Free users',                plain: 'Total accounts on free tier' },
  'client-errors':      { label: 'Client errors (24h)',       plain: 'Browser-side failures reported' },
  farming:              { label: 'Farming signal',            plain: 'Credential-to-upload ratio (normal: 0.8–1.2 · alarm: >3.0)' },
  lightning:            { label: 'Lightning settlement',      plain: 'Sats vs fiat payment mix' },
};

let _modalTrigger = null;

// Keys that draw from AE data (lastAe) vs Supabase/Stripe (lastMetrics).
const AE_KEYS      = new Set(['issuances','storage','errors','upload-speed','upload-speed-p99','download-speed','download-speed-p99','retrieval','client-errors','farming']);
const METRICS_KEYS = new Set(['mrr','paid','uniqueness','churn','free-users']);

function _showAeBanner(show) {
  let banner = document.getElementById('modal-ae-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id        = 'modal-ae-banner';
    banner.className = 'modal-datasource-warn';
    const plain = document.getElementById('modal-plain');
    if (plain && plain.parentNode) plain.parentNode.insertBefore(banner, plain.nextSibling);
  }
  banner.style.display = show ? '' : 'none';
  if (show) banner.textContent = 'Data source unavailable — figures may be incomplete.';
}

function openModal(key, triggerEl) {
  const def = MODAL_DEFS[key];
  if (!def) return;
  _modalTrigger = triggerEl ?? document.activeElement;

  setText('modal-label', def.label);
  setText('modal-plain', def.plain);

  // Deferred state
  const deferredNote = document.getElementById('modal-deferred-note');
  const isLightning  = key === 'lightning';
  deferredNote.style.display = isLightning ? '' : 'none';
  if (isLightning) {
    deferredNote.innerHTML = '<strong>B7</strong><span class="deferred-badge">deferred</span><br><br>This metric is live at Block 7 when Lightning/Blink integration ships.';
  }

  // AE unavailable banner
  const aeDown      = AE_KEYS.has(key)      && lastAe === null;
  const metricsDown = METRICS_KEYS.has(key) && lastMetrics === null;
  _showAeBanner((aeDown || metricsDown) && !isLightning);

  // Skeleton while no data at all
  const mv = document.getElementById('modal-value');
  const ms = document.getElementById('modal-sub');
  if (lastMetrics === null && lastAe === null && key !== 'lightning') {
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
      const total = iss ? (iss.free ?? 0) + (iss.creative ?? 0) + (iss.max ?? 0) : null;
      if (total !== null) { value = String(total); }
      else { value = 'n/a'; isNA = true; }
      sub = iss ? `free ${iss.free ?? 0} · creative ${iss.creative ?? 0} · max ${iss.max ?? 0}` : 'No AE data';
      break;
    }
    case 'storage': {
      const bytes = ae.r2_bytes_uploaded;
      if (bytes !== null && bytes !== undefined) {
        const { val, unit } = formatBytes(bytes);
        value = `${val} ${unit}`;
      } else { value = 'n/a'; isNA = true; }
      sub = 'Rolling 90 days — encrypted ciphertext bytes';
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
        colorClass = ag > 0.01 ? ' red' : ag > 0 ? ' amber' : '';
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
      const ret = ae.r2_chunk_retrieval_success_rate;
      if (ret !== null && ret !== undefined) {
        value = `${(ret * 100).toFixed(2)}%`;
        sub = `${ae.r2_chunk_successful_chunks ?? 0} / ${ae.r2_chunk_total_chunks ?? 0} chunks`;
        colorClass = ret < 0.99 ? ' red' : ret < 0.999 ? ' amber' : ' green';
      } else { value = 'n/a'; isNA = true; sub = 'No R2 retrieval data in AE'; }
      break;
    }
    case 'churn': {
      const pct = m.churn_rate_mtd_pct ?? 0;
      value = `${pct}%`;
      sub = `${m.cancelled_mtd ?? 0} cancelled this month`;
      colorClass = pct > 0 ? ' red' : '';
      break;
    }
    case 'free-users': {
      const v = m.subscribers_by_tier?.free;
      if (v !== null && v !== undefined) { value = String(v); }
      else { value = 'n/a'; isNA = true; }
      sub = 'Supabase · subscribers where tier = free';
      break;
    }
    case 'client-errors': {
      const ce = ae.client_errors_24h;
      if (ce !== null && ce !== undefined) {
        value = String(ce);
        sub = 'Browser failures reported via /log/error';
        colorClass = ce > 10 ? ' red' : ce > 0 ? ' amber' : ' green';
      } else { value = 'n/a'; isNA = true; sub = 'No client error data in AE'; }
      break;
    }
    case 'farming': {
      const farmIss      = ae.credential_issuances_by_tier;
      const farmIssued   = farmIss ? (farmIss.free ?? 0) + (farmIss.creative ?? 0) + (farmIss.max ?? 0) : null;
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
    default:
      value = 'n/a'; isNA = true; sub = 'Unknown metric key';
  }

  mv.textContent = value;
  mv.className   = 'modal-value' + (isNA ? ' na' : colorClass);
  ms.textContent = sub;
  ms.className   = 'modal-sub';
  _openModalShell();
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
  document.getElementById('modal-csv-note').style.display = '';
}

function closeModal() {
  const modal = document.getElementById('modal');
  modal.classList.remove('open');
  modal.removeEventListener('keydown', _trapFocus);
  document.body.style.overflow = '';
  document.getElementById('modal-csv-note').style.display = 'none';
  if (_modalTrigger && typeof _modalTrigger.focus === 'function') {
    _modalTrigger.focus();
  }
  _modalTrigger = null;
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ── Helpers ────────────────────────────────────────────────────────────────
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text ?? '';
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return { val: '0', unit: 'B' };
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const raw = bytes / Math.pow(1024, i);
  // ≥ 1 TB: 2 dp. Everything else: 1 dp max, strip trailing zero.
  const dp  = i >= 4 ? 2 : 1;
  const val = parseFloat(raw.toFixed(dp)).toString();
  return { val, unit: units[i] };
}

function showError(msg) {
  const el = document.getElementById('error-banner');
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

// ── Smoke test ─────────────────────────────────────────────────────────────
window.smokeTest = async function() {
  console.group('S46b smoke test — metrics + 14 modal panels');

  // ── 1. Data checks ──────────────────────────────────────────────────────
  console.group('Data layer (11 checks)');
  const [m, ae] = await Promise.all([
    fetch(`${WORKER}/admin/metrics`,    { headers: { 'X-Admin-Key': adminKey } }).then(r => r.json()),
    fetch(`${WORKER}/admin/ae-metrics`, { headers: { 'X-Admin-Key': adminKey } }).then(r => r.json()),
  ]);
  const iss           = ae.credential_issuances_by_tier;
  const farmIssued    = iss ? (iss.free ?? 0) + (iss.creative ?? 0) + (iss.max ?? 0) : null;
  const farmCompleted = ae.uploads_completed_24h ?? farmIssued;
  const farmRatio     = farmIssued !== null && farmCompleted > 0 ? farmIssued / farmCompleted : null;
  const dataChecks = [
    { id: 1,  label: 'Credential uniqueness rate',    val: m.credential_uniqueness_rate },
    { id: 2,  label: 'Credential issuances (30d)',    val: farmIssued },
    { id: 3,  label: 'R2 bytes uploaded (90d)',       val: ae.r2_bytes_uploaded },
    { id: 4,  label: 'Chunk retrieval success (24h)', val: ae.r2_chunk_retrieval_success_rate },
    { id: 5,  label: 'p95 upload latency',            val: ae.latency_by_endpoint?.upload?.p95_ms },
    { id: 6,  label: 'p99 download latency',          val: ae.latency_by_endpoint?.download?.p99_ms },
    { id: 7,  label: 'Worker error rate',             val: (() => { const e = ae.error_rate_by_endpoint; if (!e) return null; let err=0,tot=0; for (const ep of Object.values(e)){err+=ep.error_count;tot+=ep.total_count;} return tot>0?err/tot:0; })() },
    { id: 8,  label: 'Lightning vs Stripe mix',       val: null, deferred: 'B7' },
    { id: 9,  label: 'Free-to-paid conversion rate',  val: m.free_to_paid_conversion_rate },
    { id: 10, label: 'MRR (GBP floor)',               val: m.mrr_gbp },
    { id: 11, label: 'Farming signal ratio',          val: farmRatio },
  ];
  let dPass = 0, dDeferred = 0, dFail = 0;
  for (const c of dataChecks) {
    if (c.deferred)                                 { console.log(`⏸  [${c.id}] ${c.label} — deferred (${c.deferred})`); dDeferred++; }
    else if (c.val !== null && c.val !== undefined) { console.log(`✅ [${c.id}] ${c.label} → ${c.val}`); dPass++; }
    else                                            { console.warn(`❌ [${c.id}] ${c.label} — null`); dFail++; }
  }
  console.groupEnd();

  // ── 2. Modal panel checks ───────────────────────────────────────────────
  console.group('Modal panels (14 keys)');
  const modalKeys = Object.keys(MODAL_DEFS);
  let mPass = 0, mDeferred = 0, mFail = 0;

  // Snapshot lastMetrics/lastAe before we stomp them, restore after
  const _savedMetrics = lastMetrics;
  const _savedAe      = lastAe;

  for (const key of modalKeys) {
    try {
      openModal(key, null);
      const mv       = document.getElementById('modal-value');
      const banner   = document.getElementById('modal-ae-banner');
      const deferred = document.getElementById('modal-deferred-note');
      const val      = mv?.textContent?.trim();
      const isDeferred = key === 'lightning';
      const bannerShown = banner && banner.style.display !== 'none';
      const valueOk  = val && val !== '' && val !== '\u00A0';

      if (isDeferred) {
        console.log(`⏸  [modal:${key}] deferred panel rendered`);
        mDeferred++;
      } else if (valueOk) {
        const note = bannerShown ? ' ⚠ datasource banner shown' : '';
        console.log(`✅ [modal:${key}] "${val}"${note}`);
        mPass++;
      } else {
        console.warn(`❌ [modal:${key}] empty value`);
        mFail++;
      }
      closeModal();
    } catch (err) {
      console.error(`❌ [modal:${key}] threw: ${err.message}`);
      mFail++;
    }
  }

  // Restore (openModal may have mutated display state but not lastMetrics/lastAe)
  lastMetrics = _savedMetrics;
  lastAe      = _savedAe;

  console.groupEnd();

  // ── 3. formatBytes spot-checks ──────────────────────────────────────────
  console.group('formatBytes rounding');
  const bytesTests = [
    { input: 207168,          expect: '202.3 KB' },
    { input: 1073741824,      expect: '1 GB' },
    { input: 1572864000,      expect: '1.5 GB' },
    { input: 1099511627776,   expect: '1 TB' },
  ];
  let bPass = 0, bFail = 0;
  for (const t of bytesTests) {
    const { val, unit } = formatBytes(t.input);
    const result = `${val} ${unit}`;
    if (result === t.expect) { console.log(`✅ ${t.input} → "${result}"`); bPass++; }
    else { console.warn(`❌ ${t.input} → "${result}" (expected "${t.expect}")`); bFail++; }
  }
  console.groupEnd();

  const totalPass = dPass + mPass + bPass;
  const totalFail = dFail + mFail + bFail;
  console.log(`\nOverall: ${totalPass} pass · ${dDeferred + mDeferred} deferred · ${totalFail} fail`);
  console.groupEnd();
  return { pass: totalPass, deferred: dDeferred + mDeferred, fail: totalFail };
};
