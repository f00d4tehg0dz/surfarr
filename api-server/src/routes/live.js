'use strict';

// GET /live          — enabled 24/7 YouTube live channels (?all=true includes disabled)
// GET /live/:slug    — one live channel
//
// Live channels are seeded by scripts/import-live.js from yaml/live-channels.yaml.

const express = require('express');
const router = express.Router();
const { LiveChannel } = require('../db/mongodb');

const FIELDS = 'slug name description videoId url youtubeChannel channelNumber category tags icon thumbnailUrl uploader enabled isOnline lastChecked updatedAt';

function present(l) {
  return {
    id: `ch-live-${l.slug}`,
    slug: l.slug,
    name: l.name,
    description: l.description || '',
    channelNumber: l.channelNumber,
    videoId: l.videoId,
    url: l.url || `https://www.youtube.com/live/${l.videoId}`,
    youtubeChannel: l.youtubeChannel || '',
    category: l.category || 'Live',
    tags: l.tags || [],
    icon: l.icon || '',
    thumbnailUrl: l.thumbnailUrl || '',
    uploader: l.uploader || '',
    enabled: l.enabled !== false,
    isOnline: l.isOnline !== false,
    lastChecked: l.lastChecked,
    isLive: true,
  };
}

router.get('/', async (req, res, next) => {
  try {
    const filter = req.query.all === 'true' ? {} : { enabled: true };
    const list = await LiveChannel.find(filter).select(FIELDS).sort({ channelNumber: 1 }).lean();
    res.json(list.map(present));
  } catch (err) {
    next(err);
  }
});

router.get('/:slug', async (req, res, next) => {
  try {
    const slug = String(req.params.slug || '').replace(/^ch-live-/, '');
    const l = await LiveChannel.findOne({ slug }).select(FIELDS).lean();
    if (!l) return res.status(404).json({ error: 'Live channel not found' });
    res.json(present(l));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
