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

  // Resolve servers gracefully — if a server isn't registered for this org,
  // return null and fall back to an informative error message in the payload
  // rather than aborting the entire run.
  const [gaServer, wpServer] = await Promise.all([
    getAnalyticsServer(orgId).catch(() => null),
    getWordPressServer(orgId).catch(() => null),
  ]);

  const NOT_CONFIGURED = (source) =>
    ({ error: `${source} MCP server is not configured for this organisation. Contact your admin to set it up under Admin › MCP Servers.` });

  const [rawEnquiries, rawNotInterested, trafficSources, landingPages] = await Promise.all([
    wpServer
      ? callMcpTool(orgId, wpServer, 'wp_get_enquiries', {
          per_page:   2000,
          start_date: startDate,
          end_date:   endDate,
        }).catch((e) => ({ error: e.message }))
      : Promise.resolve(NOT_CONFIGURED('WordPress')),

    wpServer
      ? callMcpTool(orgId, wpServer, 'wp_get_not_interested_reasons', {})
          .catch((e) => ({ error: e.message }))
      : Promise.resolve(NOT_CONFIGURED('WordPress')),

    gaServer
      ? callMcpTool(orgId, gaServer, 'ga4_get_traffic_sources', rangeArgs)
          .catch((e) => ({ error: e.message }))
      : Promise.resolve(NOT_CONFIGURED('Google Analytics')),

    gaServer
      ? callMcpTool(orgId, gaServer, 'ga4_get_landing_page_performance', rangeArgs)
          .catch((e) => ({ error: e.message }))
      : Promise.resolve(NOT_CONFIGURED('Google Analytics')),
  ]);

  // ── Aggregate CRM data in Node.js before passing to Claude ───────────────
  // Raw records can number in the thousands. Sending them verbatim blows the
  // context window. Aggregate here and pass compact summaries instead.

  emit('Aggregating lead data…');

  const enquiries        = aggregateEnquiries(rawEnquiries, startDate, endDate);
  const notInterestedReasons = aggregateNotInterested(rawNotInterested, startDate, endDate);

  // ── Single Claude call ────────────────────────────────────────────────────

  emit('Analysing lead intelligence…');

  const payload = {
    period:              `${startDate} to ${endDate}`,
    enquirySummary:      enquiries,
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

// ── Aggregation helpers ───────────────────────────────────────────────────────

function countBy(arr, key) {
  const out = {};
  for (const item of arr) {
    const val = item[key] ?? '(none)';
    out[val] = (out[val] ?? 0) + 1;
  }
  return out;
}

function topN(counts, n) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .reduce((acc, [k, v]) => { acc[k] = v; return acc; }, {});
}

/**
 * Reduce raw enquiry records to a compact summary object.
 * Raw records can number in the thousands — sending them verbatim overflows the
 * context window. This produces a token-efficient summary instead.
 */
function aggregateEnquiries(raw, startDate, endDate) {
  if (!raw || !Array.isArray(raw)) return raw; // pass through error objects

  const total         = raw.length;
  const byStatus      = countBy(raw, 'enquiry_status');
  const byDevice      = countBy(raw, 'device_type');
  const bySource      = topN(countBy(raw, 'utm_source'),   10);
  const byMedium      = topN(countBy(raw, 'utm_medium'),   10);
  const byCampaign    = topN(countBy(raw, 'utm_campaign'), 10);
  const topSearchTerms  = topN(countBy(raw, 'search_term'),   20);
  const topLandingPages = topN(countBy(raw, 'landing_page'),  15);

  return {
    total,
    period: `${startDate} to ${endDate}`,
    byStatus,
    byDevice,
    bySource,
    byMedium,
    byCampaign,
    topSearchTerms,
    topLandingPages,
  };
}

/**
 * Reduce raw not-interested reason records to a compact summary.
 * The full history can be large; we only pass aggregated counts to Claude.
 */
function aggregateNotInterested(raw, startDate, endDate) {
  if (!raw || !Array.isArray(raw)) return raw; // pass through error objects

  const total     = raw.length;
  const byReason  = topN(countBy(raw, 'reason'), 20);

  return { total, period: `${startDate} to ${endDate}`, byReason };
}
