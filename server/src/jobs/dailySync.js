'use strict';

// Daily sync job: refreshes channel.cachedVideos[] in LowDB.
//
//   Grid + standalone channels → the SurfArr API(s) in REMOTE_API_URL
//                                (curated metadata; several APIs are merged)
//   Plugin channels            → API(s) first, then yt-dlp against the
//                                plugin's own YAML sources (playlists, channels
//                                or single videos) as the fallback
//
// Locally-flagged dead videos are never revived by a sync, and videos are
// merged (not replaced) so a partial failure never empties a channel.
//
// Run schedule: 3 AM daily (see jobs/scheduler.js)
// Can also be triggered manually via POST /api/settings/sync

const remoteClient = require('../api/remoteClient');
const memCache = require('../api/cache');
const ytdlp = require('../streaming/ytdlp');
const contentFilter = require('../content/contentFilter');
const { getDb } = require('../db/lowdb');
const { STANDALONE_CHANNELS } = require('../channels/channelGrid');
const { refreshRemoteConfig } = require('../channels/remoteConfig');
const { reconcileChannels, remotePluginChannels } = require('../channels/reconcile');
const { loadPlugins } = require('../plugins/pluginLoader');
const { resolveRemotePlugins } = require('../channels/remotePlugins');

// id → slug lookup for standalone channels, sourced from the shared registry
// so this file stays in sync when new standalone channels are added.
const STANDALONE_ID_TO_SLUG = new Map(STANDALONE_CHANNELS.map((c) => [c.id, c.slug]));

let syncInProgress = false;

function countMissingDuration(videos) {
  return videos.filter((v) => !v.duration || v.duration <= 0).length;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toCached(v) {
  return {
    id: v.id || v.videoId,
    title: v.title || 'Untitled',
    description: v.description || '',
    duration: parseInt(v.duration, 10) || 0,
    thumbnailUrl: v.thumbnailUrl || v.thumbnail || '',
    lastVerified: Date.now(),
    isDead: false,
  };
}

/**
 * Replace a channel's cachedVideos with a fresh list while keeping locally
 * discovered dead flags (so a sync never resurrects a video we know is gone).
 */
function applyVideos(channel, videos) {
  const dead = new Map((channel.cachedVideos || []).filter((v) => v.isDead).map((v) => [v.id, v]));
  const seen = new Set();
  const next = [];
  for (const raw of videos || []) {
    const v = toCached(raw);
    if (!v.id || seen.has(v.id)) continue;
    // Never cache placeholders for videos that went private / were deleted
    if (/^\s*\[(private|deleted) video\]\s*$/i.test(v.title || '')) continue;
    seen.add(v.id);
    const wasDead = dead.get(v.id);
    if (wasDead) {
      next.push({ ...v, isDead: true, deadReason: wasDead.deadReason, lastVerified: wasDead.lastVerified });
    } else {
      next.push(v);
    }
  }
  channel.cachedVideos = next;
  channel.lastVideoSync = new Date().toISOString();
  return next.length;
}

/**
 * Sync a plugin channel by expanding all its YAML entries via yt-dlp.
 * Each entry may be a playlist, a channel (@handle) or a single video.
 */
async function syncPluginChannel(channel) {
  const sources = channel.pluginConfig?.videoSources || [];
  if (sources.length === 0) {
    console.log(`[Sync] Plugin "${channel.name}": no video sources in YAML`);
    return 0;
  }

  const allVideos = [];
  const seen = new Set();
  let failures = 0;

  // Keep every source to its show: drop reactions/reviews/top-10s/Shorts etc.
  const filterCategory = channel.pluginConfig?.category || channel.category || 'Shows';

  for (const source of sources) {
    try {
      const listed = await ytdlp.listPlaylist(source.url);
      const { kept, dropped } = contentFilter.filterVideos(listed, {
        category: filterCategory,
        showName: source.showName,
      });
      if (dropped.length) {
        console.log(`[Sync]   ${source.showName || source.url}: filtered ${dropped.length}/${listed.length} non-show videos`);
      }
      const videos = kept;
      let added = 0;
      for (const v of videos) {
        if (!seen.has(v.id)) {
          seen.add(v.id);
          allVideos.push(v);
          added++;
        }
      }
      console.log(`[Sync]   ${source.showName || source.url}: ${added} videos`);
      await sleep(1500); // be polite between sources
    } catch (err) {
      failures++;
      console.warn(`[Sync] Plugin "${channel.name}" — error fetching ${source.url}: ${err.message}`);
    }
  }

  if (!allVideos.length && failures === sources.length) {
    throw new Error(`all ${sources.length} sources failed`);
  }

  return applyVideos(channel, allVideos);
}

// Fetch a built-in channel's videos from every API that carries it.
// → the remoteClient "detailed" shape: { videos, okCount, failCount, results }
function fetchFromApis(channel) {
  const standaloneSlug = channel.standaloneSlug || STANDALONE_ID_TO_SLUG.get(channel.id);
  if (standaloneSlug) return remoteClient.fetchStandaloneVideosDetailed(standaloneSlug, channel.apis);
  if (channel.isPlugin) {
    return remoteClient.fetchPluginVideosDetailed(channel.id.replace(/^ch-plugin-/, ''), channel.apis);
  }
  return remoteClient.fetchChannelVideosDetailed(channel.decade, channel.category, channel.apis);
}

function describeFailure(detail) {
  return detail.results
    .filter((r) => !r.ok)
    .map((r) => (detail.results.length > 1 ? `${r.api}: ${r.error}` : r.error))
    .join('; ');
}

// When one of several APIs didn't answer, keep the videos we already had that
// the others didn't return, so that API's shows stay on air until it is back.
function withPrevious(channel, detail) {
  if (!detail.failCount) return detail.videos;
  const have = new Set(detail.videos.map((v) => v.id || v.videoId));
  const kept = (channel.cachedVideos || []).filter((v) => !v.isLive && !have.has(v.id));
  return [...detail.videos, ...kept];
}

async function runDailySync() {
  if (syncInProgress) {
    return { skipped: true, reason: 'sync already in progress' };
  }
  syncInProgress = true;
  const db = getDb();
  console.log('[Sync] Starting sync...');
  let syncedCount = 0;
  let pluginSyncedCount = 0;
  let errorCount = 0;

  try {
    // A sync always asks the API(s) again (the in-memory cache only spares
    // repeat lookups between syncs).
    memCache.invalidate();

    // Step 0: pull the latest channel definitions (grid, standalone, live)
    // so a channel added or renumbered on an API shows up here without a
    // restart. Live stream IDs also rotate — this is where they refresh.
    try {
      const { remoteConfig, source } = await refreshRemoteConfig(db);
      const localPlugins = loadPlugins();
      // Plugin channels hosted on an API can come and go too. If that lookup
      // itself breaks, keep the ones we have.
      let remotePlugins;
      try {
        remotePlugins = await resolveRemotePlugins(db.data.channels, localPlugins, remoteConfig, { quiet: true });
      } catch {
        remotePlugins = remotePluginChannels(db.data.channels);
      }
      const r = reconcileChannels(db.data.channels, [...localPlugins, ...remotePlugins], remoteConfig);
      db.data.channels = r.channels;
      if (r.added || r.removed) console.log(`[Sync] Lineup from ${source}: +${r.added} / -${r.removed} channels`);
    } catch (err) {
      console.warn(`[Sync] Could not refresh channel lineup: ${err.message}`);
    }

    for (const channel of db.data.channels) {
      if (!channel.enabled) continue;

      // Live channels carry their single stream in cachedVideos already
      if (channel.isLive) continue;

      // Standalone channels: the API's /videos/channel/:slug serves the
      // curated list (or the matching plugin pack).
      const standaloneSlug = channel.standaloneSlug || STANDALONE_ID_TO_SLUG.get(channel.id);
      if (standaloneSlug) {
        try {
          const detail = await fetchFromApis(channel);
          if (detail.okCount === 0) throw new Error(describeFailure(detail) || 'no API answered');
          if (detail.failCount) console.warn(`[Sync] Standalone "${channel.name}": partial answer (${describeFailure(detail)})`);
          const videos = withPrevious(channel, detail);
          if (videos.length > 0) {
            const n = applyVideos(channel, videos);
            const missing = countMissingDuration(channel.cachedVideos);
            const warn = missing > 0 ? ` (${missing} missing duration, will be skipped)` : '';
            console.log(`[Sync] Standalone "${channel.name}": ${n} videos${warn}`);
            syncedCount++;
          } else {
            // An empty answer from every API is authoritative (the API no
            // longer falls back to decade filler) — drop stale content so the
            // channel hides from the lineup instead of playing the wrong show.
            if ((channel.cachedVideos || []).length) console.warn(`[Sync] Standalone "${channel.name}": API has no videos — clearing ${channel.cachedVideos.length} stale entries`);
            applyVideos(channel, []);
          }
        } catch (err) {
          console.error(`[Sync] Standalone "${channel.name}" failed: ${err.message}`);
          errorCount++;
        }
        continue;
      }

      // Plugin channels: try the API(s) first, fall back to yt-dlp
      if (channel.isPlugin) {
        let fromApi = false;
        try {
          const detail = await fetchFromApis(channel);
          const videos = detail.okCount ? withPrevious(channel, detail) : [];
          if (detail.videos.length > 0) {
            const n = applyVideos(channel, videos);
            console.log(`[Sync] Plugin "${channel.name}": ${n} videos from API`);
            pluginSyncedCount++;
            fromApi = true;
          }
        } catch {
          // API unavailable — fall back to yt-dlp
        }
        if (fromApi) continue;

        try {
          const count = await syncPluginChannel(channel);
          console.log(`[Sync] Plugin "${channel.name}": ${count} videos via yt-dlp`);
          pluginSyncedCount++;
        } catch (err) {
          console.error(`[Sync] Plugin "${channel.name}" failed: ${err.message}`);
          errorCount++;
        }
        continue;
      }

      // Grid channels: sync from the API(s)
      let videos = memCache.get(channel.decade, channel.category);
      if (!videos) {
        try {
          const detail = await fetchFromApis(channel);
          if (detail.okCount === 0) throw new Error(describeFailure(detail) || 'no API answered');
          if (detail.failCount) console.warn(`[Sync] ${channel.id}: partial answer (${describeFailure(detail)})`);
          videos = withPrevious(channel, detail);
          // Only a complete answer is worth remembering
          if (!detail.failCount) memCache.set(channel.decade, channel.category, videos);
        } catch (err) {
          console.error(`[Sync] Failed for ${channel.id}: ${err.message}`);
          errorCount++;
          continue;
        }
      }

      if (!videos || !videos.length) {
        console.warn(`[Sync] ${channel.id}: API returned no videos — keeping previous list`);
        continue;
      }

      applyVideos(channel, videos);
      const missing = countMissingDuration(channel.cachedVideos);
      if (missing > 0) {
        console.warn(
          `[Sync] ${channel.id}: ${missing}/${channel.cachedVideos.length} videos missing duration — they will be skipped by virtualClock`
        );
      }
      syncedCount++;
    }

    db.data.lastSync = new Date().toISOString();
    await db.write();

    // Schedule changed → regenerate the guide on next request
    require('../epg/generator').invalidateCache();

    console.log(`[Sync] Done. Grid: ${syncedCount}, Plugins: ${pluginSyncedCount}, Errors: ${errorCount}`);
    return { syncedCount, pluginSyncedCount, errorCount };
  } finally {
    syncInProgress = false;
  }
}

/**
 * Sync a single channel (used right after a plugin install).
 */
async function syncChannel(channelId) {
  const db = getDb();
  const channel = db.data.channels.find((c) => c.id === channelId);
  if (!channel) throw new Error(`Channel ${channelId} not found`);

  if (channel.isPlugin) {
    try {
      const detail = await fetchFromApis(channel);
      if (detail.videos.length > 0) {
        const n = applyVideos(channel, withPrevious(channel, detail));
        await db.write();
        return { source: 'api', count: n };
      }
    } catch {
      // fall through
    }
    const n = await syncPluginChannel(channel);
    await db.write();
    return { source: 'yt-dlp', count: n };
  }

  if (channel.isLive) return { source: 'live', count: channel.cachedVideos.length };
  const detail = await fetchFromApis(channel);
  if (detail.okCount === 0) throw new Error(describeFailure(detail) || 'no API answered');
  const n = applyVideos(channel, withPrevious(channel, detail));
  await db.write();
  return { source: 'api', count: n };
}

module.exports = { runDailySync, syncChannel, applyVideos };
