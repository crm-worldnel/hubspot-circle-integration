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
    specialty: props.specialty,
    prefix: props.title,
    city_town_of_professional_practice: props.city,
    country: props.country,
    name_of_hospital_clinic_organization: props.company,
    work_title_position: props.jobtitle,
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
 * Engagement score = posts×3 + comments×2 + rsvps×1
 * @param {Object} engagement - { postCount, commentCount, rsvpCount, lastActiveAt }
 * @returns {Object} HubSpot properties object
 */
function mapEngagementToHubspot(engagement) {
  const score =
    (engagement.postCount || 0) * 3 +
    (engagement.commentCount || 0) * 2 +
    (engagement.rsvpCount || 0) * 1;

  return {
    circle_engagement_score: score,
    circle_post_count: engagement.postCount || 0,
    circle_comment_count: engagement.commentCount || 0,
    circle_rsvp_count: engagement.rsvpCount || 0,
    circle_last_active: engagement.lastActiveAt || '',
    circle_last_synced: new Date().toISOString(),
  };
}

module.exports = {
  mapHubSpotToCircle,
  mapSyncResultToHubspot,
  mapEngagementToHubspot,
};
