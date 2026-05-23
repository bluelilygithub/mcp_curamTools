# Report Chaining

Report chaining is the platform pattern for structured delegation across agents. One agent produces a completed, human-readable report, and a later agent consumes that report as grounded context for a new task. The important point is that the downstream agent is not merely calling a tool and it is not simply moving through the next phase of one long pipeline. It is inheriting a prior reasoning artefact, produced at a different time, with its own author, model, prompt, inputs, status, and review history.

This makes report chaining architecturally distinct from both tool use and multi-stage pipelines. Tool use retrieves live source data from an external system during a run. A multi-stage pipeline keeps one workflow moving through internal phases such as extraction, validation, and synthesis. Report chaining creates a temporal dependency between separate runs. The upstream report has already been persisted. The downstream agent starts by reading that prior artefact and treating it as part of the operating context for the next job.

The Copy Diagnostic to Copy Playbook to Copy Gate flow is the clearest example. Copy Diagnostic identifies problems in existing ad copy. Copy Playbook turns those findings into structured improvement options. Copy Gate then assesses whether the proposed copy is safe, compliant, and ready to use. Each stage is independently useful, but the chain is more powerful because each output becomes an accountable input to the next stage.

The architectural value is not speed. The value is accountable handoff. A platform that chains reports can show which prior report was used, when it was created, whether it completed successfully, whether a human reviewed it, and whether the downstream agent treated it as fact, recommendation, or hypothesis. This gives the system a richer memory model than simple chat history or vector retrieval. Prior reports become bounded memory: named, timestamped, inspectable, and capable of being approved, rejected, rerun, or superseded.

## Current Platform Implementation

The first implementation lives in `server/platform/ReportDependencyService.js` and is wired through `server/platform/createAgentRoute.js`. Chain definitions are declared centrally. For the current copy workflow, `ads-copy-playbook` requires `ads-copy-diagnostic`, and `ads-copy-gate` requires both `ads-copy-playbook` and `ads-copy-diagnostic`.

Before a chained run starts, the route resolves the declared upstream reports for the current organisation. The client can pass explicit upstream run IDs in `reportDependencies`; otherwise the service selects the latest suitable run for each required upstream slug. The service validates organisation ownership, slug, and status. Missing required reports block the run. Stale reports and `needs_review` reports are allowed but surfaced as warnings so the downstream agent and the user both know the inherited reasoning is weaker.

The downstream run receives three pieces of dependency context: the selected report summaries for agent input, a provenance block that names the upstream run IDs and statuses, and warning metadata. When the downstream result is persisted, `agent_runs.result.report_dependencies` records the upstream slug, label, run ID, status, run time, age, staleness state, and selection time. This means a later reviewer can tell which exact diagnostic or playbook was inherited even if newer reports exist.

The Google Ads dashboard exposes the same relationship through `GET /api/agents/:slug/dependencies`. Copy Playbook and Copy Gate now show their required report dependencies, block when an upstream report is missing, warn before using stale upstream reports, and display the persisted dependency surface beside the downstream report.

## Why This Matters

The core risk in report chaining is reasoning inheritance. When a downstream agent reads an upstream report, it is not receiving raw truth. It is receiving another model's interpretation of source material. If the diagnostic was wrong, the playbook may build on weak foundations. If the diagnostic was mostly right but the playbook misreads it, the error can compound without being obvious. If the gate stage treats a playbook recommendation as verified fact, a recommendation can silently become policy.

That risk is exactly why the pattern is valuable to name. Most AI systems either hide intermediate reasoning inside one large prompt or allow users to copy and paste report text manually. Both approaches lose provenance. Report chaining makes the dependency explicit. It turns a quiet prompt dependency into a visible platform relationship.

The platform should therefore treat chained reports as governed inputs, not loose context. A downstream run should know which upstream run it depends on. The UI should show that dependency. The persisted run should record it. The agent prompt should describe the dependency accurately. The user should be able to inspect the upstream report before allowing downstream work to proceed.

## How To Use The Pattern

Use report chaining when the second agent needs the judgement produced by the first agent, not merely the same raw source data. A keyword report that needs raw search terms should call the relevant tool. A tender response workflow that extracts, validates, and drafts in one controlled run is a pipeline. A copy playbook that starts from a completed copy diagnostic is report chaining.

The pattern is appropriate when the upstream report is a durable artefact with value on its own. It should be something a human can read and reasonably say, "Yes, this is the basis for the next job." If the upstream output is only internal scratch work, it belongs inside a pipeline instead. If the downstream agent only needs fresh database facts, it belongs in tool use instead.

In practice, a user should experience report chaining as a guided handoff. The platform should show the available upstream reports, identify the latest suitable one, warn when it is stale or incomplete, and make the selected dependency visible before the downstream run starts. A user should not need to know the internal table structure. They should see a plain statement such as: "This Playbook will use Copy Diagnostic run 3482 from 12 May, completed successfully, not yet reviewed."

## Dependency Rules

Dependencies must be declared, not assumed. A downstream agent should not silently grab the latest prior run just because it happens to exist. The chain definition should say which upstream agent or report type is acceptable, which statuses are allowed, how old a dependency may be before it becomes stale, and whether human review is required.

A strong chain rule is explicit enough to block bad handoffs. Copy Playbook may require a completed Copy Diagnostic. Copy Gate may require a completed Copy Playbook. If the upstream run is errored, rejected, deleted, or outside the staleness window, the downstream agent should either refuse to run or ask the user to confirm the risk. If the platform allows an override, the override should be recorded.

The dependency should also define how the downstream agent should treat the upstream content. Some reports are factual extracts. Some are analysis. Some are recommendations. Some are drafts. These are not equivalent. A gate agent should treat a playbook as proposed copy strategy, not as independently verified compliance evidence. A synthesis agent should distinguish between an upstream finding and the raw data behind it.

## Review Surface

Report chaining creates a natural review surface because every stage produces a discrete artefact. This is stronger than a black-box pipeline. In a pipeline, intermediate state often disappears into memory or logs. In a chain, the intermediate output is the point. The diagnostic, the playbook, and the gate report can each be opened, reviewed, approved, rejected, or rerun.

This makes report chaining especially useful in demos and client-facing workflows. It shows that the platform is not simply asking one model to do everything. It is organising work into accountable handoffs. A reviewer can intervene at each boundary. If the diagnostic is weak, the playbook should not inherit it. If the playbook is not persuasive, the gate should not bless it. If the gate identifies risk, the chain can stop with a clear audit trail.

The review surface also supports learning. A rejected upstream report can become evidence for prompt improvement, a lesson candidate, or a model configuration review. A successful chain can show which sequence of agents, prompts, models, and reports produced a useful outcome.

## What The Platform Should Persist

A chained run should persist dependency metadata alongside the normal run result. At minimum, the downstream run should record the upstream run id, upstream agent slug, upstream report title or label, upstream status at the time of use, selected-by user id, selected-at timestamp, and whether the dependency was required or optional.

The platform should also preserve the dependency snapshot. The downstream run should not become ambiguous if the upstream report is edited, superseded, or deleted later. The system can still link to the live upstream report, but it should keep enough metadata to prove what the downstream agent relied on at run time.

For auditability, the downstream result should disclose its dependency in user-facing language. A report that relied on prior reasoning should say so. This does not need to be verbose, but it should be visible. The reader should never have to guess whether a report was produced from raw data, live tool calls, or another agent's prior judgement.

## Agent Authoring Contract

When adding a report-chained agent, document its dependencies before writing the prompt. The dependency is part of the agent contract, not an implementation detail. The author should define the acceptable upstream slugs, required statuses, staleness threshold, review requirement, and fallback behaviour when no suitable upstream report exists.

The prompt should be explicit about the status of the dependency. It should tell the model whether the upstream report is reviewed, unreviewed, stale, superseded, or manually overridden. It should also instruct the model not to treat upstream reasoning as raw evidence unless the upstream report explicitly contains verified source data.

The UI should make the dependency selectable or at least visible. If the platform auto-selects a dependency, it should show the selection and the reason. "Latest completed diagnostic" is acceptable only if the user can see which diagnostic was selected and can choose a different one when needed.

## Taking Advantage Of Report Chaining

The practical advantage is that complex work can be split into smaller, more reliable agent responsibilities. Instead of one large prompt asking an agent to diagnose, invent, and approve copy in one pass, the platform can let one agent specialise in finding problems, another in generating structured remedies, and another in applying a final quality gate. Each agent gets a narrower task and a clearer standard of success.

This also gives administrators better control. They can decide which chains are allowed, which stages require review, which roles can run each stage, and which reports are allowed to feed downstream work. A demo organisation might allow members to run Copy Diagnostic, restrict Copy Playbook to a marketing role, and require admin review before Copy Gate can be run. The chain becomes a governance mechanism, not just a convenience.

For users, the pattern should feel like guided progression. The application can suggest the next sensible job, explain why it is available, and block or warn when the necessary prior report is missing. The user is still in charge of judgement, but the system understands the workflow.

## Design Boundary

Report chaining should not become invisible automation. If the platform starts running downstream agents automatically without showing the dependency and review state, the pattern loses its main benefit. The goal is not to hide complexity. The goal is to make the handoff between agents explicit, inspectable, and useful.

Report chaining is also not a replacement for source verification. A downstream agent that needs current campaign performance should call the relevant tool. A downstream agent that needs to know what a prior agent concluded should use the prior report. When both are needed, the prompt should keep them separate: prior report as inherited reasoning, live tools as current evidence.

## One-Line Rule

Report chaining is structured delegation across agents: each agent's output becomes the next agent's accountable input, and human review can intervene at every handoff.
