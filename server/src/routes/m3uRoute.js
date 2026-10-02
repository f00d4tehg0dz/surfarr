'use strict';

// GET /playlist.m3u
// M3U playlist for Jellyfin/Emby/VLC users who prefer manual IPTV import
// over HDHomeRun emulation. Contains all enabled channels.

const express = require('express');
const router = express.Router();
const config = require('../config');
const { getDb } = require('../db/lowdb');

// Both names are served: README/Plex users know it as lineup.m3u, the
// dashboard historically linked playlist.m3u.
router.get(['/playlist.m3u', '/lineup.m3u'], (req, res) => {
  const db = getDb();
  const hostIp = config.getLocalIp();

  // Mirrors lineup.json: only emit channels that actually have videos so IPTV
  // clients don't import a stack of broken entries on a cold boot.
  const enabledChannels = db.data.channels.filter((ch) =>
    ch.enabled && (ch.isLive ? !!ch.liveVideoId : ch.cachedVideos && ch.cachedVideos.length > 0)
  );

  let m3u = '#EXTM3U x-tvg-url="http://' + hostIp + ':' + config.port + '/epg.xml"\n\n';

  for (const ch of enabledChannels) {
    const group = ch.isLive ? 'Live' : ch.isPlugin ? 'Plugins' : ch.isStandalone ? 'Curated' : ch.decade || 'SurfArr';
    const name = String(ch.name).replace(/"/g, "'");
    m3u += `#EXTINF:-1 tvg-id="ch${ch.channelNumber}" tvg-name="${name}" tvg-chno="${ch.channelNumber}" group-title="${group}",${ch.name}\n`;
    m3u += `http://${hostIp}:${config.port}/stream/${ch.id}\n\n`;
  }

  res.setHeader('Content-Type', 'audio/x-mpegurl');
  res.setHeader('Content-Disposition', 'attachment; filename="surfarr.m3u"');
  res.send(m3u);
});

module.exports = router;