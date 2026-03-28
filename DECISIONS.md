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

## Open Questions

_(Previously open questions #7 and #8 have been resolved above. No remaining open questions.)_
