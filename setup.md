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

- Node.js 18+
- PostgreSQL database (project uses Railway — connection string in `server/.env`)
- Anthropic API key

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

### Schema errors on startup
`initSchema()` is fully idempotent (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`). Safe to restart at any time.

---

## First Login

Seeded from env on first startup:
- Email: value of `ADMIN_EMAIL`
- Password: value of `ADMIN_PASSWORD`

Log in at `http://localhost:5174/login`.
