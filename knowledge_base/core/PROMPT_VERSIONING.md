# Prompt versioning (`agent_runs.result.prompt_version`)

**Project context:** Solo-maintained internal platform. See [PROJECT_IDENTITY.md](./PROJECT_IDENTITY.md).

## Why

Changing `prompt.js` (or equivalent) for one agent can **silently** change behaviour for demos and decision logs. A **stable label** on each completed run makes it possible to answer: “Which prompt lineage produced this `agent_runs` row?”

## What is persisted

For agents whose **`runFn`** returns an optional string **`promptVersion`**, the platform merges metadata on **`agent_runs.result`**:

| Key | When |
|-----|------|
| **`prompt_version`** | Present when **`promptVersion`** was returned (string, trimmed, max **160** chars). Omitted when unset. |

**Call sites:** **`createAgentRoute`** (`POST /api/agents/:slug/run`) and **`AgentScheduler`** cron ticks (single-object return and each element of a multi-customer **array** return). Both use **`mergePromptVersionIntoResult`** from **`server/platform/promptVersions.js`**.

This is **additive**. Agents that do not return `promptVersion` behave exactly as before.

## How to opt in (per agent)

1. Register a label in **`server/platform/promptVersions.js`** (`BY_SLUG[slug] = 'slug@N'`).
2. From **`runFn`**, return **`promptVersion`** (same envelope as HTTP):
   - HTTP / manual: `{ result, trace?, tokensUsed, promptVersion: getPromptVersion(slug) }`.
   - Cron, single run: top-level **`promptVersion`** on the return value, either on the envelope **`{ result, promptVersion }`** or alongside a legacy plain result object (see peel rules in **`AgentScheduler.js`**).
   - Cron, multi-customer: optional **`promptVersion`** on each **`{ customerId, result, … }`** element (merged into that row’s **`result`**).
3. **Bump** `@N` (or the label) when **system / stage prompts** change in a material way, and add a one-line note to the **root** [`CHANGELOG.md`](../../CHANGELOG.md).

**Reference implementation:** `demo-tender-response` — `server/agents/demoSuite/tenderResponse/index.js` (HTTP today; same return shape works if the agent is ever scheduled).

## Registry vs inline strings

Prefer **`getPromptVersion(slug)`** from `promptVersions.js` so all labels for opted-in slugs live in **one file** next to the platform factory. You may still return a custom `promptVersion` string for experiments; the platform only checks type and length.

## Relation to golden-path smoke

After changing **`promptVersions.js`**, **`createAgentRoute.js`**, or **`AgentScheduler.js`**, run **`npm test`** from the repository root (see [scripts/smoke/README.md](../../scripts/smoke/README.md)). Phase 1 **`require()`**s those modules and constructs a minimal **`createAgentRoute`** router to catch load-time regressions.

## Not covered here (item B)

Runtime **schema validation** of tool or API payloads (Zod, etc.) is a separate, opt-in effort — see future work in root `CHANGELOG.md` when introduced.
