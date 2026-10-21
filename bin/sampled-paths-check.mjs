#!/usr/bin/env node
// bin/sampled-paths-check.mjs — UUID-Out-Of-Path-1 · 21 Oct 2026.
//
// What Cloudflare's sampled HTTP-request records hold for api.share.refueler.io:
//   1. every distinct path seen since --since (default: the last hour) — fails if any
//      holds a UUID (none should after deploy 2);
//   2. which request fields the dataset offers at all — any field for a query string
//      or a request header is printed (OSA risk assessment §2).
// Read-only. Token: an API token with Zone → Analytics → Read on refueler.io, typed at
// a hidden prompt (never a placeholder, never saved):
//
//   read -s "CF_ANALYTICS_TOKEN?Analytics token: " && export CF_ANALYTICS_TOKEN && node bin/sampled-paths-check.mjs
//   node bin/sampled-paths-check.mjs --since 2026-10-21T17:20:00Z

const TOKEN = process.env.CF_ANALYTICS_TOKEN;
if (!TOKEN) { console.error('Set CF_ANALYTICS_TOKEN first (hidden prompt — see the top of this file).'); process.exit(1); }
const HOST = 'api.share.refueler.io';
const i = process.argv.indexOf('--since');
const since = i > 0 ? process.argv[i + 1] : new Date(Date.now() - 3600_000).toISOString().replace(/\.\d+Z$/, 'Z');
const UUIDISH = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

async function cf(path, init = {}) {
  const r = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const j = await r.json();
  if (!r.ok || j.success === false || j.errors?.length) throw new Error(JSON.stringify(j.errors ?? j).slice(0, 400));
  return j;
}
const gql = (query, variables = {}) => cf('/graphql', { method: 'POST', body: JSON.stringify({ query, variables }) }).then((j) => j.data);

const zone = (await cf('/zones?name=refueler.io')).result?.[0]?.id;
if (!zone) { console.error('✗ zone refueler.io not visible to this token'); process.exit(1); }

// 1. Distinct paths on the API host since `since`.
const d = await gql(`query ($zone: string!, $since: Time!, $host: string!) {
  viewer { zones(filter: { zoneTag: $zone }) {
    httpRequestsAdaptiveGroups(limit: 1000, orderBy: [count_DESC],
      filter: { datetime_geq: $since, clientRequestHTTPHost: $host }) {
      count dimensions { clientRequestPath } } } } }`, { zone, since, host: HOST });
const rows = d.viewer.zones[0]?.httpRequestsAdaptiveGroups ?? [];
console.log(`${HOST} — sampled paths since ${since}:`);
for (const r of rows) console.log(`  ${String(r.count).padStart(6)}  ${r.dimensions.clientRequestPath.replace(UUIDISH, '{uuid}')}`);
const bad = rows.filter((r) => UUIDISH.test(r.dimensions.clientRequestPath));

// 2. Fields the dataset offers: anything for a query string or a header?
const t = await gql(`{ __type(name: "ZoneHttpRequestsAdaptiveGroupsDimensions") { fields { name } } }`);
const fields = (t.__type?.fields ?? []).map((f) => f.name);
const flagged = fields.filter((n) => /query|header|uri|args|cookie|referer|useragent/i.test(n));
console.log(`\nfields offered: ${fields.length}; query/header-like: ${flagged.length ? flagged.join(', ') : 'none'}`);

if (bad.length) { console.error(`\n✗ ${bad.length} path(s) with a UUID since ${since}`); process.exit(1); }
console.log(rows.length ? `\n✓ no UUID in any sampled ${HOST} path since ${since}` : `\n⚠ no sampled rows since ${since} — open a link, wait a few minutes, run again`);
