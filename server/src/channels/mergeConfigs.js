'use strict';

// Merge the /config of several SurfArr APIs into one lineup.
//
// Order matters: the first API in REMOTE_API_URL wins whenever two APIs
// describe the same channel (same id), and keeps its channel number when two
// different channels ask for the same one. The later channel moves to the
// next free number from 700 up, so the HDHomeRun lineup never has two
// channels on one GuideNumber. Every entry gets `apis`: the APIs that carry
// that channel, which is where the sync job fetches its videos from.

const COLLISION_RENUMBER_START = 700;

// Say it once per channel, not on every sync
const warned = new Set();

function union(lists) {
  const out = [];
  for (const list of lists) for (const x of list || []) if (!out.includes(x)) out.push(x);
  return out;
}

/**
 * @param {{api: string, config: object}[]} parts — in priority order
 * @returns {object|null} merged config (same shape as one API's /config)
 */
function mergeConfigs(parts) {
  const usable = (parts || []).filter((p) => p && p.config && Array.isArray(p.config.channelGrid));
  if (!usable.length) return null;

  const usedNumbers = new Set();
  let nextFree = COLLISION_RENUMBER_START;
  const claimNumber = (entry, api) => {
    const n = entry.channelNumber;
    if (Number.isFinite(n) && !usedNumbers.has(n)) {
      usedNumbers.add(n);
      return entry;
    }
    while (usedNumbers.has(nextFree)) nextFree++;
    const key = `${api}|${entry.id || entry.slug}|${n}|${nextFree}`;
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(`[Channels] "${entry.name}" from ${api} wants channel ${n}, which another API already uses — using ${nextFree} instead`);
    }
    usedNumbers.add(nextFree);
    return { ...entry, channelNumber: nextFree, requestedChannelNumber: n };
  };

  const grid = new Map();
  const live = new Map();
  const plugins = new Map();

  // Pass 1 keeps the first API's numbering intact before anyone else claims.
  for (const { api, config } of usable) {
    for (const c of config.channelGrid) {
      if (!c || !c.id) continue;
      const have = grid.get(c.id);
      if (have) { have.apis.push(api); continue; }
      grid.set(c.id, { ...claimNumber(c, api), apis: [api] });
    }
    for (const l of config.liveChannels || []) {
      const key = l && (l.slug || l.id);
      if (!key) continue;
      const have = live.get(key);
      if (have) { have.apis.push(api); continue; }
      live.set(key, { ...claimNumber(l, api), apis: [api] });
    }
    for (const p of config.pluginChannels || []) {
      if (!p || !p.id) continue;
      const have = plugins.get(p.id);
      if (have) { have.apis.push(api); continue; }
      plugins.set(p.id, { ...p, apis: [api] });
    }
  }

  return {
    startEpoch: usable[0].config.startEpoch,
    decades: union(usable.map((p) => p.config.decades)),
    categories: union(usable.map((p) => p.config.categories)),
    channelGrid: [...grid.values()],
    liveChannels: [...live.values()],
    pluginChannels: [...plugins.values()],
  };
}

module.exports = { mergeConfigs, COLLISION_RENUMBER_START };
