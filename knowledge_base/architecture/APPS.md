# Application boundaries — Core, Diamond Plate, Engineering

**Status:** Phase 0 — logical split documented; code still lives in one repo and one deploy.

This file is the **inventory and placement rules** for the three-block model. Use it before adding agents, routes, tables, or UI so new work lands in the right bucket.

---

## The four names (do not conflate)

| Name | Role |
|------|------|
| **Core** | Reusable platform — any future app can depend on it |
| **Diamond Plate** | Customer app — marketing, Google Ads, GA4, WordPress CRM for Diamond Plate Australia |
| **Engineering** | Customer app — AEC/demo vertical (specs, tenders, document analysis) for demo client orgs |
| **Blue Lily** | **Operator** — builds and maintains the repo; not a fourth product app |

`PROJECT_IDENTITY.md` historically said “single organisation (Blue Lily)”. In practice the **primary production app is Diamond Plate** (`org_type = internal`). Blue Lily is the studio behind the platform.

---

## Architecture (logical)

```text
                    ┌─────────────────────────────────────┐
                    │              CORE                    │
                    │  auth, orgs, agents runtime, MCP host │
                    │  models, memory, RAG, audit, admin   │
                    └──────────────┬──────────────────────┘
                                   │
              ┌────────────────────┴────────────────────┐
              │                                         │
    ┌─────────▼──────────┐                 ┌──────────▼─────────┐
    │   DIAMOND PLATE    │                 │    ENGINEERING      │
    │  Ads / CRM / GA4   │                 │  demoSuite, specs   │
    │  internal org      │                 │  demo orgs          │
    └────────────────────┘                 └────────────────────┘
```

**Today:** one Railway service, one Postgres database, one React SPA. Boundaries are implemented as **plugins** under `server/apps/` + `createPlatform()` — not separate npm packages yet.

| Mechanism | Location |
|-----------|----------|
| Platform org config | `PLATFORM_ORG_ID` env → `server/config/platformOrg.js` |
| MCP split | `manifest.core.js` + `manifest.diamond-plate.js` |
| App plugins | `server/apps/diamond-plate/plugin.js`, `server/apps/engineering/plugin.js` |
| Bootstrap | `server/platform/createPlatform.js` |
| Diamond Plate sidebar | `client/src/config/tools.js` (engineering tools removed) |
| Engineering navigation | `DemoShell` → `/api/demo/manifest` |
| Org admin | `/admin/organizations` — `org_type` (app shell) + `description` (operator purpose notes) |
| Cross-org users | Platform operator (`PLATFORM_ORG_ID` admin) sees all users on `/admin/users` |
| Plugin API | Server v0 in `createPlatform`; client + unified manifests — see `architecture/PLUGIN_API.md` |

**Target (future):** physical `packages/core` + `apps/*` folders with semver.

---

## Core block

### Purpose

Run multi-tenant AI agents with MCP tools, configurable models, memory, audit, and admin — without domain-specific business logic.

### Server — platform (`server/platform/`)

| Module | Role |
|--------|------|
| `createAgentRoute.js` | SSE agent runs, budgets, lessons write-back, RAG indexing |
| `AgentOrchestrator.js` | ReAct loop |
| `AgentScheduler.js` | Cron agents |
| `mcpRegistry.js`, `mcpTools.js`, `mcpServer.js` | MCP stdio/SSE transport, trusted context |
| `AgentConfigService.js` | **Core mechanism**; `ADMIN_DEFAULTS` content is app-owned |
| `persistRun.js`, `TransactionLogger.js` | Run + audit persistence |
| `CostGuardService`, `UsageLogger` | Spend controls |
| `providerRegistry.js`, `promptVersions.js` | LLM providers |
| `inputGuards.js`, `validateToolData.js` | Cross-cutting safety |
| `bootstrapBuiltinMcpServers.js` | **Core mechanism**; which servers to bootstrap is app config |

**Grey (core pattern, app content):** `agentTrustContract.js`, `ReportDependencyService.js` — Diamond Plate report chains today.

### Server — generic services (`server/services/`)

| Service | Core? |
|---------|-------|
| `PermissionService`, `InvitationService` | Yes |
| `EmbeddingService`, `embeddingResolver`, `embeddingProviders` | Yes |
| `PersonalMemoryService`, `SuggestionService` | Yes |
| `LessonRepositoryService` | Yes (optional module) |
| `FileIntakeService`, `ExtractionValidationService` | Yes — doc pipeline primitives |
| `StorageService`, `EmailService`, `EmailTemplateService` | Yes |
| `UsageLogger`, `CostGuardService` | Yes |
| `GoogleAdsService`, `GoogleAnalyticsService` | **Diamond Plate** |

### Server — generic MCP (`server/mcp-servers/`)

| Server | Owner |
|--------|-------|
| `platform.js` | Core |
| `knowledge-base.js` | Core |
| `personal-memory.js` | Core |
| `storage.js` | Core (optional S3) |
| `google-ads.js`, `google-analytics.js`, `wordpress.js` | **Diamond Plate** |

### Server — generic API routes

| Route | Core? |
|-------|-------|
| `auth`, `settings`, `admin` (users, orgs, models, MCP, logs) | Yes |
| `agents`, `agent-configs`, `lessons`, `logs`, `export`, `export-log` | Yes |
| `personal-memory`, `suggestions`, `admin/knowledge`, `mcp` | Yes |
| `google-ads`, `dashboard`, `conversation`, `youtube` | **Diamond Plate** |
| `doc-extractor`, `media-gen`, `demo` | **Split** — see Engineering + shared utilities below |

### Server — database (core tables)

`organizations`, `users`, `auth_sessions`, `user_roles`, `system_settings`, `agent_configs`, `agent_runs`, `agent_lessons`, `usage_logs`, `mcp_servers`, `mcp_resources`, `resource_permissions`, `embeddings`, `personal_thoughts`, `user_suggestions`, `transaction_logs`, `agent_event_logs`, `agent_field_declarations`, `app_logs`, `export_logs`, `schema_migrations`, `departments`, `org_roles`, `prompt_flags`, `sql_audit_logs`, `email_templates`, `org_agent_manifest` (manifest mechanism is core; rows are per-app)

Migrations: `server/migrations/` — core ledger; app-specific migrations TBD.

### Client — core UI

| Area | Path |
|------|------|
| Login, settings, suggestions | `pages/LoginPage`, `SettingsPage`, `SuggestionsPage` |
| Admin shell (most pages) | `pages/admin/*` |
| Audit logs | `pages/logs/*` |
| Guards, stores, API client | `guards/`, `stores/`, `api/` |
| Shared components | `MicButton`, `MarkdownRenderer`, settings tabs |
| Layout branching | `OrgShell` (mechanism core; which shell per org is app) |

### Client — core shell only

`AppShell` — internal Diamond Plate navigation (today). `DemoShell` — Engineering demo navigation (today).

---

## Diamond Plate app

### Purpose

AI tools for **Diamond Plate Australia** — paid search, analytics, CRM, and operational reporting. Users on `org_type = internal` (Diamond Plate staff).

### Agents (`server/agents/manifest.js`)

All slugs except the Engineering block at the bottom of the manifest:

| Group | Slugs |
|-------|-------|
| Google Ads | `google-ads-monitor`, `google-ads-freeform`, `google-ads-change-impact`, `google-ads-change-audit`, `ads-bounce-analysis`, `auction-insights`, `competitor-keyword-intel`, `google-ads-strategic-review`, `keyword-opportunity`, `ads-copy-gate`, `ads-copy-playbook`, `ads-setup-architect`, `ads-copy-diagnostic`, `ads-attribution-summary` |
| Analytics + CRM | `wp-theme-extractor`, `diamondplate-data`, `search-term-intelligence`, `daypart-intelligence`, `cost-per-booked-job`, `lead-velocity`, `ai-visibility-monitor`, `not-interested-report`, `geo-heatmap`, `high-intent-advisor` |
| Ops | `nightly-cost-alert` |
| Investigation | `anomaly-investigator` (Ads + GA4 + CRM — Diamond Plate until MCP adapters are swappable) |

Module roots: `server/agents/googleAds*`, `profitabilitySuite/`, `diamondplateData/`, `highIntentAdvisor/`, etc.

### Routes

`server/routes/googleAds.js`, `dashboard.js`, `conversation.js`, `youtube.js`

### Database (app tables)

`google_ads_customers`, `campaign_agent_assignments`, `agent_conversations`, `ai_visibility_prompts`, `agent_suggestions` (High Intent Advisor), `geocode_cache`, `youtube_search_history`, `youtube_favourites`

### Client

| Area | Path |
|------|------|
| Tool registry | `client/src/config/tools.js` — Ads, CRM, WordPress groups |
| Tool pages | `client/src/pages/tools/*` (except engineering-only — see below) |
| Shell | `AppShell`, `Sidebar` |

### Environment variables (representative)

`GOOGLE_*`, `GOOGLE_ADS_*`, `GOOGLE_GA4_PROPERTY_ID`, `WP_DB_*`, `YOUTUBE_API_KEY`

### Platform config owned by this app

- `ADMIN_DEFAULTS` entries for all Diamond Plate agent slugs
- `AGENT_TRUST_CONTRACTS` (Ads copy diagnostic → playbook → gate chain)
- `BUILTIN_MCP_SERVERS` entries: `google-ads`, `google-analytics`, `wordpress`
- `ads_operator` role semantics
- Knowledge base content biased to Diamond Plate brand

---

## Engineering app

### Purpose

Document and compliance agents for **engineering firms** — sold or demoed via `org_type = demo` orgs (e.g. Curam Engineering). Uses **DemoShell** and `org_agent_manifest` for per-client assignment.

### Agents

| Slug | Module | Notes |
|------|--------|-------|
| `demo-document-analyzer` | `demoSuite/documentAnalyzer` | Engineering doc extraction |
| `demo-spec-validator` | `specValidator/index` | Demo slug |
| `spec-validator` | `specValidator/index` | **Dual-slug** — same code, internal QA entry |
| `demo-spec-anomaly-investigator` | `demoSpecAnomalyInvestigator` | Investigation on specs |
| `demo-tender-response` | `demoSuite/tenderResponse` | RFT / evidence pack |

Catalog: `server/demo/demoCatalog.js` (`DEMO_CATALOG`).

### Routes

`server/routes/demo.js` — tender review PATCH, demo follow-up Q&A

### Database (app tables)

`doc_extraction_runs` — shared with `doc-extractor` utility (see split note below)

### Client

| Area | Path |
|------|------|
| Demo pages | `client/src/pages/demo/*` |
| Shell | `DemoShell`, `DemoSidebar` |
| Routes | `/demo/*` in `App.jsx` |

Demo agents may also appear in `tools.js` for **internal** users during development — that is **leakage** between apps; prefer demo org only for client-facing engineering tools.

### Environment variables

`AWS_S3_*` (evidence packs, tender files) when storage is used; otherwise core model keys only.

### Platform config owned by this app

- `DEMO_CATALOG` entries and labels
- `ADMIN_DEFAULTS` for `demo-*` and `spec-validator` slugs
- Per-demo `org_agent_manifest` rows (SQL/admin — not in git)
- Engineering prompts in `demoSuite/`, `specValidator/`

---

## Shared / split pieces (decide explicitly)

| Piece | Default owner | Notes |
|-------|---------------|-------|
| `doc-extractor` agent + route | **Core primitive** or Engineering | Internal utility page; used by engineering pipeline |
| `doc_extraction_runs` table | Engineering (or core doc module) | Both BL internal tool and engineering agents |
| `media-gen` | **Diamond Plate** plugin route | Registered in `apps/diamond-plate/plugin.js` |
| `FileIntakeService`, `ExtractionValidationService` | Core | Apps use, do not fork |
| Lessons repository | Core mechanism | App-specific lesson *content* |
| Platform settings fallback | **Operator** | `PLATFORM_ORG_ID` env (default `1`) via `server/config/platformOrg.js` |

---

## Placement rules (Phase 0 discipline)

Before adding code, ask:

1. **Would another app need this without Diamond Plate or Engineering?** → **Core**
2. **Does it mention Google Ads, GA4, WordPress CRM, or Diamond Plate brand?** → **Diamond Plate**
3. **Is it for demo engineering clients (`demo-*`, `demoSuite`, tender/spec)?** → **Engineering**
4. **Is it operator-only (platform seed, global model catalogue)?** → Document as **Operator**; avoid hardcoding as Diamond Plate business logic

### Do

- Add new Diamond Plate agents under `server/agents/`; register in `server/apps/diamond-plate/agentManifest.js`
- Add new Engineering agents under `server/agents/demoSuite/` or `specValidator/`; register in `server/apps/engineering/agentManifest.js` + `DEMO_CATALOG`
- Add core tables only when **both** apps need them
- Reference this file in PR/commit descriptions when touching boundaries

### Do not

- Add Diamond Plate prompts to core platform files without marking app ownership
- Bootstrap Google MCP on engineering-only deploys without need (`BOOTSTRAP_BUILTIN_MCP_SERVERS=false`)
- Put engineering demo tools back on `client/src/config/tools.js` (Diamond Plate sidebar)

See [PLUGINS.md](./PLUGINS.md) for `createPlatform()` and plugin contract.

---

## Current vs target layout

```text
TODAY                          TARGET (future)
─────                          ───────────────
curam-mcptools/                curam-mcptools/
├── server/platform/           ├── packages/core/
├── server/agents/  (all)       │   └── platform, auth, generic MCP, migrations
├── server/mcp-servers/        ├── apps/diamond-plate/
├── client/ (monolith)           │   ├── agents/, routes/, client/tools/
└── knowledge_base/              ├── apps/engineering/
                               │   ├── demoSuite/, demo/, client/demo/
                               └── knowledge_base/
```

---

## Related docs

| Topic | File |
|-------|------|
| Platform primitives | `architecture/PLATFORM_PRIMITIVES.md` |
| Database migrations | `architecture/MIGRATIONS.md` |
| Demo layer decisions | `decisions/DECISIONS.md` — Demo layer, Curam Engineering |
| Project scope | `core/PROJECT_IDENTITY.md` |
| Agent catalogue | `agents/AGENTS_INDEX.md` |

---

## Changelog

| Date | Change |
|------|--------|
| 2026-06-18 | Initial three-block manifest (Core, Diamond Plate, Engineering); Blue Lily documented as operator |
