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
| `PLATFORM_ORG_ID` | `1` (default) — set if platform template org is not id 1 |

**Do not set `PORT`** — Railway manages this.

Boot log should show `plugins: ["diamond-plate","engineering"]`. See `knowledge_base/architecture/PLUGINS.md`.

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

Schema changes use a **two-layer** model (full guide: `knowledge_base/architecture/MIGRATIONS.md`):

| Layer | Location | When it runs |
|-------|----------|--------------|
| **Baseline** | `server/db.js` → `initSchema()` | Every boot — `CREATE TABLE IF NOT EXISTS`, extensions, indexes |
| **Versioned migrations** | `server/migrations/` | Every boot after baseline — pending rows in `schema_migrations` |

**Adding a change:** create `server/migrations/NNN_name.js`, register in `server/migrations/index.js`, test locally, deploy. Never reorder or edit migrations already applied in production.

**Manual apply (optional):**

```bash
cd server && npm run migrate
```

Applied migrations are listed in the **`schema_migrations`** table (`id`, `name`, `applied_at`).

Current migrations: `001_platform_schema_patches`, `002_embedding_vector_dimensions`, `003_system_settings_data_patches`.

**Rollback:** redeploy previous Railway image; database state may already include forward migrations — restore from Postgres backup for destructive changes.

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

Database schema changes are versioned in `schema_migrations`. Rolling back **code** does not undo applied migrations — restore Postgres from backup if a migration was destructive.
