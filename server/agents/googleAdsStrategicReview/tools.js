'use strict';

/**
 * Google Ads Strategic Review — tool definitions.
 *
 * The agent selects which tools to call based on the user's observations.
 * All data fetched via registered MCP servers.
 *
 * Required MCP servers:
 *   - Google Ads       (args include 'google-ads.js')
 *   - Google Analytics (args include 'google-analytics.js')
 */

const { getAdsServer, getAnalyticsServer, callMcpTool, resolveRangeArgs } = require('../../platform/mcpTools');

const TOOL_SLUG = 'google-ads-strategic-review';

const daysSchema = {
  type: 'object',
  properties: {
    days: { type: 'integer', description: 'Days to look back. Defaults to 30.', default: 30 },
  },
  required: [],
};

const getCampaignPerformanceTool = {
  name: 'get_campaign_performance',
  description:
    'Campaign-level totals: impressions, clicks, cost (AUD), conversions, CTR, average CPC, budget. ' +
    'Use to validate observations about campaign efficiency, spend, or conversion rates.',
  input_schema:        daysSchema,
  requiredPermissions: [],
  toolSlug:            TOOL_SLUG,
  async execute(input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_get_campaign_performance', {
      ...resolveRangeArgs(context, input),
      customer_id: context.customerId ?? null,
    });
  },
};

const getDailyPerformanceTool = {
  name: 'get_daily_performance',
  description:
    'Account-level daily metrics: date, impressions, clicks, cost (AUD), conversions. ' +
    'Use to validate observations about trends, day-of-week patterns, or timing.',
  input_schema:        daysSchema,
  requiredPermissions: [],
  toolSlug:            TOOL_SLUG,
  async execute(input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_get_daily_performance', {
      ...resolveRangeArgs(context, input),
      customer_id: context.customerId ?? null,
    });
  },
};

const getSearchTermsTool = {
  name: 'get_search_terms',
  description:
    'Top 50 search queries that triggered ads, by clicks. Returns term, impressions, clicks, cost, conversions, CTR. ' +
    'Use to validate observations about keyword intent, wasted spend, or audience relevance.',
  input_schema:        daysSchema,
  requiredPermissions: [],
  toolSlug:            TOOL_SLUG,
  async execute(input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_get_search_terms', {
      ...resolveRangeArgs(context, input),
      customer_id: context.customerId ?? null,
    });
  },
};

const getPaidBouncedSessionsTool = {
  name: 'get_paid_bounced_sessions',
  description:
    'GA4 paid sessions (cpc medium) grouped by landing page and device: sessions, bounce rate, avg session duration. ' +
    'Use to validate observations about landing page quality, device performance, or post-click behaviour.',
  input_schema:        daysSchema,
  requiredPermissions: [],
  toolSlug:            TOOL_SLUG,
  async execute(input, context) {
    const ga = await getAnalyticsServer(context.orgId);
    return callMcpTool(context.orgId, ga, 'ga4_get_paid_bounced_sessions', resolveRangeArgs(context, input));
  },
};

const googleAdsStrategicReviewTools = [
  getCampaignPerformanceTool,
  getDailyPerformanceTool,
  getSearchTermsTool,
  getPaidBouncedSessionsTool,
];

module.exports = { googleAdsStrategicReviewTools, TOOL_SLUG };
