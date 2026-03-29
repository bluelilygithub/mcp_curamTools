'use strict';

/**
 * Google Ads Change Audit agent — runFn entry point.
 *
 * Compares campaign KPIs across before/after windows for each detected change
 * and scores each change as Positive, Neutral, or Negative.
 *
 * context shape (from createAgentRoute):
 *   { orgId, userId, config, adminConfig, req, emit }
 *
 * req.body may contain:
 *   { startDate, endDate }  — audit period (changes to inspect)
 *   { days }                — rolling lookback alternative
 *   { customerId }          — target a specific customer account
 */

const { agentOrchestrator } = require('../../platform/AgentOrchestrator');
const AgentConfigService    = require('../../platform/AgentConfigService');
const { googleAdsChangeAuditTools, TOOL_SLUG } = require('./tools');
const { buildSystemPrompt } = require('./prompt');

async function runGoogleAdsChangeAudit(context) {
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
    const days  = req?.body?.days ?? config.lookback_days ?? 30;
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
    `Audit all changes made to the Google Ads account between ${startDate} and ${endDate}. ` +
    'For each significant change, retrieve performance data for the comparison window before ' +
    'and after the change date. Score each change as Positive, Neutral, or Negative.';

  const { result, trace, tokensUsed } = await agentOrchestrator.run({
    systemPrompt:  buildSystemPrompt(customerConfig, customerVars),
    userMessage,
    tools:         googleAdsChangeAuditTools,
    model:         adminConfig.model          ?? 'claude-sonnet-4-6',
    maxTokens:     adminConfig.max_tokens     ?? 8192,
    maxIterations: adminConfig.max_iterations ?? 15,
    onStep:        emit,
    context:       { ...context, startDate, endDate, toolSlug: TOOL_SLUG, customerId },
  });

  return { result, trace, tokensUsed };
}

module.exports = { runGoogleAdsChangeAudit };
