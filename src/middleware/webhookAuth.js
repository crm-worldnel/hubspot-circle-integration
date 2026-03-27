const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * Middleware to verify HubSpot webhook signatures (HMAC-SHA256).
 * Computes HMAC-SHA256 of (webhookSecret + rawBodyString) and compares
 * to the X-HubSpot-Signature-v3 header using crypto.timingSafeEqual.
 * If HUBSPOT_WEBHOOK_SECRET is not configured, verification is skipped
 * with a WARNING log to allow local testing.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function webhookAuth(req, res, next) {
  const config = require('../config');

  // Allow local testing without a webhook secret
  if (!config.hubspot.webhookSecret) {
    logger.warn('Webhook signature verification SKIPPED — HUBSPOT_WEBHOOK_SECRET not set', {
      ip: req.ip,
      path: req.path,
    });
    return next();
  }

  const signature = req.headers['x-hubspot-signature-v3'];

  if (!signature) {
    logger.warn('Webhook rejected: missing X-HubSpot-Signature-v3 header', {
      ip: req.ip,
      path: req.path,
      timestamp: new Date().toISOString(),
    });
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  const rawBody = JSON.stringify(req.body);
  const sourceString = config.hubspot.webhookSecret + rawBody;

  const expectedSignature = crypto
    .createHmac('sha256', config.hubspot.webhookSecret)
    .update(sourceString)
    .digest('hex');

  // Both buffers must be the same length for timingSafeEqual
  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (sigBuffer.length !== expectedBuffer.length) {
    logger.warn('Webhook rejected: signature length mismatch', {
      ip: req.ip,
      path: req.path,
      timestamp: new Date().toISOString(),
    });
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  const isValid = crypto.timingSafeEqual(sigBuffer, expectedBuffer);

  if (!isValid) {
    logger.warn('Webhook rejected: invalid signature', {
      ip: req.ip,
      path: req.path,
      timestamp: new Date().toISOString(),
    });
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  next();
}

module.exports = webhookAuth;
