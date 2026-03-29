# MCP CuramTools — Claude Prompts Reference

This file records the prompts used to set up and develop the MCP CuramTools project. Each prompt is dated and labeled with its purpose.

---

## Initial Project Setup Prompt

**Date**: 2026-03-29  
**Purpose**: Platform scaffold initialization — backend structure, database schema, frontend structure, architectural decisions  
**Context**: First session after completing Vault (single-user) and ToolsForge (multi-tenant) projects

### Prompt Text

```
You are starting a new project called MCP_curamTools.
Before writing any code, read every .md file in the project directory. These are your specification. They take precedence over your defaults, your assumptions, and any patterns you have seen elsewhere. Do not proceed past this reading step until you have processed all of them.
The files that matter most in order:

DECISIONS.md — settled architectural decisions; never deviate from these without flagging it explicitly
README__--_very_important.md — Curam Vault feature inventory; understand what was built before
LEARNINGS--very_important.md — Curam Vault technical patterns; the lessons that survived production
TOOLSFORGE_README.md — ToolsForge platform inventory; the multi-tenant evolution
Learnings-ToolsForge.md — ToolsForge technical patterns; the most recent lessons
PLATFORM-PRIMITIVES.md — the platform-level abstractions; understand what is a primitive vs what is agent-specific
SECTION-1-VISUALS.md through SECTION-6-DECISIONS.md and SECTION-ANNOTATION.md — the complete UI specification; build every frontend component to this spec exactly


What you are building:
MCP_curamTools is a multi-tenant AI agent platform built on the Model Context Protocol. It is the architectural successor to ToolsForge. It inherits ToolsForge's platform decisions but replaces the AgentOrchestrator ReAct loop with a proper MCP server/client architecture.
Stack:

Node.js / Express backend
React / Vite frontend
PostgreSQL 15 + pgvector
Anthropic Claude (primary)
MCP transport: HTTP/SSE
Deployment target: Railway (Docker)


What you are building in this session — platform scaffold only:
Do not build any agent yet. Build the platform that agents will slot into.
Backend structure to create:
server/
  index.js                          — Express app entry, helmet, CORS, middleware mount
  db.js                             — PostgreSQL pool, idempotent schema init (ALTER TABLE ADD COLUMN IF NOT EXISTS pattern)
  platform/
    createAgentRoute.js             — Factory: auth middleware, SSE headers, progress/result/error/[DONE] events, persistRun call
    AgentScheduler.js               — node-cron wrapper; register(), updateSchedule(); hot-reload on schedule change
    persistRun.js                   — Single write path to agent_runs; called by both createAgentRoute and AgentScheduler
    AgentConfigService.js           — Two-store config pattern: system_settings (admin) + agent_configs (operator); getAgentConfig(), getAdminConfig()
    buildAccountContext.js          — Copy this file exactly from ToolsForge; it is correct and generic
    mcpServer.js                    — MCP HTTP/SSE server scaffold; tool registration, resource registration, prompt registration; no agent-specific logic
  services/
    PermissionService.js            — hasRole(), isOrgAdmin(), getUserRoles(), grantRole(), revokeRole(), getPermittedModels(), canUseModel()
    InvitationService.js            — createInvitation(), getInvitation(), acceptInvitation(), resendInvitation()
    EmailService.js                 — MailChannels primary, nodemailer fallback
    EmailTemplateService.js         — get(), render(), list(), upsert(), reset(); {{variable}} placeholder substitution
  middleware/
    requireAuth.js                  — Token extraction, session validation, req.user attachment
    requireRole.js                  — Delegates to PermissionService; no inline SQL
  routes/
    auth.js                         — login, logout, register (invite-only), profile GET/PUT (firstName, lastName, phone, timezone), POST change-password (verify current, 8-char min), password reset
    agents.js                       — Mount point for all agent routes; each agent calls createAgentRoute()
    admin.js                        — Users, models, agents, app settings, email templates, security, logs
    mcp.js                          — MCP HTTP/SSE transport endpoints
  agents/                           — Empty; ready for first agent
Database schema — platform tables only:
Write all schema initialisation as idempotent SQL in db.js. Tables required for the platform scaffold:

organizations — id, name, created_at
users — id, org_id FK, email, password_hash, first_name, last_name, phone, timezone (TEXT NOT NULL DEFAULT 'UTC'), is_active, created_at
auth_sessions — id, user_id FK, token (32-byte hex), expires_at, created_at
user_roles — id, user_id FK, role_name, scope_type (global/tool/resource), scope_id, granted_by FK, created_at
system_settings — id, org_id FK, key, value (JSONB), updated_by FK, updated_at — UNIQUE(org_id, key)
agent_configs — id (UUID), org_id FK, slug, config (JSONB DEFAULT '{}'), intelligence_profile (JSONB), updated_by FK, updated_at — UNIQUE(org_id, slug)
agent_runs — id (UUID), org_id FK, slug, status (running/complete/error), result (JSONB), error TEXT, run_at, completed_at — INDEX(org_id, slug, run_at DESC)
usage_logs — id, org_id FK, user_id FK, tool_slug, model_id, input_tokens, output_tokens, cost_usd, created_at
email_templates — id, slug, subject, body_html, body_text, updated_by FK, updated_at

Frontend structure to create:
client/src/
  main.jsx
  App.jsx                           — Router, ThemeProvider mount
  index.css                         — CSS custom properties seeded at :root; global heading rule; scrollbar styling; pb-safe; mobile font-size fix
  providers/
    ThemeProvider.jsx               — Writes 7 tokens to <head> style tag; reads from settingsStore; --color-primary-rgb derived token
    IconProvider.jsx                — semanticMap; getIcon() hook; all Lucide imports here only
  stores/
    authStore.js                    — token, user (with roles array + org_name), setAuth(), clearAuth(), logout(); key: mcp-curamtools-auth
    settingsStore.js                — bodyFont, headingFont, theme; key: mcp-curamtools-settings
    toolStore.js                    — lastVisitedTool, sidebarCollapsed; key: mcp-curamtools-tool
  api/
    client.js                       — Centralised fetch wrapper; auto-adds Bearer token from authStore; handles 401 globally (clears auth, redirects /login)
  components/
    layout/
      AppShell.jsx                  — Derives isAdmin once; passes to SidebarLinks and RequireRole; in-flow spacer technique
      TopNav.jsx                    — h-14 fixed; brand, search, user email, org_name, role badge, logout; CSS vars only, no hardcoded Tailwind colour classes
      Sidebar.jsx                   — 220px/56px; labelled sections (Tools, Admin); collapse persists to toolStore
      NavItem.jsx                   — rgba(var(--color-primary-rgb), 0.1) active tint; mx-2 inset; icon colour inherits
    ui/
      Button.jsx                    — DECISION: create this component; variants: primary, secondary, danger, icon, toggle; opacity-only hover; rounded-xl
      Toast.jsx                     — Fixed bottom-5 right-5 z-[9999]; coloured dot; auto-dismiss 3000ms; × close
      Modal.jsx                     — z-50; backdrop click + Escape + × close; rounded-2xl; ConfirmModal variant with type-to-confirm
      InlineBanner.jsx              — Three tiers: error/warning/neutral; px-4 py-2.5 rounded-xl border
      EmptyState.jsx                — Centred column; icon 32px; text-sm message; text-xs hint
      MarkdownRenderer.jsx          — Custom zero-dependency renderer; headings, bold, italic, lists, tables, horizontal rules; infinite loop guard on unrecognised lines; table separator filtering
    charts/
      LineChart.jsx                 — Generic Recharts wrapper; props: data, xKey, leftKey, rightKey, leftFormat, rightFormat, leftColor, rightColor
  pages/
    LoginPage.jsx
    DashboardPage.jsx               — Greeting h1, org_name subline, tool card grid, lastVisitedTool link
    SettingsPage.jsx                — Two tabs: Profile (first name, last name, email read-only, phone, timezone dropdown, change password section) and Appearance (theme picker 5 themes, body font, heading font, mono font)
    admin/
      AdminUsersPage.jsx
      AdminModelsPage.jsx
      AdminAgentsPage.jsx           — Kill switch, model, max tokens, max iterations, IntelligenceProfileSection
      AdminAppSettingsPage.jsx
      AdminEmailTemplatesPage.jsx
      AdminSecurityPage.jsx
      AdminLogsPage.jsx
  guards/
    RequireAuth.jsx                 — Checks authStore.token; redirects /login on fail
    RequireRole.jsx                 — Checks user.roles[].name against allowedRoles; redirects / on fail
  config/
    tools.js                        — Tool registry; getPermittedTools(role); empty agent slots ready; defines sidebar and dashboard simultaneously
  utils/
    getSystemDateContext.js         — Returns "Today is [day], [date]. User timezone: [tz]." string for system prompt injection

Decisions already made — do not revisit, do not ask:

Button component exists (settled in SECTION-ANNOTATION.md)
Toast z-index: z-[9999]
Corner radius: rounded-xl buttons/inputs, rounded-2xl containers/modals
Modal dismiss: backdrop + Escape + explicit × button
TopNav height: 56px
Markdown renderer: custom zero-dependency (no react-markdown); add fenced code block support since this platform will return code from agents
Assistant message avatar: none (multi-tenant workspace signal)
Transition duration: set transitionDuration: { DEFAULT: '200ms' } in tailwind.config.js — resolve the 200ms/150ms mismatch from the start
Focus ring: *:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; } globally in index.css
Tailwind config: map CSS variables to utilities (bg-bg, text-primary, border-border etc.) from the start


Rules for this session and every session after it:

Every new abstraction must be a platform primitive with a generic interface. No agent-specific logic in platform files. Ever.
No new npm package without surfacing it explicitly and waiting for confirmation before installing.
persistRun is the only code path that writes to agent_runs. No exceptions.
AgentConfigService is the only code path that reads from system_settings or agent_configs. No exceptions.
Every require(pkg) in server/ must be in server/package.json. Run cd server && npm install <pkg> — never from the project root.
All monetary values in AUD. Conversion from micros happens inside the data service, not at call sites.
When a dependency is missing, stop and surface it. Do not write a workaround silently.
Update DECISIONS.md when a new architectural decision is made. Do not let decisions live only in code.
```

---

## Stage 1 — Multi-Server Discovery Prompt

**Date**: 2026-03-29
**Purpose**: Implement the first of three foundational pillars — dynamic MCP server registry replacing hardcoded tool slugs
**Context**: Platform scaffold complete and running. Pre-implementation architectural review identified three gaps: Multi-Server Discovery, Resource-Level Permissions, Budget-Aware Circuit Breakers. Stage 1 addresses the first.

### Prompt Text

```
Initialize the MCP_curamTools platform scaffold.

CONTEXT & VISION:
We are building a multi-tenant AI agent platform based on the Model Context Protocol (MCP). This is the successor to 'Curam Vault' and 'ToolsForge'. Our architecture relies on three critical foundational pillars:
1. Multi-Server Discovery (The Registry)
2. Resource-Level Permissions (Granular Security)
3. Budget-Aware Circuit Breakers (Operational Safety)

SESSION GOAL:
In this session, we are implementing STAGE 1: Multi-Server Discovery. We need to move from hardcoded tool slugs to a dynamic registry where the platform can manage connections to remote MCP servers.

IMPLEMENTATION REQUIREMENTS:
1. IDEMPOTENT SCHEMA: Update 'server/db.js' to include an 'mcp_servers' table. Use the 'CREATE TABLE IF NOT EXISTS' pattern.
   Fields needed: id (UUID), org_id (FK), name, transport_type (sse/stdio), endpoint_url, config (JSONB), is_active (bool), created_at.

2. PLATFORM PRIMITIVE: Create 'server/platform/mcpRegistry.js'. This must be a generic service that handles the lifecycle of MCP server connections.

3. SECURITY ASSERTION: Ensure 'org_id' is mandatory for every server registration and lookup. Source 'org_id' strictly from context, never from user-provided data.

SUCCESS CRITERIA:
- The server bootstraps without errors and initializes the new table idempotently.
- A developer can register a new remote MCP server via the service, and it is correctly scoped to an organization.
- The foundation is ready for Stage 2 (Permissions) without requiring a rewrite of this discovery layer.

STRICT CONSTRAINTS (DO NOT):
- DO NOT use any third-party ORM; use raw SQL with parameterized queries ($1, $2).
- DO NOT modify the core authentication logic in 'requireAuth.js' yet; assume 'req.user.org_id' will be available.
- DO NOT build any domain-specific agents (e.g., Ads or Finance). Build only the platform container logic.
- DO NOT install new npm packages without asking for confirmation first.

Read all .md files in the project directory before starting to ensure alignment with settled architectural decisions.
```

### What Was Built

**Files created/modified:**
- `server/db.js` — added `mcp_servers` table (idempotent)
- `server/platform/mcpRegistry.js` — full registry primitive (singleton, EventEmitter)
- `server/index.js` — wired `MCPRegistry.disconnectAll()` to SIGTERM/SIGINT graceful shutdown

**Key implementation decisions:**
- SSE transport implements the full MCP SSE spec: GET → `endpoint` event → POST URL for JSON-RPC
- Stdio transport sends MCP `initialize` handshake on connect; resolves connection after first response
- `send()` validates `(org_id, serverId)` pair at call time — not just at `connect()` — preventing TOCTOU
- `UNIQUE(org_id, name)` on `mcp_servers` means re-registering the same name updates rather than duplicates
- `is_active = FALSE` for soft-deregister — rows never hard-deleted (preserves audit trail)

**Documents updated:** `PLATFORM-PRIMITIVES.md`, `DECISIONS.md`, `mcp_curamtools_prompts.md`

---

## Stage 2 — Resource-Level Permissions Prompt

**Date**: 2026-03-29
**Purpose**: Implement the second foundational pillar — granular access control at the MCP resource URI level
**Status**: Complete

### Prompt Text (as submitted)

```
Initialize Stage 2 of the MCP_curamTools platform: Resource-Level Permissions.

REASONING:
We have a working MCPRegistry primitive, but it is currently 'internal only.' We now need to expose
this via an Admin API and implement granular security so that specific MCP resources
(e.g., mcp://finance/invoices) can be restricted to specific roles or users.

TASK 1: IDEMPOTENT SCHEMA UPDATE
Update 'server/db.js' to include:
1. 'mcp_resources' table: id (UUID), server_id (FK), org_id (FK), uri (unique), name, description, metadata (JSONB).
2. 'resource_permissions' table: id (UUID), user_id (FK) OR role_name (TEXT), resource_uri (TEXT), org_id (FK).
   - Use the 'CREATE TABLE IF NOT EXISTS' pattern.

TASK 2: PERMISSION SERVICE EXTENSION
Extend 'server/services/PermissionService.js' to include:
- 'canAccessResource(userId, resourceUri, orgId)': Checks if a user has a direct permission or an
  'org_admin' role that grants access to the specified MCP resource.

TASK 3: ADMIN API ROUTES
Create 'server/routes/adminMcp.js' and mount it:
- GET /api/admin/mcp-servers: List registered servers for the org.
- POST /api/admin/mcp-servers: Register a new server (calls MCPRegistry.register).
- POST /api/admin/mcp-resources/permissions: Grant/revoke access to a specific URI.

SUCCESS CRITERIA:
- The server initializes the new permission tables idempotently.
- The 'org_id' is strictly enforced: an admin can only see and manage servers/resources belonging
  to their own organization.
- The platform is now ready for Stage 3 (Budget Circuit Breakers).

STRICT CONSTRAINTS:
- DO NOT modify the UI yet; focus on the backend services and routes.
- ALL SQL must be parameterized ($1, $2).
- MCPRegistry must remain the source of truth for active connections.
```

### What Was Built

**Files created/modified:**
- `server/db.js` — `mcp_resources` + `resource_permissions` tables + two partial unique indexes
- `server/services/PermissionService.js` — `canAccessResource`, `grantResourcePermission`, `revokeResourcePermission`, `listResourcePermissions`
- `server/routes/adminMcp.js` — full CRUD for servers, resources, and permissions (11 routes)
- `server/index.js` — mounted `adminMcp.js` at `/api/admin`

**Key implementation decisions:**
- `resource_uri` stored as TEXT in `resource_permissions` (not FK to `mcp_resources.id`) — permissions are security data; losing them via cascade delete is worse than orphan rows
- Deny-wins resolution in `canAccessResource` — any deny row overrides all allow rows; no matching row is implicit deny (default-deny platform posture)
- `user_id XOR role_name` enforced via CHECK constraint + partial unique indexes (not `UNIQUE NULLS NOT DISTINCT`) — more explicit, better documents intent
- Server ownership validated via `MCPRegistry.get(orgId, serverId)` before any resource insert — prevents cross-org resource association
- Route ordering: `GET /permissions` declared before `DELETE /permissions/:id` — Express matches in declaration order; literal `permissions` would match `:id` if declared second
- `ON CONFLICT` upsert for partial indexes uses column-predicate form: `ON CONFLICT (cols) WHERE condition` — `ON CONFLICT ON CONSTRAINT` does not work for partial indexes

**Documents updated:** `PLATFORM-PRIMITIVES.md`, `DECISIONS.md`, `mcp_curamtools_prompts.md`

---

## Stage 3 — Budget-Aware Circuit Breaker Prompt

**Date**: 2026-03-29
**Purpose**: Implement the third foundational pillar — per-run and daily org AUD cost guardrails enforced mid-execution and post-run
**Status**: Complete

### Prompt Text (refined after Stage 2 learnings)

```
MCP_curamTools — Stage 3: Budget-Aware Circuit Breaker.

Read all .md files before starting. Stages 1 and 2 are complete. Do not revisit settled decisions.

CONTEXT:
The kill switch (on/off per agent) and max_tokens guardrail exist but are insufficient for
multi-tenant cost safety. An agent making recursive or expensive MCP tool calls can exceed
budget before max_tokens kicks in. Stage 3 adds a dynamic USD ceiling checked mid-execution.

IMPLEMENTATION REQUIREMENTS:

1. SCHEMA: Add 'budget_usd_per_run' NUMERIC(10,4) DEFAULT NULL to agent_configs.
   Use idempotent ALTER TABLE ... ADD COLUMN IF NOT EXISTS pattern. NULL means unlimited.
   Add to AgentConfigService ADMIN_DEFAULTS as null (unlimited by default).

2. PLATFORM PRIMITIVE: Create server/platform/budgetCircuitBreaker.js.
   Export a single function: checkBudget(orgId, slug, currentCostUsd, config)
   - 'config' is the already-loaded admin config (passed in — no extra DB round-trip).
   - If config.budget_usd_per_run is null, return immediately (unlimited).
   - If currentCostUsd >= budget_usd_per_run, throw BudgetExceededError with limit and actual cost.
   BudgetExceededError must extend Error with { limit, actual } properties.

3. ENFORCEMENT: Inside createAgentRoute, after each SSE progress event that includes
   tokensUsed, call checkBudget(orgId, slug, computedCostUsd, adminConfig).
   On BudgetExceededError: emit { type: 'error', error: err.message } → emit [DONE] →
   call persistRun({ status: 'error', error: err.message }).
   createAgentRoute public interface ({ slug, runFn, requiredPermission }) must not change.

4. UI: Add 'Budget per run (AUD)' field to the admin guardrails panel in AdminAgentsPage.
   Empty field = unlimited. Display current spend vs limit on agent run history rows.

STRICT CONSTRAINTS:
- createAgentRoute public interface must not change.
- checkBudget receives the pre-loaded config — zero additional DB queries per invocation.
- org_admin can set budget to null (unlimited); UI must allow clearing the field.
- All monetary values in AUD (consistent with platform-wide convention).
- No new npm packages without confirmation.
- Do not modify MCPRegistry or PermissionService — Stage 3 is cost enforcement only.

Read PLATFORM-PRIMITIVES.md and DECISIONS.md before writing any code.
Update DECISIONS.md and PLATFORM-PRIMITIVES.md when complete.
```

### What Was Built

**Files created/modified:**
- `server/platform/AgentConfigService.js` — added `max_task_budget_aud: 0.50` to `ADMIN_DEFAULTS._platform`; added `getOrgBudgetSettings(orgId)` (reads `system_settings` key `platform_budget`); added `updateOrgBudgetSettings(orgId, patch, updatedBy)` (upserts to `system_settings`)
- `server/services/CostGuardService.js` (new) — `BudgetExceededError`, `computeCostAud`, `getDailyOrgSpendAud`, `check`
- `server/platform/createAgentRoute.js` — imports `CostGuardService`; loads org budget settings + daily spend once at run start; pre-flight daily budget check; `emit(text, partialTokensUsed)` extended signature for mid-run accumulation; post-run definitive check; `costAud` added to `resultPayload`

**Key implementation decisions:**
- `CostGuardService.check()` is a pure synchronous function — no DB queries mid-stream. Daily spend is a snapshot loaded once via `getDailyOrgSpendAud(orgId)` before the run starts.
- Two guardrail layers: per-task (`max_task_budget_aud` in `ADMIN_DEFAULTS._platform`, per-agent) and daily org-wide (`max_daily_org_budget_aud` in `system_settings` key `platform_budget`).
- Task limit is checked before daily limit inside `check()`.
- `emit(text, partialTokensUsed)` — opt-in mid-run enforcement. Existing agents calling `emit(text)` are unaffected (backwards compatible). A post-run check always runs regardless.
- `BudgetExceededError` thrown inside `emit` propagates through `runFn` to the existing catch block — no new error paths in `createAgentRoute`.
- `AUD_PER_USD = 1.55` constant, documented as approximate. All values in AUD, consistent with platform convention.
- `costAud` persisted in `agent_runs.result` JSONB so the UI can display actual run cost without recomputing from tokens.

**Gotchas for future projects:**
- `getDailyOrgSpendAud` queries `usage_logs` by `cost_usd * 1.55`. If your platform stores cost in a different column or unit, update the query — the rest of `CostGuardService` is agnostic.
- The daily spend snapshot is slightly stale for concurrent runs. This is intentional (soft ceiling, not a hard transaction guarantee). Do not attempt to fix this with row-level locking — it is not worth the complexity for a cost guardrail.
- `check()` checks the task limit first. If you want to prioritise the daily limit check, swap the order inside `check()` — both throw the same error type with a different `.type` field.
- `ADMIN_DEFAULTS._platform.max_task_budget_aud` is a platform-wide default, not per-agent. Individual agents that need a different default should set it in their own `ADMIN_DEFAULTS` entry.

---

## Stage 4 — Admin MCP UI Integration

**Date**: 2026-03-29
**Purpose**: Build the admin UI pages that expose the Stage 1/2 backend APIs — MCP server management, resource registration, and resource-level permission management
**Status**: Complete — no prompt submitted; built directly from existing documentation

### What Was Built

**Files created:**
- `client/src/pages/admin/AdminMcpServersPage.jsx` — register, connect/disconnect, delete MCP servers
- `client/src/pages/admin/AdminMcpResourcesPage.jsx` — two-section page: resources + permissions

**Files modified:**
- `client/src/App.jsx` — two new routes under `RequireRole(['org_admin'])`: `/admin/mcp-servers` and `/admin/mcp-resources`
- `client/src/components/layout/Sidebar.jsx` — two new nav items in Admin section: "MCP Servers" (server icon) and "MCP Resources" (layers icon)

**Also resolved:** `server/routes/auth.js` line 81 — reverted debug `{ error: err.message }` back to `{ error: 'Login failed.' }` (leftover from the initial setup session).

**Key implementation decisions:**
- AdminMcpResourcesPage uses a two-section layout (resources above, permissions below) rather than tabs — reflects the operational workflow where an admin registers a resource and immediately sets its permissions
- The shield icon on each resource row pre-populates the grant permission modal with that resource's URI — reduces friction for the common case
- Status pills use five states: connected (green), connecting (amber), error (red), registered/disconnected (muted border) — aligned with MCPRegistry's internal status values
- Permissions table has a resource URI filter dropdown populated from the registered resources list — avoids a free-text filter that could produce no results
- No `ConfirmModal` used — inline Yes/No confirm is sufficient for these operations (same pattern as AdminUsersPage)

**Gotchas for future sessions:**
- `AdminMcpResourcesPage` fetches the servers list on mount to populate the "Register resource" modal's server dropdown and the "Grant permission" modal's resource URI dropdown. If the server list is empty, the register resource modal shows an empty select — this is correct behaviour (register a server first).
- The permissions table shows `user_id` (UUID) not email. For the MVP this is acceptable; a future improvement would join on `users.email` in the `listResourcePermissions` query and display email instead.
- `useCallback` wraps `loadPermissions` to allow it to be called from the `filterUri` effect without stale closure issues.

**Documents updated:** `PLATFORM-PRIMITIVES.md`, `DECISIONS.md`, `mcp_curamtools_prompts.md`

---

## Prompt Template for Adding New Agents

**Purpose**: To be used when adding a new agent to the platform after scaffold is complete

### Workflow

When adding a new agent to MCP_curamTools, follow this workflow:

1. **Customize the template** with agent-specific details
2. **Submit the prompt** to Claude in a new session
3. **Review the generated code** for platform separation violations
4. **Document what was built** in the "Agents Built" section below
5. **Update this file** with the actual prompt used and any deviations from template

### Template

```
Add a new agent to MCP_curamTools.

Agent name: [AGENT_NAME]
Agent slug: [agent-slug]
Agent purpose: [Brief description of what this agent does]

MCP servers required:
- [server-name] — [what it provides]
- [server-name] — [what it provides]

Tools to register:
- [tool-name] — [description]
- [tool-name] — [description]

Resources to register:
- [resource-name] — [description]
- [resource-name] — [description]

Prompts to register:
- [prompt-name] — [description]
- [prompt-name] — [description]

Agent-specific configuration schema:
{
  "setting_name": "description and type",
  "another_setting": "description and type"
}

Expected inputs from user:
- [Input name] — [description, validation rules]

Expected outputs:
- [Output name] — [format, where it goes]

Follow these rules:
1. All agent-specific code goes in server/agents/[agent-slug]/
2. Agent must export: { slug, name, description, getRoute, registerMCPHandlers }
3. getRoute() must call createAgentRoute() from platform/
4. registerMCPHandlers() must register with platform/mcpServer.js
5. Add agent entry to client/src/config/tools.js
6. Add agent config row to agent_configs table via migration or seed
7. No platform file modifications except mounting in routes/agents.js
8. Update DECISIONS.md if any new patterns emerge

Reference PLATFORM-PRIMITIVES.md for interfaces.
Reference existing agents for structure examples.
```

### Example: Email Campaign Agent

**How to use the template — a concrete example:**

```
Add a new agent to MCP_curamTools.

Agent name: Email Campaign Analyzer
Agent slug: email-campaign-analyzer
Agent purpose: Analyzes email campaign performance from Gmail, provides insights and recommendations for improvement

MCP servers required:
- gmail — Read emails from specific campaigns, access performance metrics
- google-analytics — Pull website traffic data correlated with campaign send times

Tools to register:
- fetch_campaign_emails — Retrieves all emails matching campaign label/filter
- get_email_metrics — Gets open rates, click rates, reply rates for a campaign
- get_landing_page_analytics — Pulls GA4 data for landing pages linked in campaigns

Resources to register:
- campaign://recent — List of recent campaigns (last 30 days)
- campaign://[campaign-id] — Individual campaign details and full email thread

Prompts to register:
- analyze-campaign — Template for analyzing a single campaign with performance metrics
- compare-campaigns — Template for comparing multiple campaigns side-by-side

Agent-specific configuration schema:
{
  "gmail_label_prefix": "string - prefix for campaign labels (e.g., 'Campaign/')",
  "min_emails_threshold": "number - minimum emails to consider a valid campaign",
  "analysis_lookback_days": "number - how far back to search for campaigns (default 30)"
}

Expected inputs from user:
- campaign_id (optional) — Gmail label or thread ID to analyze; if omitted, shows recent campaigns
- comparison_mode (boolean) — Whether to compare multiple campaigns or analyze one deeply

Expected outputs:
- Campaign performance summary — JSON with open rates, click rates, reply rates, revenue attribution
- Recommendations list — Array of actionable suggestions with priority and estimated impact
- Comparison table — If comparison_mode=true, side-by-side metrics for selected campaigns

Follow these rules:
1. All agent-specific code goes in server/agents/email-campaign-analyzer/
2. Agent must export: { slug, name, description, getRoute, registerMCPHandlers }
3. getRoute() must call createAgentRoute() from platform/
4. registerMCPHandlers() must register with platform/mcpServer.js
5. Add agent entry to client/src/config/tools.js
6. Add agent config row to agent_configs table via migration or seed
7. No platform file modifications except mounting in routes/agents.js
8. Update DECISIONS.md if any new patterns emerge

Reference PLATFORM-PRIMITIVES.md for interfaces.
Reference existing agents for structure examples.
```

### What Gets Documented After Building

After Claude builds the agent and you verify it works, add an entry to the "Agents Built" section below with:

1. **Agent name and slug**
2. **Date built**
3. **Actual prompt used** (paste the customized template you submitted)
4. **Deviations from template** (if any — e.g., "Added a helper utility for parsing email headers")
5. **Files created** (list the actual files in `server/agents/[slug]/`)
6. **MCP handlers registered** (list the actual tool/resource/prompt names)
7. **Configuration keys added** (what went into `agent_configs` table)
8. **Known issues or future enhancements** (if any)

This creates a historical record of:
- What you asked for
- What was actually built
- Where the code lives
- How to replicate or extend it

---

## Agents Built

### Example Entry Format

**Agent**: Email Campaign Analyzer  
**Slug**: `email-campaign-analyzer`  
**Date Built**: 2026-04-15  
**Status**: Production

**Prompt Used**: [paste the actual customized prompt here]

**Files Created**:
```
server/agents/email-campaign-analyzer/
  index.js                    — Agent export, slug, name, description
  handler.js                  — Main agent logic, calls MCP tools
  mcpHandlers.js              — Tool/resource/prompt registration
  emailParser.js              — Helper utility for parsing Gmail API responses
  campaignMetrics.js          — Calculate open/click/reply rates
```

**MCP Handlers Registered**:
- Tools: `fetch_campaign_emails`, `get_email_metrics`, `get_landing_page_analytics`
- Resources: `campaign://recent`, `campaign://[campaign-id]`
- Prompts: `analyze-campaign`, `compare-campaigns`

**Configuration Schema** (`agent_configs` row):
```json
{
  "gmail_label_prefix": "Campaign/",
  "min_emails_threshold": 10,
  "analysis_lookback_days": 30
}
```

**Deviations from Template**:
- Added `emailParser.js` helper to handle Gmail API's nested thread structure
- Added rate limiting in `handler.js` to avoid Gmail API quota issues
- Modified prompt template to include date range in analysis context

**Known Issues**:
- Gmail API quota can be hit with >100 campaigns analyzed in one day
- Landing page analytics don't attribute conversions to specific emails yet

**Future Enhancements**:
- Add A/B test detection and analysis
- Integrate with Mailchimp for non-Gmail campaigns
- Add automated weekly summary reports

---

### [Next Agent Entry Goes Here]

**Agent**: [Name]  
**Slug**: `[slug]`  
**Date Built**: YYYY-MM-DD  
**Status**: [Development/Staging/Production]

[Follow same format as above]

---

## Notes

- All prompts assume the documentation files (SETUP.md, SECTION-*.md, DECISIONS.md, etc.) are present in the project directory
- The initial setup prompt deliberately defers annotation decisions to a separate review step — see SECTION-ANNOTATION.md
- Future prompts should be added chronologically to this file with date, purpose, and full text
- When reusing prompts across projects, update project-specific names (org name, admin email, etc.)

---

## How to Use This File

### For Initial Project Setup

1. **Copy the "Initial Project Setup Prompt"** from above
2. **Customize project-specific values**:
   - Change `MCP_curamTools` to your project name
   - Update `APP_NAME`, `ORG_NAME` in the .env section
   - Update `SEED_ADMIN_EMAIL` to your email
   - Adjust port numbers if needed (5174/3002)
3. **Ensure all referenced .md files exist** in your project directory
4. **Paste the prompt** into a new Claude session
5. **Follow SETUP.md** to verify installation and dependencies
6. **Document any issues** by updating SETUP.md with new troubleshooting entries

### For Adding New Agents

1. **Copy the agent template** from the "Prompt Template for Adding New Agents" section
2. **Fill in all bracketed placeholders**:
   - `[AGENT_NAME]` — Human-readable name (e.g., "Email Campaign Analyzer")
   - `[agent-slug]` — Kebab-case identifier (e.g., "email-campaign-analyzer")
   - `[Brief description]` — One sentence explaining what it does
   - MCP servers list — Which external services it needs
   - Tools/Resources/Prompts — What MCP handlers to register
   - Configuration schema — What settings go in `agent_configs` table
   - Expected inputs/outputs — What the agent receives and returns
3. **Review the example** (Email Campaign Analyzer) to see a complete filled-in template
4. **Submit to Claude** in a new session (or continuation session if context allows)
5. **Verify platform separation**:
   - All agent code in `server/agents/[slug]/`
   - No modifications to `platform/` files
   - No inline SQL in agent code (use services)
   - No hardcoded config (use `AgentConfigService`)
6. **Document what was built**:
   - Copy the "Example Entry Format" from "Agents Built" section
   - Fill in actual files created, handlers registered, config schema
   - Note any deviations from the template
   - Add known issues and future enhancements
   - Append to "Agents Built" section in this file
7. **Update DECISIONS.md** if any new architectural patterns emerged

### For Future Project Iterations

1. **Review "Prompt Evolution Log"** to see what prompts were used historically
2. **Copy the most relevant prompt** as a starting point
3. **Adapt to new requirements** while preserving the structure
4. **Add a new dated entry** to the evolution log
5. **Document what changed and why**

### Maintenance

This file should be treated as a living document:

- **After every agent addition** → Update "Agents Built" section
- **After setup issues** → Cross-reference SETUP.md troubleshooting
- **After architectural decisions** → Add note to relevant prompt about the decision
- **Before new projects** → Review all sections to see what patterns evolved

The goal: Never lose knowledge about how to talk to Claude about this codebase.

---

## Prompt Evolution Log

### 2026-03-29 — Initial setup prompt created
- Incorporates lessons from Vault and ToolsForge setup failures
- Explicitly calls out settled decisions to avoid re-asking
- Emphasizes platform primitives over agent-specific code
- Requires reading all documentation before code generation

### 2026-03-29 — Stage 1: Multi-Server Discovery
- Architectural review identified three foundational gaps before agents can be built
- Stage 1 delivers MCPRegistry (DB-backed registry + SSE + stdio connection lifecycle)
- Draft prompts written for Stage 2 (Resource Permissions) and Stage 3 (Budget Circuit Breaker)
- Security principle formalised: org_id always from session context, never request data
- Documents updated: PLATFORM-PRIMITIVES.md (MCPRegistry + mcp_servers), DECISIONS.md (three-pillar roadmap)

### 2026-03-29 — Stage 2: Resource-Level Permissions
- Two new tables: mcp_resources, resource_permissions
- Key learnings captured for future projects:
  - Deny-wins + default-deny is the right posture for multi-tenant resource security
  - resource_uri stored as TEXT (not FK) — permissions are security data, cascade deletes are dangerous
  - user_id XOR role_name: partial unique indexes over UNIQUE NULLS NOT DISTINCT — more explicit
  - ON CONFLICT upsert for partial indexes requires column-predicate form, not ON CONSTRAINT
  - Route ordering matters: literal paths must be declared before parameterised paths in Express
  - Stage 3 prompt sharpened: pass pre-loaded config into checkBudget to avoid extra DB queries
- Documents updated: PLATFORM-PRIMITIVES.md, DECISIONS.md, mcp_curamtools_prompts.md

### 2026-03-29 — Stage 3: Budget-Aware Circuit Breaker
- Two guardrail layers shipped: per-task (`max_task_budget_aud`) and daily org-wide (`max_daily_org_budget_aud`)
- Key design decisions captured for future projects:
  - `CostGuardService.check()` is pure + synchronous — no DB queries mid-stream; daily spend loaded once at run start
  - `emit(text, partialTokensUsed)` — backwards-compatible opt-in mid-run enforcement; existing agents unaffected
  - `BudgetExceededError` propagates through existing catch block — no new error paths required
  - `costAud` persisted in `agent_runs.result` JSONB — UI displays actual cost without recomputing
  - `AUD_PER_USD = 1.55` documented as approximate; rates are Claude Sonnet 4.6 approximations
  - Daily spend snapshot is intentionally stale for concurrent runs — soft ceiling, not a hard guarantee
  - `createAgentRoute` public interface (`{ slug, runFn, requiredPermission }`) unchanged
- Three-pillar roadmap now complete: all stages ✅
- Documents updated: PLATFORM-PRIMITIVES.md, DECISIONS.md, mcp_curamtools_prompts.md