# PLATFORM-PRIMITIVES.md

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

**Used by:** Google Ads Monitor (`server/routes/agents/`); all future agents.
**Reuse contract:** Provide `slug` (stable, lowercase, hyphen-separated), a `runFn(context)` that returns `{ result, trace, tokensUsed }`, and a `requiredPermission` role name. Register the returned router in `server/index.js` under `/api/agents/:slug`.
**Does not handle:** Agent tool registration (done in the agent's `tools.js`), system prompt construction (done in the agent's `prompt.js`), data fetching (done in domain services). Does not write directly to `agent_executions` (that is `services/AgentScheduler.js` territory).

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
**Used by:** Google Ads Monitor registration (schedule: `'0 6,18 * * *'`).
**Reuse contract:** Provide `slug`, a valid cron expression, and a `runFn`. Document the UTC↔local offset in a comment at the registration site.
**Does not handle:** HTTP-triggered runs (those go through `createAgentRoute`). Does not manage `agent_executions` (that is `services/AgentScheduler.js`). Does not parse or validate cron expressions — invalid expressions are passed directly to node-cron.

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
  status      TEXT,              -- 'running' | 'complete' | 'error'
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
**What it does:** Stores operator-level agent configuration — analytical thresholds, schedule, and lookback settings — one row per org per agent slug.
**Interface:**
```sql
agent_configs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      INTEGER NOT NULL,       -- FK → organizations
  slug        TEXT NOT NULL,          -- agent identifier
  config      JSONB DEFAULT '{}',     -- merged with AGENT_DEFAULTS at read time
  updated_by  INTEGER,                -- FK → users
  updated_at  TIMESTAMPTZ,
  UNIQUE (org_id, slug)
)
```
Admin config (model, max_tokens, max_iterations, kill switch) is stored separately in `system_settings` under key `agent_<slug_underscored>`, not in this table.
**Used by:** `AgentConfigService` (only access path); `PUT /api/agent-configs/:slug` route; Google Ads Monitor agent.
**Reuse contract:** Never query this table directly from agent or route code. Always use `AgentConfigService.getAgentConfig(orgId, slug)` and `AgentConfigService.updateAgentConfig(orgId, slug, patch, updatedBy)`. Add new agent defaults to `AGENT_DEFAULTS` in `AgentConfigService.js`.
**Does not handle:** Admin guardrails (model, tokens, kill switch) — those are in `system_settings`.

---

### AgentConfigService (all four methods)
**Type:** Service
**Location:** `server/services/AgentConfigService.js`
**What it does:** Canonical access layer for both operator config (`agent_configs` table) and admin config (`system_settings` table). All methods return the full merged config; callers never see a partial config.
**Interface:**
```js
// Operator config — analytical settings, schedule, thresholds
AgentConfigService.getAgentConfig(orgId, slug)
// orgId: number, slug: string
// Returns: defaults merged with stored JSONB. Falls back to defaults on DB error.

AgentConfigService.updateAgentConfig(orgId, slug, patch, updatedBy)
// orgId: number, slug: string, patch: object (partial config), updatedBy: number (userId)
// Upserts patch into agent_configs. Returns merged result.

// Admin config — model, cost guardrails, kill switch
AgentConfigService.getAdminConfig(slug)
// slug: string
// Reads from system_settings key = 'agent_<slug_underscored>'. Returns defaults merged with stored JSON.

AgentConfigService.updateAdminConfig(slug, patch, updatedBy)
// slug: string, patch: object, updatedBy: number (userId)
// Saves merged config to system_settings. Returns merged result.
```
Default values are defined in `AGENT_DEFAULTS` and `ADMIN_DEFAULTS` constants at the top of the service file. New agents add their defaults to those constants.

Google Ads Monitor defaults:
- Agent: `schedule='0 6,18 * * *'`, `lookback_days=30`, `ctr_threshold_pct=2.0`, `wasted_clicks_threshold=5`, `impressions_min=100`, `max_suggestions=5`
- Admin: `enabled=true`, `model='claude-sonnet-4-6'`, `max_tokens=4096`, `max_iterations=10`

**Used by:** `createAgentRoute.js` (loads admin config before every run); `PUT /api/agent-configs/:slug` route; `AdminAgentsPage.jsx`; `GoogleAdsMonitorPage.jsx` agent settings panel.
**Reuse contract:** New agents add entries to `AGENT_DEFAULTS` and `ADMIN_DEFAULTS`. Agent code reads config via `getAgentConfig`; admin enforcement is automatic via `createAgentRoute`.
**Does not handle:** Permission checks (those are on the route layer). Cron rescheduling (the route calls `AgentScheduler.updateSchedule` separately after `updateAgentConfig`).

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

### buildSystemPrompt (google ads monitor)
**Type:** Utility
**Location:** `server/agents/googleAdsMonitor/prompt.js`
**What it does:** Builds the Google Ads Monitor system prompt by injecting live agent config values (thresholds, limits) into the prompt string at run time.
**Interface:**
```js
buildSystemPrompt({ ctr_threshold_pct, wasted_clicks_threshold, impressions_min, max_suggestions })
// ctr_threshold_pct: number — CTR % below which campaigns are flagged
// wasted_clicks_threshold: number — clicks with zero conversions = wasted spend
// impressions_min: number — minimum impressions to flag Ad Copy Opportunity
// max_suggestions: number — maximum recommendations to produce
// Returns: string — complete system prompt for the agent
```
Called at run time with freshly-loaded agent config from `AgentConfigService`. Operator changes to thresholds take effect on the next run without any code change or server restart.
**Used by:** `server/agents/googleAdsMonitor/index.js` (`runAdsMonitor` entry point).
**Reuse contract:** Every future agent with configurable analytical thresholds should export a `buildSystemPrompt(config)` function following this pattern rather than a static string. Static prompt strings are acceptable only for agents with no operator-configurable parameters.
**Does not handle:** Prompt caching structure (that is the caller's responsibility). Injection of date/time context (handled by the platform date context pattern). Admin config values (model, token limits) — those are passed separately into `AgentOrchestrator.run()`.

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

## Open Questions

1. **`AgentScheduler.register` orgId resolution from DB:** The README vault notes "resolves orgId from DB if omitted (single active org fallback)" but does not specify which table or query is used for this resolution. `Learnings-ToolsForge.md` notes that `scope.orgId = null` throws `AgentSchedulerError` "until the `org_tools` table is built" — implying this fallback is not yet fully implemented for multi-org scenarios. The exact behaviour when `orgId` is omitted and multiple orgs exist is ambiguous.

2. **`persistRun` — `data` column population:** The `agent_runs.data` column is described as "tool results keyed by name" (from `extractToolData`), but neither source file specifies whether the `trace` parameter to `persistRun` is the raw orchestrator trace or the output of `extractToolData`. The exact transformation sequence before DB write is not fully documented.

3. **`agent_runs.token_count` vs `tokensUsed` object:** The `agent_runs` schema shows `token_count INTEGER` but `persistRun` accepts `tokensUsed: { input, output, cacheRead, cacheWrite }`. Neither source file specifies how the multi-field `tokensUsed` object is collapsed into a single `token_count` integer for storage.

4. **`MarkdownRenderer` — code block support:** `LEARNINGS--very important.md` notes that improvements such as "code blocks, tables, links" should be made once in `MarkdownRenderer`. Tables are confirmed implemented. Code block and link support are listed as improvements not yet made — current implementation status is not confirmed in the source files.

5. **`LineChart.jsx` — tooltip implementation:** The interface documents `leftFormat` and `rightFormat` as formatters, but the source files do not confirm whether a tooltip is rendered or whether these formatters apply only to axis tick labels.

6. **`buildSystemPrompt` gather-first protocol:** `Learnings-ToolsForge.md` describes the system prompt as including a numbered "gather first, then analyse" instruction that drove efficient parallel tool calls. The exact tool-call order instructions and output format sections are referenced but not fully reproduced in any source file.

7. **Curam Vault `buildSystemPrompt()` reusability in ToolsForge:** The Vault's `buildSystemPrompt()` pattern (5 layered blocks) is documented as reusable, but ToolsForge agent prompts use `buildSystemPrompt(config)` (single config object, no prompt caching block structure). Whether the 5-block caching pattern is applied to agent system prompts in ToolsForge is not confirmed in the source files.
