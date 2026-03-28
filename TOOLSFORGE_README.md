# ToolsForge

**Built by:** Michael Barrett
**Purpose:** Multi-user modular platform — a foundation for building shared AI tools across an organisation
**Status:** Production-ready multi-tenant platform — auth, roles, permission service, invitation workflow, email delivery, password reset, profile management, password history, account lockout, configurable security settings, structured logging, in-app log viewer, email template management, font/theme customisation, AI model catalogue, role-based model permissions, SSE streaming backbone, AI Chat tool, Model Advisor, admin UI, server-side file ingestion pipeline (PDF/Word/Excel/text), vector embeddings with HNSW similarity search, org-scoped RAG, usage telemetry, admin usage analytics, client-side route guards (RequireAuth + RequireRole), theme-aware dashboard, tool registry with role-filtered card grid, **AgentOrchestrator ReAct loop engine** (tool-agnostic Claude + tool-use execution primitive shared by all agent modules)
**Stack:** Node.js/Express · PostgreSQL 15 + pgvector · Docker · Railway · React/Vite · Tailwind CSS · Anthropic Claude · Google text-embedding-004 · Google Ads API v18

---

## What's Built

### Backend

#### Authentication
- User registration and login with bcryptjs password hashing
- 7-day token-based sessions (`auth_sessions` table)
- Admin user auto-seeded from environment variables on every startup
- New users auto-assigned `org_member` role on registration
- Login response includes full roles array and profile fields (first name, last name, phone)
- Inactive users (pending invitation) are blocked from logging in
- Password reset flow — forgot password sends a 1-hour token via email; reset invalidates all active sessions
- Password history — last 5 hashes stored; reuse blocked on both change-password and reset-password
- Profile update — first name, last name, phone stored on `users` table; updated via `PUT /api/auth/profile`

#### Security

**HTTP hardening**
- `helmet()` applied as the first middleware — sets Content-Security-Policy, HSTS, X-Frame-Options, X-Content-Type-Options, removes `X-Powered-By`. Without this, Express advertises itself in every response, enabling precise fingerprint-based attacks.
- CORS locked to origin whitelist (`APP_URL` env var + localhost dev ports), scoped to `/api` only — static assets are never touched by CORS middleware

**Brute-force protection — two complementary layers**

The attack surface for a login endpoint has two distinct threat profiles, and a single control handles neither well:

- **IP rate limiting** — stops one IP from hammering any account. Default: 5 attempts per 15 minutes per IP. Controlled by `security_login_rate_limit` in `system_settings`. Uses a function-based `max` in `express-rate-limit`, so admin changes take effect immediately without a server restart.
- **Account lockout** — stops a distributed attacker rotating IPs who slowly probes a specific account. After N consecutive failures (default: 5), the account locks for M minutes (default: 15), regardless of which IP the attempts came from. Counter resets to zero on any successful login. Both thresholds are controlled by `security_login_max_attempts` and `security_lockout_minutes` in `system_settings`, read from the DB on every login attempt — changes are live immediately.

Password reset (forgot-password) is separately rate-limited at 5 req/15 min to prevent email enumeration at scale.

**Why configurable?** Appropriate thresholds depend on the organisation's risk profile and user behaviour. An org with a small, technical team on a trusted network can afford more generous limits. A public-facing deployment with non-technical users needs tighter controls. Hardcoded values mean either over-restricting legitimate users or under-protecting accounts. Admin-configurable thresholds let the operator tune to their context without a code deploy.

**Auth middleware**
- `requireAuth` extracts and validates the session token, attaches `req.user` with `id`, `email`, `org_id`
- `requireRole(['role_name'])` delegates to `PermissionService` — no inline SQL in routes

#### PermissionService (`server/services/permissions.js`)
Single source of truth for all authorisation checks. Every route and future tool calls this — nothing writes its own permission SQL.

| Method | Description |
|---|---|
| `hasRole(userId, roleNames, scope)` | Check if user holds any of the given roles at the given scope |
| `isOrgAdmin(userId)` | Convenience check for org-level admin |
| `getUserRoles(userId, scopeType)` | Return all role assignments, optionally filtered by scope type |
| `grantRole(userId, roleName, scope, grantedBy)` | Assign a role, creating it if it doesn't exist |
| `revokeRole(userId, roleName, scope)` | Remove a role assignment |
| `getPermittedModels(userId, toolSlug)` | Return models the user may use for a tool, resolved from tool config + user roles |
| `canUseModel(userId, toolSlug, modelId)` | Check whether a user may use a specific model for a tool |

**Role scoping tiers:**
- `global` — applies across the entire organisation (e.g. `org_admin`)
- `tool` — applies within a specific tool (e.g. `chat_advanced` scoped to `chat`)
- `resource` — applies to a specific record (e.g. `project_owner` scoped to project id `42`)

A global role satisfies any scope check. Scoping is stored in `user_roles(scope_type, scope_id)` — not in the users table.

#### InvitationService (`server/services/invitations.js`)
Admin-controlled user onboarding. No open registration.

| Method | Description |
|---|---|
| `createInvitation(email, orgId, roleName, invitedBy)` | Create inactive user + one-time token + send invitation email |
| `getInvitation(token)` | Validate token, return email |
| `acceptInvitation(token, passwordHash)` | Set password, activate account |
| `resendInvitation(userId, invitedBy)` | Invalidate existing unused tokens, issue fresh 48h token + send email |

Flow: admin invites → inactive user + 48h token created → activation email sent automatically → user sets password → account activated → logged in immediately. Admin can resend at any time to regenerate the link. The invite modal shows "Email sent" as the primary result with a collapsible fallback link in case email doesn't arrive.

#### EmailService (`server/services/email.js`)
Sends transactional email via MailChannels HTTP API. Falls back to SMTP (nodemailer) if `MAIL_CHANNEL_API_KEY` is not set.

| Method | Description |
|---|---|
| `sendInvitation(to, activationUrl)` | Invitation email — content driven by `invitation` template |
| `sendPasswordReset(to, resetUrl)` | Password reset email — content driven by `password_reset` template |
| `send({ to, subject, html, text })` | Raw send — for tools that compose their own email content |

- Uses `X-Api-Key` header for MailChannels authentication
- All email body content is loaded from `EmailTemplateService` — never hardcoded in routes
- Email calls are non-blocking — a failure logs an error but never fails the invitation/reset request
- From address and name configurable via `MAIL_FROM_EMAIL` / `MAIL_FROM_NAME` env vars

#### EmailTemplateService (`server/services/emailTemplates.js`)
Manages admin-editable email templates stored in the `email_templates` table. Provides a fallback to hardcoded defaults if a DB record is missing.

| Method | Description |
|---|---|
| `get(slug)` | Fetch template by slug from DB; fall back to `emailDefaults.js` if not found |
| `render(slug, vars)` | Fetch template and substitute `{{variable}}` placeholders with provided values |
| `list()` | All templates ordered by tool (platform templates first) |
| `upsert(slug, data, updatedBy)` | Save subject, body_html, body_text — creates row if missing, updates if exists |
| `reset(slug, updatedBy)` | Restore template content to hardcoded default |

Templates use `{{variableName}}` placeholder syntax replaced at send time. Each template declares its available variables (e.g. `activationUrl`, `resetUrl`, `email`).

**Adding a template for a new tool:**
1. Add a default entry to `server/utils/emailDefaults.js` with `tool_slug` set to the tool's slug
2. On next server start, the template is seeded into `email_templates` with `ON CONFLICT DO NOTHING` (admin edits are never overwritten)
3. In tool code, call `EmailTemplateService.render('my_slug', { var1, var2 })` then `send({ to, ...result })`
4. Admin can edit the template content at any time via **Admin → Email Templates** — no code deploy needed

#### AI Model Catalogue (`server/utils/modelCatalogue.js`)
Defines every AI model available in ToolsForge. The live source of truth at runtime is the `ai_models` key in `system_settings` (DB), which admins can edit without a redeploy. The static `MODEL_CATALOGUE` in this file serves as the seed default and fallback if the DB is unavailable.

| Export | Description |
|---|---|
| `MODEL_CATALOGUE` | Static default model definitions (seed + fallback) |
| `TIER_ORDER` | `['standard', 'advanced', 'premium']` |
| `getModelsFromDB()` | Load live model list from `system_settings` with static fallback |
| `getModelsForTierFromDB(maxTier)` | Return DB models at or below the given tier |
| `getModelFromDB(modelId)` | Look up a single model by ID from DB |
| `getModelsForTier(maxTier)` | Sync version — uses static catalogue only |
| `getModel(modelId)` | Sync version — uses static catalogue only |

**Model tiers:**
| Tier | Class | Default model |
|---|---|---|
| `standard` | Fast, affordable | Claude Haiku 4.5 |
| `advanced` | Balanced | Claude Sonnet 4.6 |
| `premium` | Maximum capability | Claude Opus 4.6 |

#### Cost Calculator (`server/services/costCalculator.js`)
Calculates USD cost from Anthropic token counts. Reads live pricing from the DB model catalogue; falls back to a static pricing map.

- Cache read tokens billed at 10% of input price
- Cache write tokens billed at 125% of input price
- `calculateCost({ modelId, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens })` — async, returns USD cost

#### Usage Logger (`server/services/usageLogger.js`)
Records every AI response to `usage_logs` and checks spend thresholds.

| Function | Description |
|---|---|
| `logUsage(params)` | Insert one row into `usage_logs`; returns costUsd |
| `checkSpendThresholds(params)` | Read thresholds from `system_settings`; fire `logger.warn` to `app_logs` when crossed |
| `logAndCheck(params)` | Convenience — log usage then immediately check thresholds; single call from SSE handlers |

Threshold warnings appear in **Admin → Logs** without any additional infrastructure.

#### SSE Streaming (`server/routes/stream.js`)
Generic SSE endpoint used by all AI tools. Tools delegate to this — no tool writes its own streaming logic.

**`POST /api/tools/:toolSlug/stream`**

Request body:
```json
{ "model": "claude-sonnet-4-6", "messages": [...], "system": "...", "maxTokens": 4096 }
```

SSE event stream:
```
data: {"type":"status","status":"connecting"}
data: {"type":"text","text":"...chunk..."}
data: {"type":"usage","inputTokens":N,"outputTokens":N,"costUsd":N,"sessionTotal":N,"dailyTotal":N,"warnings":[...]}
data: [DONE]
```

Permission check fires before the stream opens — returns 403 if the user's roles do not permit the requested model for the tool.

**`GET /api/tools/:toolSlug/permitted-models`**

Returns the list of models the authenticated user may use for a given tool. Resolved by `PermissionService.getPermittedModels`.

**`POST /api/tools/:toolSlug/analyse-prompt`**

Pre-send classifier for the Model Advisor. Accepts `{ prompt, currentModelId }` and returns whether the current model is a good fit for the prompt.

Request body:
```json
{ "prompt": "Explain the pros and cons of microservices...", "currentModelId": "claude-haiku-4-5-20251001" }
```

Response (mismatch detected):
```json
{
  "mismatch": true,
  "complexity": "complex",
  "reason": "This prompt requires deep architectural analysis — a more capable model would give a better result.",
  "suggestedTier": "advanced",
  "suggestedModels": [{ "id": "claude-sonnet-4-6", "name": "Claude Sonnet 4.6", "emoji": "⚖️" }]
}
```

Response (no mismatch):
```json
{ "mismatch": false }
```

**Critical:** `suggestedModels` is built exclusively from `PermissionService.getPermittedModels(userId, toolSlug)` filtered to the suggested tier. A user without `chat_premium` access can never receive Opus as a suggestion, regardless of prompt complexity. If the classifier call itself fails for any reason the endpoint returns `{ mismatch: false }` — the user is never blocked from sending.

#### AgentOrchestrator (`server/services/AgentOrchestrator.js`)

The platform-level ReAct loop engine. Every agent module in ToolsForge runs through this — nothing domain-specific lives here.

**What it does:** accepts a `systemPrompt`, `userMessage`, tool definitions, and a `context` object, then executes a Claude → parse tool calls → execute tools → feed results back → repeat loop until Claude emits a final answer or `maxIterations` is reached.

**Imports:**
```js
// Singleton (recommended)
const { agentOrchestrator } = require('../services/AgentOrchestrator');

// Or instantiate with a custom logger
const { AgentOrchestrator } = require('../services/AgentOrchestrator');
const orchestrator = new AgentOrchestrator({ logger: myLogger });
```

**`run(params)` signature:**
```js
const { result, trace, iterations, tokensUsed } = await agentOrchestrator.run({
  systemPrompt,          // string
  userMessage,           // string
  tools,                 // array — see Tool Shape below
  maxIterations,         // number, default 10, hard-capped at 20
  onStep,                // optional async (traceStep) => void — called after each iteration
  context,               // { userId, orgId, toolSlug } — REQUIRED
  model,                 // string, default 'claude-sonnet-4-6'
  maxTokens,             // number, default 8192; pass 65536 for complex agents
  thinking,              // { enabled: false, budgetTokens: 10000 } — extended thinking
});
```

**Tool shape** — each tool carries both the Anthropic schema and an `execute` function. The orchestrator strips `execute` before sending to Claude:
```js
{
  name: 'search_web',
  description: 'Search the web for current information.',
  input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  execute: async (input, context) => { /* context.orgId always available */ return { results: [...] }; }
}
```

**Returns:**
```js
{
  result: string,          // final text response from Claude
  iterations: number,      // how many iterations ran
  trace: [                 // one entry per iteration
    {
      iteration: 1,
      timestamp: '2026-03-26T...',
      thinking: null,      // string if extended thinking was enabled
      text: null,          // Claude's text content this iteration (null if mid-loop)
      toolCalls: [{ id, name, input }],
      toolResults: [{ id, name, result, durationMs }],
    }
  ],
  tokensUsed: { input, output, cacheRead, cacheWrite }
             // shape matches usageLogger.logAndCheck() — call it directly after run()
}
```

**`AgentOrchestrator.formatForSSE(traceStep)`** — static method. Returns a plain JSON-serialisable object from a trace step, safe to pass directly to `res.write()` in an SSE route:
```js
sendEvent(res, AgentOrchestrator.formatForSSE(traceStep));
// → { type: 'agent_step', iteration, timestamp, thinking, text, toolCalls, toolResults }
```

**Security constraints (non-negotiable):**
- `context.orgId` is required — throws `AgentError` immediately if absent
- `maxIterations` is silently clamped to 20 regardless of what the caller passes
- Tool execution errors are caught per-tool and returned to Claude as `{ error: '...' }` — never thrown up the stack; Claude decides how to handle tool failure
- Unknown tool names return `{ error: 'Tool not found: <name>' }` to Claude and continue; never throw
- `context` is passed through to every `tool.execute(input, context)` call — tools use `orgId` for data scoping

**Extended thinking:**
```js
// Disabled by default. When enabled, budget_tokens must be < maxTokens.
// Supported on Claude 4+ models (claude-opus-4-6, claude-sonnet-4-6) without betas.
thinking: { enabled: true, budgetTokens: 10000 }
```
Thinking blocks are captured in `traceStep.thinking` and preserved verbatim in assistant turns (required by the Anthropic API for multi-turn extended thinking — stripping them causes an API error on the next call).

**Errors:** all failures throw `AgentError` (also exported) with `{ iterations, trace, cause }` attached:
```js
const { AgentError } = require('../services/AgentOrchestrator');

try {
  const { result } = await agentOrchestrator.run({ ... });
} catch (err) {
  if (err instanceof AgentError) {
    logger.error('Agent failed', { error: err.message, iterations: err.iterations });
    // err.trace contains all steps up to the failure
  }
}
```

**Usage accounting** — the orchestrator returns raw token counts; the caller is responsible for logging:
```js
const { result, tokensUsed } = await agentOrchestrator.run({ ... });
await logAndCheck({ userId, toolSlug, modelId: model, ...tokensUsed });
```

---

#### GoogleAdsService (`server/services/GoogleAdsService.js`)

Google Ads API v23 data layer. Handles OAuth2 token refresh automatically via `googleapis`; makes REST calls directly using Node's built-in `fetch`. All monetary values returned in AUD (cost_micros ÷ 1,000,000).

**Auth requirements:**
- Manager Account (MCC) required — standalone advertiser accounts cannot obtain a developer token
- `login-customer-id` header must be the Manager Account ID, not the advertiser ID
- Developer token at Explorer access level is sufficient for internal single-account use
- Refresh token is long-lived; access token expires hourly — `googleapis` OAuth2 client rotates automatically

| Method | Description |
|---|---|
| `getCampaignPerformance(days=30)` | Campaign totals: id, name, status, budget, impressions, clicks, cost, conversions, ctr, avgCpc |
| `getDailyPerformance(days=30)` | Account-level daily totals (customer resource): date, impressions, clicks, cost, conversions — ordered ASC for charting |
| `getSearchTerms(days=30)` | Top 50 search terms by clicks: term, status, impressions, clicks, cost, conversions, ctr — the high-intent signal for AI analysis |
| `getBudgetPacing()` | THIS_MONTH spend vs budget per campaign: name, monthlyBudget, spentToDate |

---

#### GoogleAnalyticsService (`server/services/GoogleAnalyticsService.js`)

Google Analytics Data API v1beta (GA4) data layer. Same OAuth2 pattern as GoogleAdsService — `googleapis` for token rotation, Node `fetch` for REST calls. The same refresh token covers both services (`analytics.readonly` scope included at grant time).

**Required env var:** `GOOGLE_GA4_PROPERTY_ID` — numeric GA4 property ID (Admin → Property Settings → Property ID).

| Method | Description |
|---|---|
| `getSessionsOverview(days=30)` | Daily sessions, activeUsers, newUsers, bounceRate — ordered by date ASC for charting |
| `getTrafficSources(days=30)` | Paid vs organic vs direct: channel, sessions, conversions, totalRevenue — ordered by sessions DESC |
| `getLandingPagePerformance(days=30)` | Top 20 landing pages: page, sessions, conversions, bounceRate, avgSessionDuration (seconds) |
| `getConversionEvents(days=30)` | Events with conversions > 0, by event name + date: event, date, eventCount, conversions |

---

#### Google Ads Monitor Agent (`server/agents/googleAdsMonitor/`)

First domain agent. Wires `GoogleAdsService` and `GoogleAnalyticsService` into the platform ReAct loop to produce a full campaign performance report with specific, number-backed recommendations.

**Entry point:** `runAdsMonitor(context)` — `context` must include `{ userId, orgId, toolSlug: 'google-ads-monitor' }`.

**Tools registered (toolSlug: `google-ads-monitor`):**

| Tool | Calls | Returns |
|---|---|---|
| `get_campaign_performance` | `googleAdsService.getCampaignPerformance(days)` | Per-campaign totals: budget, impressions, clicks, cost, conversions, ctr, avgCpc |
| `get_daily_performance` | `googleAdsService.getDailyPerformance(days)` | Account-level daily spend and conversion trends |
| `get_search_terms` | `googleAdsService.getSearchTerms(days)` | Top 50 user search queries by clicks — the high-intent signal source |
| `get_analytics_overview` | `googleAnalyticsService.getSessionsOverview(days)` | Daily GA4 sessions, users, and bounce rate for correlation with ad spend |

**Output sections:** Summary → Campaign Analysis → Search Term Insights (converting / wasted spend / ad copy opportunities) → Recommendations (numbered, specific, prioritised by impact).

**Conclusion persistence:** saves to `agent_conclusions` via `stateManager.saveConclusion()`. Persistence errors are caught and logged — the analysis is returned regardless.

---

#### File Ingestion Pipeline

Server-side extraction, chunking, and embedding of uploaded documents. The pipeline runs entirely on the server — no client-side processing, no third-party storage.

**Supported formats:** PDF (pdf-parse), Word (mammoth), Excel/XLSX (exceljs), plain text and code files (17 extension allowlist).

**Upload flow:**
1. `POST /api/files/upload` — multer validates MIME type and extension (500 KB limit), inserts a `document_extractions` row with status `pending`, spawns a Worker Thread, returns `{ extractionId }` immediately.
2. Worker Thread runs `extractionWorker.js` in isolation — creates its own pg Pool (Worker Threads do not share module instances with the parent process).
3. Worker extracts text → strips 14 prompt-injection patterns (role-override strings, instruction-bypass patterns) → chunks into ~500-token segments with 50-token overlap → calls `embedBatch()` → bulk-inserts to `document_embeddings` → updates status to `completed`.
4. `GET /api/files/:extractionId/status` — org-scoped poll endpoint; returns `{ extractionStatus, chunkCount }`.

**Why Worker Threads?** Extraction is CPU-intensive (PDF parsing, canvas rasterisation). Running it on the main event loop would block all other requests for the duration. Worker Threads run in parallel with the main thread; the response to the upload caller returns before extraction begins.

**Prompt-injection sanitisation:** Extracted text is scanned for patterns like `ignore previous instructions`, `you are now`, `SYSTEM:`, `</s>` and similar override tokens before chunking. A document containing these patterns is still processed — the offending text is replaced with a neutral marker rather than rejecting the upload. This prevents adversarial documents from redirecting the AI's behaviour when their chunks appear in context.

#### Multi-Tenant RAG Architecture

Retrieval-Augmented Generation with mandatory org-level isolation at every layer.

**Embedding model:** Google `text-embedding-004` — 768-dimensional vectors, accessed via `@google/generative-ai`. Lazy client initialisation (client created on first call, not at module load).

**Index:** HNSW (Hierarchical Navigable Small World) via pgvector. Parameters: m=16, ef_construction=64. Replaces IVFFlat which requires a separate `VACUUM` + `SELECT count(*)` before index construction is useful; HNSW builds incrementally as rows are inserted and delivers consistently better recall.

**Search flow (`POST /api/files/search`):**
1. `requireAuth` resolves `req.user.org_id`
2. PermissionService confirms the caller has a role for the requested project
3. `embedText(query)` produces a 768-dim query vector
4. `executeSearch({ orgId, projectId, queryEmbedding, topK })` runs a parameterised SQL query — `WHERE de.org_id = $1` is the first predicate; no other tenant's embeddings can appear in results regardless of `project_id` or `topK`
5. Results are returned without `org_id` — callers receive only chunk text, file metadata, and similarity score

**Two-layer isolation guarantee:**
- **Application layer:** PermissionService checks the caller has a project role before any DB query runs
- **SQL layer:** `org_id = $1` is a mandatory WHERE clause on both `document_embeddings` and the `document_extractions` join — never parameterised from user input; always sourced from `req.user.org_id`

Neither layer alone is sufficient: the application check can be bypassed if the route is called directly; the SQL check alone does not prevent a user from searching a project they were removed from.

**`executeSearch()` is a standalone function** (not an inline route closure) so that the telemetry layer can wrap it at a single call site without touching the isolation logic.

#### Governance and Observability Layer

Telemetry and admin analytics built on top of the file pipeline.

**TelemetryService (`server/services/telemetryService.js`):**
- `recordEvent(orgId, userId, eventType, metadata)` — always resolves, never rejects, never throws
- All DB logic is wrapped in try/catch; failures log at `warn` level only and are invisible to the caller
- Called as `void recordEvent(...)` from route handlers — no `await`, no error propagation, no impact on response time
- Supported events: `file_upload` (on accepted upload), `embedding_generated` (from worker on completion), `file_search` (on search with result count and duration)

**Admin usage analytics (`GET /api/admin/usage`):**
- Protected by `requireAuth` + `PermissionService.isOrgAdmin` — fails closed with 403
- `org_id` is always sourced from `req.user`; never accepted as a query parameter
- Optional filters: `from` / `to` ISO date strings (defaults: 30 days ago → now), `user_id` integer
- Returns summary aggregates (total uploads, searches, embeddings, chunks, average search duration) and per-user breakdown
- All queries are fully parameterised; `user_id` filter uses `AND user_id = $4` appended conditionally — no string interpolation

**Rate limiting on file endpoints (keyed by `req.user.id`, not IP):**
- Upload: 20 requests per hour — prevents bulk upload abuse per user, not per network
- Search: 60 requests per 10 minutes — prevents embedding API cost abuse
- Limiters are placed after `requireAuth` in the middleware chain so `req.user.id` is available as the key
- IP-keyed limiting is inappropriate here because org users share infrastructure; a single user abusing uploads should not affect their colleagues

#### Security Test Suite

`server/tests/ragIsolation.test.js` — five security contract tests using the Node built-in `node:test` runner. No live database required: `require.cache` is injected with stub modules before any route module loads.

**What is tested and why:**

| Test | Contract |
|---|---|
| SQL org isolation | Search SQL `$1` is always `req.user.org_id`; `org_id`/`orgId` absent from response payload |
| Cross-org status 404 | Status query includes both `extraction_id` and `org_id` params; a valid extraction from another org returns 404, not 200 |
| Cross-org project 403 | A project belonging to another org returns 403 before any search executes; `results` absent from body |
| Telemetry resilience | `recordEvent` resolves under 4 bad-input scenarios: DB throws, null args, undefined args, zero/empty values |
| Admin gate 403 | A non-admin authenticated user receives 403 from the usage endpoint; `summary` and `byUser` absent from body |

**Why these five?** Each test targets a failure mode that cannot be caught by unit tests on individual functions — they require the full middleware chain, the route handler, and the DB query to run together through the stub. The SQL isolation test specifically asserts that the `org_id` value passed into the query is the value from `req.user`, not from any query parameter or request body — a class of bug that static analysis cannot catch.

**Run:**
```bash
node --test server/tests/ragIsolation.test.js
```

#### Tool Model Access Policy
Each tool defines its model access policy in `tools.config.roleModelAccess` — a map of role name to tier. `PermissionService.getPermittedModels` reads this at request time; org_admin always receives all models regardless.

**Chat tool policy (default):**
```json
{
  "roleModelAccess": {
    "org_member":    "standard",
    "chat_advanced": "advanced",
    "chat_premium":  "premium"
  }
}
```

This means:
- All org members can use Haiku by default — no admin action needed
- Admin grants `chat_advanced` to a user to unlock Sonnet
- Admin grants `chat_premium` to a user to unlock Opus

#### Tool Role Registry
Each tool's `config.roles` array defines the roles an admin can grant to users for that tool. This drives the **Grant Access** dropdown in Admin → Users dynamically — adding a new tool requires no changes to admin UI code.

```json
{
  "roles": [
    { "name": "chat_advanced", "label": "AI Chat — Advanced (Sonnet)", "scopeId": "chat" },
    { "name": "chat_premium",  "label": "AI Chat — Premium (Opus)",    "scopeId": "chat" }
  ]
}
```

`GET /api/admin/tool-roles` aggregates these across all enabled tools.

#### API Endpoints

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/api/health` | GET | No | Server health check |
| `/api/auth/register` | POST | No | Create new user (rate limited) |
| `/api/auth/login` | POST | No | Login, returns token + roles + profile (rate limited) |
| `/api/auth/logout` | POST | Yes | Invalidate session token |
| `/api/auth/me` | GET | Yes | Current user with roles and profile fields |
| `/api/auth/profile` | PUT | Yes | Update first name, last name, phone |
| `/api/auth/change-password` | POST | Yes | Change password — checks history, rejects last 5 |
| `/api/auth/forgot-password` | POST | No | Generate reset token, send email (rate limited) |
| `/api/auth/reset-password/:token` | GET | No | Validate reset token, return email |
| `/api/auth/reset-password` | POST | No | Consume token, set new password, invalidate sessions |
| `/api/org` | GET | Yes | Current organisation details |
| `/api/tools` | GET | Yes | List installed tools |
| `/api/tools/datetime` | GET | tool role or org_admin | Datetime tool — basic or extended response by role |
| `/api/tools/:toolSlug/permitted-models` | GET | Yes | Models the user may use for this tool |
| `/api/tools/:toolSlug/analyse-prompt` | POST | Yes | Classify prompt complexity, return model suggestion bounded to user's permitted tier |
| `/api/tools/:toolSlug/stream` | POST | Yes | SSE stream — Anthropic response chunked as events |
| `/api/admin/users` | GET | org_admin | All users with roles and activation status |
| `/api/admin/invite` | POST | org_admin | Create invitation, sends email, returns activation URL |
| `/api/admin/users/:id/resend-invite` | POST | org_admin | Regenerate activation link, sends email |
| `/api/admin/users/:id/roles` | GET | org_admin | All roles for a user (global + tool-scoped) |
| `/api/admin/users/:id/tool-access` | GET | org_admin | Structured tool access view — each tool with options and user's current selection |
| `/api/admin/users/:id/tool-access` | PUT | org_admin | Update tool access — accepts `{ access: { toolSlug: roleName\|null } }`, applies diffs |
| `/api/admin/users/:id/grant-role` | POST | org_admin | Grant a role at any scope |
| `/api/admin/users/:id/revoke-role` | POST | org_admin | Revoke a role at any scope |
| `/api/admin/tool-roles` | GET | org_admin | All assignable tool roles across enabled tools |
| `/api/admin/ai-models` | GET | org_admin | Live model catalogue from system_settings |
| `/api/admin/ai-models` | PUT | org_admin | Save full model array to system_settings |
| `/api/admin/ai-models/reset` | POST | org_admin | Restore default model catalogue |
| `/api/admin/model-status` | GET | org_admin | Whether ANTHROPIC_API_KEY is configured |
| `/api/admin/test-model` | POST | org_admin | Send a live probe to an Anthropic model |
| `/api/admin/security-settings` | GET | org_admin | Current security thresholds (rate limit, lockout attempts, lockout duration) |
| `/api/admin/security-settings` | PUT | org_admin | Update thresholds — clamped server-side; rate limit applied in-process immediately |
| `/api/admin/logs` | GET | org_admin | Paginated app logs — filter by level and message |
| `/api/admin/email-templates` | GET | org_admin | List all email templates |
| `/api/admin/email-templates/:slug` | GET | org_admin | Get single template with full HTML and plain text body |
| `/api/admin/email-templates/:slug` | PUT | org_admin | Update template subject, body_html, body_text |
| `/api/admin/email-templates/:slug/reset` | POST | org_admin | Reset template to hardcoded default content |
| `/api/user-settings` | GET | Yes | All key/value settings for the authenticated user |
| `/api/user-settings` | POST | Yes | Upsert a single setting `{ key, value }` for the authenticated user |
| `/api/admin/app-settings` | GET | org_admin | Organisation-wide app settings (allowed file types, default timezone) |
| `/api/admin/app-settings` | PUT | org_admin | Update organisation-wide app settings |
| `/api/invitations/:token` | GET | No | Validate invitation token |
| `/api/invitations/accept` | POST | No | Accept invitation, set password, return session |
| `/api/files/upload` | POST | Yes (rate limited: 20/hr) | Upload file for extraction and embedding — PDF, Word, Excel, plain text; 500 KB limit |
| `/api/files/:extractionId/status` | GET | Yes | Extraction status and chunk count for an uploaded file |
| `/api/files/:fileId` | GET | Yes | Download a file — org-scoped ownership check |
| `/api/files/search` | POST | Yes (rate limited: 60/10 min) | Semantic similarity search across org/project embeddings — returns ranked chunks with source metadata |
| `/api/admin/usage` | GET | org_admin | Org-scoped usage analytics — uploads, searches, embeddings, per-user breakdown, configurable date window |

---

### Database Schema

#### Core Tables

| Table | Description |
|---|---|
| `organizations` | Single org; all users and data scoped to it |
| `users` | Email + bcrypt password hash (nullable until activated) + `is_active` flag + `first_name`, `last_name`, `phone` + `failed_login_attempts`, `locked_until` |
| `auth_sessions` | Token-based sessions with expiry |
| `password_reset_tokens` | One-time 1-hour tokens for password reset flow |
| `password_history` | Last N password hashes per user — reuse blocked on change and reset |
| `roles` | System-defined roles (`org_admin`, `org_member`) + tool-defined roles (`datetime_viewer`, `chat_advanced`, …) |
| `user_roles` | Many-to-many role assignments with contextual scoping (`global` / `tool` / `resource`) |
| `invitation_tokens` | One-time 48h activation tokens for invited users |
| `user_settings` | JSONB key/value settings per user |
| `system_settings` | Admin-managed global config — security thresholds, spend thresholds, AI model catalogue |
| `tools` | Tool registry — slug, name, version, enabled flag, JSONB config (roleModelAccess, roles) |
| `usage_logs` | One row per AI response — model, tokens, cost, user, tool |
| `app_logs` | Server log entries (info, warn, error) written by Winston DB transport |
| `email_templates` | Admin-editable email templates — slug, subject, body_html, body_text, variables array, tool_slug |
| `document_extractions` | One row per uploaded file — UUID PK, org_id, project_id, file path, MIME type, extraction status (`pending` / `processing` / `completed` / `failed`), chunk count |
| `document_embeddings` | One row per text chunk — UUID PK, extraction_id FK, org_id, project_id, chunk text, `vector(768)` embedding, chunk index, metadata JSONB |
| `usage_events` | One row per telemetry event — UUID PK, org_id, user_id, event_type (`file_upload` / `embedding_generated` / `file_search`), file_type, chunk_count, query_tokens, result_count, embedding_model, duration_ms |

#### Key Design Decisions
- `users.password_hash` is nullable — invited users have no password until they activate
- `users.is_active = false` for invited users — blocks login until activation
- Roles are never stored on the `users` table — always in `user_roles` with scope
- `user_roles` unique index uses `COALESCE(scope_id, '')` to handle nullable scope correctly
- `password_history` stores hashed passwords only — checked with `bcrypt.compare`, never stored in plain text
- `app_logs` stores `info`, `warn`, `error` — `http` request logs are console-only to avoid table bloat
- `system_settings` holds both operational config (spend thresholds) and the live AI model catalogue
- `tools.config` JSONB stores both the model access policy (`roleModelAccess`) and the list of grantable roles (`roles`) — a new tool is self-describing with no admin UI code changes needed
- `document_extractions` and `document_embeddings` use UUID PKs; `org_id`/`project_id`/`user_id` are INTEGER FKs matching the SERIAL PKs on existing tables
- `document_embeddings.embedding` is `vector(768)` — matches Google `text-embedding-004` output dimensionality; indexed with HNSW (m=16, ef_construction=64) for approximate nearest-neighbour search
- `usage_events` records are append-only — no updates; admin analytics queries are always date-range bounded via `idx_usage_events_org_created_at`

---

### Frontend (React/Vite)

Located in `client/`.

#### Design System
- CSS custom properties for theming (`--color-bg`, `--color-surface`, `--color-border`, `--color-primary`, `--color-text`, `--color-muted`)
- 5 themes: Warm Sand (default), Dark Slate, Forest, Midnight Blue, Paper White
- Separate body font and heading font pickers — 16 Google Fonts across sans-serif, serif, and monospace categories
- Lucide icon set via `IconProvider` with semantic name mapping
- `ThemeProvider` loads Google Fonts dynamically and injects CSS variables — no page reload needed
- Zustand stores persisted to localStorage

#### Pages

| Page | Route | Access |
|---|---|---|
| Login | `/login` | Public |
| Forgot Password | `/forgot-password` | Public |
| Reset Password | `/reset/:token` | Public |
| Accept Invitation | `/invite/:token` | Public |
| Dashboard | `/` | Authenticated |
| Settings | `/settings` | Authenticated |
| Admin — Users | `/admin/users` | org_admin only |
| Admin — AI Models | `/admin/ai-models` | org_admin only |
| Admin — Security | `/admin/security` | org_admin only |
| Admin — Email Templates | `/admin/email-templates` | org_admin only |
| Admin — Logs | `/admin/logs` | org_admin only |
| Admin — App Settings | `/admin/app-settings` | org_admin only |
| Date & Time tool | `/tools/datetime` | datetime role or org_admin |
| AI Chat tool | `/tools/chat` | org_member or org_admin |
| Model Advisor | `/tools/advisor` | org_member or org_admin |
| Projects | `/tools/projects` | org_member or org_admin |
| Google Ads | `/tools/ads` | org_admin only |
| Video Studio | `/tools/video` | org_admin only |

**Login** — Vault-style card layout. ToolsForge brand mark. Email/password with show/hide toggle. "Forgot password?" link below sign-in button.

**Forgot Password** — Email input. Always returns success (doesn't reveal whether email is registered). On submit, sends 1-hour reset link via email.

**Reset Password** — Validates token on load. Shows invalid/expired state if token is bad. Set new password form with show/hide toggles and confirm field. On success, redirects to login after 3 seconds.

**Accept Invitation** — Validates token on load. Shows set-password form. On activation, logs user in immediately and redirects to dashboard. Shows clear error for invalid/expired tokens.

**Dashboard** — Greeting, org name, and signed-in user. Tool cards rendered from the tool registry (`config/tools.js`) — only permitted tools shown based on the user's role. Cards use theme CSS variables (`--color-surface`, `--color-border`, `--color-primary`, `--color-text`, `--color-muted`) and heading/body font variables so they respond to the active theme and font selections. Icons are Lucide icons (via `IconProvider`) coloured with `--color-primary`, not emojis. "Open →" button uses `--color-primary` background. "Last used: …" shortcut shown below the grid.

**Settings — Profile tab** — Email (read-only). First name + last name (side by side) + phone. Change password section with current/new/confirm fields and show/hide toggles. Password reuse of last 5 is blocked server-side.

**Settings — Appearance tab** — Live theme picker (5 swatches). Font picker with two tabs: Body Font and Heading Font. Fonts grouped by category (sans-serif, serif, monospace) with sample text previews. Selections apply immediately via CSS custom properties.

**Admin — Users** — Table of all org users showing email, active/pending status badge, global roles as pills, join date. Invite User button opens modal. Invite modal: email + role selector → on success shows "Email sent" confirmation with collapsible fallback link. Resend Invite button on pending users regenerates the link and resends the email. **Manage Access** button opens the access modal — shows Organisation section (promote/demote org_admin, self-demotion blocked) and Tool Access section. Tool Access renders one radio group per installed tool: each tool shows its access options in plain language (e.g. "Standard (all members) / Advanced / Premium") with the user's current selection highlighted. Single **Save Changes** button applies only the changed tools as role diffs. Role names (`chat_advanced`, etc.) are never exposed to the admin — the modal is a projection layer over the underlying RBAC model. New tools appear automatically with no admin UI code changes.

**Admin — AI Models** — Manage the AI model catalogue. Displays all configured models with tier badge, API ID, and pricing. Add, edit, or delete any model. Edit form includes model API ID, display name, tier (standard / advanced / premium), provider, emoji, label, tagline, description, input price per 1M tokens, output price per 1M tokens, and context window. **Test** button sends a live probe to the Anthropic API and shows the result inline. **Reset defaults** button restores the three built-in models. API key status banner shows whether `ANTHROPIC_API_KEY` is configured. Changes take effect immediately across the entire platform — no redeploy needed.

**Admin — Security** — Configure authentication security thresholds without a code deploy. Three settings:
- **Max failed login attempts** — how many consecutive wrong passwords lock an account (default: 5, range: 1–20)
- **Account lockout duration** — how long a locked account stays locked (default: 15 minutes, range: 1–1440)
- **Login rate limit** — maximum login attempts per IP address per 15-minute window (default: 5, range: 1–20)

Each field highlights when its value differs from the last saved state. Save Changes applies all at once. Reset to defaults restores the original values in the form without saving — requires an explicit save to commit. An explanatory panel below the fields describes how rate limiting and account lockout complement each other, so the admin understands the trade-off before adjusting.

Rate limit changes take effect immediately (in-process, no restart). Lockout threshold changes take effect on the next login attempt.

**Admin — Email Templates** — Lists all platform and tool email templates grouped by section. Each row shows the subject, description, and available `{{variables}}`. Clicking Edit opens a modal with three tabs: **HTML Source** (edit raw HTML — what email clients display), **Preview** (rendered iframe view of the HTML with placeholders shown as-is), and **Plain Text** (fallback for non-HTML clients, with an Auto-generate from HTML button). Variable chips are clickable — click any chip to insert the placeholder at the cursor position in whichever field is active. Changes are saved to the DB and survive server restarts; defaults are never overwritten on deploy. A Reset to Default button restores the original hardcoded content.

**Admin — Logs** — Paginated table of server log entries (info, warn, error). Level filter tabs, message search, expandable metadata rows, auto-refresh toggle (15s), pagination (50 per page).

**Date & Time** — Proof-of-concept tool demonstrating three access tiers: no role → access denied screen; `datetime_viewer` → date and time; `datetime_extended` (or org_admin) → date, time, timezone, UTC offset, server location. Refresh button re-fetches live server time.

**Admin — App Settings** — Organisation-wide defaults for chat behaviour. Two settings: **Allowed File Types** (comma-separated MIME/extension list accepted in chat uploads, e.g. `.pdf,.txt,image/*`) and **Default Timezone** (used as the org-level fallback for AI date context; individual users can override in their profile). Dirty-state border highlight on any changed field. `GET/PUT /api/admin/app-settings`.

**AI Chat** — Full chat interface using the SSE streaming backbone. Model picker shows only the models the signed-in user is permitted to use for this tool (resolved from their roles). Streaming assistant responses rendered in real time. Token + cost badge shown after each response. Auto-resizing textarea, Shift+Enter for new lines, Stop button to abort mid-stream, New Chat to reset. All org members get Haiku by default; admins grant `chat_advanced` (Sonnet) or `chat_premium` (Opus) per user. Full media and voice capability: mic button for voice dictation, speaker button to read aloud responses, paperclip button to attach files, image paste from clipboard, date stamp below each AI response.

Every send passes through the **Model Advisor** before the stream opens — see below.

#### Model Advisor

A pre-send classifier that intercepts every chat submission and suggests a better-matched model if the current selection is a poor fit for the task.

**Flow:**
1. User presses Enter or the send button → `checkModelBeforeSend()` fires
2. Client POSTs `{ prompt, currentModelId }` to `POST /api/tools/chat/analyse-prompt`
3. Server uses the cheapest permitted model to classify prompt complexity: `simple → standard`, `moderate → advanced`, `complex → premium`
4. If the current model already matches that tier: `mismatch: false` → send proceeds immediately with no interruption
5. If there is a mismatch: `ModelAdvisorModal` opens with the reason and a list of suggested alternatives
6. User chooses **Switch & Send** (changes model, fires send), **Keep & Send** (ignores suggestion, sends anyway), or dismisses (cancels)

**Why this matters for an organisation:**

In a single-user application the user owns both the cost and the decision — they can freely pick whatever model they like. In a multi-user organisational platform, the calculus is different:

- **Cost is shared.** Overspending on a premium model for a simple question wastes budget that affects everyone in the org.
- **Admins grant model tiers, not individual prompts.** A user granted Sonnet access should be guided toward using Haiku when Haiku is sufficient — the advisor does this automatically, without admin involvement on every interaction.
- **Access limits are hard; quality guidance is soft.** The advisor is advisory, not blocking — the user always retains control. But it surfaces the right choice at the right moment.
- **The suggestion is permission-bounded.** The advisor will never suggest a model the user cannot access. If a prompt genuinely needs Opus but the user only has Sonnet access, the advisor surfaces Sonnet (the best within their tier) — it does not expose what they're missing or offer an upgrade path. Access decisions remain with the admin.

This combination — hard server-side enforcement on the stream endpoint, soft client-side guidance before the send — means cost efficiency is the default behaviour without requiring users to understand tier economics.

**Failure safety:** If the classifier call fails (network error, API issue, malformed response), the endpoint returns `{ mismatch: false }` and the send proceeds normally. The user is never blocked.

#### Hooks

**`useStream(toolSlug)`** (`client/src/hooks/useStream.js`) — generic SSE streaming hook for AI tools. Uses `fetch` + `ReadableStream` (not `EventSource`, which does not support POST). Exposes `send(messages, modelId, options)`, `stop()`, `reset()`, `streaming`, `content`, `usage`, `error`. Any tool page uses this hook — no tool writes its own SSE reader.

**`useSpeechInput()`** (`client/src/hooks/useSpeechInput.js`) — headless voice dictation via Web Speech API. `continuous: true`, accumulates finals + interim across natural pauses. Returns `{ listening, transcript, start, stop, clear, supported }`. Hides itself gracefully in unsupported browsers.

**`useReadAloud()`** (`client/src/hooks/useReadAloud.js`) — headless text-to-speech via `speechSynthesis`. Calls `stripForSpeech()` before speaking to remove markdown, code blocks, and URLs. Returns `{ speaking, paused, speak, pause, resume, stop, supported }`.

**`useClipboardMedia()`** (`client/src/hooks/useClipboardMedia.js`) — handles image paste from clipboard. Resizes pasted images to 800 px on the longest edge (JPEG 0.75 quality) client-side. Returns `{ images, addFromPaste(e), removeImage(id), clear }`. `addFromPaste` returns `true` if an image was captured (caller should suppress default paste behaviour).

**`useFileAttachment()`** (`client/src/hooks/useFileAttachment.js`) — file picker with admin-configurable allowed types. Fetches `chat_allowed_file_types` from `/api/admin/app-settings` on mount. Images go through the same canvas resize pipeline as clipboard paste. Text files (`.txt`, `.md`, `.csv`, `.json`, code files) are read client-side via FileReader — 500 KB limit. Returns `{ files, images, openPicker, removeFile, removeImage, clear, allowedTypes }`.

#### Component Structure
```
client/src/
  App.jsx                      # Router, providers, future flags; wraps /tools/ads + /tools/video in RequireRole
  main.jsx
  index.css                    # Tailwind + CSS variables + scrollbar
  themes.js                    # 5 theme definitions + 16 Google Fonts
  config/
    tools.js                   # TOOLS array — id, name, path, lucideIcon, description, requiredPermission
                               # getPermittedTools(userRole) filters by role
  providers/
    ThemeProvider.jsx          # Loads Google Fonts + injects CSS vars on change
    IconProvider.jsx           # Semantic icon map (Lucide) — all tool lucideIcon values registered here
  stores/
    authStore.js               # token, user (incl. profile fields) — persisted; default export
    settingsStore.js           # theme, bodyFont, headingFont — persisted; default export
    toolStore.js               # lastVisitedTool, sidebarCollapsed — persisted; default export
  hooks/
    useStream.js               # Generic SSE streaming hook for AI tools
    useSpeechInput.js          # Headless voice dictation (Web Speech API)
    useReadAloud.js            # Headless text-to-speech (speechSynthesis)
    useClipboardMedia.js       # Clipboard image paste with canvas resize
    useFileAttachment.js       # File picker — images + text, admin-configured types
  utils/
    apiClient.js               # Fetch wrapper — auto-attaches Bearer token; intercepts 401 → clears auth + redirects /login
    stripForSpeech.js          # Strips markdown/code/URLs before TTS — importable by any tool
  components/
    RequireAuth.jsx            # Route guard — checks token presence; redirects to /login if missing
    RequireRole.jsx            # Route guard — checks user.role against allowedRoles prop; redirects to / if not authorised
    AppShell.jsx               # Fixed desktop sidebar + mobile drawer + TopNav + Outlet
    TopNav.jsx                 # Top bar — brand, global search, user menu
    GlobalSearchBar.jsx        # Command-palette style search across tools and pages
    Sidebar.jsx                # Nav links: Home, Tools section, Admin section (org_admin), Settings
    Toast.jsx                  # Toast context + floating notifications
    ModelAdvisorModal.jsx      # Pre-send model suggestion modal — Switch & Send / Keep & Send
    VoiceInputButton.jsx       # Stateless UI primitive — mic idle / red pulsing dot + Stop when active
    ReadAloudButton.jsx        # Stateless UI primitive — speaker idle / pause + stop when speaking
  pages/
    LoginPage.jsx
    ForgotPasswordPage.jsx
    ResetPasswordPage.jsx
    AcceptInvitePage.jsx
    DashboardPage.jsx          # Theme-aware tool cards (CSS vars); Lucide icons via IconProvider; role-filtered via getPermittedTools
    SettingsPage.jsx           # Profile tab includes user timezone override
    AdminUsersPage.jsx
    AdminAIModelsPage.jsx
    AdminSecurityPage.jsx
    AdminEmailTemplatesPage.jsx
    AdminLogsPage.jsx
    AdminAppSettingsPage.jsx   # Allowed file types + default timezone
    DateTimePage.jsx
    ChatPage.jsx               # Voice input, read aloud, file attachments, image paste, date stamps
```

---

## Server File Structure

```
server/
  index.js                     # App entry — Morgan, CORS (API only), routes, startup
  db.js                        # Schema init, idempotent migrations, seeding
  middleware/
    requireAuth.js             # requireAuth + requireRole (delegates to PermissionService)
    requireToolAccess.js       # Tool gate — any tool-scoped role or org_admin; attaches req.toolAccess
    rateLimit.js               # authLimiter (20 req / 15 min)
  services/
    permissions.js             # PermissionService — all authorisation + model access logic
    invitations.js             # InvitationService — invite + activate + resend flow (sends email)
    email.js                   # EmailService — MailChannels HTTP API; nodemailer SMTP fallback
    emailTemplates.js          # EmailTemplateService — DB-backed template CRUD + {{variable}} render
    costCalculator.js          # Async cost calculator — reads pricing from DB model catalogue
    usageLogger.js             # logUsage + checkSpendThresholds + logAndCheck
    AgentOrchestrator.js       # ReAct loop engine — Claude + tool-use execution primitive; exports { AgentOrchestrator, AgentError, agentOrchestrator }
    ToolRegistry.js            # Platform tool management — register/discover/execute tools; exports { ToolRegistry, ValidationError, toolRegistry }
    StateManager.js            # Org-scoped agent memory — key-value state + run conclusions; exports { StateManager, stateManager }
    AgentScheduler.js          # Cron + manual agent scheduling — register/trigger/pause/resume/history; exports { AgentScheduler, AgentSchedulerError, agentScheduler }
    GoogleAdsService.js        # Google Ads API v23 client — campaign perf, daily trends, search terms, budget pacing; exports { GoogleAdsService, googleAdsService }
    GoogleAnalyticsService.js  # GA4 Data API v1beta client — sessions, traffic sources, landing pages, conversion events; exports { GoogleAnalyticsService, googleAnalyticsService }
  agents/
    googleAdsMonitor/
      tools.js   # 4 tools registered into ToolRegistry (toolSlug: 'google-ads-monitor'): get_campaign_performance, get_daily_performance, get_search_terms, get_analytics_overview
      prompt.js  # SYSTEM_PROMPT — analyst role, data-gathering protocol, output format (Summary / Campaign Analysis / Search Term Insights / Recommendations)
      index.js   # runAdsMonitor(context) — getAvailableTools → agentOrchestrator.run → stateManager.saveConclusion → { result, trace, tokensUsed }
    chunkingService.js         # chunkText(text, targetTokens, overlapTokens) — ~500 token chunks, 50 token overlap
    embeddingService.js        # embedText / embedBatch — Google text-embedding-004 (768-dim), lazy client init
    telemetryService.js        # recordEvent(orgId, userId, eventType, metadata) — fire-and-forget, never throws
  workers/
    extractionWorker.js        # Worker Thread — pdf-parse / mammoth / exceljs / plain text; sanitises prompt-injection; bulk-inserts embeddings
  utils/
    logger.js                  # Winston logger — console + DB transport (info/warn/error to app_logs)
    emailDefaults.js           # Hardcoded default template content — seeding source + fallback
    modelCatalogue.js          # Static defaults + async DB-backed model helpers
  routes/
    auth.js                    # register, login, logout, me, profile, change-password, forgot/reset-password
    tools.js                   # GET /api/tools
    datetime.js                # GET /api/tools/datetime — basic or extended by role
    stream.js                  # SSE streaming + permitted-models + analyse-prompt for all AI tools
    org.js                     # GET /api/org
    admin.js                   # users, invite, roles, tool-roles, ai-models, test-model, security-settings, logs, email-templates, app-settings
    adminUsage.js              # GET /api/admin/usage — org-scoped telemetry analytics (admin only)
    userSettings.js            # GET/POST /api/user-settings — per-user key/value JSONB store
    invitations.js             # GET /api/invitations/:token, POST /api/invitations/accept
    files.js                   # upload, status, download, search — rate-limited; org isolation enforced at SQL layer
  tests/
    ragIsolation.test.js       # node:test security contract suite — org isolation, cross-org 403/404, telemetry resilience, admin gate
```

---

## Reusable Tool Primitives

These are ready-to-drop-in building blocks. Each follows the **three-layer pattern**:

1. **Headless hook** — pure logic, no JSX. Manages state and browser APIs. Lives in `client/src/hooks/`.
2. **UI primitive** — a stateless, styled component with no knowledge of the tool it's in. Lives in `client/src/components/`.
3. **Integration point** — the tool page composes the hook and UI primitive together. Business logic (what to do with the result) stays in the page.

This separation means a hook can power any tool (or multiple tools simultaneously), and a UI primitive can be reskinned without touching any hook logic.

---

### Voice Input

Lets users dictate into any text field using the Web Speech API.

**Hook:** `useSpeechInput()` — `client/src/hooks/useSpeechInput.js`
```js
const { listening, transcript, start, stop, clear, supported } = useSpeechInput();
```
- `listening` — `true` while recording
- `transcript` — accumulated text (finals + live interim)
- `start()` / `stop()` — begin / end session
- `clear()` — reset transcript to empty string
- `supported` — `false` in browsers without `SpeechRecognition` (hide the button)

**UI primitive:** `VoiceInputButton` — `client/src/components/VoiceInputButton.jsx`
```jsx
<VoiceInputButton
  listening={listening}
  onStart={start}
  onStop={stop}
  disabled={streaming}
/>
```
Idle state: mic icon. Active state: red pulsing dot + "Stop" pill.

**Integrating into a new tool page:**
```jsx
import { useSpeechInput } from '../hooks/useSpeechInput';
import VoiceInputButton from '../components/VoiceInputButton';

const { listening, transcript, start, stop, clear, supported } = useSpeechInput();

// Sync transcript to your input field
useEffect(() => { if (transcript) setInput(transcript); }, [transcript]);

// Stop mic when sending
function handleSend() {
  if (listening) { stop(); clear(); }
  // ... rest of send logic
}

// In JSX — place next to your textarea send button
{supported && (
  <VoiceInputButton listening={listening} onStart={start} onStop={stop} disabled={streaming} />
)}
```

---

### Read Aloud

Reads any text string aloud via the browser's speech synthesis engine. Strips markdown, code blocks, and URLs before speaking so the output sounds natural.

**Utility:** `stripForSpeech(text)` — `client/src/utils/stripForSpeech.js`

Standalone function. Removes fenced code blocks, inline code, URLs, HTML tags, markdown syntax. Any tool can import and use this directly (e.g. to pre-process text before display or export as well as speech).

**Hook:** `useReadAloud()` — `client/src/hooks/useReadAloud.js`
```js
const { speaking, paused, speak, pause, resume, stop, supported } = useReadAloud();
```
- `speak(text)` — calls `stripForSpeech` internally; starts utterance
- `pause()` / `resume()` / `stop()` — playback controls
- `supported` — `false` in browsers without `speechSynthesis`

**UI primitive:** `ReadAloudButton` — `client/src/components/ReadAloudButton.jsx`
```jsx
<ReadAloudButton
  speaking={speaking}
  paused={paused}
  onSpeak={() => speak(messageText)}
  onPause={pause}
  onResume={resume}
  onStop={stop}
/>
```
Idle: speaker icon. Playing: pause + stop buttons. Paused: play + stop buttons.

**Integrating into a new tool page:**
```jsx
import { useReadAloud } from '../hooks/useReadAloud';
import ReadAloudButton from '../components/ReadAloudButton';

const { speaking, paused, speak, pause, resume, stop: stopReading, supported: ttsSupported } = useReadAloud();

// Stop reading when a new send begins
function handleSend() {
  if (speaking) stopReading();
  // ... rest of send logic
}

// In JSX — place below any text response
{ttsSupported && (
  <ReadAloudButton
    speaking={speaking}
    paused={paused}
    onSpeak={() => speak(responseText)}
    onPause={pause}
    onResume={resume}
    onStop={stopReading}
  />
)}
```

---

### Clipboard Image Paste

Captures images pasted from the clipboard (screenshot, image copy) and resizes them client-side before sending to the AI. No server round-trip required.

**Hook:** `useClipboardMedia()` — `client/src/hooks/useClipboardMedia.js`
```js
const { images, addFromPaste, removeImage, clear } = useClipboardMedia();
```
- `images` — array of `{ id, mimeType, data (base64), preview (data-URL) }`
- `addFromPaste(e)` — call from a `onPaste` handler; returns `true` if an image was captured (call `e.preventDefault()` is handled inside). Returns `false` for non-image paste — let the default behaviour proceed.
- `removeImage(id)` — remove one image by id
- `clear()` — remove all (call after send)

Images are resized to a maximum 800 px on the longest edge, encoded as JPEG at 0.75 quality.

**Integrating into a new tool page:**
```jsx
import { useClipboardMedia } from '../hooks/useClipboardMedia';

const { images: pastedImages, addFromPaste, removeImage: removePasted, clear: clearPasted } = useClipboardMedia();

// On textarea
<textarea onPaste={addFromPaste} ... />

// Show thumbnails
{pastedImages.map(img => (
  <div key={img.id} style={{ position: 'relative', display: 'inline-block' }}>
    <img src={img.preview} style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 8 }} />
    <button onClick={() => removePasted(img.id)}>×</button>
  </div>
))}

// After send
clearPasted();
```

---

### File Attachment

Lets users attach files via a file picker. Images go through the same canvas resize pipeline as clipboard paste. Text/code files are injected inline into the message. Allowed file types are read from the admin App Settings (`/api/admin/app-settings`).

**Hook:** `useFileAttachment()` — `client/src/hooks/useFileAttachment.js`
```js
const { files, images, openPicker, removeFile, removeImage, clear, allowedTypes } = useFileAttachment();
```
- `files` — array of `{ id, name, content (string) }` — text/code files, ready to prepend to message
- `images` — array of `{ id, mimeType, data, preview }` — same shape as clipboard images
- `openPicker()` — opens the native file picker with `allowedTypes` as the `accept` attribute
- `removeFile(id)` / `removeImage(id)` — remove individual attachments
- `clear()` — clear all attachments (call after send)
- `allowedTypes` — string loaded from admin settings (e.g. `.pdf,.txt,image/*`)

**Integrating into a new tool page:**
```jsx
import { useFileAttachment } from '../hooks/useFileAttachment';

const { files, images: attachedImages, openPicker, removeFile, removeImage: removeAttached, clear: clearAttachments } = useFileAttachment();

// Paperclip button
<button onClick={openPicker}>📎</button>

// Combine with clipboard images for the API call
const allImages = [...pastedImages, ...attachedImages];

// Prepend text file content to the message
const textContent = files.map(f => `[File: ${f.name}]\n${f.content}`).join('\n\n');
const fullMessage = textContent ? `${textContent}\n\n${userInput}` : userInput;

// Build multipart Anthropic messages when images are present
const content = allImages.length > 0
  ? [
      ...allImages.map(img => ({ type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.data } })),
      { type: 'text', text: fullMessage },
    ]
  : fullMessage;

// After send
clearAttachments();
```

---

### Timezone-Aware Date Context

Injects the current date and time (in the correct timezone) into the AI system prompt on every call, so responses are always temporally grounded.

**Timezone resolution chain (in order of precedence):**
1. User setting — `GET /api/user-settings` → key `timezone`
2. Org default — `GET /api/admin/app-settings` → `default_timezone`
3. Browser fallback — `Intl.DateTimeFormat().resolvedOptions().timeZone`

**In a tool page:**
```js
// Load on mount
const [timezone, setTimezone] = useState('UTC');
useEffect(() => {
  Promise.all([
    api.get('/api/user-settings').then(r => r.json()),
    api.get('/api/admin/app-settings').then(r => r.json()),
  ]).then(([userSettings, appSettings]) => {
    setTimezone(
      userSettings.timezone ||
      appSettings.default_timezone ||
      Intl.DateTimeFormat().resolvedOptions().timeZone
    );
  });
}, []);

// Build system prompt with date context
function buildSystemPrompt(tz) {
  const now = new Date().toLocaleString('en', {
    timeZone: tz,
    dateStyle: 'full',
    timeStyle: 'short',
  });
  return `Current date and time: ${now} (${tz}).\n\nYou are a helpful assistant.`;
}

// Pass to stream
await send(messages, modelId, { system: buildSystemPrompt(timezone) });
```

**Admin configuration:** `Admin → App Settings` → Default Timezone (select from full `Intl.supportedValuesOf('timeZone')` list).

**User override:** `Settings → Profile → Timezone` — overrides the org default for that user only. Saved to `user_settings` table via `POST /api/user-settings` with `{ key: 'timezone', value: tz }`.

---

### Adding All Primitives to a New Tool — Checklist

When building a new AI tool page that needs the full capability set:

- [ ] Import `useSpeechInput` + `VoiceInputButton` — place mic button beside send
- [ ] Import `useReadAloud` + `ReadAloudButton` — place speaker button below each AI response
- [ ] Import `useClipboardMedia` — attach `onPaste={addFromPaste}` to textarea
- [ ] Import `useFileAttachment` — add paperclip button; merge `files` + `images` into message
- [ ] Load timezone via the three-tier resolution chain on mount
- [ ] Pass `{ system: buildSystemPrompt(timezone) }` in every `send()` call
- [ ] In `handleSend`: call `stop()` + `clear()` on speech input, call `stopReading()` on TTS, call `clearPasted()` + `clearAttachments()` after building the message

None of these primitives require any server changes — they are entirely client-side except for the timezone fetch (which reuses existing endpoints) and the allowed file types fetch (which reuses the admin app-settings endpoint).

---

A new tool follows this pattern — no changes to existing admin UI code are needed:

**1. Register the tool in `db.js` `seedDefaults()`:**
```js
await client.query(`
  INSERT INTO tools (slug, name, version, enabled, config)
  VALUES ('mytool', 'My Tool', '1.0.0', true, $1::jsonb)
  ON CONFLICT (slug) DO UPDATE SET enabled = true, config = EXCLUDED.config
`, [JSON.stringify({
  roleModelAccess: {
    org_member:       'standard',
    mytool_advanced:  'advanced',
  },
  roles: [
    { name: 'mytool_advanced', label: 'My Tool — Advanced', scopeId: 'mytool' },
  ],
})]);
```

**2. Seed the tool's roles:**
```js
{ name: 'mytool_advanced', description: 'My Tool — advanced model tier' }
```

**3. Create the route** (`server/routes/mytool.js`) — call `POST /api/tools/mytool/stream` from the client, or use `requireToolAccess('mytool')` for non-AI tools.

**4. Create the page** (`client/src/pages/MyToolPage.jsx`) — use `useStream('mytool')` for streaming, `GET /api/tools/mytool/permitted-models` for the model picker.

**5. Register the route** in `server/index.js` and add the page to `App.jsx` and `Sidebar.jsx`.

The **Grant Access** dropdown in Admin → Users will automatically include the new tool's roles on next page load.

---

## Local Development Setup

### Prerequisites
- Docker Desktop running
- Node.js v22

### Environment Variables
Add `ANTHROPIC_API_KEY` and `GOOGLE_GENERATIVE_AI_API_KEY` to your `.env` file to enable AI tools and file embedding:
```bash
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_GENERATIVE_AI_API_KEY=AIza...
```

### Start Database
```powershell
docker start toolsforge-db
```

**Create container if it doesn't exist:**
```powershell
docker run -d `
  --name toolsforge-db `
  -e POSTGRES_USER=postgres `
  -e POSTGRES_PASSWORD=postgres123 `
  -e POSTGRES_DB=platform_dev `
  -p 5433:5432 `
  pgvector/pgvector:pg15
```

### Start Server
```powershell
cd "C:\users\micha\local sites\toolsforge\server"
node index.js
```

### Start Client
```powershell
cd "C:\users\micha\local sites\toolsforge\client"
npm run dev
```

**Client:** http://localhost:5173
**Server:** http://localhost:3001

---

## Environment Variables

**Local (`.env` in project root):**
```bash
DATABASE_URL=postgresql://postgres:postgres123@localhost:5433/platform_dev
NODE_ENV=development
APP_URL=http://localhost:5173
SEED_ADMIN_EMAIL=your@email.com
SEED_ADMIN_PASSWORD=your-password
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_GENERATIVE_AI_API_KEY=AIza...   # Required for file embedding (text-embedding-004)

# Email — MailChannels HTTP API (primary)
MAIL_CHANNEL_API_KEY=your-mailchannels-api-key
MAIL_FROM_EMAIL=noreply@yourdomain.com
MAIL_FROM_NAME=ToolsForge

# Email — SMTP fallback (used only if MAIL_CHANNEL_API_KEY is not set)
SMTP_HOST=smtp.mailchannels.net
SMTP_PORT=587
SMTP_USER=your-smtp-username
SMTP_PASS=your-smtp-password
```

**Railway:**
- Set in Railway dashboard → Service → Variables tab
- Admin user created/updated on every deploy
- All email env vars must be set for invitation and password reset emails to send

---

## Database Commands

**View users with activation status:**
```powershell
docker exec -it toolsforge-db psql -U postgres -d platform_dev -c "SELECT id, email, is_active, created_at FROM users;"
```

**View user roles:**
```powershell
docker exec -it toolsforge-db psql -U postgres -d platform_dev -c "SELECT u.email, r.name, ur.scope_type, ur.scope_id FROM user_roles ur JOIN users u ON u.id = ur.user_id JOIN roles r ON r.id = ur.role_id;"
```

**View tool registry and config:**
```powershell
docker exec -it toolsforge-db psql -U postgres -d platform_dev -c "SELECT slug, name, enabled, config FROM tools;"
```

**View AI model catalogue:**
```powershell
docker exec -it toolsforge-db psql -U postgres -d platform_dev -c "SELECT value FROM system_settings WHERE key = 'ai_models';"
```

**View AI usage logs:**
```powershell
docker exec -it toolsforge-db psql -U postgres -d platform_dev -c "SELECT user_id, tool_slug, model_id, input_tokens, output_tokens, cost_usd, created_at FROM usage_logs ORDER BY created_at DESC LIMIT 20;"
```

**View document extraction status:**
```powershell
docker exec -it toolsforge-db psql -U postgres -d platform_dev -c "SELECT id, file_name, extraction_status, chunk_count, created_at FROM document_extractions ORDER BY created_at DESC LIMIT 20;"
```

**View usage telemetry:**
```powershell
docker exec -it toolsforge-db psql -U postgres -d platform_dev -c "SELECT event_type, count(*), avg(duration_ms) FROM usage_events GROUP BY event_type;"
```

**View pending invitations:**
```powershell
docker exec -it toolsforge-db psql -U postgres -d platform_dev -c "SELECT u.email, it.expires_at, it.used FROM invitation_tokens it JOIN users u ON u.id = it.user_id;"
```

**View all tables:**
```powershell
docker exec -it toolsforge-db psql -U postgres -d platform_dev -c "\dt"
```

---

## Production (Railway)

**URL:** https://toolsforge-production.up.railway.app

**Deploy:**
```powershell
git add .
git commit -m "Your changes"
git push origin main
```

Railway auto-deploys on push to `main`.

### How the Production Build Works

The app is deployed as a single Railway service using a multi-stage Dockerfile:

1. **Stage 1** — builds the React client (`npm run build` via Vite) inside an Alpine Node container
2. **Stage 2** — sets up the Express server and copies the built `client/dist` into `server/public`
3. Express serves static files from `server/public` if the directory exists, with a catch-all for React Router

The Dockerfile lives at the project root. Railway is configured to use it via `railway.json` (`"builder": "DOCKERFILE"`).

### Key Architecture Decisions

#### 1. CORS scoped to `/api` only — never global

CORS middleware must be applied **only to `/api` routes**, not globally.

**Why:** Vite's production build adds `crossorigin` to `<script>` and `<link>` tags. This causes the browser to send an `Origin` header even for same-origin asset requests. If CORS runs globally and rejects unknown origins with `new Error(...)`, every CSS and JS asset returns 500. Two rules to follow:
- Scope CORS to `/api` so static files never touch it
- Use `callback(null, false)` to deny unknown origins — not `callback(new Error(...))`. The error form triggers Express's error handler and returns 500. The `false` form quietly omits CORS headers and lets the request continue (same-origin requests don't need CORS headers anyway)

#### 2. Middleware order matters

```
app.set('trust proxy', 1)    ← must be first (see below)
app.use('/api', cors(...))   ← CORS only for /api
app.use(express.json())      ← body parsing
API routes                   ← /api/* resolved here, never reach static
express.static(clientDist)   ← serves built assets
app.get('*', ...)            ← React Router catch-all (last resort)
```

The catch-all `app.get('*', ...)` must come **after all API routes**. If registered earlier, it intercepts GET requests to `/api/*` and returns `index.html` instead of the API response.

#### 3. Trust proxy on Railway

Railway runs behind a load balancer. Without `app.set('trust proxy', 1)`, all requests appear to come from the same IP. This breaks per-user rate limiting — 20 login attempts from one user would trigger the limiter for everyone. With `trust proxy: 1`, Express reads the real client IP from the `X-Forwarded-For` header.

#### 4. Use a Dockerfile, not railway.json buildCommand

Railway's Railpack builder ignores custom `buildCommand` in `railway.json` for monorepos. Use a multi-stage Dockerfile instead — it gives full control over the build and is reliable across Railway builder versions.

```dockerfile
# Stage 1 — build React
FROM node:22-alpine AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install --include=dev   # --include=dev required — Vite is a devDependency
COPY client/ ./
RUN npm run build

# Stage 2 — run Express
FROM node:22-alpine
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install --omit=dev
COPY server/ ./
COPY --from=client-build /app/client/dist /app/server/public
EXPOSE 3001
CMD ["node", "index.js"]
```

Key points:
- Use `--include=dev` for the client install — Vite won't exist otherwise
- Copy built `dist` into `server/public` so Express can find it with `path.join(__dirname, 'public')` — avoids unreliable `../` path traversal
- Set `"builder": "DOCKERFILE"` in `railway.json` and clear any dashboard build command

#### 5. Serving the React app from Express

Express conditionally serves the frontend if `server/public` exists (i.e. a production build is present). Local dev is unaffected — Vite runs separately and `public/` never exists locally.

```js
const clientDist = path.join(__dirname, 'public');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) =>
    res.sendFile(path.join(clientDist, 'index.html'))
  );
}
```

#### 6. SSE over POST — use fetch, not EventSource

The native browser `EventSource` API only supports GET requests. AI tool streaming uses `POST` to send the messages payload. The `useStream` hook reads the response body as a `ReadableStream` via the `fetch` API, parsing `data: {...}\n\n` lines manually. This is required because `EventSource` only supports GET.

#### 7. AI model catalogue — DB-backed with static fallback

The model catalogue is stored in `system_settings` under key `ai_models` as a JSON array. This lets admins add, edit, or remove models without a redeploy. The static `MODEL_CATALOGUE` in `modelCatalogue.js` is only used as the seed on first startup and as a fallback if the DB is unavailable. `costCalculator.js` reads live pricing from the DB, so a pricing update takes effect immediately.

#### 8. User access management — projection layer over roles

The admin **Manage Access** modal (`AdminUsersPage → AccessModal`) presents tool access as a set of radio groups (one per tool), not a list of internal role names. The admin sees "No access / Standard / Advanced / Premium" — not `chat_advanced` or `chat_premium`.

The backend is unchanged: the modal calls `GET /api/admin/users/:id/tool-access` (which reads `config.roles` and the user's current assignments) and `PUT /api/admin/users/:id/tool-access` (which translates the selection back to role grants/revocations). Role names remain an implementation detail — they never surface in the admin UI.

This matters for an organisational platform because admin users are not necessarily technical. A manager granting a colleague access to "AI Chat — Advanced (Sonnet)" is a meaningful business decision; assigning role `chat_advanced` with scope `tool/chat` is not a natural way for a non-developer to think about it. The projection layer keeps the underlying RBAC model intact while presenting it in terms the admin actually understands.

#### 9. Tool config as self-describing contract

Each tool stores both its model access policy (`roleModelAccess`) and its grantable roles (`roles`) in `tools.config` JSONB. This means:
- `PermissionService.getPermittedModels` needs no knowledge of individual tools
- The admin Grant Access dropdown (`GET /api/admin/tool-roles`) aggregates dynamically
- The `Manage Access` modal (`GET /api/admin/users/:id/tool-access`) reads the same config to build its radio options
- A new tool is fully described by its seed entry — no admin UI code changes required

#### 10. Model Advisor — soft guidance within hard permission boundaries

The Model Advisor operates in two distinct layers that must not be conflated:

**Hard layer (stream endpoint):** `POST /api/tools/:toolSlug/stream` calls `PermissionService.canUseModel` before opening any SSE connection. A user without premium access cannot use Opus regardless of what the client sends. This cannot be bypassed.

**Soft layer (advisor):** `POST /api/tools/:toolSlug/analyse-prompt` classifies the prompt and suggests a better model *from the user's permitted set only*. It is purely advisory — the user can always choose "Keep & Send". If the endpoint fails, the send proceeds normally.

The separation is intentional. Enforcement belongs on the server, always. Guidance belongs on the client, where it can be contextual and graceful. Combining them (e.g. blocking a send because the model is "wrong") would be paternalistic and would create user-facing errors for what is fundamentally a cost-efficiency hint.

The advisor also deliberately does not show what the user is *missing*. A user on the standard tier who sends a complex prompt will see Sonnet suggested (their ceiling), not Opus with an upgrade prompt. Access tiering is a business decision made by the admin — the product should not second-guess or circumvent it.

#### 11. Security thresholds as admin-configurable settings

Hardcoded security thresholds are a liability in an organisational platform. The right values depend on context:

- A small internal team on a trusted network can tolerate a higher login rate limit without increasing meaningful risk — tightening it unnecessarily creates friction for legitimate users who mistype their password.
- A deployment accessible from public networks with non-technical users warrants stricter lockout after fewer attempts.
- An organisation that has experienced a credential-stuffing incident may want to set lockout to 2 attempts and 60 minutes immediately, without waiting for a code deploy.

The three configurable thresholds — `security_login_max_attempts`, `security_lockout_minutes`, `security_login_rate_limit` — are stored in `system_settings` (the same table as the AI model catalogue and spend thresholds). This makes them:

- **Auditable** — changes are written with `updated_by` and `updated_at`
- **Persistent** — survive server restarts; seeded with sensible defaults on first deploy
- **Immediately effective** — lockout thresholds are read from DB on every login attempt; the rate limiter uses a function-based `max` (`() => rateLimitConfig.loginMax`) so in-process config updates take effect on the next request without a restart

Values are clamped server-side on `PUT /api/admin/security-settings` (attempts: 1–20, lockout: 1–1440 min, rate limit: 1–20) regardless of what the client sends — the admin UI cannot be used to disable these controls entirely.

### Railway Environment Variables

| Variable | Value |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (auto-set by Railway Postgres plugin) |
| `APP_URL` | `https://toolsforge-production.up.railway.app` |
| `SEED_ADMIN_EMAIL` | Admin account email |
| `SEED_ADMIN_PASSWORD` | Admin account password |
| `ANTHROPIC_API_KEY` | Anthropic API key — required for all AI tools |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google AI API key — required for file embedding (`text-embedding-004`) |
| `MAIL_CHANNEL_API_KEY` | MailChannels API key (`X-Api-Key` header) |
| `MAIL_FROM_EMAIL` | From address for all outbound email |
| `MAIL_FROM_NAME` | From name for all outbound email |

`APP_URL` is used to build invitation and password reset links in emails. It is no longer required for CORS to function correctly.

#### 12. File ingestion in Worker Threads — event loop protection

PDF parsing (pdf-parse) and spreadsheet traversal (exceljs) are synchronous and CPU-bound. Running them on the main event loop would stall all in-flight requests for the duration of extraction. Worker Threads run in parallel with the main process, sharing no memory by default. Each worker creates its own pg Pool — module instances (including the parent's pool) are not accessible across thread boundaries. The upload route returns `{ extractionId }` immediately; the caller polls `GET /api/files/:extractionId/status` to observe progress.

#### 13. HNSW over IVFFlat for vector indexing

IVFFlat requires pre-computed centroids (`vacuum + count`) before the index is effective. In a multi-tenant schema where rows arrive continuously from multiple orgs, the index would be stale until manually rebuilt. HNSW builds incrementally — every inserted row is immediately indexed with no rebuild step — and delivers consistently better recall at equivalent query time. The migration from IVFFlat to HNSW is handled idempotently in `db.js`: the old index is dropped if present, the new one created, inside a DO block that runs on every server start.

#### 14. org_id enforcement at the SQL layer — not just the application layer

The `executeSearch` function's first WHERE clause is `WHERE de.org_id = $1`. This is not a defence-in-depth afterthought — it is the primary isolation boundary. The application-layer PermissionService check guards against a user accessing a project they have no role on, but it cannot prevent a bug in the route handler from passing the wrong `orgId`. Having `org_id = $1` as a mandatory SQL predicate, sourced unconditionally from `req.user.org_id`, means a compromised or buggy route handler cannot leak another org's data — the DB enforces the boundary independently.

#### 15. Telemetry as fire-and-forget

Usage events must never affect response latency or reliability. `telemetryService.recordEvent` is designed to be called without `await` (`void recordEvent(...)`) and is guaranteed to always resolve — all DB logic is try/catch'd internally, failures log at `warn` only. This is a different pattern from `usageLogger.logAndCheck` (which is awaited because spend threshold warnings must appear before the response returns). The distinction is intentional: spend thresholds are operational, telemetry is analytical. Analytical writes should never block user-facing operations.

#### 16. Rate limiting keyed by user ID, not IP, for file endpoints

Org users share infrastructure: they may be on the same corporate IP, the same VPN exit node, or the same NAT gateway. IP-keyed rate limiting on file endpoints would mean one user's heavy upload session blocks their entire office. User-ID-keyed limiting isolates the constraint to the individual — a user who uploads 20 files in an hour hits their own limit without affecting colleagues. This requires `requireAuth` to run before the rate limiter in the middleware chain, which is why the file-route limiters are applied per-route rather than globally.

#### 9. Logging — Morgan + Winston with DB transport

All server logging goes through a single Winston logger (`server/utils/logger.js`).

- **Morgan** middleware logs every HTTP request at `http` level — skips `/api/health` to keep logs clean
- **Console transport** — coloured + readable in development, JSON in production (Railway parses this cleanly)
- **DB transport** — writes `info`, `warn`, `error` to the `app_logs` table; `http` request logs are excluded to avoid table bloat
- Key business events (`info`) are explicitly logged: user login/logout, password change/reset, invitation created, role granted/revoked, AI usage logged
- Spend threshold warnings fire `logger.warn` → `app_logs` — visible in Admin → Logs without extra infrastructure

The DB transport uses a lazy `require('../db')` inside `setImmediate` to break the circular dependency between `logger.js` and `db.js`.

Admins can view logs at `/admin/logs` — filterable by level, searchable by message, with expandable metadata rows.

### `.dockerignore`

```
**/node_modules
client/dist
```

Prevents host `node_modules` from polluting the Docker build context. Without this, a Windows `node_modules` could overwrite the clean Linux install inside the container and break native binaries.

---

## Chat Module — Feature Backlog

The current AI Chat tool is a functional foundation: streaming responses, permitted model picker, Model Advisor, usage tracking. What it lacks are the interaction features that make a chat interface genuinely useful day-to-day. The goal is to build each one as a composable, reusable unit that any future tool module can consume — not features that belong to chat specifically.

### The Three-Layer Modularity Pattern

Before listing individual features, the pattern that governs how they should be built:

**Layer 1 — Headless hook (pure logic, no UI)**
A hook that knows nothing about where it lives. `useVoice` exposes `startListening()`, `stopListening()`, `transcript`, `speak(text)`. It doesn't know it's inside a chat interface. A future notes module, a task module, or a document editor could import the same hook for dictation. If a hook imports anything from `chat/`, it's coupled and no longer reusable.

**Layer 2 — UI primitive (styled component, no module knowledge)**
A component that wraps the hook and renders a control. `<VoiceButton />` calls `useVoice` internally and renders a mic icon. `<FileDropzone />` calls `useFileAttachment` and renders a drag target. These components have no knowledge of which module they're sitting in — they accept callbacks as props (`onTranscript`, `onFile`) and leave the wiring to the consumer.

**Layer 3 — Integration point (the module composes both)**
The chat page (or any other consumer) imports the hook and the primitive, wires the output into its own context. Chat takes the voice transcript and appends it to the message input. A notes module takes the same transcript and appends it to the note body. Same hook, same button, different wiring. The module owns the integration — not the feature.

This pattern is the discipline that makes ToolsForge a toolkit rather than a monolith. Every feature below should be designed to this pattern before any code is written.

---

### Feature Backlog

#### Voice I/O (mic / speaker)
Browser-native speech I/O via the Web Speech API — no backend required. Speech-to-text for dictation, text-to-speech for reading responses aloud.

**Modular design:** `useVoice` lives in `client/src/hooks/` — shared, not chat-specific. Exposes `startListening()`, `stopListening()`, `transcript`, `isListening`, `speak(text)`, `isSpeaking`. A `<VoiceButton />` primitive in `client/src/components/` wraps it. Chat wires `transcript` into the message input on silence detection. Any other module that wants dictation imports the same hook.

---

#### File Uploads
The original had a `useFileAttachment` hook and a full server-side pipeline: upload → extract text → summarise via AI → chunk → embed → store. Session files (attached per-conversation) and pinned files (persistent across sessions) were distinct. Session files persisted to a `session_files` table so context survived a page refresh.

**Modular design:** The server processing pipeline (`POST /api/files/upload`) is a generic endpoint — any module calls it to get extracted, summarised content back. The `useFileAttachment` hook wraps upload progress and result state. A `<FileAttachButton />` primitive renders the trigger. Chat uses it for conversational context injection; a future document module could use the same endpoint for knowledge base ingestion. The `session_files` table concept becomes `tool_files` with a `tool_slug` column, scoped per module.

---

#### Image Paste / Attach
Copy-pasting an image directly into the chat input — clipboard images captured as blobs and sent as base64 inline content in the message payload. This is distinct from file upload — it's about visual content inline in the conversation, handled entirely client-side before sending.

**Modular design:** A `useClipboardMedia` hook that listens for `paste` events and extracts image blobs. A `<PasteImagePreview />` primitive that renders thumbnails and a remove button. Chat wires the resulting image data into the message payload as `inlineImages`. Any rich text or input interface benefits from the same hook.

---

#### Show More / Show Less
A UI toggle on long AI responses — truncate rendered content beyond a threshold height, show a "Show more" link to expand. Pure frontend, no backend involvement.

**Modular design:** A generic `<CollapsibleContent />` component that accepts `content`, `maxHeight`, and `renderFn` as props. Chat wraps message bubbles with it. A search results module could use it around long snippets. A document viewer could use it around long sections. The component owns the collapse logic; the consumer owns the threshold and the render function.

---

#### Current Date Injection
Without a date in the system prompt, the model has no reliable knowledge of "today" and will either guess, hallucinate, or refuse to answer date-relative questions.

**Modular design:** A utility function `getSystemDateContext()` in `client/src/utils/` that returns a string like `"Today is Wednesday, 26 March 2026. User timezone: Australia/Brisbane (AEST, UTC+10)."` Any module that assembles a system prompt calls it. This is a one-line addition but has meaningful impact on response quality for any time-sensitive task. The server-side equivalent already logs timezone in the stream endpoint — the client-side utility closes the loop.

---

#### Convert to Markdown
Export a conversation (or any structured content) as a downloadable `.md` file. Takes the message history, formats it as Markdown with role prefixes, and triggers a browser download. Pure client-side logic on data already in memory.

**Modular design:** A utility function `exportToMarkdown(messages, filename)` in `client/src/utils/` that formats and triggers the download. A `<ExportButton />` primitive that calls it. Chat uses it for conversation export; a notes module could use the same utility for note export; a search module could export search results. The function should accept a generic `{ role, content }[]` array — not a chat-specific type.

---

#### Follow-Up Questions
After each AI response, generate 2–3 contextual follow-up questions the user might want to ask next — rendered as clickable prompt chips below the response. Generation is either appended to the main stream request as a structured output instruction or fired as a separate lightweight follow-up call.

**Modular design:** A utility `appendFollowUpRequest(systemPrompt)` that appends a structured instruction asking the model to return follow-up suggestions as a JSON array at the end of its response. The `useStream` hook (or the stream endpoint) parses and strips the structured section before rendering the response body, emitting a `followUps` event alongside the normal `text` events. A `<FollowUpChips />` primitive renders the suggestions as clickable pills. Chat wires chip clicks into the message input. Any AI-powered module that wants to guide the user's next action can use the same pattern.

---

#### URL Attachment
Fetch a URL's content and inject it into the conversation as context. Requires SSRF-guarded server-side fetching and Haiku-powered summarisation of long page content before injection.

**Modular design:** A server endpoint `POST /api/tools/:toolSlug/fetch-url` handles the fetch and summarisation — tool-scoped so usage is logged against the right tool. The SSRF guard (block private IP ranges, localhost, cloud metadata endpoints) lives in a shared middleware. A `useUrlAttachment` hook manages the loading and result state client-side. A `<UrlBar />` primitive renders the input and status. Chat wires the returned summary into the message context. A research tool module could use the same endpoint to build a reading list.

---

### Implementation Priority

| Feature | Complexity | Backend needed | Reuse potential |
|---|---|---|---|
| Current date injection | Trivial | No | High — every AI tool benefits |
| Show more / Show less | Low | No | High — any long-content module |
| Convert to Markdown | Low | No | High — any content module |
| Voice I/O | Medium | No | High — any input interface |
| Image paste | Medium | No | Medium — input-heavy modules |
| Follow-up questions | Medium | Minimal | High — any AI tool |
| File uploads | High | Yes | High — many future tools |
| URL attachment | High | Yes (SSRF guard) | Medium — research/context tools |

Current date injection is the highest-value, lowest-effort item — one utility function, one line in the system prompt assembly, immediate improvement in response quality for any date-sensitive query.

---

## What's Next

### Agent Platform

**COMPLETE (v0.2.0):**
- [x] First domain data layer — `GoogleAdsService` (campaign perf, daily trends, search terms, budget pacing) ✓
- [x] Second domain data layer — `GoogleAnalyticsService` (sessions, traffic sources, landing pages, conversion events) ✓
- [x] First domain agent — `googleAdsMonitor` (tools.js + prompt.js + index.js) — end-to-end verified ✓
- [x] **AgentOrchestrator bug fixed** — was sending `execute`, `requiredPermissions`, `toolSlug` to Anthropic API (400 error); now strips all three internal fields. Fix applies to all future agents. ✓

**KNOWN LIMITATION:**
- `StateManager.saveConclusion()` requires a valid integer `orgId`. Test runs with `orgId: 'test'` log a warning but complete successfully. Resolves automatically when agent runs via authenticated routes.

**NEXT SESSION — Agent routes + scheduling + UI:**
- `POST /api/agents/google-ads-monitor/run` — trigger a full agent run; stream steps via SSE
- `GET /api/agents/google-ads-monitor/history` — return past conclusions from `agent_conclusions`
- `AgentScheduler` registration for twice-daily automated runs
- React UI: report view with charts and AI suggestions panel

### Chat Improvements

- [x] Chat — voice I/O (`useSpeechInput` hook + `VoiceInputButton` primitive) ✓
- [x] Chat — read aloud (`useReadAloud` hook + `ReadAloudButton` primitive) ✓
- [x] Chat — image paste (`useClipboardMedia` hook + inline preview) ✓
- [x] Chat — file attachments (`useFileAttachment` hook + paperclip button) ✓
- [x] Chat — current date injection (timezone-aware system prompt, three-tier resolution) ✓
- [ ] Chat — show more / show less (`<CollapsibleContent />` component around long responses)
- [ ] Chat — convert to Markdown (export utility + button)
- [ ] Chat — follow-up question chips (`appendFollowUpRequest` utility + `<FollowUpChips />`)
- [ ] Chat — URL attachment (server fetch + SSRF guard + `useUrlAttachment` hook)

### Platform

- [ ] Usage dashboard — admin view of token spend by user, tool, and model with date range filters (`usage_logs` table is ready)
- [ ] Per-user spend caps — `user_settings` key for a personal daily/monthly limit checked in `usageLogger.checkSpendThresholds`
- [ ] Active sessions panel — show user where they're logged in, "sign out everywhere" button (`auth_sessions` table is ready)
- [ ] Audit log — dedicated table for key events (login, role changes, invitations) separate from the application error log
- [ ] Tool schema isolation — each tool gets its own DB schema

---

**Foundation proven. Multi-tool AI platform operational.**
