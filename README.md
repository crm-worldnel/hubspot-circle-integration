# hubspot-circle-sync

Production-grade middleware service that bridges **HubSpot CRM** with **Circle.so** community platform. Bi-directional, event-driven, with retry logic and full observability.

## What It Does

### Phase 1 — HubSpot → Circle (User Provisioning)

When a deal/contact is approved inside a HubSpot Workflow, the workflow fires a webhook to this middleware. The middleware:

1. Fetches the full contact from HubSpot
2. Checks if the user already exists in Circle (by email)
3. Creates the Circle member if they don't exist
4. Writes the sync result back to HubSpot as custom contact properties

### Phase 2 — Circle → HubSpot (Engagement Sync)

A scheduled cron job (every 8 hours):

1. Fetches engagement data from Circle (posts, comments, RSVPs, last active date)
2. Matches Circle members to HubSpot contacts by email
3. Derives an engagement score (posts×3 + comments×2 + rsvps×1)
4. Writes engagement data back to HubSpot contact properties

---

## Local Setup

### Prerequisites

- Node.js >= 18
- A HubSpot Legacy Private App with API access
- A Circle.so API key
- Custom properties created in HubSpot (see [HUBSPOT_SETUP.md](HUBSPOT_SETUP.md))

### Installation

```bash
git clone <repo-url>
cd hubspot-circle-sync
npm install
cp .env.example .env
# Fill in all values in .env
```

### Development

```bash
npm run dev      # Start with nodemon (auto-restart)
npm start        # Start production server
npm run lint     # Run ESLint
```

---

## Environment Variables

| Variable                   | Required | Description                                  |
|----------------------------|----------|----------------------------------------------|
| `PORT`                     | Yes      | Server port (default: 3001)                  |
| `BASE_URL`                 | Yes      | Public URL of this service                   |
| `ADMIN_API_KEY`            | Yes      | API key for admin endpoints                  |
| `HUBSPOT_ACCESS_TOKEN`     | Yes      | HubSpot Private App bearer token             |
| `HUBSPOT_WEBHOOK_SECRET`   | Yes      | Secret for verifying HubSpot webhook signatures |
| `CIRCLE_API_KEY`           | Yes      | Circle.so API key                            |
| `CIRCLE_COMMUNITY_ID`     | Yes      | Circle.so community ID                       |
| `LOG_LEVEL`                | No       | Winston log level (default: `info`)          |
| `MAX_RETRY_ATTEMPTS`       | No       | Max retries for failed syncs (default: 3)    |
| `RETRY_INTERVAL_MINUTES`   | No       | Minutes between retry cycles (default: 30)   |

---

## API Endpoints

### Webhook Endpoints

| Method | Path                        | Auth           | Description                              |
|--------|-----------------------------|----------------|------------------------------------------|
| POST   | `/api/circle/create-member` | HubSpot HMAC   | Webhook receiver for member provisioning |

### Admin Endpoints

All admin endpoints require `Authorization: Bearer {ADMIN_API_KEY}` header.

| Method | Path                        | Description                                  |
|--------|-----------------------------|----------------------------------------------|
| POST   | `/api/circle/retry/:id`     | Manually retry a failed sync job             |
| GET    | `/api/circle/queue`         | View retry queue stats and pending jobs      |
| POST   | `/api/sync/engagement`      | Manually trigger engagement sync cycle       |
| GET    | `/api/sync/status`          | Health check for the sync system             |

### Health Check

| Method | Path      | Description     |
|--------|-----------|-----------------|
| GET    | `/health` | Server health   |

---

## HubSpot Workflow Setup

This middleware is designed to be called from an existing HubSpot Workflow. Insert a **"Send webhook"** action in the Approved branch:

```
Trigger: Deal enrolled
└─► Branch (Approved / Rejected / None met)
    ├─ Approved:
    │     2. Edit record (set approval status)
    │     ★ Send webhook → POST https://yourdomain.com/api/circle/create-member
    │     4. Set marketing contact status
    │     6. Add to static segment
    │     7. Edit record (circle_sync_status — fallback)
    │     8. Delay → 9. Send email → End
    ├─ Rejected: ...
    └─ None met: End
```

The webhook is inserted **after Step 2** (record is updated) and **before Step 4**. The middleware processes asynchronously and writes results back via the HubSpot API.

### Custom Properties

See [HUBSPOT_SETUP.md](HUBSPOT_SETUP.md) for the full list of custom properties to create in HubSpot.

---

## Project Structure

```
hubspot-circle-sync/
├── src/
│   ├── config/
│   │   └── index.js              # Env var validation and config
│   ├── middleware/
│   │   ├── webhookAuth.js        # HubSpot HMAC-SHA256 verification
│   │   └── adminAuth.js          # API key guard for admin endpoints
│   ├── routes/
│   │   ├── circle.routes.js      # /api/circle/* endpoints
│   │   └── sync.routes.js        # /api/sync/* endpoints
│   ├── services/
│   │   ├── circle.service.js     # Circle.so API calls
│   │   ├── hubspot.service.js    # HubSpot CRM API calls
│   │   └── engagement.service.js # Engagement sync orchestration
│   ├── utils/
│   │   ├── logger.js             # Winston structured logger
│   │   ├── retryQueue.js         # In-memory retry queue
│   │   └── fieldMapper.js        # HubSpot ↔ Circle field mapping
│   └── app.js                    # Express app setup
├── logs/                         # Log output (gitignored)
├── .env.example                  # Environment variable template
├── .gitignore
├── .eslintrc.json
├── HUBSPOT_SETUP.md              # HubSpot custom property setup guide
├── package.json
├── index.js                      # Entry point — server + cron
└── README.md
```

---

## Logging

Structured JSON logging via Winston:

- **Console**: Colorized in development, JSON in production
- **File**: `logs/error.log` (errors only), `logs/combined.log` (all levels)
- Every API call logs: timestamp, contactId, email, endpoint, statusCode, durationMs

---

## Production Deployment

Recommended setup with PM2 + Nginx:

```bash
# Install PM2
npm install -g pm2

# Start with PM2
pm2 start index.js --name hubspot-circle-sync

# Save PM2 process list
pm2 save

# Setup startup script
pm2 startup
```

Configure Nginx as a reverse proxy to forward requests to the Node.js process.
