// ── frontend/download-time.js — dates, countdowns, timers ────────────────────
// Moved out of download.js at Share-JS-Split-2 (9 Oct 2026). No behaviour change.
// ─────────────────────────────────────────────────────────────────────────────

// Run fn at a unix time. Re-checks at least once a minute, so a sleeping laptop can't overshoot.
export function _at(unixSecs, fn) {
  const step = () => {
    const ms = unixSecs * 1000 - Date.now();
    if (ms <= 0) { fn(); return; }
    setTimeout(step, Math.min(ms, 60000));
  };
  step();
}

// R-5: exact local date + time first ("Sat 3 Oct, 15:25"). Built by hand so
// every browser prints the same thing.
const _WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const _MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const _pad2 = n => String(n).padStart(2, '0');

export function _fmtTime(unixSecs) {
  const d = new Date(unixSecs * 1000);
  return `${_pad2(d.getHours())}:${_pad2(d.getMinutes())}`;
}

export function _fmtDateTime(unixSecs) {
  const d = new Date(unixSecs * 1000);
  return `${_WD[d.getDay()]} ${d.getDate()} ${_MO[d.getMonth()]}, ${_fmtTime(unixSecs)}`;
}

export function _sameDay(unixSecs) {
  return new Date(unixSecs * 1000).toDateString() === new Date().toDateString();
}

// Countdown under "Available until": days, then hours on the last day.
export function _countdown(secs) {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  if (d >= 1) return `in ${d} day${d === 1 ? '' : 's'}`;
  if (h >= 1) return `in ${h} hour${h === 1 ? '' : 's'}`;
  return 'in less than an hour';
}

// Countdown under "Opens".
export function _untilOpen(secs) {
  const d = Math.floor(secs / 86400);
  if (d >= 1) return `in ${d} day${d === 1 ? '' : 's'}`;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (!h && !m) return 'in less than a minute';
  return 'in ' + (h ? `${h} h ` : '') + `${m} min`;
}
