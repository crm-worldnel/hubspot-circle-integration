const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Mask an email for safe logging: jane@example.com → ja**@example.com
 */
function maskEmail(email) {
  if (!email || !email.includes('@')) return '***';
  const [local, domain] = email.split('@');
  const visible = local.slice(0, 2);
  return `${visible}**@${domain}`;
}

// Circle Admin API V2 — Bearer auth, community scoped by token
const circleClient = axios.create({
  baseURL: config.circle.apiBase,
  headers: {
    Authorization: `Bearer ${config.circle.apiKey}`,
    'Content-Type': 'application/json',
  },
  timeout: 15000,
});

/**
 * Search for a Circle member by email using the V2 search endpoint.
 * @param {string} email
 * @returns {Promise<Object|null>} The member object if found, null otherwise.
 */
async function getMemberByEmail(email) {
  const start = Date.now();
  const masked = maskEmail(email);
  logger.debug('Circle outgoing request', { method: 'GET', endpoint: '/community_members/search', email: masked });

  try {
    const response = await circleClient.get('/community_members/search', {
      params: { email },
    });

    const duration = Date.now() - start;
    const member = response.data;

    if (member && member.id) {
      logger.info('Circle member found by email', {
        email: masked,
        circleMemberId: member.id,
        durationMs: duration,
      });
      return member;
    }

    logger.info('Circle member not found by email', { email: masked, durationMs: duration });
    return null;
  } catch (error) {
    const duration = Date.now() - start;
    if (error.response?.status === 404) {
      logger.info('Circle member not found by email', { email: masked, durationMs: duration });
      return null;
    }
    logger.error('Circle getMemberByEmail failed', {
      email: masked,
      statusCode: error.response?.status,
      errorMessage: error.message,
      durationMs: duration,
    });
    return null;
  }
}

/**
 * Create (invite) a new member in Circle via V2 API.
 * @param {Object} circlePayload - { email, name, skip_invitation, community_member_profile_fields }
 * @returns {Promise<Object|null>} The created member object, or null on failure.
 */
async function createMember(circlePayload) {
  const start = Date.now();
  const masked = maskEmail(circlePayload.email);
  logger.debug('Circle outgoing request', { method: 'POST', endpoint: '/community_members', email: masked });

  try {
    const response = await circleClient.post('/community_members', circlePayload);
    const duration = Date.now() - start;

    logger.info('Circle member created', {
      email: masked,
      circleMemberId: response.data.id,
      inviteSent: !circlePayload.skip_invitation,
      durationMs: duration,
    });

    return response.data;
  } catch (error) {
    const duration = Date.now() - start;
    logger.error('Circle createMember failed', {
      email: masked,
      statusCode: error.response?.status,
      errorMessage: error.message,
      errorBody: error.response?.data,
      durationMs: duration,
    });
    return null;
  }
}

/**
 * Idempotent orchestrator: find existing member or create a new one.
 * @param {Object} circlePayload - Mapped payload from fieldMapper
 * @returns {Promise<Object|null>} Member object with alreadyExisted flag, or null on total failure.
 */
async function createOrGetMember(circlePayload) {
  const masked = maskEmail(circlePayload.email);

  // Step 1: Duplicate check
  const existing = await getMemberByEmail(circlePayload.email);

  if (existing) {
    logger.info('Circle member already exists — skipping creation', {
      email: masked,
      circleMemberId: existing.id,
    });
    existing.alreadyExisted = true;
    return existing;
  }

  // Step 2: Create new member
  const created = await createMember(circlePayload);

  if (created) {
    created.alreadyExisted = false;
    return created;
  }

  logger.error('Circle createOrGetMember failed — both lookup and creation unsuccessful', {
    email: masked,
  });
  return null;
}

/**
 * Fetch a single Circle member by their member ID.
 * @param {number|string} memberId
 * @returns {Promise<Object|null>} The member object or null.
 */
async function getMemberById(memberId) {
  const start = Date.now();
  logger.debug('Circle outgoing request', { method: 'GET', endpoint: `/community_members/${memberId}` });

  try {
    const response = await circleClient.get(`/community_members/${memberId}`);
    const duration = Date.now() - start;

    logger.info('Circle member fetched by ID', {
      circleMemberId: memberId,
      durationMs: duration,
    });

    return response.data;
  } catch (error) {
    const duration = Date.now() - start;
    logger.error('Circle getMemberById failed', {
      circleMemberId: memberId,
      statusCode: error.response?.status,
      errorMessage: error.message,
      durationMs: duration,
    });
    return null;
  }
}

/**
 * Fetch all community members (paginated, V2 format).
 * @returns {Promise<Object[]>} Array of all community members.
 */
async function getAllMembers() {
  const members = [];
  let page = 1;
  const perPage = 50;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const start = Date.now();
    try {
      const response = await circleClient.get('/community_members', {
        params: { page, per_page: perPage },
      });

      const duration = Date.now() - start;
      const data = response.data;
      const records = data.records || [];

      logger.debug('Circle members page fetched', {
        page,
        count: records.length,
        hasNextPage: data.has_next_page,
        durationMs: duration,
      });

      members.push(...records);

      if (!data.has_next_page) break;
      page += 1;
    } catch (error) {
      const duration = Date.now() - start;
      logger.error('Circle getAllMembers page failed', {
        page,
        statusCode: error.response?.status,
        errorMessage: error.message,
        durationMs: duration,
      });
      return null;
    }
  }

  logger.info('Circle getAllMembers complete', { totalMembers: members.length });
  return members;
}

module.exports = {
  getMemberByEmail,
  createMember,
  createOrGetMember,
  getMemberById,
  getAllMembers,
};
