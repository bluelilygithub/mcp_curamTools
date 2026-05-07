# Agents Index

This file catalogs all agents in the MCP CuramTools platform.

---

## google-ads-monitor

| Property | Value |
|---|---|
| Slug | `google-ads-monitor` |
| Type | Scheduled + Manual |
| Permission | `org_admin` |
| Schedule | Daily (configurable) |
| Tools | google-ads (11), google-analytics (5), wordpress (5) |
| Location | `server/agents/googleAdsMonitor/` |

**Purpose:** Daily Google Ads performance monitoring with cross-source reconciliation. Runs per-customer (multi-customer support via `runFn` returning array).

**Key files:** `index.js`, `prompt.js`, `tools.js`

---

## conversation-agent

| Property | Value |
|---|---|
| Slug | `conversation-agent` |
| Type | Interactive |
| Permission | `org_member` |
| Schedule | None |
| Tools | google-ads (11), google-analytics (5), wordpress (5), platform (4), knowledge-base (2) |
| Location | `server/agents/conversation/` |

**Purpose:** Interactive Q&A agent with multi-turn conversation, tool result caching, and prompt cache keep-warm.

**Key files:** `index.js`, `prompt.js`, `tools.js`, `routes/conversation.js`

---

## ads-setup-architect

| Slug | `ads-setup-architect` |
|---|---|
| Type | Manual |
| Permission | `org_admin` |
| Schedule | None |
| Tools | google-ads (4), wordpress (1), knowledge-base (1), plus `get_competitor_settings` |
| Location | `server/agents/adsSetupArchitect/` |

**Purpose:** Google Ads account setup and configuration recommendations.

**Key files:** `index.js`, `prompt.js`, `tools.js`

---

## high-intent-advisor

| Slug | `high-intent-advisor` |
|---|---|
| Type | Scheduled + Manual |
| Permission | `org_admin` |
| Schedule | Weekly (configurable) |
| Tools | google-ads (5), wordpress (3), platform (3) |
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

## demo-document-analyzer

| Slug | `demo-document-analyzer` |
|---|---|
| Type | Manual (demo) |
| Permission | `org_member` |
| Schedule | None |
| Tools | None (two-stage analysis) |
| Location | `server/agents/demoSuite/documentAnalyzer.js` |

**Purpose:** Demo agent for Curam Engineering. Two-stage document analysis (deterministic + AI) with HITL review, compliance certificate, and S3 save.

**Key files:** `documentAnalyzer.js` (single file)

---

## Agent Architecture Patterns

### Pre-fetch Pattern
Used by: `wp-theme-extractor`
- Agent fetches external data before calling Claude
- No ReAct loop (`maxIterations: 1`, `tools: []`)
- Claude returns JSON, agent parses and shapes the result

### ReAct Pattern
Used by: `google-ads-monitor`, `conversation-agent`, `ads-setup-architect`, `high-intent-advisor`
- Agent calls Claude with tool definitions
- Claude decides which tools to call and when
- `agentOrchestrator.run()` handles the loop

### Two-Stage Pattern
Used by: `demo-document-analyzer`
- Stage 1: Deterministic rules run in Node.js
- Stage 2: Claude probabilistic analysis
- Cross-stage overlap detection
- HITL review flow
