const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * Middleware to protect admin/internal endpoints with an API key.
 * Reads X-Admin-Key header and compares to ADMIN_API_KEY using
 * crypto.timingSafeEqual to prevent timing attacks.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function adminAuth(req, res, next) {
  const config = require('../config');
  const providedKey = req.headers['x-admin-key'];

  if (!providedKey) {
    logger.warn('Admin endpoint rejected: missing X-Admin-Key header', {
      ip: req.ip,
      path: req.path,
    });
    return res.status(403).json({ error: 'Forbidden' });
  }

  const keyBuffer = Buffer.from(providedKey);
  const expectedBuffer = Buffer.from(config.adminApiKey);

  if (keyBuffer.length !== expectedBuffer.length) {
    logger.warn('Admin endpoint rejected: invalid API key', {
      ip: req.ip,
      path: req.path,
    });
    return res.status(403).json({ error: 'Forbidden' });
  }

  const isValid = crypto.timingSafeEqual(keyBuffer, expectedBuffer);

  if (!isValid) {
    logger.warn('Admin endpoint rejected: invalid API key', {
      ip: req.ip,
      path: req.path,
    });
    return res.status(403).json({ error: 'Forbidden' });
  }

  next();
}

module.exports = adminAuth;
