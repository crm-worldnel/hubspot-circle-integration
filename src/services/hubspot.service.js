const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

const HUBSPOT_BASE_URL = 'https://api.hubapi.com';
const CONTACT_PROPERTIES = [
  'firstname', 'lastname', 'email', 'specialty',
  'title', 'city', 'country', 'company', 'jobtitle', 'cleft_ngo_affiliation',
  'circle_sync_status', 'circle_member_id', 'circle_last_synced',
  'circle_engagement_score', 'circle_post_count', 'circle_comment_count',
  'circle_rsvp_count', 'circle_last_active',
];

const hubspotClient = axios.create({
  baseURL: HUBSPOT_BASE_URL,
  headers: {
    Authorization: `Bearer ${config.hubspot.accessToken}`,
    'Content-Type': 'application/json',
  },
  timeout: 15000,
});

/**
 * Fetch a single contact by HubSpot contactId.
 * @param {string} contactId - The HubSpot contact ID
 * @returns {Promise<Object|null>} The contact properties object, or null on failure
 */
async function getContactById(contactId) {
  const start = Date.now();
  const url = `/crm/v3/objects/contacts/${contactId}`;
  logger.debug('HubSpot outgoing request', { method: 'GET', url, contactId });

  try {
    const response = await hubspotClient.get(url, {
      params: { properties: CONTACT_PROPERTIES.join(',') },
    });

    const duration = Date.now() - start;
    logger.info('HubSpot contact fetched', {
      contactId,
      statusCode: response.status,
      durationMs: duration,
    });

    return response.data;
  } catch (error) {
    const duration = Date.now() - start;
    logger.error('HubSpot getContactById failed', {
      contactId,
      statusCode: error.response?.status,
      errorMessage: error.message,
      durationMs: duration,
    });
    return null;
  }
}

/**
 * Fetch a contact by email address using the HubSpot search API.
 * @param {string} email - The email address to search for
 * @returns {Promise<Object|null>} The contact object { id, properties } or null if not found
 */
async function getContactByEmail(email) {
  const start = Date.now();
  const url = '/crm/v3/objects/contacts/search';
  logger.debug('HubSpot outgoing request', { method: 'POST', url, email });

  try {
    const response = await hubspotClient.post(url, {
      filterGroups: [
        {
          filters: [
            {
              propertyName: 'email',
              operator: 'EQ',
              value: email,
            },
          ],
        },
      ],
      properties: CONTACT_PROPERTIES,
      limit: 1,
    });

    const duration = Date.now() - start;
    const results = response.data.results;

    if (results && results.length > 0) {
      logger.info('HubSpot contact found by email', {
        email,
        contactId: results[0].id,
        statusCode: response.status,
        durationMs: duration,
      });
      return results[0];
    }

    logger.info('HubSpot contact not found by email', {
      email,
      statusCode: response.status,
      durationMs: duration,
    });
    return null;
  } catch (error) {
    const duration = Date.now() - start;
    logger.error('HubSpot getContactByEmail failed', {
      email,
      statusCode: error.response?.status,
      errorMessage: error.message,
      durationMs: duration,
    });
    return null;
  }
}

/**
 * Update a contact's properties by contactId.
 * @param {string} contactId - The HubSpot contact ID
 * @param {Object} properties - Plain object of HubSpot property key/value pairs
 * @returns {Promise<boolean>} true on success, false on failure
 */
async function updateContact(contactId, properties) {
  const start = Date.now();
  const url = `/crm/v3/objects/contacts/${contactId}`;
  logger.debug('HubSpot outgoing request', { method: 'PATCH', url, contactId });

  try {
    const response = await hubspotClient.patch(url, { properties });

    const duration = Date.now() - start;
    logger.info('HubSpot contact updated', {
      contactId,
      properties: Object.keys(properties),
      statusCode: response.status,
      durationMs: duration,
    });

    return true;
  } catch (error) {
    const duration = Date.now() - start;
    logger.error('HubSpot updateContact failed', {
      contactId,
      statusCode: error.response?.status,
      errorMessage: error.message,
      durationMs: duration,
    });
    return false;
  }
}

/**
 * Batch update up to 100 contacts in HubSpot.
 * @param {Array<{ id: string, properties: Object }>} contacts - Array of contact updates
 * @returns {Promise<{ successCount: number, failureCount: number }>}
 */
async function batchUpdateContacts(contacts) {
  const start = Date.now();
  const url = '/crm/v3/objects/contacts/batch/update';
  logger.debug('HubSpot outgoing request', { method: 'POST', url, count: contacts.length });

  try {
    const response = await hubspotClient.post(url, { inputs: contacts });

    const duration = Date.now() - start;
    const successCount = response.data.results ? response.data.results.length : contacts.length;
    const failureCount = contacts.length - successCount;

    logger.info('HubSpot batch update complete', {
      successCount,
      failureCount,
      statusCode: response.status,
      durationMs: duration,
    });

    return { successCount, failureCount };
  } catch (error) {
    const duration = Date.now() - start;
    logger.error('HubSpot batchUpdateContacts failed', {
      count: contacts.length,
      statusCode: error.response?.status,
      errorMessage: error.message,
      durationMs: duration,
    });
    return { successCount: 0, failureCount: contacts.length };
  }
}

module.exports = {
  getContactById,
  getContactByEmail,
  updateContact,
  batchUpdateContacts,
};
