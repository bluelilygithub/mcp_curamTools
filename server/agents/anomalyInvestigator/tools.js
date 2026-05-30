'use strict';

/**
 * Anomaly Investigator — tool suite.
 *
 * Full cross-source coverage: Google Ads, GA4, WordPress CRM.
 * Tool selection is deliberately investigation-specific — includes quality scores
 * (not in conversation agent) and excludes tools irrelevant to anomaly diagnosis
 * (budget pacing, ad copy, knowledge base).
 *
 * Tool descriptions guide hypothesis formation, not execution sequence.
 * The agent chooses which tools to call based on what it finds — not because
 * the prompt listed them.
 */

const {
  getAdsServer,
  getAnalyticsServer,
  getWordPressServer,
  callMcpTool,
  resolveRangeArgs,
} = require('../../platform/mcpTools');
const AgentConfigService = require('../../platform/AgentConfigService');

async function applyFieldExclusions(records, orgId) {
  if (!Array.isArray(records) || records.length === 0) return records;
  const { excluded_fields: excluded = [] } = await AgentConfigService.getCrmPrivacySettings(orgId);
  if (excluded.length === 0) return records;
  return records.map((record) => {
    const clean = { ...record };
    for (const field of excluded) delete clean[field];
    return clean;
  });
}

const TOOL_SLUG = 'anomaly-investigator';

const daysSchema = {
  type: 'object',
  properties: {
    days:       { type: 'integer', description: 'Days to look back. Defaults to 30.', default: 30 },
    start_date: { type: 'string',  description: 'Range start YYYY-MM-DD. Use with end_date.' },
    end_date:   { type: 'string',  description: 'Range end YYYY-MM-DD. Use with start_date.' },
  },
  required: [],
};

function resolveArgs(context, input) {
  if (input.start_date && input.end_date) return { start_date: input.start_date, end_date: input.end_date };
  return resolveRangeArgs(context, input);
}

// ── Google Ads ────────────────────────────────────────────────────────────────

const getCampaignPerformanceTool = {
  name: 'get_campaign_performance',
  description: 'Campaign totals: impressions, clicks, cost (AUD), conversions, CTR, avg CPC, budget. Best first tool for any performance anomaly — broadest picture across all campaigns in one call.',
  input_schema: daysSchema, requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_get_campaign_performance', {
      ...resolveArgs(context, input), customer_id: context.customerId ?? null,
    });
  },
};

const getDailyPerformanceTool = {
  name: 'get_daily_performance',
  description: 'Account-level daily metrics: impressions, clicks, cost, conversions by date (ordered ASC). Use to pinpoint exactly when an anomaly started or to identify day-of-week patterns.',
  input_schema: daysSchema, requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_get_daily_performance', {
      ...resolveArgs(context, input), customer_id: context.customerId ?? null,
    });
  },
};

const getImpressionShareTool = {
  name: 'get_impression_share',
  description: 'Impression share per campaign: share won, lost to rank, lost to budget, top-of-page rate. Use to test whether a visibility drop is caused by budget exhaustion (lost to budget) or Quality Score decline (lost to rank).',
  input_schema: daysSchema, requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_get_impression_share_by_campaign', {
      ...resolveArgs(context, input), customer_id: context.customerId ?? null,
    });
  },
};

const getAuctionInsightsTool = {
  name: 'get_auction_insights',
  description: 'Competitor domains in the same auctions: impression share, top-of-page rate, outranking share. Use to test whether a competitor entered or increased aggression — look for new domains or rising impression share.',
  input_schema: daysSchema, requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_get_auction_insights', {
      ...resolveArgs(context, input), customer_id: context.customerId ?? null,
    });
  },
};

const getSearchTermsTool = {
  name: 'get_search_terms',
  description: 'Top 50 search queries by clicks: term, impressions, clicks, cost, conversions, CTR. Use to identify intent shifts, new irrelevant queries draining budget, or high-cost terms with zero conversions.',
  input_schema: daysSchema, requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_get_search_terms', {
      ...resolveArgs(context, input), customer_id: context.customerId ?? null,
    });
  },
};

const getQualityScoresTool = {
  name: 'get_quality_scores',
  description: 'Quality Score components for all active keywords: expected CTR, ad relevance, landing page experience — each rated BELOW_AVERAGE / AVERAGE / ABOVE_AVERAGE. Use when impression share is lost to rank — identifies whether the root cause is ad quality, landing page, or expected CTR.',
  input_schema: { type: 'object', properties: {}, required: [] },
  requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(_input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_get_quality_scores', { customer_id: context.customerId ?? null });
  },
};

const getChangeHistoryTool = {
  name: 'get_change_history',
  description: 'Recent account changes: bids, budgets, paused/enabled campaigns and keywords, ad edits. Use when an anomaly aligns with a specific date — to find what was changed on or just before that date.',
  input_schema: daysSchema, requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_get_change_history', {
      ...resolveArgs(context, input), customer_id: context.customerId ?? null,
    });
  },
};

// ── GA4 ───────────────────────────────────────────────────────────────────────

const getSessionsOverviewTool = {
  name: 'get_sessions_overview',
  description: 'Daily GA4 sessions, active users, bounce rate. Use to confirm whether an Ads-side anomaly (CTR, clicks) corresponds to a real traffic drop, or whether clicks arrived but bounced — distinguishing pre-click from post-click problems.',
  input_schema: daysSchema, requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const ga = await getAnalyticsServer(context.orgId);
    return callMcpTool(context.orgId, ga, 'ga4_get_sessions_overview', resolveArgs(context, input));
  },
};

const getLandingPagePerformanceTool = {
  name: 'get_landing_page_performance',
  description: 'Top 20 landing pages: sessions, conversions, bounce rate, avg session duration. Use when testing whether a conversion rate collapse is landing page-specific — a broken or slow page shows elevated bounce only on that URL.',
  input_schema: daysSchema, requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const ga = await getAnalyticsServer(context.orgId);
    return callMcpTool(context.orgId, ga, 'ga4_get_landing_page_performance', resolveArgs(context, input));
  },
};

const getPaidBouncedSessionsTool = {
  name: 'get_paid_bounced_sessions',
  description: 'Paid (cpc) sessions by landing page and device: sessions, bounce rate, avg duration. Use to test device-specific hypotheses — mobile CTR collapse with high mobile bounce points to a mobile UX issue rather than an ad quality issue.',
  input_schema: daysSchema, requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const ga = await getAnalyticsServer(context.orgId);
    return callMcpTool(context.orgId, ga, 'ga4_get_paid_bounced_sessions', resolveArgs(context, input));
  },
};

const getConversionEventsTool = {
  name: 'get_conversion_events',
  description: 'Conversion events by name and date: event count and conversion count. Use when conversion rate collapsed suddenly — a tracking failure (event count drops to zero) looks identical to a real conversion collapse until you check this.',
  input_schema: daysSchema, requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const ga = await getAnalyticsServer(context.orgId);
    return callMcpTool(context.orgId, ga, 'ga4_get_conversion_events', resolveArgs(context, input));
  },
};

// ── WordPress CRM ─────────────────────────────────────────────────────────────

const getEnquiriesTool = {
  name: 'get_enquiries',
  description: 'CRM lead records: UTM attribution, device type, landing page, enquiry status, gclid. Use when Ads and GA4 metrics look normal but business outcomes changed — to check whether enquiry volume or source mix shifted independently of click data. CRM has years of history; Google Ads/GA4 data starts March 2026.',
  input_schema: {
    type: 'object',
    properties: {
      limit:      { type: 'integer', description: 'Max records to return. Default 500.' },
      start_date: { type: 'string',  description: 'On or after this date (YYYY-MM-DD).' },
      end_date:   { type: 'string',  description: 'On or before this date (YYYY-MM-DD).' },
    },
    required: [],
  },
  requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const wp = await getWordPressServer(context.orgId);
    const result = await callMcpTool(context.orgId, wp, 'wp_get_enquiries', {
      limit:      input.limit      ?? 500,
      start_date: input.start_date ?? undefined,
      end_date:   input.end_date   ?? undefined,
    });
    return applyFieldExclusions(result, context.orgId);
  },
};

const getEnquiryDetailsTool = {
  name: 'get_enquiry_details',
  description: 'Extended CRM records with sales pipeline fields: final_value, contacted_date, sales_rep, package_type. Use when investigating conversion rate or close rate shifts — to distinguish a lead quality problem from a follow-up speed problem.',
  input_schema: {
    type: 'object',
    properties: {
      limit:      { type: 'integer', description: 'Max records. Default 500.' },
      start_date: { type: 'string',  description: 'On or after this date (YYYY-MM-DD).' },
      end_date:   { type: 'string',  description: 'On or before this date (YYYY-MM-DD).' },
      status:     { type: 'string',  description: 'Filter by enquiry_status value.' },
    },
    required: [],
  },
  requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const wp = await getWordPressServer(context.orgId);
    const result = await callMcpTool(context.orgId, wp, 'wp_get_enquiry_details', {
      limit:      input.limit      ?? 500,
      start_date: input.start_date ?? undefined,
      end_date:   input.end_date   ?? undefined,
      status:     input.status     ?? undefined,
    });
    return applyFieldExclusions(result, context.orgId);
  },
};

const anomalyInvestigatorTools = [
  // Google Ads — investigation-relevant subset (includes quality scores; excludes budget pacing, ad copy)
  getCampaignPerformanceTool,
  getDailyPerformanceTool,
  getImpressionShareTool,
  getAuctionInsightsTool,
  getSearchTermsTool,
  getQualityScoresTool,
  getChangeHistoryTool,
  // GA4 — full post-click picture
  getSessionsOverviewTool,
  getLandingPagePerformanceTool,
  getPaidBouncedSessionsTool,
  getConversionEventsTool,
  // CRM — business outcome layer
  getEnquiriesTool,
  getEnquiryDetailsTool,
];

module.exports = { anomalyInvestigatorTools, TOOL_SLUG };
