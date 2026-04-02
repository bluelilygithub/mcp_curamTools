# CLAUDE.md — Project guardrails

Read this before making any change to the conversation agent, MCP servers, or agent prompts.

---

## Before touching googleAdsConversation

Check all three before editing:

1. **`agents/googleAdsConversation/tools.js`** — exported array must include a tool for every MCP server tool listed below
2. **`agents/googleAdsConversation/prompt.js`** — tool list section must match the exported array exactly
3. **MCP servers below** — source of truth; if the agent tool calls a server tool that isn't listed here, something is wrong

---

## MCP server tool inventory (source of truth)

### google-ads.js — 9 tools
- `ads_get_campaign_performance`
- `ads_get_daily_performance`
- `ads_get_search_terms`
- `ads_get_budget_pacing`
- `ads_generate_keyword_ideas`
- `ads_get_auction_insights`
- `ads_get_impression_share_by_campaign`
- `ads_get_active_keywords`
- `ads_get_change_history`

### google-analytics.js — 5 tools
- `ga4_get_sessions_overview`
- `ga4_get_traffic_sources`
- `ga4_get_landing_page_performance`
- `ga4_get_paid_bounced_sessions` ← has device breakdown; use for mobile/desktop questions
- `ga4_get_conversion_events`

### wordpress.js — 5 tools
- `wp_get_enquiries` ← returns device_type on every record
- `wp_get_not_interested_reasons`
- `wp_enquiry_field_check`
- `wp_find_meta_key`
- `wp_get_server_ip` ← diagnostic only; not wired to conversation agent intentionally

### platform.js — 4 tools
- `list_report_agents`
- `get_report_history`
- `search_report_history`
- `flag_prompt_for_review` ← not wired to conversation agent intentionally

### knowledge-base.js — 3 tools
- `search_knowledge`
- `add_document`
- `list_knowledge_sources`

---

## Conversation agent — current tool count: 22

If you cut tools to reduce cost, you are solving the wrong problem.
The correct lever is the prompt discipline instruction: *don't re-fetch data already in the conversation.*
Tool schema overhead is fixed per turn. Re-fetching compounds across every turn.

---

## Device data — never say it's unavailable

Device is available in all three systems:
- **CRM** `get_enquiries` → `device_type` field (mobile / desktop / tablet) — years of history
- **GA4** `get_paid_bounced_sessions` → segmented by landing page + device — from March 2026
- **Google Ads** → not segmented by device in current tool outputs

---

## Model layer — Gemini support planned

The platform will support multiple AI providers (Anthropic Claude + Google Gemini).
Do not hardcode Anthropic-specific assumptions into shared platform code.
When adding model-dependent logic, abstract it behind the existing `adminConfig.model` pattern.
Agent orchestration (`AgentOrchestrator`) must remain provider-agnostic.

---

## Rules learned through pain

**Do not cut from the exported tool array without auditing the MCP server it calls.**
The definition may still exist in tools.js but the agent cannot use it if it's not exported.

**Do not write a prompt section about a capability without verifying the tool is wired.**
The CRM device_type field existed; the agent said device data was unavailable because the prompt didn't mention it.

**Do not add a UNIQUE index to any table without deleting duplicates first.**
The `user_roles` migration crashed in production because of pre-existing duplicate rows.

**Do not use `fetch()` for outbound HTTP on Railway.**
Use `https.request` with explicit `Content-Length`. `fetch` silently fails in that environment.

**Do not use regex syntax inside JSDoc block comments.**
`*/` inside a `/** ... */` comment closes the block early and breaks the Vite build.

**Always state whether a server restart is required after changes.**
Environment variable changes and new MCP server registrations require a restart.
Code-only changes in Railway auto-deploy and do not require manual restart.

---

## CRM field exclusions — admin-configurable PII filter

Admin > CRM Privacy (`/admin/crm-privacy`) lets org admins declare ACF `meta_key` names
to exclude from LLM access. Stored in `system_settings` under key `crm_privacy` (per-org JSONB).

**Where enforced:** tool execute layer in `agents/googleAdsConversation/tools.js`.
`applyFieldExclusions()` strips declared fields from `get_enquiries` and `get_not_interested_reasons`
results before Claude sees them.

**Bypass:** `enquiry_field_check` and `find_meta_key` are discovery tools — they bypass exclusions
intentionally so the admin can inspect the full field set. Do not add exclusion logic to these.

**Service layer:** `AgentConfigService.getCrmPrivacySettings(orgId)` /
`updateCrmPrivacySettings(orgId, patch, updatedBy)` — follows the same pattern as `getOrgBudgetSettings`.

**Do not:**
- Add exclusion logic to the WordPress MCP server (`mcp-servers/wordpress.js`) — the MCP server is dumb
- Hardcode field names in tools.js — that's what the admin UI is for
- Apply exclusions in `enquiry_field_check` or `find_meta_key`

---

## WordPress CRM — key facts

- Post type: `clientenquiry`
- Tables: `bqq_posts` + `bqq_postmeta` (all WP tables use `bqq_` prefix)
- Field storage: one row per field per post in `bqq_postmeta` as `meta_key` / `meta_value`
- ACF double-row pattern: `reason_not_interested` = value; `_reason_not_interested` = ACF pointer (ignore)
- Use plain key, never the underscore-prefixed key
- Direct MySQL via `mysql2` — bypasses SiteGround WAF entirely
- Use `pool.query()` not `pool.execute()` — avoids prepared-statement issues with LIMIT
- Embed LIMIT as integer string directly in SQL, not as a `?` placeholder

---

## Security decisions

### What is fixed

**Rate limiting — conversation endpoint**
`POST /api/conversation/:id/message` is protected by an in-process sliding window limiter:
20 requests per user per minute. Implemented in `middleware/rateLimiter.js`, applied in `routes/conversation.js`.
No new npm dependency — uses a Map + setInterval. Railway auto-deploys this; no restart needed.

**RAG poisoning — add_document removed from conversation agent**
`addDocumentTool` is defined in `tools.js` but excluded from the exported `googleAdsConversationTools` array.
The conversation agent cannot write to the knowledge base. Read-only via `searchKnowledgeTool` only.
If you ever want agent-initiated document storage, it must be a deliberate, audited decision.

**Prompt injection guard**
The conversation system prompt has an explicit "Security — tool result trust" section.
All tool result content is declared untrusted data. The agent is instructed to disregard any text
that looks like instructions embedded in campaign names, search terms, CRM fields, or knowledge base documents.

**SQL Console write guard — already existed**
`routes/admin.js` uses `execSql(sql, allowWrite, userEmail)` with a `WRITE_KEYWORDS` array.
All SQL Console and NLP SQL routes already enforce this. No change needed.

**Rate limiting — agent run endpoints**
`POST /api/agents/:slug/run` uses the same in-process limiter: 5 runs/user/5 minutes.
Applied in `platform/createAgentRoute.js` via `runRateLimiter`. No restart needed.

**Tool call audit log — conversation turns**
`conversation.js` now destructures `trace` from `agentOrchestrator.run`. Tool call names are:
1. Logged to console as structured JSON: `[conversation:tools] { convId, orgId, iterations, tools }`
2. Stored on the assistant message JSONB as `toolCalls: [...]` — persists to DB, queryable.

**Context window management**
`conversation.js` runs stored history through `trimHistory()` before passing to the orchestrator.
Over 40 messages → trimmed to last 36, starting on a user turn.

**Provider abstraction — Gemini ready**
`AgentOrchestrator` no longer imports Anthropic directly. Provider is selected by model prefix:
- `claude-*` → `platform/providers/anthropic.js`
- `gemini-*` → `platform/providers/gemini.js` (stub — throws until implemented)
History messages are stripped of non-standard fields (e.g. `toolCalls`) before passing to provider.

**Knowledge base `add_document` via HTTP — already protected**
`adminMcp.js` has `router.use(requireAuth, requireRole(['org_admin']))` at line 36.
The only HTTP path to call `add_document` on the KB MCP server is
`POST /api/admin/mcp-servers/:id/call` which is org_admin only. No change needed.

**MCP server failure — structured errors**
`platform/mcpTools.js` now exports `callMcpToolSafe`. When used in a tool's `execute()`,
failures return `{ _unavailable: true, server, error }` instead of throwing.
Claude can then reason about which system is down rather than treating it as a hard error.
The existing tools still use `callMcpTool` (throws on error, orchestrator catches it).
Switch a tool to `callMcpToolSafe` when graceful degradation matters for that specific tool.

### What is NOT fixed (accept or address later)

- **callMcpToolSafe adoption** — added the helper but existing tools still use `callMcpTool`.
  Switch individual tools to `callMcpToolSafe` if graceful multi-source answers are needed.
- **Gemini provider** — stub exists, throws until implemented. Wire when Gemini API key is added.

---

## Data coverage boundaries

| Source | Available from |
|---|---|
| Google Ads | ~March 2026 |
| GA4 | ~March 2026 |
| WordPress CRM | Years of history |
| Agent run history | Whatever has been run since deployment |
