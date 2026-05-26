# CLAUDE.md — Agent development rules

**Stop. Before writing any agent file, complete these three steps:**

1. Read `server/agents/adsAttributionSummary/index.js` (canonical agent reference)
2. Read `server/platform/AgentConfigService.js` — find `AGENT_DEFAULTS` and `ADMIN_DEFAULTS`
3. State which platform primitives you will use from the table below

Do not create any files until step 3 is done.

---

## Platform primitives — use these, never reinvent

| Need | Use |
|---|---|
| Run agent (HTTP) | `createAgentRoute` |
| Run agent (cron) | `AgentScheduler.register` |
| Write run record | `persistRun` — via createAgentRoute or AgentScheduler only. No direct INSERT. |
| Read/write agent config | `AgentConfigService` — no direct table queries |
| Resolve model | `AgentConfigService.getResolvedAdminConfig(slug, orgId)` |
| Call Claude + tool loop | `AgentOrchestrator.run()` |
| Call MCP tool | `callMcpTool(context.orgId, server, toolName, args)` |
| Build system prompt | `buildSystemPrompt(config, customerVars)` in agent's `prompt.js` |
| Account context block | `buildAccountContext(config.intelligence_profile, slug)` |
| Substitute prompt vars | `substitutePromptVars(template, vars)` |

---

## Required files for every new agent

```
server/agents/<slug>/
  index.js    — exports run<Name>(context)
  tools.js    — exports { <name>Tools, TOOL_SLUG }
  prompt.js   — exports buildSystemPrompt(config, customerVars = {})
```

Then (in this order):
- Add `AGENT_DEFAULTS` entry in `AgentConfigService.js`
- Add `ADMIN_DEFAULTS` entry in `AgentConfigService.js`
- Add `AGENT_MODEL_REQUIREMENTS` entry if agent needs tool use, vision, JSON, or long context
- Add one entry to `server/agents/manifest.js` — never edit `routes/agents.js` for basic registration

---

## Hard rules — no exceptions

**No hardcoded model fallbacks.** Never `?? 'claude-sonnet-4-6'` or `|| 'deepseek-chat'`. Always `getResolvedAdminConfig`.

**No direct DB writes.** `agent_runs` via `persistRun` only. `agent_configs` via `AgentConfigService` only.

**Org ID from server.** Always `req.user.orgId`. Never `req.body.orgId` or `req.query.orgId`.

**Permissions.** `requirePermission('area:action')` — not `requireRole`. Format: `agents:run:<scope>`.

**Pre-fetch for fixed data.** If you can enumerate all tool calls before Claude runs, use pre-fetch (fetch in Node, pass to Claude in one message, `maxIterations: 1`, `tools: []`). ReAct loop only when data requirements are genuinely dynamic.

**Two-model pattern for multi-stage agents.** Extraction = `adminConfig.model`. Synthesis = `getOrgDefaultModel(orgId)`. Log both with `emit()` before each call. See `server/agents/specValidator/index.js`.

**Lessons coverage.** Add new agent to `LESSON_COVERAGE_SECTIONS` in `AdminLessonsPage.jsx`.

---

## Manifest entry shape

```js
{ slug: 'my-agent', module: './myAgent', export: 'runMyAgent', permission: 'agents:run:my-agent' }
// Optional:
// rateLimit: { max: 5, windowMs: 300_000 }
// schedule: '0 8 * * 1-5'  // document UTC↔AEST offset; update CRON.md
```

---

## Full reference

Root `CLAUDE.md` — platform rules and required steps  
`PLATFORM-PRIMITIVES.md` — full interface contracts  
`DECISIONS.md` — settled architectural decisions  
