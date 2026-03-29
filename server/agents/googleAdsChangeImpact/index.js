'use strict';

/**
 * Google Ads Change Impact agent — runFn entry point.
 *
 * Analyses what changed in the account and measures the performance impact.
 *
 * context shape (from createAgentRoute):
 *   { orgId, userId, config, adminConfig, req, emit }
 *
 * req.body may contain:
 *   { customerId }           — optional: target a specific customer account
 *   { startDate, endDate }   — optional date range override
 *   { days }                 — optional lookback days
 */

const { agentOrchestrator } = require('../../platform/AgentOrchestrator');
const AgentConfigService    = require('../../platform/AgentConfigService');
const { googleAdsChangeImpactTools, TOOL_SLUG } = require('./tools');
const { buildSystemPrompt } = require('./prompt');

async function runGoogleAdsChangeImpact(context) {
  const { orgId, req, emit } = context;

  const config = Object.keys(context.config ?? {}).length > 0
    ? context.config
    : await AgentConfigService.getAgentConfig(orgId, TOOL_SLUG);

  const adminConfig = Object.keys(context.adminConfig ?? {}).length > 0
    ? context.adminConfig
    : await AgentConfigService.getAdminConfig(TOOL_SLUG);

  const customerId = req?.body?.customerId ?? null;

  let startDate = req?.body?.startDate ?? null;
  let endDate   = req?.body?.endDate   ?? null;
  if (!startDate || !endDate) {
    const days  = req?.body?.days ?? config.lookback_days ?? 7;
    const end   = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    startDate = start.toISOString().slice(0, 10);
    endDate   = end.toISOString().slice(0, 10);
  }

  const customerConfig = customerId
    ? await AgentConfigService.getAgentConfigForCustomer(orgId, TOOL_SLUG, customerId)
    : config;

  const customerVars = customerId
    ? { customer_id: customerId, customer_name: customerConfig.customer_name ?? customerId }
    : {};

  const userMessage =
    `Analyse changes made to the Google Ads account between ${startDate} and ${endDate}. ` +
    'Identify what changed, when, and what impact each change had on performance.';

  const { result, trace, tokensUsed } = await agentOrchestrator.run({
    systemPrompt:  buildSystemPrompt(customerConfig, customerVars),
    userMessage,
    tools:         googleAdsChangeImpactTools,
    model:         adminConfig.model          ?? 'claude-sonnet-4-6',
    maxTokens:     adminConfig.max_tokens     ?? 8192,
    maxIterations: adminConfig.max_iterations ?? 10,
    onStep:        emit,
    context:       { ...context, startDate, endDate, toolSlug: TOOL_SLUG, customerId },
  });

  return { result, trace, tokensUsed };
}

module.exports = { runGoogleAdsChangeImpact };
