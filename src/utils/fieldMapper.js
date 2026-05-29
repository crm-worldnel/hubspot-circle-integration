const logger = require('./logger');

// Valid NGO choices as defined in Circle profile fields (id: ngo_affiliations)
const CIRCLE_NGO_CHOICES = new Set([
  'Akila Bharatha Mahila Seva Samaja (ABMSS)',
  'CLEFT Charity UK',
  'Deutsche Cleft Kinderhilfe (DCKH)',
  'European Cleft Organization (ECO)',
  'Global Smile Foundation (GSF)',
  'Noordhoff Craniofacial Foundation (NCF)',
  'Operation Smile',
  'Project Harar, UK',
  'Smile Train',
  'Transforming Cleft',
  'Fundación Gantz',
  'Other',
  'None',
]);

/**
 * @param {Object} hubspotProperties
 * @param {Object} [propertyOptions] - { specialtyOptions: {slug: label}, ngoOptions: {slug: label} }
 */
function mapHubSpotToCircle(hubspotProperties, propertyOptions = {}) {
  const props = hubspotProperties || {};
  const { specialtyOptions = {}, ngoOptions = {} } = propertyOptions;

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

  // Resolve HubSpot slug to Circle display label
  const specialtySlug = props.cleft_field_specialty || props.specialty;
  const specialtyLabel = specialtyOptions[specialtySlug] || specialtySlug || null;

  // NGO: semicolon-separated slugs → resolve labels → filter to valid Circle choices only
  const ngoRaw = props.cleft_ngo_affiliation;
  const ngoValue = ngoRaw
    ? ngoRaw.split(';').map((v) => {
        const slug = v.trim();
        return ngoOptions[slug] || slug;
      }).filter((label) => CIRCLE_NGO_CHOICES.has(label))
    : null;

  // Build community_member_profile_fields, stripping null/undefined/empty values
  const rawProfileFields = {
    cleft_care_specialty: specialtyLabel,
    prefix: props.title,
    city_town_of_professional_practice: props.city,
    organization: props.company,
    Title_or_Position: props.jobtitle,
    ngo_affiliations: ngoValue && ngoValue.length > 0 ? ngoValue : null,
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
