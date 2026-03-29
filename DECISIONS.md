# DECISIONS.md

## Foundational References
- **TOOLSFORGE_README.md** — ToolsForge platform and agent feature inventory
- **Learnings-ToolsForge.md** — ToolsForge technical patterns and implementation knowledge
- **README  -- very important.md** — Curam Vault feature inventory (predecessor single-user app)
- **LEARNINGS--very important.md** — Curam Vault technical patterns and reusable patterns

These files are the source of truth. The documents below derive from them and reference them by name rather than duplicating their content.

---

### agent_runs as the Single History Table for All Agents
**Date:** 2026-03-28
**Status:** Settled
**Context:** Multiple agents will write execution history. Without a shared table, each new agent would require a new schema table, increasing schema surface area and complicating cross-agent queries.
**Decision:** All agent run history is written to a single `agent_runs` table. The `slug` column is the discriminator between agents. No agent-specific history tables exist or should be created.
**Rationale:** Adding a new agent requires zero schema changes — the table accepts any slug. The composite index on `(org_id, slug, run_at DESC)` makes per-agent history queries efficient regardless of how many agents are writing to the same table.
**Constraints it must not violate:** `persistRun` must be the only code path that writes to `agent_runs`. Neither agent code nor agent route code may write to `agent_runs` directly. History must be consistent whether a run is triggered via HTTP or cron.
**References:** `README  -- very important.md` — "agent_runs Is the Only History Table" section; `LEARNINGS--very important.md` — "The Single Write Path" and "agent_runs Is the Only History Table" sections.

---

### createAgentRoute as the Platform Routing Primitive
**Date:** 2026-03-28
**Status:** Settled
**Context:** Each agent needs HTTP endpoints for triggering a run (SSE) and retrieving history. Without a factory, every agent would write its own route file with duplicated auth middleware, SSE header setup, error handling, and persistence logic.
**Decision:** All agent HTTP endpoints are created by calling `createAgentRoute({ slug, runFn, requiredPermission })`. No agent writes its own router code. The factory owns all plumbing: auth middleware, SSE header setup, progress/result/error event emission, `[DONE]` on both success and error paths, and history persistence to `agent_runs`.
**Rationale:** A new agent needs only `tools.js`, `prompt.js`, `index.js`, and a four-line route file that calls `createAgentRoute`. Agent authors write zero routing code.
**Constraints it must not violate:** Agent-specific code must not be placed in `createAgentRoute.js`. The factory must remain generic. Admin config enforcement (kill switch, model, token limits) is loaded inside the factory before every run — no agent can bypass it.
**References:** `README  -- very important.md` — `createAgentRoute` section and "createAgentRoute — Admin Config Enforcement" section; `LEARNINGS--very important.md` — "The Registration Contract" section.

---

### AgentScheduler as the Platform Cron Primitive
**Date:** 2026-03-28
**Status:** Settled
**Context:** Agents need scheduled (cron) execution in addition to manual HTTP-triggered runs. Without a shared scheduler, each agent would manage its own node-cron setup, producing duplicate code and inconsistent history records.
**Decision:** All agent cron scheduling uses `AgentScheduler` at `server/platform/AgentScheduler.js`. This lightweight wrapper calls `runFn` on each tick and persists results to `agent_runs` via the shared `persistRun` function. Schedule changes call `AgentScheduler.updateSchedule(slug, newSchedule)` which takes effect immediately without a server restart.
**Rationale:** The scheduler is zero agent-specific code. It resolves `orgId` from the DB if omitted, handles errors without crashing the process, and shares the same `persistRun` write path as the HTTP route — ensuring history is consistent regardless of trigger source.
**Constraints it must not violate:** Agent code must not configure node-cron directly. All cron jobs must go through `AgentScheduler`. `persistRun` must remain the single write path to `agent_runs` for both scheduled and HTTP-triggered runs.
**References:** `README  -- very important.md` — `AgentScheduler.register` section and `AgentScheduler` Hot-Reload section; `LEARNINGS--very important.md` — `AgentScheduler` Hot-Reload section; `Learnings-ToolsForge.md` — "AgentScheduler — Implementation Notes" section.

---

### No New npm Packages Without Explicit Confirmation
**Date:** 2026-03-28
**Status:** Settled
**Context:** A missing Recharts dependency was silently replaced with a bespoke SVG implementation buried in an agent-specific folder, producing a non-reusable one-off and violating the platform-first principle. A missing `googleapis` dependency caused Railway deploy failures because the package was installed at the project root rather than inside `server/`, where the Dockerfile copies from.
**Decision:** When an assumed dependency is missing, stop and surface the missing dependency to the user and wait for direction before writing any workaround. Do not silently create alternative implementations. Every `require(pkg)` in `server/` must be backed by an entry in `server/package.json`; always run `cd server && npm install <pkg>`, never `npm install <pkg>` from the project root.
**Rationale:** Silent workarounds encode agent-specific behaviour in platform-level locations or create non-reusable one-offs. Railway deploys only from `server/` — root-level installs are invisible to the container build.
**Constraints it must not violate:** No new npm package may be added to the server or client without explicit user confirmation. When a workaround is genuinely needed (zero-dependency fallback), it must be placed as a platform primitive with generic props, not in an agent-specific folder.
**References:** `LEARNINGS--very important.md` — "The Recharts Lesson" section and "Railway Deploy — Missing Dependency (googleapis)" section.

---

### All Monetary Values in AUD
**Date:** 2026-03-28
**Status:** Settled
**Context:** Google Ads API returns all monetary values in micros (millionths of the currency unit as an integer). Storing or displaying raw micros would require every consumer to know the conversion factor.
**Decision:** All monetary values returned by `GoogleAdsService` are in AUD. Conversion from `cost_micros` is performed inside the service (÷ 1,000,000) before returning to callers. The unit AUD must be documented explicitly on every field that carries a monetary value.
**Rationale:** Consistent currency denomination at the service boundary means no consumer needs to know the micros convention. The platform currency is AUD.
**Constraints it must not violate:** Raw micros must never be stored in the DB or returned to the UI without the unit being explicitly documented. Conversion must happen inside `GoogleAdsService`, not at call sites.
**References:** `Learnings-ToolsForge.md` — "`cost_micros` pattern" bullet; `TOOLSFORGE_README.md` — GoogleAdsService description: "All monetary values returned in AUD (cost_micros ÷ 1,000,000)."

---

### Backwards Compatibility Required for All Changes to Platform Primitives
**Date:** 2026-03-28
**Status:** Settled
**Context:** Platform primitives (`createAgentRoute`, `AgentScheduler`, `persistRun`, `MarkdownRenderer`, `LineChart`, the `agent_runs` schema) are consumed by all existing and future agents. A breaking change to any primitive breaks every agent that depends on it.
**Decision:** All changes to platform primitives must be backwards compatible. Existing agents must continue to function without modification after any platform update.
**Rationale:** The platform-first principle: every abstraction must be reusable by future agents, and existing agents must not be broken by platform evolution. The AgentOrchestrator bug fix (stripping internal fields before sending to Anthropic) is an example: the fix was applied once to the platform and applied to all future agents with no per-agent workaround needed.
**Constraints it must not violate:** No platform primitive may be modified in a way that requires existing agent code to be updated. New capabilities are additive. Tool names in registered tools must be stable because they are used as keys by `extractToolData` and read directly by the UI (`run.data.<tool_name>`).
**References:** `LEARNINGS--very important.md` — "extractToolData — Generic JSONB Storage from the Trace" (tool naming stability); `Learnings-ToolsForge.md` — "Wiring Domain Services into the Agent Platform" (AgentOrchestrator bug fix applies to all future agents); `README  -- very important.md` — "All primitives are reusable by any future agent."

---

### Account Intelligence Profile — Typed Schema with Shared Base Plus Agent-Specific Extension Field
**Date:** 2026-03-28
**Status:** Open Question — not evidenced in source files
**Context:** Decision item listed for documentation.
**Decision:** Not populated — no reference to "Account Intelligence Profile", typed schema, shared base, or extension field was found in any of the four source files.
**References:** None found.

---

### Account Intelligence Profile Build Sequence — v0.3.1 Correctness Patch Before v0.4.0 Feature Work
**Date:** 2026-03-28
**Status:** Open Question — not evidenced in source files
**Context:** Decision item listed for documentation.
**Decision:** Not populated — no reference to "v0.3.1", "v0.4.0", "correctness patch", or a sequenced build plan was found in any of the four source files.
**References:** None found.

---

### Config Authority Split — Admin Settings vs Agent Settings
**Date:** 2026-03-28
**Status:** Settled
**Context:** An agent has two categories of settings with different authority levels: cost and security guardrails (model, max tokens, kill switch) that only an administrator should control, and analytical/scheduling settings (lookback days, thresholds, schedule) that an operator configures. Mixing them into one store or one page creates ambiguity about who has authority over what.
**Decision:** Config is split across two stores with separate access controls. Admin settings (model, max tokens, max iterations, kill switch) are stored in `system_settings` under key `agent_<slug>`, accessible only to `org_admin`. Agent/operator settings (schedule, analytical thresholds, lookback) are stored in `agent_configs` (one row per `(org_id, slug)`), readable by any authenticated user and writable by `org_admin`. Admin and operator settings are presented on separate UI pages: `/admin/agents` for admin guardrails; the Agent Settings panel inside the tool page for operational settings.
**Rationale:** An operator must never accidentally or intentionally change cost guardrails while editing analytical thresholds. Separate tables with separate API routes enforce this at the server layer. `AgentConfigService` is the canonical access pattern — agent and route code never read from either table directly.
**Constraints it must not violate:** Agent code must read config through `AgentConfigService`, not by querying `system_settings` or `agent_configs` directly. Admin config enforcement (kill switch, model, token limits) is applied inside `createAgentRoute` before any agent code runs. No agent can bypass admin guardrails.
**References:** `LEARNINGS--very important.md` — "Two-Store Config Pattern — Admin vs Agent Settings" section and "Admin/Operator Settings Boundary — UI Design" section; `README  -- very important.md` — "Agent Configuration System" and `AgentConfigService` sections.

---

### Every New Abstraction Must Be Reusable by Future Agents, Not Google Ads Specific
**Date:** 2026-03-28
**Status:** Settled
**Context:** The first domain agent (Google Ads Monitor) produced several components and utilities. Without a platform-first rule, these would accumulate as agent-specific one-offs that cannot be reused by the second, third, or later agents.
**Decision:** Every abstraction built during agent development must be designed as a platform primitive with generic props/interface, not as an agent-specific implementation. If a component or utility is only needed by one agent but is broadly applicable (charts, markdown rendering, progress indicators), it must be placed in the platform layer (`client/src/components/`, `client/src/components/charts/`, `server/platform/`) with a generic interface. Agent-specific code belongs only in the agent's own folder.
**Rationale:** The Recharts lesson is the canonical example: a bespoke SVG chart was placed in an agent-specific folder. The correct resolution was to promote it to `client/src/components/charts/LineChart.jsx` with a generic prop interface (`data`, `xKey`, `leftKey`, `rightKey`, `leftFormat`, `rightFormat`, `leftColor`, `rightColor`) so any future agent can use it. `MarkdownRenderer` follows the same principle: one rendering component for all LLM text output, improvements propagate everywhere.
**Constraints it must not violate:** No platform-level file (`createAgentRoute.js`, `MarkdownRenderer.jsx`, `LineChart.jsx`) may contain agent-specific logic. The convention is absolute: if a component displays LLM-generated text, it uses `MarkdownRenderer`. If a component charts time-series data, it uses `LineChart` or `PerformanceChart` (Recharts). Agent authors do not write their own renderers or chart implementations.
**References:** `LEARNINGS--very important.md` — "The Recharts Lesson" section and "MarkdownRenderer — Platform Primitive for LLM Output" section; `README  -- very important.md` — "All primitives are reusable by any future agent."

---

### Account Intelligence Profile — Typed Schema with Shared Base Plus Agent-Specific Extension Field
**Date:** 2026-03-28
**Status:** Settled
**Context:** The Google Ads Monitor agent produced a damning campaign critique while ignoring a 7x ROAS and 10% conversion rate at account level. The agent had no baseline for what good looks like — it applied its analytical heuristics to per-campaign data without any knowledge of declared account-level targets or business context. Any agent analysing business data faces this correctness gap if it has no access to the operator's declared objectives.
**Decision:** A typed `intelligence_profile` JSONB column is added to the `agent_configs` table (idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`). The profile has a shared base (all agents): `targetROAS`, `targetCPA`, `businessContext`, `analyticalGuardrails`. Plus an `agentSpecific` extension field (open JSONB, agent-owned keys). Google Ads agent uses: `conversionRateBaseline`, `averageOrderValue`, `typicalConversionLagDays`. The profile is formatted by the platform primitive `buildAccountContext(profile, agentSlug)` and injected as the first block of the system prompt before any analytical instructions.
**Rationale:** Storing the profile in `agent_configs` (not a new table) follows the existing two-store config pattern. The shared-base-plus-extension shape keeps `buildAccountContext` generic and reusable by every future agent without modification. Injecting the context block first means Claude sees declared targets before reading any data or analytical heuristics — ensuring the profile has maximum influence on reasoning.
**Constraints it must not violate:** `buildAccountContext` must contain no agent-specific logic — the `agentSpecific` extension field is the mechanism for agent-owned data. The profile must be returned by `AgentConfigService.getAgentConfig()` as part of the merged config (no separate API call). Agents must still function correctly when the profile is null or empty (function returns `''`, prompt starts with the role block).
**References:** `server/platform/buildAccountContext.js`; `server/agents/googleAdsMonitor/prompt.js`; `server/db.js` (ALTER TABLE); `client/src/pages/AdminAgentsPage.jsx` (IntelligenceProfileSection).

---

### Account Intelligence Profile Build Sequence — v0.3.1 Correctness Patch Before v0.4.0 Feature Work
**Date:** 2026-03-28
**Status:** Confirmed — build complete, acceptance test passed
**Context:** The agent platform was functional (v0.2.0) but produced analytically incorrect output: a 7x ROAS account was flagged for campaigns that were in fact performing strongly. Shipping additional features on top of incorrect analytical reasoning would compound the problem. A correctness patch was required before any v0.4.0 feature work.
**Decision:** v0.3.1 shipped as a four-deliverable correctness patch only: (1) `intelligence_profile` column on `agent_configs`, (2) `buildAccountContext` platform utility, (3) Intelligence Profile panel on AdminAgentsPage, (4) prompt restructure with account context block first and baseline-verification instruction last. No features beyond these four were added.
**Rationale:** Correctness before features. A broken analytical baseline contaminates every recommendation the agent produces. Fixing it is a higher-priority prerequisite than adding new capabilities.
**Constraints it must not violate:** Scope was fixed to four deliverables. `createAgentRoute`, `AgentScheduler`, `persistRun`, and `agent_runs` schema were not modified. No new npm packages were added. No new tables were created.

**Acceptance test — confirmed passed 2026-03-28:**
1. ✅ `agent_configs` table has `intelligence_profile` column (idempotent `ADD COLUMN IF NOT EXISTS`)
2. ✅ `buildAccountContext` returns a non-empty string for a populated profile and `''` for null/`{}` — verified by smoke test (all assertions pass)
3. ✅ `IntelligenceProfileSection` renders in `AdminAgentsPage` and saves via `PUT /api/agent-configs/:slug` using the existing endpoint
4. ✅ `prompt.js` opens with the account context block (when profile is set) followed by role, data sources, analytical instructions, output format, and baseline-verification instruction
5. ⏳ Live account run against a declared 7x ROAS baseline — pending first run after Railway deploy

**References:** `server/platform/buildAccountContext.js`; `server/agents/googleAdsMonitor/prompt.js`; `server/db.js`; `client/src/pages/AdminAgentsPage.jsx`.

---

### Known Limitation — Single Account, No Campaign-Specific Queries
**Date:** 2026-03-28
**Status:** Accepted — deferred to MCP rebuild
**Context:** Google Ads Monitor v0.3.1 runs a single monolithic report against one hardcoded account. No mechanism exists to scope analysis to a specific campaign or run comparative queries across campaigns.
**Decision:** Not fixed in ToolsForge. Deferred to MCP project where campaigns become discrete Resources and campaign-specific queries become parameterised tool calls.
**Rationale:** Fixing this within the current ToolsForge agent architecture would require significant redesign of the tool layer. The MCP rebuild provides a cleaner structural solution — campaigns as Resources is idiomatic MCP and the correct long-term approach.
**Constraints it must not violate:** No partial fix to be made in ToolsForge that would create migration friction for the MCP rebuild.
**Impact:** Single-account, single-report-type limitation remains in production.
**References:** None — deferred, not yet implemented.

---

---

### MCP_curamTools Scaffold — Resolved Annotation Decisions
**Date:** 2026-03-28
**Status:** Settled — all SECTION-ANNOTATION.md items resolved in the first scaffold session

| Decision | Resolution |
|---|---|
| Toast z-index | `z-[9999]` — adopted Vault's value |
| Corner radius | `rounded-xl` buttons/inputs, `rounded-2xl` containers/modals |
| Modal dismiss | Backdrop + Escape + explicit × close button |
| TopNav height | 56px (h-14) |
| `Button` component | **Created** — `Button.jsx` with variants: primary, secondary, danger, icon, toggle |
| Markdown renderer | Custom zero-dependency renderer with fenced code block support added (platform will return code from agents) |
| Assistant message avatar | None — multi-tenant workspace signal |
| Transition duration | `transitionDuration: { DEFAULT: '200ms' }` set in tailwind.config.js |
| `:focus-visible` ring | Global `*:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }` in index.css |
| Tailwind CSS variable mapping | Configured — bg-bg, text-primary, border-border etc. in tailwind.config.js |

---

### persistRun Separation — Own File in platform/
**Date:** 2026-03-28
**Status:** Settled
**Context:** PLATFORM-PRIMITIVES.md documented persistRun as exported from createAgentRoute.js. The MCP_curamTools scaffold spec lists it as a separate file `server/platform/persistRun.js`.
**Decision:** `persistRun` lives in `server/platform/persistRun.js` and is imported by both `createAgentRoute.js` and `AgentScheduler.js`. This is cleaner and makes the single-write-path contract more explicit.

---

### agent_runs Schema — Simplified for MCP
**Date:** 2026-03-28
**Status:** Settled
**Context:** ToolsForge agent_runs had separate columns (summary, data, suggestions, duration_ms, token_count). The MCP scaffold uses a consolidated `result JSONB` column that holds all of these as a structured object `{ summary, data, suggestions, tokensUsed }`.
**Decision:** `result JSONB` replaces the separate columns. This reduces schema surface area. The `persistRun` function writes the full result object. UI reads `run.result.summary`, `run.result.data`, `run.result.suggestions`.

---

### Zustand Store Keys
**Date:** 2026-03-28
**Status:** Settled
**Context:** SECTION-5-UX.md specified `curam-mcp-auth`. The session scaffold prompt specified `mcp-curamtools-auth`. The scaffold prompt is the authority.
**Decision:** Storage keys are `mcp-curamtools-auth`, `mcp-curamtools-settings`, `mcp-curamtools-tool`.

---

---

### Three-Pillar Architectural Roadmap — Staged Implementation
**Date:** 2026-03-29
**Status:** Settled — All three stages complete
**Context:** Analysis of the platform's architectural gaps identified three foundational pillars required before any domain agents are built. These pillars were absent from the initial scaffold and must be implemented in sequence because each stage provides the foundation the next one builds on.
**Decision:** Implement in three discrete stages:
- **Stage 1 — Multi-Server Discovery (MCPRegistry):** DB-backed registry + connection lifecycle. ✅ Complete.
- **Stage 2 — Resource-Level Permissions:** `mcp_resources` + `resource_permissions` tables, `PermissionService` extension, admin API surface. ✅ Complete.
- **Stage 3 — Budget-Aware Circuit Breaker:** `CostGuardService` + budget integration in `createAgentRoute` + org-level daily budget in `system_settings`. ✅ Complete.
**Rationale:** Each stage is independently deliverable and testable. Agents should not be built until all three stages are complete — building agents on an incomplete platform foundation creates migration friction later.
**Constraints it must not violate:** Stage 2 must not require changes to `mcp_servers` table schema. Stage 3 must not require changes to `createAgentRoute`'s public interface (`{ slug, runFn, requiredPermission }`).

---

### Stage 1 — Multi-Server Discovery via MCPRegistry
**Date:** 2026-03-29
**Status:** Settled — Complete
**Context:** The initial platform scaffold had an inbound MCP server (`mcpServer.js`) but no mechanism to connect *to* remote MCP servers. Tool slugs were hardcoded. As agents grow, each would need to manage its own transport connections, duplicating code and bypassing security boundaries.
**Decision:** `MCPRegistry` singleton at `server/platform/mcpRegistry.js` is the only code path that connects to remote MCP servers. All connections are DB-backed (via `mcp_servers` table) and org-scoped. The registry exposes `register`, `deregister`, `list`, `get`, `connect`, `disconnect`, `send` — agents never construct their own HTTP or stdio transports.
**Rationale:** Centralising connection management in a platform primitive means security (org scoping, ownership validation) is enforced once and applies to all future agents automatically. Stage 2 resource permissions can query `MCPRegistry.get(orgId, serverId)` as its scope check without touching transport code.
**Constraints it must not violate:** `org_id` must be sourced from `req.user.org_id` (verified session context) — never from request body or query params. Every DB operation and every `send()` call validates the `(org_id, serverId)` pair. Connection cleanup (`disconnectAll()`) must run on SIGTERM/SIGINT before process exit.
**References:** `server/platform/mcpRegistry.js`; `server/db.js` (`mcp_servers` table); `server/index.js` (graceful shutdown wiring).

---

### Stage 2 — Resource-Level Permissions
**Date:** 2026-03-29
**Status:** Settled — Complete
**Context:** MCPRegistry provided org-scoped server connections but no control over which users or roles could access specific resource URIs within those servers. Without this layer, any authenticated user with access to an agent could implicitly reach any resource the agent's server exposes.
**Decision:** Two new tables (`mcp_resources`, `resource_permissions`) and four new `PermissionService` methods establish resource URI-level access control. `canAccessResource(userId, resourceUri, orgId)` is the single check point. Deny-wins resolution: any deny rule overrides all allow rules. No matching rule is an implicit deny — the platform is default-deny for resources.
**Rationale:** Default-deny is the correct posture for a multi-tenant platform handling business-sensitive data. Admins explicitly grant access rather than revoke it.
**Constraints it must not violate:** `org_admin` bypasses all resource permission checks unconditionally. `resource_uri` is stored as denormalised TEXT in `resource_permissions` (not FK) — this allows permissions to exist before a resource record is explicitly registered and prevents cascade deletes from silently removing permissions. `org_id` is always from session context at every call site.
**References:** `server/db.js` (`mcp_resources`, `resource_permissions`); `server/services/PermissionService.js`; `server/routes/adminMcp.js`.

---

### resource_uri Denormalisation — TEXT Not FK
**Date:** 2026-03-29
**Status:** Settled
**Context:** `resource_permissions.resource_uri` could reference `mcp_resources.id` as a FK. This would enforce referential integrity but would prevent setting permissions before a resource record exists and would cascade-delete permissions if a resource record is cleaned up.
**Decision:** `resource_uri` is stored as TEXT in `resource_permissions`. Permissions can be pre-set before a resource is registered. Deleting a resource record does not delete its permissions.
**Rationale:** Permissions are security data. Losing them silently because a resource record was deleted is worse than having orphan permission rows. Orphan rows are harmless — they simply never match a real resource.

---

### user_id XOR role_name — Partial Indexes Over UNIQUE NULLS NOT DISTINCT
**Date:** 2026-03-29
**Status:** Settled
**Context:** `resource_permissions` requires that exactly one of `user_id` or `role_name` is set. A standard `UNIQUE(org_id, resource_uri, user_id, role_name)` cannot handle NULL distinctness correctly in PostgreSQL — two rows with the same user_id and NULL role_name would both be allowed. PostgreSQL 15 introduced `UNIQUE NULLS NOT DISTINCT` but partial indexes are more explicit.
**Decision:** Two partial unique indexes: `idx_resource_perm_user` on `(org_id, resource_uri, user_id) WHERE user_id IS NOT NULL` and `idx_resource_perm_role` on `(org_id, resource_uri, role_name) WHERE role_name IS NOT NULL`. A CHECK constraint enforces the XOR at insert time. The `ON CONFLICT` upsert syntax uses the column-predicate form matching the partial index.
**Rationale:** Explicit over clever. The partial index approach is readable, portable to older PG versions if needed, and makes the intent self-documenting.

---

### org_id Is Never Sourced from User-Supplied Data
**Date:** 2026-03-29
**Status:** Settled — applies to all platform primitives
**Context:** Stage 1 formalises a security rule that was implicit in the auth and agent layers but not yet documented as a platform-wide constraint.
**Decision:** `org_id` is always sourced from `req.user.org_id` (attached by `requireAuth` middleware from the verified session token). It is never read from `req.body`, `req.params`, or `req.query`. This applies to `MCPRegistry`, `AgentConfigService`, `persistRun`, and every future platform primitive.
**Rationale:** Allowing org_id in user-supplied data would let a user scope their request to another organisation's data by manipulating the payload. The session token is the only trusted source of org identity.
**Constraints it must not violate:** No route handler may pass `req.body.orgId` or `req.params.orgId` to any platform primitive. The linting rule: if a function accepts `orgId` as its first parameter, the call site must read it from `req.user.org_id`.

---

### Stage 3 — Budget-Aware Circuit Breaker
**Date:** 2026-03-29
**Status:** Settled — Complete
**Context:** Stages 1 and 2 established server discovery and resource permissions. Stage 3 adds cost safety: without a budget guardrail, an agent making recursive or expensive MCP tool calls can exceed budget before `max_tokens` kicks in. Two enforcement layers are required: per-task (configurable per agent by admin) and daily org-wide (a ceiling across all agents).
**Decision:** `CostGuardService` (`server/services/CostGuardService.js`) is the single enforcement point. It exports `computeCostAud`, `getDailyOrgSpendAud`, `check`, and `BudgetExceededError`. `createAgentRoute` loads budget context once at run start and calls `check()` after each accumulation event and again post-run with the definitive token count. `max_task_budget_aud` is added to `ADMIN_DEFAULTS._platform` in `AgentConfigService.js`. Daily org budget lives in `system_settings` under key `platform_budget`. `costAud` is written to `agent_runs.result` JSONB on every successful run.
**Rationale:** Separating per-task and daily org limits allows fine-grained control without coupling them. The pure-function design of `check()` (no DB queries mid-stream) keeps latency low. Persisting `costAud` in the result payload means the UI can display actual run cost without recomputing from tokens.
**Constraints it must not violate:** `createAgentRoute` public interface (`{ slug, runFn, requiredPermission }`) must not change. Existing agents with no token reporting must still receive post-run checks — the mid-run enforcement is opt-in via the `emit` second param. `check()` must remain a pure function with no async behaviour.
**References:** `server/services/CostGuardService.js`; `server/platform/createAgentRoute.js`; `server/platform/AgentConfigService.js`.

---

### Pure-function check() — daily spend loaded once at run start
**Date:** 2026-03-29
**Status:** Settled
**Context:** A naive circuit breaker design would query `usage_logs` on every `emit()` call to get the current daily spend. At high emit frequency this produces O(n) DB queries per run — unnecessary load that grows with run length.
**Decision:** `getDailyOrgSpendAud(orgId)` is called exactly once at run start and the result is stored in a local variable. `CostGuardService.check()` receives the pre-loaded `dailyOrgSpendAud` as a parameter and performs no DB queries — it is a pure synchronous function. The pre-loaded spend is a snapshot; if another concurrent run for the same org finishes mid-stream, the snapshot is slightly stale. This is accepted: the daily limit is a soft ceiling, not a hard transaction guarantee.
**Rationale:** A single DB query at run start vs O(n) queries during a run is the correct tradeoff for an operational safety guardrail. Perfect atomicity would require pessimistic locking across all concurrent agent runs — unacceptable complexity for a soft budget limit.
**Constraints it must not violate:** `check()` must never perform IO. It accepts `{ taskCostAud, maxTaskBudgetAud, dailyOrgSpendAud, maxDailyBudgetAud }` and throws or returns synchronously. Callers own the accumulation and snapshotting.

---

### Opt-in mid-run enforcement via emit second param
**Date:** 2026-03-29
**Status:** Settled
**Context:** `createAgentRoute`'s `emit` callback already streams progress text to the SSE client. Existing agents call `emit(text)`. Adding mandatory budget accumulation to `emit` would require every existing agent to supply token counts — a breaking change. Budget enforcement must be additive.
**Decision:** `emit` is extended to accept an optional second parameter: `emit(text, partialTokensUsed)`. If `partialTokensUsed` is provided, `createAgentRoute` accumulates the cost and calls `CostGuardService.check()`. If omitted (existing agents), no mid-run check occurs. A definitive post-run check always runs using the final `tokensUsed` returned by `runFn` — this catches over-budget runs even for agents that never pass `partialTokensUsed` to `emit`.
**Rationale:** Backwards compatible — zero changes required to existing agents. New agents opt in to granular mid-run enforcement by supplying `partialTokensUsed`. The post-run check provides a safety net regardless.
**Constraints it must not violate:** The `emit(text)` single-argument form must continue to work exactly as before. `BudgetExceededError` thrown inside `emit` must propagate through `runFn` to the existing catch block — no new error paths in `createAgentRoute`.

---

### costAud persisted in agent_runs.result
**Date:** 2026-03-29
**Status:** Settled
**Context:** `agent_runs.result` is a JSONB column holding `{ summary, data, suggestions, tokensUsed }`. Without storing computed cost, the UI would need to recompute AUD cost from `tokensUsed` using the current rate constant — coupling the UI to the cost model and producing stale values if rates change.
**Decision:** `costAud` (a number, AUD, rounded to 6 decimal places) is added to the `result` JSONB on every run. The value is the definitive post-run cost computed by `CostGuardService.computeCostAud(tokensUsed)`.
**Rationale:** Storing the computed value at run time is the correct pattern: it locks in the rate that was in effect, avoids recomputation in every UI consumer, and allows historical cost display without coupling the UI to the cost model. `result` JSONB is the right location — no schema change required.
**Constraints it must not violate:** `costAud` is stored as AUD, consistent with the platform-wide monetary convention. It must be computed from the definitive post-run `tokensUsed`, not from mid-run accumulated estimates.

---

### Stage 4 — Admin MCP UI Integration
**Date:** 2026-03-29
**Status:** Settled — Complete
**Context:** Stages 1–3 built the backend APIs for MCP server discovery, resource-level permissions, and budget enforcement. None of that work was operable without a UI — an admin had to use raw curl to register servers, resources, or permissions. Stage 4 closes the gap.
**Decision:** Two new admin pages built as React components following the existing admin page pattern. No new backend routes, no schema changes, no new packages. UI only.
- `AdminMcpServersPage` (`/admin/mcp-servers`) — register, connect/disconnect, delete MCP servers
- `AdminMcpResourcesPage` (`/admin/mcp-resources`) — register resources, manage permissions (two sections, one page)
Both pages added to `App.jsx` under the existing `RequireRole(['org_admin'])` guard and to `Sidebar.jsx` under the Admin section.
**Rationale:** Building the UI last (after the API is stable) means the UI is built against a known, tested interface. The two-section layout of AdminMcpResourcesPage (resources + permissions together) reflects the operational workflow: an admin registers a resource and then immediately sets permissions — they are adjacent operations.
**Constraints it must not violate:** Admin pages never call platform primitives directly — all data access goes through the `/api/admin/*` routes. `org_id` continues to be sourced from `req.user.orgId` on the server; the UI never sends an `orgId` in the request body.

---

### UsageLogger as the Single Write Path to usage_logs
**Date:** 2026-03-29
**Status:** Settled
**Context:** The `usage_logs` table was defined in the platform scaffold and read by `CostGuardService.getDailyOrgSpendAud()` for budget enforcement. No code was writing to it — the Admin Logs page was always empty and the daily budget check always saw zero spend regardless of actual usage.
**Decision:** `UsageLogger` (`server/services/UsageLogger.js`) is the only code path that writes to `usage_logs`. It is called from `createAgentRoute` on the success path, fire-and-forget (logging failures must never affect agent responses). No agent code or route code may write to `usage_logs` directly.
**Rationale:** Mirroring the `persistRun`/`agent_runs` pattern: one table, one write path, enforced at the platform layer. Calling from `createAgentRoute` means every agent gets usage logging automatically with zero per-agent code.
**Constraints it must not violate:** `logUsage` must remain fire-and-forget at the call site. A failure to log must never surface as an agent error. `org_id` must be sourced from `req.user.orgId`, never from user-supplied input.
**References:** `server/services/UsageLogger.js`; `server/platform/createAgentRoute.js`; `server/services/CostGuardService.js` (`getDailyOrgSpendAud` reads this table).

---

### Admin UI Parity with ToolsForge
**Date:** 2026-03-29
**Status:** Ongoing
**Context:** MCP_curamTools was scaffolded with functional but minimal admin pages. ToolsForge, the predecessor single-tenant platform, has richer admin UI developed over many iterations. Rather than reinventing, the decision is to port ToolsForge admin features selectively — adopting what works and replacing ToolsForge-specific patterns with MCP_curamTools equivalents.
**Decision:** Each admin page is brought to ToolsForge feature parity in turn, then adapted: ToolsForge component patterns (raw `<button>` with inline styles) are replaced with MCP_curamTools primitives (`Button`, `Modal`, `InlineBanner`). ToolsForge-specific backend calls (different route paths, different response shapes) are mapped to MCP_curamTools routes. Feature additions that don't apply (ToolsForge tool-access per-user roles) are replaced with MCP_curamTools equivalents (org-role grant/revoke).
**Pages ported (in order):** Email Templates (tabs, preview iframe, click-to-insert variables, auto-generate plain text) → Models (add/edit/delete/reset, API key status, per-model test) → Users (Manage Access modal replacing separate Edit + Delete modals, role toggle, profile editing).
**Constraints it must not violate:** No ToolsForge-specific route paths or response shapes in MCP_curamTools. `org_id` always from `req.user.orgId`. PermissionService is the only code path for role grants/revocations.

---

### Role Management HTTP Endpoints
**Date:** 2026-03-29
**Status:** Settled
**Context:** The Users page needs to grant and revoke the `org_admin` role without a full user update (`PUT /users/:id` replaces the entire role). A finer-grained API is needed so the UI can toggle admin independently of other profile edits.
**Decision:** Three endpoints are added to `server/routes/admin.js`: `GET /users/:id/roles` (returns current role assignments), `POST /users/:id/grant-role` (grants a named role at a given scope), `POST /users/:id/revoke-role` (revokes it). These are thin wrappers over `PermissionService.getUserRoles`, `grantRole`, and `revokeRole` — no permission logic lives in the route handler.
**Rationale:** Matches the pattern from ToolsForge (`grant-role`/`revoke-role` sub-resource endpoints). Keeps PermissionService as the single write path for all role changes. Guarded by the existing `router.use(requireAuth, requireRole(['org_admin']))` — no per-route middleware needed. Self-demotion is blocked server-side.
**Constraints it must not violate:** An admin may not grant/revoke their own `org_admin` role (server enforces). `org_id` scoping — the target user must belong to `req.user.orgId`. PermissionService functions are the only callers of role SQL.
**References:** `server/services/PermissionService.js` (`grantRole`, `revokeRole`, `getUserRoles`); `server/routes/admin.js`.

---

### Admin Diagnostics Page
**Date:** 2026-03-29
**Status:** Settled
**Context:** Operators need a way to verify that all external integrations (database, AI API, email, MCP servers, Google APIs) are correctly configured without diving into Railway logs or running manual curl commands.
**Decision:** A `POST /admin/diagnostics` route in `server/routes/admin.js` runs all checks server-side and returns a JSON array of `{ name, ok, detail }` objects. The frontend page (`client/src/pages/admin/AdminDiagnosticsPage.jsx`) shows the results in a pass/fail table triggered by a "Run Checks" button.
**Rationale:** Server-side execution means secrets never leave the server. A single endpoint covers all checks. The MailChannels check uses `https.request` (not `fetch`) — consistent with the fix in `EmailService.js` and the railway+undici+MailChannels incompatibility. The MCP Registry check (`MCPRegistry.list(orgId)`) is the MCP-specific addition over the ToolsForge equivalent.
**Checks (in order):** Database (`SELECT NOW()`), Anthropic API (minimal haiku call), MailChannels (`https.request` probe — 401/403 = bad key, 4xx = key valid), MCP Registry (connected server count), Google OAuth (token refresh), Google Ads API (GAQL minimal query), Google Analytics GA4 (minimal report).
**Constraints it must not violate:** The route is protected by `router.use(requireAuth, requireRole(['org_admin']))` — no additional middleware needed. The diagnostics route must never perform side effects (no emails sent, no data written). Run checks are always initiated manually — no scheduling.
**References:** `server/routes/admin.js` (POST /diagnostics); `client/src/pages/admin/AdminDiagnosticsPage.jsx`.

---

### Org Structure — Departments, Custom Roles, and Per-User Default Model
**Date:** 2026-03-29
**Status:** Settled — Complete
**Context:** ToolsForge had a flat user model: every user had exactly one of two roles (`admin` or `member`). MCP_curamTools needs to support organisations with internal structure — multiple teams (departments), varied responsibilities (custom roles), and different tool preferences (default model). This is the first feature that goes beyond ToolsForge parity.
**Decision:** Three orthogonal additions to the user model, all scoped to `org_id`:
1. **Departments** (`departments` + `user_departments` tables) — named groups with a colour, many-to-many with users. An admin creates and edits departments on `/admin/departments`; assigns users via the Manage modal on `/admin/users`. Pure grouping — no access control implications.
2. **Custom Org Roles** (`org_roles` table + `user_roles` rows) — admin-defined named roles beyond `org_admin`/`org_member`. The role `name` (slug) is auto-derived from `label` via `toSlug()` at creation and is immutable thereafter — it becomes the `role_name` key in `user_roles` (`scope_type = 'global'`), making it compatible with `requireRole()` checks and `resource_permissions`. An admin creates and edits roles on `/admin/org-roles`; assigns users via the Manage modal.
3. **Default Model** (`default_model_id` column on `users`) — the user's preferred LLM. Set per-user in the Manage modal's Default Model section via `PUT /users/:id`. Persisted as a model ID string; the UI shows a select of enabled models.
**Rationale:** Departments answer "who is this user?" for display and reporting without coupling to access control. Custom roles answer "what can this user do?" using the existing `user_roles` + `PermissionService` infrastructure — no new permission code required. Per-user default model answers "which model does this user prefer?" with a single column, no separate table needed.
**Constraints it must not violate:** Custom org role assignments via `PUT /users/:id/org-roles` must only touch custom roles — the route first queries all valid org_role names for the org and restricts its DELETE/INSERT to that set, leaving `org_admin`/`org_member` assignments untouched. `PermissionService.grantRole`/`revokeRole` remain the only code paths for all role mutations. `org_id` is always from `req.user.orgId`. Role name slugs are stable and immutable after creation — they are used as role_name keys in user_roles and resource_permissions.
**Schema additions (all idempotent):**
- `ALTER TABLE users ADD COLUMN IF NOT EXISTS default_model_id TEXT`
- `CREATE TABLE IF NOT EXISTS departments (id, org_id, name, description, color, UNIQUE(org_id, name))`
- `CREATE TABLE IF NOT EXISTS user_departments (user_id, department_id, PRIMARY KEY(user_id, department_id))`
- `CREATE TABLE IF NOT EXISTS org_roles (id, org_id, name, label, description, color, UNIQUE(org_id, name))`
- `CREATE INDEX IF NOT EXISTS idx_user_departments_user_id ON user_departments(user_id)`
**API surface (all under `router.use(requireAuth, requireRole(['org_admin']))`):**
- `GET/POST /admin/departments`, `PUT/DELETE /admin/departments/:id`
- `GET/POST /admin/org-roles`, `PUT/DELETE /admin/org-roles/:id`
- `GET/PUT /admin/users/:id/departments`
- `GET/PUT /admin/users/:id/org-roles`
- `GET /admin/users/:id/roles` (existing, now also returns custom org role assignments)
**References:** `server/db.js`; `server/routes/admin.js`; `client/src/pages/admin/AdminDepartmentsPage.jsx`; `client/src/pages/admin/AdminOrgRolesPage.jsx`; `client/src/pages/admin/AdminUsersPage.jsx` (ManageModal).

---

### toSlug — Role Name Immutability Contract
**Date:** 2026-03-29
**Status:** Settled
**Context:** Custom org role names are used as `role_name` keys in `user_roles` and `resource_permissions`. If a role's slug could be renamed, all existing user assignments and resource permissions referencing the old name would become orphaned — no FK constraint catches this because `role_name` is stored as denormalised TEXT.
**Decision:** The `name` (slug) field of an org role is set once at creation via `toSlug(label)` and cannot be modified thereafter. The `PUT /admin/org-roles/:id` route accepts only `label`, `description`, and `color` — the `name` field is ignored. The UI shows the auto-generated slug during creation with the note "immutable after creation" and shows the fixed slug on the edit form.
**toSlug implementation:** `label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')`
**Rationale:** Immutability is the correct posture for any value used as a join key in other tables without FK enforcement. Changing the slug would silently orphan all downstream references. The UI shows the slug prominently so admins can verify the generated key before committing.
**Constraints it must not violate:** The server-side `PUT /org-roles/:id` must never update the `name` column. The `DELETE /org-roles/:id` handler must clean up `user_roles` rows for the role's name before deleting the org_roles row — in that order, within a transaction if possible.
**References:** `server/routes/admin.js` (`PUT /admin/org-roles/:id`, `DELETE /admin/org-roles/:id`); `client/src/pages/admin/AdminOrgRolesPage.jsx` (`toSlug`).

---

## Open Questions

_(No remaining open questions for the scaffold. First agent will add entries to AGENT_DEFAULTS and ADMIN_DEFAULTS in AgentConfigService.js.)_
