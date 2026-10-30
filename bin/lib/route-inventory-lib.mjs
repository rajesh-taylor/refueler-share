// bin/lib/route-inventory-lib.mjs — the route-inventory parser, without file or process I/O.
//
// Used by bin/route-inventory.mjs (CI) and by worker/test/osa_tools_1.test.js, which
// generates its helper-key refusal test from the same list (OSA-Tools-1 · 22 Oct 2026).
// Every function throws an Error on a router shape it can't read — never guesses.

// Gate vocabulary — explained in docs/ROUTES.md. Add a gate here and there together.
export const GATES = new Set([
  'public', 'turnstile', 'credential', 'upload-session', 'link', 'password', 'link-or-owner',
  'hmac', 'hmac-sandbox', 'admin', 'staff', 'magic-link', 'session', 'stripe-sig', 'gone', 'cf-challenge',
]);
// Same shape as ADMIN_PATH in worker/src/admin_host.js (worker/test/admin_host.test.js checks they agree).
export const ADMIN_PATH = /^\/(api\/v1\/)?admin(\/|$)/;
// Host column (H6a · Admin-Access-1a): `admin` = admin.share.refueler.io behind Access, `api` = everything else.
export const HOSTS = new Set(['api', 'admin']);
// `staff` (admin key or HELPER_KEY, requireRole) is allowed only here.
export const STAFF_PATH = /^\/admin\/reports\//;
export const BEGIN = '<!-- routes:begin -->';
export const END   = '<!-- routes:end -->';

// Readable path from a router regex: ^\/upload\/([0-9a-f-]{36})\/initiate$ → /upload/{uuid}/initiate
function readable(re) {
  return re.replace(/^\^/, '').replace(/\$$/, '')
    .replace(/\(\[0-9a-f-\]\{36\}\)/g, '{uuid}')
    .replace(/\(\\d\{4\}\)/g, '{part}')
    .replace(/\(\[A-Za-z0-9_-\]\+\)/g, '{id}')
    .replace(/\(([a-z]+(?:\|[a-z]+)+)\)/g, '{$1}')
    .replace(/\\\//g, '/');
}

/** Every route the Worker answers → [{ method, path, where }]. Sources as text. */
export function readRoutes(indexSrc, authSrc) {
  const found = [];
  const add = (method, path, where) => found.push({ method, path, where });

  // ── index.js fetch() router ────────────────────────────────────────────
  const idx = indexSrc.split('\n');
  const a = idx.findIndex((l) => /^\s*async fetch\(request, env, ctx\)/.test(l));
  const b = idx.findIndex((l) => /^\s*async scheduled\(/.test(l));
  if (a < 0 || b < a) throw new Error('index.js: cannot find the fetch() router (async fetch … async scheduled)');
  const matchVars = new Map();   // xMatch → readable path

  for (let i = a; i < b; i++) {
    const line = idx[i].replace(/\/\/.*$/, (c) => (c.includes("'") ? c : '')); // drop plain comments
    const at = `index.js:${i + 1}`;
    let used = 0;

    // const fooMatch = path.match(/…/);
    for (const m of line.matchAll(/const (\w+)\s*=\s*path\.match\(\/(.+)\/i?\);/g)) {
      matchVars.set(m[1], readable(m[2])); used++;
    }
    // request.method === 'GET' && fooMatch
    for (const m of line.matchAll(/request\.method\s*===\s*'(\w+)'\s*&&\s*(\w+Match)\b/g)) {
      if (!matchVars.has(m[2])) throw new Error(`${at}: ${m[2]} used before its path.match`);
      add(m[1], matchVars.get(m[2]), at);
    }
    // request.method === 'GET' && path === '/x'   (several per line allowed)
    for (const m of line.matchAll(/request\.method\s*===\s*'(\w+)'\s*&&\s*path\s*===\s*'([^']+)'/g)) {
      add(m[1], m[2], at); used++;
    }
    // path === '/x' && ['POST', 'GET'].includes(request.method)
    for (const m of line.matchAll(/path\s*===\s*'([^']+)'\s*&&\s*\[([^\]]+)\]\.includes\(request\.method\)/g)) {
      for (const meth of m[2].match(/'(\w+)'/g)) add(meth.slice(1, -1), m[1], at);
      used++;
    }
    // path === '/x' && (request.method === 'GET' || request.method === 'POST')
    for (const m of line.matchAll(/path\s*===\s*'([^']+)'\s*&&\s*\(((?:\s*request\.method\s*===\s*'\w+'\s*\|*)+)\)/g)) {
      for (const meth of m[2].match(/'(\w+)'/g)) add(meth.slice(1, -1), m[1], at);
      used++;
    }
    // request.method === 'GET' && path.startsWith('/prefix/')
    for (const m of line.matchAll(/request\.method\s*===\s*'(\w+)'\s*&&\s*path\.startsWith\('([^']+)'\)/g)) {
      add(m[1], `${m[2]}*`, at); used++;
    }

    // The OPTIONS preflight picks initiate's credentialed CORS by path — not a route of its own.
    for (const _ of line.matchAll(/if \(path\s*===\s*INITIATE_PATH\)/g)) used++;

    // Safety net: every path test in the router must have been read above.
    const tests = (line.match(/path\s*===|path\.match\(|path\.startsWith\(|path\.endsWith\(|path\.includes\(/g) ?? []).length;
    if (tests > used) throw new Error(`${at}: path check this script can't read — add its shape to bin/lib/route-inventory-lib.mjs\n    ${idx[i].trim()}`);
  }

  // ── handlers/auth.js routeAuth() ───────────────────────────────────────
  const r0 = authSrc.indexOf('export async function routeAuth(');
  if (r0 < 0) throw new Error('auth.js: cannot find routeAuth');
  const body = authSrc.slice(r0, authSrc.indexOf('\n}', r0));
  for (const m of body.matchAll(/m\s*===\s*'(\w+)'\s*&&\s*pathname\s*===\s*'([^']+)'/g)) add(m[1], m[2], 'auth.js routeAuth');
  const authTests = (body.match(/pathname\s*===|pathname\.match|pathname\.startsWith/g) ?? []).length;
  const authRead  = [...body.matchAll(/m\s*===\s*'(\w+)'\s*&&\s*pathname\s*===/g)].length;
  if (authTests > authRead) throw new Error('auth.js routeAuth: path check this script can\'t read');

  const keys = new Set();
  for (const r of found) {
    const k = `${r.method} ${r.path}`;
    if (keys.has(k)) throw new Error(`duplicate route ${k} (${r.where})`);
    keys.add(k);
  }
  return found;
}

/** docs/ROUTES.md table → Map("METHOD /path" → { method, path, gate, host }). */
export function readDocRows(text) {
  const a = text.indexOf(BEGIN), b = text.indexOf(END);
  if (a < 0 || b < a) throw new Error(`docs/ROUTES.md: missing ${BEGIN} / ${END}`);
  const rows = new Map();
  for (const line of text.slice(a + BEGIN.length, b).split('\n')) {
    if (!line.startsWith('|') || /^\|\s*-/.test(line) || /^\|\s*Method\s*\|/.test(line)) continue;
    // split on unescaped pipes; a path's own `|` is written \| in Markdown
    const c = line.split(/(?<!\\)\|/).slice(1, -1).map((s) => s.trim().replace(/^`|`$/g, '').replace(/\\\|/g, '|'));
    if (c.length < 4) throw new Error(`ROUTES.md row too short: ${line}`);
    const [method, path, gate, host] = c;
    const k = `${method} ${path}`;
    if (rows.has(k)) throw new Error(`ROUTES.md lists ${k} twice`);
    rows.set(k, { method, path, gate, host });
  }
  return rows;
}

/** Compare routes with the doc rows → list of problems (empty = ✓). */
export function inventoryProblems(list, rows) {
  const problems = [];
  for (const r of list) {
    const row = rows.get(`${r.method} ${r.path}`);
    if (!row) { problems.push(`route with no row in docs/ROUTES.md: ${r.method} ${r.path}  (${r.where})`); continue; }
    if (!GATES.has(row.gate)) problems.push(`unknown gate "${row.gate}" for ${r.method} ${r.path}`);
    if (row.gate === 'staff' && !STAFF_PATH.test(r.path)) problems.push(`${r.method} ${r.path}: gate "staff" is only for /admin/reports/*`);
    if (ADMIN_PATH.test(r.path) && row.gate !== 'admin' && !(row.gate === 'staff' && STAFF_PATH.test(r.path))) {
      problems.push(`${r.method} ${r.path} is an admin path but its gate is "${row.gate}"`);
    }
    // H6a: an admin path answers only on the admin host, and the admin host only admin paths.
    if (!HOSTS.has(row.host)) problems.push(`unknown host "${row.host}" for ${r.method} ${r.path}`);
    else {
      if (['admin', 'staff'].includes(row.gate) && row.host !== 'admin') problems.push(`${r.method} ${r.path}: gate "${row.gate}" must be on host "admin"`);
      if (row.host === 'admin' && !ADMIN_PATH.test(r.path)) problems.push(`${r.method} ${r.path}: host "admin" is only for /admin and /api/v1/admin paths`);
      if (ADMIN_PATH.test(r.path) && row.host !== 'admin') problems.push(`${r.method} ${r.path} is an admin path but its host is "${row.host}"`);
    }
  }
  // UUID-Out-Of-Path-1: no transfer UUID in any path — it travels in X-Transfer-UUID.
  for (const r of list) if (r.path.includes('{uuid}')) problems.push(`${r.method} ${r.path} (${r.where}) takes the transfer UUID in its path — use X-Transfer-UUID`);
  const live = new Set(list.map((r) => `${r.method} ${r.path}`));
  for (const k of rows.keys()) if (!live.has(k)) problems.push(`row with no route (stale?): ${k}`);
  return problems;
}
