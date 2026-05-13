# Agents Index

This file catalogs agents **registered for SSE runs** in `server/routes/agents.js`, the **interactive conversation** stack in `server/routes/conversation.js`, and **demo catalog** entries in `server/demo/demoCatalog.js`. Authoritative wiring is always the source files; this index can lag — update it when you add a notable agent.

**Demo catalog only:** `web-intelligence` and `conversation-assistant` appear in `DEMO_CATALOG` but do not yet have matching `createAgentRoute` registrations in `agents.js` (placeholders for future demo pages).

---

## google-ads-monitor

| Property | Value |
|---|---|
| Slug | `google-ads-monitor` |
| Type | Scheduled + Manual |
| Permission | `ads_operator` |
| Schedule | Daily (configurable) — see `CRON.md` |
| Tools | MCP-backed Google Ads, GA4, WordPress, etc. — **verify current tool list in `MCP-SERVERS.md` / `server/CLAUDE.md`** |
| Location | `server/agents/googleAdsMonitor/` |

**Purpose:** Daily Google Ads performance monitoring with cross-source reconciliation. Runs per-customer (multi-customer support via `runFn` returning array).

**Key files:** `index.js`, `prompt.js`, `tools.js`

---

## google-ads-conversation (interactive)

| Property | Value |
|---|---|
| Slug | `google-ads-conversation` |
| Type | Interactive (multi-turn; not mounted on `agentsRouter` — see `routes/conversation.js`) |
| Permission | Authenticated users (`requireAuth` on `/api/conversation`; see `routes/conversation.js`) |
| Schedule | None |
| Tools | MCP-backed — **verify exported array in `server/agents/googleAdsConversation/tools.js`** (counts in docs disagree; treat code as source of truth) |
| Location | `server/agents/googleAdsConversation/` |

**Purpose:** Interactive Q&A with tool use, session-scoped tool cache, Anthropic prompt cache keep-warm.

**Key files:** `index.js`, `prompt.js`, `tools.js`, `routes/conversation.js`

---

## ads-setup-architect

| Slug | `ads-setup-architect` |
|---|---|
| Type | Manual |
| Permission | `ads_operator` |
| Schedule | None |
| Tools | See `MCP-SERVERS.md` — Ads Setup Architect section |
| Location | `server/agents/profitabilitySuite/adsSetupArchitect/` |

**Purpose:** Google Ads account setup and configuration recommendations.

**Key files:** `index.js`, `prompt.js`, `tools.js`

---

## high-intent-advisor

| Slug | `high-intent-advisor` |
|---|---|
| Type | Manual (scheduled cron **deferred** — see `CRON.md`) |
| Permission | `ads_operator` |
| Schedule | None until registered |
| Tools | google-ads, wordpress, platform (suggestion lifecycle) |
| Location | `server/agents/highIntentAdvisor/` |

**Purpose:** Identifies high-intent leads from CRM and suggests follow-up actions.

**Key files:** `index.js`, `prompt.js`, `tools.js`

---

## wp-theme-extractor

| Slug | `wp-theme-extractor` |
|---|---|
| Type | Manual |
| Permission | `org_member` |
| Schedule | None |
| Tools | None (pre-fetch pattern) |
| Location | `server/agents/wpThemeExtractor/` |

**Purpose:** Fetches a URL, sends HTML to Claude, generates a WordPress theme skeleton (9 files).

**Key files:** `index.js`, `prompt.js`

---

## ai-visibility-monitor

| Slug | `ai-visibility-monitor` |
|---|---|
| Type | Scheduled + Manual |
| Permission | `org_member` |
| Schedule | Weekly UTC — see `CRON.md` |
| Tools | Anthropic native web search + analysis (see agent implementation) |
| Location | `server/agents/aiVisibilityMonitor/` |

**Purpose:** Geo-targeted visibility monitoring across the web with a single analysis pass.

**Key files:** `index.js`, `prompt.js`, `tools.js` (if present)

---

## demo-document-analyzer

| Slug | `demo-document-analyzer` |
|---|---|
| Type | Manual (demo) |
| Permission | `org_member` |
| Schedule | None |
| Tools | None (vision extraction + deterministic rules + synthesis; no MCP ReAct loop) |
| Location | `server/agents/demoSuite/documentAnalyzer.js` |

**Purpose:** Demo agent for external demo orgs. **Two-model** pipeline: vision extraction (`adminConfig.model`) → deterministic rules on extracted text → synthesis (`getOrgDefaultModel` / admin model). HITL review, compliance certificate, optional S3 save.

**Key files:** `documentAnalyzer.js` (single file)

---

## spec-validator (internal + demo)

| Slug | `spec-validator` (internal), `demo-spec-validator` (demo) |
|---|---|
| Type | Manual |
| Permission | `org_member` |
| Schedule | None |
| Tools | None — **three-stage pipeline:** vision extraction → Python `calculator.py` (deterministic hydraulics) → synthesis |
| Location | `server/agents/specValidator/` |

**Purpose:** Validates quantitative claims in hydraulic calculation PDFs; PASS/FAIL/WARNING from Python; HITL and certificate gate on `client/src/pages/demo/SpecValidator.jsx`.

**Key files:** `index.js`, `calculator.py`, `prompt.js`

---

## demo-tender-response

| Slug | `demo-tender-response` |
|---|---|
| Type | Manual (demo) |
| Permission | `org_member` |
| Schedule | None |
| Tools | None — **four-stage pipeline:** sanitise → vision RFT requirement extraction → S3 evidence + `compliance.py` matching → synthesis drafts per requirement |
| Location | `server/agents/demoSuite/tenderResponse/` |

**Purpose:** Tender / RFT response drafting demo with deterministic compliance matching and per-requirement HITL (including `edited` state — see root `DECISIONS.md`).

**Key files:** `index.js`, `compliance.py`, `prompt.js`

---

## Other registered tool agents (summary)

All use `createAgentRoute` in `server/routes/agents.js` unless noted. Permission is typically `ads_operator` for Ads-suite tools and `org_member` where specified — **confirm in `agents.js`**.

| Slug | Agent folder |
|---|---|
| `google-ads-freeform` | `server/agents/googleAdsFreeform/` |
| `google-ads-change-impact` | `server/agents/googleAdsChangeImpact/` |
| `google-ads-change-audit` | `server/agents/googleAdsChangeAudit/` |
| `ads-bounce-analysis` | `server/agents/adsBounceAnalysis/` |
| `auction-insights` | `server/agents/auctionInsights/` |
| `competitor-keyword-intel` | `server/agents/competitorKeywordIntel/` |
| `google-ads-strategic-review` | `server/agents/googleAdsStrategicReview/` |
| `keyword-opportunity` | `server/agents/keywordOpportunity/` |
| `ads-copy-gate` | `server/agents/adsCopyGate/` |
| `ads-copy-playbook` | `server/agents/adsCopyPlaybook/` |
| `ads-copy-diagnostic` | `server/agents/adsCopyDiagnostic/` |
| `ads-attribution-summary` | `server/agents/adsAttributionSummary/` |
| `diamondplate-data` | `server/agents/diamondplateData/` |
| `search-term-intelligence` | `server/agents/searchTermIntelligence/` |
| `daypart-intelligence` | `server/agents/daypartIntelligence/` |
| `cost-per-booked-job` | `server/agents/costPerBookedJob/` |
| `lead-velocity` | `server/agents/leadVelocity/` |
| `not-interested-report` | `server/agents/notInterestedReport/` |
| `geo-heatmap` | `server/agents/geoHeatmap/` |

---

## Agent architecture patterns

### Pre-fetch pattern

Used by: `wp-theme-extractor`, most fixed-sequence Ads/CRM report agents (see `server/CLAUDE.md` — pre-fetch section).

- Data fetched in Node before the model call
- `maxIterations: 1`, `tools: []` for the main Claude pass

### ReAct pattern

Used by: `google-ads-conversation`

- Claude with MCP tool definitions; `AgentOrchestrator.run()` loop

### Two-model (vision / extraction → synthesis)

Used by: `demo-document-analyzer`, stages of `spec-validator` / `demo-spec-validator` (with Python between), `demo-tender-response` (with deterministic compliance between extraction and synthesis)

- Extraction/vision: `adminConfig.model` (must be vision-capable when reading PDFs/images)
- Synthesis: `getOrgDefaultModel(orgId) ?? adminConfig.model`
- **Never** hardcode model ID fallbacks — see `server/CLAUDE.md` and `DEMO-AGENTS.md`

### Three-stage (extract → deterministic code → synthesise)

Used by: `spec-validator`, `demo-spec-validator`

- Stage 2 must stay non-shell (`execFileAsync`, no `shell: true`)

### Four-stage (demo tender)

Used by: `demo-tender-response`

- Deterministic compliance in Python subprocess; HITL per requirement
