'use strict';

// Plugin channels that live on an API (no local config file in plugins/).
// Resolved at boot and on every sync so a plugin channel added to an API, or
// a newly added API, shows up without a restart.
//
// A plugin channel whose API did not answer is kept as it was: one API being
// down must not take its channels off the lineup.

const remoteClient = require('../api/remoteClient');
const { expectedBuiltins, remotePluginChannels } = require('./reconcile');

function toChannel(p) {
  return {
    id: `ch-plugin-${p.pluginId}`,
    name: p.name,
    channelNumber: p.channelNumber,
    isPlugin: true,
    enabled: true,
    settings: p.settings || { shuffle: true, includeCommercials: false },
    cachedVideos: [],
    lastVideoSync: null,
    pluginConfig: { videoSources: [] },
    ...(Array.isArray(p.apis) && p.apis.length ? { apis: p.apis } : {}),
  };
}

/**
 * @param {object[]} existingChannels — db.data.channels
 * @param {object[]} localPlugins — loadPlugins() result (these always win)
 * @param {object|null} remoteConfig — merged /config, for duplicate detection
 * @param {{quiet?: boolean}} [opts]
 * @returns {Promise<object[]>} remote plugin channels to hand to reconcileChannels()
 */
async function resolveRemotePlugins(existingChannels, localPlugins, remoteConfig, opts = {}) {
  const localIds = new Set((localPlugins || []).map((p) => p.id));
  const { list, failed } = await remoteClient.fetchPluginChannelsDetailed();

  const fresh = list
    .filter((p) => p && p.pluginId && !localIds.has(`ch-plugin-${p.pluginId}`))
    .map(toChannel);
  const freshIds = new Set(fresh.map((p) => p.id));

  // Channels we already had from an API that is down right now
  const kept = failed.length
    ? remotePluginChannels(existingChannels).filter((c) => {
        if (freshIds.has(c.id) || localIds.has(c.id)) return false;
        return !Array.isArray(c.apis) || !c.apis.length || c.apis.some((a) => failed.includes(a));
      })
    : [];

  // The plugin repo mirrors several curated (standalone) channels — same
  // content, same number. Skip remote plugins that duplicate a built-in
  // channel instead of listing the channel twice under a second number.
  const builtins = expectedBuiltins(remoteConfig).channels;
  const builtinNumbers = new Set(builtins.map((c) => c.channelNumber));
  const builtinSlugs = new Set(builtins.map((c) => c.standaloneSlug || c.liveSlug).filter(Boolean));
  return [...fresh, ...kept].filter((p) => {
    const slug = p.id.replace(/^ch-plugin-/, '');
    const dup = builtinSlugs.has(slug) || builtinNumbers.has(p.channelNumber);
    if (dup && !opts.quiet) console.log(`[DB] Skipping remote plugin "${p.name}" — duplicates built-in channel ${p.channelNumber}`);
    return !dup;
  });
}

module.exports = { resolveRemotePlugins };
