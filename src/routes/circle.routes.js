const express = require('express');
const router = express.Router();
const webhookAuth = require('../middleware/webhookAuth');
const adminAuth = require('../middleware/adminAuth');
const hubspotService = require('../services/hubspot.service');
const circleService = require('../services/circle.service');
const { mapHubSpotToCircle, mapSyncResultToHubspot } = require('../utils/fieldMapper');
const retryQueue = require('../utils/retryQueue');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Partially mask an email for debug logging: jane@example.com → ja**@example.com
 * @param {string} email
 * @returns {string}
 */
function maskEmail(email) {
  if (!email || !email.includes('@')) return '***';
  const [local, domain] = email.split('@');
  const visible = local.slice(0, 2);
  return `${visible}**@${domain}`;
}

/**
 * Middleware: accept either a valid HubSpot webhook signature OR admin key.
 * This allows manual Postman testing while keeping webhook auth for production.
 */
function webhookOrAdmin(req, res, next) {
  // If admin key is present and valid, skip webhook signature check
  if (req.headers['x-admin-key']) {
    return adminAuth(req, res, next);
  }
  // Otherwise require HubSpot webhook signature
  return webhookAuth(req, res, next);
}

/**
 * POST /api/circle/create-member
 * Receives webhook from HubSpot workflow when a contact is approved.
 * Returns 200 immediately, then processes member creation asynchronously.
 */
router.post('/create-member', webhookOrAdmin, (req, res) => {
  // Respond immediately to HubSpot (< 3 seconds)
  res.status(200).json({ received: true });

  // Process asynchronously
  setImmediate(async () => {
    try {
      // Extract contactId — try objectId first, fallback to contactId key
      let contactId = req.body?.objectId;
      let idSource = 'objectId';

      if (!contactId) {
        contactId = req.body?.contactId;
        idSource = 'contactId';
      }

      if (!contactId) {
        logger.error('Webhook received but no contactId found in payload', {
          body: req.body,
        });
        return;
      }

      logger.info('Processing create-member webhook', { contactId, idSource });

      // Step 1: Set sync status to PENDING
      await hubspotService.updateContact(contactId, { circle_sync_status: 'pending' });

      // Step 2: Fetch full contact from HubSpot
      const contact = await hubspotService.getContactById(contactId);

      if (!contact) {
        logger.error('Contact not found in HubSpot after webhook', { contactId });
        await hubspotService.updateContact(contactId, { circle_sync_status: 'sync_failed' });
        return;
      }

      // Step 3: Map HubSpot properties to Circle payload
      const circlePayload = mapHubSpotToCircle(contact.properties);
      logger.debug('Mapped Circle payload', {
        contactId,
        email: maskEmail(circlePayload.email),
        name: circlePayload.name,
        hasCommunityId: !!circlePayload.community_id,
      });

      // Step 4: Create or get member in Circle (duplicate-safe)
      const circleMember = await circleService.createOrGetMember(circlePayload);

      if (!circleMember) {
        logger.error('Circle createOrGetMember returned null — marking RETRY_REQUIRED', { contactId });
        await hubspotService.updateContact(contactId, {
          circle_sync_status: 'retry_required',
          circle_last_synced: new Date().toISOString(),
        });
        retryQueue.add({
          contactId,
          email: circlePayload.email,
          payload: circlePayload,
          error: 'createOrGetMember returned null',
          maxAttempts: config.retry.maxAttempts,
        });
        return;
      }

      // Step 5: Write success back to HubSpot
      const hubspotUpdate = mapSyncResultToHubspot({
        syncStatus: 'sync_success',
        circleMemberId: circleMember.id,
      });

      await hubspotService.updateContact(contactId, hubspotUpdate);

      logger.info('Create-member flow complete', {
        contactId,
        circleMemberId: circleMember.id,
        alreadyExisted: circleMember.alreadyExisted,
        inviteSent: !circleMember.alreadyExisted,
      });
    } catch (error) {
      logger.error('Create-member async processing failed', {
        errorMessage: error.message,
        stack: error.stack,
      });
    }
  });
});

/**
 * POST /api/circle/retry/:contactId
 * Manually trigger a retry for a specific contact.
 * Protected by admin API key via X-Admin-Key header.
 */
router.post('/retry/:contactId', adminAuth, async (req, res) => {
  const { contactId } = req.params;

  // Fetch the contact to verify it exists
  const contact = await hubspotService.getContactById(contactId);

  if (!contact) {
    return res.status(404).json({ error: 'Contact not found', contactId });
  }

  const currentStatus = contact.properties?.circle_sync_status || 'unknown';
  logger.info('Manual retry requested', { contactId, currentSyncStatus: currentStatus });

  // Map and queue for retry
  const circlePayload = mapHubSpotToCircle(contact.properties);
  const jobId = retryQueue.add({
    contactId,
    email: circlePayload.email,
    payload: circlePayload,
    error: 'Manual retry requested',
    maxAttempts: config.retry.maxAttempts,
  });

  await hubspotService.updateContact(contactId, { circle_sync_status: 'retry_required' });

  res.json({
    queued: true,
    contactId,
    jobId,
    currentSyncStatus: currentStatus,
  });
});

module.exports = router;
