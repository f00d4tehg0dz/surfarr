'use strict';

// GET /videos?decade=80s&category=Cartoons
//   Returns all non-dead videos for a channel.
//   This is the primary endpoint called by SurfArr's dailySync job.
//
// GET /videos/decades
//   Returns list of all available decades in the DB.
//
// GET /videos/categories
//   Returns list of all available categories in the DB.
//
// GET /videos/stats
//   Returns video counts per decade+category combination.

const express = require('express');
const router = express.Router();
const { Video, PluginVideo } = require('../db/mongodb');
const { validateQuery } = require('../middleware/errorHandler');
const { DECADES, CATEGORIES, findStandalone } = require('../channels/disabled');
const lineup = require('../channels/lineup');

const { balancedSample, weekSeed, DEFAULT_LIMIT, MAX_LIMIT } = require('../content/sample');

const VALID_DECADES = DECADES;
const VALID_CATEGORIES = CATEGORIES;

// GET /videos?decade=80s&category=Cartoons
// Optional params: limit (default 1500, max 3000; balanced across shows, rotates weekly), includeDeadVideos
router.get(
  '/',
  validateQuery({
    decade: { required: true, enum: VALID_DECADES },
    category: { required: true, enum: VALID_CATEGORIES },
  }),
  async (req, res, next) => {
    try {
      const { decade, category, limit, includeDeadVideos } = req.query;

      // Refuse queries for disabled channels so old/probing clients
      // can't pull video lists for channels that aren't broadcast in /config.
      if (await lineup.isGridDisabled(decade, category)) {
        return res.json([]);
      }

      const filter = { decade, category, excluded: { $ne: true } };
      if (includeDeadVideos !== 'true') {
        filter.isDead = false;
      }

      const maxLimit = Math.min(parseInt(limit, 10) || DEFAULT_LIMIT, MAX_LIMIT);

      const all = await Video.find(filter)
        .select('id title duration thumbnailUrl showName playlistId isDead lastVerified')
        .lean();
      const videos = balancedSample(all, maxLimit, weekSeed(`${decade}|${category}`));

      res.json(videos);
    } catch (err) {
      next(err);
    }
  }
);

// GET /videos/decades — list available decades
router.get('/decades', async (req, res, next) => {
  try {
    const decades = await Video.distinct('decade');
    res.json(decades.sort());
  } catch (err) {
    next(err);
  }
});

// GET /videos/categories — list available categories
router.get('/categories', async (req, res, next) => {
  try {
    const categories = await Video.distinct('category');
    res.json(categories.sort());
  } catch (err) {
    next(err);
  }
});

// GET /videos/slim?decade=80s&category=Cartoons
// Lightweight endpoint: returns only id + duration per video.
// Used by the mobile/TV app's virtualClock algorithm (no full metadata needed).
router.get(
  '/slim',
  validateQuery({
    decade: { required: true, enum: VALID_DECADES },
    category: { required: true, enum: VALID_CATEGORIES },
  }),
  async (req, res, next) => {
    try {
      const { decade, category } = req.query;
      if (await lineup.isGridDisabled(decade, category)) {
        return res.json([]);
      }
      const videos = await Video.find({ decade, category, isDead: false, excluded: { $ne: true } })
        .select('id duration')
        .lean();
      res.json(videos);
    } catch (err) {
      next(err);
    }
  }
);

// Resolve a request param ("ch-fox-kids" or "fox-kids") to a standalone slug.
// Returns the bare slug if it matches a registered standalone channel, else null.
function resolveStandaloneSlug(param) {
  const entry = findStandalone(param);
  return entry ? entry.slug : null;
}

// Lookup order for a standalone channel:
//   1. curated docs tagged `standaloneChannel: slug` in the videos collection
//   2. the plugin-repo pack with the same id (the community plugins mirror the
//      curated channels — e.g. "unsolved-mysteries" lives in pluginvideos)
//   3. nothing. There is deliberately NO fall-through to the parent
//      decade+category any more: a channel called "Unsolved Mysteries" playing
//      random 80s shows is worse than an empty channel (which the lineup hides).
async function findVideosForStandalone(slug, { selectFields, limit, includeDead }) {
  const baseDeadFilter = includeDead ? { excluded: { $ne: true } } : { isDead: false, excluded: { $ne: true } };

  // showName is needed for the per-show balancing even when not requested
  const fields = `${selectFields} showName playlistId`;
  const curated = await Video.find({ standaloneChannel: slug, ...baseDeadFilter }).select(fields).lean();
  if (curated.length > 0) return balancedSample(curated, limit, weekSeed(`standalone|${slug}`));

  const fromPlugin = await PluginVideo.find({ pluginId: slug, ...baseDeadFilter }).select(fields).lean();
  return balancedSample(fromPlugin, limit, weekSeed(`standalone|${slug}`));
}

// GET /videos/channel/:channelId — full video metadata for a standalone channel.
// Accepts either the registered id ("ch-fox-kids") or bare slug ("fox-kids").
// Returns [] when neither curated nor plugin content exists (never grid filler).
router.get('/channel/:channelId', async (req, res, next) => {
  try {
    const slug = resolveStandaloneSlug(req.params.channelId) || req.params.channelId;
    const { limit, includeDeadVideos } = req.query;
    const maxLimit = Math.min(parseInt(limit, 10) || DEFAULT_LIMIT, MAX_LIMIT);

    const videos = await findVideosForStandalone(slug, {
      selectFields: 'id title description duration thumbnailUrl showName isDead lastVerified',
      limit: maxLimit,
      includeDead: includeDeadVideos === 'true',
    });

    res.json(videos);
  } catch (err) {
    next(err);
  }
});

// GET /videos/channel/:channelId/slim — slim {id, duration} list for the
// virtualClock algorithm on standalone channels. Same fallback semantics as
// the full route above.
router.get('/channel/:channelId/slim', async (req, res, next) => {
  try {
    const slug = resolveStandaloneSlug(req.params.channelId) || req.params.channelId;
    const videos = await findVideosForStandalone(slug, {
      selectFields: 'id duration',
      limit: DEFAULT_LIMIT,
      includeDead: false,
    });
    res.json(videos);
  } catch (err) {
    next(err);
  }
});

// GET /videos/stats — video counts per decade+category
// Disabled channels are filtered out so the broadcast surface matches /config.
router.get('/stats', async (req, res, next) => {
  try {
    const stats = await Video.aggregate([
      {
        $group: {
          _id: { decade: '$decade', category: '$category' },
          total: { $sum: 1 },
          alive: { $sum: { $cond: [{ $and: [{ $eq: ['$isDead', false] }, { $ne: ['$excluded', true] }] }, 1, 0] } },
          excluded: { $sum: { $cond: [{ $eq: ['$excluded', true] }, 1, 0] } },
        },
      },
      { $sort: { '_id.decade': 1, '_id.category': 1 } },
    ]);

    const broadcast = await lineup.gridFilter();
    res.json(
      stats
        .filter((s) => broadcast(s._id.decade, s._id.category))
        .map((s) => ({
          decade: s._id.decade,
          category: s._id.category,
          total: s.total,
          alive: s.alive,
          excluded: s.excluded,
          dead: s.total - s.alive - s.excluded,
        }))
    );
  } catch (err) {
    next(err);
  }
});

// PATCH /videos/:id/dead — mark a specific video as dead (from client report)
// Uses strictLimiter to prevent spam
router.patch('/:videoId/dead', async (req, res, next) => {
  try {
    const { videoId } = req.params;
    // Validate video ID format: YouTube (11 chars) or Internet Archive
    // ("ia:<identifier>/<file>", sent URL-encoded)
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId) && !/^ia:[\w.-]+\/[^\0]{1,300}$/.test(videoId)) {
      return res.status(400).json({ error: 'Invalid video ID format' });
    }

    const video = await Video.findOneAndUpdate(
      { id: videoId },
      { isDead: true },
      { new: true }
    );

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    res.json({ ok: true, videoId, isDead: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;