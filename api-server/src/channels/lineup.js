'use strict';

// Which channels this API broadcasts in /config.
//
// CHANNEL_GRID_MODE=static (default): the fixed list in disabled.js. This is
//   how the public SurfArr API runs, so every instance sees the same lineup.
// CHANNEL_GRID_MODE=auto: a channel is on as soon as it has playable videos
//   in MongoDB and off again when it has none. Meant for a self-hosted API:
//   import a list and the channel shows up, no code edits.

const config = require('../config');
const { Video, PluginVideo } = require('../db/mongodb');
const { DECADES, CATEGORIES, STANDALONE_CHANNELS, isDisabled, channelNumberFor } = require('./disabled');

const CACHE_MS = 60 * 1000;
let cache = null; // { at, grid: Set<'decade|category'>, standalone: Set<slug> }

const isAuto = () => config.gridMode === 'auto';

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '-');
}

async function activeSets() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache;
  const playable = { isDead: { $ne: true }, excluded: { $ne: true } };
  const [rows, pluginIds] = await Promise.all([
    Video.aggregate([
      { $match: playable },
      { $group: { _id: { decade: '$decade', category: '$category', standalone: '$standaloneChannel' }, n: { $sum: 1 } } },
    ]),
    PluginVideo.distinct('pluginId', playable),
  ]);
  const grid = new Set();
  const standalone = new Set(pluginIds);
  for (const r of rows) {
    grid.add(`${r._id.decade}|${r._id.category}`);
    if (r._id.standalone) standalone.add(r._id.standalone);
  }
  cache = { at: Date.now(), grid, standalone };
  return cache;
}

// true → /videos answers [] for this decade+category
async function isGridDisabled(decade, category) {
  if (!isAuto()) return isDisabled(decade, category);
  return false; // auto: whatever is in the database is served
}

// Synchronous test for a batch of rows (used by /videos/stats)
async function gridFilter() {
  if (!isAuto()) return (decade, category) => !isDisabled(decade, category);
  return () => true;
}

function gridEntry(decade, category) {
  return {
    id: `ch-${slugify(decade)}-${slugify(category)}`,
    decade,
    category,
    channelNumber: channelNumberFor(decade, category),
    name: `${decade} ${category}`,
  };
}

function standaloneEntry(c) {
  // `isStandalone` tells clients to load videos from /videos/channel/:id
  // (curated content) instead of the decade+category endpoint.
  return {
    id: c.id,
    channelNumber: c.channelNumber,
    name: c.name,
    decade: c.decade,
    category: c.category,
    standaloneSlug: c.slug,
    isStandalone: true,
  };
}

async function channelGrid() {
  const auto = isAuto();
  const active = auto ? await activeSets() : null;
  const channels = [];
  for (const decade of DECADES) {
    for (const category of CATEGORIES) {
      const on = auto ? active.grid.has(`${decade}|${category}`) : !isDisabled(decade, category);
      if (on) channels.push(gridEntry(decade, category));
    }
  }
  for (const c of STANDALONE_CHANNELS) {
    if (!auto || active.standalone.has(c.slug)) channels.push(standaloneEntry(c));
  }
  return channels;
}

function invalidate() {
  cache = null;
}

module.exports = { channelGrid, isGridDisabled, gridFilter, invalidate, isAuto };
