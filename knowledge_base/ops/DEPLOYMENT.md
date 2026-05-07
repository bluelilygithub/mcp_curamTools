# Deployment Guide

**Project Context:** Internal learning project for one organisation, solo developer. See [PROJECT_IDENTITY.md](../core/PROJECT_IDENTITY.md).

---

## Railway Deployment

### Build Configuration
In Railway dashboard → service settings:
- **Root Directory**: `/` (project root — not `/server`)
- **Builder**: `Dockerfile`

### Environment Variables
Set in Railway dashboard → service → Variables:

| Variable | Value |
|---|---|
| `APP_URL` | `https://mcpcuramtools-production.up.railway.app` |
| `DATABASE_URL` | Railway Postgres connection string |
| `ANTHROPIC_API_KEY` | Your Anthropic key |
| `MAIL_CHANNEL_API_KEY` | MailChannels key |
| `SEED_ADMIN_EMAIL` | Initial admin email |
| `SEED_ADMIN_PASSWORD` | Initial admin password |
| `ORG_NAME` | `Blue Lily` |

**Do not set `PORT`** — Railway manages this.

### Redeploy
```bash
git push
```
Railway auto-deploys from the `main` branch.

---

## Dockerfile

The project uses a two-stage Docker build:

**Stage 1 — Build client:**
- `FROM node:18-alpine AS client-builder`
- `WORKDIR /app/client`
- Copy `client/package*.json`, `npm ci`, copy rest, `npm run build`
- Output: `client/dist/`

**Stage 2 — Server:**
- `FROM node:18-alpine`
- `WORKDIR /app/server`
- Copy `server/package*.json`, `npm ci --omit=dev`
- Copy server source + `client/dist/` from stage 1
- `EXPOSE ${PORT}` (Railway injects PORT)
- `CMD ["node", "index.js"]`

---

## Database Migrations

All schema changes are idempotent and run on server startup in `server/db.js`:

```js
// Pattern for adding columns:
await pool.query(`ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...`);

// Pattern for adding constraints:
await pool.query(`ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...`);
await pool.query(`ALTER TABLE ... ADD CONSTRAINT ...`);
```

No migration tool (Knex, Sequelize) is used. Schema changes are applied automatically on deploy.

---

## Monitoring

### Health Check
`GET /api/health` — returns `{ status: 'ok', timestamp }`. Used by Railway for health checks.

### Admin Diagnostics
`/admin/diagnostics` — live probes against:
- Google OAuth token refresh
- Google Ads API (minimal GAQL query)
- GA4 (minimal report)

### Logs
- Server logs: Railway dashboard → service → Logs
- Agent run history: Admin → Agent Runs
- Usage logs: `usage_logs` table (token counts, costs per run)

---

## Backup

PostgreSQL backups are managed by Railway (automatic daily backups). No additional backup configuration is needed.

---

## Rollback

To rollback to a previous deployment:
1. Railway dashboard → service → Deployments
2. Find the working deployment
3. Click "Redeploy"

Database schema changes are idempotent — rolling back code won't break the schema.
