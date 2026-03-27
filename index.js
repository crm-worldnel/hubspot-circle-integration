const config = require('./src/config');
const app = require('./src/app');
const logger = require('./src/utils/logger');
const cron = require('node-cron');
const { processRetryQueue } = require('./src/services/retryProcessor');

// --- Start server ---
const server = app.listen(config.port, () => {
  logger.info(`Server started on port ${config.port}`, {
    port: config.port,
    baseUrl: config.baseUrl,
    nodeEnv: process.env.NODE_ENV || 'development',
  });
});

// --- Cron jobs ---

// Retry queue processing — runs every RETRY_INTERVAL_MINUTES (default 30)
const retryInterval = config.retry.intervalMinutes;
cron.schedule(`*/${retryInterval} * * * *`, async () => {
  try {
    const result = await processRetryQueue();
    if (result.processed > 0) {
      logger.info('Cron: retry queue cycle complete', result);
    }
  } catch (error) {
    logger.error('Cron: retry queue processing failed', { errorMessage: error.message });
  }
});

logger.info('Retry queue cron enabled', { intervalMinutes: retryInterval });

// Engagement sync — disabled until P2
// const engagementService = require('./src/services/engagement.service');
// cron.schedule('0 */8 * * *', async () => {
//   logger.info('Cron: engagement sync started');
//   try {
//     const result = await engagementService.syncEngagement();
//     logger.info('Cron: engagement sync completed', result);
//   } catch (error) {
//     logger.error('Cron: engagement sync failed', { errorMessage: error.message });
//   }
// });

// --- Graceful shutdown ---
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});
