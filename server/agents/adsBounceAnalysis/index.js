'use strict';

/**
 * Ads Bounce Analysis agent — pre-fetch architecture.
 *
 * WHY PRE-FETCH: Both data sources (search terms + paid bounced sessions) are
 * fetched unconditionally every run. The ReAct loop added quadratic token cost
 * (tool results re-sent each iteration) for no benefit — the sequence is fixed.
 *
 * Pre-fetch fetches both sources in parallel in Node.js, passes the complete
 * dataset to Claude in a single message, no tools, no loop.
 *
 * Estimated cost: ~$0.05–$0.10 per run (vs $0.20–$0.40 with ReAct).
 */

const { agentOrchestrator } = require('../../platform/AgentOrchestrator');
const AgentConfigService    = require('../../platform/AgentConfigService');
const { getAdsServer, getAnalyticsServer, callMcpTool } = require('../../platform/mcpTools');
const { buildSystemPrompt } = require('./prompt');
const { TOOL_SLUG }         = require('./tools');

async function runAdsBounceAnalysis(context) {
  const { orgId, req, emit } = context;

  const adminConfig   = await AgentConfigService.getAdminConfig(TOOL_SLUG);
  const monitorConfig = await AgentConfigService.getAgentConfig(orgId, 'google-ads-monitor');

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

  const customerId  = req?.body?.customerId ?? null;
  const rangeArgs   = { start_date: startDate, end_date: endDate };

  // ── Pre-fetch: both sources in parallel ──────────────────────────────────────

  emit('Fetching search terms and paid bounce data…');

  const [adsServer, gaServer] = await Promise.all([
    getAdsServer(orgId),
    getAnalyticsServer(orgId),
  ]);

  const [searchTerms, paidBouncedSessions] = await Promise.all([
    callMcpTool(orgId, adsServer, 'ads_get_search_terms', {
      ...rangeArgs,
      customer_id: customerId ?? null,
    }).catch((e) => ({ error: e.message })),
    callMcpTool(orgId, gaServer, 'ga4_get_paid_bounced_sessions', rangeArgs)
      .catch((e) => ({ error: e.message })),
  ]);

  // ── Single Claude call — no tools, no loop ────────────────────────────────────

  emit('Analysing bounce patterns…');

  const payload = {
    period: `${startDate} to ${endDate}`,
    searchTerms,
    paidBouncedSessions,
  };

  const userMessage =
    `Analyse paid keyword bounce behaviour for the period ${startDate} to ${endDate}. ` +
    `All data has been pre-fetched below. Produce the full bounce analysis report.\n\n` +
    `\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;

  const { result, trace, tokensUsed } = await agentOrchestrator.run({
    systemPrompt:  buildSystemPrompt(monitorConfig),
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

module.exports = { runAdsBounceAnalysis };
