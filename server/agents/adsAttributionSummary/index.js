'use strict';

/**
 * Ads Attribution Summary agent — pre-fetch architecture.
 *
 * WHY PRE-FETCH: All three data sources (campaign performance, GA4 sessions,
 * WordPress enquiries) are fetched unconditionally every run. The ReAct loop
 * added quadratic token cost for a fixed, predictable sequence.
 *
 * Pre-fetch pulls all three sources in parallel in Node.js, passes the complete
 * dataset to Claude in a single message, no tools, no loop.
 *
 * Estimated cost: ~$0.05–$0.10 per run (vs $0.20–$0.50 with ReAct).
 */

const { agentOrchestrator }  = require('../../platform/AgentOrchestrator');
const AgentConfigService     = require('../../platform/AgentConfigService');
const { getAdsServer, getAnalyticsServer, getWordPressServer, callMcpTool } = require('../../platform/mcpTools');
const { buildSystemPrompt }  = require('./prompt');
const { TOOL_SLUG }          = require('./tools');

async function runAdsAttributionSummary(context) {
  const { orgId, req, emit } = context;

  const adminConfig = await AgentConfigService.getAdminConfig(TOOL_SLUG);

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
  const rangeArgs  = { start_date: startDate, end_date: endDate };

  // ── Pre-fetch: all three sources in parallel ──────────────────────────────────

  emit('Fetching campaign performance, GA4 sessions, and CRM enquiries…');

  const [adsServer, gaServer, wpServer] = await Promise.all([
    getAdsServer(orgId),
    getAnalyticsServer(orgId),
    getWordPressServer(orgId),
  ]);

  const [campaignPerformance, sessionsOverview, enquiries] = await Promise.all([
    callMcpTool(orgId, adsServer, 'ads_get_campaign_performance', {
      ...rangeArgs,
      customer_id: customerId ?? null,
    }).catch((e) => ({ error: e.message })),
    callMcpTool(orgId, gaServer, 'ga4_get_sessions_overview', rangeArgs)
      .catch((e) => ({ error: e.message })),
    callMcpTool(orgId, wpServer, 'wp_get_enquiries', {
      per_page:   200,
      start_date: startDate,
      end_date:   endDate,
    }).catch((e) => ({ error: e.message })),
  ]);

  // ── Single Claude call — no tools, no loop ────────────────────────────────────

  emit('Building attribution summary…');

  const payload = {
    period: `${startDate} to ${endDate}`,
    campaignPerformance,
    sessionsOverview,
    enquiries,
  };

  const userMessage =
    `Produce an attribution summary for the period ${startDate} to ${endDate}. ` +
    `All data has been pre-fetched below. Write the cross-channel summary as instructed.\n\n` +
    `\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;

  const { result, trace, tokensUsed } = await agentOrchestrator.run({
    systemPrompt:  buildSystemPrompt(),
    userMessage,
    tools:         [],
    maxIterations: 1,
    model:         adminConfig.model      ?? 'claude-sonnet-4-6',
    maxTokens:     adminConfig.max_tokens ?? 4096,
    fallbackModel: adminConfig.fallback_model ?? null,
    onStep:        emit,
    context:       { ...context, startDate, endDate, toolSlug: TOOL_SLUG, customerId },
  });

  return { result, trace, tokensUsed };
}

module.exports = { runAdsAttributionSummary };
