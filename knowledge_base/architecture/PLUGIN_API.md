# Plugin API — agents, MCP, and UI routes

**Status:** Server plugin **v0** shipped (`createPlatform`); client plugin API **not started**.

Companion: [PLUGINS.md](./PLUGINS.md) (boot, smoke checks) · [APPS.md](./APPS.md) (ownership boundaries).

---

## Goal

Compose **Core** + **product apps** (Diamond Plate, Engineering) in one deploy. Each app registers three surfaces:

| Surface | Registers | Consumed by |
|---------|-----------|-------------|
| **Agents** | `/api/agents/:slug`, schedules, permissions | `createAgentRoute`, `AgentScheduler` |
| **MCP** | Stdio MCP server definitions | `bootstrapBuiltinMcpServers`, `MCPRegistry` |
| **UI** | React routes + sidebar/nav | `App.jsx`, `tools.js`, `DemoShell` |

```text
                    ┌──────────────── CORE ────────────────┐
                    │ auth, orgs, agent runtime, MCP host  │
                    │ memory, models, admin, migrations    │
                    └─────────────────┬──────────────────┘
                                      │
              ┌───────────────────────┴───────────────────────┐
              ▼                                               ▼
    ┌─────────────────────┐                     ┌─────────────────────┐
    │   DIAMOND PLATE     │                     │    ENGINEERING      │
    │ agents + MCP + API  │                     │ agents + API + demo │
    │ + UI tools/routes   │                     │ + DemoShell UI      │
    └─────────────────────┘                     └─────────────────────┘
```

---

## Server plugin v0 (implemented)

`server/platform/createPlatform.js` merges plugins at boot:

1. Core middleware + routes (auth, admin, settings, …)
2. Each plugin `registerRoutes(app)`
3. Merged `agentManifest` → `mountAgentManifest()` → `/api/agents`
4. Core MCP + plugin `mcpServers` → `bootstrapBuiltinMcpServers()`

### Contract today

```javascript
// server/apps/<app>/plugin.js
module.exports = {
  id: 'my-app',              // required
  label: 'My App',           // optional
  agentManifest: [ /* … */ ], // optional — see agentManifest.js
  mcpServers: [ /* … */ ],   // optional — stdio MCP defs
  registerRoutes(app) {      // optional — Express routers
    app.use('/api/foo', require('../../routes/foo'));
  },
};
```

### Agent manifest entry

```javascript
{
  slug:       'google-ads-monitor',
  module:     'googleAdsMonitor',      // under server/agents/
  export:     'runGoogleAdsMonitor',
  permission: 'ads_operator',
  schedule:   '0 6,18 * * *',          // optional cron
  rateLimit:  3,                       // optional
}
```

| App | Plugin path | Agents | MCP | API routes |
|-----|-------------|--------|-----|------------|
| Diamond Plate | `server/apps/diamond-plate/` | 26 | google-ads, GA4, WordPress | google-ads, dashboard, conversation, youtube, media-gen |
| Engineering | `server/apps/engineering/` | 5 | — | demo, doc-extractor |
| Core | `createPlatform.js` | — | platform, knowledge-base, personal-memory, storage | auth, admin, agents shell, settings, … |

Legacy merge: `server/agents/manifest.js` re-exports both app manifests.

---

## Runtime flow

```text
USER LOGIN
    │
    ▼
org_type ──► OrgShell ──► AppShell (internal) | DemoShell (demo)
    │                           │
    │                           ▼
    │                    UI nav (tools.js | /api/demo/manifest)  ← not plugin-driven yet
    │
    ▼
User opens page or runs agent
    │
    ├──► React route (App.jsx) ──► page calls /api/...
    ├──► POST /api/agents/:slug ──► createAgentRoute ──► MCPRegistry (plugin MCP)
    └──► /api/google-ads/... ──► plugin registerRoutes()
```

**Agents** = ReAct runtime + tools. **MCP** = tool servers. **UI routes** = human pages (may not invoke agents). Related but not 1:1.

---

## Gaps (not on plugin API yet)

### 1. Client routes and navigation

`client/src/App.jsx` hardcodes every page route. Diamond Plate sidebar is `client/src/config/tools.js`. Engineering uses `DEMO_CATALOG` + `org_agent_manifest` + `DemoSidebar`.

Adding an agent today typically touches **6 places**; only **2** are plugin-adjacent (server `agentManifest` + `plugin.js` routes).

### 2. Agent code location

Manifests live under `server/apps/*/`; implementations remain in `server/agents/`. Plugins are registries, not packages.

### 3. Split manifests (Engineering)

| Layer | Registry |
|-------|----------|
| Server agents | `apps/engineering/agentManifest.js` |
| Demo catalog metadata | `server/demo/demoCatalog.js` |
| Per-org enablement | `org_agent_manifest` (DB) |

Target: one manifest drives server + demo sidebar.

### 4. No deploy-time plugin selection

`DEFAULT_PLUGINS` is hardcoded in `createPlatform.js`. Env-driven `PLUGINS=diamond-plate|engineering` is future work (today: `BOOTSTRAP_BUILTIN_MCP_SERVERS=false` only skips MCP).

### 5. Core agent extensions

`server/routes/agents.js` still holds bespoke sub-routes (suggestions, spec review, etc.) outside the manifest loop.

---

## Target plugin API

### Server (extend v0)

```javascript
module.exports = {
  id: 'my-app',
  label: 'My App',
  orgTypes: ['internal'],              // future: shell eligibility

  agentManifest: require('./agentManifest'),
  mcpServers: require('./mcpManifest'),

  registerRoutes(app) { /* Express */ },
  registerAgentExtensions(agentsRouter) { /* bespoke /:slug/* routes */ },
  onBoot({ pool, logger }) { /* optional seeds */ },
};
```

### Client (not started)

```javascript
// target: client/apps/my-app/plugin.js
export default {
  id: 'my-app',
  shell: 'AppShell',                   // or 'DemoShell'

  routes: [
    { path: '/tools/foo', component: lazy(() => import('./pages/Foo')) },
  ],

  nav: {
    AppShell: [ /* sidebar entries */ ],
    DemoShell: 'manifest',             // or inline agent cards
  },
};
```

`App.jsx` would merge `plugins.flatMap(p => p.routes)` instead of manual imports.

### Unified demo metadata

```text
plugin.agentManifest (code)
  → filtered by org_agent_manifest (DB)
  → GET /api/demo/manifest
  → DemoSidebar (no separate DEMO_CATALOG drift)
```

---

## Adding a feature today

### Diamond Plate agent

1. `server/agents/<name>/` — run function
2. `server/apps/diamond-plate/agentManifest.js` — entry
3. `client/src/pages/tools/` — page
4. `client/src/App.jsx` — route
5. `client/src/config/tools.js` — sidebar card
6. Optional: MCP in `mcp-servers/manifest.diamond-plate.js`

### Engineering demo agent

Same as above, plus:

7. `server/demo/demoCatalog.js`
8. `org_agent_manifest` row for client org
9. `/demo/run/:slug` in `App.jsx`

**Do not** edit `server/agents/manifest.js` directly — it re-exports app manifests.

---

## Recommended build order

| Phase | Work | Status |
|-------|------|--------|
| 0 | Document boundaries ([APPS.md](./APPS.md)) | Done |
| 1 | `createPlatform`, app manifests, MCP split | Done |
| 2 | Client plugin registry (routes + nav) | **Next** |
| 3 | Unify demo catalog with engineering manifest | Planned |
| 4 | `PLUGINS` env / conditional deploy | Planned |
| 5 | Physical `packages/core` + `apps/*` split | Deferred |

---

## Related

| Doc | Topic |
|-----|-------|
| [PLUGINS.md](./PLUGINS.md) | Boot, smoke, `PLATFORM_ORG_ID` |
| [APPS.md](./APPS.md) | Core vs Diamond Plate vs Engineering |
| [MCP_SERVERS.md](./MCP_SERVERS.md) | MCP tool reference |
| `server/platform/createPlatform.js` | Implementation |
