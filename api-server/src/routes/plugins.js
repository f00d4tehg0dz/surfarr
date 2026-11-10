'use strict';

// GET  /plugins                — list all plugin channels
// GET  /plugins/:pluginId      — single plugin channel detail
// GET  /plugins/:pluginId/videos — videos for a plugin channel
// GET  /plugins/:pluginId/videos/slim — lightweight video list (id + duration)

const express = require('express');
const router = express.Router();
const { PluginChannel, PluginVideo } = require('../db/mongodb');

// GET /plugins — list all plugin channels
router.get('/', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.enabled !== undefined) {
      filter.enabled = req.query.enabled === 'true';
    }

    const channels = await PluginChannel.find(filter)
      .select('pluginId name description channelNumber author tags icon enabled settings videoCount lastImported')
      .sort({ channelNumber: 1 })
      .lean();

    res.json(channels);
  } catch (err) {
    next(err);
  }
});

// GET /plugins/:pluginId — single plugin channel
router.get('/:pluginId', async (req, res, next) => {
  try {
    const channel = await PluginChannel.findOne({ pluginId: req.params.pluginId }).lean();
    if (!channel) return res.status(404).json({ error: 'Plugin channel not found' });
    res.json(channel);
  } catch (err) {
    next(err);
  }
});

// GET /plugins/:pluginId/videos — full video list for a plugin channel
router.get('/:pluginId/videos', async (req, res, next) => {
  try {
    const { includeDeadVideos, limit } = req.query;

    const filter = { pluginId: req.params.pluginId, excluded: { $ne: true } };
    if (includeDeadVideos !== 'true') {
      filter.isDead = false;
    }

    const maxLimit = Math.min(parseInt(limit, 10) || 500, 500);

    const videos = await PluginVideo.find(filter)
      .select('id title description duration thumbnailUrl showName year isDead lastVerified')
      .limit(maxLimit)
      .lean();

    res.json(videos);
  } catch (err) {
    next(err);
  }
});

// GET /plugins/:pluginId/videos/slim — lightweight (id + duration only)
router.get('/:pluginId/videos/slim', async (req, res, next) => {
  try {
    const videos = await PluginVideo.find({ pluginId: req.params.pluginId, isDead: false, excluded: { $ne: true } })
      .select('id duration')
      .lean();

    res.json(videos);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
