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
  // If admin key is present in header, use header auth
  if (req.headers['x-admin-key']) {
    return adminAuth(req, res, next);
  }
  // If admin key is in request body (HubSpot workflow webhook), validate it
  if (req.body?.apiKey === config.adminApiKey) {
    return next();
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
  res.status(200).json({ received: true });

  setImmediate(async () => {
    try {
      const { apiKey: _omit, ...safeBody } = req.body || {};
      logger.info('[create-member] STEP 1 — webhook received', {
        body: safeBody,
        objectIdRaw: req.body?.objectId ?? 'MISSING',
        contactIdRaw: req.body?.contactId ?? 'MISSING',
      });

      let contactId = req.body?.objectId;
      let idSource = 'objectId';

      if (!contactId) {
        contactId = req.body?.contactId;
        idSource = 'contactId';
      }

      if (!contactId) {
        logger.error('[create-member] STEP 1 FAILED — no contactId in payload, aborting', {
          body: safeBody,
        });
        return;
      }

      logger.info('[create-member] STEP 2 — setting HubSpot status to pending', { contactId, idSource });
      await hubspotService.updateContact(contactId, { circle_sync_status: 'pending' });

      logger.info('[create-member] STEP 3 — fetching contact from HubSpot', { contactId });
      const contact = await hubspotService.getContactById(contactId);

      if (!contact) {
        logger.error('[create-member] STEP 3 FAILED — contact not found in HubSpot', {
          contactId,
          hint: 'objectId may be a deal ID instead of a contact ID',
        });
        await hubspotService.updateContact(contactId, { circle_sync_status: 'sync_failed' });
        return;
      }

      logger.info('[create-member] STEP 3 OK — contact fetched', {
        contactId,
        email: maskEmail(contact.properties?.email),
        name: `${contact.properties?.firstname || ''} ${contact.properties?.lastname || ''}`.trim(),
      });

      const circlePayload = mapHubSpotToCircle(contact.properties);
      logger.info('[create-member] STEP 4 — mapped Circle payload', {
        contactId,
        email: maskEmail(circlePayload.email),
        name: circlePayload.name,
        skipInvitation: circlePayload.skip_invitation,
        profileFieldCount: Object.keys(circlePayload.community_member_profile_fields || {}).length,
        profileFields: circlePayload.community_member_profile_fields || {},
        rawHubspotProps: {
          specialty: contact.properties?.specialty,
          title: contact.properties?.title,
          city: contact.properties?.city,
          country: contact.properties?.country,
          company: contact.properties?.company,
          jobtitle: contact.properties?.jobtitle,
          cleft_ngo_affiliation: contact.properties?.cleft_ngo_affiliation,
        },
      });

      logger.info('[create-member] STEP 5 — calling Circle createOrGetMember', { contactId });
      const circleMember = await circleService.createOrGetMember(circlePayload);

      if (!circleMember) {
        logger.error('[create-member] STEP 5 FAILED — Circle createOrGetMember returned null', { contactId });
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

      logger.info('[create-member] STEP 5 OK — Circle member resolved', {
        contactId,
        circleMemberId: circleMember.id,
        alreadyExisted: circleMember.alreadyExisted,
      });

      const hubspotUpdate = mapSyncResultToHubspot({
        syncStatus: 'sync_success',
        circleMemberId: circleMember.id,
      });

      logger.info('[create-member] STEP 6 — writing sync_success back to HubSpot', { contactId });
      await hubspotService.updateContact(contactId, hubspotUpdate);

      logger.info('[create-member] COMPLETE ✓', {
        contactId,
        circleMemberId: circleMember.id,
        alreadyExisted: circleMember.alreadyExisted,
        inviteSent: !circleMember.alreadyExisted,
      });
    } catch (error) {
      logger.error('[create-member] UNHANDLED ERROR in async processing', {
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
