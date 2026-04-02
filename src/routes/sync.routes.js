const express = require('express');
const router = express.Router();
const adminAuth = require('../middleware/adminAuth');
const engagementService = require('../services/engagement.service');
const hubspotService = require('../services/hubspot.service');
const circleService = require('../services/circle.service');
const { processRetryQueue } = require('../services/retryProcessor');
const retryQueue = require('../utils/retryQueue');
const logger = require('../utils/logger');

/**
 * POST /api/sync/engagement
 * Manually trigger an engagement sync cycle.
 * This is the same logic that runs on the cron schedule.
 * Protected by admin API key.
 */
router.post('/engagement', adminAuth, (req, res) => {
  logger.info('Manual engagement sync triggered', { ip: req.ip });

  // Respond immediately — sync runs in background
  res.status(202).json({
    message: 'Engagement sync started',
    note: 'Check GET /api/sync/engagement-status or logs/sync-history.json for results',
  });

  // Process asynchronously
  setImmediate(async () => {
    try {
      await engagementService.syncEngagement();
    } catch (error) {
      logger.error('Background engagement sync failed', {
        errorMessage: error.message,
      });
    }
  });
});

/**
 * GET /api/sync/engagement-status
 * Check the latest engagement sync result from sync-history.json.
 */
router.get('/engagement-status', adminAuth, (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const historyPath = path.join(__dirname, '../../logs/sync-history.json');

  if (!fs.existsSync(historyPath)) {
    return res.json({ message: 'No sync history yet', lastSync: null });
  }

  try {
    const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    const lastSync = history.length > 0 ? history[history.length - 1] : null;
    res.json({ totalRuns: history.length, lastSync });
  } catch (error) {
    res.status(500).json({ error: 'Failed to read sync history', message: error.message });
  }
});

/**
 * GET /api/sync/status
 * Health check endpoint for sync system.
 */
router.get('/status', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'hubspot-circle-sync',
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/sync/test-hubspot
 * Test HubSpot API connection by fetching account info.
 * Use this to verify your Access Token works before enabling cron jobs.
 */
router.get('/test-hubspot', adminAuth, async (req, res) => {
  const axios = require('axios');
  const config = require('../config');
  const start = Date.now();

  try {
    const headers = {
      Authorization: `Bearer ${config.hubspot.accessToken}`,
      'Content-Type': 'application/json',
    };

    // Test 1: Verify token by fetching account info
    const accountRes = await axios.get(
      `${config.hubspot.apiBase}/account-info/v3/details`,
      { headers, timeout: 10000 }
    );

    // Test 2: Try a contacts search (empty query, limit 1) to confirm CRM access
    const contactsRes = await axios.post(
      `${config.hubspot.apiBase}/crm/v3/objects/contacts/search`,
      { filterGroups: [], limit: 1 },
      { headers, timeout: 10000 }
    );

    const duration = Date.now() - start;

    logger.info('HubSpot connection test passed', { durationMs: duration });

    res.status(200).json({
      status: 'connected',
      hubspot: {
        portalId: accountRes.data.portalId,
        accountType: accountRes.data.accountType,
        timeZone: accountRes.data.timeZone,
        contactsAccess: true,
        totalContacts: contactsRes.data.total,
      },
      durationMs: duration,
    });
  } catch (error) {
    const duration = Date.now() - start;
    logger.error('HubSpot connection test failed', {
      statusCode: error.response?.status,
      errorMessage: error.response?.data?.message || error.message,
      durationMs: duration,
    });

    res.status(502).json({
      status: 'failed',
      error: error.response?.data?.message || error.message,
      statusCode: error.response?.status,
      durationMs: duration,
    });
  }
});

/**
 * GET /api/sync/test-circle
 * Test Circle API connection by listing 1 member.
 * P1-E: Verify Circle API key works.
 */
router.get('/test-circle', adminAuth, async (req, res) => {
  const start = Date.now();

  try {
    const axios = require('axios');
    const config = require('../config');

    const response = await axios.get(`${config.circle.apiBase}/community_members`, {
      headers: { Authorization: `Bearer ${config.circle.apiKey}` },
      params: { per_page: 1 },
      timeout: 10000,
    });

    const duration = Date.now() - start;
    const data = response.data;

    logger.info('Circle connection test passed', { durationMs: duration });

    res.status(200).json({
      status: 'connected',
      circle: {
        communityId: data.records?.[0]?.community_id || 'no members',
        totalMembers: data.count || 0,
        hasNextPage: data.has_next_page || false,
      },
      durationMs: duration,
    });
  } catch (error) {
    const duration = Date.now() - start;
    logger.error('Circle connection test failed', {
      statusCode: error.response?.status,
      errorMessage: error.response?.data?.message || error.message,
      durationMs: duration,
    });

    res.status(502).json({
      status: 'failed',
      error: error.response?.data?.message || error.message,
      statusCode: error.response?.status,
      durationMs: duration,
    });
  }
});

/**
 * GET /api/sync/retry-queue
 * View current retry queue stats and pending jobs.
 */
router.get('/retry-queue', adminAuth, (req, res) => {
  const stats = retryQueue.getStats();
  const pending = retryQueue.getPending().map((job) => ({
    id: job.id,
    contactId: job.contactId,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    lastAttempt: job.lastAttempt,
    createdAt: job.createdAt,
  }));

  res.json({ stats, pending });
});

/**
 * POST /api/sync/process-retry-queue
 * Manually trigger retry queue processing (same as cron).
 */
router.post('/process-retry-queue', adminAuth, async (req, res) => {
  logger.info('Manual retry queue processing triggered', { ip: req.ip });

  try {
    const result = await processRetryQueue();
    res.json({ message: 'Retry queue processed', ...result });
  } catch (error) {
    logger.error('Manual retry queue processing failed', { errorMessage: error.message });
    res.status(500).json({ error: 'Retry queue processing failed', message: error.message });
  }
});

/**
 * POST /api/sync/test-full-flow
 * P1-E: Dry-run the full create-member flow for a given contactId.
 * Does NOT actually create the Circle member — only validates each step.
 */
router.post('/test-full-flow', adminAuth, async (req, res) => {
  const contactId = req.body?.contactId || req.query?.contactId;

  if (!contactId) {
    return res.status(400).json({ error: 'contactId is required (body or query parameter)' });
  }

  const results = {
    contactId,
    steps: {},
  };

  // Step 1: Fetch contact from HubSpot
  const contact = await hubspotService.getContactById(contactId);
  results.steps.hubspotFetch = contact ? 'OK' : 'FAILED — contact not found';

  if (!contact) {
    return res.json(results);
  }

  results.steps.contactEmail = contact.properties?.email || 'missing';
  results.steps.contactName = `${contact.properties?.firstname || ''} ${contact.properties?.lastname || ''}`.trim() || 'missing';

  // Step 2: Map fields
  const { mapHubSpotToCircle } = require('../utils/fieldMapper');
  const circlePayload = mapHubSpotToCircle(contact.properties);
  results.steps.fieldMapping = circlePayload ? 'OK' : 'FAILED';
  results.steps.mappedPayload = circlePayload
    ? { name: circlePayload.name, hasEmail: !!circlePayload.email, skip_invitation: circlePayload.skip_invitation }
    : null;

  if (!circlePayload || !circlePayload.email) {
    return res.json(results);
  }

  // Step 3: Check Circle for existing member (read-only — safe)
  const existingMember = await circleService.getMemberByEmail(circlePayload.email);
  results.steps.circleDuplicateCheck = existingMember
    ? `EXISTS — member ID ${existingMember.id}`
    : 'NOT FOUND — would create new member';

  results.steps.currentSyncStatus = contact.properties?.circle_sync_status || 'not set';
  results.steps.currentMemberId = contact.properties?.circle_member_id || 'not set';

  logger.info('Test full flow complete (dry run)', { contactId });
  res.json(results);
});

module.exports = router;
