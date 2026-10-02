'use strict';

// SurfArr Server — Boot sequence:
//   1. Load config + .env, resolve external binaries (yt-dlp / ffmpeg)
//   2. Initialize LowDB (create/seed db.json if absent)
//   3. Start discovery responders (HDHomeRun UDP 65001 + SSDP 1900)
//   4. Start Express HTTP server
//   5. Register all routes
//   6. Register cron jobs (dailySync, cleanup, EPG refresh)

const express = require('express');
const { guardApi, adminTokenConfigured } = require('./middleware/requireAdmin');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const config = require('./config');
const { probeVersion } = require('./binaries');
const { initDb, getDb } = require('./db/lowdb');
const { initSSDP } = require('./hdhr/ssdp');
const { initHdhrDiscovery } = require('./hdhr/discovery');
const { initScheduler } = require('./jobs/scheduler');
const streamManager = require('./streaming/streamManager');
const ytdlp = require('./streaming/ytdlp');

// Routes
const discoverRoute = require('./hdhr/discoverRoute');
const lineupRoute = require('./hdhr/lineupRoute');
const epgRoute = require('./epg/epgRoute');
const m3uRoute = require('./routes/m3uRoute');
const channelsRoute = require('./routes/channelsRoute');
const settingsRoute = require('./routes/settingsRoute');
const streamRoute = require('./routes/streamRoute');
const reportsRoute = require('./reports/reportRoute');
const debugRoute = require('./routes/debugRoute');
const pluginRepoRoute = require('./routes/pluginRepoRoute');

const pkg = require('../package.json');

function logBinaries() {
  for (const w of config.binaryWarnings) console.warn(`[Boot] ⚠ ${w}`);

  const ff = probeVersion(config.ffmpegPath, [], '-version');
  console.log(
    `[Boot] ffmpeg: ${config.ffmpegPath} ${ff.ok ? `(v${ff.version})` : '— NOT WORKING: ' + (ff.error || 'unknown error')} [${config.ffmpegSource}]`
  );

  const yt = probeVersion(config.ytdlpPath, config.ytdlpPrefixArgs);
  const ytCmd = [config.ytdlpPath, ...config.ytdlpPrefixArgs].join(' ');
  console.log(
    `[Boot] yt-dlp: ${ytCmd} ${yt.ok ? `(${yt.version})` : '— NOT WORKING: ' + (yt.error || 'unknown error')} [${config.ytdlpSource}]`
  );
  if (config.ytdlpCookies) console.log(`[Boot] yt-dlp cookies: ${config.ytdlpCookies}`);
  if (config.ytdlpExtraArgs.length) console.log(`[Boot] yt-dlp extra args: ${config.ytdlpExtraArgs.join(' ')}`);

  if (!ff.ok || !yt.ok) {
    console.warn('[Boot] ⚠ Streams will fail until the binaries above are fixed. See /api/debug/binaries.');
  }

  // Async capability probe — logs which JS runtime yt-dlp will use
  ytdlp.probe().then((caps) => {
    if (!caps.ok) return;
    if (caps.supportsJsRuntimes) {
      console.log(`[Boot] yt-dlp JS runtime: ${caps.jsRuntimeArgs.length ? caps.jsRuntimeArgs.join(' ') : 'default (deno if installed)'}`);
    } else {
      console.warn('[Boot] ⚠ yt-dlp is too old to know about --js-runtimes. Update it (yt-dlp -U) or YouTube playback will degrade.');
    }
  });
}

async function main() {
  console.log(`🎬 SurfArr ${pkg.version} starting on ${process.platform}/${process.arch} (node ${process.version})...`);

  // --- Step 1: Binaries ---
  logBinaries();

  // --- Step 2: Database ---
  await initDb();
  console.log(`[Boot] Database ready (${config.dbPath}).`);

  // --- Step 3: Discovery (UDP) ---
  const hostIp = config.getLocalIp();
  const db = getDb();
  const tunerCount = () => db.data.settings.tunerCount || config.tunerCount;

  if (config.enableHdhrDiscovery) {
    try {
      initHdhrDiscovery({ hostIp, port: config.port, getDeviceId: () => config.deviceId, getTunerCount: tunerCount });
    } catch (err) {
      console.warn('[Boot] HDHomeRun discovery failed to start (non-fatal):', err.message);
    }
  }
  if (config.enableSsdp) {
    try {
      initSSDP(hostIp, config.port, config.deviceId);
    } catch (err) {
      console.warn('[Boot] SSDP failed to start (non-fatal):', err.message);
    }
  }

  // --- Step 4: Express ---
  const app = express();
  app.disable('x-powered-by');
  // Behind a reverse proxy: TRUST_PROXY=1 (or a hop count / subnet) so req.ip
  // is the real client — required for the local-network admin check.
  if (process.env.TRUST_PROXY && process.env.TRUST_PROXY !== '0' && process.env.TRUST_PROXY !== 'false') {
    const tp = process.env.TRUST_PROXY;
    app.set('trust proxy', /^\d+$/.test(tp) ? parseInt(tp, 10) : tp === 'true' ? true : tp);
  }
  app.use(cors());
  app.use(express.json());

  // HDHomeRun device endpoints (no /api prefix — Plex/Jellyfin expect root paths)
  app.use('/', discoverRoute);
  app.use('/', lineupRoute);
  app.use('/', epgRoute);
  app.use('/', m3uRoute);

  // Stream endpoint
  app.use('/stream', streamRoute);

  // JSON API for the React dashboard. Reads are open; changes (and debug
  // tools) need the local network or ADMIN_TOKEN — see middleware/requireAdmin.
  app.use('/api', guardApi);
  app.use('/api/channels', channelsRoute);
  app.use('/api/settings', settingsRoute);
  app.use('/api/reports', reportsRoute);
  app.use('/api/debug', debugRoute);
  app.use('/api/plugins', pluginRepoRoute);

  // Status endpoint
  app.get('/api/status', (req, res) => {
    res.json({
      status: 'ok',
      version: pkg.version,
      platform: `${process.platform}/${process.arch}`,
      deviceId: config.deviceId,
      deviceName: db.data.settings.deviceName || config.deviceName,
      activeStreams: streamManager.getActiveStreamCount(),
      adminMode: adminTokenConfigured ? 'token' : 'local-network',
      recentlyFailedVideos: streamManager.getRecentlyFailedCount(),
      binaries: {
        ffmpeg: config.ffmpegPath,
        ytdlp: [config.ytdlpPath, ...config.ytdlpPrefixArgs].join(' '),
        warnings: config.binaryWarnings,
      },
      uptime: Math.floor(process.uptime()),
    });
  });

  // Serve React dashboard (production build)
  const clientDist = path.join(__dirname, '../public');
  const indexPath = path.join(clientDist, 'index.html');
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/stream/')) {
      return res.status(404).json({ error: 'Not found' });
    }
    if (!fs.existsSync(indexPath)) {
      return res.status(404).send('Dashboard not built yet. Run: npm run build in client/');
    }
    res.sendFile(indexPath);
  });

  const server = app.listen(config.port, config.host, () => {
    console.log(`[Boot] HTTP server listening on http://${hostIp}:${config.port}`);
    console.log(`[Boot] HDHomeRun device ID: ${config.deviceId}`);
    console.log(`[Boot] Dashboard: http://${hostIp}:${config.port}`);
    console.log(`[Boot] EPG:       http://${hostIp}:${config.port}/epg.xml`);
    console.log(`[Boot] M3U:       http://${hostIp}:${config.port}/lineup.m3u`);
  });
  // Streams are long-lived; never let Node time out an idle tuner connection.
  server.keepAliveTimeout = 0;
  server.headersTimeout = 0;
  server.requestTimeout = 0;

  // --- Step 5: Cron jobs ---
  initScheduler();

  // First-boot / never-synced: kick off a background sync so the lineup isn't
  // a wall of 503s until 3 AM rolls around.
  if (!db.data.lastSync) {
    console.log('[Boot] No prior sync detected — running initial sync in background...');
    setImmediate(async () => {
      try {
        const { runDailySync } = require('./jobs/dailySync');
        await runDailySync();
      } catch (err) {
        console.error('[Boot] Initial sync failed:', err.message);
      }
    });
  }

  const shutdown = (signal) => {
    console.log(`[Boot] ${signal} received — shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  console.log('✅ SurfArr ready.\n');
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
