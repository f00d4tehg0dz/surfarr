'use strict';

// Merge the expected channel set into the persisted channel list. Shared by
// boot (lowdb.js), the daily sync and plugin install/uninstall so the callers
// can't drift apart.
//
// Where the expected set comes from (see remoteConfig.js):
//   1. the API's /config (grid + standalone + live channels) when reachable,
//      cached in db.json so offline boots still use the last known lineup
//   2. the code-defined grid in channelGrid.js as the last-resort fallback
//
// Rules:
//   - channels that exist in both keep their user data (cachedVideos, enabled,
//     settings) and take structural fields (number, name, decade, category)
//     from the expected set
//   - channels only in the expected set are added; channels only in the db
//     are dropped
//   - a plugin whose channel number collides with a built-in channel is moved
//     to the next free number ≥ 600 so the HDHomeRun lineup never advertises
//     two channels with the same GuideNumber

const { buildChannelGrid } = require('./channelGrid');

const PLUGIN_RENUMBER_START = 600;

function slugify(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9]/g, '-');
}

// Turn an API /config channelGrid entry into a local channel object.
function fromRemoteGridEntry(c) {
  const ch = {
    id: c.id || `ch-${slugify(c.decade)}-${slugify(c.category)}`,
    decade: c.decade || null,
    category: c.category || null,
    channelNumber: c.channelNumber,
    name: c.name || `${c.decade} ${c.category}`,
    enabled: true,
    settings: { shuffle: true, includeCommercials: false },
    cachedVideos: [],
    lastVideoSync: null,
  };
  if (c.isStandalone || c.standaloneSlug) {
    ch.standaloneSlug = c.standaloneSlug || c.id.replace(/^ch-/, '');
    ch.isStandalone = true;
  }
  // Which API(s) carry this channel — the sync job fetches its videos there
  if (Array.isArray(c.apis) && c.apis.length) ch.apis = c.apis;
  return ch;
}

// Turn an API live channel into a local channel object. Live channels have no
// virtual clock: cachedVideos holds the single current stream so every route
// that checks "has content" keeps working unchanged.
function fromRemoteLiveEntry(l) {
  const slug = l.slug || String(l.id || '').replace(/^ch-live-/, '');
  return {
    id: `ch-live-${slug}`,
    liveSlug: slug,
    isLive: true,
    decade: null,
    category: l.category || 'Live',
    channelNumber: l.channelNumber,
    name: l.name,
    description: l.description || '',
    enabled: true,
    settings: { shuffle: false, includeCommercials: false },
    liveVideoId: l.videoId,
    liveUrl: l.url || `https://www.youtube.com/live/${l.videoId}`,
    liveYoutubeChannel: l.youtubeChannel || '',
    liveOnline: l.isOnline !== false,
    thumbnailUrl: l.thumbnailUrl || '',
    uploader: l.uploader || '',
    cachedVideos: l.videoId
      ? [{ id: l.videoId, title: l.description || l.name, description: '', duration: 0, thumbnailUrl: l.thumbnailUrl || '', isLive: true, isDead: false, lastVerified: Date.now() }]
      : [],
    lastVideoSync: new Date().toISOString(),
  };
}

/**
 * Build the expected built-in channel list.
 * @param {object|null} remoteConfig — cached /config payload or null
 */
function expectedBuiltins(remoteConfig) {
  if (remoteConfig && Array.isArray(remoteConfig.channelGrid) && remoteConfig.channelGrid.length) {
    const grid = remoteConfig.channelGrid.map(fromRemoteGridEntry);
    const live = (remoteConfig.liveChannels || []).filter((l) => l && l.videoId).map(fromRemoteLiveEntry);
    return { channels: [...grid, ...live], source: 'api' };
  }
  return { channels: buildChannelGrid(), source: 'local' };
}

function reconcileChannels(existingChannels, pluginChannels, remoteConfig) {
  const builtins = expectedBuiltins(remoteConfig);
  const usedNumbers = new Set(builtins.channels.map((c) => c.channelNumber));
  let nextFree = PLUGIN_RENUMBER_START;

  const plugins = (pluginChannels || []).map((p) => {
    if (!usedNumbers.has(p.channelNumber)) {
      usedNumbers.add(p.channelNumber);
      return p;
    }
    while (usedNumbers.has(nextFree)) nextFree++;
    console.warn(
      `[Channels] Plugin "${p.name}" wants channel ${p.channelNumber} which is taken by a built-in channel — using ${nextFree} instead`
    );
    usedNumbers.add(nextFree);
    return { ...p, channelNumber: nextFree, requestedChannelNumber: p.channelNumber };
  });

  const allExpected = [...builtins.channels, ...plugins];
  const existingMap = new Map((existingChannels || []).map((c) => [c.id, c]));

  const reconciled = allExpected.map((expected) => {
    const existing = existingMap.get(expected.id);
    if (!existing) return expected;
    const merged = {
      ...existing,
      channelNumber: expected.channelNumber,
      name: expected.name,
      decade: expected.decade,
      category: expected.category,
      settings: { ...(expected.settings || {}), ...(existing.settings || {}) },
      cachedVideos: Array.isArray(existing.cachedVideos) ? existing.cachedVideos : [],
    };
    if (Array.isArray(expected.apis) && expected.apis.length) merged.apis = expected.apis;
    else delete merged.apis;
    if (expected.standaloneSlug) {
      merged.standaloneSlug = expected.standaloneSlug;
      merged.isStandalone = true;
    }
    if (expected.isPlugin) {
      merged.isPlugin = true;
      merged.pluginConfig = expected.pluginConfig;
    }
    if (expected.isLive) {
      // Live metadata always comes from the source (stream IDs rotate)
      Object.assign(merged, {
        isLive: true,
        liveSlug: expected.liveSlug,
        liveVideoId: expected.liveVideoId,
        liveUrl: expected.liveUrl,
        liveYoutubeChannel: expected.liveYoutubeChannel,
        liveOnline: expected.liveOnline,
        thumbnailUrl: expected.thumbnailUrl,
        uploader: expected.uploader,
        description: expected.description,
        cachedVideos: expected.cachedVideos,
        lastVideoSync: expected.lastVideoSync,
      });
    }
    return merged;
  });

  const expectedIds = new Set(allExpected.map((c) => c.id));
  const added = reconciled.filter((c) => !existingMap.has(c.id)).length;
  const removed = (existingChannels || []).filter((c) => !expectedIds.has(c.id)).length;

  return { channels: reconciled, added, removed, pluginCount: plugins.length, source: builtins.source };
}

// Plugin channels that came from the remote API (no local config file). They
// are re-fetched at boot; between boots they must survive a local
// install/uninstall reconcile.
function remotePluginChannels(existingChannels) {
  return (existingChannels || []).filter((c) => c.isPlugin && !(c.pluginConfig && c.pluginConfig.configFile));
}

module.exports = { reconcileChannels, remotePluginChannels, fromRemoteLiveEntry, expectedBuiltins };
