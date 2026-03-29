# MCP CuramTools — Setup Guide

## Port Architecture

| Service | Port | Notes |
|---|---|---|
| Express API server | **3002** | `server/.env` → `PORT=3002` |
| Vite dev server | **5174** | `client/vite.config.js` → `port: 5174` |
| Vite proxy target | **3002** | `client/vite.config.js` → proxy `/api` → `http://localhost:3002` |

**Critical:** These three values must be consistent. If the Express server is not on 3002, every API call from the Vite dev server will fail (502 Bad Gateway or a 500 from the wrong process).

---

## Prerequisites

- **Node.js 18+** — required for native `fetch` (used in model test route and MailChannels). Earlier versions will fail silently or throw on `fetch is not defined`.
- **PostgreSQL with pgvector** — the schema runs `CREATE EXTENSION IF NOT EXISTS vector` on startup. Railway supports this out of the box. A local PostgreSQL instance requires pgvector installed separately. Startup will fail with `extension "vector" is not available` if missing.
- **Anthropic API key** — required for all AI features and the admin model test. Missing key causes a clear `ANTHROPIC_API_KEY is not set` error on test; other routes silently produce no output.

---

## Installation

### 1. Server

```bash
cd server
npm install
```

The `.env` file is already configured. Do not copy from `.env.example` — the actual `.env` has the real credentials and correct port values.

### 2. Client

```bash
cd client
npm install
```

No `.env` needed for the client — Vite proxies all `/api` calls to the Express server at port 3002.

---

## Running Locally

Open two terminals:

**Terminal 1 — Server:**
```bash
cd server
node index.js
```

Expected output:
```
[db] Schema initialised
[db] Admin seeded: <email> (org: <org name>)
[server] MCP_curamTools running on port 3002
```

**Terminal 2 — Client:**
```bash
cd client
npm run dev
```

Expected output:
```
  VITE v5.x.x  ready in xxx ms
  ➜  Local:   http://localhost:5174/
```

Open `http://localhost:5174` in the browser.

---

## Railway Deployment

The `PORT` variable is injected automatically by Railway — do not set it in Railway's environment variables. The `PORT=3002` in the local `.env` is for local development only.

**Required Railway environment variables** (set in Railway dashboard → service → Variables):

| Variable | Value |
|---|---|
| `APP_URL` | `https://mcpcuramtools-production.up.railway.app` |
| `DATABASE_URL` | Railway Postgres connection string (auto-injected if using Railway Postgres) |
| `ANTHROPIC_API_KEY` | Your Anthropic key |
| `MAIL_CHANNEL_API_KEY` | MailChannels key |
| `MAIL_FROM_EMAIL` | `noreply@bluelily.com.au` |
| `SEED_ADMIN_EMAIL` | Initial admin email |
| `SEED_ADMIN_PASSWORD` | Initial admin password |
| `ORG_NAME` | `Blue Lily` |

**Do not set `PORT`** — Railway manages this. Setting it causes port binding conflicts.

### Railway build configuration
In Railway dashboard → service settings, confirm:
- **Root Directory**: `/` (project root — not `/server`)
- **Builder**: `Dockerfile`

If Root Directory is set to `/server`, Railway uses Nixpacks on the server only — the React client is never built and `server/public/` will be empty. Every asset request will return a 500 JSON error because Express falls through to its error handler. The Dockerfile at the project root handles the full two-stage build automatically.

**`APP_URL` must match the deployed domain exactly** — it is used for CORS and for building invite/reset email links. If the Railway domain changes, update this variable and redeploy.

---

## Key Environment Variables (server/.env)

| Variable | Correct Value | Common Mistake |
|---|---|---|
| `PORT` | `3002` | Setting to `3001` breaks all API calls from Vite |
| `APP_URL` | `http://localhost:5174` | Wrong port breaks invite/reset email links |
| `GOOGLE_REDIRECT_URI` | `http://localhost:3002/api/gmail/callback` | Must use port 3002, not 3001 |

---

## Common Issues

### 500 on API calls
The Express server is not running on port 3002, or a different process on port 3002 is responding. Check:
```
[server] MCP_curamTools running on port 3002
```
If missing, check `server/.env` → `PORT=3002`.

### 502 Bad Gateway
Vite can't reach the API server. Confirm the server is running and on port 3002.

### Invite email not received locally (expected)
Invitation emails contain `http://localhost:5174/invite/...` as the activation link. Mail servers reject emails with `localhost` URLs as a spam signal — this is why delivery works on Railway (real domain) but not in local development.

**Local workaround:** the activation URL is always printed to the server terminal:
```
[InvitationService] Activation URL for user@example.com: http://localhost:5174/invite/abc123...
```
Open that URL directly in the browser. Email delivery for invitations only works in production.

### Password reset emails not received locally (expected)
Same cause as invite emails — reset links contain `http://localhost:5174/reset-password/...` which mail servers reject. In local development, trigger a reset and copy the link from the server terminal log.

### pgvector extension missing
If startup logs `extension "vector" is not available`, the PostgreSQL instance doesn't have pgvector installed. On Railway this is pre-installed. For local PostgreSQL, install pgvector for your PostgreSQL version before starting.

### No admin user created on startup
`seedAdminUser()` only runs if both `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` are set in `.env`. If either is missing, startup completes but no login is possible. Check both values are present.

### Org name change creates a new org
`ORG_NAME` in `.env` is used to seed the organisation on first startup via `INSERT ... ON CONFLICT DO NOTHING`. Changing `ORG_NAME` after first run creates a second org — it does not rename the existing one. Don't change this value after the first startup.

### Google credentials in .env
The `.env` contains Google OAuth credentials (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, etc.) carried over from ToolsForge. These are not wired to any routes yet in this project. They are safe to leave in place but have no effect until Google integrations are built.

### Schema errors on startup
`initSchema()` is fully idempotent (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`). Safe to restart at any time.

---

## First Login

Seeded from env on first startup:
- Email: value of `SEED_ADMIN_EMAIL`
- Password: value of `SEED_ADMIN_PASSWORD`

Log in at `http://localhost:5174/login`.
