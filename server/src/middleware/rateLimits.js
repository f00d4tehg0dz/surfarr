'use strict';

// Per-IP rate limits for the routes that touch the disk or spawn work.
// Streams, the M3U, the guide and the HDHomeRun endpoints are NOT limited:
// Plex / Jellyfin / Emby poll those constantly and must never be throttled.

const { rateLimit } = require('express-rate-limit');

const common = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // TRUST_PROXY decides how req.ip is worked out (see index.js); don't
  // second-guess it with the library's startup checks.
  validate: { xForwardedForHeader: false, trustProxy: false },
};

// Installing / removing plugins writes files and kicks off a sync.
const pluginWriteLimiter = rateLimit({
  ...common,
  windowMs: 60 * 1000,
  limit: 20,
  message: { error: 'Too many plugin changes, try again in a minute.' },
});

// The debug tools run yt-dlp / ffmpeg.
const debugLimiter = rateLimit({
  ...common,
  windowMs: 60 * 1000,
  limit: 30,
  message: { error: 'Too many debug requests, try again in a minute.' },
});

// Dashboard page loads (index.html from disk). Generous: it's one file per visit.
const pageLimiter = rateLimit({
  ...common,
  windowMs: 60 * 1000,
  limit: 300,
});

module.exports = { pluginWriteLimiter, debugLimiter, pageLimiter };
