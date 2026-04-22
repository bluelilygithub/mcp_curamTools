'use strict';

/**
 * Ads Copy Diagnostic agent — pre-fetch architecture.
 *
 * WHY PRE-FETCH: All data sources (RSA ads, asset performance, ad group performance,
 * search terms by ad group, quality scores, GA4 landing page + bounce data) are
 * fetched unconditionally every run. The sequence is fixed and enumerable — no ReAct loop needed.
 *
 * Pre-fetch pulls all sources in parallel, passes the complete dataset to Claude
 * in a single message, no tools, no loop.
 *
 * Estimated cost: ~$0.15–$0.40 per run (larger payload than monitor but still far
 * cheaper than a ReAct loop over this many sources).
 */

const { agentOrchestrator } = require('../../platform/AgentOrchestrator');
const AgentConfigService    = require('../../platform/AgentConfigService');
const { getAdsServer, getAnalyticsServer, callMcpTool } = require('../../platform/mcpTools');
const { buildSystemPrompt } = require('./prompt');
const { TOOL_SLUG }         = require('./tools');

async function runAdsCopyDiagnostic(context) {
  const { orgId, req, emit } = context;

  const adminConfig    = await AgentConfigService.getAdminConfig(TOOL_SLUG);
  const config         = await AgentConfigService.getAgentConfig(orgId, TOOL_SLUG);
  const companyProfile = await AgentConfigService.getCompanyProfile(orgId);

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

  const customerId = req?.body?.customerId ?? null;
  const rangeArgs  = { start_date: startDate, end_date: endDate };
  const cidArgs    = { customer_id: customerId ?? null };

  // ── Pre-fetch: all sources in parallel ────────────────────────────────────────

  emit('Fetching ad copy, asset performance, quality scores, search terms, and GA4 data…');

  const [adsServer, gaServer] = await Promise.all([
    getAdsServer(orgId),
    getAnalyticsServer(orgId),
  ]);

  const [
    adGroupAds,
    assetPerformance,
    adGroupPerformance,
    searchTermsByAdGroup,
    qualityScores,
    landingPagePerformance,
    paidBouncedSessions,
  ] = await Promise.all([
    callMcpTool(orgId, adsServer, 'ads_get_ad_group_ads',          { ...cidArgs }).catch((e) => ({ error: e.message })),
    callMcpTool(orgId, adsServer, 'ads_get_ad_asset_performance',   { ...cidArgs }).catch((e) => ({ error: e.message })),
    callMcpTool(orgId, adsServer, 'ads_get_ad_group_performance',   { ...rangeArgs, ...cidArgs }).catch((e) => ({ error: e.message })),
    callMcpTool(orgId, adsServer, 'ads_get_search_terms_by_ad_group', { ...rangeArgs, ...cidArgs }).catch((e) => ({ error: e.message })),
    callMcpTool(orgId, adsServer, 'ads_get_quality_scores',         { ...cidArgs }).catch((e) => ({ error: e.message })),
    callMcpTool(orgId, gaServer,  'ga4_get_landing_page_performance', rangeArgs).catch((e) => ({ error: e.message })),
    callMcpTool(orgId, gaServer,  'ga4_get_paid_bounced_sessions',  rangeArgs).catch((e) => ({ error: e.message })),
  ]);

  // ── Single Claude call — no tools, no loop ────────────────────────────────────

  emit('Analysing ad copy across all active campaigns…');

  const payload = {
    period: `${startDate} to ${endDate}`,
    adGroupAds,
    assetPerformance,
    adGroupPerformance,
    searchTermsByAdGroup,
    qualityScores,
    landingPagePerformance,
    paidBouncedSessions,
  };

  const userMessage =
    `Conduct a full ad copy diagnostic for the period ${startDate} to ${endDate}. ` +
    `All data has been pre-fetched below. Produce the complete diagnostic report.\n\n` +
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
    context:       { ...context, startDate, endDate, toolSlug: TOOL_SLUG, customerId },
  });

  return { result, trace, tokensUsed };
}

module.exports = { runAdsCopyDiagnostic };
