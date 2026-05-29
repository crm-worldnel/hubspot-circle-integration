const logger = require('./logger');

// Circle choice IDs for cleft_care_specialty (select field)
const CIRCLE_SPECIALTY_IDS = {
  'Anesthesia': 37835,
  'Cleft Charity Leadership': 37836,
  'Dental': 37837,
  'ENT/Audiology': 37838,
  'Management/Coordination': 37839,
  'Nursing': 37840,
  'Nutrition': 37841,
  'Orthodontics': 37842,
  'Pediatrician': 37843,
  'Psychology': 37844,
  'Research': 37845,
  'Social Work': 37846,
  'Speech': 37847,
  'Surgery': 37848,
  'Other (Please Specify)': 37849,
};

// Circle choice IDs for ngo_affiliations (checkbox field)
const CIRCLE_NGO_IDS = {
  'Akila Bharatha Mahila Seva Samaja (ABMSS)': 37853,
  'CLEFT Charity UK': 37854,
  'Deutsche Cleft Kinderhilfe (DCKH)': 37855,
  'European Cleft Organization (ECO)': 37856,
  'Global Smile Foundation (GSF)': 37858,
  'Noordhoff Craniofacial Foundation (NCF)': 37859,
  'Operation Smile': 37860,
  'Project Harar, UK': 37861,
  'Smile Train': 37862,
  'Transforming Cleft': 37863,
  'Fundación Gantz': 43071,
  'Other': 46766,
  'None': 46767,
};

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

  // Resolve HubSpot slug → display label → Circle choice ID
  const specialtySlug = props.cleft_field_specialty || props.specialty;
  const specialtyLabel = specialtyOptions[specialtySlug] || specialtySlug || null;
  const specialtyId = specialtyLabel ? (CIRCLE_SPECIALTY_IDS[specialtyLabel] || null) : null;

  // NGO: semicolon-separated slugs → labels → Circle choice IDs (skip unknowns)
  const ngoRaw = props.cleft_ngo_affiliation;
  const ngoIds = ngoRaw
    ? ngoRaw.split(';').map((v) => {
        const slug = v.trim();
        const label = ngoOptions[slug] || slug;
        return CIRCLE_NGO_IDS[label] || null;
      }).filter(Boolean)
    : null;

  // Build community_member_profile_fields, stripping null/undefined/empty values
  const rawProfileFields = {
    cleft_care_specialty: specialtyId,
    prefix: props.title,
    city_town_of_professional_practice: props.city,
    organization: props.company,
    Title_or_Position: props.jobtitle,
    ngo_affiliations: ngoIds && ngoIds.length > 0 ? ngoIds : null,
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
