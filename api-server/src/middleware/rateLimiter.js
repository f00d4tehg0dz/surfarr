'use strict';

const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const config = require('../config');
const logger = require('../logger');

// ─────────────────────────────────────────────────────────────────────────────
// Standard API rate limiter — hard cap after N requests per window
// ─────────────────────────────────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: 'draft-7', // Return RateLimit headers per RFC 6585
  legacyHeaders: false,
  // Custom key: prefer X-Forwarded-For IP when behind a proxy/Cloudflare
  keyGenerator: (req) => req.ip,
  handler: (req, res, next, options) => {
    logger.warn('[RateLimit] Limit hit', {
      ip: req.ip,
      path: req.path,
      limit: options.max,
      windowMs: options.windowMs,
    });
    res.status(429).json({
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Try again in ${Math.ceil(options.windowMs / 60000)} minutes.`,
      retryAfter: Math.ceil(options.windowMs / 1000),
    });
  },
  // Skip rate limiting for health checks so monitoring systems always work
  skip: (req) => req.path === '/health',
});

// ─────────────────────────────────────────────────────────────────────────────
// Graduated slowdown — adds increasing delay before the hard limit hits.
// This degrades abusive clients gracefully instead of a sudden 429.
// ─────────────────────────────────────────────────────────────────────────────
const speedLimiter = slowDown({
  windowMs: config.slowDown.windowMs,
  delayAfter: config.slowDown.delayAfter,
  delayMs: config.slowDown.delayMs,
  skip: (req) => req.path === '/health',
});

// ─────────────────────────────────────────────────────────────────────────────
// Strict limiter for write/expensive endpoints (playlist expansion, etc.)
// ─────────────────────────────────────────────────────────────────────────────
const strictLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 10,             // max 10 requests per minute
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  handler: (req, res) => {
    logger.warn('[RateLimit] Strict limit hit', { ip: req.ip, path: req.path });
    res.status(429).json({
      error: 'Too Many Requests',
      message: 'This endpoint is rate-limited to 10 requests per minute.',
      retryAfter: 60,
    });
  },
});

module.exports = { apiLimiter, speedLimiter, strictLimiter };
