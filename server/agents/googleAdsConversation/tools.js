'use strict';

/**
 * Google Ads Conversation — full tool suite.
 *
 * All data via registered MCP servers — Google Ads, Google Analytics, and WordPress CRM.
 * The conversation agent has access to every data dimension so it can
 * answer any question the user asks across the thread.
 *
 * Required MCP servers:
 *   - Google Ads       (args include 'google-ads.js')
 *   - Google Analytics (args include 'google-analytics.js')
 *   - WordPress        (args include 'wordpress.js')
 *
 * DATA COVERAGE NOTE:
 *   Google Ads and GA4 data: available from ~March 2026 onwards only.
 *   WordPress CRM enquiries: 3 years of history available.
 *   Do NOT cross-reference CRM data with Google data for periods before March 2026.
 */

const { getAdsServer, getAnalyticsServer, getWordPressServer, callMcpTool, resolveRangeArgs } = require('../../platform/mcpTools');

const TOOL_SLUG = 'google-ads-conversation';

const daysSchema = {
  type: 'object',
  properties: {
    days: { type: 'integer', description: 'Days to look back. Defaults to 30.', default: 30 },
    start_date: { type: 'string', description: 'Range start YYYY-MM-DD. Use with end_date.' },
    end_date:   { type: 'string', description: 'Range end YYYY-MM-DD. Use with start_date.' },
  },
  required: [],
};

function resolveConvArgs(context, input) {
  if (input.start_date && input.end_date) return { start_date: input.start_date, end_date: input.end_date };
  return resolveRangeArgs(context, input);
}

// ── Google Ads tools ──────────────────────────────────────────────────────────

const getCampaignPerformanceTool = {
  name: 'get_campaign_performance',
  description: 'Campaign totals: impressions, clicks, cost (AUD), conversions, CPA, CTR, avg CPC, budget. Call for any question about campaign efficiency, spend, or conversion rates.',
  input_schema: daysSchema, requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_get_campaign_performance', {
      ...resolveConvArgs(context, input), customer_id: context.customerId ?? null,
    });
  },
};

const getDailyPerformanceTool = {
  name: 'get_daily_performance',
  description: 'Account-level daily metrics: date, impressions, clicks, cost, conversions. Use for trend, pacing, or day-of-week questions.',
  input_schema: daysSchema, requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_get_daily_performance', {
      ...resolveConvArgs(context, input), customer_id: context.customerId ?? null,
    });
  },
};

const getSearchTermsTool = {
  name: 'get_search_terms',
  description: 'Top 50 search queries that triggered ads by clicks. Use for intent, wasted spend, negative keyword, or ad relevance questions.',
  input_schema: daysSchema, requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_get_search_terms', {
      ...resolveConvArgs(context, input), customer_id: context.customerId ?? null,
    });
  },
};

const getBudgetPacingTool = {
  name: 'get_budget_pacing',
  description: 'Current month spend vs monthly budget per campaign. Use for budget questions or to check if a campaign is on track.',
  input_schema: { type: 'object', properties: {}, required: [] },
  requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(_input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_get_budget_pacing', { customer_id: context.customerId ?? null });
  },
};

const getAuctionInsightsTool = {
  name: 'get_auction_insights',
  description: 'Competitor domains in the same auctions: impression share, top-of-page rate, abs. top rate, outranking share. Use for competitor or visibility questions.',
  input_schema: daysSchema, requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_get_auction_insights', {
      ...resolveConvArgs(context, input), customer_id: context.customerId ?? null,
    });
  },
};

const getImpressionShareTool = {
  name: 'get_impression_share',
  description: 'Own impression share per campaign: share won, lost to rank, lost to budget. Use to diagnose visibility loss or budget vs quality issues.',
  input_schema: daysSchema, requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_get_impression_share_by_campaign', {
      ...resolveConvArgs(context, input), customer_id: context.customerId ?? null,
    });
  },
};

const getActiveKeywordsTool = {
  name: 'get_active_keywords',
  description: 'All active keywords with match type, bid (AUD), campaign, and ad group. Use for keyword strategy, gap analysis, or bid questions.',
  input_schema: { type: 'object', properties: {}, required: [] },
  requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(_input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_get_active_keywords', { customer_id: context.customerId ?? null });
  },
};

const getChangeHistoryTool = {
  name: 'get_change_history',
  description: 'Recent account changes: bids, budgets, paused/enabled, ad edits, keyword changes. Use for any question about what changed recently.',
  input_schema: daysSchema, requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_get_change_history', {
      ...resolveConvArgs(context, input), customer_id: context.customerId ?? null,
    });
  },
};

// ── GA4 tools ─────────────────────────────────────────────────────────────────

const getSessionsOverviewTool = {
  name: 'get_sessions_overview',
  description: 'Daily GA4 sessions, active users, new users, bounce rate. Use for traffic trend or overall site health questions.',
  input_schema: daysSchema, requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const ga = await getAnalyticsServer(context.orgId);
    return callMcpTool(context.orgId, ga, 'ga4_get_sessions_overview', resolveConvArgs(context, input));
  },
};

const getTrafficSourcesTool = {
  name: 'get_traffic_sources',
  description: 'Sessions, conversions, and revenue by channel (Paid Search, Organic, Direct, etc.). Use for channel mix or ROI comparison questions.',
  input_schema: daysSchema, requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const ga = await getAnalyticsServer(context.orgId);
    return callMcpTool(context.orgId, ga, 'ga4_get_traffic_sources', resolveConvArgs(context, input));
  },
};

const getLandingPagePerformanceTool = {
  name: 'get_landing_page_performance',
  description: 'Top 20 landing pages: sessions, conversions, bounce rate, avg session duration. Use for landing page quality or CRO questions.',
  input_schema: daysSchema, requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const ga = await getAnalyticsServer(context.orgId);
    return callMcpTool(context.orgId, ga, 'ga4_get_landing_page_performance', resolveConvArgs(context, input));
  },
};

const getPaidBouncedSessionsTool = {
  name: 'get_paid_bounced_sessions',
  description: 'Paid (cpc) sessions grouped by landing page + device: sessions, bounce rate, avg duration. Use for paid traffic quality or device-specific questions.',
  input_schema: daysSchema, requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const ga = await getAnalyticsServer(context.orgId);
    return callMcpTool(context.orgId, ga, 'ga4_get_paid_bounced_sessions', resolveConvArgs(context, input));
  },
};

const getConversionEventsTool = {
  name: 'get_conversion_events',
  description: 'Conversion events by name and date: event count and conversion count. Use for conversion tracking or funnel questions.',
  input_schema: daysSchema, requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const ga = await getAnalyticsServer(context.orgId);
    return callMcpTool(context.orgId, ga, 'ga4_get_conversion_events', resolveConvArgs(context, input));
  },
};

// ── WordPress / CRM tools ─────────────────────────────────────────────────────

const getEnquiriesTool = {
  name: 'get_enquiries',
  description: 'CRM enquiry/lead records from WordPress. Includes UTM source, medium, campaign, ad group, search term, device type, landing page, gclid, GA4 client ID, and enquiry status. Up to 3 years of history. Use for lead volume, lead quality, campaign-to-lead attribution, or any question about what happened after the click. NOTE: this CRM data predates Google Ads tracking — do not attempt to join it with Ads/GA4 metrics for periods before March 2026.',
  input_schema: {
    type: 'object',
    properties: {
      limit:  { type: 'integer', description: 'Max records to return. Default 100.', default: 100 },
      status: { type: 'string',  description: 'Filter by enquiry_status value if known.' },
    },
    required: [],
  },
  requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const wp = await getWordPressServer(context.orgId);
    return callMcpTool(context.orgId, wp, 'wp_get_enquiries', {
      limit:  input.limit  ?? 100,
      status: input.status ?? undefined,
    });
  },
};

const googleAdsConversationTools = [
  getCampaignPerformanceTool,
  getDailyPerformanceTool,
  getSearchTermsTool,
  getBudgetPacingTool,
  getAuctionInsightsTool,
  getImpressionShareTool,
  getActiveKeywordsTool,
  getChangeHistoryTool,
  getSessionsOverviewTool,
  getTrafficSourcesTool,
  getLandingPagePerformanceTool,
  getPaidBouncedSessionsTool,
  getConversionEventsTool,
  getEnquiriesTool,
];

module.exports = { googleAdsConversationTools, TOOL_SLUG };
