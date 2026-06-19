# Knowledge Base Index

**Project:** MCP CuramTools — Internal AI Agent Platform
**Context:** Solo developer, single-organisation internal tool. See [PROJECT_IDENTITY.md](../PROJECT_IDENTITY.md).

---

## Purpose

This knowledge base organises the project's documentation into a navigable structure. It is the entry point for any AI session or human reader who needs to understand the project.

### Knowledge Approach — Bayesian Priors

This knowledge base follows the **Search-Verify-Update** protocol established in `server/CLAUDE.md`:

- **Search** — Before making any change, search the `knowledge_base/` directory and relevant source files for existing context, decisions, and patterns
- **Verify** — Cross-reference findings against CLAUDE.md guardrails, DECISIONS.md rationale, and PROJECT_IDENTITY.md context
- **Update** — Make the change, then update knowledge_base/ files and **root `CHANGELOG.md`** (canonical evidence log) to reflect what was done; see `knowledge_base/INDEX.md` → *Changelog and evidence logs*

Each file in this knowledge base serves a specific Bayesian role:

| File | Bayesian Role |
|---|---|
| `core/PROJECT_IDENTITY.md` | Prior distribution — constrains all reasoning about architecture, security, and scope |
| `core/CHANGELOG.md` | Optional mirror of the evidence log — see [Changelog layout](#changelog-and-evidence-logs) |
| Root `CHANGELOG.md` | **Canonical** platform/container evidence log — prefer this for session entries |
| `decisions/DECISIONS.md` | Posterior beliefs — settled conclusions after considering alternatives |
| `server/CLAUDE.md` | Learned priors — weighted by the cost of re-learning them |
| All other files | Accumulated posterior — always consult before acting |


---

## Changelog and evidence logs

The **repository root** [`CHANGELOG.md`](../CHANGELOG.md) is the **canonical** changelog for the platform (server, client shell, shared primitives, and cross-cutting work).

Optional additional logs are encouraged when an agent or suite grows large:

- **`knowledge_base/core/CHANGELOG.md`** — optional mirror; may lag root; sync when practical.
- **Per-agent `CHANGELOG.md`** — under `server/agents/<slug>/` or a suite directory; use for deep agent-only history. Reference related entries in the root log so readers can connect platform and agent changes.

Session close rule: **at minimum**, append to root `CHANGELOG.md`. Add agent-specific logs only when they add clarity.

---

## Directory Structure

```
knowledge_base/
  INDEX.md              ← You are here
  core/                 ← Project identity, setup, changelog, prompts reference
  architecture/         ← Platform primitives, MCP servers, database schema
  decisions/            ← Architectural decisions (from DECISIONS.md)
  agents/               ← Per-agent documentation
  history/              ← Changelog entries by date
  ops/                  ← Operations: cron, deployment, environment
```

---

## Quick Navigation

| Topic | File |
|---|---|
| **Project identity & scope** | `core/PROJECT_IDENTITY.md` |
| **Setup guide** | `core/SETUP.md` |
| **Changelog (canonical)** | [`CHANGELOG.md`](../CHANGELOG.md) (repo root) |
| **Changelog (kb mirror)** | `core/CHANGELOG.md` |
| **Agent catalog (summary)** | `agents/AGENTS_INDEX.md` |
| **Demo UI contract** (prompts + mic, markdown output, exports & reports) | [`DEMO-AGENTS.md`](../DEMO-AGENTS.md) — *Standard demo UI* |
| **Golden-path smoke** (optional `npm test` from repo root) | [`scripts/smoke/README.md`](../scripts/smoke/README.md) |
| **Prompts reference** | `core/PROMPTS.md` |
| **Prompt versioning** (`prompt_version` on runs, registry) | `core/PROMPT_VERSIONING.md` |
| **Platform primitives** | `architecture/PLATFORM_PRIMITIVES.md` |
| **Report chaining** (agent outputs as accountable downstream inputs) | `architecture/REPORT_CHAINING.md` |
| **MCP servers & tools** | `architecture/MCP_SERVERS.md` |
| **Personal memory** (per-user notes) | `architecture/PERSONAL_MEMORY.md` |
| **Database schema** | `architecture/DATABASE_SCHEMA.md` |
| **Architectural decisions** | `decisions/DECISIONS.md` |
| **Agent: Google Ads Monitor** | `agents/google-ads-monitor.md` |
| **Agent: High Intent Advisor** | `agents/high-intent-advisor.md` |
| **Agent: Document Analyzer** | `agents/document-analyzer.md` |
| **Agent: WP Theme Extractor** | `agents/wp-theme-extractor.md` |
| **Agent: Ads Setup Architect** | `agents/ads-setup-architect.md` |
| **Agent: Not Interested Report** | `agents/not-interested-report.md` |
| **Agent: Geo Heatmap** | `agents/geo-heatmap.md` |
| **Agent: Campaign Dashboard** | `agents/campaign-dashboard.md` |
| **Agent: SQL NLP** | `agents/sql-nlp.md` |
| **Agent: Media Generator** | `agents/media-generator.md` |
| **Agent: AI Visibility Monitor** | `agents/ai-visibility-monitor.md` |
| **Cron jobs** | `ops/CRON.md` |
| **Deployment** | `ops/DEPLOYMENT.md` |
| **Environment variables** | `ops/ENVIRONMENT.md` |

---

## Reading Order for New Sessions

1. `core/PROJECT_IDENTITY.md` — understand scope and constraints
2. Root `CHANGELOG.md` — read last 2–3 entries for current state (canonical)
3. `architecture/PLATFORM_PRIMITIVES.md` — understand platform abstractions
4. `architecture/MCP_SERVERS.md` — understand available tools
5. Relevant agent docs under `agents/`
6. `decisions/DECISIONS.md` — understand settled decisions

---

## Raw Data

The `raw_data/` directory contains source data files used for analysis, reports, and testing. These are not documentation but input data for agents and tools.
