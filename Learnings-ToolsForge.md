# ToolsForge — Engineering Learnings

A living reference document. Distilled from building Curam Vault (predecessor project)
and ToolsForge itself. Intended as a checklist and decision record for future work.

---

## AgentOrchestrator — Implementation Notes

Low-level decisions made while building the platform's core ReAct loop engine — the execution primitive every future agent module runs through.

- Anthropic API requires thinking blocks preserved verbatim in assistant
  turns during multi-turn extended thinking conversations. Stripping them
  causes an API error on the next call.

- Tool schema stripping: use destructure-rest ({ execute: _exec, ...schema })
  — never mutate the caller's tool objects.

- Terminal condition checks stop_reason !== 'tool_use' first, then guards
  against malformed responses where stop_reason === 'tool_use' but no
  tool_use blocks appear.

- Tool results must be JSON.stringify'd — Anthropic tool_result content
  field expects a string.

- Export AgentError alongside the singleton so callers can do
  instanceof AgentError checks at the route layer.

---

## Anthropic API Patterns

- **Prompt caching pays for itself fast.** Structure system prompts as an array
  of content blocks ordered by change frequency (persona → project → memory →
  files → dynamic date). Mark each stable block with `cache_control: { type: 'ephemeral' }`.
  Anthropic bills cached tokens at ~10% of normal price; on rich contexts this
  reduces costs 50–70% per session. Hard limit: 4 cache breakpoints per request.
  Put the date/dynamic content last with no cache marker.

- **Use the lightest capable model for background tasks.** Auto-titling, NLP query
  translation, prompt classification, short summarisation — all of these work well
  with Haiku at a fraction of the cost of Sonnet. Pattern: expose a `{ light, standard }`
  model pair and route background tasks to `light` automatically.

- **Classify API errors before surfacing them.** Map Anthropic error responses to
  named codes (`auth`, `billing`, `rate_limit`, `model_not_found`) and drive specific
  UI states from them. A generic "something went wrong" is useless; "Your API key is
  invalid — update it in Settings" is actionable.

- **Convention-based provider routing is pragmatic.** `modelId.startsWith('gemini-')`
  → Google SDK, else Anthropic. No config field needed. Adding a new model requires
  zero code changes as long as the naming convention holds.

- **Dynamic model list in database, not code.** Store models in a settings table as
  a JSON array. Adding a new Claude or Gemini model on release requires no deployment —
  just update the row. Static file serves as fallback when the DB row is absent.

- **Set `store: false` on all Anthropic API calls** to opt out of Anthropic using
  request content for model training. One field, permanent effect.

---

## SSE Streaming

- **Always emit `[DONE]` on both success and error paths.** The client shouldn't need
  to distinguish — it just stops reading. Error details go in a typed event before `[DONE]`.

- **The partial-line buffer is non-negotiable.** Network packets don't align with SSE
  event boundaries. Without buffering the incomplete trailing line and prepending it to
  the next chunk, you get JSON parse errors on ~10–20% of tokens at normal network speeds.
  Pattern: `buf += decode(chunk); lines = buf.split('\n'); buf = lines.pop();`

- **SSE beats WebSockets for server→client streaming.** Stateless, no connection
  management, works through standard HTTP proxies. Use WebSockets only if you need
  bidirectional communication after the initial request.

- **Disable nginx/proxy buffering explicitly.** Set `X-Accel-Buffering: no` on SSE
  responses, or the proxy will hold chunks until a buffer fills, destroying the streaming UX.

- **The SSE client reader is worth extracting into a utility.** Every streaming endpoint
  in the codebase follows the same shape. A `streamSSE(response, onChunk)` utility makes
  each call site a one-liner.

---

## Database Patterns

- **Idempotent schema initialisation eliminates migration ops burden.** Use
  `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` everywhere.
  Run the entire schema file on every server start. No migration tool, no manual steps,
  no "forgot to run migrations" deploys. Works well for solo projects; switch to versioned
  migrations (Flyway, Knex) before adding a second developer.

- **Design for multi-user from day one.** Adding `user_id` / `org_id` FK columns after
  the fact requires a migration for every table plus an audit of every query. Do it upfront —
  it costs almost nothing and produces cleaner isolation.

- **Typed settings beat key-value stores.** A `(userId, key, value TEXT)` settings table
  is fast to add but every consumer has to know the implicit type contract
  (`=== 'true'` for booleans, `JSON.parse()` for arrays). Prefer a typed JSONB column
  or explicit columns for a fixed set of settings.

- **Raw SQL over ORM for complex query shapes.** Full control, transparent query plans,
  no abstraction friction for tables with complex joins. Trade-off: boilerplate on writes.
  Parameterised queries (`$1`, `$2`) at all boundaries — no string interpolation.

- **Token-based sessions over JWTs when you need instant invalidation.** 32-byte random
  hex stored in `auth_sessions` table. Logout deletes the row. JWTs can't be revoked
  without a blocklist, which defeats the statelessness argument. One extra DB lookup per
  request is immaterial at any non-extreme scale.

- **Consider a soft-delete recycle bin for user-facing records.** Hard deletes are fine
  for most data, but users will occasionally delete sessions or records they didn't mean to.
  A 30-day `deleted_at` column on high-value tables costs little and saves support headaches.

---

## RAG Pipeline

- **Sentence-boundary chunking produces meaningfully better retrieval than fixed-size splits.**
  Split on `. `, `? `, `! `, `\n\n` rather than raw character count. Add 50-token overlap
  between adjacent chunks to prevent concepts from being severed at boundaries.

- **Always build a graceful RAG fallback.** If the embedding service is unavailable, fall
  back to full-text injection capped at a safe token limit, and show a UI indicator when
  the fallback is active. Never fail the entire request because embeddings are down.

- **The IVFFlat index requires data to exist before it can be created.** Wrap index
  creation in a try/catch — on a fresh database the table is empty and the index creation
  fails, which is harmless. The app still works; it just does sequential scans until data
  accumulates.

- **Session files should inject in full; pinned files should use RAG.** Pinned files are
  a long-term knowledge base — large and only partially relevant per query. Session files
  are explicitly attached for the current conversation — users expect the entire content
  to be visible. Mixing these models causes user confusion.

---

## Security

- **SSRF protection is mandatory on any user-provided URL fetch.** Resolve the hostname
  via `dns.lookup()` before connecting. Reject private IP ranges: `127.x`, `10.x`,
  `172.16–31.x`, `192.168.x`, `169.254.x`, `::1`. Run the check on every redirect hop.
  Cap response bodies at 2 MB. Without this, users can probe internal services and cloud
  metadata endpoints.

- **Sanitise uploaded code files for prompt injection before injecting into LLM context.**
  Scan line by line for patterns like "Ignore previous instructions", "You are now",
  "SYSTEM:". Replace with a neutral placeholder and log a warning. Legitimate code
  (`eval()`, `require()`) is unaffected.

- **Store uploaded code files with a `.txt` extension and forced `text/plain` MIME type.**
  Prevents execution if a file is ever served directly. Never serve uploaded file content
  publicly — inject server-side only.

- **Block bare `.env` file uploads** regardless of MIME type. File filters run before
  the storage layer processes the upload.

- **OAuth CSRF prevention via state nonce.** Generate a short-lived nonce, store it in
  the DB with an expiry, validate and delete it on callback. Prevents redirect hijacking
  during OAuth flows.

- **Encrypt OAuth tokens at rest.** AES-256-GCM with key loaded from an env var.
  Graceful fallback: if key is absent, store plaintext and log a startup warning.
  Re-encrypt transparently on next write when the key is later added.

- **Rate-limit sensitive endpoints explicitly.** Login: 10 req/15 min per IP. OAuth
  initiation: 5 req/15 min. AI-backed endpoints: tighter than read endpoints because
  they consume both your API quota and the user's patience.

---

## Architecture Decisions

- **One streaming primitive for the whole platform.** Establish a single SSE pattern
  early and reuse it for every AI endpoint. Every streaming integration becomes trivial
  once the pattern is extracted.

- **SSRF-guard + response-cap utility should be a shared server utility, not per-route.**
  Anywhere users can submit a URL, the same protection applies. Centralise it once.

- **Small, focused utility functions are high-leverage.** `classifyStreamError`,
  `sanitiseCodeFile`, `costCalculator`, `chunker` — each is small, focused, and testable
  in isolation. Extract when a concern is complex enough that you'd write it twice.

- **Hot-reloadable cron from database config** — store schedule in a settings table.
  When config changes via API, cancel the existing job and create a new one with
  `node-cron`. No restart, no deployment. Applies to any background job with
  user-configurable timing.

- **Public routes must be registered before `requireAuth` middleware**, not exempted
  from it. Express applies middleware in registration order; exemption patterns are
  fragile and easy to mis-scope.

---

## Lessons Learned (from Curam Vault)

- **Scope creep is the main regret.** The app grew to 39 database tables. LLM-relevant
  learnings plateaued around table 15. The last 24 taught Australian GST and double-entry
  bookkeeping. When adding a new module, ask: *does this deepen understanding of the
  primary technical domain?* If not, build a separate app.

- **Three context tiers is one too many.** Global memory + project context + session
  context forces users to consciously decide where something belongs. Two tiers
  (workspace + conversation) is cleaner. Make "always-on" facts part of workspace context
  rather than a separate tier.

- **Add feature telemetry from day one.** A simple `logEvent(userId, event, metadata)`
  writing to a `feature_events` table takes 5 minutes and yields months of insight into
  what users actually use versus what you think they use.

- **Measure actual cache hit rates, don't just trust the theory.** Add instrumentation
  to confirm that your caching strategy is working as intended in production. The theory
  can be right and the implementation subtly wrong.

- **Model provider routing by ID prefix is fragile but pragmatic.** It works until a
  provider releases a model that breaks the naming convention. Document the convention
  explicitly so the next developer knows it's a convention, not a system.

- **YouTube's InnerTube API is more stable than any npm transcript package.** No API key,
  ~50 lines of code, fully under your control. Apply a summarisation threshold: under 5K
  chars inject raw (summaries lose specificity at that length); over 5K summarise to ~20%
  with a light model.

- **For AI news analysis, the prompt framing determines output quality more than the model.**
  Framing as "what specifically changed in the last 48 hours, not background on the topic"
  produces date-anchored, specific output. Without it the model writes evergreen summaries
  that could have been written any day.

---

## ToolRegistry — Implementation Notes

Decisions made while building the platform-level tool management service — the registry every agent module queries to discover what it can use.

- **`globalSearch` in `searchService.js` is the correct RAG entry point for agents.**
  `executeSearch` in `files.js` serves the file ingestion pipeline only. Two functions,
  same data, different masters — do not collapse them.

- **`orgId` isolation pattern: always source `orgId` exclusively from `context.orgId`
  in tool `execute` functions.** Never accept `orgId` from tool input. Mark this with
  an explicit comment — it is a security assertion, not documentation.

- **`_context` prefix convention:** tools that do not consume org context should prefix
  the parameter with `_` to signal intent to linters and reviewers. Makes security
  audits faster.

- **Two-tier error model in ToolRegistry:**
  - `ValidationError` (thrown before execution) → HTTP 400 at the route layer
  - `{ error: message }` (returned from the `execute` catch) → HTTP 200, Claude recovers
  Route handlers must respect this distinction.

- **`_validateInput` uses silent passthrough on unknown schema types** — forward-compatible,
  does not break on new JSON schema features.

---

## StateManager — Implementation Notes

Decisions made while building the platform's agent memory primitive — key-value state storage and run-conclusion persistence, both scoped to org + agent tool + optional session.

- **Schema lives in `db.js initializeSchema()`** — `CREATE TABLE IF NOT EXISTS` pattern.
  `/server/migrations/` holds reference SQL artefacts only. See `migrations/README.md`.

- **`orgId` is always sourced from `context` at INSERT sites, never from caller-supplied data.**
  Security comment marks both `agent_states` and `agent_conclusions` INSERT sites explicitly.

- **Dynamic WHERE builder pattern:** accumulate `conditions[]` and `params[]`, increment `$n`
  per predicate. No string interpolation — all values parameterised. Use this for `dateRange`
  and `metadata @>` JSONB containment filters when needed.

- **Tags stored as `TEXT[]` — overlap operator `&&` used for filtering.** GIN index on the
  tags column. Matches any-of-tags queries without a join table.

- **NULL session_id handled via sentinel UUID** (`00000000-0000-0000-0000-000000000000`).
  Enables a standard `UNIQUE(org_id, tool_slug, session_id, key)` constraint without
  NULL-equality edge cases (`NULL != NULL` in SQL). Sentinel substituted at the service
  layer, never stored in the schema default for `agent_conclusions` where `session_id` is
  genuinely optional (nullable).

---

## AgentScheduler — Implementation Notes

Decisions made while building the final platform service — cron scheduling, manual triggers, and execution history for any agent module.

- **`node-cron` added as explicit dependency, pinned to an exact minor version.** No `cron-parser` — `next_run_at` left `null` with a code comment: *"populated when cron-parser is added as an explicit dependency."* Don't add a second package to solve a display-only field.

- **Constructor async pattern:** `this._ready = this._restoreSchedules()` — fire-and-forget Promise stored on the instance. Tests `await scheduler._ready` before asserting `_jobs` state. Never put `await` calls directly in a constructor; store the Promise instead.

- **`_startCronJob` calls `_stopCronJob` first** — idempotent registration. Safe to call on re-registration without orphaning cron tasks. Any call site that starts a job can call this directly without a prior stop.

- **Handler errors never rethrow.** Caught inside `trigger()`, execution row updated with `status='error'` and error message, logged at error level. A failing agent must never crash the server process. The scheduler is a container — it absorbs failure.

- **`scope.orgId = null` throws `AgentSchedulerError`** until the `org_tools` table is built. A TODO comment points to the missing table. Honest not-yet-implemented beats a silent fragile fallback (`SELECT DISTINCT org_id FROM users`).

- **All four agent tables use `UUID PRIMARY KEY DEFAULT gen_random_uuid()`** for consistency. Mixed `SERIAL`/`UUID` in the same logical layer creates FK friction and implicit type coercions. Pick one and hold it.

- **Dynamic WHERE builder pattern** (`conditions[]`/`params[]` accumulator, `$n` increment) is now used in both StateManager and AgentScheduler. This is the platform standard for optional-filter queries. No string interpolation, all values parameterised.

---

## Testing Patterns — node:test

Patterns established while writing the agent platform integration tests. Use these for every new test file.

- **Never use singleton exports in tests — always `new ClassName()` for fresh instances.**
  Singletons carry state between test cases and produce order-dependent failures.

- **DB stubbing: write to `require.cache` before requiring the module under test.**
  Override `pool.query` per-assertion to capture SQL and params. Pattern:
  ```js
  require.cache[require.resolve(PATH)] = { id: PATH, filename: PATH, loaded: true, exports: stub };
  ```

- **Anthropic mock: replace `orchestrator.anthropic` after construction** — direct property
  swap, no `require.cache` needed. The constructor accepts an undefined API key without
  throwing; the mock client is injected immediately after.

- **PermissionService mock: constructor injection preferred over direct mutation of the
  imported object.** Prevents hidden side effects between parallel tests. `new ToolRegistry({ permissionService: mockPS })`.

- **Full pipeline orgId proof:** assert `insertQuery.params[0] === context.orgId` in the
  integration test. This is the explicit end-to-end isolation proof — confirms orgId
  cannot be injected through tool input at any layer of the stack.

- **Test scripts run relative to `server/`** (where `package.json` lives):
  ```json
  "test:agents": "node --test tests/agent-platform.test.js",
  "test":        "node --test tests/*.test.js"
  ```

- **AgentScheduler-specific: node-cron stubbed via `require.cache` before any module load.** `require.resolve('node-cron')` must succeed (package installed) before the stub can be registered. Install first, stub second.

- **`cronCapture.reset()` called at the start of every test** that asserts on cron behaviour. `cronCapture` is module-level shared state — tests that don't reset it will see leftover calls from previous tests.

- **`makeSchedulerPool()` helper with per-SQL-fragment overrides** — cleaner than rewriting the full mock per test. Pattern: `{ 'FROM agent_executions': { rows: [...] } }` — the pool checks each override key as a `sql.includes()` match and returns the mapped value.

- **Cron mock setup must happen before `new AgentScheduler()` construction.** `_restoreSchedules()` fires in the constructor and calls `cron.schedule()` for any active rows. If the stub isn't in place before construction, real cron timers start.

---

## The Agent Platform Layer — What It Provides

Every future agent module in ToolsForge gets the following for free by building on these four services:

- **Scheduled or manual execution with full history** — AgentScheduler handles cron jobs, manual triggers, pause/resume, and execution rows with status, result, and timing.
- **ReAct loop with tool composition and per-step tracing** — AgentOrchestrator runs the think→tool→result loop, accumulates token usage, and fires `onStep` callbacks for SSE streaming.
- **Permission-filtered tool access scoped by org and tool slug** — ToolRegistry resolves which tools a caller may use before the loop starts. Fail-closed on permission errors.
- **Persistent memory with JSONB storage** — StateManager provides key-value state and run-conclusion persistence, both scoped to org + tool + session.
- **Three platform tools ready to use** — web search (Brave API), knowledge base semantic search (pgvector), and email (MailChannels/SMTP).
- **Org isolation enforced at every database write** — `orgId` is always sourced from `context`, never from caller-supplied input. Security comment marks every INSERT site explicitly.
- **Handler errors contained** — a broken agent cannot crash the process at any layer (AgentOrchestrator per-tool catch, AgentScheduler trigger catch).
- **Full test coverage with consistent mock patterns** — `require.cache` stubs, fresh instances per test, SQL param assertions, and the end-to-end orgId pipeline proof.

---

## Google Ads API Authentication

Lessons from getting the Google Ads API working for the first time in a Node.js project.

- **Google Ad Manager API vs Google Ads API — completely different products.** Ad Manager is for publishers monetising ad inventory (think media companies). Google Ads API is for advertisers managing their own campaigns. Common search results conflate the two. If you see "Ad Manager API" in a guide, it's the wrong product.

- **Manager Account (MCC) is required to obtain a developer token.** Standalone advertiser accounts have no API Centre section in their Google Ads settings. You must create or link to a Manager Account first, then apply for a developer token from the Manager Account's API Centre. This is not documented clearly in the getting-started guides.

- **Explorer access level is sufficient for internal single-account use.** Explorer is the default token tier granted automatically. Standard access requires a more involved application and review. If your use case is querying your own accounts only (not building a multi-client product), Explorer access covers everything you need.

- **Service Account credentials vs OAuth2 client credentials — both exist, only OAuth2 client works for Ads.** The Google Cloud project may have both a Service Account JSON and an OAuth2 Client ID. For Google Ads API, the OAuth2 Client ID + refresh token is the correct auth path. Service Account auth is not supported for Google Ads API (unlike Google Analytics or BigQuery).

- **`login-customer-id` vs `customer_id` — both required when authenticating through a Manager Account.** `customer_id` in the URL is the advertiser account being queried. `login-customer-id` in the request header is the Manager Account through which authentication was granted. Omitting the header causes `CUSTOMER_NOT_FOUND`. Both must be present.

- **`cost_micros` pattern — all Google Ads monetary values are in micros.** Every cost, budget, and CPC field returns an integer representing millionths of the currency unit. Divide by 1,000,000 for a human-readable AUD value. Never store micros in the DB without documenting the unit explicitly.

- **`google-ads-api` by Opteo (npm) vs official Google library — Opteo is the correct choice for Node.js.** The official Google Ads API client library is Java and Python only. `google-ads-api` by Opteo is the standard community library used in the Node.js ecosystem. Alternatively, use `googleapis` for OAuth2 token management and Node's built-in `fetch` for direct REST calls to `googleads.googleapis.com` — this avoids an extra package if `googleapis` is already installed.

- **`search_term_view` is the high-intent signal source.** This resource contains the actual user queries that triggered your ads (not just the keywords you bid on). It's the most valuable data for AI analysis — you can see what real users are searching for. Sorted by clicks, it surfaces the terms driving the most traffic.

- **Refresh token is long-lived; access token expires hourly.** The OAuth2 flow produces a refresh token (stored in `.env`, essentially permanent) and a short-lived access token. The `googleapis` OAuth2 client automatically exchanges the refresh token for a new access token when the current one expires. No manual token rotation needed.

- **GAQL date filtering without date segmentation returns aggregated totals.** In Google Ads Query Language, if you include `segments.date` in `SELECT`, you get one row per entity per day. If you filter by `segments.date BETWEEN '...' AND '...'` in `WHERE` without selecting it, the API returns aggregated metrics for the entire period — one row per entity. Use this for campaign performance totals; add `segments.date` to SELECT only when you need daily breakdowns.

- **Google Ads API versions sunset aggressively — always check developers.google.com/google-ads/api/docs/release-notes before starting.** v18 was already sunset when GoogleAdsService was first written; v19 was sunset February 11, 2026. As of March 2026 the current version is v23. Keep the version in a single `API_VERSION` constant so it's a one-line change each cycle.

---

## Google Analytics Data API (GA4)

Lessons from integrating the Google Analytics Data API v1beta into a Node.js project.

- **GA4 Data API vs Universal Analytics Reporting API — completely different products.** The old UA API (`analyticsreporting.googleapis.com`) is decommissioned. GA4 uses the Analytics Data API (`analyticsdata.googleapis.com`). If search results reference `v4` or `analyticsreporting`, they are for the deprecated UA product. The GA4 API is at `analyticsdata.googleapis.com/v1beta`.

- **Same OAuth2 refresh token covers both Google Ads and Google Analytics.** The `get-google-refresh-token.js` script requests both `adwords` and `analytics.readonly` scopes in a single grant. One refresh token, two APIs — no separate auth flow needed. The `googleapis` OAuth2 client rotates the access token automatically for both.

- **Property ID is numeric only — no `properties/` prefix in env var.** The GA4 property ID in Admin → Property Settings is a plain number (e.g. `314159265`). The service prepends `properties/` in the URL itself: `properties/${propertyId}:runReport`. Storing the raw number in env is cleaner and avoids double-prefix bugs.

- **GA4 response rows are parallel arrays, not named keys.** The API returns `dimensionHeaders`, `metricHeaders`, and `rows[]`. Each row has `dimensionValues[]` and `metricValues[]` in the same order as the headers. You must zip them yourself. The `_parseRows()` helper in `GoogleAnalyticsService` does this — it's the pattern to reuse for any new report method.

- **GA4 date dimension returns `YYYYMMDD`, not `YYYY-MM-DD`.** Dates in `segments.date` come back as `"20240115"` (no dashes). Convert with `normDate()` before returning to callers. Every other part of the platform uses ISO format with dashes — inconsistency here would break charts.

- **`bounceRate` is a decimal fraction (0–1), not a percentage (0–100).** GA4 returns `"0.4532"` meaning 45.32%. Do not multiply by 100 before storing or returning — let the frontend or chart library format it. Document the unit clearly in the return type JSDoc.

- **`averageSessionDuration` is in seconds.** GA4 returns session duration as a decimal number of seconds (e.g. `"127.5"` = 2 min 7.5 sec). Named `avgSessionDuration` in the service return shape to make the unit obvious from the property name.

- **Metric filters use `numericFilter` with `doubleValue`, not `intValue`.** To filter rows where `conversions > 0`, the filter body is `{ filter: { fieldName: "conversions", numericFilter: { operation: "GREATER_THAN", value: { doubleValue: 0 } } } }`. Using `int64Value: "0"` or `intValue` will fail silently or error — `doubleValue` is the correct key for fractional metric comparisons.

- **`googleapis` package includes `analyticsdata` — no extra npm package needed.** `google.analyticsdata('v1beta')` is available once `googleapis` is installed. However, the same OAuth2 + raw `fetch` pattern used by `GoogleAdsService` keeps both services consistent and avoids the overhead of the generated client's serialisation layer.

---

## Wiring Domain Services into the Agent Platform

Lessons from building the first domain agent (googleAdsMonitor) on top of the ToolsForge agent platform.

- **AgentOrchestrator must strip all non-Anthropic tool fields before sending schemas to Claude.** The Anthropic API only accepts `name`, `description`, and `input_schema` on tool objects. Platform tool objects also carry `execute`, `requiredPermissions`, and `toolSlug`. The original orchestrator only stripped `execute` — causing a `400 Extra inputs are not permitted` error on every real agent run. Fix: destructure all three internal fields out before building `anthropicTools`:
  ```js
  tools.map(({ execute: _e, requiredPermissions: _p, toolSlug: _s, ...schema }) => schema)
  ```
  This was a pre-existing bug that affected all registered tools. It only surfaced on the first real end-to-end run.

- **`toolSlug` on tool definitions is a security boundary, not just a filter.** A tool registered with `toolSlug: 'google-ads-monitor'` is invisible to any agent running with a different `context.toolSlug`. This is enforced inside `ToolRegistry.getAvailableTools()`. The agent module should always force `toolSlug` onto the context when calling both `getAvailableTools()` and `agentOrchestrator.run()` — do not trust that the caller passed the right slug.

- **Agent modules register tools as a side effect of `require()`, not via an explicit init call.** `require('./tools')` in `index.js` runs the registrations immediately. This is consistent with how Node.js modules work and means no `init()` step is needed. The singleton `toolRegistry` is shared across all importers via the require cache.

- **Wrap `stateManager.saveConclusion()` in a try-catch in every agent entry point.** The agent run itself (API calls + Claude loop) must not fail just because DB persistence fails. Test contexts use non-integer orgIds that cause type errors in Postgres. Wrap the save, log the error, and always return the analysis result to the caller regardless.

- **Claude uses all tools in a single iteration when given good tool descriptions.** With clear descriptions explaining *when* to call each tool, Claude called all four tools (`get_campaign_performance`, `get_daily_performance`, `get_search_terms`, `get_analytics_overview`) in a single parallel batch on iteration 1, then produced the full analysis on iteration 2. Total: 2 iterations, ~75 seconds, 12,392 tokens. This is efficient — the system prompt's "gather first, then analyse" instruction is doing real work.

- **The system prompt must specify tool-call order explicitly.** If you don't tell Claude which tools to call and in what order, it may call them one at a time across multiple iterations, wasting context and time. A numbered list ("1. Call get_campaign_performance first... 2. Call get_daily_performance...") is the correct pattern.

- **`integer` is valid in Anthropic tool input schemas.** Using `type: 'integer'` for the `days` parameter works correctly with the Claude API. The platform `_validateInput()` in ToolRegistry doesn't check `integer` (it only knows `number`), so it falls through to the skip path — meaning integer constraint is enforced by Claude's own schema handling, not by the platform validator. This is acceptable for simple numeric inputs.

### Status at v0.2.0 (March 2026)

**AGENT LAYER COMPLETE:**
- `server/agents/googleAdsMonitor/tools.js` — 4 tools registered (toolSlug: `google-ads-monitor`)
- `server/agents/googleAdsMonitor/prompt.js` — analyst system prompt with gather-first protocol
- `server/agents/googleAdsMonitor/index.js` — `runAdsMonitor(context)` entry point
- End-to-end verified: 2 iterations, ~75s, 12,392 tokens, all 4 tools called in parallel on iter 1

**BUG FIXED — `AgentOrchestrator.js`:**
- Was sending `execute`, `requiredPermissions`, and `toolSlug` to Anthropic API → 400 error on every real run
- Fix: strip all three internal fields before building `anthropicTools` array
- Applies to all future agents on the platform — no per-agent workaround needed

**KNOWN LIMITATION:**
- `StateManager.saveConclusion()` requires a valid integer `orgId`
- Test runs with `orgId: 'test'` log a warning but complete successfully
- Resolves automatically when agent runs via authenticated routes (real `orgId` from DB)

**NEXT SESSION — routes + scheduling + UI:**
- `POST /api/agents/google-ads-monitor/run` — trigger run, stream steps via SSE
- `GET /api/agents/google-ads-monitor/history` — return past conclusions
- `AgentScheduler` registration for twice-daily automated runs
- React UI: report view with charts and AI suggestions panel

---

## Working with Claude Code

Lessons about the development process itself — how to get better results when using Claude Code to build modules in this project.

- **Two-phase prompting produces better implementations.** Instruct Claude to explore
  and plan before writing any code. Review the plan, answer design questions, then approve.
  The implementation pass should use "think hard" to trigger extended reasoning. Skipping
  the exploration phase causes Claude to hallucinate existing codebase patterns — it
  invents conventions that don't exist rather than reading what's actually there.

