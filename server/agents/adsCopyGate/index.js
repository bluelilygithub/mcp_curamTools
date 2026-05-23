'use strict';

/**
 * Ads Copy Gate agent — pre-fetch architecture.
 *
 * WHY PRE-FETCH: No MCP tool calls needed. The gate receives explicit Report 2
 * (Playbook) and Report 1 (Diagnostic) dependencies from createAgentRoute and
 * passes both to Claude in a single call. Claude performs all verification —
 * character recounts, sequencing checks, claim substantiation — from the text alone.
 *
 * This is Report 3. It gates Report 2; it does not extend it.
 */

const { agentOrchestrator } = require('../../platform/AgentOrchestrator');
const AgentConfigService    = require('../../platform/AgentConfigService');
const { summariseDataGapSources } = require('../../platform/dataGapEvidence');
const { buildSystemPrompt } = require('./prompt');
const { TOOL_SLUG }         = require('./tools');

async function runAdsCopyGate(context) {
  const { orgId, req, emit } = context;

  const adminConfig    = await AgentConfigService.getResolvedAdminConfig(TOOL_SLUG, orgId);
  const config         = await AgentConfigService.getAgentConfig(orgId, TOOL_SLUG);
  const companyProfile = await AgentConfigService.getCompanyProfile(orgId);

  emit('Fetching Playbook and Diagnostic reports…');

  const playbookDependency = context.reportDependencies?.find((d) => d.slug === 'ads-copy-playbook') ?? null;
  const diagnosticDependency = context.reportDependencies?.find((d) => d.slug === 'ads-copy-diagnostic') ?? null;

  const playbookResult = playbookDependency?.summary ?? null;
  const diagnosticResult = diagnosticDependency?.summary ?? null;

  emit('Running gate review…');

  const payload = {
    playbookResult,
    diagnosticResult,
    dependencies: {
      playbook: playbookDependency
        ? {
            runId: playbookDependency.runId,
            status: playbookDependency.status,
            runAt: playbookDependency.runAt,
            stale: playbookDependency.stale,
            ageDays: playbookDependency.ageDays,
          }
        : null,
      diagnostic: diagnosticDependency
        ? {
            runId: diagnosticDependency.runId,
            status: diagnosticDependency.status,
            runAt: diagnosticDependency.runAt,
            stale: diagnosticDependency.stale,
            ageDays: diagnosticDependency.ageDays,
          }
        : null,
    },
  };

  const userMessage =
    `Run the QA gate review on the Ad Copy Optimization Playbook (Report 2). ` +
    (playbookResult
      ? 'The selected Playbook dependency output is in playbookResult.'
      : 'playbookResult is null — Report 2 dependency is missing. Halt and state this.') +
    ` Diagnostic context is in diagnosticResult.\n\n` +
    `\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;

  const { result, trace, tokensUsed } = await agentOrchestrator.run({
    systemPrompt:  buildSystemPrompt(config, companyProfile),
    userMessage:    context.reportDependencyContext ? `${context.reportDependencyContext}\n\n---\n\n${userMessage}` : userMessage,
    tools:         [],
    maxIterations: 1,
    model:         adminConfig.model,
    maxTokens:     adminConfig.max_tokens ?? 8192,
    fallbackModel: adminConfig.fallback_model ?? null,
    onStep:        emit,
    context:       { ...context, toolSlug: TOOL_SLUG },
  });

  return {
    result: {
      ...result,
      data: {
        ...(result.data ?? {}),
        data_gap_sources: summariseDataGapSources({
          playbookResult: playbookResult ? [playbookResult] : [],
          diagnosticResult: diagnosticResult ? [diagnosticResult] : [],
        }),
      },
    },
    trace,
    tokensUsed,
  };
}

module.exports = { runAdsCopyGate };
