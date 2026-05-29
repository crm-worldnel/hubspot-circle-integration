const logger = require('./logger');

/**
 * Maps HubSpot contact properties to Circle.so member creation payload.
 *
 * Rules:
 * - Concatenates firstname + lastname for name. Uses whichever is present
 *   if one is missing. Falls back to email prefix if both missing.
 * - Strips null/undefined/empty string values from custom_fields.
 * - Logs a warning if email is missing.
 *
 * @param {Object} hubspotProperties - HubSpot contact properties object
 *   (e.g. { firstname, lastname, email, specialty })
 * @returns {Object} Circle API body for POST /community_members
 */
function mapHubSpotToCircle(hubspotProperties) {
  const props = hubspotProperties || {};

  if (!props.email) {
    logger.warn('mapHubSpotToCircle called with missing email', { props });
  }

  // Build name: firstname + lastname, fallback to email prefix
  const firstName = (props.firstname || '').trim();
  const lastName = (props.lastname || '').trim();
  let name = `${firstName} ${lastName}`.trim();
  if (!name && props.email) {
    name = props.email.split('@')[0];
  }

  // Build community_member_profile_fields, stripping null/undefined/empty values
  const rawProfileFields = {
    cleft_care_specialty: props.specialty,
    prefix: props.title,
    city_town_of_professional_practice: props.city,
    location: props.country,
    organization: props.company,
    Title_or_Position: props.jobtitle,
    ngo_affiliations: props.cleft_ngo_affiliation,
  };
  const community_member_profile_fields = {};
  for (const [key, value] of Object.entries(rawProfileFields)) {
    if (value !== null && value !== undefined && value !== '') {
      community_member_profile_fields[key] = value;
    }
  }

  return {
    email: props.email,
    name,
    skip_invitation: false,
    ...(Object.keys(community_member_profile_fields).length > 0
      ? { community_member_profile_fields }
      : {}),
  };
}

/**
 * Build a HubSpot contact update payload with Circle sync results.
 * @param {Object} params
 * @param {string} params.syncStatus - SYNC_SUCCESS | SYNC_FAILED | RETRY_REQUIRED
 * @param {string} [params.circleMemberId] - Circle member ID
 * @param {string} [params.error] - Error message if failed
 * @returns {Object} HubSpot properties object
 */
function mapSyncResultToHubspot({ syncStatus, circleMemberId, error }) {
  // HubSpot date properties require midnight UTC timestamps
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const properties = {
    circle_sync_status: syncStatus,
    circle_last_synced: today.getTime(),
  };

  if (circleMemberId) {
    properties.circle_member_id = String(circleMemberId);
  }

  return properties;
}

/**
 * Build HubSpot properties from Circle engagement data.
 * Engagement score = posts×3 + comments×2
 * @param {Object} engagement - { postCount, commentCount, lastActiveAt }
 * @returns {Object} HubSpot properties object
 */
function mapEngagementToHubspot(engagement) {
  const score =
    (engagement.postCount || 0) * 3 +
    (engagement.commentCount || 0) * 2;

  // HubSpot date properties require midnight UTC timestamps
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // Convert lastActiveAt to midnight UTC if present
  let lastActive = '';
  if (engagement.lastActiveAt) {
    const d = new Date(engagement.lastActiveAt);
    if (!isNaN(d.getTime())) {
      d.setUTCHours(0, 0, 0, 0);
      lastActive = d.getTime();
    }
  }

  return {
    circle_engagement_score: String(score),
    circle_post_count: String(engagement.postCount || 0),
    circle_comment_count: String(engagement.commentCount || 0),
    circle_rsvp_count: String(0),
    circle_last_active: lastActive,
    circle_last_synced: today.getTime(),
  };
}

module.exports = {
  mapHubSpotToCircle,
  mapSyncResultToHubspot,
  mapEngagementToHubspot,
};
