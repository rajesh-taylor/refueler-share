// worker/src/handlers/btc_price.js
//
// GET /admin/btc-price — live BTC/GBP display ticker for the Navy Office
// growth-signal chart's right-hand Y-axis overlay.
//
// This is DISTINCT from btc_rate.js (the governed API rate-card reference rate,
// KV key btc_ref_rate:current, no TTL, ±20% guard, manual-override + daily cron).
// That rate is deliberately slow-moving and authoritative for pricing. THIS one
// is a throwaway display value: a thin cache in front of CoinGecko so the founder
// dashboard can draw a live-ish price line without hammering the free API.
//
//   · KV cache key : btc:price:gbp   (STATUS_KV, TTL 900s / 15 min)
//   · Source       : CoinGecko free simple/price (no key required)
//   · Response     : { price_gbp: number, cached_at: unix_seconds, source, stale? }
//   · Auth         : X-Admin-Key gated (Share-B10-1 prompt — the chart lives
//                    behind the admin gate, so the ticker rides the same gate).
//
// Cache semantics: the KV entry is written with a 900s TTL. On a cache miss we
// fetch CoinGecko, write the entry, and return it with cached_at = now. On a hit
// we return the cached value untouched. If CoinGecko is unreachable on a miss we
// serve the last-good value from a no-TTL backstop key if we have one, flagged
// stale:true, rather than failing the whole card.

const CACHE_KEY   = 'btc:price:gbp';        // TTL'd hot cache
const BACKSTOP_KEY = 'btc:price:gbp:last';  // no-TTL last-good, for CoinGecko outages
const CACHE_TTL   = 900;                     // 15 min — top of the 600–900s band

const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=gbp';

// Same sanity band as btc_rate.js — a wildly out-of-range value is a glitch, not
// a price. We refuse to cache it and fall back to last-good.
const PRICE_FLOOR = 1_000;
const PRICE_CEIL  = 10_000_000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function err(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// handleAdminBtcPrice — GET /admin/btc-price
// ─────────────────────────────────────────────────────────────────────────────
export async function handleAdminBtcPrice(request, env) {
  // ── Admin key gate ─────────────────────────────────────────────────────────
  const adminKey = request.headers.get('X-Admin-Key');
  if (!adminKey || adminKey !== env.ADMIN_KEY) {
    return err(401, 'Unauthorised.');
  }

  // ── Cache hit ──────────────────────────────────────────────────────────────
  try {
    const cached = await env.STATUS_KV.get(CACHE_KEY, { type: 'json' });
    if (cached && typeof cached.price_gbp === 'number') {
      return json(cached);
    }
  } catch (e) {
    console.error('btc_price: KV read error:', e);
    // Fall through to a live fetch — a KV blip should not blank the chart.
  }

  // ── Cache miss — fetch CoinGecko ────────────────────────────────────────────
  let price;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    let res;
    try {
      res = await fetch(COINGECKO_URL, {
        headers: { 'Accept': 'application/json' },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.ok) {
      const data = await res.json();
      const p = data?.bitcoin?.gbp;
      if (typeof p === 'number' && Number.isFinite(p) && p >= PRICE_FLOOR && p <= PRICE_CEIL) {
        price = p;
      } else {
        console.error('btc_price: CoinGecko value missing/out-of-band:', JSON.stringify(data));
      }
    } else {
      console.error(`btc_price: CoinGecko HTTP ${res.status}`);
    }
  } catch (e) {
    const reason = e?.name === 'AbortError' ? 'timeout' : 'network_error';
    console.error(`btc_price: CoinGecko fetch failed (${reason}):`, e?.message ?? e);
  }

  // ── Fresh value — cache (TTL) + backstop (no TTL) and return ────────────────
  if (price !== undefined) {
    const record = {
      price_gbp: price,
      cached_at: Math.floor(Date.now() / 1000),
      source:    'coingecko',
    };
    try {
      await env.STATUS_KV.put(CACHE_KEY, JSON.stringify(record), { expirationTtl: CACHE_TTL });
      await env.STATUS_KV.put(BACKSTOP_KEY, JSON.stringify(record)); // no TTL — survives outages
    } catch (e) {
      console.error('btc_price: KV write error:', e);
    }
    return json(record);
  }

  // ── CoinGecko unreachable — serve last-good backstop, flagged stale ─────────
  try {
    const backstop = await env.STATUS_KV.get(BACKSTOP_KEY, { type: 'json' });
    if (backstop && typeof backstop.price_gbp === 'number') {
      return json({ ...backstop, stale: true });
    }
  } catch (e) {
    console.error('btc_price: backstop read error:', e);
  }

  // Nothing cached and CoinGecko is down — honest 503 so the chart can hide the
  // overlay rather than draw a fabricated line.
  return err(503, 'BTC price temporarily unavailable.');
}
