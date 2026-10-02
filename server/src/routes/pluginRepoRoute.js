'use strict';

// Plugin Repository routes:
//   GET  /api/plugins/repo        — browse available community plugins
//   GET  /api/plugins/installed   — list locally installed plugin configs
//   POST /api/plugins/install     — install a plugin from the repo
//   POST /api/plugins/uninstall   — remove a locally installed plugin

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { getDb } = require('../db/lowdb');
const { loadPlugins, PLUGINS_DIR } = require('../plugins/pluginLoader');
const { reconcileChannels, remotePluginChannels } = require('../channels/reconcile');
const config = require('../config');

const REPO_DIR = config.pluginRepoDir;

// The GitHub raw URL base for fetching plugin files remotely.
// Falls back to reading from the local plugin-repo/ directory if this is
// not configured (self-hosted / development mode).
const GITHUB_REPO_URL = process.env.PLUGIN_REPO_URL || 'https://raw.githubusercontent.com/f00d4tehg0dz/surfarr/main/plugin-repo';

// --- Helpers ---

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function getInstalledPluginFiles() {
  if (!fs.existsSync(PLUGINS_DIR)) return [];
  return fs.readdirSync(PLUGINS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const config = JSON.parse(fs.readFileSync(path.join(PLUGINS_DIR, f), 'utf8'));
        return { ...config, _configFile: f };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function loadManifest() {
  // Try remote GitHub URL first
  if (GITHUB_REPO_URL) {
    const manifestUrl = GITHUB_REPO_URL.replace(/\/$/, '') + '/manifest.json';
    try {
      const data = await fetchUrl(manifestUrl);
      return JSON.parse(data);
    } catch (err) {
      console.warn(`[PluginRepo] Failed to fetch remote manifest: ${err.message}, falling back to local`);
    }
  }

  // Fall back to local plugin-repo/ directory
  const localManifest = path.join(REPO_DIR, 'manifest.json');
  if (fs.existsSync(localManifest)) {
    return JSON.parse(fs.readFileSync(localManifest, 'utf8'));
  }

  return { version: 1, plugins: [] };
}

async function fetchPluginFile(filename) {
  // Try remote first
  if (GITHUB_REPO_URL) {
    const fileUrl = GITHUB_REPO_URL.replace(/\/$/, '') + '/' + filename;
    try {
      return await fetchUrl(fileUrl);
    } catch (err) {
      console.warn(`[PluginRepo] Failed to fetch remote ${filename}: ${err.message}, falling back to local`);
    }
  }

  // Fall back to local — basename so a manifest entry can never escape REPO_DIR
  const localPath = path.join(REPO_DIR, path.basename(filename));
  if (fs.existsSync(localPath)) {
    return fs.readFileSync(localPath, 'utf8');
  }

  throw new Error(`Plugin file not found: ${filename}`);
}

// --- Routes ---

// GET /repo — browse available plugins, annotated with install status
router.get('/repo', async (req, res) => {
  try {
    const manifest = await loadManifest();
    const installed = getInstalledPluginFiles();
    const installedNames = new Set(installed.map((p) => p.name));

    const plugins = manifest.plugins.map((p) => ({
      ...p,
      installed: installedNames.has(p.name),
    }));

    res.json({
      version: manifest.version,
      plugins,
      totalAvailable: plugins.length,
      totalInstalled: plugins.filter((p) => p.installed).length,
    });
  } catch (err) {
    console.error('[PluginRepo] Error loading manifest:', err.message);
    res.status(500).json({ error: 'Failed to load plugin repository' });
  }
});

// GET /installed — list locally installed plugins with their status
router.get('/installed', (req, res) => {
  const installed = getInstalledPluginFiles();
  const db = getDb();
  const channels = db.data.channels || [];

  const result = installed.map((config) => {
    const channel = channels.find(
      (ch) => ch.isPlugin && ch.pluginConfig?.configFile === config._configFile
    );
    return {
      name: config.name,
      channelNumber: config.channelNumber,
      configFile: config._configFile,
      yamlFile: config.yamlFile,
      enabled: channel?.enabled ?? config.enabled !== false,
      videoCount: channel?.cachedVideos?.length ?? 0,
      lastSync: channel?.lastVideoSync ?? null,
    };
  });

  res.json(result);
});

// POST /install — install a plugin from the repository
router.post('/install', async (req, res) => {
  const { pluginId } = req.body;
  if (!pluginId) {
    return res.status(400).json({ error: 'pluginId is required' });
  }

  try {
    const manifest = await loadManifest();
    const pluginMeta = manifest.plugins.find((p) => p.id === pluginId);
    if (!pluginMeta) {
      return res.status(404).json({ error: `Plugin "${pluginId}" not found in repository` });
    }

    // Check if already installed
    const installed = getInstalledPluginFiles();
    if (installed.some((p) => p.name === pluginMeta.name)) {
      return res.status(409).json({ error: `Plugin "${pluginMeta.name}" is already installed` });
    }

    // Check channel number conflict
    if (installed.some((p) => p.channelNumber === pluginMeta.channelNumber)) {
      return res.status(409).json({
        error: `Channel number ${pluginMeta.channelNumber} is already in use by another plugin`,
      });
    }

    // Manifest entries must be plain file names (no directories / traversal)
    for (const f of [pluginMeta.configFile, pluginMeta.yamlFile]) {
      if (typeof f !== 'string' || !/^[\w.-]+$/.test(f) || f.startsWith('.')) {
        return res.status(400).json({ error: `Invalid plugin file name in manifest: ${f}` });
      }
    }

    // Fetch plugin config JSON
    const configContent = await fetchPluginFile(pluginMeta.configFile);
    const pluginConfig = JSON.parse(configContent);

    // Fetch YAML file
    const yamlContent = await fetchPluginFile(pluginMeta.yamlFile);

    // Ensure the plugins dir exists (in Docker this lives on the db volume)
    if (!fs.existsSync(PLUGINS_DIR)) {
      fs.mkdirSync(PLUGINS_DIR, { recursive: true });
    }

    // Write the YAML next to the config so pluginLoader finds it regardless
    // of where the repo lives (or whether plugin-repo/ is writable).
    fs.writeFileSync(path.join(PLUGINS_DIR, path.basename(pluginMeta.yamlFile)), yamlContent, 'utf8');

    // Write the plugin config JSON to plugins/
    fs.writeFileSync(
      path.join(PLUGINS_DIR, path.basename(pluginMeta.configFile)),
      JSON.stringify(pluginConfig, null, 2),
      'utf8'
    );

    // Reconcile: reload plugins and merge into DB
    const db = getDb();
    db.data.channels = reconcileChannels(db.data.channels, [...loadPlugins(), ...remotePluginChannels(db.data.channels)], db.data.remoteConfig).channels;
    await db.write();

    // Sync videos for the newly installed plugin in the background
    // (remote API first, yt-dlp against the YAML as fallback).
    const newChannel = db.data.channels.find((ch) => ch.isPlugin && ch.name === pluginMeta.name);
    if (newChannel) {
      const { syncChannel } = require('../jobs/dailySync');
      syncChannel(newChannel.id)
        .then((r) => console.log(`[PluginRepo] Synced ${r.count} videos for "${pluginMeta.name}" via ${r.source}`))
        .catch((err) => console.warn(`[PluginRepo] Could not sync videos for "${pluginMeta.name}": ${err.message}`));
    }

    console.log(`[PluginRepo] Installed "${pluginMeta.name}" (CH ${pluginMeta.channelNumber})`);
    res.json({
      success: true,
      plugin: {
        name: pluginMeta.name,
        channelNumber: pluginMeta.channelNumber,
        configFile: pluginMeta.configFile,
      },
    });
  } catch (err) {
    console.error('[PluginRepo] Install error:', err.message);
    res.status(500).json({ error: `Failed to install plugin: ${err.message}` });
  }
});

// POST /uninstall — remove a locally installed plugin
router.post('/uninstall', async (req, res) => {
  const { pluginId } = req.body;
  if (!pluginId) {
    return res.status(400).json({ error: 'pluginId is required' });
  }

  try {
    // Find the manifest entry to get the config file name
    const manifest = await loadManifest();
    const pluginMeta = manifest.plugins.find((p) => p.id === pluginId);

    // Also check installed files directly (in case plugin isn't in manifest)
    const installed = getInstalledPluginFiles();
    let configFileName;

    if (pluginMeta) {
      configFileName = pluginMeta.configFile;
    } else {
      // Try to find by matching installed plugin names
      const match = installed.find((p) => p._configFile.replace('.json', '') === pluginId);
      if (match) configFileName = match._configFile;
    }

    if (!configFileName) {
      return res.status(404).json({ error: `Plugin "${pluginId}" not found` });
    }

    const configPath = path.join(PLUGINS_DIR, path.basename(configFileName));
    if (!fs.existsSync(configPath)) {
      return res.status(404).json({ error: `Plugin config file not found: ${configFileName}` });
    }

    // Remove the config JSON from plugins/
    fs.unlinkSync(configPath);

    // Also drop the YAML we wrote next to it (ignore if it lives elsewhere)
    const yamlName = pluginMeta?.yamlFile ? path.basename(pluginMeta.yamlFile) : null;
    if (yamlName && fs.existsSync(path.join(PLUGINS_DIR, yamlName))) {
      try { fs.unlinkSync(path.join(PLUGINS_DIR, yamlName)); } catch {}
    }

    // Reconcile DB — the removed plugin's channel is dropped
    const db = getDb();
    db.data.channels = reconcileChannels(db.data.channels, [...loadPlugins(), ...remotePluginChannels(db.data.channels)], db.data.remoteConfig).channels;
    await db.write();

    const pluginName = pluginMeta?.name || pluginId;
    console.log(`[PluginRepo] Uninstalled "${pluginName}"`);
    res.json({ success: true, plugin: { name: pluginName } });
  } catch (err) {
    console.error('[PluginRepo] Uninstall error:', err.message);
    res.status(500).json({ error: `Failed to uninstall plugin: ${err.message}` });
  }
});

module.exports = router;
