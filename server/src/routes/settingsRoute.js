'use strict';

// GET  /api/settings         — return current settings
// PUT  /api/settings         — update settings
// POST /api/settings/sync    — trigger manual remote API sync immediately

const express = require('express');
const router = express.Router();
const { getDb } = require('../db/lowdb');
const config = require('../config');

router.get('/', (req, res) => {
  const db = getDb();
  const settings = { ...db.data.settings };
  res.json({
    ...settings,
    // Channel sources actually in use, in priority order, and how each one
    // answered at the last lineup refresh (api | cache | down)
    remoteApiUrls: config.remoteApiUrls,
    remoteApiDefault: config.envRemoteApiUrls,
    remoteApiSources: db.data.remoteConfigSources || [],
    lastSync: db.data.lastSync,
    startEpoch: db.data.startEpoch,
    channelCount: db.data.channels.length,
    enabledChannelCount: db.data.channels.filter((c) => c.enabled).length,
  });
});

router.put('/', async (req, res) => {
  const db = getDb();
  const allowed = [
    'remoteApiUrl',
    'deviceName',
    'streamQuality',
    'tunerCount',
  ];
  const { FORMAT_MAP } = require('../streaming/ytdlp');
  let apisChanged = false;
  for (const key of allowed) {
    if (req.body[key] === undefined) continue;
    let value = req.body[key];
    if (key === 'remoteApiUrl') {
      // One or more API base URLs (comma, space or new line separated).
      // An empty list, or the same list as REMOTE_API_URL, means "use the default".
      const bad = config.invalidApiUrls(value);
      if (bad.length) {
        return res.status(400).json({ error: `Not a valid http(s) URL: ${bad.join(', ')}` });
      }
      const list = config.parseApiUrls(value);
      const fromEnv = config.envRemoteApiUrls;
      const custom = list.length > 0 && list.join(',') !== fromEnv.join(',');
      const next = custom ? list : fromEnv;
      apisChanged = next.join(',') !== config.remoteApiUrls.join(',');
      config.setRemoteApiUrls(next);
      db.data.settings.remoteApiUrl = next.join(', ');
      db.data.settings.remoteApiUrlCustom = custom;
      continue;
    }
    if (key === 'streamQuality' && !FORMAT_MAP[value]) {
      return res.status(400).json({ error: `streamQuality must be one of ${Object.keys(FORMAT_MAP).join(', ')}` });
    }
    if (key === 'tunerCount') {
      value = parseInt(value, 10);
      if (!Number.isFinite(value) || value < 1 || value > 32) {
        return res.status(400).json({ error: 'tunerCount must be between 1 and 32' });
      }
    }
    db.data.settings[key] = value;
  }
  // Quality is read by the ffmpeg scaler from config at stream start
  if (req.body.streamQuality) require('../config').streamQuality = req.body.streamQuality;
  await db.write();
  // New channel sources: pull the lineup and videos now instead of at 3 AM
  if (apisChanged) {
    require('../api/cache').invalidate();
    const { runDailySync } = require('../jobs/dailySync');
    runDailySync().catch((err) => console.error('[Settings] Sync after API change failed:', err.message));
  }
  res.json({ ok: true, syncStarted: apisChanged });
});

// Trigger a manual sync with the remote API
router.post('/sync', async (req, res) => {
  const { runDailySync } = require('../jobs/dailySync');
  try {
    const result = await runDailySync();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;