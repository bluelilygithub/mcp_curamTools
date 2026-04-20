# CHANGELOG.md

**Project Context:** Internal learning project for one organisation, solo developer. See [PROJECT_IDENTITY.md](./PROJECT_IDENTITY.md).

> **Primary reader:** AI + human. Read the last 2–3 entries at session start to understand current state.
> **Update trigger:** Every session. Add an entry before closing.
> **Format:** Date · What was built · What broke/was fixed · What's next.

---

## Template

```
## YYYY-MM-DD — [one-line session summary]

### Built
- …

### Fixed / discovered
- …

### Open / next
- …
```

---

## 2026-04-21 — Not Interested Report agent; platform pattern corrections; session-start guardrail update

### Built

**Not Interested Report agent (`not-interested-report`)**
- Pre-fetch architecture — fetches all data in Node.js, passes to Claude in one call, no ReAct loop
- Data sources: `wp_get_not_interested_reasons` (all-time CRM data), `wp_get_progress_details` (filtered in Node.js to not-interested lead IDs only), `ads_get_search_terms` + `ads_get_active_keywords` + `ads_get_campaign_performance` (90-day window)
- CRM privacy applied pre-AI via `AgentConfigService.getCrmPrivacySettings()` — field exclusions stripped from records before they reach the prompt
- Prompt structured around two diagnostic lenses per reason category: Ads Signal (which campaigns/keywords are producing wrong-fit leads) and Sales Signal (what the call notes reveal about rep qualification behaviour)
- Output is prose analysis with a "Where to act" close — one paragraph for marketing, one for sales
- `AgentConfigService` defaults: `max_tokens: 6000`, `max_task_budget_aud: 2.00`, standard tier
- Route registered in `agents.js` via `createAgentRoute`, `org_admin` only, on-demand (no cron)
- UI: `NotInterestedReportPage.jsx` — Run button, SSE progress log, `MarkdownRenderer` output, history sidebar, PDF export
- Wired in `App.jsx` and `client/src/config/tools.js`

**`auto-agent-instructions.txt` — mandatory reference read rule added**
- Before writing any new agent: read `adsAttributionSummary/index.js` (canonical pre-fetch pattern)
- Before writing any new frontend page: read `DiamondPlateDataPage.jsx` and `client/src/api/client.js`
- Four specific rules added covering the pattern failures found this session (see below)

### Fixed / discovered

Four deviations from established platform patterns were introduced and then corrected during this session. They are documented here so the pattern is explicit.

**1. Raw `fetch` used instead of `api.stream()` (auth failure)**
- Root cause: wrote a raw `fetch()` with `credentials: 'include'` for the SSE run endpoint. This project uses Bearer tokens, not cookies. `api.stream()` in `client/src/api/client.js` reads the token from `useAuthStore` and attaches it as `Authorization: Bearer`.
- Symptom: `{"error":"Authentication required."}` immediately on run.
- Fix: replace raw `fetch` with `api.stream('/agents/not-interested-report/run', {})`.
- Rule: `client/src/api/client.js` line 6 states explicitly — "Never use raw fetch('/api/...') for authenticated endpoints."

**2. `api.get()` result read as `res.data` (history never loaded)**
- Root cause: assumed Axios-style `{ data: [] }` response shape. `api.get()` calls `res.json()` and returns the parsed body directly — there is no wrapper object.
- Symptom: history silently returned an empty array; `res.data` was `undefined`.
- Fix: `const rows = (await api.get(...)) ?? []`.

**3. SSE history row read as `run.summary` instead of `run.result?.summary`**
- Root cause: history endpoint returns `agent_runs` rows where the full result JSONB is in the `result` column. Summary is `run.result?.summary`, not a top-level field.
- Fix: updated history display, run selection, and initial load to use `run.result?.summary`.

**4. Status comparison `=== 'success'` instead of `=== 'complete'`**
- Root cause: `persistRun()` saves `status: 'complete'` on success. Comparison against `'success'` meant the status badge never showed the green success colour.
- Fix: changed condition to `run.status === 'complete'`.

**5. Missing `startDate`/`endDate` in `agentOrchestrator.run()` context spread**
- Root cause: all other pre-fetch agents spread `{ ...context, startDate, endDate, toolSlug, customerId }` — these fields are present in every reference implementation. New agent omitted them.
- Fix: added `startDate` and `endDate` to the context spread.

### Open / next

- MCP-SERVERS.md `platform.js` table still missing `get_pending_suggestions`, `update_suggestion_outcome`, and `get_suggestion_history` — carry-over from 2026-04-19
- `not-interested-report` has not been run against live data yet — first run will reveal whether `wp_get_progress_details` returns sufficient note coverage for the not-interested lead IDs
- `entry_date` in progress notes is known-unreliable (ACF UI bug) — prompt instructs Claude not to use it for timing analysis; verify this guidance holds in practice
- AgentScheduler cron not registered — this report is on-demand only by design

---

## 2026-04-16 — Media Generator: Save to S3 + cost estimation; Admin Providers fix

### Built

**Media Generator — Save to S3**
- New `POST /api/media-gen/runs/:id/save-to-s3` route: fetches video/image bytes from Fal.ai CDN via `https.request`, uploads to S3 using `StorageService.put`, writes `storage_key` back to the run row. Idempotent — returns cached key on repeat calls.
- New `GET /api/media-gen/runs/:id/download-url` route: generates a 1-hour pre-signed S3 URL for saved media.
- DB migration: `ALTER TABLE media_gen_runs ADD COLUMN IF NOT EXISTS storage_key TEXT`.
- Uses org-level `storage_settings` (bucket/region) with env var fallback (`AWS_S3_BUCKET`, `AWS_S3_REGION`). All four AWS env vars confirmed set in Railway.

**Media Generator — Cost estimation**
- Added `FAL_COST_PER_UNIT` lookup table in `server/routes/mediaGen.js` — price per second (video) or per image (image models) for all default models.
- `estimateCost(modelId, outputType, duration)` called at job completion; result saved as `cost_usd NUMERIC(10,4)` on the run row.
- DB migration: `ALTER TABLE media_gen_runs ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(10,4)`.
- Cost included in the SSE `complete` event (`costUsd` field) and in the `GET /runs` history response.

**Media Generator — UI**
- Result panel: amber `~$0.20` cost badge; "Save to S3" button with loading/saved states.
- History table: new "Cost" column; compact "S3" button per completed row; "✓ S3" indicator once saved.

**Admin Providers — apiKeyEnv editable for built-ins + Test button fix**
- `apiKeyEnv` field is now editable in the edit form for built-in providers (Anthropic, Google, etc.).
- Test button no longer disabled when `!p.configured` — always enabled (only disabled while a test is in progress).
- `GET /admin/model-status` already re-checks `configured` using the custom `apiKeyEnv` when a builtin override is saved.

**Documentation system**
- Created 7 new root-level documentation files: `META.md`, `INTENT.md`, `SOUL.md`, `GUARDRAILS.md`, `MEMORY.md`, `PERSONA.md`, `DATABASE.md`.
- Merged missing content from `server/CLAUDE.md` into the new system: PII/data privacy (GUARDRAILS), PDF export rule (GUARDRAILS), pre-fetch vs ReAct principle (SOUL), JSDoc/backtick/null/updated_by/JSON-parsing/image-dimensions/Ghostscript gotchas (MEMORY), `updated_by` FK note (DATABASE), tool tables for `doc_extraction_runs` and `media_gen_runs` (DATABASE).
- Created `MCP-SERVERS.md` — full tool inventory (source of truth for all 6 MCP servers, 32 tools).
- Created `CHANGELOG.md` (this file).

### Fixed / discovered
- Fal.ai CDN URLs are direct HTTPS — no redirect handling needed for the S3 save fetch.
- `result` JSONB column returns as a parsed JS object from `pg` — `run.result?.video?.url` works directly in Node route handlers without `JSON.parse`.

### Open / next
- `CRON.md` not yet created — scheduled jobs (google-ads-monitor at 06:00/18:00 AEST) not yet documented.
- `ROI.md` not yet created — cost model and budget thresholds not yet documented.
- Media Generator: Fal.ai URLs on some models may expire before user clicks "Save to S3" — unknown TTL; test in production.
- `server/CLAUDE.md` is now superseded by the new documentation system but has not been deleted — confirm before removing.

---

## 2026-04-19 — High Intent Advisor: user feedback capture + suggestion history tool

### Built

**DB migration**
- `ALTER TABLE agent_suggestions ADD COLUMN IF NOT EXISTS user_action TEXT` — what action the user took when marking acted on
- `ALTER TABLE agent_suggestions ADD COLUMN IF NOT EXISTS user_reason TEXT` — why the user dismissed a suggestion

**Platform MCP server — 1 new tool (v1.2.0)**
- `get_suggestion_history` — returns full suggestion history for the org (all statuses), ordered by created_at DESC, limit 100 default cap 200. `cacheable: false`. Returns `user_action, user_reason, outcome_notes, outcome_metrics, baseline_metrics, created_at, acted_on_at, reviewed_at` plus category/priority/suggestion_text/rationale/status.

**Agent tools.js — 14 → 15 tools**
- Added `getSuggestionHistoryTool` wrapping `get_suggestion_history`. `cacheable: false`. Injected `org_id` from `context.orgId` — not exposed to LLM.

**PATCH route extended**
- `PATCH /api/agents/high-intent-advisor/suggestions/:id` now accepts and writes `user_action` and `user_reason` via COALESCE SQL. Org validation unchanged.

**UI — HighIntentAdvisorPage.jsx**
- "Mark acted on" flow: now expands inline (like dismiss) with a textarea "What action did you take?" and Confirm/Cancel buttons. PATCH sends `{ status: 'acted_on', acted_on_at, user_action }`.
- Dismiss flow: textarea now captures `user_reason` ("Why are you dismissing this?"). PATCH sends `{ status: 'dismissed', user_reason }`.
- Both flows remove the card from the active list on success and show a toast.

**prompt.js — Phase 1 updated**
- Added step 4: call `get_suggestion_history` to review full history across all statuses
- After completing steps 1–4, agent writes a **Response Pattern Summary** paragraph (outside `<suggestion>` tags) covering: highest confidence intervention type, active constraints from dismissal reasons, calibration note for suggestion types that haven't moved metrics. Stored in `agent_runs.result` for future retrieval via `get_report_history`.

### Open / next
- MCP-SERVERS.md platform table still missing `get_pending_suggestions`, `update_suggestion_outcome`, and now `get_suggestion_history` — update next session
- AgentScheduler cron registration (`0 7 * * *`) — add after manual QA confirms output quality
- History tab could show `user_action` and `user_reason` columns — deferred

---

## 2026-04-19 — High Intent Advisor agent + suggestions UI

### Built

**DB migration**
- `agent_suggestions` table with `id, org_id, run_id, slug, category, priority, suggestion_text, rationale, status, baseline_metrics, outcome_metrics, outcome_notes, acted_on_at, reviewed_at, created_at`
- Indexes: `idx_agent_suggestions_org_status` (org_id, status, created_at DESC), `idx_agent_suggestions_run` (run_id)

**Platform MCP server — 2 new tools (v1.1.0)**
- `get_pending_suggestions` — returns pending/monitoring suggestions for the org ordered by priority
- `update_suggestion_outcome` — updates outcome_metrics, outcome_notes, reviewed_at, and optionally status; org_id validated server-side

**Agent: `server/agents/highIntentAdvisor/`**
- `tools.js` — 14 tools: 5 Ads, 3 GA4, 2 WordPress CRM, 4 Platform/KB. `get_search_terms`, `get_budget_pacing`, `get_paid_bounced_sessions`, `get_enquiries`, `get_pending_suggestions`, `update_suggestion_outcome` all marked `cacheable: false`
- `prompt.js` — three-phase system prompt: Phase 1 reviews prior suggestions via `get_pending_suggestions` + `update_suggestion_outcome`; Phase 2 gathers data across all sources; Phase 3 generates 3–7 suggestions in `<suggestion>` tag format
- `index.js` — parses `<suggestion>` blocks from agent output, validates category/priority, INSERTs to `agent_suggestions`; emits phase boundary progress; returns plain-text summary

**Route registration (`server/routes/agents.js`)**
- `POST /api/agents/high-intent-advisor/run` via `createAgentRoute` (org_admin only)
- `GET /api/agents/high-intent-advisor/suggestions` — pending/monitoring, priority-ordered
- `GET /api/agents/high-intent-advisor/suggestions/history` — acted_on/dismissed, limit 50
- `PATCH /api/agents/high-intent-advisor/suggestions/:id` — status, outcome_notes, acted_on_at; org_id validated
- AgentScheduler cron registration deferred to after manual QA

**AgentConfigService**
- AGENT_DEFAULTS: `high-intent-advisor` — schedule `0 7 * * *` (inactive until cron registered)
- ADMIN_DEFAULTS: enabled, max_tokens 4096, max_iterations 25, max_task_budget_aud 3.00, maxTokensHardLimit 6000
- AGENT_MODEL_REQUIREMENTS: advanced tier

**UI: `client/src/pages/tools/HighIntentAdvisorPage.jsx`**
- Two tabs: Active Suggestions (grouped by priority with red/amber/grey dots) and Suggestion History (table)
- Suggestion cards: category pill, priority dot, date, suggestion text, rationale, baseline_metrics row, outcome_notes
- Inline dismiss with optional note textarea (no modal) + Mark acted on button
- Run Advisor button — SSE stream with progress log, toast on completion
- EmptyState for zero suggestions

**App registration**
- Route: `/tools/high-intent-advisor`
- `tools.js` entry: org_admin only, icon: target
- `api/client.js`: added `api.patch()` method (was missing)

### Deferred
- AgentScheduler cron registration (`0 7 * * *`) — add after manual QA confirms output quality
- MCP-SERVERS.md not updated this session (add `get_pending_suggestions` and `update_suggestion_outcome` to the platform table next session)

### What to test
1. Server starts cleanly — `agent_suggestions` table present
2. `POST /api/agents/high-intent-advisor/run` returns SSE stream; agent completes all three phases
3. At least one `<suggestion>` row written to `agent_suggestions` after first run
4. `GET /api/agents/high-intent-advisor/suggestions` returns the suggestion
5. `/tools/high-intent-advisor` renders with Active Suggestions visible
6. Mark acted on → row moves to history tab
7. Dismiss (with and without note) → row moves to history tab
8. Check baseline_metrics in suggestion cards contain meaningful numeric values
9. Check outcome_notes from Phase 1 are coherent once there are prior suggestions

---

## 2026-04-18 — Code audit + session-scoped tool result cache

### Built

**Session-scoped tool result cache in AgentOrchestrator**
- Added module-level `sessionCache: Map(sessionKey → Map(cacheKey → { result, timestamp }))` in `AgentOrchestrator.js`
- Cache key: `orgId:userId` (per-user, cross-turn within TTL)
- Entry key: `toolName:JSON(input)` — different inputs get separate entries
- TTL: 5 minutes (matches Anthropic prompt cache window)
- Eviction: `setInterval` every 5 min purges expired entries and removes empty session Maps; `.unref()` ensures it won't block process exit
- Error results (`result?.error`) are never cached — failed tool calls always re-run
- `cacheable` field on tool definitions controls opt-out (`cacheable: false` on `getBudgetPacingTool`)
- `cacheable` stripped from provider schema alongside `execute`, `requiredPermissions`, `toolSlug`
- Cache hits: `onStep` callback skipped (no "Running…" noise), `fromCache: true` stored in trace
- Verified correct with `console.info '[AgentOrchestrator] cache hit'` log

**`getBudgetPacingTool` marked non-cacheable**
- Added `cacheable: false` to `getBudgetPacingTool` in `googleAdsConversation/tools.js`
- Reason: returns today's live spend — a 5-min-old result could cause incorrect budget decisions

### Fixed / discovered

**Code audit of recent AI provider commits**
- `ca363ad` (`Minimal AI provider fixes`) reviewed: `anthropic.js` system prompt changes are correct and safe — string path is functionally identical to the old one-liner; array handling is defensive and never triggered by current callers
- Commit message inaccuracy: `ca363ad` claims "Added model mapping for deprecated models (gemini-2.0-flash → gemini-2.0-flash-exp)" — no such mapping exists in the committed files
- Gemini URL bug identified: `ca363ad` kept `providerRegistry.js` change (`'models/gemini-'` prefix) but reverted the matching `gemini.js` fix, leaving the URL builder as `/v1beta/models/${model}:generateContent`. A `models/gemini-*` model ID would produce a double-prefixed, URL-encoded path (`/v1beta/models/models%2Fgemini-...`). Not applied yet — Gemini is a stub in this deployment

### Open / next
- Apply Gemini URL fix: `const modelPath = model.startsWith('models/') ? model : \`models/${model}\``; use `modelPath` in the `httpsPost` call in `gemini.js` — needed before Gemini is activated
- `logUsage` in docExtractor only passes `{ input, output }` — missing `cacheRead`/`cacheWrite` in `usage_logs` DB record (cost tracking is still correct; breakdown is incomplete)

---

## 2026-04-17 — MCP Resource Support: Phase 1.2-1.3 Complete

### Built

**Phase 1.2: Basic MCP Resources Implementation**
- Updated Google Ads MCP server (`google-ads.js`) with 3 resources:
  - `google-ads://campaigns/current` - Active campaigns with performance metrics
  - `google-ads://keywords/top-performing` - Top converting keywords
  - `google-ads://budget/pacing-summary` - Budget pacing status
- Updated WordPress MCP server (`wordpress.js`) with 3 resources:
  - `wordpress://enquiries/recent` - Recent enquiries with attribution
  - `wordpress://enquiries/device-breakdown` - Device type analysis
  - `wordpress://enquiries/utm-sources` - Top UTM sources
- Both servers now advertise resources capability in `initialize` response
- Resource handlers reuse existing tool functionality for consistency
- Updated server versions: Google Ads v1.1.0, WordPress v2.1.0

**Phase 1.3: Resource Discovery UI**
- Added backend API endpoints:
  - `GET /api/admin/mcp-servers/:id/resources` - Discover resources from connected server
  - `POST /api/admin/mcp-servers/:id/resources/read` - Read resource content
- Enhanced Admin MCP Servers page with "Resources" button
- Created `ResourceViewer` component for displaying and reading resources
- Enhanced Admin MCP Resources page with "Discover resources" button
- Added modal for bulk resource discovery with one-click registration
- Resource content viewing with JSON formatting and MIME type display

**Documentation Updates**
- Updated `MCP-SERVERS.md` with resource documentation tables
- Created `test-mcp-resources.js` for testing resource support
- Updated `CHANGELOG.md` with comprehensive session summary

### Fixed / discovered
- MCP protocol requires proper `capabilities.resources` advertisement in `initialize`
- Resource URIs should follow consistent pattern: `{server}://{category}/{name}`
- Backend auto-connects to servers if not already connected for resource discovery
- Frontend handles servers without resource support gracefully

### Open / next
- **Phase 1.4: Resource Integration in Agent Tools** - Update agent tools to use resources
- Add resource references in tool descriptions
- Implement resource-based prompts for AI agents
- Create resource usage analytics
- Test resource discovery with actual connected servers
- Consider automatic resource registration on discovery
