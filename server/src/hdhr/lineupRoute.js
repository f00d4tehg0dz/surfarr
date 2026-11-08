'use strict';

// GET /lineup.json — Channel list for Plex/Jellyfin tuner
// GET /lineup_status.json — Tuner scan status
//
// Each entry in lineup.json maps a channel number to a stream URL.
// Plex will GET that URL when the user tunes to the channel.

const express = require('express');
const router = express.Router();
const config = require('../config');
const { getDb } = require('../db/lowdb');

router.get('/lineup.json', (req, res) => {
  const db = getDb();
  const hostIp = config.getLocalIp();

  // Only advertise channels that are enabled AND have cached videos.
  // Plex/Jellyfin auto-scan the lineup and tune each channel — advertising a
  // channel with no videos returns 503 from streamManager and shows up as a
  // failed tuner in the UI.
  const enabledChannels = db.data.channels.filter((ch) =>
    ch.enabled && (ch.isLive ? !!ch.liveVideoId : ch.cachedVideos && ch.cachedVideos.length > 0)
  );
  const baseUrl = config.getAdvertiseUrl(config.port);
  const lineup = enabledChannels.map((ch) => ({
    GuideNumber: String(ch.channelNumber),
    GuideName: ch.name,
    HD: 1,
    URL: `${baseUrl}/stream/${ch.id}`,
  }));

  res.json(lineup);
});

router.get('/lineup_status.json', (req, res) => {
  res.json({
    ScanInProgress: 0,
    ScanPossible: 1,
    Source: 'Cable',
    SourceList: ['Cable'],
  });
});

module.exports = router;

