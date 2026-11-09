'use strict';

// Remote channel definitions — the API's /config is the single source of truth
// for which channels exist (grid, standalone, live). It is fetched at boot and
// on every sync, and the last good copy is cached in db.json so an instance
// that boots offline (or while the API is down) keeps its lineup instead of
// silently falling back to an older code-defined grid.
//
// With several APIs in REMOTE_API_URL each one is fetched and cached on its
// own (db.data.remoteConfigBySource) and the results are merged (see
// mergeConfigs.js). If one API is down its cached lineup is used, so its
// channels stay put while the others keep updating.
//
// REMOTE_CONFIG_MAX_AGE_HOURS (default 168 = 7 days): a cached copy older than
// this is still used, but a warning is logged so stale lineups are visible.

const remoteClient = require('../api/remoteClient');
const config = require('../config');
const { mergeConfigs } = require('./mergeConfigs');

const MAX_AGE_MS = (parseInt(process.env.REMOTE_CONFIG_MAX_AGE_HOURS, 10) || 168) * 3600 * 1000;

function slim(c) {
  return {
    startEpoch: c.startEpoch,
    decades: c.decades,
    categories: c.categories,
    channelGrid: c.channelGrid,
    liveChannels: c.liveChannels || [],
    pluginChannels: c.pluginChannels || [],
  };
}

/**
 * Refresh db.data.remoteConfig from the API(s). Returns the config to use
 * (fresh, cached, or null → local fallback) plus where it came from.
 */
async function refreshRemoteConfig(db) {
  const urls = remoteClient.sources();
  if (!urls.length) {
    return { remoteConfig: null, source: 'local (REMOTE_API_URL not set)' };
  }

  const results = await remoteClient.fetchConfigs();
  const cache = db.data.remoteConfigBySource && typeof db.data.remoteConfigBySource === 'object'
    ? db.data.remoteConfigBySource
    : {};
  // db.json from before multi-API support: the single cached lineup belongs
  // to what was then the only API.
  if (!db.data.remoteConfigBySource && db.data.remoteConfig && Array.isArray(db.data.remoteConfig.channelGrid)) {
    cache[urls[0]] = { fetchedAt: db.data.remoteConfig.fetchedAt, config: slim(db.data.remoteConfig) };
  }

  const now = new Date().toISOString();
  const parts = [];
  const status = [];
  for (const r of results) {
    if (r.ok) {
      cache[r.api] = { fetchedAt: now, config: slim(r.config) };
      parts.push({ api: r.api, config: cache[r.api].config });
      status.push({ api: r.api, state: 'api', channels: r.config.channelGrid.length + (r.config.liveChannels || []).length });
      continue;
    }
    const cached = cache[r.api];
    if (cached && cached.config && Array.isArray(cached.config.channelGrid)) {
      const age = Date.now() - new Date(cached.fetchedAt || 0).getTime();
      const hours = Math.round(age / 3600000);
      if (age > MAX_AGE_MS || urls.length > 1) {
        console.warn(`[Channels] ${r.api} unreachable (${r.error}); using its cached lineup from ${hours}h ago`);
      }
      parts.push({ api: r.api, config: cached.config });
      status.push({ api: r.api, state: 'cache', ageHours: hours, error: r.error, channels: cached.config.channelGrid.length + (cached.config.liveChannels || []).length });
    } else {
      console.warn(`[Channels] ${r.api} unreachable (${r.error}) and no cached lineup for it`);
      status.push({ api: r.api, state: 'down', error: r.error, channels: 0 });
    }
  }

  // Forget APIs that are no longer configured
  for (const key of Object.keys(cache)) if (!urls.includes(key)) delete cache[key];
  db.data.remoteConfigBySource = cache;

  const merged = mergeConfigs(parts);
  if (!merged) {
    db.data.remoteConfigSources = status;
    console.warn('[Channels] No API reachable and no cached lineup — using built-in grid');
    return { remoteConfig: null, source: 'local (API unreachable)' };
  }

  const fresh = status.filter((s) => s.state === 'api').length;
  const previous = db.data.remoteConfig && db.data.remoteConfig.fetchedAt;
  const stored = { fetchedAt: fresh ? now : previous || now, ...merged };
  db.data.remoteConfig = stored;
  db.data.remoteConfigSources = status;

  const cachedCount = status.filter((s) => s.state === 'cache').length;
  let source;
  if (urls.length === 1) {
    source = fresh ? 'api' : `cache (${status[0].ageHours}h old)`;
  } else {
    const bits = [];
    if (fresh) bits.push(`${fresh} live`);
    if (cachedCount) bits.push(`${cachedCount} cached`);
    if (status.length - fresh - cachedCount) bits.push(`${status.length - fresh - cachedCount} down`);
    source = `${urls.length} APIs (${bits.join(', ')})`;
  }
  return { remoteConfig: stored, source };
}

module.exports = { refreshRemoteConfig };
