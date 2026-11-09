'use strict';

const logger = require('../logger');
const config = require('../config');

// Validation helper — checks query params and returns 400 if invalid
function validateQuery(schema) {
  return (req, res, next) => {
    for (const [key, rules] of Object.entries(schema)) {
      const val = req.query[key];

      if (rules.required && !val) {
        return res.status(400).json({
          error: 'Bad Request',
          message: `Missing required query parameter: ${key}`,
        });
      }

      if (val && rules.enum && !rules.enum.includes(val)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: `Invalid value for ${key}. Must be one of: ${rules.enum.join(', ')}`,
        });
      }

      if (val && rules.maxLength && val.length > rules.maxLength) {
        return res.status(400).json({
          error: 'Bad Request',
          message: `${key} exceeds maximum length of ${rules.maxLength} characters`,
        });
      }
    }
    next();
  };
}

// Global error handler — catches unhandled errors from route handlers
function globalErrorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;

  logger.error('[Error]', {
    message: err.message,
    status,
    path: req.path,
    ip: req.ip,
    stack: config.nodeEnv !== 'production' ? err.stack : undefined,
  });

  // Never leak stack traces or internal details in production
  const body = {
    error: status === 500 ? 'Internal Server Error' : err.message || 'Error',
  };

  if (config.nodeEnv !== 'production') {
    body.stack = err.stack;
  }

  res.status(status).json(body);
}

// Catch-all for 404 Not Found
function notFoundHandler(req, res) {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} does not exist`,
  });
}

module.exports = { validateQuery, globalErrorHandler, notFoundHandler };