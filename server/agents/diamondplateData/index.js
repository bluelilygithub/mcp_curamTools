'use strict';

/**
 * DiamondPlate Data — CRM lead intelligence agent.
 *
 * Pre-fetch architecture: four sources fetched in parallel in Node.js,
 * passed to Claude in a single call. No ReAct loop — data requirements are fixed.
 *
 * Sources:
 *   1. WordPress CRM enquiries (filtered by date range)
 *   2. WordPress not-interested reasons (full history — date filter applied client-side by Claude)
 *   3. GA4 traffic sources (sessions by channel for the period)
 *   4. GA4 landing page performance (top pages by sessions)
 *
 * The WordPress CRM has years of history, making this the only tool on the platform
 * that provides meaningful year-on-year or long-range trend analysis.
 */

const { agentOrchestrator }  = require('../../platform/AgentOrchestrator');
const AgentConfigService     = require('../../platform/AgentConfigService');
const { getAnalyticsServer, getWordPressServer, callMcpTool } = require('../../platform/mcpTools');
const { buildSystemPrompt }  = require('./prompt');
const { TOOL_SLUG }          = require('./tools');

async function runDiamondplateData(context) {
  const { orgId, req, emit } = context;

  const config = Object.keys(context.config ?? {}).length > 0
    ? context.config
    : await AgentConfigService.getAgentConfig(orgId, TOOL_SLUG);

  const adminConfig = Object.keys(context.adminConfig ?? {}).length > 0
    ? context.adminConfig
    : await AgentConfigService.getAdminConfig(TOOL_SLUG);

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

  const rangeArgs = { start_date: startDate, end_date: endDate };

  // ── Pre-fetch: all four sources in parallel ───────────────────────────────

  emit('Fetching CRM enquiries, not-interested reasons, GA4 traffic, and landing page data…');

  const [gaServer, wpServer] = await Promise.all([
    getAnalyticsServer(orgId),
    getWordPressServer(orgId),
  ]);

  // CRM enquiry limit: up to 2000 records for the date range.
  // The not-interested reasons fetch has no date filter in the MCP tool —
  // Claude will be instructed to focus on the period.
  const [enquiries, notInterestedReasons, trafficSources, landingPages] = await Promise.all([
    callMcpTool(orgId, wpServer, 'wp_get_enquiries', {
      per_page:   2000,
      start_date: startDate,
      end_date:   endDate,
    }).catch((e) => ({ error: e.message })),

    callMcpTool(orgId, wpServer, 'wp_get_not_interested_reasons', {})
      .catch((e) => ({ error: e.message })),

    callMcpTool(orgId, gaServer, 'ga4_get_traffic_sources', rangeArgs)
      .catch((e) => ({ error: e.message })),

    callMcpTool(orgId, gaServer, 'ga4_get_landing_page_performance', rangeArgs)
      .catch((e) => ({ error: e.message })),
  ]);

  // ── Single Claude call ────────────────────────────────────────────────────

  emit('Analysing lead intelligence…');

  const payload = {
    period:              `${startDate} to ${endDate}`,
    enquiries,
    notInterestedReasons,
    ga4TrafficSources:   trafficSources,
    ga4LandingPages:     landingPages,
  };

  const userMessage =
    `Produce the DiamondPlate Data lead intelligence report for the period ${startDate} to ${endDate}. ` +
    `All data has been pre-fetched below. Focus on the CRM enquiry data as the primary source of truth — ` +
    `GA4 data provides supporting context for traffic volume and landing page behaviour.\n\n` +
    `\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;

  const { result, trace, tokensUsed } = await agentOrchestrator.run({
    systemPrompt:  buildSystemPrompt(config),
    userMessage,
    tools:         [],
    maxIterations: 1,
    model:         adminConfig.model      ?? 'claude-sonnet-4-6',
    maxTokens:     adminConfig.max_tokens ?? 6144,
    fallbackModel: adminConfig.fallback_model ?? null,
    onStep:        emit,
    context:       { ...context, startDate, endDate, toolSlug: TOOL_SLUG },
  });

  return { result, trace, tokensUsed };
}

module.exports = { runDiamondplateData };
