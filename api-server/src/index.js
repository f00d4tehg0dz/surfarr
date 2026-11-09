'use strict';

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');

const config = require('./config');
const logger = require('./logger');
const { connectDb } = require('./db/mongodb');
const { apiLimiter, speedLimiter, strictLimiter } = require('./middleware/rateLimiter');
const { globalErrorHandler, notFoundHandler } = require('./middleware/errorHandler');

// Routes
const healthRouter = require('./routes/health');
const videosRouter = require('./routes/videos');
const maintenance = require('./jobs/maintenance');
const playlistsRouter = require('./routes/playlists');
const configRouter = require('./routes/config');
const pluginsRouter = require('./routes/plugins');
const liveRouter = require('./routes/live');

async function main() {
  const app = express();

  // ── Trust proxy ──────────────────────────────────────────────────────────
  // Required for correct req.ip when behind nginx/Cloudflare
  // Set TRUST_PROXY=1 for nginx, =2 for Cloudflare + nginx
  if (config.trustProxy) {
    app.set('trust proxy', config.trustProxy);
  }

  // ── Security headers (Helmet) ────────────────────────────────────────────
  // Helmet sets ~14 HTTP headers that block common attack vectors:
  // X-Content-Type-Options, X-Frame-Options, HSTS, CSP, etc.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          scriptSrc: [],
          styleSrc: [],
          imgSrc: [],
        },
      },
    })
  );

  // ── CORS ─────────────────────────────────────────────────────────────────
  // Public read-heavy API — allow all origins so any SurfArr instance,
  // the landing page, and IPTV clients can reach it.
  app.use(cors({
    origin: '*',
    methods: ['GET', 'PATCH', 'POST'],
    allowedHeaders: ['Content-Type'],
  }));

  // ── Compression ──────────────────────────────────────────────────────────
  // Gzip responses — reduces bandwidth for large video lists
  app.use(compression());

  // ── Body parsing (strict limits) ─────────────────────────────────────────
  // No large payloads expected — this is a read-heavy API
  app.use(express.json({ limit: '10kb' }));
  app.use(express.urlencoded({ extended: false, limit: '10kb' }));

  // ── Request logging ──────────────────────────────────────────────────────
  const morganFormat = config.nodeEnv === 'production' ? 'combined' : 'dev';
  app.use(
    morgan(morganFormat, {
      stream: { write: (msg) => logger.info(msg.trim()) },
      // Skip health check noise in logs
      skip: (req) => req.path === '/health' && req.method === 'GET',
    })
  );

  // ── Rate limiting (applied globally BEFORE auth) ─────────────────────────
  // Order matters: slow down first, then hard limit
  // Both run before auth so unauthenticated abuse is also throttled
  app.use(speedLimiter);
  app.use(apiLimiter);

  // ── Routes ───────────────────────────────────────────────────────────────
  // /health is unauthenticated (monitoring systems need it)
  app.use('/health', healthRouter);
  // Last daily-maintenance report (dead/private videos, live status, playlists)
  app.get('/maintenance', (req, res) => res.json({ running: maintenance.isRunning(), lastRun: maintenance.getLastRun() }));

  app.use('/config', configRouter);
  // Strict limit on the video dead-report endpoint. Must be registered BEFORE
  // the videos router, or the router answers first and the limit never runs.
  app.use('/videos/:id/dead', strictLimiter);
  app.use('/videos', videosRouter);
  app.use('/playlists', playlistsRouter);
  app.use('/plugins', pluginsRouter);
  app.use('/live', liveRouter);

  // ── 404 + Error handlers (must be last) ──────────────────────────────────
  app.use(notFoundHandler);
  app.use(globalErrorHandler);

  // ── Database + Start ─────────────────────────────────────────────────────
  try {
    await connectDb();
  } catch (err) {
    logger.error('[Boot] Failed to connect to MongoDB:', err.message);
    process.exit(1);
  }

  app.listen(config.port, '0.0.0.0', () => {
    logger.info(`[Boot] SurfArr API listening on port ${config.port}`);
    logger.info(`[Boot] Channel lineup: ${config.gridMode === 'auto' ? 'auto (channels with videos are on)' : 'static (built-in list)'}`);
    logger.info(`[Boot] Environment: ${config.nodeEnv}`);
    logger.info(`[Boot] Rate limit: ${config.rateLimit.max} req / ${config.rateLimit.windowMs / 60000} min`);
    logger.info(`[Boot] Auth: open (no API key required)`);
    maintenance.scheduleMaintenance();
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    logger.info(`[Shutdown] Received ${signal}. Closing server...`);
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});