'use strict';

/**
 * Anomaly Investigator — ReAct investigation agent.
 *
 * Accepts either freeform anomaly description or structured metric input.
 * The agent derives hypotheses from initial data — the system prompt describes
 * a reasoning protocol, not a cause list.
 *
 * Post-run validation checks for required output sections (Investigation Log,
 * Dead Ends, Open Threads) and hypothesis hygiene (pre-call hypothesis in each
 * log entry). Failures surface as boundsFailed → needs_review status.
 */

const { agentOrchestrator }                    = require('../../platform/AgentOrchestrator');
const AgentConfigService                        = require('../../platform/AgentConfigService');
const { buildSystemPrompt }                     = require('./prompt');
const { anomalyInvestigatorTools, TOOL_SLUG }   = require('./tools');

const REQUIRED_SECTIONS = [
  { marker: '## Investigation Log', label: 'Investigation Log' },
  { marker: '## Dead Ends',         label: 'Dead Ends' },
  { marker: '## Open Threads',      label: 'Open Threads' },
];

function validateOutputSections(summary) {
  const failures = [];

  for (const { marker, label } of REQUIRED_SECTIONS) {
    if (!summary.includes(marker)) {
      failures.push({ tool: 'output-structure', message: `Missing required section: ${label}` });
    }
  }

  // Check hypothesis hygiene: each log entry should have **Hypothesis:** before **Tool:**
  // Extract the Investigation Log section content
  const logMatch = summary.match(/## Investigation Log([\s\S]*?)(?=## Dead Ends|## Open Threads|$)/);
  if (logMatch) {
    const logContent = logMatch[1];
    // Split on entry boundaries — each entry starts with **Hypothesis:**
    const toolCallCount     = (logContent.match(/\*\*Tool:\*\*/g)     ?? []).length;
    const hypothesisCount   = (logContent.match(/\*\*Hypothesis:\*\*/g) ?? []).length;
    // If there are tool calls but significantly fewer hypotheses, flag waterfall pattern
    if (toolCallCount > 0 && hypothesisCount < toolCallCount) {
      const missing = toolCallCount - hypothesisCount;
      failures.push({
        tool: 'reasoning-hygiene',
        message: `${missing} of ${toolCallCount} investigation log entries missing pre-call hypothesis — possible waterfall pattern`,
      });
    }
  }

  return failures;
}

async function runAnomalyInvestigator(context) {
  const { orgId, req, emit } = context;

  const adminConfig = await AgentConfigService.getResolvedAdminConfig(TOOL_SLUG, orgId);

  const anomalyDescription = (req?.body?.anomalyDescription ?? '').trim();
  const startDate          = req?.body?.startDate ?? null;
  const endDate            = req?.body?.endDate   ?? null;
  const days               = req?.body?.days      ?? 30;

  if (!anomalyDescription) {
    throw new Error('Anomaly description is required.');
  }

  let dateContext = '';
  if (startDate && endDate) {
    dateContext = `\n\nInvestigation window: ${startDate} to ${endDate}.`;
  } else {
    dateContext = `\n\nDefault lookback: last ${days} days unless the anomaly description implies a specific period.`;
  }

  const userMessage =
    `Investigate this anomaly:\n\n${anomalyDescription}${dateContext}\n\n` +
    `Pull the broadest relevant data first. Then follow your hypotheses across all three data sources as the evidence leads you. Stop when you have High confidence or have exhausted testable hypotheses.`;

  emit('Starting investigation — pulling initial data…');

  const { result, trace, tokensUsed } = await agentOrchestrator.run({
    systemPrompt:  buildSystemPrompt(),
    userMessage,
    tools:         anomalyInvestigatorTools,
    model:         adminConfig.model,
    maxTokens:     adminConfig.max_tokens    ?? 6000,
    maxIterations: adminConfig.max_iterations ?? 15,
    fallbackModel: adminConfig.fallback_model ?? null,
    onStep:        emit,
    context:       {
      ...context,
      startDate: startDate ?? null,
      endDate:   endDate   ?? null,
      days,
      toolSlug:  TOOL_SLUG,
    },
  });

  const sectionFailures = validateOutputSections(result.summary ?? '');

  return {
    result: {
      ...result,
      boundsFailed:       sectionFailures,
      anomalyDescription,
      startDate,
      endDate,
    },
    trace,
    tokensUsed,
  };
}

module.exports = { runAnomalyInvestigator };
