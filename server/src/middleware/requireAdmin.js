'use strict';

// Guard for everything that changes state or spawns work on the server:
// installing/uninstalling plugins, settings, channel edits, syncs, reports and
// the /api/debug tools. Reading the lineup, guide, M3U and streams stays open
// so Plex / Jellyfin / Emby / IPTV apps keep working without credentials.
//
// Two modes:
//   ADMIN_TOKEN set  → requests must send it (header `X-Admin-Key: <token>` or
//                      `Authorization: Bearer <token>`). Use this whenever the
//                      dashboard is reachable from outside your LAN.
//   ADMIN_TOKEN unset → only clients on a local/private network may change
//                      things (loopback, RFC1918, CGNAT/Tailscale 100.64/10,
//                      link-local, IPv6 ULA). A request that arrives through a
//                      reverse proxy (X-Forwarded-For & co.) is refused unless
//                      TRUST_PROXY is configured, because behind a proxy every
//                      caller would otherwise look like 127.0.0.1.
//
// PLUGIN_ADMIN_KEY is accepted as an alias of ADMIN_TOKEN.
// Based on the report in f00d4tehg0dz/surfarr PR #1 (CWE-862).

const crypto = require('crypto');

const TOKEN = process.env.ADMIN_TOKEN || process.env.PLUGIN_ADMIN_KEY || '';
const TRUST_PROXY = !!(process.env.TRUST_PROXY && process.env.TRUST_PROXY !== '0' && process.env.TRUST_PROXY !== 'false');

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function isLocalAddress(ip) {
  const addr = String(ip || '').toLowerCase().replace(/^::ffff:/, '').replace(/%.*$/, '');
  if (!addr) return false;
  if (addr === '::1' || addr === 'localhost') return true;
  const v4 = addr.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [+v4[1], +v4[2]];
    return a === 127 || a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||               // link-local
      (a === 100 && b >= 64 && b <= 127);       // CGNAT (Tailscale, etc.)
  }
  return /^f[cd][0-9a-f]{2}:/.test(addr) ||      // fc00::/7 unique-local
    /^fe[89ab][0-9a-f]:/.test(addr);            // fe80::/10 link-local
}

function looksProxied(req) {
  return !!(req.headers['x-forwarded-for'] || req.headers.forwarded || req.headers['x-real-ip']);
}

function requireAdmin(req, res, next) {
  if (TOKEN) {
    const header = req.get('x-admin-key') || (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (header && safeEqual(header, TOKEN)) return next();
    return res.status(401).json({ error: 'Admin key required', code: 'ADMIN_KEY' });
  }
  if (looksProxied(req) && !TRUST_PROXY) {
    return res.status(403).json({
      error: 'This request came through a reverse proxy. Set ADMIN_TOKEN (recommended) or TRUST_PROXY so SurfArr can tell who is asking.',
      code: 'PROXY_UNTRUSTED',
    });
  }
  if (isLocalAddress(req.ip)) return next();
  return res.status(403).json({
    error: 'Changes are only allowed from your local network. Set ADMIN_TOKEN to manage SurfArr remotely.',
    code: 'NOT_LOCAL',
  });
}

// Mount on /api: reads pass, anything that changes state (or /api/debug) is guarded
function guardApi(req, res, next) {
  const readOnly = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
  if (readOnly && !req.path.startsWith('/debug')) return next();
  return requireAdmin(req, res, next);
}

module.exports = { requireAdmin, guardApi, isLocalAddress, adminTokenConfigured: !!TOKEN };
