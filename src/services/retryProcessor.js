const retryQueue = require('../utils/retryQueue');
const circleService = require('./circle.service');
const hubspotService = require('./hubspot.service');
const { mapSyncResultToHubspot } = require('../utils/fieldMapper');
const logger = require('../utils/logger');

/**
 * Process all pending jobs in the retry queue.
 * For each job: attempt Circle createOrGetMember again.
 * On success: update HubSpot with SYNC_SUCCESS and remove from queue.
 * On exhausted retries (3 fails): set SYNC_FAILED in HubSpot.
 * @returns {{ processed: number, succeeded: number, failed: number, exhausted: number }}
 */
async function processRetryQueue() {
  const pending = retryQueue.getPending();

  if (pending.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0, exhausted: 0 };
  }

  logger.info('Retry queue processing started', { pendingJobs: pending.length });

  let succeeded = 0;
  let failed = 0;
  let exhausted = 0;

  for (const job of pending) {
    retryQueue.markAttempt(job.id);

    logger.info('Retrying Circle member creation', {
      jobId: job.id,
      contactId: job.contactId,
      attempt: job.attempts + 1,
      maxAttempts: job.maxAttempts,
    });

    const circleMember = await circleService.createOrGetMember(job.payload);

    if (circleMember) {
      // Success — update HubSpot and remove from queue
      const hubspotUpdate = mapSyncResultToHubspot({
        syncStatus: 'sync_success',
        circleMemberId: circleMember.id,
      });

      await hubspotService.updateContact(job.contactId, hubspotUpdate);
      retryQueue.remove(job.id);
      succeeded += 1;

      logger.info('Retry succeeded', {
        jobId: job.id,
        contactId: job.contactId,
        circleMemberId: circleMember.id,
        alreadyExisted: circleMember.alreadyExisted,
      });
    } else {
      failed += 1;

      // Check if retries are now exhausted (attempts was incremented by markAttempt)
      const updatedJob = retryQueue.get(job.id);
      if (updatedJob && updatedJob.attempts >= updatedJob.maxAttempts) {
        exhausted += 1;
        const failDate = new Date();
        failDate.setUTCHours(0, 0, 0, 0);
        await hubspotService.updateContact(job.contactId, {
          circle_sync_status: 'sync_failed',
          circle_last_synced: failDate.getTime(),
        });

        logger.error('Retry exhausted — marking SYNC_FAILED', {
          jobId: job.id,
          contactId: job.contactId,
          attempts: updatedJob.attempts,
        });
      } else {
        logger.warn('Retry failed — will try again next cycle', {
          jobId: job.id,
          contactId: job.contactId,
          attempts: updatedJob?.attempts,
          maxAttempts: updatedJob?.maxAttempts,
        });
      }
    }
  }

  const stats = retryQueue.getStats();
  logger.info('Retry queue processing complete', {
    processed: pending.length,
    succeeded,
    failed,
    exhausted,
    queueStats: stats,
  });

  return { processed: pending.length, succeeded, failed, exhausted };
}

module.exports = { processRetryQueue };
