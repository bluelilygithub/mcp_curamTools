# CLAUDE.md — Server guardrails

**Project Context:** Internal platform, solo developer. Read [PROJECT_IDENTITY.md](../PROJECT_IDENTITY.md) before architectural decisions. **App boundaries:** Core vs Diamond Plate vs Engineering — [knowledge_base/architecture/APPS.md](../knowledge_base/architecture/APPS.md).

Before touching the conversation agent, MCP servers, or agent prompts: Search relevant source files for existing patterns, verify against these guardrails and DECISIONS.md, then make the change and update CHANGELOG.md.

---

## Golden-path smoke test

Run `npm test` from repo root before closing any session that changed:
`markdownPdfBuffer.js` · `routes/export.js` · `createAgentRoute.js` · `AgentScheduler.js` · `promptVersions.js` · `demoSuite/tenderResponse/index.js`

---

## Hard rules — no exceptions

**No hardcoded model fallbacks.** Never `?? 'claude-sonnet-4-6'` or `|| 'deepseek-chat'` in agent code. Use `AgentConfigService.getResolvedAdminConfig(slug, orgId)`. Null model = config error, not silent default.

**No direct provider imports.** Never `require('../../platform/providers/anthropic')`. Always `getProvider(model, customProviders)` from `AgentOrchestrator`. Always pass `customProviders` — never call `getProvider(model)` with one argument.

**No direct DB writes for runs or configs.** `agent_runs` via `persistRun` only. `agent_configs` via `AgentConfigService` only.

**Org ID from server.** Always `req.user.orgId`. Never `req.body.orgId` or `req.query.orgId`.

**No `fetch()` for outbound HTTP on Railway.** Use `https.request` with explicit `Content-Length`. `fetch` silently fails.

**No `window.print()` for PDF export.** Use `exportService.exportPdf()` / `fetchPdfBlob`. Route: `POST /api/export/pdf`. Full docs: `PLATFORM-PRIMITIVES.md`.

**No UNIQUE index without dedup first.** Always `DELETE` duplicates before `CREATE UNIQUE INDEX` or the migration crashes in production. Put dedup + constraint changes in **`server/migrations/`** (see `knowledge_base/architecture/MIGRATIONS.md`) — not inline in `initSchema()`.

**No regex syntax in JSDoc block comments.** `*/` closes the block early and breaks the Vite build.

**Token usage — always via `UsageLogger.logUsage()`.** Never write to `usage_logs` directly.

---

## Model resolution

Hierarchy: per-agent override → org default → config error (throw, do not guess).

```js
// Non-agent routes calling a model directly:
const { getProvider } = require('../platform/AgentOrchestrator');
const { getCustomProviders, getOrgDefaultModel } = require('../platform/AgentConfigService');
const [modelId, customProviders] = await Promise.all([getOrgDefaultModel(orgId), getCustomProviders(orgId)]);
const provider = getProvider(modelId, customProviders);
```

Two-model pattern (mandatory for multi-stage agents): extraction = `adminConfig.model`, synthesis = `getOrgDefaultModel(orgId)`. Log both with `emit()` before each call. Reference: `server/agents/specValidator/index.js`.

Prompt versioning: bump label in `promptVersions.js` and log in root `CHANGELOG.md` when changing system/stage prompts.

---

## Permissions

New routes: `requirePermission('area:action')` — not `requireRole`. Format: `agents:run:<scope>`, `lessons:manage`, `mcp:manage`.

---

## PII — mandatory for any tool handling user data

Load before batch:
```js
const { excluded_field_names: excludedFields = [] } =
  await AgentConfigService.getExtractionPrivacySettings(orgId);
```
Apply post-AI, pre-DB-save:
```js
if (excludedFields.length > 0) {
  const excludedSet = new Set(excludedFields);
  result.fields = result.fields.filter((f) => !excludedSet.has(f.name));
}
```
**Never save first and strip later.** CRM privacy stays in the tool execute layer (not MCP server) so discovery tools can bypass it. Reference implementations: `routes/docExtractor.js`, `agents/googleAdsConversation/tools.js → applyFieldExclusions()`.

---

## Pre-fetch vs ReAct

If you can enumerate all tool calls before Claude runs → pre-fetch (fetch in Node, pass in one message, `maxIterations: 1`, `tools: []`). ReAct loop only when data requirements are genuinely dynamic. The conversation agent is the only current ReAct agent.

---

## Conversation agent

`add_document` is intentionally excluded from the exported tool array — RAG poisoning vector. Do not re-add without security review. Tool count is 23 — do not cut tools to reduce cost; cut re-fetching via prompt discipline instead.

---

## `needs_review` status

`needs_review` = successful run with data anomalies — not an error. Always filter successful runs as:
```js
rows.filter(r => r.status === 'complete' || r.status === 'needs_review')
// SQL: WHERE status IN ('complete', 'needs_review')
```
Display anomalies via `<BoundsWarningPanel boundsFailed={result.boundsFailed} />`.

---

## WordPress MCP

Always `pool.query()` not `pool.execute()` — prepared statement bug with LIMIT. Embed LIMIT as integer string in SQL, not as `?` placeholder.

---

## Model selector — frontend

`ai_models` is a display list, not the routing list. Use `<input list>` + `<datalist>` (not `<select>`) for org default model field. Always add a fallback `<option>` for the current value if it's not in the list. A plain `<select>` restricted to `ai_models` silently routes everything to Anthropic when org default is DeepSeek/GPT/etc.

---

## Doc Extractor (non-SSE agent)

Does not use `createAgentRoute`. Must still: check budget per file (`checkBudget` / `BudgetExceededError`), apply PII exclusion post-AI pre-DB, cap user input lengths at route boundary, guard user-supplied prompt fields against injection (`[USER FOCUS]` delimiter + system prompt instruction).

---

## S3 / StorageService

AWS SDK v3 uses native Node.js HTTP — Railway-safe. No `https.request` workaround needed (unlike MailChannels). Use `StorageService.js`; do not call `@aws-sdk` directly from routes or agents.

Three `default_behaviour` values (all implemented):
- `store_original` — raw file bytes, before any processing or privacy stripping
- `store_redacted` — privacy-stripped extraction result as JSON (fields already excluded); original document not stored
- `do_not_store` — nothing uploaded; `storage_key` never written

Storage block runs **after** field exclusions in `docExtractor.js` — `store_redacted` payload is always clean.

---

## Lessons coverage

New agent or AI routine → add to `LESSON_COVERAGE_SECTIONS` in `AdminLessonsPage.jsx`. Proposed lessons stay `under-review` until activated by admin.

---

## Rules learned through pain

- `null` bypasses JS default params — use `?? fallback` at call site: `adminConfig.max_tokens ?? 4096`
- `updated_by` in `system_settings` is `INTEGER` FK — pass `req.user.id`, never `req.user.email`
- Reasoning models (`deepseek-reasoner`, `o1`, `o3`) — `content` may be `null`; `openai-compatible.js` handles fallback to `reasoning_content`. Use `max_tokens ≥ 8192`.
- Strip fences AND find first `{` last `}` when parsing JSON from model output — trailing text after fences breaks `JSON.parse`
- PDF rasterisation: use Ghostscript directly (`gs`), not pdf2pic. Cap image dimensions to 7900px before sending to Anthropic.
- Do not write a prompt section about a capability without verifying the tool is wired
- Do not cut from an exported tool array without auditing the MCP server it calls
- Backticks inside template literal strings in `prompt.js` close the string early → use double quotes

---

## Detailed reference docs

| Topic | Doc |
|---|---|
| Platform primitive interfaces | `PLATFORM-PRIMITIVES.md` |
| MCP server tools + data shapes | `MCP-SERVERS.md` |
| Architectural decisions + rationale | `DECISIONS.md` |
| Permissions model | `PERMISSIONS.md` |
| Scheduled jobs | `CRON.md` |
| Prompt caching, tool cache, pre-fetch pattern | `PLATFORM-PRIMITIVES.md` |
| Security decisions | `DECISIONS.md` |
| New agent checklist | `server/agents/CLAUDE.md` |
