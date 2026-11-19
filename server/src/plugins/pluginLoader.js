'use strict';

// Plugin loader: reads JSON configs from the plugins/ directory and produces
// channel objects that merge alongside the standard DECADES × CATEGORIES grid.
//
// Each *.json file in plugins/ defines one custom channel.
// See plugins/README or the plan for the schema.

const fs = require('fs');
const path = require('path');
const appConfig = require('../config');

// Installed plugin configs (PLUGINS_DIR env, default <repo>/plugins).
const PLUGINS_DIR = appConfig.pluginsDir;
const REPO_ROOT = path.resolve(__dirname, '../../..');

// A plugin's yamlFile may be a bare name or a repo-relative path. Look in the
// plugins dir itself first (where the installer writes it), then the bundled
// plugin-repo/, then the repo root.
function resolveYamlPath(yamlFile) {
  const name = path.basename(yamlFile);
  const candidates = [
    path.join(PLUGINS_DIR, name),
    path.join(appConfig.pluginRepoDir, name),
    path.resolve(REPO_ROOT, yamlFile),
    path.resolve(PLUGINS_DIR, yamlFile),
  ];
  return candidates.find((c) => fs.existsSync(c)) || candidates[0];
}

/**
 * Parse a YAML file (same format as import-yaml.js).
 * Returns array of { showName, url }.
 */
function parseYamlFile(filePath) {
  if (!fs.existsSync(filePath)) return [];

  const content = fs.readFileSync(filePath, 'utf8');
  const entries = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    // '#' lines are comments (disabled sources, notes), never sources
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('https://')) continue;

    const urlMatch = trimmed.match(/https?:\/\/[^\s]+/);
    if (!urlMatch) continue;

    const url = urlMatch[0];
    const beforeUrl = trimmed.slice(0, trimmed.indexOf(url)).replace(/\s*-\s*$/, '').trim();
    // Strip leading year: "1991 - Doug" → "Doug"
    const showName = beforeUrl.replace(/^\d{4}s?\s*-\s*/, '').trim() || 'Untitled';

    entries.push({ showName, url });
  }

  return entries;
}

function extractLiveVideoId(url) {
  const m =
    String(url).match(/\/live\/([A-Za-z0-9_-]{11})/) ||
    String(url).match(/[?&]v=([A-Za-z0-9_-]{11})/) ||
    String(url).match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Load all plugin configs from plugins/*.json.
 * Returns an array of channel objects ready to merge into db.data.channels.
 */
function loadPlugins() {
  if (!fs.existsSync(PLUGINS_DIR)) return [];

  const files = fs.readdirSync(PLUGINS_DIR).filter((f) => f.endsWith('.json'));
  const channels = [];
  const usedNumbers = new Set();

  for (const file of files) {
    const filePath = path.join(PLUGINS_DIR, file);
    let config;

    try {
      config = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
      console.warn(`[Plugin] Skipping ${file}: invalid JSON — ${err.message}`);
      continue;
    }

    // Validate required fields
    if (!config.name || typeof config.name !== 'string') {
      console.warn(`[Plugin] Skipping ${file}: missing "name"`);
      continue;
    }
    if (!config.channelNumber || typeof config.channelNumber !== 'number') {
      console.warn(`[Plugin] Skipping ${file}: missing or invalid "channelNumber"`);
      continue;
    }
    if (config.channelNumber < 95) {
      console.warn(`[Plugin] Skipping ${file}: channelNumber must be 95+ (got ${config.channelNumber}). Channels 1-94 are reserved.`);
      continue;
    }
    if (usedNumbers.has(config.channelNumber)) {
      console.warn(`[Plugin] Skipping ${file}: duplicate channelNumber ${config.channelNumber}`);
      continue;
    }
    // Live plugin: { "name", "channelNumber", "live": "https://www.youtube.com/live/<id>" }
    // — a 24/7 YouTube stream as a channel, no playlist needed.
    if (typeof config.live === 'string' && config.live.trim()) {
      const liveId = extractLiveVideoId(config.live);
      if (!liveId) {
        console.warn(`[Plugin] Skipping ${file}: "live" is not a YouTube live/watch URL`);
        continue;
      }
      usedNumbers.add(config.channelNumber);
      const slug = slugify(config.name);
      channels.push({
        id: `ch-live-${slug}`,
        liveSlug: slug,
        isLive: true,
        isPlugin: true,
        channelNumber: config.channelNumber,
        name: config.name,
        description: config.description || '',
        decade: null,
        category: config.category || 'Live',
        enabled: config.enabled !== false,
        settings: { shuffle: false, includeCommercials: false },
        liveVideoId: liveId,
        liveUrl: `https://www.youtube.com/live/${liveId}`,
        liveYoutubeChannel: config.youtubeChannel || '',
        liveOnline: true,
        thumbnailUrl: config.thumbnailUrl || '',
        pluginConfig: { configFile: file, videoSources: [], live: config.live },
        cachedVideos: [{ id: liveId, title: config.name, description: '', duration: 0, thumbnailUrl: '', isLive: true, isDead: false, lastVerified: Date.now() }],
        lastVideoSync: new Date().toISOString(),
      });
      console.log(`[Plugin] Loaded live channel "${config.name}" (CH ${config.channelNumber}) — ${liveId}`);
      continue;
    }

    if (!config.yamlFile || typeof config.yamlFile !== 'string') {
      console.warn(`[Plugin] Skipping ${file}: missing "yamlFile" (or "live" for a live channel)`);
      continue;
    }

    usedNumbers.add(config.channelNumber);

    // Parse the referenced YAML file
    const yamlPath = resolveYamlPath(config.yamlFile);
    const videoSources = parseYamlFile(yamlPath);
    if (!fs.existsSync(yamlPath)) {
      console.warn(`[Plugin] "${config.name}": YAML file ${config.yamlFile} not found (looked in ${PLUGINS_DIR} and ${REPO_ROOT})`);
    }

    const id = `ch-plugin-${slugify(config.name)}`;

    channels.push({
      id,
      channelNumber: config.channelNumber,
      name: config.name,
      decade: null,
      category: null,
      enabled: config.enabled !== false,
      isPlugin: true,
      settings: {
        shuffle: config.settings?.shuffle !== false,
        includeCommercials: config.settings?.includeCommercials || false,
      },
      pluginConfig: {
        yamlFile: config.yamlFile,
        configFile: file,
        videoSources,
        // Optional: content-filter profile ("Cartoons", "Commercials"…)
        category: typeof config.category === 'string' ? config.category : null,
      },
      cachedVideos: [],
      lastVideoSync: null,
    });

    console.log(`[Plugin] Loaded "${config.name}" (CH ${config.channelNumber}) — ${videoSources.length} sources from ${config.yamlFile}`);
  }

  return channels;
}

/**
 * Get the list of current plugin channel IDs from disk.
 */
function getPluginIds() {
  return loadPlugins().map((ch) => ch.id);
}

module.exports = { loadPlugins, getPluginIds, parseYamlFile, resolveYamlPath, PLUGINS_DIR };