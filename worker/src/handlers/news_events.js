/**
 * news_events.js — GET/POST/DELETE /admin/news-events
 * worker/src/handlers/news_events.js
 *
 * Share-Dash-2. Manual data points for the Navy Office growth-signal card. One
 * unified KV array (admin:news_events) does two jobs (confirmed Share-Dash-2):
 *   · a row with free/paid/api counts plots a point on the three-line chart
 *   · a row with a label/note renders as a vertical tick-mark annotation
 *   · a row may be both
 *
 * Entry shape: { id, date, label, note, free?, paid?, api?, created_at }
 *   · id         — server-generated (crypto.randomUUID)
 *   · date       — 'YYYY-MM-DD' (the x-axis position; required)
 *   · label      — short annotation title (optional)
 *   · note       — longer annotation text (optional)
 *   · free/paid/api — integer user counts at that date (optional; omit for a
 *                     pure annotation)
 *
 * X-Admin-Key gated on every method. index.js routes:
 *   GET    /admin/news-events        → list (date-ascending, for charting)
 *   POST   /admin/news-events        → append one entry
 *   DELETE /admin/news-events/:id    → remove by id  (id passed in by router)
 */

const NEWS_KEY = 'admin:news_events';

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

function isAdmin(request, env) {
  const adminKey = request.headers.get('X-Admin-Key');
  return !!adminKey && adminKey === env.ADMIN_KEY;
}

async function readEvents(env) {
  const raw = await env.STATUS_KV.get(NEWS_KEY, { type: 'json' });
  return Array.isArray(raw) ? raw : [];
}

// Optional non-negative integer, or undefined if the field is absent/blank.
function optCount(v) {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

export async function handleNewsEvents(request, env, id) {
  if (!isAdmin(request, env)) return jsonResponse({ error: 'Unauthorised' }, 401);

  // ── GET — list, date-ascending ─────────────────────────────────────────────
  if (request.method === 'GET') {
    let events;
    try {
      events = await readEvents(env);
    } catch (e) {
      console.error('news-events KV read failed:', e);
      return jsonResponse({ error: 'Failed to read events' }, 502);
    }
    events.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return jsonResponse({ events });
  }

  // ── POST — append one entry ────────────────────────────────────────────────
  if (request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid JSON' }, 400); }

    const date = typeof body?.date === 'string' ? body.date.trim() : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return jsonResponse({ error: 'date is required as YYYY-MM-DD' }, 400);
    }

    const label = typeof body?.label === 'string' ? body.label.slice(0, 120) : '';
    const note  = typeof body?.note  === 'string' ? body.note.slice(0, 500)  : '';
    const free  = optCount(body?.free);
    const paid  = optCount(body?.paid);
    const api   = optCount(body?.api);

    // Reject an empty row — must carry at least one count or some text.
    if (!label && !note && free === undefined && paid === undefined && api === undefined) {
      return jsonResponse({ error: 'entry must include a label/note or at least one count' }, 400);
    }

    const entry = { id: crypto.randomUUID(), date, label, note, created_at: Math.floor(Date.now() / 1000) };
    if (free !== undefined) entry.free = free;
    if (paid !== undefined) entry.paid = paid;
    if (api  !== undefined) entry.api  = api;

    try {
      const events = await readEvents(env);
      events.push(entry);
      await env.STATUS_KV.put(NEWS_KEY, JSON.stringify(events));
    } catch (e) {
      console.error('news-events KV write failed:', e);
      return jsonResponse({ error: 'Failed to save event' }, 502);
    }
    return jsonResponse({ ok: true, event: entry }, 201);
  }

  // ── DELETE — remove by id ──────────────────────────────────────────────────
  if (request.method === 'DELETE') {
    if (!id) return jsonResponse({ error: 'Missing event id' }, 400);
    try {
      const events  = await readEvents(env);
      const next    = events.filter(e => e && e.id !== id);
      const removed = events.length - next.length;
      if (removed === 0) return jsonResponse({ error: 'Not found' }, 404);
      await env.STATUS_KV.put(NEWS_KEY, JSON.stringify(next));
      return jsonResponse({ ok: true, removed });
    } catch (e) {
      console.error('news-events KV delete failed:', e);
      return jsonResponse({ error: 'Failed to delete event' }, 502);
    }
  }

  return jsonResponse({ error: 'Method not allowed' }, 405);
}
