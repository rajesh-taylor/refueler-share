// Lightweight HTTP server — PostgREST subset used by the Worker.
// Pure Node http — no framework.

import { createServer } from 'node:http';

const spentSerials = new Set();
const subscribers = new Map();

export function startSupabaseMock() {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;

      let body = '';
      req.on('data', d => { body += d; });
      req.on('end', () => {

        // ── GET /rest/v1/spent_tokens ─────────────────────────────────────
        // Worker: GET /rest/v1/spent_tokens?serial=eq.<hex>&select=serial
        // Returns [] if not spent, [{ serial }] if spent.
        if (req.method === 'GET' && path === '/rest/v1/spent_tokens') {
          const serialParam = url.searchParams.get('serial') ?? '';
          const serial = serialParam.replace(/^eq\./, '');
          const rows = spentSerials.has(serial) ? [{ serial }] : [];
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(rows));
          return;
        }

        // ── POST /rest/v1/spent_tokens (melt) ────────────────────────────
        if (req.method === 'POST' && path === '/rest/v1/spent_tokens') {
          try {
            const { serial } = JSON.parse(body);
            if (spentSerials.has(serial)) {
              res.writeHead(409, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'duplicate' }));
              return;
            }
            spentSerials.add(serial);
            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end('[]');
          } catch {
            res.writeHead(400); res.end('{}');
          }
          return;
        }

        // ── POST /rest/v1/double_spend_attempts ───────────────────────────
        if (req.method === 'POST' && path === '/rest/v1/double_spend_attempts') {
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end('[]');
          return;
        }

        // ── GET /rest/v1/double_spend_attempts ────────────────────────────
        if (req.method === 'GET' && path === '/rest/v1/double_spend_attempts') {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Range': `0-0/0` });
          res.end('[]');
          return;
        }

        // ── POST /rest/v1/subscribers (upsert) ───────────────────────────
        if (req.method === 'POST' && path === '/rest/v1/subscribers') {
          try {
            const row = JSON.parse(body);
            subscribers.set(row.stripe_customer_id ?? row.email, row);
            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end('[]');
          } catch {
            res.writeHead(400); res.end('{}');
          }
          return;
        }

        // ── GET /rest/v1/subscribers ──────────────────────────────────────
        if (req.method === 'GET' && path === '/rest/v1/subscribers') {
          const email = (url.searchParams.get('email') ?? '').replace(/^eq\./, '');
          const match = [...subscribers.values()].find(s => s.email === email);
          const rows = match ? [match] : [];
          const total = rows.length;
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Content-Range': `0-${Math.max(0, total - 1)}/${total}`,
          });
          res.end(JSON.stringify(rows));
          return;
        }

        // ── Fallback ──────────────────────────────────────────────────────
        console.error(`[supabase-mock] No handler: ${req.method} ${path}`);
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `mock: no handler for ${req.method} ${path}` }));
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const url = `http://127.0.0.1:${port}`;
      resolve({
        url,
        server,
        reset() {
          spentSerials.clear();
          subscribers.clear();
        },
      });
    });

    server.on('error', reject);
  });
}
