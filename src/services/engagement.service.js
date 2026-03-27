const circleService = require('./circle.service');
const hubspotService = require('./hubspot.service');
const { mapEngagementToHubspot } = require('../utils/fieldMapper');
const logger = require('../utils/logger');

/**
 * Run the full engagement sync cycle:
 * 1. Fetch all Circle community members
 * 2. For each member, gather engagement metrics
 * 3. Match to HubSpot contact by email
 * 4. Derive engagement score and write back to HubSpot
 */
async function syncEngagement() {
  const start = Date.now();
  logger.info('Engagement sync started');

  try {
    // Step 1: Fetch all Circle members
    const circleMembers = await circleService.getAllMembers();
    logger.info('Fetched Circle members for engagement sync', {
      count: circleMembers.length,
    });

    // Step 2: Build batch updates for HubSpot
    const batchUpdates = [];
    const BATCH_SIZE = 100;
    const API_DELAY_MS = 200; // Rate limiting: 100 req / 10s

    for (const member of circleMembers) {
      if (!member.email) continue;

      try {
        // Match to HubSpot contact
        const hubspotContact = await hubspotService.searchContactByEmail(member.email);
        if (!hubspotContact) {
          logger.debug('No HubSpot contact found for Circle member', {
            email: member.email,
          });
          continue;
        }

        // TODO: Fetch actual engagement data from Circle API
        // Currently uses placeholder data from member object
        const engagement = {
          postCount: member.post_count || 0,
          commentCount: member.comment_count || 0,
          rsvpCount: member.rsvp_count || 0,
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
        logger.error('Engagement sync failed for member', {
          email: member.email,
          errorMessage: error.message,
        });
        // Continue processing other members
      }
    }

    // Step 3: Send batch updates to HubSpot (chunks of 100)
    for (let i = 0; i < batchUpdates.length; i += BATCH_SIZE) {
      const chunk = batchUpdates.slice(i, i + BATCH_SIZE);
      try {
        await hubspotService.batchUpdateContacts(chunk);
        logger.info('Engagement batch update sent', {
          batchIndex: Math.floor(i / BATCH_SIZE) + 1,
          count: chunk.length,
        });
      } catch (error) {
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
    logger.info('Engagement sync completed', {
      totalMembers: circleMembers.length,
      updatedContacts: batchUpdates.length,
      durationMs: duration,
    });

    return {
      totalMembers: circleMembers.length,
      updatedContacts: batchUpdates.length,
      durationMs: duration,
    };
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

module.exports = {
  syncEngagement,
};
