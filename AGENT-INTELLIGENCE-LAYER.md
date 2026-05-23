# Agent Intelligence Layer

**Project:** MCP CuramTools  
**Author:** Solo developer  
**Date:** 2026-05-23  
**Status:** Demo-platform foundation — Stage 1 implemented for pilot agents  
**Related:** `DECISIONS.md`, `knowledge_base/architecture/REPORT_CHAINING.md`

---

## Purpose

The Agent Intelligence Layer is a trust and audit layer for the demo platform. It is not intended to turn this application into a heavy enterprise observability product. Its purpose is to demonstrate that the platform does more than run agents and print responses. It can show what an agent relied on, where evidence was missing, when a report inherited another agent's reasoning, and which outputs should be reviewed before being acted on.

This matters because the strongest demo story is not "we call an LLM." The stronger story is:

> The platform runs agents, records their evidence, detects weak or missing inputs, tracks report handoffs, and gives an admin a review queue for risky outputs.

That is enough to show practical understanding of agent governance without overbuilding infrastructure that may never be needed in production.

---

## Design Position

This layer should be built as a set of small trust primitives:

- **Missing data disclosure:** agents must say what they could not find.
- **Mechanical verification:** the platform checks that disclosure against actual tool results where possible.
- **Review state:** risky outputs are marked `needs_review` instead of being treated as clean.
- **Report dependency provenance:** chained reports show exactly which upstream report they inherited.
- **Admin review UI:** admins see which runs need attention and why.

Later ideas such as duplicate detection, adversarial data scanning, and claim-to-source scoring are valid roadmap items. They should remain documented, but they are not required to prove the foundation.

---

## Already Implemented Primitive — Report Chaining Provenance

The Copy Diagnostic -> Copy Playbook -> Copy Gate workflow already demonstrates one part of the Agent Intelligence Layer.

The platform now declares upstream report dependencies, resolves them before a chained run starts, blocks missing required dependencies, warns when dependencies are stale or marked `needs_review`, and persists `report_dependencies` on the downstream run result. This means a reviewer can see which exact diagnostic or playbook was used as inherited reasoning.

This is important because report chaining is not just workflow convenience. It is accountable handoff between agents. The downstream report is no longer silently based on "whatever the latest upstream run was." The selected upstream run becomes visible and reviewable.

The Agent Intelligence Layer should build on this same idea: make hidden agent assumptions visible.

---

## Implement Now — Stage 1: Data Gaps And Review State

**Implementation status:** Implemented for the first pilot slice. The shared route parses `### Data Gaps`, compares declared gaps with lightweight evidence summaries, writes `data_gaps` and `data_gap_review` into `agent_runs.result`, and reuses `boundsFailed` / `needs_review` when required gap disclosure is missing or a source returned empty/error without being acknowledged.

### Goal

Add a lightweight missing-data disclosure system to a small set of important report agents. This is the first implementation because it creates immediate demo value, requires no new database table, and teaches the core trust pattern.

The key question it answers is:

> Did the agent confidently produce a report despite missing data?

### Scope

Start with a limited pilot, not every agent.

Recommended first agents:

- `ads-copy-diagnostic`
- `ads-copy-playbook`
- `ads-copy-gate`
- `google-ads-monitor`
- `keyword-opportunity`

These are good demo candidates because they are report-oriented, tool/data dependent, and easy to explain to a client or interviewer.

The initial implementation covers these pilot agents.

### Prompt Convention

Each pilot agent should include a mandatory output section:

```markdown
### Data Gaps
- `source_id`: what was missing and why it matters

If no data was missing, write:
No data gaps detected.
```

Use exact source IDs rather than loose labels. For example, prefer `ads_get_search_terms_by_ad_group` over "Google Ads search term data." Exact IDs make mechanical matching possible.

If the `### Data Gaps` section is missing, that should be treated as a warning. A missing mandatory section is different from "no gaps detected."

### Platform Behaviour

Add an `extractGaps(text)` helper modelled on `extractSuggestions`.

The helper should return structured gap records:

```js
[
  {
    source: 'ads_get_search_terms_by_ad_group',
    statement: 'No search terms returned for the selected date range.'
  }
]
```

Then compare declared gaps with available tool evidence:

- If a tool returned empty/error and the agent declared it, record a confirmed data gap.
- If a tool returned empty/error and the agent did not declare it, add a `boundsFailed` warning.
- If the agent declared a gap but the tool returned data, add a `boundsFailed` warning.
- If the section is missing, add a `boundsFailed` warning for missing gap disclosure.

Because `createAgentRoute` already turns non-empty `boundsFailed` into `needs_review`, this stage can use the existing review mechanism.

### Pre-Fetch Agents

Do not assume all evidence flows through `AgentOrchestrator`. Many important agents pre-fetch data with `callMcpTool` before the model call. The implementation should be framed as an **agent evidence trace**, not only a ReAct loop trace.

For Stage 1, this can be simple:

- ReAct agents use the existing orchestrator trace.
- Pre-fetch agents can include source payloads in `result.data` or a lightweight evidence summary.
- The gap checker only needs enough metadata to know whether a source returned data, returned zero rows, or errored.

### UI Outcome

The user-facing output should show:

- The report itself.
- A warning if the run is `needs_review`.
- Which data gaps were declared.
- Which gaps were detected by the platform.
- Whether the report relied on chained upstream reports.

This gives an immediate demo: "The report is useful, but the platform tells you where the evidence was weak."

### Stage 1 Success Criteria

Stage 1 is successful when:

- Pilot agents always produce a `### Data Gaps` section.
- Missing sections are detected.
- Silent empty results produce `needs_review`.
- Declared gaps are visible in the UI.
- Existing report chaining provenance appears beside gap warnings where relevant.

---

## Implement With Stage 1 — Agent Trust Console

**Implementation status:** Initial `Admin > Agent Trust` view is implemented as a review queue. It uses existing `agent_runs` metadata and does not require a new schema.

### Purpose

The Agent Trust Console is the UI surface for the Agent Intelligence Layer. It should not look like a raw telemetry page. It should answer:

1. Which agent outputs need review?
2. Why do they need review?
3. What should the admin do next?

### Location

Add it under Admin as:

```text
Admin > Agent Trust
```

This keeps it separate from `Admin > Usage`. Usage answers "what did agents cost?" Agent Trust answers "which outputs need human review?"

### Top Summary Cards

Show four or five simple cards:

- **Runs Needing Review**
- **Silent Data Gaps**
- **Stale Chained Dependencies**
- **Missing Gap Sections**
- **Recent Reviewed Runs** or **Review Rate**

These cards should be plain-language and demo-friendly. Avoid exposing internal table names in the first view.

### Review Queue

The main section should be a review queue of agent runs.

Columns:

- Agent
- Run date
- Status
- Severity
- Reason
- Dependency state
- Action

Example reasons:

- "Tool returned no rows but report did not disclose this."
- "Report used a stale Copy Diagnostic from 12 days ago."
- "Required Data Gaps section was missing."
- "Report is marked needs_review due to bounds warnings."

Actions:

- View report
- Open dependency report
- Re-run upstream report
- Mark reviewed
- Mark false positive

For the first version, `Mark reviewed` and `Mark false positive` can be deferred if no review table exists yet. The initial UI can still be useful as a queue and explanation surface.

### Run Detail Panel

Selecting a run should show:

- Final report summary
- Declared data gaps
- Platform-detected gaps
- Chained dependencies used
- Bounds warnings
- Run metadata: model, cost, date range, status

This is the demo moment. It shows that an agent output is not just a blob of text. It has reviewable evidence and handoffs around it.

### Trend Section

Add later, after enough data exists:

- Agents most often marked `needs_review`
- Tools most often returning empty
- Repeated warning reasons over time
- Stale dependency frequency

This section is useful, but it should not block the first Agent Trust Console.

---

## Roadmap — Later Trust Primitives

The following stages are valuable, but they are not required for the first demo-platform foundation. They should be built only when Stage 1 and the Agent Trust Console are working and producing useful signals.

### Stage 2: Agent Evidence Trace

Purpose: create a queryable evidence layer across runs.

This should cover both ReAct agents and pre-fetch agents. Avoid naming it only around ReAct loop iterations. The broader concept is:

> For each run, what evidence sources were consulted, what shape did they return, and did the model disclose any gaps?

Possible table:

```sql
agent_evidence_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL,
  org_id INTEGER NOT NULL,
  slug TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_type TEXT NOT NULL, -- tool, prefetch, dependency, output_signal
  event_index INTEGER,
  input_summary JSONB,
  result_summary JSONB,
  result_row_count INTEGER,
  result_was_empty BOOLEAN DEFAULT false,
  result_had_error BOOLEAN DEFAULT false,
  declared_gap BOOLEAN DEFAULT false,
  warning_severity TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

This is a better foundation than forcing all future signals into `agent_decision_inputs`.

### Stage 3: Duplicate And Repetition Detection

Purpose: identify when outputs repeat themselves or when source data conflicts.

Recommended split:

- Same-run duplicate recommendations can be a simple `boundsFailed` warning.
- Cross-run recommendation recurrence should use a separate table such as `agent_output_hashes`.
- Cross-tool numeric conflicts belong in `validateToolData`.

Do not put long-term recommendation hashes into the evidence event table unless there is a clear query reason.

### Stage 4: Adversarial Content Detection

Purpose: scan tool result strings for prompt-injection-like content before they reach the model.

This is useful as a documented capability, but it needs calibration. Start in warn-only mode. Do not block runs based on broad string patterns until real platform data has been reviewed.

Good first patterns:

- "ignore previous instructions"
- "system prompt"
- right-to-left override characters
- zero-width characters
- unusually long campaign/search-term/ad-copy fields

### Stage 5: Claim-To-Source Correlation

Purpose: score whether factual claims in the output are grounded in returned tool data.

This is the most impressive but also the easiest to overbuild. Start with numeric claim matching only if there is enough output history to make it meaningful. A second AI verification pass should be treated as optional and costed separately.

For demo purposes, this is a roadmap item, not a foundation requirement.

---

## Recommended Build Sequence

| Phase | Build | Why |
|---|---|---|
| 1 | Data Gaps for 3-5 pilot agents | Immediate trust signal, no schema change |
| 2 | Agent Trust Console review queue | Makes the trust layer visible and demoable |
| 3 | Review actions | Lets an admin mark reviewed/false positive |
| 4 | Agent Evidence Trace table | Adds cross-run query power when needed |
| 5 | Duplicate/adversarial/grounding signals | Maturity roadmap |

The first two phases are enough to prove the foundation.

---

## What This Demonstrates

When discussing the platform, the Agent Intelligence Layer can be described like this:

> This is a demo platform for agentic work, but it includes trust primitives usually missing from simple AI tools. It records report handoffs, detects missing evidence, marks risky outputs for review, and gives admins a queue explaining why a run should not be blindly trusted.

That is the point. The layer does not need to be exhaustive to be valuable. It needs to show that the application was designed with agent reliability, auditability, and human oversight in mind.

---

## What This Does Not Do

This layer does not make agents correct. It makes weak evidence visible.

It does not replace human judgement. It gives humans better review cues.

It does not need to become enterprise observability before it is useful. A small implementation that clearly shows missing-data disclosure, report dependency provenance, and review state is enough for a strong demo foundation.

The trust model remains:

> Claude produces. The platform verifies what it can. Humans decide.
