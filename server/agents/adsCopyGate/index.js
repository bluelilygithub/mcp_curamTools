'use strict';

/**
 * Ads Copy Gate agent — pre-fetch architecture.
 *
 * WHY PRE-FETCH: No MCP tool calls needed. The gate reads Report 2 (Playbook)
 * and Report 1 (Diagnostic) from the DB and passes both to Claude in a single
 * call. Claude performs all verification — character recounts, sequencing checks,
 * claim substantiation — from the text alone.
 *
 * This is Report 3. It gates Report 2; it does not extend it.
 */

const { agentOrchestrator } = require('../../platform/AgentOrchestrator');
const AgentConfigService    = require('../../platform/AgentConfigService');
const { pool }              = require('../../db');
const { buildSystemPrompt } = require('./prompt');
const { TOOL_SLUG }         = require('./tools');

async function runAdsCopyGate(context) {
  const { orgId, req, emit } = context;

  const adminConfig    = await AgentConfigService.getAdminConfig(TOOL_SLUG);
  const config         = await AgentConfigService.getAgentConfig(orgId, TOOL_SLUG);
  const companyProfile = await AgentConfigService.getCompanyProfile(orgId);

  emit('Fetching Playbook and Diagnostic reports…');

  const [playbookRow, diagnosticRow] = await Promise.all([
    pool.query(
      `SELECT result FROM agent_runs
       WHERE org_id = $1 AND slug = 'ads-copy-playbook' AND status = 'complete'
       ORDER BY run_at DESC LIMIT 1`,
      [orgId]
    ).then((r) => r.rows[0]?.result ?? null).catch(() => null),
    pool.query(
      `SELECT result FROM agent_runs
       WHERE org_id = $1 AND slug = 'ads-copy-diagnostic' AND status = 'complete'
       ORDER BY run_at DESC LIMIT 1`,
      [orgId]
    ).then((r) => r.rows[0]?.result ?? null).catch(() => null),
  ]);

  const playbookResult = playbookRow
    ? (typeof playbookRow.summary === 'string' ? playbookRow.summary : JSON.stringify(playbookRow))
    : null;

  const diagnosticResult = diagnosticRow
    ? (typeof diagnosticRow.summary === 'string' ? diagnosticRow.summary : JSON.stringify(diagnosticRow))
    : null;

  emit('Running gate review…');

  const payload = { playbookResult, diagnosticResult };

  const userMessage =
    `Run the QA gate review on the Ad Copy Optimization Playbook (Report 2). ` +
    (playbookResult
      ? 'The full Playbook output is in playbookResult.'
      : 'playbookResult is null — Report 2 has not been run. Halt and state this.') +
    ` Diagnostic context is in diagnosticResult.\n\n` +
    `\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;

  const { result, trace, tokensUsed } = await agentOrchestrator.run({
    systemPrompt:  buildSystemPrompt(config, companyProfile),
    userMessage,
    tools:         [],
    maxIterations: 1,
    model:         adminConfig.model      ?? 'claude-sonnet-4-6',
    maxTokens:     adminConfig.max_tokens ?? 8192,
    fallbackModel: adminConfig.fallback_model ?? null,
    onStep:        emit,
    context:       { ...context, toolSlug: TOOL_SLUG },
  });

  return { result, trace, tokensUsed };
}

module.exports = { runAdsCopyGate };
