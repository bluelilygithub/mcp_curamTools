# Starter app — minimal plugin on core

Reference implementation for a new product app. **Not loaded in production** unless you opt in.

## What it includes

| Piece | File | Endpoint |
|-------|------|----------|
| Plugin | `plugin.js` | Boot registration |
| Agent | `agents/hello/index.js` | `POST /api/agents/starter-hello/run` |
| API route | `routes.js` | `GET /api/starter/health` |
| Manifest | `agentManifest.js` | Uses `appModule` (agent lives in this folder) |

No MCP servers, no cron, no client routes (add those when you build a real app).

## Enable locally

In `server/.env`:

```bash
EXTRA_PLUGINS=starter
```

Restart the server. Boot log should include `"starter"` in the plugins array.

## Smoke

```bash
# Health (needs auth token)
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3002/api/starter/health

# Agent run
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"message":"test"}' http://localhost:3002/api/agents/starter-hello/run
```

## Copy to a new app

```bash
cp -r server/apps/starter server/apps/my-app
```

Then:

1. Edit `plugin.js` — set `id` and `label` to `my-app`.
2. Rename agent slug in `agentManifest.js` and `agents/hello/` as needed.
3. Load with `EXTRA_PLUGINS=my-app` or add to `PLATFORM_PLUGINS`.
4. Document ownership in `knowledge_base/architecture/APPS.md`.
5. Add client routes in `App.jsx` + `tools.js` (until client plugin API exists).

See `knowledge_base/architecture/PLUGIN_API.md`.
