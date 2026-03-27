const dotenv = require('dotenv');

dotenv.config();

const REQUIRED_VARS = [
  'PORT',
  'BASE_URL',
  'ADMIN_API_KEY',
  'HUBSPOT_ACCESS_TOKEN',
  'HUBSPOT_WEBHOOK_SECRET',
  'CIRCLE_API_KEY',
  'CIRCLE_COMMUNITY_ID',
];

const missing = REQUIRED_VARS.filter((key) => !process.env[key]);

if (missing.length > 0) {
  const message = `Missing required environment variables:\n  - ${missing.join('\n  - ')}\n\nCopy .env.example to .env and fill in all values.`;
  throw new Error(message);
}

const config = {
  port: parseInt(process.env.PORT, 10) || 3001,
  baseUrl: process.env.BASE_URL,
  adminApiKey: process.env.ADMIN_API_KEY,

  hubspot: {
    accessToken: process.env.HUBSPOT_ACCESS_TOKEN,
    webhookSecret: process.env.HUBSPOT_WEBHOOK_SECRET,
    apiBase: 'https://api.hubapi.com',
  },

  circle: {
    apiKey: process.env.CIRCLE_API_KEY,
    communityId: process.env.CIRCLE_COMMUNITY_ID,
    apiBase: 'https://app.circle.so/api/admin/v2',
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },

  retry: {
    maxAttempts: parseInt(process.env.MAX_RETRY_ATTEMPTS, 10) || 3,
    intervalMinutes: parseInt(process.env.RETRY_INTERVAL_MINUTES, 10) || 30,
  },
};

module.exports = config;
