'use strict';

// GET /discover.json
// The HDHomeRun identity endpoint. Plex/Jellyfin fetch this after SSDP
// discovery to confirm device type, tuner count, and lineup URL.

const express = require('express');
const router = express.Router();
const config = require('../config');
const { getDb } = require('../db/lowdb');

router.get('/discover.json', (req, res) => {
  const db = getDb();
  const settings = db.data.settings;
  const baseUrl = config.getAdvertiseUrl(config.port);

  res.json({
    FriendlyName: settings.deviceName || config.deviceName,
    Manufacturer: 'Silicondust',
    ModelNumber: 'HDTC-2US',
    FirmwareName: 'hdhomerun4_atsc',
    TunerCount: settings.tunerCount || config.tunerCount,
    FirmwareVersion: '20190621',
    DeviceID: config.deviceId,
    DeviceAuth: '',
    BaseURL: `${baseUrl}`,
    LineupURL: `${baseUrl}/lineup.json`,
  });
});

module.exports = router;
