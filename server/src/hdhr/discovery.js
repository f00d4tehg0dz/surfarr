'use strict';

// HDHomeRun discovery protocol responder (UDP port 65001).
//
// This is how Plex, Jellyfin, Emby, Channels DVR and the HDHomeRun app itself
// find tuners on the LAN — NOT SSDP. They broadcast a "discover request"
// datagram to 255.255.255.255:65001 and every tuner unicasts a "discover
// reply" back containing its base URL. The media server then fetches
// <base>/discover.json and /lineup.json over HTTP.
//
// Packet layout (libhdhomerun hdhomerun_pkt.h):
//   uint16 BE  type         0x0002 = discover request, 0x0003 = discover reply
//   uint16 BE  length       payload length
//   payload    TLV items:   uint8 tag, varlen length, value
//   uint32 LE  crc32        over the header + payload (standard Ethernet CRC)
//
// TLV lengths: < 128 → one byte; otherwise two bytes:
//   b0 = 0x80 | (len & 0x7F), b1 = len >> 7
//
// Tags we care about:
//   0x01 device_type   uint32 BE   0x00000001 = tuner, 0xFFFFFFFF = wildcard
//   0x02 device_id     uint32 BE   0xFFFFFFFF = wildcard
//   0x10 tuner_count   uint8
//   0x27 lineup_url    string
//   0x2A base_url      string

const dgram = require('dgram');

const HDHR_PORT = 65001;
const TYPE_DISCOVER_REQ = 0x0002;
const TYPE_DISCOVER_RPY = 0x0003;

const TAG_DEVICE_TYPE = 0x01;
const TAG_DEVICE_ID = 0x02;
const TAG_TUNER_COUNT = 0x10;
const TAG_LINEUP_URL = 0x27;
const TAG_BASE_URL = 0x2a;

const DEVICE_TYPE_TUNER = 0x00000001;
const WILDCARD = 0xffffffff;

// ---------------------------------------------------------------------------
// CRC32 (IEEE 802.3, same as zlib) — tiny table implementation, no deps
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// Encoding / decoding
// ---------------------------------------------------------------------------
function encodeLength(len) {
  if (len < 128) return Buffer.from([len]);
  return Buffer.from([0x80 | (len & 0x7f), len >> 7]);
}

function tlv(tag, value) {
  const v = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  return Buffer.concat([Buffer.from([tag]), encodeLength(v.length), v]);
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

function buildPacket(type, tlvs) {
  const payload = Buffer.concat(tlvs);
  const header = Buffer.alloc(4);
  header.writeUInt16BE(type, 0);
  header.writeUInt16BE(payload.length, 2);
  const body = Buffer.concat([header, payload]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32LE(crc32(body), 0);
  return Buffer.concat([body, crc]);
}

/**
 * Parse a datagram. Returns { type, tags: Map<tag, Buffer> } or null when the
 * packet is malformed or its CRC does not match.
 */
function parsePacket(buf) {
  if (!buf || buf.length < 8) return null;
  const type = buf.readUInt16BE(0);
  const length = buf.readUInt16BE(2);
  if (buf.length < 4 + length + 4) return null;
  const body = buf.subarray(0, 4 + length);
  const expected = buf.readUInt32LE(4 + length);
  if (crc32(body) !== expected) return null;

  const tags = new Map();
  let i = 4;
  const end = 4 + length;
  while (i < end) {
    const tag = buf[i++];
    if (i >= end) break;
    let len = buf[i++];
    if (len & 0x80) {
      if (i >= end) break;
      len = (len & 0x7f) | (buf[i++] << 7);
    }
    if (i + len > end) break;
    tags.set(tag, buf.subarray(i, i + len));
    i += len;
  }
  return { type, tags };
}

function buildDiscoverReply({ deviceId, baseUrl, lineupUrl, tunerCount }) {
  const id = parseInt(String(deviceId).replace(/[^0-9a-fA-F]/g, '').slice(0, 8) || '0', 16) >>> 0;
  return buildPacket(TYPE_DISCOVER_RPY, [
    tlv(TAG_DEVICE_TYPE, u32(DEVICE_TYPE_TUNER)),
    tlv(TAG_DEVICE_ID, u32(id)),
    tlv(TAG_TUNER_COUNT, Buffer.from([Math.max(1, Math.min(255, tunerCount | 0))])),
    tlv(TAG_BASE_URL, baseUrl),
    tlv(TAG_LINEUP_URL, lineupUrl),
  ]);
}

function buildDiscoverRequest() {
  return buildPacket(TYPE_DISCOVER_REQ, [tlv(TAG_DEVICE_TYPE, u32(WILDCARD)), tlv(TAG_DEVICE_ID, u32(WILDCARD))]);
}

// Does this request want us? (wildcard or matching type/id)
function requestMatches(tags, ourId) {
  const typeBuf = tags.get(TAG_DEVICE_TYPE);
  const idBuf = tags.get(TAG_DEVICE_ID);
  const wantType = typeBuf && typeBuf.length === 4 ? typeBuf.readUInt32BE(0) : WILDCARD;
  const wantId = idBuf && idBuf.length === 4 ? idBuf.readUInt32BE(0) : WILDCARD;
  if (wantType !== WILDCARD && wantType !== DEVICE_TYPE_TUNER) return false;
  if (wantId !== WILDCARD && wantId !== ourId) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Responder
// ---------------------------------------------------------------------------

/**
 * Start listening for HDHomeRun discover requests.
 *
 * @param {{baseUrl:string, getDeviceId:()=>string, getTunerCount:()=>number}} opts
 * @returns {import('dgram').Socket|null}
 */
function initHdhrDiscovery({ baseUrl, getDeviceId, getTunerCount }) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  socket.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[HDHR] UDP ${HDHR_PORT} is already in use (another tuner emulator or a real HDHomeRun?) — auto-discovery disabled, add the tuner manually by URL.`);
    } else {
      console.warn('[HDHR] Discovery socket error:', err.message);
    }
    try { socket.close(); } catch {}
  });

  socket.on('message', (msg, rinfo) => {
    const pkt = parsePacket(msg);
    if (!pkt || pkt.type !== TYPE_DISCOVER_REQ) return;

    const deviceId = getDeviceId();
    const ourId = parseInt(String(deviceId).replace(/[^0-9a-fA-F]/g, '').slice(0, 8) || '0', 16) >>> 0;
    if (!requestMatches(pkt.tags, ourId)) return;

    const reply = buildDiscoverReply({
      deviceId,
      baseUrl,
      lineupUrl: `${baseUrl}/lineup.json`,
      tunerCount: getTunerCount(),
    });
    socket.send(reply, 0, reply.length, rinfo.port, rinfo.address, (err) => {
      if (err) console.warn('[HDHR] Reply error:', err.message);
    });
  });

  socket.bind(HDHR_PORT, () => {
    try { socket.setBroadcast(true); } catch {}
    console.log(`[HDHR] Discovery responder listening on UDP ${HDHR_PORT} — device ${getDeviceId()} at ${baseUrl}`);
  });

  return socket;
}

module.exports = {
  initHdhrDiscovery,
  // exported for tests / debugging
  buildDiscoverReply,
  buildDiscoverRequest,
  parsePacket,
  crc32,
  HDHR_PORT,
  TYPE_DISCOVER_REQ,
  TYPE_DISCOVER_RPY,
  TAG_BASE_URL,
  TAG_DEVICE_ID,
  TAG_LINEUP_URL,
  TAG_TUNER_COUNT,
  TAG_DEVICE_TYPE,
};
