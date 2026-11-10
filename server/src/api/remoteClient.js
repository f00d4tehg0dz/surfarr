'use strict';

// Read-only HTTP client for the SurfArr metadata API(s).
// SurfArr NEVER writes to an API — it only reads channel and video metadata.
//
// REMOTE_API_URL can list more than one API (comma separated), for example the
// public SurfArr API plus one you host yourself (see api-server/). Every call
// here asks each API that carries the channel and merges the answers:
//   - the lineup (/config, /plugins, /live) is the union of all APIs
//   - a channel's videos are the union too, first API first, de-duplicated
//   - one API being down never takes the others with it
// With a single API the behaviour is exactly what it always was.

const config = require('../config');

// Tiny GET-JSON helper on Node's built-in fetch (no axios): query params, a
// timeout, and throwing on non-2xx with err.response = { status, data }.
function createClient(baseUrl) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  return {
    async get(path, { params, timeout = 15000 } = {}) {
      const url = new URL(base + path);
      for (const [k, v] of Object.entries(params || {})) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(timeout),
      });
      const text = await res.text();
      let data = text;
      try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
      if (!res.ok) {
        const err = new Error(`Request failed with status code ${res.status}`);
        err.response = { status: res.status, data };
        throw err;
      }
      return { status: res.status, data };
    },
  };
}

// Every configured API, in priority order.
function sources() {
  return (config.remoteApiUrls || []).slice();
}

// The APIs to ask for one channel: the ones that list it (channel.apis, set
// from each API's /config) that are still configured — or all of them when
// that isn't known (older db.json, built-in grid fallback).
function pick(apis) {
  const all = sources();
  if (!Array.isArray(apis) || !apis.length) return all;
  const wanted = all.filter((u) => apis.includes(u));
  return wanted.length ? wanted : all;
}

function requireSources() {
  if (!sources().length) throw new Error('REMOTE_API_URL is not configured');
}

// "This API doesn't have that" is an answer, not an outage.
function isNotFound(err) {
  const s = err && err.response && err.response.status;
  return s === 404 || s === 400;
}

function mergeVideoLists(lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const v of Array.isArray(list) ? list : []) {
      const id = v && (v.id || v.videoId);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(v);
    }
  }
  return out;
}

// Ask each API for a video list and merge. Never throws for a partial
// failure: check okCount / failCount.
//   → { videos, okCount, failCount, results: [{ api, ok, count, error }] }
async function fetchVideoLists(path, { params, apis, timeout } = {}) {
  requireSources();
  const targets = pick(apis);
  const settled = await Promise.all(
    targets.map(async (api) => {
      try {
        const { data } = await createClient(api).get(path, { params, timeout });
        return { api, ok: true, list: Array.isArray(data) ? data : [] };
      } catch (err) {
        if (isNotFound(err)) return { api, ok: true, list: [] };
        return { api, ok: false, list: [], error: err.message };
      }
    })
  );
  const okCount = settled.filter((r) => r.ok).length;
  return {
    videos: mergeVideoLists(settled.map((r) => r.list)),
    okCount,
    failCount: settled.length - okCount,
    results: settled.map((r) => ({ api: r.api, ok: r.ok, count: r.list.length, error: r.error })),
  };
}

function failureMessage(detail) {
  const failed = detail.results.filter((r) => !r.ok);
  return failed.map((r) => (detail.results.length > 1 ? `${r.api}: ${r.error}` : r.error)).join('; ');
}

// Array-returning wrapper: throws only when every API failed.
async function videosOrThrow(path, opts) {
  const detail = await fetchVideoLists(path, opts);
  if (detail.okCount === 0) throw new Error(failureMessage(detail) || 'no API answered');
  return detail.videos;
}

// --- Video lists -----------------------------------------------------------
// The *Detailed variants return the fetchVideoLists() shape (used by the sync
// job, which treats a partial answer differently from a complete one).

const channelVideosPath = () => '/videos';
const standalonePath = (slug) => `/videos/channel/${encodeURIComponent(slug)}`;
const pluginPath = (pluginId) => `/plugins/${encodeURIComponent(pluginId)}/videos`;

// All videos for a decade + category channel.
// Expected response shape: [{ id, title, description, duration, thumbnailUrl }, ...]
function fetchChannelVideosDetailed(decade, category, apis) {
  return fetchVideoLists(channelVideosPath(), { params: { decade, category }, apis });
}
function fetchChannelVideos(decade, category, apis) {
  return videosOrThrow(channelVideosPath(), { params: { decade, category }, apis });
}

// Videos for a standalone channel (e.g. classic-nickelodeon, fox-kids)
function fetchStandaloneVideosDetailed(channelId, apis) {
  return fetchVideoLists(standalonePath(channelId), { apis });
}
function fetchStandaloneVideos(channelId, apis) {
  return videosOrThrow(standalonePath(channelId), { apis });
}

// Videos for a plugin channel
function fetchPluginVideosDetailed(pluginId, apis) {
  return fetchVideoLists(pluginPath(pluginId), { apis });
}
function fetchPluginVideos(pluginId, apis) {
  return videosOrThrow(pluginPath(pluginId), { apis });
}

// All videos in a playlist by playlist ID.
function fetchPlaylistVideos(playlistId, apis) {
  return videosOrThrow(`/playlists/${encodeURIComponent(playlistId)}/videos`, { apis });
}

// --- Lineup ----------------------------------------------------------------

// /config from every API, one result per API (never throws):
//   [{ api, ok, config?, error? }]
// channels/remoteConfig.js merges them and falls back to each API's cached
// copy when it is unreachable.
async function fetchConfigs() {
  return Promise.all(
    sources().map(async (api) => {
      try {
        const { data } = await createClient(api).get('/config', { timeout: 10000 });
        if (!data || !Array.isArray(data.channelGrid)) throw new Error('unexpected /config payload');
        return { api, ok: true, config: data };
      } catch (err) {
        return { api, ok: false, error: err.message };
      }
    })
  );
}

// The first API's /config (kept for callers that only want one).
async function fetchConfig() {
  const all = sources();
  if (!all.length) return null;
  const { data } = await createClient(all[0]).get('/config', { timeout: 10000 });
  if (!data || !Array.isArray(data.channelGrid)) throw new Error('unexpected /config payload');
  return data;
}

// Plugin channels from every API, merged by pluginId (first API wins). Each
// entry carries `apis`: the APIs that have it. `failed` lists the APIs that
// did not answer, so callers can keep what they already had from those.
async function fetchPluginChannelsDetailed() {
  const results = await Promise.all(
    sources().map(async (api) => {
      try {
        const { data } = await createClient(api).get('/plugins');
        return { api, ok: true, list: Array.isArray(data) ? data : [] };
      } catch (err) {
        return { api, ok: isNotFound(err), list: [] };
      }
    })
  );
  const byId = new Map();
  for (const { api, list } of results) {
    for (const p of list) {
      if (!p || !p.pluginId) continue;
      const have = byId.get(p.pluginId);
      if (have) have.apis.push(api);
      else byId.set(p.pluginId, { ...p, apis: [api] });
    }
  }
  return { list: [...byId.values()], failed: results.filter((r) => !r.ok).map((r) => r.api) };
}

async function fetchPluginChannels() {
  return (await fetchPluginChannelsDetailed()).list;
}

// 24/7 live channels from every API (also embedded in /config; this is the
// cheap refresh). Merged by slug, first API wins.
async function fetchLiveChannels() {
  const bySlug = new Map();
  const results = await Promise.all(
    sources().map(async (api) => {
      try {
        const { data } = await createClient(api).get('/live', { timeout: 10000 });
        return Array.isArray(data) ? data : [];
      } catch {
        return [];
      }
    })
  );
  for (const list of results) {
    for (const l of list) {
      const key = l && (l.slug || l.id);
      if (key && !bySlug.has(key)) bySlug.set(key, l);
    }
  }
  return [...bySlug.values()];
}

// --- Health ----------------------------------------------------------------

// One entry per API: [{ api, ok }]
async function pingAll() {
  return Promise.all(
    sources().map(async (api) => {
      try {
        await createClient(api).get('/health', { timeout: 5000 });
        return { api, ok: true };
      } catch {
        return { api, ok: false };
      }
    })
  );
}

// True when at least one API answers.
async function pingRemoteApi() {
  return (await pingAll()).some((r) => r.ok);
}

module.exports = {
  sources,
  fetchChannelVideos,
  fetchChannelVideosDetailed,
  fetchPlaylistVideos,
  pingRemoteApi,
  pingAll,
  fetchPluginChannels,
  fetchPluginChannelsDetailed,
  fetchPluginVideos,
  fetchPluginVideosDetailed,
  fetchStandaloneVideos,
  fetchStandaloneVideosDetailed,
  fetchConfig,
  fetchConfigs,
  fetchLiveChannels,
  mergeVideoLists,
};
