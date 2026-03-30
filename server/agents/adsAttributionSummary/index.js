'use strict';

/**
 * Ads Attribution Summary agent — runFn entry point.
 *
 * Collates Google Ads, GA4 analytics, and WordPress enquiries into a brief
 * cross-channel attribution summary.
 *
 * req.body may contain:
 *   { startDate, endDate }  — date-picker selection from the parent dashboard
 *   { days }                — fallback lookback period
 *   { customerId }          — optional Google Ads customer account
 */

const { agentOrchestrator }  = require('../../platform/AgentOrchestrator');
const AgentConfigService     = require('../../platform/AgentConfigService');
const { adsAttributionSummaryTools, TOOL_SLUG } = require('./tools');
const { buildSystemPrompt }  = require('./prompt');

async function runAdsAttributionSummary(context) {
  const { orgId, req, emit } = context;

  const adminConfig = await AgentConfigService.getAdminConfig(TOOL_SLUG);

  // Date range: explicit dates > days param > 30d default
  let startDate = req?.body?.startDate ?? null;
  let endDate   = req?.body?.endDate   ?? null;

  if (!startDate || !endDate) {
    const days  = req?.body?.days ?? 30;
    const end   = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    startDate = start.toISOString().slice(0, 10);
    endDate   = end.toISOString().slice(0, 10);
  }

  const customerId = req?.body?.customerId ?? null;

  const userMessage =
    `Produce an attribution summary for the period ${startDate} to ${endDate}. ` +
    'Gather Google Ads spend and conversions, GA4 session data, and WordPress enquiries, ' +
    'then write a brief cross-channel summary as instructed.';

  const { result, trace, tokensUsed } = await agentOrchestrator.run({
    systemPrompt:  buildSystemPrompt(),
    userMessage,
    tools:         adsAttributionSummaryTools,
    model:         adminConfig.model          ?? 'claude-sonnet-4-6',
    maxTokens:     adminConfig.max_tokens     ?? 4096,
    maxIterations: adminConfig.max_iterations ?? 8,
    onStep:        emit,
    context:       { ...context, startDate, endDate, toolSlug: TOOL_SLUG, customerId },
  });

  return { result, trace, tokensUsed };
}

module.exports = { runAdsAttributionSummary };
