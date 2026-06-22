# Application plugins — createPlatform()

How the server boots **core** + **Diamond Plate** + **Engineering** in one deployment. See also [APPS.md](./APPS.md) for ownership boundaries.

---

## Overview

```text
server/index.js
    └── createPlatform({ plugins: [diamondPlate, engineering] })
            ├── Core middleware + routes (auth, admin, settings, logs, …)
            ├── Plugin routes (per app)
            ├── Merged agent manifest → mountAgentManifest()
            └── Core MCP + plugin MCP → bootstrapBuiltinMcpServers()
```

| Plugin | Path | Agents | Routes | MCP |
|--------|------|--------|--------|-----|
| **Diamond Plate** | `server/apps/diamond-plate/` | `agentManifest.js` (26) | google-ads, dashboard, conversation, youtube, media-gen | google-ads, google-analytics, wordpress |
| **Engineering** | `server/apps/engineering/` | `agentManifest.js` (5) | demo, doc-extractor | — |
| **Core** (built-in) | `server/platform/createPlatform.js` | — | auth, admin, agents shell, settings, … | platform, knowledge-base, personal-memory, storage |

`server/agents/manifest.js` merges both app manifests for backward compatibility.

---

## Plugin contract

Each plugin exports:

```javascript
module.exports = {
  id: 'my-app',              // required string
  label: 'My App',           // optional display name
  agentManifest: [ /* … */ ], // optional — createAgentRoute entries
  mcpServers: [ /* … */ ],   // optional — stdio MCP definitions
  registerRoutes(app) {      // optional — mount Express routers
    app.use('/api/foo', require('../../routes/foo'));
  },
};
```

`createPlatform()` collects `agentManifest` and `mcpServers` from all plugins, registers core routes first, then calls each `registerRoutes`, then mounts `/api/agents`.

---

## Platform org (`PLATFORM_ORG_ID`)

Settings inheritance (models, embedding model, per-agent admin config) falls back to a **platform template org** when the current org has no value.

| Env var | Default | Purpose |
|---------|---------|---------|
| `PLATFORM_ORG_ID` | `1` | Org whose `system_settings` and `agent_configs` seed other orgs |

Used by: `AgentConfigService`, `embeddingResolver`, `SuggestionService` (via `server/config/platformOrg.js`).

Set on Railway if your seeded admin org is **not** id 1.

---

## MCP manifest split

| File | Servers |
|------|---------|
| `server/mcp-servers/manifest.core.js` | platform, knowledge-base, personal-memory, storage |
| `server/mcp-servers/manifest.diamond-plate.js` | google-ads, google-analytics, wordpress |
| `server/mcp-servers/manifest.js` | Merges both (legacy export) |

Skip all MCP bootstrap: `BOOTSTRAP_BUILTIN_MCP_SERVERS=false`.

---

## Client navigation split

| Shell | Users | Tool list source |
|-------|-------|------------------|
| **AppShell** | `org_type = internal` (Diamond Plate) | `client/src/config/tools.js` — Ads/CRM only |
| **DemoShell** | `org_type = demo` (e.g. Curam Engineering) | `/api/demo/manifest` + `DEMO_CATALOG` |

Engineering agents (`demo-*`, spec-validator) are **not** on the Diamond Plate sidebar. Routes like `/demo/run/demo-tender-response` still work when assigned via `org_agent_manifest`.

---

## Local dev — restart

**Terminal 1 — API:**

```bash
cd server
npm run dev
```

Expected log:

```text
Built-in MCP servers registered … "plugins":["diamond-plate","engineering"]
MCP_curamTools running on port 3002
```

**Terminal 2 — UI:**

```bash
cd client
npm run dev
```

Open http://localhost:5174/ — default seed login: `admin@example.com` / `changeme` (from `server/.env`).

---

## Verify after plugin changes

### Automated

```bash
npm run test:unit    # 45 tests — platformOrg, migrations, embeddings, cost guard
npm test             # unit + golden-path smoke
cd server && npm run migrate   # pending DB migrations only
```

### Manual smoke

| Check | Expected |
|-------|----------|
| http://localhost:5174/ | 200 |
| Login | Token issued |
| Diamond Plate sidebar | No Spec Validator / Tender / demo-document-analyzer |
| Demo org → `/demo/dashboard` | Engineering agents in sidebar |
| `GET /api/demo/manifest` (auth) | Array of enabled demo agents |
| Server log on boot | `plugins: ["diamond-plate","engineering"]`, `serverCount: 7` |

---

## Adding a new app plugin (future)

1. Create `server/apps/<name>/agentManifest.js` and `plugin.js`.
2. Register in `createPlatform.js` `DEFAULT_PLUGINS` (or pass custom `plugins` array).
3. Add UI routes under `client/src/` and document in [APPS.md](./APPS.md).
4. Do **not** edit `server/agents/manifest.js` directly — it re-exports merged app manifests.

---

## Related

| Doc | Topic |
|-----|-------|
| [APPS.md](./APPS.md) | What belongs in core vs each app |
| [MIGRATIONS.md](./MIGRATIONS.md) | Schema versioning |
| [MCP_SERVERS.md](./MCP_SERVERS.md) | MCP tool reference |
| `../core/TESTING.md` | Full test guide |
