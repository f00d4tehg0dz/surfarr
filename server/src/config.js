'use strict';

// Load server/.env (if present) WITHOUT overriding real environment variables —
// values passed by Docker / the shell always win over the file.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env'), override: false });

const os = require('os');
const crypto = require('crypto');
const fs = require('fs');
const binaries = require('./binaries');

// ---------------------------------------------------------------------------
// HDHomeRun device ID
//
// Must be a stable 8-hex-char (32-bit) value: Plex treats a changed ID as a
// brand-new tuner. The authoritative value lives in db.json (see lowdb.js);
// what we compute here is only the seed for a fresh install, or the legacy
// MAC-derived value used to migrate an existing install without changing it.
// ---------------------------------------------------------------------------

// libhdhomerun's device-ID checksum (hdhomerun_discover_validate_device_id):
// alternate nibbles go through a lookup table, everything is XORed together
// and the result must be 0. Real tuners satisfy this; some clients validate it.
const HDHR_LOOKUP = [0xa, 0x5, 0xf, 0x6, 0x7, 0xc, 0x1, 0xb, 0x9, 0x2, 0x8, 0xd, 0x4, 0x3, 0xe, 0x0];

function hdhrChecksum(id) {
  let c = 0;
  c ^= HDHR_LOOKUP[(id >>> 28) & 0xf];
  c ^= (id >>> 24) & 0xf;
  c ^= HDHR_LOOKUP[(id >>> 20) & 0xf];
  c ^= (id >>> 16) & 0xf;
  c ^= HDHR_LOOKUP[(id >>> 12) & 0xf];
  c ^= (id >>> 8) & 0xf;
  c ^= HDHR_LOOKUP[(id >>> 4) & 0xf];
  c ^= id & 0xf;
  return c & 0xf;
}

function isValidDeviceId(hex) {
  if (!/^[0-9A-Fa-f]{8}$/.test(hex)) return false;
  return hdhrChecksum(parseInt(hex, 16) >>> 0) === 0;
}

// Adjust the low nibble of a 32-bit value so the checksum passes.
function makeValidDeviceId(seed32) {
  const base = (seed32 >>> 0) & 0xfffffff0;
  for (let n = 0; n < 16; n++) {
    const candidate = (base | n) >>> 0;
    if (hdhrChecksum(candidate) === 0) {
      return candidate.toString(16).toUpperCase().padStart(8, '0');
    }
  }
  return base.toString(16).toUpperCase().padStart(8, '0');
}

function firstMac() {
  const interfaces = os.networkInterfaces();
  for (const ifaces of Object.values(interfaces)) {
    for (const addr of ifaces) {
      if (!addr.internal && addr.mac && addr.mac !== '00:00:00:00:00:00') return addr.mac;
    }
  }
  return null;
}

// The pre-v1.1 derivation (first 8 hex chars of md5(mac)). Kept so upgraded
// installs keep the exact ID their media server already knows.
function legacyDeviceId() {
  const mac = firstMac();
  if (!mac) return 'RETRO001';
  return crypto.createHash('md5').update(mac).digest('hex').substring(0, 8).toUpperCase();
}

// Fresh-install ID: MAC-seeded (stable across restarts) with a valid checksum.
function freshDeviceId() {
  const mac = firstMac() || os.hostname();
  // Keep the old 'retroarr:' seed so the tuner ID doesn't change after the SurfArr rename
  // (a new ID makes Plex/Jellyfin treat it as a brand-new tuner and drop channel mappings).
  const hash = crypto.createHash('md5').update(`retroarr:${mac}`).digest();
  // Keep the top nibble at 1 like real Silicondust IDs (1xxxxxxx)
  const seed = ((hash.readUInt32BE(0) & 0x0fffffff) | 0x10000000) >>> 0;
  return makeValidDeviceId(seed);
}

// Resolve the host machine's non-loopback IPv4 address for discovery
// announcements. ADVERTISE_IP overrides auto-detection (useful in Docker
// bridge mode where the container IP is not reachable from the LAN).
function getLocalIp() {
  if (process.env.ADVERTISE_IP) return process.env.ADVERTISE_IP.trim();
  const interfaces = os.networkInterfaces();
  let fallback = null;
  for (const [name, ifaces] of Object.entries(interfaces)) {
    for (const addr of ifaces) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      // Prefer real NICs over docker/virtual bridges when we have a choice
      if (/^(docker|br-|veth|virbr|vmnet|vboxnet)/i.test(name)) {
        fallback = fallback || addr.address;
        continue;
      }
      return addr.address;
    }
  }
  return fallback || '127.0.0.1';
}

function envInt(name, def) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) ? v : def;
}

function envBool(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  return !/^(0|false|no|off)$/i.test(String(v).trim());
}

// Split "--foo bar --baz 'x y'" into argv, honouring simple quotes.
function splitArgs(str) {
  if (!str) return [];
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(str))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

// ---------------------------------------------------------------------------
// External binaries
// ---------------------------------------------------------------------------
const ytdlpResolved = binaries.resolveYtDlp();
const ffmpegResolved = binaries.resolveFfmpeg();

const cookiesFile = process.env.YTDLP_COOKIES ? path.resolve(process.env.YTDLP_COOKIES) : null;
const binaryWarnings = [...ytdlpResolved.warnings, ...ffmpegResolved.warnings];
if (cookiesFile && !fs.existsSync(cookiesFile)) {
  binaryWarnings.push(`YTDLP_COOKIES="${cookiesFile}" does not exist — continuing without cookies.`);
}

const config = {
  port: envInt('PORT', 8888),
  host: process.env.HOST || '0.0.0.0',
  remoteApiUrl: process.env.REMOTE_API_URL || '',

  // Seed only — lowdb.js replaces this with the persisted value at boot.
  deviceId: process.env.DEVICE_ID ? process.env.DEVICE_ID.toUpperCase() : freshDeviceId(),
  deviceName: process.env.DEVICE_NAME || 'SurfArr',
  streamQuality: process.env.STREAM_QUALITY || '720p',
  tunerCount: envInt('TUNER_COUNT', 4),

  // Binaries (resolved, never a blind env string)
  ytdlpPath: ytdlpResolved.command,
  ytdlpPrefixArgs: ytdlpResolved.prefixArgs,
  ytdlpSource: ytdlpResolved.source,
  ffmpegPath: ffmpegResolved.command,
  ffprobePath: ffmpegResolved.ffprobe,
  ffmpegSource: ffmpegResolved.source,
  binaryWarnings,

  // yt-dlp behaviour
  ytdlpCookies: cookiesFile && fs.existsSync(cookiesFile) ? cookiesFile : null,
  ytdlpExtraArgs: splitArgs(process.env.YTDLP_EXTRA_ARGS),
  // 'auto' → enable node as an EJS runtime when yt-dlp supports it; 'deno'/'node'/'none'
  ytdlpJsRuntime: (process.env.YTDLP_JS_RUNTIME || 'auto').toLowerCase(),
  ytdlpTimeoutMs: envInt('YTDLP_TIMEOUT_MS', 90000),
  ytdlpPlaylistLimit: envInt('YTDLP_PLAYLIST_LIMIT', 1000),

  // Discovery
  enableSsdp: envBool('ENABLE_SSDP', true),
  enableHdhrDiscovery: envBool('ENABLE_HDHR_DISCOVERY', true),

  dbPath: process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.join(__dirname, '../db/db.json'),
  // Installed plugin configs. Defaults to <repo>/plugins; Docker points this
  // into the persisted volume so installs survive container recreation.
  pluginsDir: process.env.PLUGINS_DIR
    ? path.resolve(process.env.PLUGINS_DIR)
    : path.join(binaries.REPO_ROOT, 'plugins'),
  pluginRepoDir: path.join(binaries.REPO_ROOT, 'plugin-repo'),
  commercialsDir: process.env.COMMERCIALS_DIR
    ? path.resolve(process.env.COMMERCIALS_DIR)
    : path.join(__dirname, '../data/commercials'),
  cacheRefreshHours: envInt('CACHE_REFRESH_HOURS', 24),

  platform: process.platform,
  getLocalIp,
  legacyDeviceId,
  freshDeviceId,
  isValidDeviceId,
};

module.exports = config;
