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

## 2026-04-29 — ROI Analysis: actual revenue vs investment vs industry benchmark chart

### Built

**ROI Analysis section — added to Campaign Dashboard (bottom of page)**
- `server/routes/dashboard.js` — new `GET /api/dashboard/roi-analysis?days=` endpoint.
  Fetches Google Ads daily performance (spend) and WordPress `wp_get_enquiry_details` (final_value) in parallel via MCPRegistry. Aggregates by calendar month. Calculates total investment (ad spend + prorated $1,500/mo management fee), actual CRM revenue, ROAS, vs industry benchmark vs target.
- Revenue source: `final_value` from `clientenquiry` post type in WordPress CRM, by enquiry submission date. Only records with a recorded final_value are counted.
- Management fee: $1,500/mo, prorated by calendar days covered for partial months at range boundaries.
- Industry benchmark: Car Detailing / Auto Detailing AU, Google Ads average 3–5× ROAS (WordStream). 3.5× used as conservative lower bound.
- Revenue target: $50,000/mo (stated).
- WordPress gracefully unavailable: if WP MCP server not connected, returns `wordpressAvailable: false` — cost bars still display, revenue/ROAS bars show zero with explanatory note.

**ROI section charts (inline Recharts — `ReferenceLine` required, not in BarChart wrapper):**
- 6 KPI tiles: total investment, actual revenue, actual ROAS (colour-coded vs benchmarks), net return, vs $50k/mo target, industry benchmark revenue
- Monthly Revenue vs Investment: stacked bar (ad spend + management fee) alongside actual revenue bar; $50k target reference line
- Monthly ROAS: bar chart colour-coded green/amber/red; industry 3.5× reference line; target 5.56× reference line (50000/9000)
- Methodology note: explains revenue calculation caveat (recent months may be understated as jobs complete after enquiry date)

**Date range filtering:** ROI section uses same `days` preset (30d/60d/90d) as the rest of the dashboard; loads in parallel independently so WordPress delays don't block Google Ads charts.

### Open / next
- Profitability Oracle (True ROAS) — cross-source revenue attribution (ad campaign → CRM final_value) for per-campaign ROAS.
- PDF export button for full management pack distribution.

---

## 2026-04-29 — Campaign Dashboard: management chart view of 90-day Google Ads performance

### Built

**Campaign Dashboard — new tool at `/tools/campaign-dashboard`**
- `server/routes/dashboard.js` — new `GET /api/dashboard/campaign-performance?days=` endpoint. Calls 5 `GoogleAdsService` methods in parallel (`getCampaignPerformance`, `getDailyPerformance`, `getSearchTerms`, `getBudgetPacing`, `getImpressionShareByCampaign`) and returns all data in one JSON response. Auth-gated (`requireAuth`), no agent/MCP overhead.
- `client/src/pages/tools/CampaignDashboardPage.jsx` — management-ready single-page dashboard. No AI runs required — pure data visualisation.
- Registered in `client/src/config/tools.js` (Google Ads group, `ads_operator` + `org_admin`).
- Wired in `App.jsx` and `server/index.js`.

**Charts included:**
- 5 KPI tiles: total spend, total conversions, avg CPA, avg CTR, revenue context (~$50k/mo avg, 6.7× ROAS)
- Daily spend vs conversions trend (LineChart, 90-day overlay)
- Ad spend by campaign (horizontal BarChart, sorted spend desc)
- Conversions by campaign (horizontal BarChart)
- CPA by campaign (horizontal BarChart, worst first — flags high-cost campaigns)
- CTR by campaign (horizontal BarChart, lowest first — copy review targets)
- Impression share breakdown per campaign (grouped BarChart: IS%, lost-to-rank%, lost-to-budget%)
- Budget pacing current month (grouped BarChart: budget vs spent-to-date)
- Top 15 converting search terms (horizontal BarChart)
- Monthly spend vs $50k revenue benchmark (LineChart)

**Management context built in:**
- Context banner: AU small-population market, $7,500/mo spend, ~$50k/mo avg revenue, 6.7× ROAS
- Algorithm sensitivity note: explains why apparent loss-leaders are intentional — previous negative keyword / location tightening disrupted algorithmic trust and caused ~50% traffic loss

**Preset selector:** 30d / 60d / 90d (defaults 90d).

### Open / next
- Profitability Oracle (True ROAS) — cross-references CRM `final_value` with ad spend per campaign for actual revenue-based ROAS, not estimated.
- Consider PDF export button on campaign dashboard for management pack distribution.

---

## 2026-04-28 — Media Gen: fix reference image upload for image-to-video/image models

### Fixed / discovered
- Both `storage.fal.run` and `storage.fal.ai` fail DNS resolution on Railway — fal.ai's storage subdomain is unreachable from Railway's network.
- All image-to-video and image-to-image models were failing with `getaddrinfo ENOTFOUND` whenever a reference image was uploaded.
- Fix: removed `uploadToFalStorage()` entirely. Reference image is now converted to a base64 data URL locally and passed directly in the `image_url` payload field. Fal.ai models accept data URLs — no storage upload needed.
- `server/routes/mediaGen.js` — replaced multipart upload function with `imageToDataUrl(buffer, mimetype)`.

### Open / next
- Test image-to-video and image-to-image models end-to-end with reference image after Railway redeploy.

**Further fix (same session):** fal.ai models silently ignore base64 data URLs in `image_url` — generate from prompt only, image is discarded. Real fix: upload reference image to S3 via existing `StorageService`, pass 1-hour pre-signed URL. Fal.ai fetches it normally over HTTPS. Requires `AWS_S3_BUCKET` configured (env or Admin › Storage). `getImageUrl()` replaces `uploadToFalStorage()` and `imageToDataUrl()`. Commit `e45c3d2`.

---

## 2026-04-23 — Geo Heatmap: geographic lead intelligence map for DiamondPlate Data

### Built

**Geo Heatmap — new tab in DiamondPlate Data**
- New `geo-heatmap` agent (`server/agents/geoHeatmap/index.js`) — pre-fetch pattern (1 Claude call, `maxIterations: 1`).
- Fetches up to 3000 CRM enquiries via `wp_get_enquiries`; buckets into `notInterested` (reason_not_interested set) vs `active` (all other statuses).
- Geocodes unique suburb/postcode pairs via Nominatim (`nominatim.openstreetmap.org`) with 1 req/sec rate limiting.
- Geocode results cached in new `geocode_cache` table (idempotent migration in `db.js`). First run geocodes everything; subsequent runs serve from cache (near-instant).
- Returns `{ summary, data: { locations, notInterestedTotal, activeTotal, geocodedCount, skippedCount } }`.
- `server/agents/geoHeatmap/prompt.js` — geographic analysis prompt with `buildSystemPrompt(config)` / custom_prompt support.
- Route registered in `agents.js` as `/geo-heatmap`, `requiredPermission: 'org_member'`.
- `AgentConfigService.js`: AGENT_DEFAULTS, ADMIN_DEFAULTS (`max_tokens: 2048`, `max_task_budget_aud: 0.50`), AGENT_MODEL_REQUIREMENTS (standard tier).

**Geo Heatmap — client UI (`GeoHeatmapTab.jsx`)**
- New `client/src/pages/tools/DiamondPlate/GeoHeatmapTab.jsx` — Leaflet map with CircleMarkers.
- Packages: `leaflet@^1.9.4` + `react-leaflet@^5.0.0` (installed with `--legacy-peer-deps`).
- Toggle between Not Interested (red) / Active Leads (green) datasets. Marker radius = log-scaled by count (4–20px).
- Summary pills: totals + geocoded count. MapContainer centred on Australia (`-27, 133.8`, zoom 4).
- Tooltip per marker: suburb + postcode + count.
- AI observations rendered below map via `MarkdownRenderer`.
- Auto-loads most recent completed run on mount.
- New **Geo Map** tab added to `DiamondPlateDataPage.jsx` between Search Terms and Conversation.

### Open / next
- Ads Setup Architect: model resolution fix; AU market + negative keyword risk prompt; MCP Prompts wiring (separate entry below)

---

## 2026-04-23 — Ads Setup Architect: model resolution fix; AU market + negative keyword risk prompt; MCP Prompts wiring

### Fixed

**Model resolution bug — `index.js` ignored `context.adminConfig`**
- `index.js` was calling `AgentConfigService.getAdminConfig(TOOL_SLUG)` directly, bypassing the `context.adminConfig` that `createAgentRoute` already resolved (including org default fallback).
- Org default model was never applied. UI model selector was silently ignored (body.model never read).
- Fix: `adminConfig` now uses `context.adminConfig` when populated (canonical pattern); falls back to direct fetch only for scheduled runs. `model` resolves: `req.body.model` → `adminConfig.model` → `'claude-sonnet-4-6'`.
- `maxIterations` fallback corrected: 15 → 20 to match `AgentConfigService` registered default.

### Built

**Ads Setup Architect — Australian Market Constraint (prompt)**
- New `## Australian Market Constraint (CRITICAL)` section in `prompt.js`.
- AU ceramic/graphene search pool is niche and thin — keyword bloat dilutes signal and splits budget. Exact/Phrase match preferred over Broad. Every keyword recommendation must be backed by AU volume from `ads_generate_keyword_ideas`; zero/negligible volume = do not recommend.

**Ads Setup Architect — Negative Keyword Risk (prompt)**
- New `## Negative Keyword Risk (CRITICAL)` section in `prompt.js`.
- Documents the historical account lesson: a keyword added to the shared negative list caused ~50% traffic loss and significant CPC rise; performance did not fully recover on removal — weeks of re-learning.
- Rules baked in: cross-reference `ads_get_search_terms` before any negative recommendation; prefer campaign-level negatives over shared list; mandatory risk flag per recommendation.
- Operational Step 5 now explicitly calls `ads_get_search_terms` before the negative keyword section.
- New output section `### 6. Negative Keyword Recommendations (with risk flags)` — Term | Scope | Rationale | Risk Assessment per row.

**Ads Setup Architect — MCP Prompts support**
- `prompt.js` refactored: `buildSystemPrompt(config = {})` checks `config.custom_prompt?.trim()` — if set, uses Admin override; else uses built-in default. Exports `DEFAULT_PROMPT` for preview endpoint.
- `index.js` passes `adminConfig` to `buildSystemPrompt(adminConfig)`.
- `ads-setup-architect` registered in `AdminPromptsPage.jsx` AGENTS array — now visible and editable in Admin › MCP Prompts.

### Open / next
- Implement **Profitability Oracle (True ROAS)** agent within the suite.
- Develop **Radius Clustering** bidder using newly available postcode signals.
- Run first Ads Setup Architect blueprint against live AU competitors.
- MCP-SERVERS.md google-ads.js header says 11 tools but `server/CLAUDE.md` lists 15 — 4 undocumented tools pending full MCP-SERVERS.md entry: `ads_get_ad_group_performance`, `ads_get_search_terms_by_ad_group`, `ads_get_quality_scores`, `ads_get_negative_keywords`.

---

## 2026-04-23 — Profitability Suite: Ads Setup Architect; Live Verification Mandate; Model Selection UI

### Built

**Profitability Suite — Siloed Architecture**
- Created `server/agents/profitabilitySuite/` and `client/src/pages/profitabilitySuite/` directory silos.
- Purpose: high-level strategic Business Intelligence tools separate from daily monitoring.

**Ads Setup Architect Agent (`ads-setup-architect`)**
- Strategic agent that designs Google Ads structures (Campaigns, Ad Groups, Keywords, RSA Copy).
- Sequential tool chain: Competitor discovery → Keyword brainstorming → Live ad verification → CRM theme analysis → KB differentiator search.
- Hardcoded brand guardrails: 12-year warranty, CSIRO-tested formula, 9H+ hardness, pricing from $790/$990.
- Registered in `agents.js` and `AgentConfigService.js` (`max_iterations: 20`, `max_task_budget_aud: 3.00`).

**Live Verification Mandate (CRITICAL)**
- New `ads_get_ad_group_ads` and `ads_get_ad_asset_performance` tools added to `google-ads.js` MCP server.
- Mandatory verify instruction added to system prompts for **Ads Setup Architect** and **Conversation** agents.
- Logic: AI must call live tools to verify headlines/descriptions before confirming edits or proposing new ones; distinguishes from stale KB reports.

**Ads Setup Architect UI**
- Four-tab layout: Report / Conversation / History / Settings.
- **Discussion View:** Integrated `ConversationView` with "Discuss this report" seeder button.
- **Model Settings:** Dynamic dropdown for model selection defaulting to Org Default.
- **Expert Guidance:** "Pros & Cons" panels for Sonnet, Opus, GPT-4o, and Gemini based on strategic architecture performance.
- SSE progress logging with "Architecting..." state.
- TXT/PDF export for blueprints.

**WordPress CRM Enhancement — Geographic Data**
- `wp_get_enquiries` and `wp_get_enquiry_details` updated to include **postcode** and **suburb** ACF fields.
- Enables geographic clustering/radius analysis for the Australian market.

### Fixed / discovered
- `ads_get_ad_group_ads` return shape updated in `MCP-SERVERS.md` to reflect RSA nested structure.
- Resolved race condition in `AdsSetupArchitectPage` where model state initialized before admin config loaded.

### Open / next
- Implement **Profitability Oracle (True ROAS)** agent within the suite.
- Develop **Radius Clustering** bidder using newly available postcode signals.
- Run first Ads Setup Architect blueprint against live AU competitors.

---

## 2026-04-23 — Not Interested Report: negative keyword coverage analysis; AI session token savings

### Built

**Not Interested Report — negative keyword coverage**
- `ads_get_negative_keywords` added to Phase 2 parallel fetch in `notInterestedReport/index.js` — runs alongside existing 4 calls, zero extra latency
- Returns `{ sharedLists: { [listName]: [{ text, matchType }] }, campaignNegatives: [{ campaign, text, matchType }] }` — shared library lists + per-campaign negatives
- Graceful fallback: if MCP call errors, passes `{ sharedLists: {}, campaignNegatives: [] }` so Claude gets an explicit empty signal rather than crashing
- Prompt expanded from 2 questions → 3: new Q2 teaches Claude the data shape and asks for named gaps, not generic advice
- New `### Negative Keyword Coverage` output section: what's already blocked (by list name) + exact terms/patterns to add
- `### Where to act` expanded to 3 paragraphs: campaigns/match types · exact negative terms to add + shared vs campaign-specific · sales qualification
- Two new constraints: inference is indicative not definitive; empty negative lists → state it explicitly as the structural cause

**AI session token optimisation — memory and doc cleanup**
- `project_scaffold.md` memory deleted — 488 lines, 16 days stale, conflicted with `CLAUDE.md` (9 vs 15 google-ads tools). All content superseded by `CLAUDE.md`
- `feedback_read_docs_first.md` rewritten — mandatory reads now scoped by task type; `mcp_curamtools_prompts.md` explicitly excluded (historical setup prompts only); `DECISIONS.md` + `PLATFORM-PRIMITIVES.md` only required for new agents/platform primitives
- `server/CLAUDE.md` 985→925 lines — duplicate Data Privacy + CRM field exclusions sections removed (68 lines); unique info (API endpoints, bypass note, do-not list) merged into the first section
- Net saving: ~1,000+ tokens per session from eliminated mandatory reads; ~600 tokens from scaffold memory; ~90 tokens from CLAUDE.md dedup

### Fixed / discovered
- Nothing broken

### Open / next
- Run Not Interested Report to validate negative keyword data shape in live output
- Consider whether `wp_get_enquiry_details` should be added to fetch extended fields for wrong-products leads (package_type, final_value)

---

## 2026-04-22 — SQL Console NLP: multi-provider model routing; configurable prompt; reasoning model support

### Built

**SQL Console NLP — full multi-provider model routing (7-attempt fix)**

Root cause chain that took 7 attempts to fully resolve:
1. Route called `new Anthropic()` directly → fixed to `getProvider()`
2. `getDefaultModel()` ignored org default when not in `ai_models` → fixed fallback return
3. `getProvider()` called without `customProviders` → added `getCustomProviders(orgId)` load
4. Frontend `useEffect` fell back to first Claude model when org default not in `ai_models` → fixed initialization to use org default as-is
5. `AdminModelsPage.jsx` `<select>` restricted to `ai_models` silently overrode org default → changed to `<input list>` + `<datalist>`
6. Answer generation step still hardcoded to `claude-haiku-4-5-20251001` → fixed to use same `provider` + `modelDef.id`, wrapped in `try/catch`
7. `deepseek-reasoner` returned empty `content` (reasoning-only response) → `openai-compatible.js` `reasoning_content` fallback

**`server/platform/providers/openai-compatible.js` — reasoning model fix**
- `convertResponse` had truthy-check bug: `if (msg?.content)` silently dropped empty-string content
- Fixed: explicit `!= null && !== ''` check; falls back to `msg?.reasoning_content` if content is null/empty
- Affects all OpenAI-compatible providers: deepseek, openai, groq, mistral, xai
- `deepseek-reasoner` uses chain-of-thought — sometimes returns `content: null` with full answer in `reasoning_content`

**SQL Console NLP — schema context and cannotAnswer path**
- `max_tokens` bumped to 8192 (reasoning models use tokens for internal chain-of-thought before producing SQL)
- Prompt now explains this is platform admin DB only — WordPress CRM data (enquiries, leads) is NOT here
- If model cannot answer from schema: returns `-- CANNOT_ANSWER: <reason>` comment
- Route detects the pattern, returns `{ cannotAnswer: true, reason }` (HTTP 200, not error)
- Frontend: amber warning banner with "Use the Conversation Agent" guidance; error banner suppressed

**SQL NLP prompt — configurable via Admin › MCP Prompts**
- New `server/agents/sqlNlp/prompt.js` — `buildSystemPrompt(config)` returns `custom_prompt` if set, else built-in instructions
- `preview-prompt` endpoint picks it up automatically via kebab→camelCase slug convention (`sql-nlp` → `sqlNlp`)
- Route loads `AgentConfigService.getAdminConfig('sql-nlp')` and calls `buildSystemPrompt(config)` — schema + question always appended at runtime
- `sql-nlp` added to `AGENTS` array in `AdminPromptsPage.jsx` — now visible and editable in Admin › MCP Prompts

**`AdminModelsPage.jsx` — org default model field**
- Changed from `<select>` (restricted to `ai_models`) to `<input list>` + `<datalist>`
- Allows typing any model ID (e.g. `deepseek-reasoner`, `gpt-4o`) not present in `ai_models`
- Documented in `server/CLAUDE.md` as required pattern for org default model selector

**`docExtractor` — `customProviders` threading**
- `extractFromImage` and `runDocExtraction` both accept `customProviders = []`
- Route loads `getCustomProviders(orgId)` and passes through the call chain
- `getProvider(model, customProviders)` — never single-arg in a route context

**`server/CLAUDE.md` — model resolution documented**
- "Model resolution — server side" section: `createAgentRoute` pattern, non-agent routes pattern, helper-function agent pattern
- "Model selector — frontend pattern" section: `<input list>` rule, initialization rule, fallback option rule
- Two "Rules learned through pain" entries: `<select>`/`ai_models` silent override trap; single-arg `getProvider` trap

### Fixed / discovered

- `ai_models` is a display list, NOT the routing list. `providerRegistry.PROVIDERS` handles routing via hardcoded prefixes. A model routes correctly without being in `ai_models`. Any selector restricted to `ai_models` silently overrides custom org defaults.
- JS default parameters do not fire when the argument is `null` — only `undefined`. `adminConfig.max_tokens ?? 4096` is always correct; bare `adminConfig.max_tokens` passes `null` through.
- `deepseek-reasoner` with `max_tokens: 1024` exhausted the budget mid-reasoning — output was truncated to prose instead of SQL. 8192 gives sufficient headroom.
- Platform SQL console queries the **platform PostgreSQL DB** (organisations, users, agents, usage_logs, system_settings). WordPress CRM (enquiries, leads, bqq_posts) is MySQL-only, accessible via conversation agent MCP tools.

### Open / next

- `docExtractor` `logUsage` still passes `{ input, output }` only — should pass full `tokensUsed` with `cacheRead`/`cacheWrite`
- Gemini URL double-prefix bug in `providers/gemini.js` (stub — throws until implemented)
- `purpose` field not injected into doc extraction prompt (noted in CLAUDE.md as known gap)
- Phase 2.1 — tool grouping + cross-source routing guidance
- Phase 2.2 — resource permissions wired to access checks
- Phase 3.1 — MCP Prompts Primitive
- Phase 3.2 — Sampling implementation
- Phase 4.1 — parallel tool execution in AgentOrchestrator
- `not-interested-report` not yet run against live data

---

## 2026-04-21 — Token usage dashboard; UsageLogger cache token capture; caveman mode

### Built

**Token usage tracking — full pipeline**
- `usage_logs` extended: 3 new columns via idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` in `db.js` — `cache_read_tokens INTEGER DEFAULT 0`, `cache_creation_tokens INTEGER DEFAULT 0`, `cost_aud NUMERIC(10,6) DEFAULT 0`
- `UsageLogger.js` updated to persist all 4 token types (`input`, `output`, `cacheRead`, `cacheWrite` from `AgentOrchestrator.tokensUsed`) plus direct AUD cost — no change to callers in `createAgentRoute.js` or `conversation.js`
- `GET /admin/usage-stats?days=7|30|90` — new endpoint in `routes/admin.js`; returns: totals (runs, all token types, cost AUD, cache hit rate, estimated cache savings AUD), `by_model[]`, `by_tool[]`, `daily[]`. Cache savings estimated as `cache_read_tokens × ($3.00 − $0.30) / 1M × AUD_PER_USD`

**Admin › Token Usage page**
- `AdminUsagePage.jsx` — 4 summary cards (total cost AUD, total tokens, cache hit rate, est. savings), CSS bar chart for daily cost trend, by-model table, by-agent/tool table
- Period selector: 7d / 30d / 90d tab strip — re-fetches on change
- No new npm dependencies — pure CSS bars using `var(--color-primary)` and `var(--color-border)`
- Wired in `App.jsx` (`/admin/usage`) and `Sidebar.jsx` (between Diagnostics and Logs, `trending-up` icon, label "Token Usage")

**AI session setup — Caveman mode**
- This session used the **caveman Claude Code plugin** (full mode) — drops articles/filler, keeps all technical substance, ~75% token reduction
- Activate at session start: plugin auto-activates via `UserPromptSubmit` hook in `settings.json`
- Status badge in Claude Code statusline shows `[CAVEMAN]` when active
- To disable: type `stop caveman` or `normal mode` in the prompt

### Fixed / discovered
- Historical `usage_logs` rows will show `0` for cache token columns and `cost_aud` — only runs after this deployment are fully populated. `cost_usd` is the reliable historical cost field.
- `logUsage` already received `cacheRead`/`cacheWrite` in `tokensUsed` from the orchestrator — they were captured but never stored. No orchestrator changes needed.

### Open / next
- `docExtractor` route calls `logUsage` with `{ input, output }` only — should pass full `tokensUsed` object (noted in 2026-04-18 open items too)
- `usage_logs` `cost_usd` column is now redundant with `cost_aud` — could be cleaned up later, but harmless to keep
- Daily chart timezone is hardcoded to `Australia/Brisbane` — acceptable for single-org deployment

---

## 2026-04-21 — Token usage warnings; proactive cost and health alerts on usage page

### Built

**`GET /admin/usage-warnings` endpoint**
- 8 parallel queries, 6 independent warning checks, returns `{ warnings: [{ type, severity, title, detail }] }`
- Severity levels: `critical` (red), `warning` (amber), `info` (blue)

| Check | Logic | Severity |
|---|---|---|
| Budget pace | 7-day avg daily spend ≥ 80% / 100% of `max_daily_org_budget_aud` | warning / critical |
| Agent over budget | Per-slug avg run cost ≥ 90% of agent's `max_task_budget_aud` (from `getAdminConfig`) | warning / critical |
| Cache health | Cache hit rate < 15% over last 7 days (min 5 runs to avoid noise) | warning |
| Cost spike | Yesterday's spend > 2.5× 30-day daily average | warning |
| Stale agents | Ran in last 14 days but not last 3 days | info |
| Overkill model | Model tier > agent's declared tier in `AGENT_MODEL_REQUIREMENTS` | info |

- Agent over budget uses `Promise.all` across unique slugs — N parallel `getAdminConfig` calls, not N sequential
- Overkill model check uses `ai_models` from `system_settings` (with `MODEL_DEFAULTS` fallback) for model tier lookup; cross-referenced against `AGENT_MODEL_REQUIREMENTS` exported from `AgentConfigService`

**`AdminUsagePage.jsx` — warnings display**
- Both `usage-stats` and `usage-warnings` fetched in a single `Promise.all` on load and period change
- Colour-coded banners rendered above stat cards: red (critical), amber (warning), blue (info)
- Non-dismissable — persist until the underlying condition clears

### Fixed / discovered
- Budget pace warning skipped when `max_daily_org_budget_aud` is `null` (unlimited) — no false positives for orgs without a budget set
- Stale agent check uses 14-day look-back (not 30-day) to avoid flagging agents that are intentionally infrequent

### Open / next
- All open items from prior session carry forward
- Budget pace warning has no monthly projection — only compares against daily limit; a `max_monthly_budget_aud` field would enable richer projection (not yet in schema)

---

## 2026-04-21 — Prompt cache keep-warm; ConversationView 270s interval

### Built

**`POST /api/conversation/keep-warm`** (`routes/conversation.js`)
- Loads the same `agentConfig` + `adminConfig` as a real conversation turn
- Builds system prompt via `buildSystemPrompt(agentConfig, monitorConfig)` — exact same token sequence
- Strips `execute`/`requiredPermissions`/`toolSlug`/`cacheable` from tools (mirrors `AgentOrchestrator`)
- Calls `provider.chat({ max_tokens: 1, system, tools, messages: [{ role: 'user', content: 'ping' }] })`
- `anthropic.js` provider adds `cache_control: { type: 'ephemeral' }` to system prompt and last tool automatically — cache key matches real calls exactly
- Returns `{ ok, cacheRead, cacheWrite }`, logs to console, **not** written to `usage_logs`
- Cost per ping: ~$0.002 AUD (cache read); ~$0.025 AUD on first call (cache write)

**`ConversationView.jsx` — keep-warm interval**
- `useEffect` with empty deps: `setInterval(270_000)` fires every 4.5 min while view is mounted
- Calls `api.post('/conversation/keep-warm', {})` — silent failure (`.catch(() => {})`)
- `clearInterval` on unmount — stops when user navigates away

**Documentation**
- `setup.md` — new "Prompt Cache Keep-Warm" section: cost breakdown, what's cached, pattern for new agents
- `server/CLAUDE.md` — keep-warm note added to prompt caching section

### Fixed / discovered
- Cache key depends on exact token sequence — keep-warm MUST use same `buildSystemPrompt()` call, same tools array, same `cache_control` placement. Anything different = separate cache entry = no benefit.
- `POST /keep-warm` placed after all `POST /:id/*` routes — no Express route conflict (different literal paths)

### Open / next
- Keep-warm only covers the conversation agent — other agents with ReAct loops (high-intent-advisor) could benefit but are not frequently used interactively

---

## 2026-04-21 — Claude Sessions page; 5-hour and weekly usage window gauges

### Built

**`/admin/claude-sessions`** — new admin page ("Claude Sessions", clock icon in sidebar)
- Two SVG donut gauges, purely client-side time math, auto-refresh every 30s
- **5-hour wheel**: `(now − daily_start_time) / 300min` → shows minutes remaining + reset time (e.g. "42m remaining · Resets at 11:00am")
- **Weekly wheel**: ISO week progress Mon→Sun → shows day N of 7 + days remaining
- Gauge colours: green < 65%, amber 65–85%, red > 85%
- Info cards explain 5-hour vs weekly cap mechanics; `/usage` terminal command referenced

**Settings**
- Configurable daily start time (time picker, default 06:00)
- Stored in `system_settings` key `claude_session_config` — `{ daily_start: 'HH:MM' }`
- Changing the time picker updates gauges live before saving
- `GET/PUT /admin/claude-session-config` routes in `admin.js`

**Timezone removed**
- `timezone` field was added to config then removed — browser `new Date()` already uses local time; explicit timezone config was unused and misleading

### Fixed / discovered
- Gauges are 100% client-side — no server involvement at runtime. Server only stores the configured start time.
- Weekly gauge uses ISO week (Mon = day 1). Anthropic's actual weekly reset day is unknown — this is a reasonable approximation.

### Fixed / discovered (follow-up)
- **Window chaining bug** — original implementation only tracked the first 5-hour window of the day. After 11am the gauge showed 100% and stayed there. Fixed: `Math.floor(elapsed / windowMs)` finds the current window index; windows chain indefinitely (6am→11am→4pm→9pm→…). At 6:15pm with 6am start: window 3, 4pm→9pm, 45% used, "2h 45m remaining".
- `fmt12()` refactored to accept a `Date` object (avoids manual hour arithmetic that broke across midnight)
- `fmtDuration()` helper added — shows `2h 45m` for durations ≥ 60 min instead of `165m`

### Open / next
- Actual Claude Code weekly reset day may not align with Monday — configurable via settings (see follow-up entry below)

---

## 2026-04-21 — Claude Sessions: configurable weekly reset day

### Built

**Configurable `weekly_start_day`** — Claude Sessions page
- `CLAUDE_SESSION_DEFAULTS` in `admin.js` updated: `{ daily_start: '06:00', weekly_start_day: 1 }` (1 = Monday)
- PUT route validates `weekly_start_day` is a number (0–6) when present
- `computeWindows(cfg)` refactored: accepts full config object `{ daily_start, weekly_start_day }` — previously accepted a bare string which broke the weekly day lookup
- `AdminClaudeSessionPage.jsx` updated:
  - `weeklyDay` state (default 1) populated from loaded config
  - `livePreview(start, day)` helper — updates gauges immediately on any input change
  - Day-of-week `<select>` dropdown added to settings form (Sun–Sat, 0–6)
  - Save payload now includes `weekly_start_day`
  - All `computeWindows` call sites pass full config object

### Fixed / discovered
- `parseHHMM` was receiving the full config object instead of the time string after the signature change — fixed by extracting `cfg.daily_start` inside `computeWindows` before calling `parseHHMM`

### Open / next
- All prior open items carry forward

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
