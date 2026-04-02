const fs = require('fs');
const path = require('path');
const circleService = require('./circle.service');
const hubspotService = require('./hubspot.service');
const { mapEngagementToHubspot } = require('../utils/fieldMapper');
const logger = require('../utils/logger');

const SYNC_HISTORY_PATH = path.join(__dirname, '../../logs/sync-history.json');

/**
 * Partially mask an email for logging: jane@example.com → ja**@example.com
 */
function maskEmail(email) {
  if (!email || !email.includes('@')) return '***';
  const [local, domain] = email.split('@');
  return `${local.slice(0, 2)}**@${domain}`;
}

/**
 * Run the full engagement sync cycle:
 * 1. Fetch all Circle community members (includes posts_count, comments_count, last_seen_at)
 * 2. Match each to a HubSpot contact by email
 * 3. Derive engagement score and write back to HubSpot in batches
 */
async function syncEngagement() {
  const start = Date.now();
  logger.info('Engagement sync started');

  try {
    // Step 1: Fetch all Circle members (paginated — getAllMembers handles this)
    const circleMembers = await circleService.getAllMembers();
    logger.info('Fetched Circle members for engagement sync', {
      count: circleMembers.length,
    });

    // Step 2: Build batch updates for HubSpot
    const batchUpdates = [];
    const skipped = { noEmail: 0, noHubspot: 0, error: 0 };
    const BATCH_SIZE = 100;
    const API_DELAY_MS = 200; // Rate limiting

    for (const member of circleMembers) {
      if (!member.email) {
        skipped.noEmail++;
        continue;
      }

      try {
        // Match to HubSpot contact by email
        const hubspotContact = await hubspotService.getContactByEmail(member.email);
        if (!hubspotContact) {
          logger.debug('No HubSpot contact found for Circle member', {
            email: maskEmail(member.email),
          });
          skipped.noHubspot++;
          continue;
        }

        // Circle V2 member object provides these fields directly
        const engagement = {
          postCount: member.posts_count || 0,
          commentCount: member.comments_count || 0,
          lastActiveAt: member.last_seen_at || member.updated_at || '',
        };

        const properties = mapEngagementToHubspot(engagement);

        batchUpdates.push({
          id: hubspotContact.id,
          properties,
        });

        // Rate limiting delay
        await delay(API_DELAY_MS);
      } catch (error) {
        skipped.error++;
        logger.error('Engagement sync failed for member', {
          email: maskEmail(member.email),
          errorMessage: error.message,
        });
      }
    }

    // Step 3: Send batch updates to HubSpot (chunks of 100)
    let batchesSent = 0;
    let batchesFailed = 0;

    for (let i = 0; i < batchUpdates.length; i += BATCH_SIZE) {
      const chunk = batchUpdates.slice(i, i + BATCH_SIZE);
      try {
        await hubspotService.batchUpdateContacts(chunk);
        batchesSent++;
        logger.info('Engagement batch update sent', {
          batchIndex: Math.floor(i / BATCH_SIZE) + 1,
          count: chunk.length,
        });
      } catch (error) {
        batchesFailed++;
        logger.error('Engagement batch update failed', {
          batchIndex: Math.floor(i / BATCH_SIZE) + 1,
          count: chunk.length,
          errorMessage: error.message,
        });
      }

      // Rate limiting between batches
      if (i + BATCH_SIZE < batchUpdates.length) {
        await delay(API_DELAY_MS);
      }
    }

    const duration = Date.now() - start;
    const summary = {
      timestamp: new Date().toISOString(),
      totalMembers: circleMembers.length,
      updatedContacts: batchUpdates.length,
      skipped,
      batchesSent,
      batchesFailed,
      durationMs: duration,
    };

    logger.info('Engagement sync completed', summary);

    // Write sync summary to logs/sync-history.json
    writeSyncHistory(summary);

    return summary;
  } catch (error) {
    const duration = Date.now() - start;
    logger.error('Engagement sync failed', {
      errorMessage: error.message,
      durationMs: duration,
    });
    throw error;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Append a sync summary record to logs/sync-history.json.
 * Keeps the last 100 records to avoid unbounded growth.
 */
function writeSyncHistory(summary) {
  try {
    const dir = path.dirname(SYNC_HISTORY_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let history = [];
    if (fs.existsSync(SYNC_HISTORY_PATH)) {
      const raw = fs.readFileSync(SYNC_HISTORY_PATH, 'utf8');
      history = JSON.parse(raw);
    }

    history.push(summary);

    // Keep only last 100 records
    if (history.length > 100) {
      history = history.slice(-100);
    }

    fs.writeFileSync(SYNC_HISTORY_PATH, JSON.stringify(history, null, 2));
  } catch (err) {
    logger.error('Failed to write sync history', { errorMessage: err.message });
  }
}

module.exports = {
  syncEngagement,
};
