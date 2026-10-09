// worker/src/webhook_url.js
//
// Webhook URL rules. Checked at registration AND again at every delivery
// (API-Repair-1): a stored URL is KV data, so it is re-validated before the
// Worker sends anything to it.
//
// Rejects: non-HTTPS, localhost, IPv4 private / loopback / link-local /
// unspecified (dotted-quad literals), and IPv6 literals in loopback,
// unspecified, unique-local (fc00::/7), link-local (fe80::/10) or IPv4-mapped
// form. No DNS resolution: a private address behind a public name is not
// caught here.

function isPrivateIpv4(hostname) {
  const octets = hostname.split('.').map(Number);
  if (octets.length !== 4 || octets.some(o => !Number.isInteger(o) || o < 0 || o > 255)) {
    return false; // not a dotted-quad
  }
  const [a, b] = octets;
  if (a === 10)                         return true; // RFC1918 10/8
  if (a === 172 && b >= 16 && b <= 31)  return true; // RFC1918 172.16/12
  if (a === 192 && b === 168)           return true; // RFC1918 192.168/16
  if (a === 127)                        return true; // loopback 127/8
  if (a === 169 && b === 254)           return true; // link-local 169.254/16
  if (a === 0)                          return true; // unspecified 0/8
  return false;
}

// URL() keeps IPv6 hosts bracketed and compressed, e.g. "[::1]", "[fe80::1]".
function isBlockedIpv6(hostname) {
  if (!hostname.startsWith('[') || !hostname.endsWith(']')) return false;
  const h = hostname.slice(1, -1).toLowerCase();
  if (h === '::' || h === '::1') return true;            // unspecified, loopback
  if (h.startsWith('::ffff:')) return true;              // IPv4-mapped
  if (/^f[cd][0-9a-f]{0,2}:/.test(h)) return true;       // fc00::/7
  if (/^fe[89ab][0-9a-f]?:/.test(h)) return true;        // fe80::/10
  return false;
}

/**
 * validateWebhookUrl(raw) → { ok: true, url: URL } | { ok: false, error }
 */
export function validateWebhookUrl(raw) {
  if (!raw || typeof raw !== 'string') {
    return { ok: false, error: 'url is required' };
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: 'url is not a valid URL' };
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'url must use HTTPS' };
  }

  const hostname = parsed.hostname.toLowerCase();

  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return { ok: false, error: 'url must not target localhost' };
  }

  if (isPrivateIpv4(hostname) || isBlockedIpv6(hostname)) {
    return { ok: false, error: 'url must not target a private or loopback IP address' };
  }

  return { ok: true, url: parsed };
}
