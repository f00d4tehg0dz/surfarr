'use strict';

const mongoose = require('mongoose');
const config = require('../config');
const logger = require('../logger');

// Video schema — one document per YouTube video
// Videos are indexed by decade + category for fast channel queries
const videoSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    duration: { type: Number, default: 0 }, // seconds
    thumbnailUrl: { type: String, default: '' },
    // Channel metadata — how this video is categorized
    decade: { type: String, required: true, index: true },
    category: { type: String, required: true, index: true },
    // Source playlist this video belongs to
    playlistId: { type: String, index: true },
    showName: { type: String, default: '' },
    // Standalone channel tag (e.g., 'classic-nickelodeon', 'fox-kids')
    // Videos with this field belong to a standalone channel, not the decade grid
    standaloneChannel: { type: String, default: '', index: true },
    // Lifecycle tracking
    isDead: { type: Boolean, default: false },
    // Content filter: true = not an episode of the show (reaction, review,
    // Short, trailer…). Never served, never revived by the importer.
    excluded: { type: Boolean, default: false, index: true },
    excludedReason: { type: String, default: '' },
    excludedAt: { type: Date }, // when a sweep excluded it (house-rule purge grace period)
    uploader: { type: String, default: '' },
    // Set by the daily maintenance job (private / removed on YouTube)
    deadReason: { type: String, default: '' },
    lastVerified: { type: Date, default: Date.now, index: true },
  },
  {
    timestamps: true,
    // Compound index for the primary query pattern: GET /videos?decade=80s&category=Cartoons
    indexes: [{ decade: 1, category: 1 }],
  }
);

// Playlist source registry — tracks which playlists have been imported
const playlistSchema = new mongoose.Schema(
  {
    playlistId: { type: String, required: true, unique: true },
    showName: { type: String, required: true },
    decade: { type: String, required: true },
    category: { type: String, required: true },
    videoCount: { type: Number, default: 0 },
    lastImported: { type: Date, default: null },
  },
  { timestamps: true }
);

// Plugin channel — represents a custom channel from the plugin-repo
const pluginChannelSchema = new mongoose.Schema(
  {
    pluginId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    channelNumber: { type: Number, required: true, unique: true },
    author: { type: String, default: 'retroarr' },
    tags: [{ type: String }],
    icon: { type: String, default: '' },
    enabled: { type: Boolean, default: true },
    settings: {
      shuffle: { type: Boolean, default: true },
      includeCommercials: { type: Boolean, default: false },
    },
    videoCount: { type: Number, default: 0 },
    lastImported: { type: Date, default: null },
  },
  { timestamps: true }
);

// Plugin video — videos belonging to a plugin channel
const pluginVideoSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, index: true },
    pluginId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    duration: { type: Number, default: 0 },
    thumbnailUrl: { type: String, default: '' },
    showName: { type: String, default: '' },
    year: { type: Number, default: 0 },
    isDead: { type: Boolean, default: false },
    excluded: { type: Boolean, default: false },
    excludedReason: { type: String, default: '' },
    excludedAt: { type: Date }, // when a sweep excluded it (house-rule purge grace period)
    uploader: { type: String, default: '' },
    deadReason: { type: String, default: '' },
    lastVerified: { type: Date, default: Date.now, index: true },
  },
  {
    timestamps: true,
    indexes: [{ pluginId: 1, isDead: 1 }],
  }
);

// Compound unique index: same video ID can exist in different plugins
pluginVideoSchema.index({ id: 1, pluginId: 1 }, { unique: true });

// Live channel — a 24/7 YouTube live stream surfaced as a linear channel.
// No virtual clock: whatever the stream is showing is what's "on".
const liveChannelSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    // Current YouTube live video ID (youtube.com/live/<id>). Re-resolved by
    // scripts/import-live.js because some channels rotate stream IDs.
    videoId: { type: String, required: true },
    url: { type: String, default: '' },
    // Optional: the YouTube channel (@handle or UC…) so a new stream ID can be
    // discovered automatically when the old one ends.
    youtubeChannel: { type: String, default: '' },
    channelNumber: { type: Number, required: true, unique: true },
    category: { type: String, default: 'Live' },
    tags: [{ type: String }],
    icon: { type: String, default: '' },
    thumbnailUrl: { type: String, default: '' },
    uploader: { type: String, default: '' },
    enabled: { type: Boolean, default: true },
    isOnline: { type: Boolean, default: true },
    lastChecked: { type: Date, default: null },
  },
  { timestamps: true }
);

const Video = mongoose.model('Video', videoSchema);
const LiveChannel = mongoose.model('LiveChannel', liveChannelSchema);
const Playlist = mongoose.model('Playlist', playlistSchema);
const PluginChannel = mongoose.model('PluginChannel', pluginChannelSchema);
const PluginVideo = mongoose.model('PluginVideo', pluginVideoSchema);

// Never log credentials: mongodb://user:pass@host → mongodb://user:***@host
function redactUri(uri) {
  // Hide everything before the host — user, password, or a single token
  return String(uri || '').replace(/\/\/[^/@]*@/, '//***@');
}

async function connectDb() {
  const opts = {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 30000,
  };

  mongoose.connection.on('connected', () =>
    logger.info(`[DB] Connected to MongoDB: ${redactUri(config.mongoUri)}`)
  );
  mongoose.connection.on('error', (err) =>
    logger.error(`[DB] Connection error: ${err.message}`)
  );
  mongoose.connection.on('disconnected', () =>
    logger.warn('[DB] Disconnected from MongoDB')
  );

  await mongoose.connect(config.mongoUri, opts);
}

module.exports = { connectDb, Video, Playlist, PluginChannel, PluginVideo, LiveChannel };