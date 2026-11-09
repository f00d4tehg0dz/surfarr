'use strict';

// GET /playlists — list all imported playlists
// GET /playlists/:playlistId/videos — all videos for a specific playlist

const express = require('express');
const router = express.Router();
const { Video, Playlist } = require('../db/mongodb');

// GET /playlists — list all playlist sources
router.get('/', async (req, res, next) => {
  try {
    const { decade, category } = req.query;
    const filter = {};
    // Plain strings only, compared with $eq, so a query like ?decade[$ne]=x
    // can never become a MongoDB operator.
    if (typeof decade === 'string' && decade) filter.decade = { $eq: decade };
    if (typeof category === 'string' && category) filter.category = { $eq: category };

    const playlists = await Playlist.find(filter)
      .select('playlistId showName decade category videoCount lastImported')
      .sort({ decade: 1, showName: 1 })
      .lean();

    res.json(playlists);
  } catch (err) {
    next(err);
  }
});

// GET /playlists/:playlistId/videos
router.get('/:playlistId/videos', async (req, res, next) => {
  try {
    const { playlistId } = req.params;

    // Validate playlist ID format (YouTube playlist IDs start with PL, typically ~34 chars)
    if (!/^[A-Za-z0-9_-]{10,50}$/.test(playlistId)) {
      return res.status(400).json({ error: 'Invalid playlist ID format' });
    }

    const videos = await Video.find({ playlistId, isDead: false, excluded: { $ne: true } })
      .select('id title description duration thumbnailUrl')
      .lean();

    if (!videos.length) {
      return res.status(404).json({ error: 'Playlist not found or has no videos' });
    }

    res.json(videos);
  } catch (err) {
    next(err);
  }
});

module.exports = router;