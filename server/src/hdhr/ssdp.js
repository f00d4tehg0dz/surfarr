'use strict';

// HDHomeRun SSDP broadcaster using raw Node.js dgram (no external package).
//
// SSDP (Simple Service Discovery Protocol) uses UDP multicast to announce
// the device's presence to Plex, Jellyfin, and Emby on the local network.
//
// Discovery handshake:
//   1. SurfArr broadcasts NOTIFY to 239.255.255.250:1900 every 30s
//   2. Plex/Jellyfin sends M-SEARCH to 239.255.255.250:1900
//   3. SurfArr responds with unicast HTTP 200 OK to the requester
//   4. Plex fetches /discover.json then /lineup.json over HTTP

const dgram = require('dgram');

const SSDP_ADDR = '239.255.255.250';
const SSDP_PORT = 1900;
const ANNOUNCE_INTERVAL_MS = 30000;

function buildNotifyAlive(hostIp, port, deviceId) {
  return [
    'NOTIFY * HTTP/1.1',
    `HOST: ${SSDP_ADDR}:${SSDP_PORT}`,
    'CACHE-CONTROL: max-age=1800',
    `LOCATION: http://${hostIp}:${port}/discover.json`,
    'NT: urn:schemas-upnp-org:device:MediaServer:1',
    'NTS: ssdp:alive',
    'SERVER: SurfArr/1.0 UPnP/1.0',
    `USN: uuid:${deviceId}::urn:schemas-upnp-org:device:MediaServer:1`,
    '',
    '',
  ].join('\r\n');
}

function buildSearchResponse(hostIp, port, deviceId) {
  return [
    'HTTP/1.1 200 OK',
    'CACHE-CONTROL: max-age=1800',
    `LOCATION: http://${hostIp}:${port}/discover.json`,
    'EXT:',
    'SERVER: SurfArr/1.0 UPnP/1.0',
    `USN: uuid:${deviceId}::urn:schemas-upnp-org:device:MediaServer:1`,
    'ST: urn:schemas-upnp-org:device:MediaServer:1',
    '',
    '',
  ].join('\r\n');
}

function initSSDP(hostIp, port, deviceId) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  socket.on('error', (err) => {
    // SSDP is a best-effort service — log and continue if it fails
    console.error('[SSDP] Socket error:', err.message);
  });

  socket.on('message', (msg, rinfo) => {
    const message = msg.toString();
    if (!message.startsWith('M-SEARCH')) return;

    const wantsUs =
      message.includes('ssdp:all') ||
      message.includes('upnp:rootdevice') ||
      message.includes('MediaServer') ||
      message.includes('HDHomeRun') ||
      message.includes('hdhomerun');

    if (!wantsUs) return;

    const response = buildSearchResponse(hostIp, port, deviceId);
    const buf = Buffer.from(response);
    // Respond directly to the requester (unicast)
    socket.send(buf, 0, buf.length, rinfo.port, rinfo.address, (err) => {
      if (err) console.error('[SSDP] Search response error:', err.message);
    });
  });

  socket.bind(SSDP_PORT, () => {
    try {
      socket.addMembership(SSDP_ADDR);
      socket.setMulticastTTL(4);
      socket.setMulticastLoopback(false);
    } catch (err) {
      // On some systems (Docker bridge mode, Windows) membership may fail —
      // HTTP-based discovery still works even without multicast
      console.warn('[SSDP] Multicast setup warning:', err.message);
    }

    const announce = () => {
      const buf = Buffer.from(buildNotifyAlive(hostIp, port, deviceId));
      socket.send(buf, 0, buf.length, SSDP_PORT, SSDP_ADDR, (err) => {
        if (err) console.error('[SSDP] Announce error:', err.message);
      });
    };

    announce();
    setInterval(announce, ANNOUNCE_INTERVAL_MS);
    console.log(`[SSDP] Broadcasting on ${SSDP_ADDR}:${SSDP_PORT} — device ${deviceId}`);
  });

  return socket;
}

module.exports = { initSSDP };