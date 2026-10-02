'use strict';

const { buildChannelGrid } = require('../channels/channelGrid');

// Default schema written to db.json on first boot.
// Remote API data (cachedVideos) is populated later by dailySync.
function getDefaultSchema() {
  return {
    settings: {
      remoteApiUrl: process.env.REMOTE_API_URL || '',
      deviceName: process.env.DEVICE_NAME || 'SurfArr',
      streamQuality: process.env.STREAM_QUALITY || '720p',
      tunerCount: parseInt(process.env.TUNER_COUNT, 10) || 4,
    },
    // All 50 channels pre-populated from the grid definition.
    // Users enable/disable and tweak settings per channel.
    channels: buildChannelGrid(),
    reports: [],
    lastSync: null,
    // START_EPOCH is the Unix ms timestamp from which all channel
    // playheads are calculated. Set once on first boot, never changed.
    startEpoch: 0,
  };
}

module.exports = { getDefaultSchema };