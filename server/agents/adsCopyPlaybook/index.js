'use strict';

/**
 * Ads Copy Playbook agent — pre-fetch architecture.
 *
 * WHY PRE-FETCH: Data requirements are fixed and enumerable.
 * Receives the selected ads-copy-diagnostic dependency from createAgentRoute,
 * plus fresh RSA copy, asset labels, search terms, and QS scores from the MCP
 * servers. Single Claude call — no ReAct loop.
 *
 * This is Report 2. It prescribes only — it does not re-diagnose.
 * The diagnostic result is passed as context so Claude can reference findings
 * by name without repeating the full analysis.
 */

const { agentOrchestrator } = require('../../platform/AgentOrchestrator');
const AgentConfigService    = require('../../platform/AgentConfigService');
const { getAdsServer, callMcpTool } = require('../../platform/mcpTools');
const { summariseDataGapSources } = require('../../platform/dataGapEvidence');
const { buildSystemPrompt } = require('./prompt');
const { TOOL_SLUG }         = require('./tools');

async function runAdsCopyPlaybook(context) {
  const { orgId, req, emit } = context;

  const adminConfig    = await AgentConfigService.getResolvedAdminConfig(TOOL_SLUG, orgId);
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

  // ── Pre-fetch: dependency + raw copy data in parallel ────────────────────────

  emit('Fetching diagnostic report and ad copy data…');

  const adsServer = await getAdsServer(orgId);

  const [
    adGroupAds,
    assetPerformance,
    searchTermsByAdGroup,
    qualityScores,
  ] = await Promise.all([
    callMcpTool(orgId, adsServer, 'ads_get_ad_group_ads',             { ...cidArgs }).catch((e) => ({ error: e.message })),
    callMcpTool(orgId, adsServer, 'ads_get_ad_asset_performance',      { ...cidArgs }).catch((e) => ({ error: e.message })),
    callMcpTool(orgId, adsServer, 'ads_get_search_terms_by_ad_group',  { ...rangeArgs, ...cidArgs }).catch((e) => ({ error: e.message })),
    callMcpTool(orgId, adsServer, 'ads_get_quality_scores',            { ...cidArgs }).catch((e) => ({ error: e.message })),
  ]);

  // ── Single Claude call — no tools, no loop ────────────────────────────────────

  emit('Generating optimization playbook…');

  const diagnosticDependency = context.reportDependencies?.find((d) => d.slug === 'ads-copy-diagnostic') ?? null;
  const diagnosticResult = diagnosticDependency?.summary ?? null;

  const payload = {
    period: `${startDate} to ${endDate}`,
    diagnosticResult,
    diagnosticDependency: diagnosticDependency
      ? {
          runId: diagnosticDependency.runId,
          status: diagnosticDependency.status,
          runAt: diagnosticDependency.runAt,
          stale: diagnosticDependency.stale,
          ageDays: diagnosticDependency.ageDays,
        }
      : null,
    adGroupAds,
    assetPerformance,
    searchTermsByAdGroup,
    qualityScores,
  };

  const diagNote = diagnosticResult
    ? 'The selected Ad Copy Diagnostic Report dependency is included in diagnosticResult. Treat it as inherited reasoning, not raw source data.'
    : 'No Ad Copy Diagnostic dependency was supplied — halt and state that the required diagnostic report is missing.';

  const userMessage =
    `Produce the Ad Copy Optimization Playbook for the period ${startDate} to ${endDate}. ` +
    `${diagNote} All raw data has been pre-fetched below.\n\n` +
    `\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;

  const { result, trace, tokensUsed } = await agentOrchestrator.run({
    systemPrompt:  buildSystemPrompt(config, companyProfile),
    userMessage:    context.reportDependencyContext ? `${context.reportDependencyContext}\n\n---\n\n${userMessage}` : userMessage,
    tools:         [],
    maxIterations: 1,
    model:         adminConfig.model,
    maxTokens:     adminConfig.max_tokens ?? 8192,
    fallbackModel: adminConfig.fallback_model ?? null,
    onStep:        emit,
    context:       { ...context, startDate, endDate, toolSlug: TOOL_SLUG, customerId },
  });

  return {
    result: {
      ...result,
      data: {
        ...(result.data ?? {}),
        data_gap_sources: summariseDataGapSources({
          diagnosticResult: diagnosticResult ? [diagnosticResult] : [],
          adGroupAds,
          assetPerformance,
          searchTermsByAdGroup,
          qualityScores,
        }),
      },
    },
    trace,
    tokensUsed,
  };
}

module.exports = { runAdsCopyPlaybook };
