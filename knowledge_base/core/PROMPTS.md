# MCP CuramTools — Claude Prompts Reference

**Project Context:** This is an internal learning project for one organisation, built and maintained by a solo developer. Read [PROJECT_IDENTITY.md](./PROJECT_IDENTITY.md) for the full context.

This file records the prompts used to set up and develop the MCP CuramTools project. Each prompt is dated and labeled with its purpose.

---

## Initial Project Setup Prompt

**Date**: 2026-03-29  
**Purpose**: Platform scaffold initialization — backend structure, database schema, frontend structure, architectural decisions  
**Context**: First session after completing Vault (single-user) and ToolsForge (multi-tenant) projects

### Key Decisions Made

- **Button component** exists (settled in SECTION-ANNOTATION.md)
- **Toast z-index**: `z-[9999]`
- **Corner radius**: `rounded-xl` buttons/inputs, `rounded-2xl` containers/modals
- **Modal dismiss**: backdrop + Escape + explicit × button
- **TopNav height**: 56px
- **Markdown renderer**: custom zero-dependency (no react-markdown)
- **Assistant message avatar**: none (multi-tenant workspace signal)
- **Transition duration**: `transitionDuration: { DEFAULT: '200ms' }` in tailwind.config.js
- **Focus ring**: `*:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }` globally
- **Tailwind config**: map CSS variables to utilities (bg-bg, text-primary, border-border etc.)

---

## Stage 1 — Multi-Server Discovery (2026-03-29)

**Purpose**: Implement the first of three foundational pillars — dynamic MCP server registry replacing hardcoded tool slugs.

**What was built:**
- `server/db.js` — added `mcp_servers` table (idempotent)
- `server/platform/mcpRegistry.js` — full registry primitive (singleton, EventEmitter)
- `server/index.js` — wired `MCPRegistry.disconnectAll()` to SIGTERM/SIGINT graceful shutdown

**Key decisions:**
- SSE transport implements the full MCP SSE spec: GET → `endpoint` event → POST URL for JSON-RPC
- Stdio transport sends MCP `initialize` handshake on connect
- `send()` validates `(org_id, serverId)` pair at call time — not just at `connect()`
- `UNIQUE(org_id, name)` on `mcp_servers` — re-registering updates rather than duplicates
- `is_active = FALSE` for soft-deregister — rows never hard-deleted

---

## Stage 2 — Resource-Level Permissions (2026-03-29)

**Purpose**: Implement granular access control at the MCP resource URI level.

**What was built:**
- `server/db.js` — `mcp_resources` + `resource_permissions` tables + two partial unique indexes
- `server/services/PermissionService.js` — `canAccessResource`, `grantResourcePermission`, `revokeResourcePermission`, `listResourcePermissions`
- `server/routes/adminMcp.js` — full CRUD for servers, resources, and permissions (11 routes)
- `server/index.js` — mounted `adminMcp.js` at `/api/admin`

**Key decisions:**
- `resource_uri` stored as TEXT (not FK) — permissions are security data; cascade deletes are dangerous
- Deny-wins resolution — any deny row overrides all allow rows; no matching row = implicit deny
- `user_id XOR role_name` enforced via CHECK constraint + partial unique indexes
- Route ordering: literal paths before parameterised paths in Express

---

## Stage 3 — Budget-Aware Circuit Breaker (2026-03-29)

**Purpose**: Per-run and daily org AUD cost guardrails enforced mid-execution and post-run.

**What was built:**
- `server/platform/AgentConfigService.js` — `max_task_budget_aud` in ADMIN_DEFAULTS; `getOrgBudgetSettings`, `updateOrgBudgetSettings`
- `server/services/CostGuardService.js` — `BudgetExceededError`, `computeCostAud`, `getDailyOrgSpendAud`, `check`
- `server/platform/createAgentRoute.js` — budget integration: pre-flight check, mid-run accumulation, post-run definitive check

**Key decisions:**
- `CostGuardService.check()` is pure + synchronous — no DB queries mid-stream
- Two guardrail layers: per-task (`max_task_budget_aud`) and daily org-wide (`max_daily_org_budget_aud`)
- `emit(text, partialTokensUsed)` — backwards-compatible opt-in mid-run enforcement
- `costAud` persisted in `agent_runs.result` JSONB
- Daily spend snapshot is intentionally stale for concurrent runs (soft ceiling)

---

## Stage 4 — Admin MCP UI Integration (2026-03-29)

**Purpose**: Build admin UI pages for MCP server management, resource registration, and permissions.

**What was built:**
- `client/src/pages/admin/AdminMcpServersPage.jsx` — register, connect/disconnect, delete MCP servers
- `client/src/pages/admin/AdminMcpResourcesPage.jsx` — two-section page: resources + permissions
- Routes: `/admin/mcp-servers` and `/admin/mcp-resources` in `App.jsx`
- Sidebar nav items in Admin section

---

## Agent System Prompt Conventions

All agent system prompts follow a consistent structure:

### Block Order
1. **Account Intelligence Profile block** (if profile is populated) — injected by `buildAccountContext`
2. **Role and analytical framework** — "You are a [role]..."
3. **Data sources and tool usage order** — numbered list of tool call order
4. **What to look for / analytical criteria** — config-injected thresholds
5. **Output format** — required section headers in order
6. **Baseline verification instruction** — last line always

### Required Output Sections
```markdown
### Summary
2–4 sentences.

### [Primary Analysis Section]
[Agent-specific analysis]

### [Secondary Analysis Section]
[Agent-specific analysis]

### Recommendations
Numbered list. Each recommendation must reference a specific entity.
```

### Config-Injected Thresholds Pattern
```js
function buildSystemPrompt(config = {}) {
  const ctrPct  = ((config.ctr_low_threshold ?? 0.03) * 100).toFixed(0);
  const wasted  = config.wasted_clicks_threshold ?? 5;
  // ...
}
```
