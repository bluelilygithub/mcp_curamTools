'use strict';

/**
 * Google Ads Monitor agent — runFn entry point.
 *
 * Conforms to the createAgentRoute runFn contract:
 *   async (context) => { result, trace, tokensUsed }
 *
 * context shape (provided by createAgentRoute for HTTP runs):
 *   { orgId, userId, config, adminConfig, req, emit }
 *   config      — operator settings (thresholds, lookback_days, schedule)
 *   adminConfig — admin guardrails  (model, max_tokens, max_iterations, enabled)
 *   emit        — SSE progress callback: emit(text, partialTokensUsed?)
 *
 * For scheduled runs, AgentScheduler passes config: {} and adminConfig: {}.
 * The agent loads its own config from DB in that case so scheduled runs use
 * the same operator-configured thresholds as HTTP runs.
 *
 * Days resolution: req.body.days > config.lookback_days > 30
 */

const { agentOrchestrator }  = require('../../platform/AgentOrchestrator');
const AgentConfigService     = require('../../platform/AgentConfigService');
const { googleAdsMonitorTools, TOOL_SLUG } = require('./tools');
const { buildSystemPrompt }  = require('./prompt');

function buildUserMessage(days) {
  return (
    `Analyse campaign performance for the last ${days} day${days === 1 ? '' : 's'} ` +
    'and provide optimisation recommendations focused on high-intent traffic within current budget.'
  );
}

/**
 * @param {object} context — from createAgentRoute
 * @returns {Promise<{ result: object, trace: Array, tokensUsed: object }>}
 */
async function runGoogleAdsMonitor(context) {
  const { orgId, req, emit } = context;

  // For scheduled runs, AgentScheduler passes empty config/adminConfig objects.
  // Load from DB in that case so thresholds and model settings are always current.
  const config      = Object.keys(context.config      ?? {}).length > 0
    ? context.config
    : await AgentConfigService.getAgentConfig(orgId, TOOL_SLUG);

  const adminConfig = Object.keys(context.adminConfig ?? {}).length > 0
    ? context.adminConfig
    : await AgentConfigService.getAdminConfig(TOOL_SLUG);

  const days = req?.body?.days ?? config.lookback_days ?? 30;

  const { result, trace, tokensUsed } = await agentOrchestrator.run({
    systemPrompt:  buildSystemPrompt(config),
    userMessage:   buildUserMessage(days),
    tools:         googleAdsMonitorTools,
    model:         adminConfig.model         ?? 'claude-sonnet-4-6',
    maxTokens:     adminConfig.max_tokens    ?? 8192,
    maxIterations: adminConfig.max_iterations ?? 10,
    onStep:        emit,
    context:       { ...context, days, toolSlug: TOOL_SLUG },
  });

  return { result, trace, tokensUsed };
}

module.exports = { runGoogleAdsMonitor };
