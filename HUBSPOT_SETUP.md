# HubSpot Custom Properties Setup

Before going live, create these custom properties on the **Contact** object in HubSpot.

Go to **Settings → Properties → Contact Properties → Create property** for each one.

---

## Required Custom Properties

| Property name             | Internal name           | Type       | Group   | Options / Description                                              |
|---------------------------|-------------------------|------------|---------|--------------------------------------------------------------------|
| Circle Sync Status        | `circle_sync_status`    | Dropdown   | Contact | Options: `PENDING`, `SYNC_SUCCESS`, `SYNC_FAILED`, `RETRY_REQUIRED` |
| Circle Member ID          | `circle_member_id`      | Single-line text | Contact | Circle member ID returned on creation                        |
| Circle Last Synced        | `circle_last_synced`    | Date picker | Contact | Timestamp of last successful sync                                 |
| Circle Last Active        | `circle_last_active`    | Date picker | Contact | Last activity date in Circle                                       |
| Circle Engagement Score   | `circle_engagement_score` | Number   | Contact | Derived score: posts×3 + comments×2 + rsvps×1                    |
| Circle Post Count         | `circle_post_count`     | Number     | Contact | Total posts created in Circle                                      |
| Circle Comment Count      | `circle_comment_count`  | Number     | Contact | Total comments created in Circle                                   |
| Circle RSVP Count         | `circle_rsvp_count`     | Number     | Contact | Total event RSVPs in Circle                                        |

---

## Setup Steps

### 1. Create a Property Group (optional but recommended)

1. Go to **Settings → Properties**
2. Select **Contact properties**
3. Click **Create group** → name it `Circle Integration`
4. Assign all properties above to this group

### 2. Create Each Property

For each property in the table above:

1. Click **Create property**
2. Set the **Label** (display name) and verify the **Internal name** matches the table
3. Set the **Field type** as specified
4. For `circle_sync_status`, add the dropdown options: `PENDING`, `SYNC_SUCCESS`, `SYNC_FAILED`, `RETRY_REQUIRED`
5. Save

### 3. Verify in Workflow

After creating the properties, verify they appear in the HubSpot Workflow's "Edit record" actions:

- The webhook step (POST `/api/circle/create-member`) will write `circle_sync_status`, `circle_member_id`, and `circle_last_synced` via the API
- The engagement sync cron will write all engagement-related properties via the API
- Step 7 in the existing workflow can be configured as a fallback to set `circle_sync_status`

### 4. Create a Contact View (recommended)

Create a saved view in **Contacts** with these columns to monitor sync status:

- Email
- Circle Sync Status
- Circle Member ID
- Circle Last Synced
- Circle Engagement Score
