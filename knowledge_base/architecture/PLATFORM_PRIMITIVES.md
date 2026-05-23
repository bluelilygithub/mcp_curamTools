# Platform Primitives

This file documents all platform-level abstractions in MCP CuramTools. These are reusable components, services, and utilities that any agent can use.

---

## createAgentRoute

**Type:** Route Factory  
**Location:** `server/platform/createAgentRoute.js`

Returns an Express router with `POST /run` (SSE) and `GET /history` endpoints wired with auth, SSE plumbing, admin config enforcement, run persistence, and error handling.

**Interface:**
```js
createAgentRoute({ slug, runFn, requiredPermission })
// slug: string — agent identifier (e.g. 'google-ads-monitor')
// runFn: async (context) => { result, trace?, tokensUsed, promptVersion? } — optional promptVersion → persisted as result.prompt_version
// requiredPermission: string — role name; org_admin always satisfies the check
```

**Endpoints:**
| Endpoint | Auth | Behaviour |
|---|---|---|
| `POST /run` | requireAuth + requireRole | Loads admin config, checks kill switch, streams SSE, and calls Lessons Repository write-back after a successful persisted run when a reusable lesson/pattern is present |
| `GET /history` | requireAuth | Returns last 20 `agent_runs` rows for this slug + org |

**SSE result payload:** On successful completion, the final `{ type: 'result', data }` message’s `data` object includes **`runId`** (the UUID of the `agent_runs` row). Clients use it for immediate follow-up calls such as `PATCH /api/demo/runs/:runId/...`. **`runId` is not written into persisted `agent_runs.result` JSON** — only the streamed envelope carries it.

**Budget integration:** Pre-flight daily budget check, mid-run accumulation via `emit(text, partialTokensUsed)`, post-run definitive check. `costAud` added to `resultPayload`.

**Prompt lineage (additive):** If `runFn` resolves to an object that includes **`promptVersion`** (a short string), it is copied onto the persisted payload as **`result.prompt_version`** (truncated). Optional — see `server/platform/promptVersions.js` and `knowledge_base/core/PROMPT_VERSIONING.md`. Agents that omit it are unchanged.

**Lessons coverage:** Every new model-backed agent or AI routine must be covered by the Lessons Repository. Use `createAgentRoute` for manual SSE agents and `AgentScheduler` for scheduled agents so write-back wiring is automatic. If a routine bypasses those paths with a custom route or direct provider call, add a local fire-and-forget `proposeLessonFromRun({ agentId, organisationId, runId, lesson })` after the successful result is saved or returned. `proposeLessonFromRun` stores only explicit reusable lessons/patterns; plain run telemetry belongs in logs. Agent-written lessons remain `under-review` until an admin activates them. Also update `LESSON_COVERAGE_SECTIONS` in `client/src/pages/admin/AdminLessonsPage.jsx`; the Admin > Lessons & Rules coverage link is the visible audit register of covered agents/routines.

---

## AgentOrchestrator

**Type:** Platform Primitive — Singleton  
**Location:** `server/platform/AgentOrchestrator.js`

The ReAct (Reason + Act) loop engine for all agents. Calls Claude, parses `tool_use` blocks, executes tools, feeds results back, and repeats until Claude produces a final text response or `maxIterations` is reached.

**Interface:**
```js
const { result, trace, tokensUsed } = await agentOrchestrator.run({
  systemPrompt, userMessage, tools, model, maxTokens, maxIterations, onStep, context, thinking
});
```

**Key features:**
- Strips `execute`, `requiredPermissions`, `toolSlug`, `cacheable` from tool defs before sending to provider
- Preserves full assistant response content (including thinking blocks)
- Session-scoped tool result cache (5-min TTL, keyed by `orgId:userId`)
- Error results never cached; `cacheable: false` opt-out per tool

---

## AgentScheduler

**Type:** Cron  
**Location:** `server/platform/AgentScheduler.js`

Registers a cron job for an agent slug; stops any existing job for that slug before registering the new one (idempotent).

**Interface:**
```js
AgentScheduler.register({ slug, schedule, runFn, orgId })
AgentScheduler.updateSchedule(slug, newSchedule)
AgentScheduler.getSchedule(slug)
```

**Multi-customer support:** If `runFn` returns an array of `{ customerId, result, status, error, promptVersion? }`, persists one `agent_runs` row per element.

**Prompt lineage (additive):** Optional top-level **`promptVersion`** on the cron return value (single run or per array item) is merged into **`result.prompt_version`** using the same helpers as `createAgentRoute` — see `server/platform/promptVersions.js` and `knowledge_base/core/PROMPT_VERSIONING.md`.

---

## AgentConfigService

**Type:** Service  
**Location:** `server/platform/AgentConfigService.js`

Canonical access layer for operator config (`agent_configs`) and admin config (`system_settings`).

**Key methods:**
- `getAgentConfig(orgId, slug)` / `updateAgentConfig(orgId, slug, patch, updatedBy)`
- `getAgentConfigForCustomer(orgId, slug, customerId)` / `updateAgentConfigForCustomer(...)`
- `getAdminConfig(slug)` / `updateAdminConfig(slug, patch, updatedBy)`
- `getOrgBudgetSettings(orgId)` / `updateOrgBudgetSettings(orgId, patch, updatedBy)`
- `getOrgDefaultModel(orgId)` / `updateOrgDefaultModel(orgId, modelId)`
- `getOrgFallbackModel(orgId)` / `updateOrgFallbackModel(orgId, modelId)`
- `getCrmPrivacySettings(orgId)` / `getExtractionPrivacySettings(orgId)`

---

## persistRun

**Type:** Utility  
**Location:** `server/platform/persistRun.js`

The only code that may write to `agent_runs`. Called by both `createAgentRoute` and `AgentScheduler`.

**Interface:**
```js
persistRun({ slug, orgId, status, result?, error?, runAt?, runId?, customerId?, campaignId? })
// status: 'running' | 'complete' | 'error' | 'needs_review'
```

---

## CostGuardService

**Type:** Service  
**Location:** `server/services/CostGuardService.js`

All budget enforcement logic. Pure function `check()` — no IO, no async.

**Interface:**
```js
computeCostAud({ input, output, cacheRead, cacheWrite })  // → AUD number
getDailyOrgSpendAud(orgId)                                  // → AUD number (single DB query)
check({ taskCostAud, maxTaskBudgetAud, dailyOrgSpendAud, maxDailyBudgetAud })
// Throws BudgetExceededError if limits exceeded
```

**Token cost constants (Claude Sonnet 4.6, USD per million tokens):**
- Input: $3.00 | Output: $15.00 | Cache read: $0.30 | Cache write: $3.75
- `AUD_PER_USD = 1.55`

---

## MCPRegistry

**Type:** Platform Primitive — Singleton  
**Location:** `server/platform/mcpRegistry.js`

Manages the full lifecycle of remote MCP server connections. All operations are org-scoped.

**Key methods:**
- `register(orgId, { name, transportType, endpointUrl, config })` — upserts on `(org_id, name)`
- `deregister(orgId, serverId)` — soft-deactivates (`is_active = FALSE`)
- `list(orgId)` — returns all active servers with connection status
- `connect(orgId, serverId)` / `disconnect(orgId, serverId)` — idempotent
- `send(orgId, serverId, method, params)` — JSON-RPC dispatch with 30s timeout
- `disconnectAll()` — called on SIGTERM/SIGINT

**Events:** `connected`, `disconnected`, `notification`

---

## PermissionService

**Type:** Service  
**Location:** `server/services/PermissionService.js`

Role and resource permission management.

**Key methods:**
- `hasRole(userId, roleName, orgId)` — checks if user has a role
- `isOrgAdmin(userId, orgId)` — shortcut for org_admin check
- `getUserRoles(userId, orgId)` — returns all role assignments
- `grantRole(userId, roleName, scopeType, scopeId, grantedBy)` / `revokeRole(...)`
- `canAccessResource(userId, resourceUri, orgId)` — deny-wins resolution
- `grantResourcePermission(orgId, resourceUri, { userId, roleName }, permission, grantedBy)`
- `revokeResourcePermission(orgId, permissionId)`
- `listResourcePermissions(orgId, resourceUri)`

---

## UI Components

### MarkdownRenderer
**Location:** `client/src/components/MarkdownRenderer.jsx`
```jsx
<MarkdownRenderer text={string} />
```
Zero-dependency markdown renderer. Supports headings, bold, lists, tables, horizontal rules.

### BoundsWarningPanel
**Location:** `client/src/components/ui/BoundsWarningPanel.jsx`
```jsx
<BoundsWarningPanel boundsFailed={result.boundsFailed} />
```
Amber warning panel for `needs_review` runs. Null-renders when empty.

### LineChart
**Location:** `client/src/components/charts/LineChart.jsx`
```jsx
<LineChart data={array} xKey={string} leftKey={string} rightKey={string} ... />
```
Zero-dependency SVG dual-axis line chart.

### Button, Modal, Toast, InlineBanner, EmptyState
Standard UI primitives in `client/src/components/ui/`.

---

## Utilities

### sanitize (shared prompt-injection detection)

**Type:** Shared Utility  
**Location:** `server/utils/sanitize.js`

Standardised prompt-injection detection for all agents that accept user-provided text or filenames. Import and call before sending user content to an LLM.

**Interface:**
```js
const { scanInjection, sanitiseFileName, sanitiseText } = require('../../utils/sanitize');

const check = scanInjection(userInput);
if (!check.clean) throw new Error('Input rejected: prompt injection detected.');
```

**Principle:** Patterns are deliberately narrow to avoid false positives on legitimate engineering/business text (e.g. "the stormwater system: you must ensure…" is normal specification language). Only patterns extremely unlikely to appear in legitimate documents are included. The scan targets user-supplied filenames and custom prompt text — NOT the document body.

**Methods:**
- `scanInjection(text)` → `{ clean: boolean }` — checks text against known injection patterns
- `sanitiseFileName(name)` → `string` — strips null bytes and control characters
- `sanitiseText(text)` → `string` — strips null bytes and control characters (preserves newlines)

**Usage pattern (documentAnalyzer.js):**
```js
const { scanInjection } = require('../../utils/sanitize');
const nameCheck = scanInjection(fileName);
if (!nameCheck.clean) throw new Error('Input rejected: prompt injection pattern detected.');
```

---

### extractToolData
Walks AgentOrchestrator trace and keys tool results by tool name into a JSONB-ready object.

### extractSuggestions
Parses `### Recommendations` numbered list from agent output into `[{text, priority}]`.

### validateToolData
Post-run structural integrity check for tool results. Pure function.

### toolSchemas
Registry of pure validator functions for tool result shapes. Current schemas: `get_campaign_performance`, `get_daily_performance`, `get_search_terms`.

### substitutePromptVars
Replaces `{{variable}}` placeholders in prompt templates. Pure function.

### buildAccountContext
Formats `intelligence_profile` into a prompt-ready account context block. Injected first in system prompt.

### UsageLogger
Single write path to `usage_logs`. Called fire-and-forget from `createAgentRoute`, conversation turns, and direct AI admin routes. It records model id, input/output tokens, prompt cache read/write tokens, and direct AUD cost so usage can be analysed by organisation, model, agent/tool, and day.

Admin › Usage is no longer only an audit view over this table. `GET /api/admin/usage-stats?days=7|30|90` provides totals and breakdowns, `GET /api/admin/usage-warnings` turns recent usage into warning signals, and `GET /api/admin/usage-intelligence` produces a management summary with health status, score, month-end forecast, budget pressure, top cost drivers, and recommended actions. Low-cache diagnostics name the largest low-cache input drivers so expected document, live-data, or pre-fetch behaviour can be separated from accidental cache-breaking prompt design.

---

## Domain Services

### GoogleAdsService
**Location:** `server/services/GoogleAdsService.js`
Google Ads REST API v23 client. All monetary values in AUD. Methods: `getCampaignPerformance`, `getDailyPerformance`, `getSearchTerms`, `getBudgetPacing`, `getChangeHistory`, `getImpressionShareByCampaign`, `getAuctionInsights`, `getActiveKeywords`, `getAdGroupAds`, `getAdAssetPerformance`, `generateKeywordIdeas`.

### GoogleAnalyticsService
**Location:** `server/services/GoogleAnalyticsService.js`
GA4 Data API v1beta client. Methods: `getSessionsOverview`, `getTrafficSources`, `getLandingPagePerformance`, `getConversionEvents`, `getPaidBouncedSessions`.
