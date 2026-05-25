# CLAUDE.md — MCP CuramTools

## What this project is

Internal AI agent platform for one organisation (Blue Lily). Solo developer. Invite-only users. Not a SaaS, not a public product, not multi-tenant beyond a single org. Railway-hosted, single instance.

**Consequence:** Recommend proportionate solutions. No AWS Secrets Manager, no SOC2, no dedicated security team. Simple wins over complete.

---

## Read before writing any new agent or page

Before writing a new agent `index.js`, read:
- `server/agents/adsAttributionSummary/index.js` — canonical agent reference

Before writing a new frontend page, read:
- `client/src/pages/tools/DiamondPlateDataPage.jsx` — canonical page reference
- `client/src/api/client.js` — auth and response shape

These are not optional. Patterns that break without them: `api.get()` returns body directly (no wrapper); `api.stream()` requires Bearer token; history rows are `{ result: { summary } }` not `{ summary }`; `persistRun` status is `'complete'` not `'success'`.

---

## Platform rules — project guidance first

The following rules are project guardrails for all AI agents working in this repo. `.claude/settings.json` may be used for simple permissions and safe project configuration. Do not put long inline shell, PowerShell, or `node -e` hook commands in settings; Windows Defender may flag that execution pattern. If mechanical enforcement is needed later, use a named local script such as `scripts/check-project-rules.mjs` and call that script from a small hook.

**EmailService** — always `https.request`, never `fetch`. Silent MailChannels delivery failure on Railway with fetch. No visible error.

**Model fallbacks** — never `?? 'claude-sonnet-4-6'` or `|| 'deepseek-chat'` in agent code. Use `getResolvedAdminConfig(slug, orgId)`. Hardcoded fallbacks break multi-provider routing and create invisible cost surprises.

**Org ID** — always `req.user.orgId`. Never `req.body.orgId`, `req.query.orgId`, or any client-supplied value.

**agent_runs** — written only via `persistRun`. No direct INSERT from agent or route code.

**agent_configs** — read and written only via `AgentConfigService`. No direct table queries from agent or route code.

**MarkdownRenderer** — always `<MarkdownRenderer text={string} />`. Never `content=`. Never `<pre>` or `whitespace-pre-wrap` for LLM output.

**SpeechRecognition** — always `MicButton` + `useSpeechInput`. No direct `new SpeechRecognition()` on pages.

**wordpress.js MCP server** — always `pool.query()`, never `pool.execute()`. Prepared statement bug with LIMIT.

**WordPress LIMIT** — embed as integer string directly in SQL, not as a `?` placeholder.

---

## Golden-path smoke test

Run `npm test` from the repository root before treating any edit to these files as done:

- `server/services/markdownPdfBuffer.js`
- `server/routes/export.js`
- `server/platform/createAgentRoute.js`
- `server/platform/AgentScheduler.js`
- `server/platform/promptVersions.js`
- `server/agents/demoSuite/tenderResponse/index.js`

If a local Git hook is installed, it may run this automatically when these files are staged. During a session, run it manually before treating the work as done.

---

## Adding a new agent — required steps in order

1. Read `server/agents/adsAttributionSummary/index.js` first
2. Create `server/agents/<slug>/index.js` — exports `run<Name>(context)`
3. Create `server/agents/<slug>/tools.js` — exports `{ <name>Tools, TOOL_SLUG }`
4. Create `server/agents/<slug>/prompt.js` — exports `buildSystemPrompt(config, customerVars = {})`
5. Add `AGENT_DEFAULTS` entry in `AgentConfigService.js`
6. Add `ADMIN_DEFAULTS` entry in `AgentConfigService.js`
7. Add `AGENT_MODEL_REQUIREMENTS` capabilities if the agent requires tool use, vision, reliable JSON, or long context
8. Register in `server/routes/agents.js` via `createAgentRoute({ slug, runFn, requiredPermission })`
9. Add cron in `agents.js` via `AgentScheduler.register` if scheduled — document UTC↔AEST offset
10. Update `CRON.md` if scheduled
11. Create `client/src/pages/tools/<NamePage>.jsx`
12. Add route in `client/src/App.jsx`
13. Add entry in `client/src/config/tools.js`
14. Update `LESSON_COVERAGE_SECTIONS` in `AdminLessonsPage.jsx`

---

## Adding a new built-in MCP server — required steps

1. Create `server/mcp-servers/<name>.js` with `TOOLS`, `callTool`, and stdio JSON-RPC handlers.
2. Add the server to `server/mcp-servers/manifest.js`. This is what auto-registers built-in servers into `mcp_servers` on app startup.
3. Add any required env names to the manifest `requiredEnv` list. Do not rely on inherited full process env.
4. Add or update resolver helpers in `server/platform/mcpTools.js` if agents need to find the server by name.
5. Wire agent tools to call it with `callMcpTool(context.orgId, server, toolName, args)`.
6. Document tools and data shapes in `MCP-SERVERS.md`.

Do not depend on dropping a `.js` file into `server/mcp-servers/` alone. The app does not poll or auto-scan the folder; only manifest entries are bootstrapped.

---

## Platform primitives — use these, don't reinvent

| Need | Use |
|---|---|
| Run an agent (HTTP) | `createAgentRoute` |
| Run an agent (cron) | `AgentScheduler.register` |
| Write a run record | `persistRun` (via createAgentRoute or AgentScheduler only) |
| Read/write agent config | `AgentConfigService` |
| Resolve model for a run | `AgentConfigService.getResolvedAdminConfig(slug, orgId)` |
| Call Claude + tool loop | `AgentOrchestrator.run()` |
| Render LLM output | `MarkdownRenderer text={string}` |
| Voice input | `MicButton` + `useSpeechInput` |
| PDF export | `exportService.exportPdf` / `fetchPdfBlob` |
| Log token usage | `UsageLogger.logUsage` |
| Check permission (route) | `requirePermission('capability:name')` |
| Check permission (code) | `PermissionService.hasPermission(userId, 'capability:name')` |
| Build system prompt | `buildSystemPrompt(config, customerVars)` in agent's `prompt.js` |
| Account context block | `buildAccountContext(config.intelligence_profile, slug)` |
| Substitute prompt vars | `substitutePromptVars(template, vars)` |

---

## Multi-stage agents — two-model pattern

Every agent with extraction + synthesis stages must resolve and log two models:
- **Extraction model:** `adminConfig.model` — must be vision-capable if images are involved; throw if not set
- **Synthesis model:** `getOrgDefaultModel(orgId)`, falling back to `adminConfig.model`

Log both with `emit()` before each call and in `logger.complete()` metadata. No hardcoded model fallback at any stage.

---

## Prompt structure conventions

- System prompt injection order: account context block → role → data sources → analysis heuristics → output format → operator custom prompt block
- Use `substitutePromptVars(config.custom_prompt, customerVars)` before appending custom prompt
- Require GitHub-flavoured markdown in output: headings, bold, lists, tables — keeps PDF export and MarkdownRenderer aligned
- For structured JSON output: prompt for JSON only, strip markdown fences, find first `{` and last `}`, then `JSON.parse` that slice
- Place restriction instructions in both system prompt AND user message closing — system-only restrictions are overridden by some models

---

## Permissions — new routes and agents

New routes: `requirePermission('area:action')` not `requireRole(['org_admin'])`.
New agents: prefer capability names like `'agents:run:reports'` over legacy role names.
`org_admin` always satisfies any permission check automatically.

Capability naming format: `area:action` or `area:action:scope`. Examples: `agents:run:ads`, `lessons:manage`, `mcp:manage`.

---

## Changelog

Every session that changes deployable behaviour must have an entry in root `CHANGELOG.md` before close. Per-agent logs under `server/agents/<slug>/CHANGELOG.md` are additive — they do not replace the root entry.

---

## What is NOT in this file

Detailed API signatures, table schemas, service interfaces, and architectural decisions live in:
- `PLATFORM-PRIMITIVES.md` — full interface contracts
- `DECISIONS.md` — settled architectural decisions with rationale
- `PERMISSIONS.md` — full permissions model
- `MCP-SERVERS.md` — all registered MCP tools and their data shapes
- `CRON.md` — all scheduled jobs
- `setup.md` — ports, environment variables, Railway deployment, common errors
- `DEMO-AGENTS.md` — demo agent checklist and UI standards

This file is for session orientation and project rules. `.claude/settings.json` is intentionally kept lightweight: permissions and safe configuration only. Any future hooks should call named repo scripts rather than embedding inline command logic.
