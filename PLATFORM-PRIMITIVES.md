# PLATFORM-PRIMITIVES.md

## Project Context
**This is an internal learning project for one organisation, built and maintained by a solo developer.** Platform primitives are designed for this context — reusable, simple, and solo-developer maintainable. Read [PROJECT_IDENTITY.md](./PROJECT_IDENTITY.md) for the full context.

## Foundational References
- **TOOLSFORGE_README.md** — ToolsForge platform and agent feature inventory
- **Learnings-ToolsForge.md** — ToolsForge technical patterns and implementation knowledge
- **README  -- very important.md** — Curam Vault feature inventory (predecessor single-user app)
- **LEARNINGS--very important.md** — Curam Vault technical patterns and reusable patterns

These files are the source of truth. The documents below derive from them and reference them by name rather than duplicating their content.

---

### createAgentRoute
**Type:** Route Factory
**Location:** `server/platform/createAgentRoute.js`
**What it does:** Returns an Express router with `POST /run` (SSE) and `GET /history` endpoints wired with auth, SSE plumbing, admin config enforcement, run persistence, and error handling — zero agent-specific code.
**Interface:**
```js
createAgentRoute({ slug, runFn, requiredPermission })
// slug: string — agent identifier (e.g. 'google-ads-monitor')
// runFn: async (context) => { result, trace, tokensUsed } — the agent entry point
// requiredPermission: string — role name; org_admin always satisfies the check
```
Returns an Express router. Two endpoints are registered:

| Endpoint | Auth | Behaviour |
|---|---|---|
| `POST /run` | requireAuth + requireRole([org_admin, requiredPermission]) | Loads admin config, checks kill switch, streams SSE: `{ type: 'progress', text }` → `{ type: 'result', data }` → `[DONE]` (or `{ type: 'error', error }` → `[DONE]`) |
| `GET /history` | requireAuth | Returns last 20 `agent_runs` rows for this slug + org, ordered by `run_at DESC` |

Internal helpers exported from this file:
- `extractToolData(trace)` — keyed tool results from AgentOrchestrator trace
- `extractSuggestions(text)` — parses `### Recommendations` numbered list into `[{text, priority}]`
- `persistRun({ slug, orgId, status, summary, trace, tokensUsed, startTime })` — single write path to `agent_runs`

**Stage 3 budget integration (additive — public interface unchanged):**
- After the kill switch check, `createAgentRoute` loads org budget settings (`AgentConfigService.getOrgBudgetSettings`) and the daily org spend (`CostGuardService.getDailyOrgSpendAud`) in a single DB query. If the daily budget is already exceeded before the run starts, the route aborts immediately with a `BudgetExceededError`.
- `emit` accepts an optional second parameter: `emit(text, partialTokensUsed)`. If provided, the route accumulates `taskCostAud` and calls `CostGuardService.check()` mid-run. Existing agents calling `emit(text)` are unaffected.
- A definitive post-run `CostGuardService.check()` always runs using the final `tokensUsed` returned by `runFn`.
- `costAud` is added to `resultPayload` and persisted in `agent_runs.result` JSONB on every completed run.

**Used by:** Google Ads Monitor (`server/routes/agents/`); all future agents.
**Reuse contract:** Provide `slug` (stable, lowercase, hyphen-separated), a `runFn(context)` that returns `{ result, trace, tokensUsed }`, and a `requiredPermission` role name. Register the returned router in `server/index.js` under `/api/agents/:slug`.
**Does not handle:** Agent tool registration (done in the agent's `tools.js`), system prompt construction (done in the agent's `prompt.js`), data fetching (done in domain services). Does not write directly to `agent_executions` (that is `services/AgentScheduler.js` territory).

---

### UsageLogger
**Type:** Service
**Location:** `server/services/UsageLogger.js`
**What it does:** Writes one row to `usage_logs` after each completed agent run or conversation turn. Captures all token types including prompt cache tokens, and stores cost in AUD directly.
**Interface:**
```js
await logUsage({ orgId, userId, slug, modelId, tokensUsed, costAud })
// tokensUsed: { input, output, cacheRead, cacheWrite } — from AgentOrchestrator
// costAud: number — from CostGuardService.computeCostAud(tokensUsed)
```
`cost_usd` is derived internally as `costAud / 1.55`. `cost_aud` is the source of truth.

**Analytics endpoint:** `GET /api/admin/usage-stats?days=7|30|90` returns aggregated totals, per-model, per-tool, and daily breakdowns. Cache savings estimated at `cache_read_tokens × $2.70/1M USD × 1.55`.

**UI:** Admin › Token Usage (`/admin/usage`) — `AdminUsagePage.jsx`.

**Callers:** `createAgentRoute` (all SSE agents), `routes/conversation.js` (each turn), `routes/admin.js` (NLP SQL). Called fire-and-forget — errors are logged but never rethrow.

**Known gap:** `routes/docExtractor.js` passes `{ input, output }` only — `cacheRead`/`cacheWrite` are missing from doc extraction rows.

**Reuse contract:** Call after a successful run. Pass the full `tokensUsed` object from `AgentOrchestrator` — do not construct a partial object. Always use `??` not `||` for token fields (null must not silently become 0 when the orchestrator returns a real 0).

---

### AgentScheduler.register
**Type:** Cron
**Location:** `server/platform/AgentScheduler.js`
**What it does:** Registers a cron job for an agent slug; stops any existing job for that slug before registering the new one (idempotent).
**Interface:**
```js
AgentScheduler.register({ slug, schedule, runFn, orgId })
// slug: string — agent identifier
// schedule: string — raw node-cron expression (e.g. '0 6,18 * * *')
// runFn: async (context) => any — agent entry point
// orgId: number | null — if null, resolved from DB (single active org fallback)
```
On each cron tick: resolves `orgId` if omitted, calls `runFn`, persists result to `agent_runs` via shared `persistRun`. Logs success/failure. Handler errors never rethrow — a failing agent cannot crash the process.

**Multi-customer array return:** If `runFn` returns an array of `{ customerId, result, status, error }` objects, `_tick` persists one `agent_runs` row per element (with `customer_id` populated) and closes the initial placeholder row with `{ multi: true, count: N }`. Single-object returns (existing agents) are unchanged — backward compatible.

**Used by:** Google Ads Monitor registration (schedule: `'0 6,18 * * *'`).
**Reuse contract:** Provide `slug`, a valid cron expression, and a `runFn`. Document the UTC↔local offset in a comment at the registration site. For multi-customer agents: return an array from `runFn`; each element must include `{ customerId, status }` at minimum.
**Does not handle:** HTTP-triggered runs (those go through `createAgentRoute`). Does not parse or validate cron expressions — invalid expressions are passed directly to node-cron.

---

### AgentScheduler.updateSchedule
**Type:** Cron
**Location:** `server/platform/AgentScheduler.js`
**What it does:** Stops the existing cron task for a slug and re-registers it with a new cron expression — no server restart required.
**Interface:**
```js
AgentScheduler.updateSchedule(slug, newSchedule)
// slug: string — must match a previously registered slug
// newSchedule: string — new node-cron expression
```
Additional method on the same class:
```js
AgentScheduler.getSchedule(slug)
// Returns the current cron expression string for the given slug
```
**Used by:** `PUT /api/agent-configs/:slug` route — called when the `schedule` field changes in an operator config update.
**Reuse contract:** Call after `AgentConfigService.updateAgentConfig()` confirms the schedule field changed. Pass the new cron expression from the updated config.
**Does not handle:** Validation of the cron expression. Persistence of the new schedule (that is handled by `AgentConfigService.updateAgentConfig`).

---

### persistRun
**Type:** Utility
**Location:** `server/platform/createAgentRoute.js` (exported)
**What it does:** Writes a single structured run record to the `agent_runs` table — the only code that may write to this table.
**Interface:**
```js
persistRun({ slug, orgId, status, summary, trace, tokensUsed, startTime })
// slug: string — agent identifier
// orgId: number — organisation FK
// status: 'running' | 'complete' | 'error'
// summary: string — agent result text (or error message)
// trace: array — AgentOrchestrator trace steps (stored as JSONB in data column after extractToolData)
// tokensUsed: object — { input, output, cacheRead, cacheWrite }
// startTime: Date — used to compute duration_ms
```
**Used by:** `createAgentRoute.js` POST /run handler; `server/platform/AgentScheduler.js` cron tick handler.
**Reuse contract:** Never call from agent code or domain service code. Always call through `createAgentRoute` (HTTP path) or `platform/AgentScheduler` (cron path).
**Does not handle:** Writing to `agent_executions` (written by `services/AgentScheduler.js`). Writing intermediate `running` status rows — that is handled inside `createAgentRoute` before `runFn` is called.

---

### agent_runs Table Schema
**Type:** Table
**Location:** `server/db.js` (defined in `initializeSchema()`)
**What it does:** Stores all agent run history — for every agent, regardless of trigger source — as the single UI-facing history record.
**Interface:**
```sql
agent_runs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      INTEGER,           -- FK → organizations
  slug        TEXT,              -- agent identifier e.g. 'google-ads-monitor'
  status      TEXT,              -- 'running' | 'complete' | 'error' | 'needs_review'
  summary     TEXT,              -- agent result text or error message
  data        JSONB,             -- tool results keyed by tool name (from extractToolData)
  suggestions JSONB,             -- [{text, priority}] (from extractSuggestions)
  run_at      TIMESTAMPTZ,       -- when the run started
  duration_ms INTEGER,           -- computed from startTime
  token_count INTEGER            -- total tokens used
)
-- Index: (org_id, slug, run_at DESC)
```
`slug` is the sole discriminator between agents. No agent-specific tables exist.
**Used by:** All agents via `persistRun`; `GET /history` endpoint in `createAgentRoute`; `GoogleAdsMonitorPage.jsx` (reads `run.data.<tool_name>` and `run.suggestions`).
**Reuse contract:** New agents write to `agent_runs` through `persistRun` only. Tool names in registered tools must be stable because `data` keys are derived from tool names and read directly by UI code.
**Does not handle:** Low-level execution tracing (that is `agent_executions`, written by `services/AgentScheduler.js`). Agent key-value memory state (that is `agent_states`).

---

### agent_configs Table Schema
**Type:** Table
**Location:** `server/db.js` (defined in `initializeSchema()`)
**What it does:** Stores operator-level agent configuration — analytical thresholds, schedule, lookback settings, custom prompt, and account intelligence profile. Supports one org-default row (customer_id IS NULL) and any number of customer-specific override rows per (org_id, slug).
**Interface:**
```sql
agent_configs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               INTEGER NOT NULL,       -- FK → organizations
  slug                 TEXT NOT NULL,           -- agent identifier
  customer_id          TEXT DEFAULT NULL,       -- NULL = org default; set = customer-specific override
  config               JSONB DEFAULT '{}',      -- merged with AGENT_DEFAULTS at read time
  intelligence_profile JSONB,                   -- typed account context; injected first in system prompt
  custom_prompt        TEXT,                    -- operator-authored prompt extension; {{variable}} substitution
  updated_by           INTEGER,                 -- FK → users
  updated_at           TIMESTAMPTZ
  -- No inline UNIQUE constraint. Two partial indexes enforce uniqueness:
  --   idx_agent_configs_org_slug_default:  UNIQUE (org_id, slug) WHERE customer_id IS NULL
  --   idx_agent_configs_org_slug_customer: UNIQUE (org_id, slug, customer_id) WHERE customer_id IS NOT NULL
)
```
Admin config (model, max_tokens, max_iterations, kill switch) is stored separately in `system_settings` under key `agent_<slug_underscored>`, not in this table.
**Used by:** `AgentConfigService` (only access path); `PUT /api/agent-configs/:slug` route; `PUT /api/agent-configs/:slug/customers/:customerId` route.
**Reuse contract:** Never query this table directly from agent or route code. Use `AgentConfigService` methods. Add new agent defaults to `AGENT_DEFAULTS` in `AgentConfigService.js`. ON CONFLICT upserts must use column-predicate form matching the partial indexes — `ON CONFLICT (org_id, slug) WHERE customer_id IS NULL` for org defaults and `ON CONFLICT (org_id, slug, customer_id) WHERE customer_id IS NOT NULL` for customer-specific rows.
**Does not handle:** Admin guardrails (model, tokens, kill switch) — those are in `system_settings`.

---

### AgentConfigService
**Type:** Service
**Location:** `server/platform/AgentConfigService.js`
**What it does:** Canonical access layer for operator config (`agent_configs`) and admin config (`system_settings`). All methods return full merged configs; callers never see partial configs.
**Interface:**
```js
// ── Org-level operator config (customer_id IS NULL rows) ──────────────────

AgentConfigService.getAgentConfig(orgId, slug)
// Returns: AGENT_DEFAULTS merged with stored config + intelligence_profile + custom_prompt.
// Scoped to WHERE customer_id IS NULL. Falls back to defaults on DB error.

AgentConfigService.updateAgentConfig(orgId, slug, patch, updatedBy)
// Upserts patch. intelligence_profile and custom_prompt are separate columns (not inside config JSONB).
// ON CONFLICT (org_id, slug) WHERE customer_id IS NULL — must match partial index exactly.
// Returns merged result including intelligence_profile and custom_prompt.

// ── Customer-level operator config (customer_id IS NOT NULL rows) ─────────

AgentConfigService.getAgentConfigForCustomer(orgId, slug, customerId)
// Returns org-default merged with customer-specific overrides.
// Falls back to org default if no customer-specific row exists.

AgentConfigService.updateAgentConfigForCustomer(orgId, slug, customerId, patch, updatedBy)
// Upserts customer-specific config row.
// ON CONFLICT (org_id, slug, customer_id) WHERE customer_id IS NOT NULL.

AgentConfigService.listCustomerConfigs(orgId, slug)
// Returns all customer_id IS NOT NULL rows for (org, slug).
// Used by AgentScheduler to enumerate customers for multi-account scheduled runs.
// Returns: [{ customer_id, config, intelligence_profile, custom_prompt }]

// ── Admin config (system_settings) ───────────────────────────────────────

AgentConfigService.getAdminConfig(slug)
// Reads system_settings key 'agent_<slug_underscored>'. Returns ADMIN_DEFAULTS merged with stored JSON.

AgentConfigService.updateAdminConfig(slug, patch, updatedBy)
// Saves merged config to system_settings. Returns merged result.

// ── Org-level budget (system_settings key: 'platform_budget') ────────────

AgentConfigService.getOrgBudgetSettings(orgId)
// Returns: { max_daily_org_budget_aud: null } by default (null = unlimited).

AgentConfigService.updateOrgBudgetSettings(orgId, patch, updatedBy)
// patch: { max_daily_org_budget_aud: number | null }
```

**AGENT_DEFAULTS entries:**
- `google-ads-monitor`: `schedule`, `lookback_days=30`, `ctr_low_threshold=0.03`, `wasted_clicks_threshold=5`, `impressions_ctr_threshold=100`, `max_suggestions=8`
- `google-ads-freeform`: `max_suggestions=5`
- `google-ads-change-impact`: `lookback_days=7`, `max_suggestions=5`

**ADMIN_DEFAULTS entries** (all with `enabled`, `model='claude-sonnet-4-6'`, `max_task_budget_aud=0.50`):
- `google-ads-monitor`: `max_tokens=8192`, `max_iterations=10`
- `google-ads-freeform`: `max_tokens=8192`, `max_iterations=12`
- `google-ads-change-impact`: `max_tokens=8192`, `max_iterations=10`
- `_platform` (fallback for unregistered agents): `max_tokens=4096`, `max_iterations=10`

**Used by:** `createAgentRoute.js`; all agent `index.js` files; `PUT /api/agent-configs/:slug`; `PUT /api/agent-configs/:slug/customers/:customerId`; `AgentScheduler._tick` (array-return multi-customer path).
**Reuse contract:** New agents add entries to `AGENT_DEFAULTS` and `ADMIN_DEFAULTS`. Agent code reads config via `getAgentConfig` or `getAgentConfigForCustomer` — never queries tables directly. `custom_prompt` and `intelligence_profile` are returned as top-level fields on the merged config object alongside the JSONB config fields.
**Does not handle:** Permission checks (route layer). Cron rescheduling (route calls `AgentScheduler.updateSchedule` separately).

---

### MarkdownRenderer Component
**Type:** Component
**Location:** `client/src/components/MarkdownRenderer.jsx`
**What it does:** Renders LLM-generated markdown text as styled HTML — the single rendering component for all agent and chat LLM output on the platform.
**Interface:**
```jsx
<MarkdownRenderer text={string} />
// text: string — raw markdown string from an LLM response
```
Supported markdown features: `#`/`##`/`###` headings, `**bold**`, bullet lists, ordered lists, `---` horizontal rules, paragraphs, and markdown tables (consecutive `|`-prefixed lines). Styling uses platform CSS vars throughout (`--color-text`, `--color-surface`, `--color-border`, etc.). Zero external dependencies — line-by-line parser, no `marked` or `react-markdown`.

Infinite loop guard: the paragraph branch always increments `i` to prevent browser hangs when a line starts with `#` but has no space (e.g. `#hashtag`).

Table parsing helpers:
```js
function parseTableRow(row) {
  return row.split('|').slice(1, -1).map(c => c.trim());
}
function isTableSeparator(row) {
  return parseTableRow(row).every(c => /^[\s:-]+$/.test(c));
}
```
**Used by:** `GoogleAdsMonitorPage.jsx` (Full Analysis block); `ChatPage.jsx` (assistant messages — updated from `whitespace-pre-wrap`).
**Reuse contract:** Any component that displays LLM-generated text uses `MarkdownRenderer`. Do not use `<pre>` or `whitespace-pre-wrap` for agent or chat output. Improvements to rendering (code blocks, links) are made once here and propagate everywhere.
**Does not handle:** Code block syntax highlighting. Hyperlink rendering. Streaming partial text (caller manages streaming state and passes complete or partial text as a string).

---

### LineChart.jsx Component
**Type:** Component
**Location:** `client/src/components/charts/LineChart.jsx`
**What it does:** Zero-dependency SVG dual-axis line chart for time-series data.
**Interface:**
```jsx
<LineChart
  data={array}          // array of objects
  xKey={string}         // key for x-axis values (e.g. 'date')
  leftKey={string}      // key for left-axis series (e.g. 'cost')
  rightKey={string}     // key for right-axis series (e.g. 'conversions')
  leftLabel={string}    // y-axis label for left series
  rightLabel={string}   // y-axis label for right series
  leftFormat={function} // optional formatter for left-axis tooltip values
  rightFormat={function}// optional formatter for right-axis tooltip values
  leftColor={string}    // optional CSS colour for left series line
  rightColor={string}   // optional CSS colour for right series line
/>
```
**Used by:** Available as platform primitive for any agent; Google Ads Monitor uses `PerformanceChart.jsx` (Recharts) for its primary chart. `LineChart.jsx` was promoted from a bespoke agent-specific SVG implementation to a generic platform component.
**Reuse contract:** Use when Recharts is unavailable or a zero-dependency fallback is required. Provide `data`, `xKey`, `leftKey`, and `rightKey` at minimum.
**Does not handle:** More than two data series per chart. Bar charts or pie charts. Legend rendering beyond axis labels.

---

### extractToolData
**Type:** Utility
**Location:** `server/platform/createAgentRoute.js` (internal, exported indirectly via route factory)
**What it does:** Walks the AgentOrchestrator trace steps and keys each tool result by tool name into a JSONB-ready object.
**Interface:**
```js
extractToolData(trace)
// trace: array — AgentOrchestrator trace steps (traceStep[].toolResults[])
// Returns: { [toolName]: result, ... }
// Example: { "get_campaign_performance": [...], "get_search_terms": [...] }
```
Generic — knows nothing about which agent ran. The UI reads `run.data.get_campaign_performance` directly using the tool name as the key.
**Used by:** `createAgentRoute.js` before calling `persistRun`; Google Ads Monitor UI components read the resulting `data` object.
**Reuse contract:** Tool names must be stable, lowercase, underscore-separated identifiers. Do not rename a tool after the UI is reading from its key. The convention — tool names are the keys — is what makes this generic and requires no per-agent configuration.
**Does not handle:** Nested or de-duplicated tool results. Multiple calls to the same tool (later results overwrite earlier ones for the same tool name).
**Post-extraction validation:** After `extractToolData`, `createAgentRoute` immediately calls `validateToolData(toolData)` — see the `validateToolData` entry below. The extracted `data` object is unchanged; `validateToolData` only reads it.

---

### validateToolData
**Type:** Utility
**Location:** `server/platform/validateToolData.js`
**What it does:** Post-run structural integrity check for tool results. Pure function — no IO, no side effects. Walks each key in the `extractToolData` output, looks up a matching schema in `TOOL_SCHEMAS`, runs the validator, and collects failure messages. Returns `boundsFailed[]` — an empty array means all checked tools passed.
**Interface:**
```js
const { validateToolData } = require('./validateToolData');

validateToolData(toolData, schemas?)
// toolData:  { [toolName]: result } — output of extractToolData
// schemas:   optional override for testing; defaults to TOOL_SCHEMAS from toolSchemas.js
// Returns:   Array<{ tool: string, message: string }>
// Example:   [{ tool: 'get_campaign_performance', message: '2 rows with CTR outside [0,1]' }]
```
**Called by:** `createAgentRoute.js` between `extractToolData` and `persistRun`. Never called from agent code.
**Reuse contract:** Do not call from agent code or route handlers. Extend coverage by adding schemas to `toolSchemas.js` — no changes to `validateToolData` needed.
**Does not handle:** Semantic/bounds validation against account targets — that is the future `analyticalGuardrails` code layer. `validateToolData` checks structural shape only (correct types, valid ranges for domain-independent properties like CTR ∈ [0,1]).

---

### toolSchemas
**Type:** Utility
**Location:** `server/platform/toolSchemas.js`
**What it does:** Registry of pure validator functions for tool result shapes. Each entry is `(result) => string[]`. Validators use counters to aggregate failures by type — a 500-row array with bad CTR produces one message (`"500 rows with CTR outside [0,1]"`), not 500 messages. Maximum `boundsFailed` entries across all three current schemas: 10.
**Current schemas:**

| Tool name | Checks |
|---|---|
| `get_campaign_performance` | Array shape; CTR ∈ [0,1]; cost ≥ 0; conversions ≥ 0; clicks ≤ impressions |
| `get_daily_performance` | Array shape; date matches `YYYY-MM-DD`; cost ≥ 0; clicks ≤ impressions |
| `get_search_terms` | Array shape; term is non-empty string; CTR ∈ [0,1] if present; cost ≥ 0 |

**Extending:** add a new entry to `TOOL_SCHEMAS`. Pattern:
```js
function validateMyTool(result) {
  const failures = [];
  if (!Array.isArray(result)) { failures.push('expected array, got ' + typeof result); return failures; }
  let badX = 0;
  for (const row of result) {
    if (/* bad condition */) badX++;
  }
  if (badX > 0) failures.push(`${badX} row(s) with X invalid`);
  return failures;
}
TOOL_SCHEMAS.my_tool_name = validateMyTool;
```
**Reuse contract:** Validators must be pure — no async, no IO, no mutation. Use counters not per-row push. Always handle the non-array case first and return early. Validator throws are caught by `validateToolData` — they will not crash a run.

---

### BoundsWarningPanel
**Type:** Component
**Location:** `client/src/components/ui/BoundsWarningPanel.jsx`
**What it does:** Amber inline warning panel displaying `boundsFailed` entries from a `needs_review` run. Null-renders when `boundsFailed` is absent or empty — safe to render unconditionally on any result view.
**Interface:**
```jsx
<BoundsWarningPanel boundsFailed={result.boundsFailed} />
// boundsFailed: Array<{ tool: string, message: string }> | undefined | null
// Returns null when boundsFailed is empty/absent; renders amber panel with failure list otherwise
```
Renders: a heading with failure count, a `<ul>` of `tool: message` items in monospace tool name, and a one-line advisory note ("AI analysis completed. Review flagged values before acting on this report.").
**Used by:** `GoogleAdsMonitorPage.jsx` — in both the live result card and the history run expanded view.
**Reuse contract:** Import in any tool page that displays run results. Place it immediately before `<MarkdownRenderer>` in the result body. Do not add tool-specific logic to this component — it is generic.

---

### extractSuggestions
**Type:** Utility
**Location:** `server/platform/createAgentRoute.js` (internal, exported indirectly via route factory)
**What it does:** Parses the `### Recommendations` numbered list from an agent's final response text and assigns priority by position.
**Interface:**
```js
extractSuggestions(text)
// text: string — agent final response text
// Returns: [{ text: string, priority: 'high' | 'medium' | 'low' }]
// Priority assignment: items 1–2 → 'high', 3–5 → 'medium', 6+ → 'low'
```
This function is prompt-format dependent: it expects the agent prompt to produce a `### Recommendations` numbered list. The format dependency is intentional — the parser is kept simple and the structure contract is in the prompt where it belongs.
**Used by:** `createAgentRoute.js` before calling `persistRun`; `AISuggestionsPanel.jsx` reads `run.suggestions`.
**Reuse contract:** Future agent prompts must include a `### Recommendations` numbered list if they want priority-ordered suggestions. Do not change `extractSuggestions` without auditing every prompt that relies on it. Do not change the `### Recommendations` section of any agent prompt without updating `extractSuggestions`.
**Does not handle:** Suggestions outside the `### Recommendations` section. Non-numbered list formats. Sections with different heading text.

---

### substitutePromptVars
**Type:** Utility
**Location:** `server/platform/substitutePromptVars.js`
**What it does:** Replaces `{{variable}}` placeholders in a prompt template string with values from a vars map. Unknown placeholders are left intact — no silent data loss.
**Interface:**
```js
const { substitutePromptVars } = require('../../platform/substitutePromptVars');

substitutePromptVars(template, vars)
// template: string | null — prompt string with {{var}} placeholders; null/undefined returned as-is
// vars: object — key/value substitution map
// Returns: string — template with known placeholders replaced; unknown placeholders unchanged

// Example:
substitutePromptVars('Focus on {{customer_name}} ({{customer_id}}).', {
  customer_name: 'Acme Corp',
  customer_id:   '123-456-7890',
});
// → 'Focus on Acme Corp (123-456-7890).'
```
Placeholder syntax `{{variable}}` matches the `EmailTemplateService` convention. Pure function — no async, no DB access, no side effects.
**Used by:** All agent `prompt.js` files that support `custom_prompt` injection.
**Reuse contract:** Any agent that injects `config.custom_prompt` into its system prompt must call `substitutePromptVars(config.custom_prompt, customerVars)` before appending. The `customerVars` object should include `{ customer_id, customer_name }` for multi-customer agents. Single-account agents pass `{}`.
**Does not handle:** Nested variable substitution. Conditional blocks. Escaping of `{{` literals.

---

### buildSystemPrompt convention
**Type:** Convention
**Location:** `server/agents/<slug>/prompt.js` (one per agent)
**What it does:** Builds the complete system prompt for an agent, injecting live config values, account context, and optional operator custom prompt.
**Interface (standard signature):**
```js
buildSystemPrompt(config = {}, customerVars = {})
// config:        merged config object from AgentConfigService (includes thresholds, custom_prompt, intelligence_profile)
// customerVars:  { customer_id, customer_name } — substituted into custom_prompt via substitutePromptVars
// Returns: string — complete system prompt

// Injection order (canonical):
// 1. accountContextBlock (buildAccountContext result + '---\n\n' separator, or '' if null)
// 2. Role and analytical framework
// 3. Data sources and usage order
// 4. What to look for (analysis heuristics, thresholds from config)
// 5. Output format (required sections)
// 6. customPromptBlock ('## Operator Instructions\n' + substitutePromptVars result, or '' if null)
// 7. Baseline-verification instruction (last line — must see declared targets before finalising)
```
**All three Google Ads agents follow this signature.** Static prompt strings are acceptable only for agents with zero operator-configurable parameters.
**Used by:** `runGoogleAdsMonitor`, `runGoogleAdsFreeform`, `runGoogleAdsChangeImpact` — called at run time with freshly-loaded config from `AgentConfigService`.
**Reuse contract:** Every new agent exports `buildSystemPrompt(config = {}, customerVars = {})`. If the agent has no custom_prompt support, the second argument can be omitted or ignored.
**Does not handle:** Prompt caching structure. Date/time context injection. Admin config values (model, token limits) — those go into `AgentOrchestrator.run()` separately.

---

### AgentOrchestrator
**Type:** Platform Primitive — Singleton
**Location:** `server/platform/AgentOrchestrator.js`
**What it does:** The ReAct (Reason + Act) loop engine for all agents. Calls Claude, parses `tool_use` blocks, executes tools, feeds results back, and repeats until Claude produces a final text response or `maxIterations` is reached. Zero agent-specific code — it knows nothing about which agent is running.
**Interface:**
```js
const { result, trace, tokensUsed } = await agentOrchestrator.run({
  systemPrompt:  string,        // agent's full system prompt
  userMessage:   string,        // initial user message
  tools:         array,         // tool definitions from agent's tools.js
  model:         string,        // e.g. 'claude-sonnet-4-6'
  maxTokens:     number,        // token limit per Claude call
  maxIterations: number,        // max tool-use loops (default 10)
  onStep:        function,      // emit callback from createAgentRoute — called with progress text on each iteration
  context:       object,        // passed to each tool's execute(input, context) call
  thinking:      object|null,   // optional { type: 'enabled', budget_tokens: N } for extended thinking
});

// Returns:
// result:     { summary: string }  — the final text response from Claude
// trace:      array                — each step: { type, content, toolResults }
// tokensUsed: { input, output, cacheRead, cacheWrite } — accumulated across all iterations
```

**Tool stripping:** Before sending tool definitions to the provider, the orchestrator strips `execute`, `requiredPermissions`, `toolSlug`, and `cacheable` fields — these are agent-platform metadata, not part of the provider's tool schema.

**Full content preservation:** When feeding tool results back to Claude, the orchestrator passes the full assistant response content array (including any `thinking` blocks if extended thinking was active). This is required by the Anthropic API — stripping thinking blocks from multi-turn conversations causes an API error.

**Stopping condition:** The loop ends when Claude produces a `text` block without any `tool_use` in the same response, or when `maxIterations` is reached.

**Error behaviour:** Tool execution errors are caught per-tool and fed back to Claude as error text (not thrown) so the agent can recover or report the issue. An orchestrator-level error (e.g. Anthropic API failure) propagates to `createAgentRoute`'s catch block.

**Session-scoped tool result cache:** The orchestrator maintains a module-level `sessionCache` keyed by `orgId:userId`. Within a 5-minute TTL window, identical tool calls (same name + same JSON input) return the cached result without re-executing the tool. This eliminates redundant MCP round-trips when Claude calls the same tool twice in one run, or when a user sends a follow-up message that triggers the same fetch. Cache hits skip the `onStep` callback and record `fromCache: true` in the trace. Error results are never cached. To opt a tool out of caching, set `cacheable: false` on the tool definition — `getBudgetPacingTool` uses this because it returns live today's spend. The cache evicts expired entries every 5 minutes via a `setInterval` with `.unref()` to avoid blocking clean process exit.

**Used by:** All agents via their `index.js` `runFn`. Currently: `runGoogleAdsMonitor`.
**Reuse contract:** Agents never construct their own Anthropic API client. All Claude calls go through `agentOrchestrator.run()`. The `context` object is passed through verbatim to each tool's `execute()` — include `startDate`, `endDate`, `orgId`, `toolSlug` etc. at the `context` level, not inside tool input schemas. The cache session key uses `context.orgId` and `context.userId` — both must be present for correct scoping.
**Does not handle:** Tool registration or lookup (tools are passed as an array per run). Cost computation (callers use `CostGuardService.computeCostAud(tokensUsed)`). Prompt caching structure (handled in `platform/providers/anthropic.js`).

---

### buildAccountContext
**Type:** Utility
**Location:** `server/platform/buildAccountContext.js`
**What it does:** Formats the operator's `intelligence_profile` (stored in `agent_configs.config.intelligence_profile`) into a prompt-ready account context block. Injected as the first block of every agent's system prompt — before role instructions and analytical heuristics — so Claude sees declared business targets before interpreting any data.
**Interface:**
```js
const { buildAccountContext } = require('../../platform/buildAccountContext');

buildAccountContext(profile, agentSlug)
// profile:   object | null — intelligence_profile from agent config; null/empty → returns ''
// agentSlug: string — used to select agent-specific keys from profile.agentSpecific
// Returns:   string — formatted markdown block, or '' if profile is null/empty
```

**Profile shape (shared base + agent-specific extension):**
```js
{
  // Shared base — all agents
  targetROAS:          number | null,   // declared account-level ROAS target
  targetCPA:           number | null,   // declared CPA target (AUD)
  businessContext:     string,          // free text: business type, seasonality, budget constraints
  analyticalGuardrails: string,         // free text: what to ignore or treat carefully

  // Agent-specific extension — open JSONB, keyed by agent concern
  agentSpecific: {
    conversionRateBaseline:    number,  // Google Ads Monitor: account-level baseline CVR
    averageOrderValue:         number,  // Google Ads Monitor: declared AOV (AUD)
    typicalConversionLagDays:  number,  // Google Ads Monitor: days between click and conversion
  }
}
```

**Injection pattern:**
```js
const accountContext = buildAccountContext(config.intelligence_profile ?? null, 'google-ads-monitor');
const accountContextBlock = accountContext ? `${accountContext}\n---\n\n` : '';
return `${accountContextBlock}You are a Google Ads analyst...`;
```

**Rationale:** Placing the account context block first (before role instructions) gives it maximum influence on Claude's reasoning. An empty or null profile produces `''` so the prompt degrades gracefully — agents function correctly with no profile set.

**Used by:** `server/agents/googleAdsMonitor/prompt.js`. Must be used by all future agents that accept a configurable `intelligence_profile`.
**Reuse contract:** `buildAccountContext` must contain no agent-specific logic. The `agentSpecific` field is the extension point — agents add their own keys to it without modifying `buildAccountContext`. The function must return `''` (not throw) for null or `{}` profiles.
**Does not handle:** Validation of profile field types. Formatting of the `agentSpecific` block beyond what the agent's profile keys contain — each agent's prompt should document which `agentSpecific` keys it reads.

---

### GoogleAdsService
**Type:** Domain Service — Singleton
**Location:** `server/services/GoogleAdsService.js`
**What it does:** Google Ads REST API v23 client. Executes GAQL queries and returns normalised data ready for agent tool execution. All monetary values returned in AUD (÷ 1,000,000 from micros). Supports multi-account runs via optional `customerId` parameter on every method — if omitted, falls back to `GOOGLE_ADS_CUSTOMER_ID` env var.
**Interface:**
```js
const { googleAdsService } = require('../services/GoogleAdsService');

// All methods accept:
//   options:     number (days lookback) | { startDate, endDate } (ISO strings)
//   customerId:  string | null — overrides env default for multi-account runs

googleAdsService.getCampaignPerformance(options, customerId?)
// Returns: [{ id, name, status, budget(AUD), impressions, clicks, cost(AUD), conversions, ctr, avgCpc }]

googleAdsService.getDailyPerformance(options, customerId?)
// Returns: [{ date, impressions, clicks, cost(AUD), conversions }]
// Account-level daily aggregates ordered by date ASC.

googleAdsService.getSearchTerms(options, customerId?)
// Returns: [{ term, status, impressions, clicks, cost(AUD), conversions, ctr }]
// Top 50 search queries by clicks DESC.

googleAdsService.getBudgetPacing(customerId?)
// Returns: [{ name, monthlyBudget(AUD), spentToDate(AUD) }]
// Current-month budget pacing — no date param, always THIS_MONTH.

googleAdsService.getChangeHistory(options, customerId?)
// Returns: [{ changedAt, resourceType, changedFields, clientType, operation, campaignName }]
// Recent account change events: bids, budgets, statuses, ad edits. Ordered by changedAt DESC. Limit 50.
// Default lookback: 7 days.
```

**Authentication:** Uses `googleapis` for OAuth2 token rotation only. All API calls use native `fetch` to the Google Ads REST endpoint (v23). Token refresh is automatic on each call via `getAccessToken()`.

**Required env vars:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID`, `GOOGLE_ADS_MANAGER_ID`, `GOOGLE_ADS_DEVELOPER_TOKEN`.

**Used by:** All Google Ads agent tools.js files.
**Reuse contract:** New Google Ads agents import `googleAdsService` directly. Do not create agent-specific API clients. Add new GAQL query methods to `GoogleAdsService` when needed — do not implement queries inside agent `tools.js` files. Pass `customerId` from `context.customerId` in tool `execute()` calls.
**Does not handle:** Campaign mutation (read-only). Authentication token storage (refreshed on-demand).

---

### GoogleAnalyticsService
**Type:** Domain Service — Singleton
**Location:** `server/services/GoogleAnalyticsService.js`
**What it does:** Google Analytics Data API (GA4) v1beta client. Executes report queries against a configured GA4 property and returns normalised rows. Shared by all current and future Google Ads / analytics agents.
**Interface:**
```js
const { googleAnalyticsService } = require('../services/GoogleAnalyticsService');

// All methods accept either number (days) or { startDate, endDate }

googleAnalyticsService.getSessionsOverview(options)
// Returns: [{ date, sessions, activeUsers, newUsers, bounceRate }]
// Daily metrics ordered by date ASC. bounceRate is a decimal (0.42 = 42%).

googleAnalyticsService.getTrafficSources(options)
// Returns: [{ channel, sessions, conversions, totalRevenue }]
// Per-channel session and revenue breakdown.

googleAnalyticsService.getLandingPagePerformance(options)
// Returns: [{ page, sessions, conversions, bounceRate, avgSessionDuration }]
// Top 20 landing pages by session count.

googleAnalyticsService.getConversionEvents(options)
// Returns: [{ event, date, eventCount, conversions }]
// Conversion events only (conversions > 0), ordered by date ASC then conversions DESC.
```

**Authentication:** Same `googleapis` OAuth2 pattern as `GoogleAdsService`. Shares the same `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` env vars. Requires `GOOGLE_GA4_PROPERTY_ID`.

**Used by:** `server/agents/googleAdsMonitor/tools.js` (`get_analytics_overview` tool). Importable by any future analytics agent.
**Reuse contract:** Same as `GoogleAdsService` — import the singleton, add new methods if needed, don't create agent-specific clients.
**Does not handle:** GA4 event-level data. Realtime reporting. Multi-property queries.

---

## Curam Vault Patterns Explicitly Flagged as Reusable

The following patterns are from `LEARNINGS--very important.md` and `README  -- very important.md` (Curam Vault) and are explicitly flagged as reusable in the platform context.

---

### SSE Streaming Pattern
**Type:** Utility
**Location (Vault reference):** `server/routes/chat.js`, `client/src/hooks/useChat.js` (Curam Vault); adopted in ToolsForge as `server/routes/stream.js` and `createAgentRoute.js`
**What it does:** Server-to-client streaming of AI responses using Server-Sent Events.
**Interface:**
Server side:
```js
res.setHeader('Content-Type', 'text/event-stream');
res.setHeader('Cache-Control', 'no-cache');
res.setHeader('Connection', 'keep-alive');
res.setHeader('X-Accel-Buffering', 'no');  // disables nginx proxy buffering
res.flushHeaders();
res.write(`data: ${JSON.stringify(payload)}\n\n`);
// Always on both success AND error paths:
res.write('data: [DONE]\n\n');
res.end();
```
Client side (partial-line buffer pattern — non-negotiable):
```js
buf += decoder.decode(value, { stream: true });
const parts = buf.split('\n\n');
buf = parts.pop();  // last element may be incomplete
```
**Reuse contract:** The SSE implementation in `createAgentRoute.js` must match `server/routes/stream.js` exactly. Do not deviate. If a new streaming pattern is needed, update both files together. Always emit `[DONE]` on both success and error paths. Always set `X-Accel-Buffering: no` or nginx proxy buffering will destroy the streaming UX.
**Does not handle:** Bidirectional communication (use WebSockets for that). Reconnection on network drop.

---

### Hot-Reloadable Cron from Database
**Type:** Service
**Location (Vault reference):** `server/utils/newsDigestCron.js` (Curam Vault); pattern adopted in ToolsForge `server/platform/AgentScheduler.js`
**What it does:** Stores cron schedule in a settings table; when config changes via API, cancels the existing node-cron job and creates a new one immediately — no server restart.
**Interface:**
```js
let currentJob = null;
function applySchedule(time, days) {
  if (currentJob) currentJob.stop();
  const cronExpr = buildCronExpression(time, days);
  currentJob = cron.schedule(cronExpr, runDigest);
}
```
**Reuse contract:** Applies to any background job with user-configurable timing. Store the schedule in a settings or config table. When config changes via PUT endpoint, stop the old job and create a new one. Reference held at module level.
**Does not handle:** Validation of cron expressions. Recovery from a job that crashes mid-execution (the container absorbs failure).

---

### RAG Pipeline (chunker + embeddings + pgvector + graceful fallback)
**Type:** Service
**Location (Vault reference):** `server/services/chunker.js`, `server/services/embeddings.js` (Curam Vault); `server/agents/chunkingService.js`, `server/agents/embeddingService.js` (ToolsForge)
**What it does:** Splits extracted text into ~500-token chunks at sentence boundaries with 50-token overlap, embeds with Google `text-embedding-004` (768-dim), stores vectors in pgvector, and retrieves top-K relevant chunks by cosine similarity at query time.
**Interface (key functions):**
```js
// Chunking
chunkText(text, targetTokens, overlapTokens)
// Returns: array of chunk strings

// Embedding
embedText(text)       // → 768-dim float vector
embedBatch(texts)     // → array of vectors

// Retrieval (pgvector)
// SQL: SELECT ... ORDER BY embedding <=> $queryEmbedding LIMIT $topK
// WHERE org_id = $1  ← mandatory first predicate
```
**Reuse contract:** This setup is self-contained and extractable. Dependencies: pgvector on Postgres and a Google API key for text-embedding-004. Always include a graceful fallback path (full-text injection capped at a safe token limit). Always show a UI indicator when the fallback is active. The IVFFlat index requires data to exist before creation — wrap in try/catch on first run.
**Does not handle:** Embedding model selection (hard-coded to text-embedding-004 at 768 dims). Cross-org retrieval (org_id isolation is mandatory at the SQL layer).

---

### UsageLogger
**Type:** Service
**Location:** `server/services/UsageLogger.js`
**What it does:** Writes one row to `usage_logs` after each completed agent run — the only code path that may write to this table.
**Interface:**
```js
logUsage({ orgId, userId, slug, modelId, tokensUsed, costAud })
// orgId:      number  — organisation FK
// userId:     number  — user who triggered the run
// slug:       string  — agent identifier
// modelId:    string  — model used (from adminConfig.model)
// tokensUsed: object  — { input, output, cacheRead, cacheWrite }
// costAud:    number  — AUD cost computed by CostGuardService; converted to USD for storage
```
Returns a Promise. Always called fire-and-forget (`.catch` only) — a logging failure must never affect the agent response.

**Used by:** `createAgentRoute.js` success path only. Never called from agent code or other routes.
**Reuse contract:** `createAgentRoute` calls `logUsage` automatically after every successful run — no per-agent wiring required. Do not call `logUsage` from agent code. Do not write to `usage_logs` from any other location.
**Does not handle:** Failed or error runs (those are not logged — only complete runs generate a usage row). Mid-run token accumulation (that is `CostGuardService`).

---

### Idempotent Schema Initialisation
**Type:** Utility
**Location (Vault reference):** `server/db.js` in both Curam Vault and ToolsForge
**What it does:** All DDL (CREATE TABLE, ALTER TABLE ADD COLUMN, index creation) runs on every server start using IF NOT EXISTS guards. No migration tool, no manual steps.
**Interface:**
```sql
CREATE TABLE IF NOT EXISTS ...;
ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...;
-- Constraint additions:
DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL END $$;
```
**Reuse contract:** Every schema change must use `IF NOT EXISTS` or an equivalent idempotent guard. The entire schema file runs on every server start. This works until you need to modify an existing column type or constraint — at that point versioned migrations are required.
**Does not handle:** Column type changes on existing columns. Constraint modifications on live data. Concurrent schema evolution with multiple developers.

---

### Prompt Caching with Layered Blocks
**Type:** Utility
**Location (Vault reference):** `server/routes/chat.js` `buildSystemPrompt()` (Curam Vault)
**What it does:** Structures the Anthropic system prompt as an array of content blocks ordered by change frequency; marks each stable block with `cache_control: { type: 'ephemeral' }` to reduce token costs by 50–70% on rich contexts.
**Interface:**
```js
const blocks = [
  { type: 'text', text: personaText,      cache_control: { type: 'ephemeral' } },  // Block 1
  { type: 'text', text: projectBriefText, cache_control: { type: 'ephemeral' } },  // Block 2
  { type: 'text', text: memoryText,       cache_control: { type: 'ephemeral' } },  // Block 3
  { type: 'text', text: fileContext,      cache_control: { type: 'ephemeral' } },  // Block 4
  { type: 'text', text: todayDateText },  // Block 5 — no cache marker (dynamic)
];
// Hard limit: 4 cache breakpoints per request. Put dynamic content last with no cache marker.
```
**Reuse contract:** Never send system prompts as a flat string when using Anthropic. Order blocks by change frequency (most stable first). Put date/dynamic content last without a cache marker. Maximum 4 cache breakpoints per request.
**Does not handle:** Google Gemini (receives the same content flattened to a plain string). Runtime validation that budget_tokens is less than maxTokens when extended thinking is enabled.

---

---

### MCPRegistry
**Type:** Platform Primitive — Singleton
**Location:** `server/platform/mcpRegistry.js`
**What it does:** Manages the full lifecycle of remote MCP server connections for the platform. Provides a DB-backed registry of server configurations and in-memory connection management for live transports. All operations are org-scoped — `orgId` is the first parameter on every method and is sourced from `req.user.org_id`, never from user-supplied request data.
**Interface:**
```js
// DB layer — persists server configuration
MCPRegistry.register(orgId, { name, transportType, endpointUrl, config })
// transportType: 'sse' | 'stdio'
// endpointUrl: required for sse; null for stdio
// config: JSONB — for sse: { headers }; for stdio: { command, args, env }
// Upserts on (org_id, name). Returns the saved row.

MCPRegistry.deregister(orgId, serverId)
// Soft-deactivates (is_active = FALSE). Also disconnects any live connection. Throws if not found for org.

MCPRegistry.list(orgId)
// Returns all active servers for org. Each row includes connection_status: 'connected' | 'connecting' | 'disconnected'.

MCPRegistry.get(orgId, serverId)
// Returns single server row scoped to org_id. Returns null if not found or belongs to different org.

// Connection lifecycle
MCPRegistry.connect(orgId, serverId)
// Idempotent — no-op if already connected. Dispatches to _connectSSE or _connectStdio based on transport_type.

MCPRegistry.disconnect(orgId, serverId)
// Tears down live connection. Safe to call on unconnected server.

MCPRegistry.disconnectAll()
// Shuts down all connections. Called on SIGTERM/SIGINT in index.js.

// JSON-RPC dispatch
MCPRegistry.send(orgId, serverId, method, params)
// Sends a JSON-RPC request. Enforces org ownership at send time (not just at connect time).
// Returns Promise resolving with server's result. 30s timeout.

// Events (EventEmitter)
MCPRegistry.on('connected',     ({ serverId, name }) => {})
MCPRegistry.on('disconnected',  ({ serverId, reason }) => {})
MCPRegistry.on('notification',  ({ serverId, method, params }) => {})
```

**Transport: SSE** — Implements the MCP SSE transport spec:
1. GET to `endpoint_url` opens the SSE stream
2. Server emits an `endpoint` event with a POST URL for JSON-RPC messages
3. Client POSTs JSON-RPC to that URL; responses arrive via the SSE stream, correlated by `id`

**Transport: Stdio** — Spawns subprocess, sends MCP `initialize` handshake on connect, exchanges newline-delimited JSON-RPC via stdin/stdout. `config.command` is required.

**Security assertion:** `org_id` is mandatory and enforced on every DB operation and on every `send()` call. A server registered to org A can never be reached by org B. The registry never trusts `serverId` alone — it always validates the `(org_id, serverId)` pair against the DB.

**DB table:** `mcp_servers` — see table schema below.

**Used by:** Stage 2 (resource permissions) queries the registry to validate server ownership. Future agent routes call `connect()` and `send()` to communicate with external MCP servers.

**Reuse contract:** Never query `mcp_servers` directly from agent or route code. All access goes through `MCPRegistry`. When connecting to an external MCP server from within an agent, call `MCPRegistry.connect(req.user.org_id, serverId)` — never construct your own HTTP/stdio transport.

**Does not handle:** Authentication to remote MCP servers beyond passing `config.headers` (OAuth flows are the caller's responsibility). Connection pooling per org (one connection per registered server). Retry on disconnect (reconnect logic is the consumer's responsibility).

---

### mcp_servers Table Schema
**Type:** Table
**Location:** `server/db.js` (defined in `initSchema()`)
**What it does:** Persists the registry of remote MCP server configurations, one row per registered server per org.
**Interface:**
```sql
mcp_servers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  transport_type TEXT NOT NULL CHECK (transport_type IN ('sse', 'stdio')),
  endpoint_url   TEXT,           -- required for sse; null for stdio
  config         JSONB DEFAULT '{}',  -- headers (sse) | command/args/env (stdio)
  is_active      BOOLEAN DEFAULT TRUE,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (org_id, name)
)
```
`is_active = FALSE` is the deregistration state — rows are never hard-deleted. The `UNIQUE(org_id, name)` constraint ensures re-registering the same server name updates rather than duplicates.

**Used by:** `MCPRegistry` exclusively — no other code queries this table.

**Reuse contract:** Never query this table directly. All access through `MCPRegistry`. The `resource_permissions` table references `mcp_servers.id` via `mcp_resources.server_id` — this FK chain was designed to absorb Stage 2 without requiring changes to this table.

---

### mcp_resources Table Schema
**Type:** Table
**Location:** `server/db.js`
**What it does:** Stores the set of known MCP resource URIs registered against a server, scoped to an org. Resources are registered by an admin and act as the anchors for permission rules.
**Interface:**
```sql
mcp_resources (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id   UUID NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  uri         TEXT NOT NULL,          -- e.g. 'mcp://finance/invoices'
  name        TEXT NOT NULL,
  description TEXT,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (org_id, uri)                -- a URI is unique per org, not per server
)
```
**Used by:** `adminMcp.js` CRUD routes. `resource_permissions` references `resource_uri` as denormalised TEXT — intentional, see decision in DECISIONS.md.
**Reuse contract:** Always validate `server_id` ownership via `MCPRegistry.get(orgId, serverId)` before inserting. Never insert resources for a server belonging to a different org.

---

### resource_permissions Table Schema
**Type:** Table
**Location:** `server/db.js`
**What it does:** Grants or denies a user or role access to a specific MCP resource URI. Deny-wins: any matching deny rule overrides all allow rules. No matching rule means deny by default.
**Interface:**
```sql
resource_permissions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  resource_uri TEXT NOT NULL,         -- denormalised TEXT, not FK (intentional)
  user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,   -- null if role-based
  role_name    TEXT,                                              -- null if user-specific
  permission   TEXT NOT NULL CHECK (permission IN ('allow', 'deny')),
  granted_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  CHECK (
    (user_id IS NOT NULL AND role_name IS NULL) OR
    (user_id IS NULL AND role_name IS NOT NULL)
  )
)
-- Partial unique indexes handle NULL distinctness correctly:
CREATE UNIQUE INDEX idx_resource_perm_user ON resource_permissions(org_id, resource_uri, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX idx_resource_perm_role ON resource_permissions(org_id, resource_uri, role_name) WHERE role_name IS NOT NULL;
```
**Used by:** `PermissionService` exclusively — all four resource permission methods.
**Reuse contract:** Never query directly. ON CONFLICT upsert uses column-predicate form: `ON CONFLICT (org_id, resource_uri, user_id) WHERE user_id IS NOT NULL`. `UNIQUE NULLS NOT DISTINCT` is not used despite PG15 support — partial indexes are more explicit and portable.

---

### PermissionService — Resource Methods
**Type:** Service extension
**Location:** `server/services/PermissionService.js`
**What it does:** Four methods extending role-based permissions to cover MCP resource URI access.
**Interface:**
```js
PermissionService.canAccessResource(userId, resourceUri, orgId)
// org_admin → always true (checked first, no DB query needed for admins).
// Otherwise: fetches user's roles, checks resource_permissions for user_id OR role_name match.
// Deny-wins: any 'deny' row overrides all 'allow' rows.
// No matching row → false (deny by default).

PermissionService.grantResourcePermission(orgId, resourceUri, { userId, roleName }, permission, grantedBy)
// Exactly one of userId/roleName required — throws otherwise.
// Upserts — re-granting changes permission type in place.

PermissionService.revokeResourcePermission(orgId, permissionId)
// Hard delete. Throws if permissionId does not belong to orgId.

PermissionService.listResourcePermissions(orgId, resourceUri = null)
// All permissions for org; optional resourceUri filter. Joins users for email display.
```
**Security invariant:** `org_id` always from `req.user.orgId` at call sites. `org_admin` bypass is unconditional.
**Does not handle:** Wildcard URI matching. Time-limited permissions. Permission inheritance from parent URI paths.

---

### adminMcp.js — Admin MCP API Surface
**Type:** Route file
**Location:** `server/routes/adminMcp.js`
**Mounted at:** `/api/admin` alongside `routes/admin.js`. All routes require `org_admin`.

| Method | Path | Behaviour |
|---|---|---|
| GET | `/api/admin/mcp-servers` | List registered servers + live connection status |
| POST | `/api/admin/mcp-servers` | Register server (`MCPRegistry.register`) |
| DELETE | `/api/admin/mcp-servers/:id` | Soft-deregister + disconnect |
| POST | `/api/admin/mcp-servers/:id/connect` | Establish live connection |
| POST | `/api/admin/mcp-servers/:id/disconnect` | Tear down live connection |
| GET | `/api/admin/mcp-resources` | List resources (`?serverId=` optional filter) |
| POST | `/api/admin/mcp-resources` | Register resource URI (validates server ownership first) |
| DELETE | `/api/admin/mcp-resources/:id` | Remove resource record |
| GET | `/api/admin/mcp-resources/permissions` | List permissions (`?resourceUri=` optional filter) |
| POST | `/api/admin/mcp-resources/permissions` | Grant permission |
| DELETE | `/api/admin/mcp-resources/permissions/:id` | Revoke permission |

**Route ordering invariant:** `GET /mcp-resources/permissions` must be declared before `DELETE /mcp-resources/permissions/:id`. Express matches in declaration order — if `:id` comes first, the literal string `permissions` matches it as a param.

---

---

### CostGuardService
**Type:** Service
**Location:** `server/services/CostGuardService.js`
**What it does:** All budget enforcement logic for the platform. Four exports: a cost conversion function, a DB query for daily org spend, a pure synchronous check function, and a typed error class. No export performs IO except `getDailyOrgSpendAud`.

**Token cost constants:**
```js
const AUD_PER_USD = 1.55;  // approximate; documented as such in the source file

// Approximate Claude Sonnet 4.6 rates (USD per million tokens):
// Input:       $3.00   → 0.000003 USD/token
// Output:      $15.00  → 0.000015 USD/token
// Cache read:  $0.30   → 0.0000003 USD/token
// Cache write: $3.75   → 0.00000375 USD/token
```

**Interface:**
```js
// Pure function — no IO
computeCostAud({ input, output, cacheRead, cacheWrite })
// tokensUsed object → AUD cost as a number
// Uses the rate constants above × AUD_PER_USD

// Single DB query — call once at run start
getDailyOrgSpendAud(orgId)
// Queries usage_logs: SUM(cost_usd * 1.55) WHERE org_id = $1 AND created_at >= today UTC
// Returns: number (AUD). Returns 0 if no rows.

// Pure function — no IO, no async
check({ taskCostAud, maxTaskBudgetAud, dailyOrgSpendAud, maxDailyBudgetAud })
// taskCostAud: number — accumulated cost for this run so far
// maxTaskBudgetAud: number | null — per-task limit from admin config (null = unlimited)
// dailyOrgSpendAud: number — snapshot loaded at run start
// maxDailyBudgetAud: number | null — org-wide daily limit from system_settings (null = unlimited)
// Throws BudgetExceededError if either limit is breached.
// Task limit is checked before daily limit.
// Returns undefined if both limits pass.
```

**BudgetExceededError shape:**
```js
class BudgetExceededError extends Error {
  // err.type:   'task' | 'daily_org'
  // err.limit:  number — the limit that was exceeded (AUD)
  // err.actual: number — the actual cost (AUD)
  // err.message: human-readable description
}
```

**Pure-function design rationale:** `check()` performs no DB queries. The daily org spend is a snapshot loaded once before the run starts via `getDailyOrgSpendAud(orgId)`. This trades perfect spend accuracy (which would require pessimistic locking across concurrent runs) for a single DB query per run. The daily limit is a soft ceiling — marginal overshoot from concurrent runs is accepted.

**Used by:** `createAgentRoute.js` — `getDailyOrgSpendAud` called once at run start; `check()` called after each `emit(text, partialTokensUsed)` event and once post-run with definitive token counts. `BudgetExceededError` propagates through `runFn` to the existing catch block in `createAgentRoute` — no new error paths.

**Reuse contract:**
1. Call `getDailyOrgSpendAud(orgId)` exactly once at run start. Store the result.
2. After each accumulation event, call `check({ taskCostAud, maxTaskBudgetAud, dailyOrgSpendAud, maxDailyBudgetAud })`.
3. Always perform a final post-run `check()` with the definitive `tokensUsed` from `runFn`.
4. Never call `getDailyOrgSpendAud` mid-stream or inside a loop.

**Does not handle:** Writing to `usage_logs` (that is the agent's responsibility). Currency conversion beyond AUD_PER_USD. Model-specific rate selection (rates are hardcoded to Claude Sonnet 4.6 approximations).

---

### Admin MCP UI Pages
**Type:** Admin Pages
**Location:**
- `client/src/pages/admin/AdminMcpServersPage.jsx` — route `/admin/mcp-servers`
- `client/src/pages/admin/AdminMcpResourcesPage.jsx` — route `/admin/mcp-resources`

**What they do:** Admin-only pages that expose the Stage 1/2 backend APIs (MCPRegistry, mcp_resources, resource_permissions) to the platform operator. Both routes sit under the existing `RequireRole(['org_admin'])` guard in `App.jsx`. Both pages appear in the Sidebar Admin section (`server` icon for MCP Servers, `layers` icon for MCP Resources).

**AdminMcpServersPage** (`/admin/mcp-servers`):
- Table: name, transport type, endpoint URL, status pill (connected / connecting / error / registered / disconnected)
- Register modal: name, transport type select (SSE/stdio), endpoint URL field (SSE) or config JSON textarea (stdio; `{ command, args }`)
- Per-server actions: Connect / Disconnect toggle button; delete with inline confirm

**AdminMcpResourcesPage** (`/admin/mcp-resources`):
- Two sections on a single page: Resources (top) + Permissions (bottom)
- **Resources table:** URI (monospace), display name, server name, description; register modal (server dropdown, URI, name, description); delete with inline confirm; shield icon shortcut pre-populates the permission form for that URI
- **Permissions table:** resource URI, subject (role label + name or user label + UUID), allow/deny pill; filterable by resource URI via dropdown above table; grant modal (resource URI dropdown from registered resources, role/user radio, allow/deny select); revoke with inline confirm

**API surface consumed:**

| Page | Endpoints |
|---|---|
| AdminMcpServersPage | `GET /admin/mcp-servers`, `POST /admin/mcp-servers`, `POST /admin/mcp-servers/:id/connect`, `POST /admin/mcp-servers/:id/disconnect`, `DELETE /admin/mcp-servers/:id` |
| AdminMcpResourcesPage | `GET /admin/mcp-servers` (server dropdown), `GET /admin/mcp-resources`, `POST /admin/mcp-resources`, `DELETE /admin/mcp-resources/:id`, `GET /admin/mcp-resources/permissions`, `POST /admin/mcp-resources/permissions`, `DELETE /admin/mcp-resources/permissions/:id` |

**Reuse contract:** Follow existing admin page patterns — `api.get/post/delete` from `../../api/client`, `InlineBanner` for errors, `EmptyState` for empty tables, `Modal` for create forms, inline confirm for destructive actions (no `ConfirmModal` — inline Yes/No is sufficient for these operations).

**Does not handle:** Bulk permission import. Displaying which users currently have access to a resource (PermissionService runtime check — not a UI concern).

**Updates since initial build:**
- Edit button added to each server row — opens pre-populated modal, calls `PUT /admin/mcp-servers/:id`
- Discover Tools button (visible when connected) — calls `GET /admin/mcp-servers/:id/tools`, shows tool list with inline test runner (args JSON textarea + Call button + result display)
- `POST /admin/mcp-servers/:id/call` — executes a named tool with args against a connected server; returns `content[0].text`

---

## MCP Servers — Building a Stdio Server

**What it is:** A Node.js script that speaks the MCP protocol over stdin/stdout (newline-delimited JSON-RPC). Register it in Admin > MCP Servers as transport `stdio` with `config: { "command": "node", "args": ["path/to/server.js"] }`.

**Protocol sequence:**
1. Platform spawns the process and sends `initialize` on stdin
2. Server responds with `{ protocolVersion, capabilities, serverInfo }` → connection resolves
3. Platform calls `tools/list` → server returns `{ tools: [...] }`
4. Platform calls `tools/call` with `{ name, arguments }` → server returns `{ content: [{ type: "text", text: "..." }] }`

**Minimal server skeleton:**
```js
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, terminal: false });

function send(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }
function respond(id, result) { send({ jsonrpc: '2.0', id, result }); }

rl.on('line', async (line) => {
  const { id, method, params = {} } = JSON.parse(line);
  if (method === 'initialize') {
    respond(id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'my-server', version: '1.0.0' } });
  } else if (method === 'tools/list') {
    respond(id, { tools: TOOLS });
  } else if (method === 'tools/call') {
    const result = await callTool(params.name, params.arguments || {});
    respond(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
  }
});
```

**Key rules:**
- Only write to stdout via `process.stdout.write` — `console.log` also writes to stdout and will corrupt the JSON-RPC stream. Use `process.stderr.write` for debug output.
- The process must respond to `initialize` before any other call is made — the platform waits for the first stdout line to resolve the connection promise.
- If the process exits before writing anything to stdout, the connection promise rejects immediately with "Process exited before responding".
- All env vars from the platform process are inherited by the child process via `{ ...process.env }` in the spawn call.

**Path resolution:** The `args` path is relative to the process CWD. On Railway, the server starts from `/app/server`, so a file at `server/mcp-servers/wordpress.js` in the repo is referenced as `mcp-servers/wordpress.js` in the config (not `server/mcp-servers/wordpress.js`).

---

## WordPress MCP Server

**Location:** `server/mcp-servers/wordpress.js`
**Transport:** stdio
**Admin config:** `{ "command": "node", "args": ["mcp-servers/wordpress.js"] }`

**Required env vars:**
- `WP_URL` — WordPress site base URL (e.g. `https://diamondplate.com.au`)
- `WP_USER` — WordPress username for Basic Auth
- `WP_APP_VAR` — WordPress application password

**What it demonstrates:** A stdio MCP server wrapping an external REST API. The platform spawns it as a child process; any agent in the platform can call its tools without containing any WordPress-specific code.

**Tools exposed:**

| Tool | Input | Returns |
|---|---|---|
| `wp_get_user` | `{ user_id: number }` | `{ id, name, slug, email, roles, registered }` |
| `wp_list_users` | `{ per_page?: number }` | Array of `{ id, name, slug, roles }` |
| `wp_list_posts` | `{ per_page?: number, status?: string }` | Array of `{ id, title, status, date, link }` |
| `wp_get_post` | `{ post_id: number }` | `{ id, title, content (stripped, first 500 chars), status, date, link }` |

**Authentication:** HTTP Basic Auth — `Authorization: Basic base64(WP_USER:WP_APP_VAR)`. WordPress application passwords are generated in WP Admin > Users > Profile > Application Passwords.

**Bot protection note:** If the WordPress host uses SiteGround (or similar) bot protection, server-to-server API calls may be intercepted with an HTTP 202 captcha redirect. Fix: whitelist the `/wp-json/` path or the Railway outbound IP in the host's security settings. A `User-Agent: MCP-curamTools/1.0` header is sent on all requests to aid whitelisting.

**Diagnostics:** The WordPress API is checked on every diagnostics run (`POST /admin/diagnostics`). It fetches user ID 1 and returns the display name. A failed check indicates missing env vars or bot protection blocking the request.

---

## Admin — Diagnostics

**Type:** Route handler + admin page
**Backend:** `POST /api/admin/diagnostics` in `server/routes/admin.js`
**Frontend:** `client/src/pages/admin/AdminDiagnosticsPage.jsx` → `/admin/diagnostics`
**Auth:** `requireAuth` + `requireRole(['org_admin'])`

**What it does:** Runs a sequential set of live health checks against all external integrations and returns an array of `{ name, ok, detail }` objects. Checks run in order; later checks may depend on earlier ones (e.g. Google Ads check reuses the OAuth access token obtained in the Google OAuth check).

**Current checks (in order):**

| # | Name | What is tested |
|---|---|---|
| 1 | Database | `SELECT NOW()` — confirms pool connectivity |
| 2 | Anthropic API | Sends a minimal 16-token message to `claude-haiku-4-5-20251001` |
| 3 | MailChannels | POSTs deliberately invalid payload; 422 = key accepted, 401/403 = key rejected |
| 4 | MCP Registry | Lists registered servers; reports count and connection status |
| 5 | Google OAuth | Refreshes access token from `GOOGLE_REFRESH_TOKEN`; token stored for checks 6–7 |
| 6 | Google Ads API | Queries `SELECT customer.id FROM customer LIMIT 1` against `GOOGLE_ADS_CUSTOMER_ID` |
| 7 | Google Analytics (GA4) | Runs a 7-day sessions report against `GOOGLE_GA4_PROPERTY_ID` |

**Response shape:** plain array (not wrapped in an object) — `res.json(results)` not `res.json({ results })`.

**Adding a new check:** append an `await check('Name', async () => { ... })` call inside the route handler. Throw to signal failure; return a string detail message to signal success. The `check()` helper catches all exceptions automatically.

**MailChannels note:** uses `https.request` (not `fetch`) — native `fetch` silently fails on Railway with MailChannels. Pattern from `feedback_https_vs_fetch` memory.

---

## Admin — SQL Console

**Type:** Route handler + admin page
**Backend:** `POST /api/admin/sql`, `POST /api/admin/sql/nlp` in `server/routes/admin.js`
**Frontend:** `client/src/pages/admin/AdminSqlPage.jsx` → `/admin/sql`
**Auth:** `requireAuth` + `requireRole(['org_admin'])`

**What it does:** Two-mode query tool for the platform PostgreSQL database. SQL mode executes raw queries directly. NLP mode accepts a natural language question, generates SQL via Claude, then executes it.

---

### SQL mode — `POST /api/admin/sql`

**Request body:**
```json
{ "sql": "SELECT ...", "allowWrite": false }
```

**Response shape:**
```json
{ "command": "SELECT", "rowCount": 12, "columns": ["id", "email"], "rows": [...], "duration": 43 }
```

**Write guard:** By default, statements beginning with `INSERT`, `UPDATE`, `DELETE`, `DROP`, `TRUNCATE`, `ALTER`, `CREATE`, `GRANT`, or `REVOKE` are rejected with a 400 error. Pass `"allowWrite": true` to bypass. The frontend toggle shows a red warning banner when write mode is active. The same guard applies in NLP mode.

**Audit log:** Every query is logged to server console: `[SQL Console] user@example.com ran: SELECT ... — N rows in Xms`.

---

### NLP mode — `POST /api/admin/sql/nlp`

**Request body:**
```json
{ "question": "Show me the last 10 agent runs", "allowWrite": false }
```

**Response shape:**
```json
{
  "command": "SELECT", "rowCount": 10, "columns": [...], "rows": [...], "duration": 43,
  "generatedSql": "SELECT ...",
  "modelId": "claude-sonnet-4-6",
  "tokensUsed": { "input": 1840, "output": 64 },
  "costAud": 0.0031
}
```

**How it works:**
1. Queries `information_schema.columns` + `information_schema.tables` to build a live schema string (all `public` base tables, columns with types/nullability/defaults)
2. Calls Claude with the schema + question; instructs it to return raw SQL only (no markdown, no fences)
3. Executes the generated SQL via the same `execSql` helper as SQL mode (write guard applies)
4. Returns results plus `generatedSql`, `modelId`, `tokensUsed`, `costAud`

**Model selection — `getDefaultModel(orgId)`:** Reads `ai_models` from `system_settings` (the list managed in Admin → Models). Picks the first enabled `advanced` tier model; falls back to first enabled model; falls back to `claude-sonnet-4-6`. This means swapping the active model in Admin → Models immediately affects NLP query generation — no code change needed.

**Usage logging:** Every NLP call writes to `usage_logs` with `tool_slug = 'sql-console-nlp'`, the resolved model ID, token counts, and AUD cost. Cost is computed from the model's own `inputPricePer1M` / `outputPricePer1M` from `MODEL_DEFAULTS` (not the hardcoded Sonnet rate in `CostGuardService`). Appears in Admin → Logs alongside agent runs.

**Audit log:** `[SQL Console NLP] user@example.com (model-id): "question..." → generated SQL... [Nin/Nout, A$X.XXXX]`

---

### UI features (both modes)

- Mode toggle: **SQL** | **Natural Language** — switching clears results
- Ctrl+Enter to run in both modes; Tab inserts 2 spaces in SQL mode
- "Allow writes" toggle with red warning banner
- Sticky-header results table, max 480px height with scroll; `null` in italics, objects serialised as JSON
- Row count + duration + PG command tag above results
- **NLP only:** Generated SQL panel shows model ID, token count, A$ cost, and an "Edit in SQL mode" button that pre-loads the generated SQL into SQL mode for refinement

**Does not handle:** Multi-statement batches. Query cancellation. Result export. No server-side row limit — large queries return all rows.

---

---

## Voice Input & Read Aloud

**Purpose:** Reusable voice primitives for any NLP-capable UI in the platform. Mic for dictation; speaker for reading results back. Built on the browser's Web Speech API — no server calls, no dependencies.

---

### `useSpeechInput` — `client/src/hooks/useSpeechInput.js`

**What it does:** Headless hook wrapping `SpeechRecognition` / `webkitSpeechRecognition`.

**Interface:**
```js
const { listening, supported, start, stop } = useSpeechInput({
  onResult:  (transcript) => setValue(transcript),  // called with final transcript
  onPartial: (interim)    => setPreview(interim),   // optional; interim results while speaking
});
```

- `supported` — `false` on browsers without `SpeechRecognition` (Firefox without flag); components should render null when false
- `start()` — begins listening; aborts any prior session first
- `stop()` — cancels before a result is emitted
- Language: `en-AU`; `continuous: false` (single utterance per `start()` call)
- Cleans up via `useEffect` return — aborts the recognition session on unmount

---

### `useReadAloud` — `client/src/hooks/useReadAloud.js`

**What it does:** Headless hook wrapping `speechSynthesis`.

**Interface:**
```js
const { speaking, supported, speak, stop } = useReadAloud();
speak(text);  // strips markdown, then speaks
stop();       // cancels mid-speech
```

- `speak(text)` called while `speaking` is true acts as a toggle — cancels the current utterance
- Text is cleaned by `stripForSpeech()` before passing to `SpeechSynthesisUtterance`
- Language: `en-AU`; rate/pitch: 1.0
- Cancels any queued speech before starting a new utterance (`speechSynthesis.cancel()`)
- Cleans up on unmount

---

### `stripForSpeech` — `client/src/utils/stripForSpeech.js`

**What it does:** Strips markdown, code blocks, URLs, HTML, and list markers from a string before passing to `speechSynthesis`. Fenced code blocks are replaced with `"code block."` so the listener knows one was present.

```js
import { stripForSpeech } from '../utils/stripForSpeech';
const clean = stripForSpeech(markdownText);
```

Strips: fenced code blocks, inline code, images, links (keeps label), bare URLs, headings (`#`), bold/italic (`**`, `__`, `*`, `_`), unordered/ordered list markers, horizontal rules, HTML tags, table rows.

---

### `MicButton` — `client/src/components/ui/MicButton.jsx`

**What it does:** Stateless UI primitive that wires `useSpeechInput` to a button. Renders `null` when `SpeechRecognition` is not supported.

**Props:**
| Prop | Type | Description |
|---|---|---|
| `onResult` | `fn(transcript)` | Called with the final transcript |
| `onPartial` | `fn(interim)` | Optional; called with interim text while speaking |
| `size` | `number` | Icon size (default: 16) |
| `style` | `object` | Extra inline styles |
| `className` | `string` | |

**Visual states:**
- Idle: transparent background, muted icon colour
- Listening: red background, white icon, pulsing ring animation (`_mic_pulse` keyframes)

---

### `ReadAloudButton` — `client/src/components/ui/ReadAloudButton.jsx`

**What it does:** Stateless UI primitive that wires `useReadAloud` to a button. Renders `null` when `speechSynthesis` is not supported. Disabled (opacity 0.4) when `text` is empty.

**Props:**
| Prop | Type | Description |
|---|---|---|
| `text` | `string` | Text to speak; markdown is stripped automatically |
| `size` | `number` | Icon size (default: 16) |
| `style` | `object` | Extra inline styles |
| `className` | `string` | |

**Visual states:**
- Idle: transparent background, muted icon
- Speaking: primary colour background, white icon

Clicking while speaking stops playback (toggle).

---

### Adding voice to a new NLP feature

1. Import `MicButton` and place it near the input textarea — wire `onResult` to append the transcript to the input value
2. Import `ReadAloudButton` and place it near the result output — pass the result text to the `text` prop (markdown is stripped automatically)
3. Both components are self-contained — no state needed in the parent beyond what you already have for the input and result

**Interim text pattern used in SQL Console NLP mode:**
```js
// Appends final transcript; shows interim in brackets while speaking
onResult:  (t) => setQuestion((q) => q ? q + ' ' + t : t)
onPartial: (t) => setQuestion((q) => {
  const base = q.replace(/\s*\[.*\]$/, '');
  return base + (base ? ' ' : '') + '[' + t + ']';
})
```

**Browser support:** Chrome, Edge, Safari. Firefox requires `media.webspeech.recognition.enable` flag. Both components return `null` when unsupported — safe to add unconditionally.

---

## Admin — Logs

**Type:** Admin page + route handlers
**Location:** `client/src/pages/admin/AdminLogsPage.jsx`
**Route:** `/admin/logs`

Two tabs:

### Usage Logs tab
- Calls existing `GET /api/admin/logs?limit=100`
- Shows: Time, User, Tool, Model, In tokens, Out tokens, Cost
- Summary cards: total tokens, estimated cost (USD)

### Server Logs tab
- Calls `GET /api/admin/server-logs` with level filter, search, pagination
- Shows: Time, Level pill (error/warn/info), Message, expandable meta JSON
- Controls: level filter tabs (all/error/warn/info), search, auto-refresh (15s), manual refresh
- Pagination: 50 per page

**Backend:** `GET /api/admin/server-logs` in `server/routes/admin.js`
- Params: `level`, `search`, `limit` (max 500), `offset`
- Returns: `{ logs: [...], total, limit, offset }`
- Queries `app_logs` table

**Logger:** `server/utils/logger.js` — Winston logger with DB transport
- Writes `info`/`warn`/`error` entries to `app_logs` table via `DBTransport`
- Console transport always active; DB transport level: `info`
- Dev: coloured human-readable; production: JSON (Railway-friendly)
- Usage: `const logger = require('../utils/logger'); logger.info('msg', { meta })`

**DB table:** `app_logs (id, level, message, meta JSONB, created_at)`
- Indexed on `level` and `created_at DESC`

**Reuse contract:** All server-side logging goes through `logger` from `utils/logger.js`. Never use `console.log` for application events — those won't appear in the admin log viewer.

---

## Open Questions

1. **`AgentScheduler.register` orgId resolution from DB:** The README vault notes "resolves orgId from DB if omitted (single active org fallback)" but does not specify which table or query is used for this resolution. `Learnings-ToolsForge.md` notes that `scope.orgId = null` throws `AgentSchedulerError` "until the `org_tools` table is built" — implying this fallback is not yet fully implemented for multi-org scenarios. The exact behaviour when `orgId` is omitted and multiple orgs exist is ambiguous.

2. **`persistRun` — `data` column population:** The `agent_runs.data` column is described as "tool results keyed by name" (from `extractToolData`), but neither source file specifies whether the `trace` parameter to `persistRun` is the raw orchestrator trace or the output of `extractToolData`. The exact transformation sequence before DB write is not fully documented.

3. **`agent_runs.token_count` vs `tokensUsed` object:** The `agent_runs` schema shows `token_count INTEGER` but `persistRun` accepts `tokensUsed: { input, output, cacheRead, cacheWrite }`. Neither source file specifies how the multi-field `tokensUsed` object is collapsed into a single `token_count` integer for storage.

4. **`MarkdownRenderer` — code block support:** `LEARNINGS--very important.md` notes that improvements such as "code blocks, tables, links" should be made once in `MarkdownRenderer`. Tables are confirmed implemented. Code block and link support are listed as improvements not yet made — current implementation status is not confirmed in the source files.

5. **`LineChart.jsx` — tooltip implementation:** The interface documents `leftFormat` and `rightFormat` as formatters, but the source files do not confirm whether a tooltip is rendered or whether these formatters apply only to axis tick labels.

6. **`buildSystemPrompt` gather-first protocol:** `Learnings-ToolsForge.md` describes the system prompt as including a numbered "gather first, then analyse" instruction that drove efficient parallel tool calls. The exact tool-call order instructions and output format sections are referenced but not fully reproduced in any source file.

7. **Curam Vault `buildSystemPrompt()` reusability in ToolsForge:** The Vault's `buildSystemPrompt()` pattern (5 layered blocks) is documented as reusable, but ToolsForge agent prompts use `buildSystemPrompt(config)` (single config object, no prompt caching block structure). Whether the 5-block caching pattern is applied to agent system prompts in ToolsForge is not confirmed in the source files.
