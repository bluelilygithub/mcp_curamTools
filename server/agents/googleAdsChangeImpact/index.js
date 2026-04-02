'use strict';

/**
 * Google Ads Change Impact agent — pre-fetch architecture.
 *
 * WHY PRE-FETCH: All four data sources (change history, campaign performance,
 * daily performance, GA4 sessions) are fetched unconditionally every run.
 * The ReAct loop added quadratic token cost for a fixed, predictable sequence.
 *
 * Pre-fetch pulls all four sources in parallel in Node.js, passes the complete
 * dataset to Claude in a single message, no tools, no loop.
 *
 * Estimated cost: ~$0.05–$0.15 per run (vs $0.30–$0.60 with ReAct).
 */

const { agentOrchestrator } = require('../../platform/AgentOrchestrator');
const AgentConfigService    = require('../../platform/AgentConfigService');
const { getAdsServer, getAnalyticsServer, callMcpTool } = require('../../platform/mcpTools');
const { buildSystemPrompt } = require('./prompt');
const { TOOL_SLUG }         = require('./tools');

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

  const rangeArgs = { start_date: startDate, end_date: endDate };

  // ── Pre-fetch: all four sources in parallel ───────────────────────────────────

  emit('Fetching change history, campaign performance, daily trends, and GA4 data…');

  const [adsServer, gaServer] = await Promise.all([
    getAdsServer(orgId),
    getAnalyticsServer(orgId),
  ]);

  const [changeHistory, campaignPerformance, dailyPerformance, sessionsOverview] = await Promise.all([
    callMcpTool(orgId, adsServer, 'ads_get_change_history', {
      ...rangeArgs,
      customer_id: customerId ?? null,
    }).catch((e) => ({ error: e.message })),
    callMcpTool(orgId, adsServer, 'ads_get_campaign_performance', {
      ...rangeArgs,
      customer_id: customerId ?? null,
    }).catch((e) => ({ error: e.message })),
    callMcpTool(orgId, adsServer, 'ads_get_daily_performance', {
      ...rangeArgs,
      customer_id: customerId ?? null,
    }).catch((e) => ({ error: e.message })),
    callMcpTool(orgId, gaServer, 'ga4_get_sessions_overview', rangeArgs)
      .catch((e) => ({ error: e.message })),
  ]);

  // ── Single Claude call — no tools, no loop ────────────────────────────────────

  emit('Analysing change impact…');

  const payload = {
    period: `${startDate} to ${endDate}`,
    changeHistory,
    campaignPerformance,
    dailyPerformance,
    sessionsOverview,
  };

  const userMessage =
    `Analyse changes made to the Google Ads account between ${startDate} and ${endDate}. ` +
    `All data has been pre-fetched below. Identify what changed, when, and what impact each change had.\n\n` +
    `\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;

  const { result, trace, tokensUsed } = await agentOrchestrator.run({
    systemPrompt:  buildSystemPrompt(customerConfig, customerVars),
    userMessage,
    tools:         [],
    maxIterations: 1,
    model:         adminConfig.model      ?? 'claude-sonnet-4-6',
    maxTokens:     adminConfig.max_tokens ?? 8192,
    fallbackModel: adminConfig.fallback_model ?? null,
    onStep:        emit,
    context:       { ...context, startDate, endDate, toolSlug: TOOL_SLUG, customerId },
  });

  return { result, trace, tokensUsed };
}

module.exports = { runGoogleAdsChangeImpact };
