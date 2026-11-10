'use strict';

// GET /config — global app configuration for SurfArr servers and mobile/TV clients
//
// Returns the shared START_EPOCH and channel grid definition.
// All clients must use the same epoch to produce identical
// "now playing" calculations via the seeded shuffle algorithm.

const express = require('express');
const router = express.Router();
const { PluginChannel, LiveChannel } = require('../db/mongodb');
const { DECADES, CATEGORIES } = require('../channels/disabled');
const lineup = require('../channels/lineup');

// Fixed epoch — Jan 1, 2024 00:00:00 UTC. Set once, never change.
const START_EPOCH = 1704067200000;

router.get('/', async (req, res, next) => {
  try {
    // Fixed list, or (CHANNEL_GRID_MODE=auto) every channel that has videos
    const channelGrid = await lineup.channelGrid();

    const plugins = await PluginChannel.find({ enabled: true })
      .select('pluginId name description channelNumber author tags icon')
      .sort({ channelNumber: 1 })
      .lean();

    const live = await LiveChannel.find({ enabled: true })
      .select('slug name description videoId url youtubeChannel channelNumber category tags icon thumbnailUrl uploader isOnline lastChecked')
      .sort({ channelNumber: 1 })
      .lean();

    res.json({
      startEpoch: START_EPOCH,
      decades: DECADES,
      categories: CATEGORIES,
      channelGrid,
      pluginChannels: plugins.map((p) => ({
        id: p.pluginId,
        name: p.name,
        description: p.description,
        channelNumber: p.channelNumber,
        isPlugin: true,
      })),
      // 24/7 YouTube live streams — clients play these directly, no clock
      liveChannels: live.map((l) => ({
        id: `ch-live-${l.slug}`,
        slug: l.slug,
        name: l.name,
        description: l.description,
        channelNumber: l.channelNumber,
        videoId: l.videoId,
        url: l.url || `https://www.youtube.com/live/${l.videoId}`,
        youtubeChannel: l.youtubeChannel,
        category: l.category || 'Live',
        tags: l.tags || [],
        icon: l.icon,
        thumbnailUrl: l.thumbnailUrl,
        uploader: l.uploader,
        isOnline: l.isOnline !== false,
        lastChecked: l.lastChecked,
        isLive: true,
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;