'use strict';

require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT, 10) || 3001,
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/retroarr',
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
  trustProxy: parseInt(process.env.TRUST_PROXY, 10) || 0,

  // static: the built-in channel list. auto: any channel that has videos in
  // MongoDB is on (use this for a self-hosted API). See channels/lineup.js.
  gridMode: /^auto$/i.test(process.env.CHANNEL_GRID_MODE || '') ? 'auto' : 'static',

  // CORS allowed origins
  corsOrigins: (process.env.CORS_ORIGINS || '*')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  // Rate limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MINUTES, 10) * 60 * 1000 || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 200,
  },

  // Graduated slowdown (kicks in before hard rate limit)
  slowDown: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MINUTES, 10) * 60 * 1000 || 15 * 60 * 1000,
    delayAfter: parseInt(process.env.SLOW_DOWN_AFTER, 10) || 100,
    delayMs: () => parseInt(process.env.SLOW_DOWN_DELAY_MS, 10) || 500,
  },
};

module.exports = config;