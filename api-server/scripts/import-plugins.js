#!/usr/bin/env node
'use strict';

/**
 * SurfArr Plugin Importer
 *
 * Reads plugin-repo/manifest.json, parses each plugin's YAML file,
 * expands YouTube playlists via yt-dlp, and upserts plugin channels
 * + their videos into MongoDB.
 *
 * Usage:
 *   node scripts/import-plugins.js                  # Import all plugins
 *   node scripts/import-plugins.js --dry-run        # Preview without DB writes
 *   node scripts/import-plugins.js --plugin classic-nickelodeon  # Single plugin
 *   node scripts/import-plugins.js --force          # Re-import even if already imported today
 *   node scripts/import-plugins.js --no-filter      # Skip the content filter
 *   node scripts/import-plugins.js --verbose        # Show every filtered video and why
 *
 * Requirements:
 *   - yt-dlp (for expanding playlist URLs)
 *   - MONGO_URI in api-server/.env or the environment
 *   - PLUGIN_REPO_DIR (optional): folder with manifest.json, default ../plugin-repo
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const mongoose = require('mongoose');
const contentFilter = require('../src/content/contentFilter');

// Load api-server/.env (real environment variables win)
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isForce = args.includes('--force');
const pluginFilter = args.includes('--plugin') ? args[args.indexOf('--plugin') + 1] : null;
const noFilter = args.includes('--no-filter');
const strictFilter = args.includes('--strict');
const verbose = args.includes('--verbose');

// Plugin channels have no decade/category; guess the content-filter profile
// from the manifest tags (e.g. ["cartoons","90s"]) and fall back to Shows.
const CATEGORY_BY_TAG = {
  cartoons: 'Cartoons', cartoon: 'Cartoons', animation: 'Cartoons', anime: 'Cartoons',
  sitcoms: 'Sitcoms', sitcom: 'Sitcoms', comedy: 'Sitcoms',
  movies: 'Movies', movie: 'Movies', film: 'Movies',
  commercials: 'Commercials', commercial: 'Commercials', ads: 'Commercials', infomercials: 'Commercials',
  bumpers: 'Bumpers', promos: 'Bumpers', idents: 'Bumpers',
  kids: 'Kids', children: 'Kids', preschool: 'Kids',
  drama: 'Drama', documentary: 'Documentary', documentaries: 'Documentary',
  'talk-tv': 'Talk TV', talk: 'Talk TV', 'late-night': 'Talk TV', 'talk-show': 'Talk TV',
  'theme-songs': 'Theme Songs', themes: 'Theme Songs', trailers: 'Trailers', music: 'Theme Songs',
  'game-shows': 'Shows', shows: 'Shows',
};
function categoryForPlugin(plugin) {
  if (plugin.category) return plugin.category;
  for (const tag of plugin.tags || []) {
    const c = CATEGORY_BY_TAG[String(tag).toLowerCase()];
    if (c) return c;
  }
  return 'Shows';
}

const YTDLP_PATH = process.env.YTDLP_PATH || 'yt-dlp';
const COOKIES_PATH = process.env.YTDLP_COOKIES || '';
const API_ROOT = path.resolve(__dirname, '..');
const PLUGIN_REPO_DIR = process.env.PLUGIN_REPO_DIR
  ? path.resolve(process.env.PLUGIN_REPO_DIR)
  : [path.join(API_ROOT, 'plugin-repo'), path.join(API_ROOT, '..', 'plugin-repo')].find((d) => fs.existsSync(d)) || path.join(API_ROOT, 'plugin-repo');
const MANIFEST_PATH = path.join(PLUGIN_REPO_DIR, 'manifest.json');

// ── MongoDB models (match api-server schema) ────────────────────────────────
const pluginChannelSchema = new mongoose.Schema({
  pluginId: { type: String, required: true, unique: true },
  name: String,
  description: String,
  channelNumber: { type: Number, unique: true },
  author: String,
  tags: [String],
  icon: String,
  enabled: { type: Boolean, default: true },
  settings: {
    shuffle: { type: Boolean, default: true },
    includeCommercials: { type: Boolean, default: false },
  },
  videoCount: { type: Number, default: 0 },
  lastImported: Date,
}, { timestamps: true });

const pluginVideoSchema = new mongoose.Schema({
  id: { type: String, required: true },
  pluginId: { type: String, required: true },
  title: String,
  description: { type: String, default: '' },
  duration: { type: Number, default: 0 },
  thumbnailUrl: { type: String, default: '' },
  showName: { type: String, default: '' },
  year: { type: Number, default: 0 },
  isDead: { type: Boolean, default: false },
  excluded: { type: Boolean, default: false },
  excludedReason: { type: String, default: '' },
  uploader: { type: String, default: '' },
  lastVerified: { type: Date, default: Date.now },
}, { timestamps: true });

pluginVideoSchema.index({ id: 1, pluginId: 1 }, { unique: true });

const PluginChannel = mongoose.model('PluginChannel', pluginChannelSchema);
const PluginVideo = mongoose.model('PluginVideo', pluginVideoSchema);

// ── YAML parser ─────────────────────────────────────────────────────────────
// Format: "YEAR - Show Name - URL"
function parsePluginYaml(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const entries = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const urlMatch = trimmed.match(/(https?:\/\/[^\s]+)/);
    if (!urlMatch) continue;

    const url = urlMatch[1];
    const before = trimmed.substring(0, trimmed.indexOf(url)).trim().replace(/\s*-\s*$/, '');

    // Extract year
    const yearMatch = before.match(/^(\d{4})/);
    const year = yearMatch ? parseInt(yearMatch[1], 10) : 0;

    // Extract show name (everything after year)
    const showName = before.replace(/^\d{4}\s*-\s*/, '').trim();

    // Detect playlists vs single videos
    const isPlaylist = url.includes('playlist?list=') || (url.includes('list=') && !url.includes('watch?v='));

    entries.push({ year, showName, url, isPlaylist });
  }

  return entries;
}

// ── yt-dlp fetcher ──────────────────────────────────────────────────────────
function fetchVideoMetadata(url, showName, isPlaylist) {
  return new Promise((resolve, reject) => {
    const cookieArgs = COOKIES_PATH ? ['--cookies', COOKIES_PATH] : [];

    const ytdlpArgs = isPlaylist
      ? [...cookieArgs, '--flat-playlist', '--dump-json', '--no-warnings', '--ignore-errors', '--sleep-interval', '1', url]
      : [...cookieArgs, '--skip-download', '--dump-json', '--no-warnings', '--ignore-errors', '--no-playlist', url];

    const proc = spawn(YTDLP_PATH, ytdlpArgs);
    const videos = [];
    let buffer = '';

    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          if (data.id && data._type !== 'playlist') {
            if (data.age_limit && data.age_limit >= 18) continue;
            videos.push({
              id: data.id,
              title: data.title || showName || 'Untitled',
              description: (data.description || '').substring(0, 500),
              duration: data.duration || 0,
              thumbnailUrl: data.thumbnail || (data.thumbnails && data.thumbnails[0]?.url) || '',
              uploader: data.uploader || data.channel || '',
              channelId: data.channel_id || data.uploader_id || '',
              liveStatus: data.live_status || null,
            });
          }
        } catch { /* skip */ }
      }
    });

    proc.stderr.on('data', () => {});

    proc.on('close', () => {
      if (buffer.trim()) {
        try {
          const data = JSON.parse(buffer);
          if (data.id && data._type !== 'playlist') {
            if (!(data.age_limit && data.age_limit >= 18)) {
              videos.push({
                id: data.id,
                title: data.title || showName || 'Untitled',
                description: (data.description || '').substring(0, 500),
                duration: data.duration || 0,
                thumbnailUrl: data.thumbnail || '',
                uploader: data.uploader || data.channel || '',
                channelId: data.channel_id || data.uploader_id || '',
                liveStatus: data.live_status || null,
              });
            }
          }
        } catch { /* skip */ }
      }
      resolve(videos);
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn yt-dlp: ${err.message}`));
    });
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🔌 SurfArr Plugin Importer');
  console.log(`   Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`   Force re-import: ${isForce}`);
  if (pluginFilter) console.log(`   Plugin filter: ${pluginFilter}`);

  // Read manifest
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error('❌ manifest.json not found at', MANIFEST_PATH);
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  let plugins = manifest.plugins || [];

  if (pluginFilter) {
    plugins = plugins.filter((p) => p.id === pluginFilter);
    if (plugins.length === 0) {
      console.error(`❌ Plugin "${pluginFilter}" not found in manifest.`);
      process.exit(1);
    }
  }

  console.log(`   Plugins to process: ${plugins.length}\n`);

  // Connect to MongoDB
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/retroarr';

  if (!isDryRun) {
    console.log(`🔌 Connecting to MongoDB: ${mongoUri.replace(/\/\/[^@/]*@/, '//***@')}`);
    try {
      await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
      console.log('   Connected.\n');
    } catch (err) {
      console.error('❌ MongoDB connection failed:', err.message);
      process.exit(1);
    }
  }

  let totalChannels = 0;
  let totalVideos = 0;
  let totalFiltered = 0;

  for (let pi = 0; pi < plugins.length; pi++) {
    const plugin = plugins[pi];
    console.log(`\n📺 [${pi + 1}/${plugins.length}] ${plugin.name} (CH ${plugin.channelNumber})`);

    // Check if YAML file exists
    const yamlPath = path.join(PLUGIN_REPO_DIR, plugin.yamlFile);
    if (!fs.existsSync(yamlPath)) {
      console.log(`   ✗ YAML file not found: ${plugin.yamlFile}`);
      continue;
    }

    // Check if already imported today (skip unless --force)
    if (!isDryRun && !isForce) {
      const existing = await PluginChannel.findOne({ pluginId: plugin.id }).lean();
      if (existing?.lastImported) {
        const today = new Date().toDateString();
        const importedDate = new Date(existing.lastImported).toDateString();
        if (today === importedDate) {
          console.log(`   ⊘ Already imported today. Use --force to re-import.`);
          continue;
        }
      }
    }

    const filterCategory = categoryForPlugin(plugin);
    if (!noFilter) console.log(`   Content filter profile: ${filterCategory}`);

    // Parse YAML
    const entries = parsePluginYaml(yamlPath);
    const playlists = entries.filter((e) => e.isPlaylist);
    const singles = entries.filter((e) => !e.isPlaylist);
    console.log(`   Found ${entries.length} entries (${playlists.length} playlists, ${singles.length} single videos)`);

    // Fetch video metadata
    const allVideos = [];
    const seenIds = new Set();

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const label = entry.isPlaylist ? 'playlist' : 'video';

      try {
        let videos = await fetchVideoMetadata(entry.url, entry.showName, entry.isPlaylist);

        if (!noFilter && videos.length > 0) {
          const { kept, dropped } = contentFilter.filterVideos(videos, {
            category: filterCategory,
            showName: entry.showName,
            strict: strictFilter,
          });
          if (dropped.length) {
            console.log(`   🧹 ${entry.showName}: filtered ${dropped.length}/${videos.length} non-show videos`);
            if (verbose) for (const d of dropped) console.log(`      - ${d.id} "${d.title}" → ${d.filterReason}`);
            totalFiltered += dropped.length;
          }
          videos = kept;
        }

        for (const v of videos) {
          if (seenIds.has(v.id)) continue;
          seenIds.add(v.id);
          allVideos.push({
            ...v,
            showName: entry.showName,
            year: entry.year,
          });
        }

        if (videos.length > 0) {
          process.stdout.write(`   ✓ ${label}: ${entry.showName} (${videos.length} videos)\n`);
        }
      } catch (err) {
        console.log(`   ✗ ${label}: ${entry.showName} — ${err.message}`);
      }

      await sleep(1500);
    }

    console.log(`   Total unique videos: ${allVideos.length}`);

    if (isDryRun) {
      console.log(`   [DRY RUN] Would upsert channel + ${allVideos.length} videos`);
      totalChannels++;
      totalVideos += allVideos.length;
      continue;
    }

    // Upsert plugin channel
    const configPath = path.join(PLUGIN_REPO_DIR, plugin.configFile);
    const config = fs.existsSync(configPath)
      ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
      : {};

    await PluginChannel.findOneAndUpdate(
      { pluginId: plugin.id },
      {
        pluginId: plugin.id,
        name: plugin.name,
        description: plugin.description || '',
        channelNumber: plugin.channelNumber,
        author: plugin.author || 'surfarr',
        tags: plugin.tags || [],
        icon: plugin.icon || '',
        enabled: config.enabled !== false,
        settings: config.settings || { shuffle: true, includeCommercials: false },
        videoCount: allVideos.length,
        lastImported: new Date(),
      },
      { upsert: true, new: true }
    );

    // Upsert videos (skip dead ones)
    if (allVideos.length > 0) {
      const ops = allVideos.map((v) => ({
        updateOne: {
          filter: { id: v.id, pluginId: plugin.id, isDead: { $ne: true }, excluded: { $ne: true } },
          update: {
            $set: {
              id: v.id,
              pluginId: plugin.id,
              title: v.title,
              description: v.description,
              duration: v.duration,
              thumbnailUrl: v.thumbnailUrl,
              showName: v.showName,
              year: v.year,
              uploader: v.uploader || '',
              lastVerified: new Date(),
            },
            $setOnInsert: { isDead: false, excluded: false },
          },
          upsert: true,
        },
      }));

      try {
        const result = await PluginVideo.bulkWrite(ops, { ordered: false });
        console.log(`   ✓ Upserted ${result.upsertedCount + result.modifiedCount} videos to MongoDB`);
      } catch (err) {
        // Dead/excluded docs don't match the filter → duplicate-key on insert.
        // Expected: they stay flagged; count the rest.
        if (err && err.code === 11000 && err.result) {
          const r = err.result;
          console.log(`   ✓ Upserted ${(r.upsertedCount || 0) + (r.modifiedCount || 0)} videos (${(err.writeErrors || []).length} kept as dead/excluded)`);
        } else {
          throw err;
        }
      }
    }

    totalChannels++;
    totalVideos += allVideos.length;
  }

  // Summary
  console.log('\n' + '─'.repeat(50));
  if (!noFilter) console.log(`🧹 Filtered as non-show content: ${totalFiltered}`);
  console.log('📊 Import Summary');
  console.log(`   Channels: ${totalChannels}`);
  console.log(`   Videos:   ${totalVideos}`);
  if (isDryRun) console.log('   [DRY RUN] No changes were made.');

  if (!isDryRun) {
    await mongoose.disconnect();
  }
  console.log('\n✅ Done.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
