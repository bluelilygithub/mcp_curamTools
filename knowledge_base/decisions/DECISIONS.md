# DECISIONS.md

**Project Context:** Internal learning project for one organisation, solo developer. See [PROJECT_IDENTITY.md](../core/PROJECT_IDENTITY.md).

> **Primary reader:** AI + human. Read before making changes that touch the listed areas.
> **Format:** Date · Context · Options considered · Decision · Rationale.

---

## 2026-05-08 — Default & Fallback Model Management

**Context:** Need a Settings > Models tab where org admins can set a default LLM model and a fallback model for the org. The fallback is used when the default is unavailable (e.g. rate-limited, down).

**Options considered:**
1. Store in `system_settings` as `default_model` and `fallback_model` keys
2. Add columns to `organizations` table
3. Store in `agent_configs` as a special slug

**Decision:** Option 1 — `system_settings` with keys `default_model` and `fallback_model`.

**Rationale:** `system_settings` is already the canonical store for org-level configuration. No schema migration needed (JSONB key-value pattern). The Settings > Models tab reads/writes these via `GET/PUT /api/settings/default-model` and `GET/PUT /api/settings/fallback-model`.

---

## 2026-05-08 — Document Analyzer File Upload via Base64 JSON Body

**Context:** The document analyzer needs to accept file uploads (PDF, DOCX, images) from the browser. The platform's `createAgentRoute` expects a JSON body — it does not support multipart/form-data.

**Options considered:**
1. Add multer middleware to `createAgentRoute`
2. Client converts file to base64, sends in JSON body
3. Two-step: upload to S3 first, then reference the URL

**Decision:** Option 2 — base64 in JSON body.

**Rationale:** Zero server-side changes to `createAgentRoute`. No multer dependency. Works within the existing SSE streaming contract. 9 MB client-side limit prevents abuse. The base64 overhead (~33%) is acceptable for demo-scale files.

---

## 2026-05-08 — Document Analyzer Save to AWS S3

**Context:** After analysis, the user should be able to save the original uploaded file to AWS S3 for permanent storage.

**Options considered:**
1. Upload to S3 during the initial file upload (before analysis)
2. Upload to S3 on demand after analysis completes
3. Store file in PostgreSQL as BYTEA

**Decision:** Option 2 — on-demand save after analysis.

**Rationale:** S3 storage costs money — don't store files the user doesn't explicitly save. The original file data is already in `agent_runs.result.file_data` (base64), so it can be uploaded to S3 at any time. The "Save to AWS" button is idempotent (checks `s3_key` in result before re-uploading).

---

## 2026-05-08 — Decision Log Page Run History Viewer

**Context:** Demo users need to see their past document analyzer runs in a readable format, not raw JSON.

**Options considered:**
1. Build a dedicated Decision Log page with expandable cards and timeline
2. Reuse the generic agent history endpoint
3. Show runs inline on the Document Analyzer page

**Decision:** Option 1 — dedicated Decision Log page.

**Rationale:** The generic history endpoint returns raw JSON. A dedicated page can render the decision trace as a visual timeline, highlight key decisions (model selection, file storage, certificate readiness), and provide a better demo experience. The page is linked from the DemoShell sidebar under "History".

---

## 2026-05-06 — Multi-Org User Management

**Context:** Need to support multiple organisations (internal + demo clients) with separate user bases. Admins need to create orgs and invite users to specific orgs.

**Options considered:**
1. Add `org_type` column to `organizations` + `org_agent_manifest` table
2. Separate database per org
3. Schema-level isolation (PostgreSQL schemas)

**Decision:** Option 1 — `org_type` + `org_agent_manifest`.

**Rationale:** Row-level isolation is sufficient for this scale. No connection pooling overhead of separate databases. No schema migration complexity of PostgreSQL schemas. The `org_type` flag enables layout branching (DemoShell vs AppShell) without separate deployments.

---

## 2026-05-05 — Demo Client Org — Curam Engineering

**Context:** Curam Engineering is the first external demo client. Need to decide how to provision the org and what the document-analyzer agent looks like.

**Options considered:**
1. Provision via committed SQL migration
2. Provision via Admin SQL Console at runtime
3. Provision via API endpoint

**Decision:** Option 2 — Admin SQL Console.

**Rationale:** Client data (org name, manifest assignments) stays out of version control. The Admin SQL Console already exists and can run the provisioning SQL. This avoids committing client-specific data to the codebase.

**Agent design decisions:**
- Single file (`server/agents/demoSuite/documentAnalyzer.js`) — no tools.js/prompt.js split
- Fixed prompt, no ReAct loop
- Reuses `docExtractor` Ghostscript helpers + `getProvider`
- Applies extraction privacy settings post-AI
- File upload via base64 JSON body (no multer)
- Slug: `demo-document-analyzer`, Permission: `org_member`

---

## 2026-05-05 — Demo Layer Foundation

**Context:** Need a multi-tenant demo layer where external clients can log in and see only their assigned agents, without accessing internal tools.

**Options considered:**
1. Separate deployment per client
2. Same deployment with org branching
3. Feature flags per user

**Decision:** Option 2 — same deployment, org branching via `org_type`.

**Rationale:** Single deployment is cheaper and simpler to maintain. The `org_type` flag on `organizations` enables layout branching at the `OrgShell` level. Demo users see `DemoShell` with only their manifest agents. Internal users see `AppShell` with all tools. The manifest API (`org_agent_manifest` table) controls per-org agent assignment without code changes.

---

## 2026-05-03 — WP Theme Extractor: Pre-fetch Pattern

**Context:** The WP Theme Extractor needs to fetch an external URL and send the HTML to Claude. This is a different pattern from the ReAct loop used by other agents.

**Options considered:**
1. Use the ReAct loop with a `fetch_url` tool
2. Pre-fetch in the agent code, then call Claude once
3. Client-side fetch, send HTML in the request body

**Decision:** Option 2 — pre-fetch in agent code.

**Rationale:** The ReAct loop adds latency and cost for a single fetch operation. Client-side fetch would expose CORS issues. Pre-fetching in the agent code keeps the client interface simple (just a URL) and avoids unnecessary Claude round-trips.

---

## 2026-04-29 — Cross-Source Reconciliation

**Context:** Need to detect data discrepancies between Google Ads, GA4, and WordPress CRM data.

**Options considered:**
1. Build a separate reconciliation agent
2. Add reconciliation checks to the existing googleAdsMonitor
3. Build a generic reconciliation framework

**Decision:** Option 2 — add checks to googleAdsMonitor.

**Rationale:** Reconciliation is most valuable in the context of the ads monitor report. A separate agent would need to re-fetch the same data. A generic framework is premature — only two checks exist so far. The checks are lightweight (pure functions + one WP query) and run before/after the Claude call.

---

## 2026-04-29 — Deterministic Guardrails

**Context:** Need to detect when tool data is structurally invalid (e.g. CTR > 1.0, clicks > impressions) and flag runs for review.

**Options considered:**
1. Validate in the MCP server before returning data
2. Validate in the agent after tool execution
3. Validate in `createAgentRoute` after the agent completes

**Decision:** Option 3 — validate in `createAgentRoute`.

**Rationale:** MCP servers shouldn't need to know about validation rules. Agent code shouldn't be cluttered with validation logic. `createAgentRoute` is the single chokepoint where all agent results pass through — validate once, apply to all agents.

---

## 2026-04-28 — Conversation Agent: Tool Result Caching

**Context:** The conversation agent calls tools frequently. Many tool results are identical across consecutive turns (e.g. listing campaigns twice in a row).

**Options considered:**
1. Cache in the MCP server (server-side)
2. Cache in the AgentOrchestrator (platform-level)
3. Cache in the conversation agent (agent-level)

**Decision:** Option 2 — cache in AgentOrchestrator.

**Rationale:** Platform-level caching benefits all agents, not just the conversation agent. The cache is session-scoped (5-min TTL, keyed by `orgId:userId`) — safe because tool results are deterministic within a session. Error results are never cached. Individual tools can opt out with `cacheable: false`.

---

## 2026-04-28 — Conversation Agent: Prompt Cache Keep-Warm

**Context:** Anthropic's prompt cache has a 5-minute TTL. If a user pauses mid-conversation, the next message pays the cache write premium.

**Options considered:**
1. Do nothing — accept the occasional cache write cost
2. Ping the API every 4.5 minutes to keep the cache warm
3. Reduce the system prompt size to fit in the minimum cache unit

**Decision:** Option 2 — keep-warm ping every 4.5 minutes.

**Rationale:** The keep-warm ping costs ~$0.002 AUD (cache read) vs ~$0.025 AUD for a cache write. Over an 8-hour session: ~$0.23 AUD in keep-warm pings vs potentially multiple cache writes if the user pauses. The keep-warm is implemented as a `setInterval` in the conversation view component, calling a dedicated `/keep-warm` endpoint.

---

## 2026-04-28 — Conversation Agent: Tool Selection

**Context:** The conversation agent needs access to data tools but should not expose all 30+ tools to Claude.

**Options considered:**
1. Expose all tools
2. Select a curated subset
3. Let the admin configure which tools are available

**Decision:** Option 2 — curated subset of 25 tools.

**Rationale:** 30+ tools would consume too many tokens in the system prompt and confuse Claude. The curated subset covers the most useful queries: google-ads (11), google-analytics (5), wordpress (5), platform (4), knowledge-base (2). Admin configurability is future work.

---

## 2026-04-28 — Conversation Agent: Architecture

**Context:** Need an interactive Q&A agent that can answer questions about ads, analytics, and CRM data using natural language.

**Options considered:**
1. Build as a standard agent with `createAgentRoute`
2. Build as a separate Express router with custom session management
3. Use the existing conversation route pattern

**Decision:** Option 2 — separate Express router with custom session management.

**Rationale:** The conversation agent needs multi-turn state (message history, tool result cache) that doesn't fit the `createAgentRoute` pattern (single run → result). A separate router at `/api/conversation` manages sessions, message history, and the keep-warm endpoint. The `AgentOrchestrator` is still used for the ReAct loop.

---

## 2026-04-27 — High Intent Advisor: Suggestion Persistence

**Context:** The High Intent Advisor identifies leads worth following up. These suggestions need to be stored, tracked, and acted upon.

**Options considered:**
1. Store in `agent_runs` only
2. Store in a separate `suggestions` table
3. Store in the CRM system via API

**Decision:** Option 2 — separate `suggestions` table.

**Rationale:** `agent_runs` is for run history — querying it for pending suggestions would be slow and awkward. A separate table with status tracking (pending, contacted, converted, dismissed) enables the suggestion history UI and outcome tracking. CRM API integration is fragile and CRM-specific.

---

## 2026-04-27 — High Intent Advisor: Lead Scoring Criteria

**Context:** Need to define what makes a lead "high intent" for the advisor agent.

**Options considered:**
1. Hardcode criteria in the agent code
2. Make criteria configurable via admin settings
3. Let Claude decide based on the data

**Decision:** Option 1 — hardcode criteria in the agent code.

**Rationale:** The criteria are well-understood (recent enquiry, specific services, multiple touchpoints, high-value package interest). Hardcoding keeps the agent deterministic and auditable. Configurability can be added later if needed.

---

## 2026-04-26 — Agent Scheduler: Multi-Customer Support

**Context:** The google-ads-monitor needs to run for multiple customers within an org. Each customer has separate Google Ads accounts.

**Options considered:**
1. Register separate cron jobs per customer
2. Have the agent return an array of results
3. Run the agent once with all customer data

**Decision:** Option 2 — agent returns array of results.

**Rationale:** One cron job per customer would clutter the scheduler and make it hard to see the overall schedule. Running once with all data would mix customer contexts. Returning an array lets the scheduler persist one `agent_runs` row per customer with proper isolation.

---

## 2026-04-25 — Agent Config: Operator vs Admin Settings

**Context:** Need two levels of configuration: operator (per-customer, per-agent) and admin (org-wide defaults).

**Options considered:**
1. Single config table with a type column
2. Two separate tables: `agent_configs` and `system_settings`
3. JSONB blob on the `organizations` table

**Decision:** Option 2 — two separate tables.

**Rationale:** `agent_configs` is for per-agent, per-customer settings that operators change frequently. `system_settings` is for org-wide defaults that admins set once. Separate tables make the access patterns clear and avoid a complex type-discriminated query.

---

## 2026-04-24 — MCP Registry: Transport Abstraction

**Context:** MCP servers can use SSE or stdio transport. The registry needs to handle both transparently.

**Options considered:**
1. Separate connection classes for each transport
2. Single class with transport-type branching
3. Factory pattern returning transport-specific adapters

**Decision:** Option 1 — separate connection classes.

**Rationale:** SSE and stdio have fundamentally different lifecycle management (HTTP vs child process). Separate classes (`SseConnection`, `StdioConnection`) with a common interface (`connect()`, `send()`, `disconnect()`) keeps each transport's complexity isolated. The registry delegates to the appropriate class based on `transportType`.

---

## 2026-04-24 — MCP Registry: Soft Deregistration

**Context:** When an MCP server is deregistered, should the row be deleted or marked inactive?

**Options considered:**
1. Hard delete
2. Soft delete (`is_active = FALSE`)
3. Archive to a separate table

**Decision:** Option 2 — soft delete.

**Rationale:** Hard delete loses the connection history. A separate archive table adds complexity for no benefit at this scale. `is_active = FALSE` preserves the server configuration for re-registration and provides an audit trail. The `UNIQUE(org_id, name)` constraint on active rows means re-registering updates rather than creating duplicates.

---

## 2026-04-24 — MCP Registry: Singleton Pattern

**Context:** The MCP registry manages connections to external servers. Should it be a singleton or instantiated per-request?

**Options considered:**
1. Singleton (module-level instance)
2. Per-request instantiation
3. Dependency injection

**Decision:** Option 1 — singleton.

**Rationale:** MCP connections are long-lived (SSE streams, child processes). Per-request instantiation would create duplicate connections. Dependency injection adds complexity without benefit in a single-process Express app. The singleton is initialized at startup and disconnected on SIGTERM/SIGINT.

---

## 2026-04-24 — Permission Service: Deny-Wins Resolution

**Context:** Resource permissions need a clear resolution strategy when allow and deny rules conflict.

**Options considered:**
1. Allow-wins (any allow overrides all denies)
2. Deny-wins (any deny overrides all allows)
3. Most-specific-wins (more specific rules override general ones)

**Decision:** Option 2 — deny-wins.

**Rationale:** Deny-wins is the security industry standard (AWS IAM, Azure RBAC). It ensures that an explicit deny cannot be overridden by a broader allow. This is important for sensitive resources where a mistake in an allow rule shouldn't grant unintended access.

---

## 2026-04-24 — Permission Service: Resource URI as TEXT

**Context:** The `resource_permissions` table references `mcp_resources.resource_uri`. Should this be a foreign key?

**Options considered:**
1. Foreign key to `mcp_resources`
2. TEXT column (denormalized)
3. ENUM of known resource URIs

**Decision:** Option 2 — TEXT column.

**Rationale:** Permissions are security data — cascade deletes from the resources table could silently remove permissions. Storing the URI as TEXT prevents accidental data loss when a resource is deregistered. The URI is stable and human-readable, so referential integrity isn't critical.

---

## 2026-04-24 — Permission Service: User ID XOR Role Name

**Context:** Resource permissions can be granted to a specific user or to all members of a role, but not both in the same row.

**Options considered:**
1. Two separate tables (`user_permissions`, `role_permissions`)
2. Single table with CHECK constraint enforcing XOR
3. Single table with nullable columns

**Decision:** Option 2 — single table with CHECK constraint + partial unique indexes.

**Rationale:** A single table is simpler to query ("what permissions exist for this resource?"). The CHECK constraint enforces data integrity at the database level. Partial unique indexes prevent duplicate entries for the same user/resource or role/resource combination.

---

## 2026-04-24 — MCP Server: Tool Slug Convention

**Context:** MCP server tools need a consistent naming convention for the conversation agent to reference them.

**Options considered:**
1. `{server}_{action}` (e.g. `ads_get_campaign_performance`)
2. `{action}_{server}` (e.g. `get_campaign_performance_ads`)
3. Namespaced objects (e.g. `ads.getCampaignPerformance`)

**Decision:** Option 1 — `{server}_{action}` with snake_case.

**Rationale:** Snake_case is standard for API tool names. Prefixing with the server name prevents collisions between servers (e.g. `ads_get_campaign_performance` vs `ga4_get_sessions_overview`). The prefix also makes it clear which data source a tool belongs to.

---

## 2026-04-24 — MCP Server: Stdio Transport

**Context:** MCP servers need to communicate with the parent process. Stdio transport spawns a child process and communicates via stdin/stdout.

**Options considered:**
1. Stdio (child process)
2. HTTP (separate server)
3. Unix socket

**Decision:** Option 1 — stdio.

**Rationale:** Stdio is the simplest transport for local MCP servers. No port management, no HTTP server overhead, no CORS. The child process inherits environment variables from the parent, so credentials are available without additional configuration. Railway supports stdio natively.

---

## 2026-04-24 — MCP Server: SSE Transport

**Context:** Remote MCP servers need to communicate over HTTP. SSE (Server-Sent Events) is the standard MCP transport for remote connections.

**Options considered:**
1. SSE (standard MCP transport)
2. WebSocket
3. Long polling

**Decision:** Option 1 — SSE.

**Rationale:** SSE is the standard transport for MCP. It's simpler than WebSocket (unidirectional, no handshake complexity) and more efficient than long polling. The MCP SSE spec defines a clear protocol: GET → `endpoint` event → POST URL for JSON-RPC.

---

## 2026-04-24 — MCP Server: Database Schema

**Context:** Need a database table to store MCP server configurations (name, transport type, endpoint URL, credentials).

**Options considered:**
1. Single `mcp_servers` table with JSONB config
2. Separate tables per transport type
3. Environment variables only

**Decision:** Option 1 — single `mcp_servers` table with JSONB config.

**Rationale:** A single table is simpler to query and manage. JSONB config allows different transport types to store different configuration fields without schema changes. Environment variables alone would require a server restart to add/remove servers.

---

## 2026-04-24 — MCP Server: Architecture Decision

**Context:** The project needs a dynamic MCP server registry to replace hardcoded tool slugs. This enables adding/removing data sources without code changes.

**Options considered:**
1. Dynamic MCP server registry with database persistence
2. Hardcoded tool slugs in agent code
3. Configuration file-based tool definitions

**Decision:** Option 1 — dynamic MCP server registry.

**Rationale:** Hardcoded tool slugs require code changes to add/remove data sources. Configuration files are better but still require a restart. A database-backed registry with a singleton connection manager enables runtime registration, connection lifecycle management, and org-scoped isolation.

---

## 2026-04-24 — Budget Guardrails: Two-Layer Enforcement

**Context:** Need to prevent runaway AI costs. Should enforcement be per-run, daily, or both?

**Options considered:**
1. Per-run only
2. Daily org-wide only
3. Both per-run and daily org-wide

**Decision:** Option 3 — both layers.

**Rationale:** Per-run limits prevent a single expensive query from costing too much. Daily org-wide limits prevent cumulative costs from multiple runs. The two layers provide defense in depth: a per-run limit catches individual outliers, while the daily limit catches aggregate overuse.

---

## 2026-04-24 — Budget Guardrails: Mid-Run Enforcement

**Context:** Should budget enforcement happen before, during, or after a run?

**Options considered:**
1. Pre-flight check only
2. Post-run check only
3. Pre-flight + mid-run + post-run

**Decision:** Option 3 — all three stages.

**Rationale:** Pre-flight catches obvious over-budget requests before any tokens are spent. Mid-run enforcement (via `emit(text, partialTokensUsed)`) catches runs that go over budget during execution. Post-run is the definitive check after all tokens are counted. The mid-run check is opt-in — agents that don't call `emit` with token counts skip it.

---

## 2026-04-24 — Budget Guardrails: Cost Calculation

**Context:** Need to calculate the AUD cost of an API call from token usage.

**Options considered:**
1. Use Anthropic's API response headers
2. Calculate from token counts using known pricing
3. Use a third-party cost calculator

**Decision:** Option 2 — calculate from token counts.

**Rationale:** Anthropic's API returns token counts in the response. Using known pricing constants ($3/M input, $15/M output, $0.30/M cache read, $3.75/M cache write) is simpler and more reliable than parsing response headers. The `AUD_PER_USD` conversion factor (1.55) is a constant that can be updated if the exchange rate changes significantly.

---

## 2026-04-24 — Budget Guardrails: Architecture Decision

**Context:** The project needs budget guardrails to prevent runaway AI costs. This is a platform-level concern that applies to all agents.

**Options considered:**
1. Implement in each agent individually
2. Implement in `createAgentRoute` (platform level)
3. Implement as a middleware

**Decision:** Option 2 — implement in `createAgentRoute`.

**Rationale:** Platform-level enforcement ensures all agents benefit from budget guardrails without individual implementation. `createAgentRoute` is the single chokepoint where all agent runs pass through. The `CostGuardService` is a pure function with no IO, making it testable and composable.

---

## 2026-04-24 — Permission Service: Architecture Decision

**Context:** Need granular access control for MCP resources. Users should only access resources they have permission for.

**Options considered:**
1. Role-based access control (RBAC) only
2. Resource-level permissions only
3. Both RBAC and resource-level permissions

**Decision:** Option 3 — both RBAC and resource-level permissions.

**Rationale:** RBAC handles broad access patterns (org_admin can access everything, org_member can access tools). Resource-level permissions handle fine-grained access to specific MCP resources. The two systems are complementary: RBAC for agent access, resource permissions for data access.

---

## 2026-04-24 — MCP Registry: Architecture Decision

**Context:** The project needs a dynamic MCP server registry to replace hardcoded tool slugs. This is the first of three foundational pillars.

**Options considered:**
1. Build a custom registry
2. Use an existing MCP client library
3. Use a message queue

**Decision:** Option 1 — custom registry.

**Rationale:** Existing MCP client libraries are immature and may not support all required features (org-scoped connections, SSE + stdio, soft deregistration). A custom registry gives full control over the connection lifecycle and can be tailored to the project's specific needs.

---

## 2026-04-24 — Platform Architecture: Three Pillars

**Context:** The platform needs three foundational capabilities: dynamic MCP server discovery, resource-level permissions, and budget-aware circuit breakers.

**Options considered:**
1. Build all three simultaneously
2. Build in sequence: MCP registry → permissions → budget
3. Build only what's needed for the first agent

**Decision:** Option 2 — sequential build.

**Rationale:** The three pillars are independent but build on each other. MCP registry is the foundation — without it, there are no servers to manage. Permissions control access to those servers. Budget guardrails protect against cost overruns. Building in sequence allows each pillar to be tested and stabilised before moving to the next.

---

## 2026-04-24 — Project Scaffold: Technology Choices

**Context:** Need to choose the technology stack for the MCP CuramTools platform.

**Options considered:**
1. Express + React + PostgreSQL (current stack)
2. Next.js + Vercel Postgres
3. FastAPI + React + PostgreSQL

**Decision:** Option 1 — Express + React + PostgreSQL.

**Rationale:** The team has existing experience with this stack from the Vault and ToolsForge projects. Express provides the flexibility needed for MCP server management (SSE streaming, child process management). React with Vite provides a fast development experience. PostgreSQL with pgvector enables semantic search for the knowledge base.

---

## 2026-04-24 — Project Scaffold: Monorepo Structure

**Context:** Need to decide how to structure the project with both a server and client.

**Options considered:**
1. Monorepo with `/server` and `/client` directories
2. Separate repositories
3. Single directory with mixed code

**Decision:** Option 1 — monorepo with `/server` and `/client`.

**Rationale:** A monorepo simplifies development (single `git clone`, shared tooling) while keeping server and client code clearly separated. The Dockerfile at the root handles the two-stage build. Railway deploys from the root directory.
