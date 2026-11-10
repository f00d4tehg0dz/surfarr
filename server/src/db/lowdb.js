'use strict';

// LowDB v3 is the last CommonJS-compatible version.
// Provides a simple JSON file database for user configuration and
// cached video data. All runtime reads/writes go through this module.

const { Low, JSONFile } = require('lowdb');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const { getDefaultSchema } = require('./schema');
const { reconcileChannels } = require('../channels/reconcile');
const { refreshRemoteConfig } = require('../channels/remoteConfig');
const { loadPlugins } = require('../plugins/pluginLoader');
const { resolveRemotePlugins } = require('../channels/remotePlugins');

let db = null;

// Decide the HDHomeRun device ID once and persist it. Order of precedence:
//   DEVICE_ID env  → db.deviceId (existing install) → legacy MAC-derived value
//   for installs that pre-date persistence → fresh checksum-valid ID.
function resolveDeviceId(isFirstBoot) {
  if (process.env.DEVICE_ID) {
    const id = process.env.DEVICE_ID.trim().toUpperCase();
    if (!/^[0-9A-F]{8}$/.test(id)) {
      console.warn(`[DB] DEVICE_ID="${id}" is not 8 hex characters — Plex/Jellyfin may reject it`);
    }
    return id;
  }
  if (db.data.deviceId) return db.data.deviceId;
  // Existing databases keep the ID their media server already knows.
  return isFirstBoot ? config.freshDeviceId() : config.legacyDeviceId();
}

async function initDb() {
  // Ensure the directory for db.json exists
  const dbDir = path.dirname(config.dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const adapter = new JSONFile(config.dbPath);
  db = new Low(adapter);

  // Read existing data (or null if file doesn't exist yet). A corrupt file
  // (e.g. a crash mid-write) is backed up instead of taking the server down.
  try {
    await db.read();
  } catch (err) {
    const backup = `${config.dbPath}.corrupt-${Date.now()}`;
    console.error(`[DB] db.json is unreadable (${err.message}) — moving it to ${backup} and starting fresh`);
    try { fs.renameSync(config.dbPath, backup); } catch {}
    db.data = null;
  }

  let dirty = false;
  const isFirstBoot = !db.data;

  if (isFirstBoot) {
    db.data = getDefaultSchema();
    db.data.startEpoch = Date.now();
    dirty = true;
    console.log('[DB] First boot — database initialized at', config.dbPath);
  } else if (!db.data.startEpoch) {
    db.data.startEpoch = Date.now();
    dirty = true;
    console.log('[DB] Migration: startEpoch was unset, initialized to', db.data.startEpoch);
  }

  // Defensive defaults for databases written by older versions
  db.data.settings = db.data.settings || getDefaultSchema().settings;
  db.data.channels = Array.isArray(db.data.channels) ? db.data.channels : [];
  db.data.reports = Array.isArray(db.data.reports) ? db.data.reports : [];
  // The dashboard setting wins over the env default for the ffmpeg scaler
  if (db.data.settings.streamQuality) config.streamQuality = db.data.settings.streamQuality;

  // Which metadata API(s) to read. REMOTE_API_URL is the default; a list
  // saved from the dashboard (remoteApiUrlCustom) replaces it until cleared.
  const savedApis = db.data.settings.remoteApiUrlCustom ? config.parseApiUrls(db.data.settings.remoteApiUrl) : [];
  if (savedApis.length) {
    config.setRemoteApiUrls(savedApis);
  } else {
    const fromEnv = config.envRemoteApiUrls.join(', ');
    if (db.data.settings.remoteApiUrl !== fromEnv || db.data.settings.remoteApiUrlCustom) {
      db.data.settings.remoteApiUrl = fromEnv;
      db.data.settings.remoteApiUrlCustom = false;
      dirty = true;
    }
  }
  if (config.remoteApiUrls.length > 1) {
    console.log(`[DB] Channel sources (${config.remoteApiUrls.length}): ${config.remoteApiUrls.join(', ')}`);
  }

  const deviceId = resolveDeviceId(isFirstBoot);
  if (db.data.deviceId !== deviceId) {
    db.data.deviceId = deviceId;
    dirty = true;
  }
  config.deviceId = deviceId;

  // Channel definitions: API /config (grid + standalone + live) when
  // reachable, cached copy when not, code-defined grid as last resort.
  const { remoteConfig, source } = await refreshRemoteConfig(db);
  console.log(`[DB] Channel lineup source: ${source}`);
  if (remoteConfig) dirty = true;

  // Reconcile channel grid + plugins: add new channels, remove stale ones,
  // preserve existing data (cachedVideos, settings, enabled) for channels that stay.
  const localPlugins = loadPlugins();

  // Also fetch plugin channels from the API(s) (non-blocking on failure)
  let remotePlugins = [];
  try {
    remotePlugins = await resolveRemotePlugins(db.data.channels, localPlugins, remoteConfig);
  } catch (err) {
    console.warn(`[DB] Could not fetch remote plugin channels (${err.message}) — continuing with local plugins only`);
  }

  const result = reconcileChannels(db.data.channels, [...localPlugins, ...remotePlugins], remoteConfig);
  const liveCount = result.channels.filter((c) => c.isLive).length;
  if (result.added > 0 || result.removed > 0 || isFirstBoot) {
    db.data.channels = result.channels;
    dirty = true;
    console.log(`[DB] Channels reconciled: +${result.added} added, -${result.removed} removed (${result.pluginCount} plugins, ${liveCount} live)`);
  } else {
    // Structural fields may still have changed (renames, renumbering)
    db.data.channels = result.channels;
  }

  if (dirty) await db.write();
  return db;
}

function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

module.exports = { initDb, getDb };
