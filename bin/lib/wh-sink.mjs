// bin/lib/wh-sink.mjs — on-demand webhook sink for live checks (API-Repair-1 · 9 Oct 2026).
//
// A local HTTP server behind the named Cloudflare tunnel `refueler-wh-sink`
// (hostname wh-sink.refueler.io, CNAME → <tunnel id>.cfargotunnel.com).
// The tunnel runs only while a check runs; nothing listens otherwise.
// --protocol http2: QUIC (UDP) to the edge times out from this Mac (Mullvad);
// that, not the Worker, was the HTTP 530 seen with a quick tunnel.
//
// Only POST to a random per-run path is recorded; everything else is 404, so
// a stray request while the tunnel is up learns nothing and records nothing.
//
//   const sink = await startSink();
//   sink.url                      // https://wh-sink.refueler.io/<random>
//   await sink.waitFor('cargo.accepted')   // → { headers, body } | null
//   sink.events                   // every recorded POST
//   sink.close()

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const TUNNEL = process.env.WH_SINK_TUNNEL ?? 'refueler-wh-sink';
const HOST   = process.env.WH_SINK_HOST   ?? 'wh-sink.refueler.io';
const sleep  = (ms) => new Promise(r => setTimeout(r, ms));

export async function startSink({ readyTimeoutMs = 45_000 } = {}) {
  const path   = `/${randomBytes(16).toString('hex')}`;
  const events = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      if (req.url === path && req.method === 'POST') {
        events.push({ headers: req.headers, body });
        res.writeHead(200).end('ok');
      } else if (req.url === `${path}/ready` && req.method === 'GET') {
        res.writeHead(200).end('ready');
      } else {
        res.writeHead(404).end();
      }
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const tunnel = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', `http://127.0.0.1:${port}`, 'run', TUNNEL],
                       { stdio: ['ignore', 'ignore', 'pipe'] });
  let tunnelLog = '';
  tunnel.stderr.on('data', d => { tunnelLog = (tunnelLog + d).slice(-4000); });

  const close = () => { tunnel.kill(); server.close(); };
  const url = `https://${HOST}${path}`;

  // Ready = a request through Cloudflare's edge reaches this process.
  const end = Date.now() + readyTimeoutMs;
  for (;;) {
    try { if ((await fetch(`${url}/ready`)).ok) break; } catch { /* not yet */ }
    if (Date.now() > end || tunnel.exitCode !== null) {
      close();
      throw new Error(`wh-sink not reachable at https://${HOST} — is the CNAME in place?\n${tunnelLog.slice(-800)}`);
    }
    await sleep(1000);
  }

  async function waitFor(event, ms = 30_000) {
    const stop = Date.now() + ms;
    while (Date.now() < stop) {
      const e = events.find(x => { try { return JSON.parse(x.body).event === event; } catch { return false; } });
      if (e) return e;
      await sleep(500);
    }
    return null;
  }

  return { url, events, waitFor, close };
}
