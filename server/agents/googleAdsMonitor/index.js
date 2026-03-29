'use strict';

/**
 * Google Ads Monitor agent — runFn entry point.
 *
 * context shape (from createAgentRoute for HTTP runs):
 *   { orgId, userId, config, adminConfig, req, emit }
 *
 * req.body may contain { startDate, endDate } (date-picker selection) or
 * { days } (legacy). Scheduled runs use config.lookback_days.
 *
 * For scheduled runs AgentScheduler passes empty config/adminConfig — these
 * are loaded from DB so the operator's saved settings are always used.
 */

const { agentOrchestrator }  = require('../../platform/AgentOrchestrator');
const AgentConfigService     = require('../../platform/AgentConfigService');
const { googleAdsMonitorTools, TOOL_SLUG } = require('./tools');
const { buildSystemPrompt }  = require('./prompt');

function buildUserMessage(startDate, endDate) {
  return (
    `Analyse campaign performance from ${startDate} to ${endDate} ` +
    'and provide optimisation recommendations focused on high-intent traffic within current budget.'
  );
}

async function runGoogleAdsMonitor(context) {
  const { orgId, req, emit } = context;

  // Scheduled runs pass empty objects — load from DB so settings are always current
  const config = Object.keys(context.config ?? {}).length > 0
    ? context.config
    : await AgentConfigService.getAgentConfig(orgId, TOOL_SLUG);

  const adminConfig = Object.keys(context.adminConfig ?? {}).length > 0
    ? context.adminConfig
    : await AgentConfigService.getAdminConfig(TOOL_SLUG);

  // Date range resolution: explicit dates > days param > config default > 30 days
  let startDate = req?.body?.startDate ?? null;
  let endDate   = req?.body?.endDate   ?? null;

  if (!startDate || !endDate) {
    const days  = req?.body?.days ?? config.lookback_days ?? 30;
    const end   = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    startDate = start.toISOString().slice(0, 10);
    endDate   = end.toISOString().slice(0, 10);
  }

  const { result, trace, tokensUsed } = await agentOrchestrator.run({
    systemPrompt:  buildSystemPrompt(config),
    userMessage:   buildUserMessage(startDate, endDate),
    tools:         googleAdsMonitorTools,
    model:         adminConfig.model          ?? 'claude-sonnet-4-6',
    maxTokens:     adminConfig.max_tokens     ?? 8192,
    maxIterations: adminConfig.max_iterations ?? 10,
    onStep:        emit,
    context:       { ...context, startDate, endDate, toolSlug: TOOL_SLUG },
  });

  return { result, trace, tokensUsed };
}

module.exports = { runGoogleAdsMonitor };
