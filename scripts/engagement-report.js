/**
 * Phase 2 Engagement Report
 * Looks up specific Circle members and their corresponding HubSpot data
 * to produce a verification report for the client.
 *
 * Usage: node scripts/engagement-report.js
 */
require('dotenv').config();

const axios = require('axios');

const CIRCLE_API_KEY = process.env.CIRCLE_API_KEY;
const HUBSPOT_ACCESS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;

const circleClient = axios.create({
  baseURL: 'https://app.circle.so/api/admin/v2',
  headers: { Authorization: `Bearer ${CIRCLE_API_KEY}`, 'Content-Type': 'application/json' },
  timeout: 15000,
});

const hubspotClient = axios.create({
  baseURL: 'https://api.hubapi.com',
  headers: { Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
  timeout: 15000,
});

const MEMBERS = [
  { name: 'Zainal A Ahmad', email: 'zainal.ahmad@icloud.com' },
  { name: 'Veronica Valeria Coria', email: 'veronicavacoria@gmail.com' },
  { name: 'Diego De Cardenas', email: 'ddecardenas@hotmail.com' },
  { name: 'Tewodros Gebremedhin', email: 'tewoderosmelese@gmail.com' },
  { name: 'Maria Masetto', email: 'maria_masetto@hotmail.com' },
];

const ENGAGEMENT_PROPERTIES = [
  'firstname', 'lastname', 'email',
  'circle_engagement_score', 'circle_post_count', 'circle_comment_count',
  'circle_rsvp_count', 'circle_last_active', 'circle_last_synced',
];

async function getCircleMember(email) {
  try {
    const res = await circleClient.get('/community_members/search', { params: { email } });
    if (res.data && res.data.id) return res.data;
    return null;
  } catch {
    return null;
  }
}

async function getHubSpotContact(email) {
  try {
    const res = await hubspotClient.post('/crm/v3/objects/contacts/search', {
      filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
      properties: ENGAGEMENT_PROPERTIES,
      limit: 1,
    });
    if (res.data.total > 0) return res.data.results[0];
    return null;
  } catch {
    return null;
  }
}

function formatDate(timestamp) {
  if (!timestamp) return 'N/A';
  const d = new Date(Number(timestamp));
  if (isNaN(d.getTime())) return 'N/A';
  return d.toISOString().split('T')[0];
}

async function run() {
  console.log('='.repeat(80));
  console.log('PHASE 2 ENGAGEMENT SYNC — VERIFICATION REPORT');
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log('='.repeat(80));
  console.log('');

  const results = [];

  for (const member of MEMBERS) {
    console.log(`Looking up: ${member.name} (${member.email})...`);

    // Small delay for rate limiting
    await new Promise((r) => setTimeout(r, 300));

    const circleMember = await getCircleMember(member.email);
    await new Promise((r) => setTimeout(r, 300));
    const hubspotContact = await getHubSpotContact(member.email);

    const row = {
      name: member.name,
      email: member.email,
      circle: circleMember
        ? {
            memberId: circleMember.id,
            postsCount: circleMember.posts_count || 0,
            commentsCount: circleMember.comments_count || 0,
            lastSeenAt: circleMember.last_seen_at || 'N/A',
            expectedScore: (circleMember.posts_count || 0) * 3 + (circleMember.comments_count || 0) * 2,
          }
        : null,
      hubspot: hubspotContact
        ? {
            contactId: hubspotContact.id,
            engagementScore: hubspotContact.properties.circle_engagement_score || '0',
            postCount: hubspotContact.properties.circle_post_count || '0',
            commentCount: hubspotContact.properties.circle_comment_count || '0',
            lastActive: formatDate(hubspotContact.properties.circle_last_active),
            lastSynced: formatDate(hubspotContact.properties.circle_last_synced),
          }
        : null,
    };

    results.push(row);
  }

  // Print report
  console.log('');
  console.log('-'.repeat(80));

  for (const r of results) {
    console.log('');
    console.log(`  NAME: ${r.name}`);
    console.log(`  EMAIL: ${r.email}`);

    if (!r.circle) {
      console.log(`  CIRCLE: NOT FOUND`);
    } else {
      console.log(`  CIRCLE DATA (source of truth):`);
      console.log(`    Member ID:      ${r.circle.memberId}`);
      console.log(`    Posts:          ${r.circle.postsCount}`);
      console.log(`    Comments:       ${r.circle.commentsCount}`);
      console.log(`    Last Seen:      ${r.circle.lastSeenAt}`);
      console.log(`    Expected Score: ${r.circle.expectedScore}  (posts×3 + comments×2)`);
    }

    if (!r.hubspot) {
      console.log(`  HUBSPOT: NOT FOUND (email mismatch?)`);
    } else {
      console.log(`  HUBSPOT DATA (what our sync wrote):`);
      console.log(`    Contact ID:       ${r.hubspot.contactId}`);
      console.log(`    Engagement Score: ${r.hubspot.engagementScore}`);
      console.log(`    Posts Count:      ${r.hubspot.postCount}`);
      console.log(`    Comments Count:   ${r.hubspot.commentCount}`);
      console.log(`    Last Active:      ${r.hubspot.lastActive}`);
      console.log(`    Last Synced:      ${r.hubspot.lastSynced}`);
    }

    // Match check
    if (r.circle && r.hubspot) {
      const scoreMatch = String(r.circle.expectedScore) === r.hubspot.engagementScore;
      const postsMatch = String(r.circle.postsCount) === r.hubspot.postCount;
      const commentsMatch = String(r.circle.commentsCount) === r.hubspot.commentCount;
      const allMatch = scoreMatch && postsMatch && commentsMatch;
      console.log(`  MATCH: ${allMatch ? 'YES — all values match' : 'NO — mismatch detected'}`);
      if (!scoreMatch) console.log(`    Score: Circle=${r.circle.expectedScore} vs HubSpot=${r.hubspot.engagementScore}`);
      if (!postsMatch) console.log(`    Posts: Circle=${r.circle.postsCount} vs HubSpot=${r.hubspot.postCount}`);
      if (!commentsMatch) console.log(`    Comments: Circle=${r.circle.commentsCount} vs HubSpot=${r.hubspot.commentCount}`);
    }

    console.log('  ' + '-'.repeat(76));
  }

  // Summary
  const matched = results.filter((r) => r.circle && r.hubspot).length;
  const circleOnly = results.filter((r) => r.circle && !r.hubspot).length;
  const notInCircle = results.filter((r) => !r.circle).length;

  console.log('');
  console.log('SUMMARY:');
  console.log(`  Total members checked: ${results.length}`);
  console.log(`  Matched (Circle + HubSpot): ${matched}`);
  console.log(`  Circle only (no HubSpot match): ${circleOnly}`);
  console.log(`  Not found in Circle: ${notInCircle}`);
  console.log('');
  console.log('='.repeat(80));
}

run().catch((err) => {
  console.error('Report failed:', err.message);
  process.exit(1);
});
