'use strict';

/**
 * Google Ads Monitor — tool definitions.
 *
 * All external data is fetched via registered MCP servers (Admin > MCP Servers),
 * not by importing service classes directly. This keeps integrations in one place.
 *
 * Required MCP servers:
 *   - Google Ads   (args include 'google-ads.js')
 *   - Google Analytics (args include 'google-analytics.js')
 */

const { getAdsServer, getAnalyticsServer, callMcpTool, resolveRangeArgs } = require('../../platform/mcpTools');

const TOOL_SLUG = 'google-ads-monitor';

const daysSchema = {
  type: 'object',
  properties: {
    days: {
      type:        'integer',
      description: 'Number of days to look back from today. Defaults to 30.',
      default:     30,
    },
  },
  required: [],
};

const getCampaignPerformanceTool = {
  name: 'get_campaign_performance',
  description:
    'Retrieve performance totals for every enabled Google Ads campaign over the ' +
    'specified date range. Returns one object per campaign with: id, name, status, ' +
    'monthly budget (AUD), impressions, clicks, cost (AUD), conversions, CTR, and ' +
    'average CPC. Use this first to understand which campaigns are running and their ' +
    'overall efficiency.',
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
    'Retrieve account-level daily aggregated metrics: date, impressions, clicks, ' +
    'cost (AUD), and conversions — one row per day ordered by date ASC. ' +
    'Use this to identify trends, spend acceleration, and day-of-week patterns ' +
    'that are invisible in campaign-level totals.',
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
    'Retrieve the top 50 actual user search queries that triggered ads, ordered by ' +
    'clicks DESC. Returns: term, status, impressions, clicks, cost (AUD), conversions, ' +
    'and CTR per term. This is the highest-signal dataset for intent analysis — ' +
    'use it to find converting vs wasted-spend terms, negative keyword candidates, ' +
    'and ad copy opportunities.',
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

const getAnalyticsOverviewTool = {
  name: 'get_analytics_overview',
  description:
    'Retrieve daily GA4 session metrics: date, sessions, activeUsers, newUsers, ' +
    'and bounceRate (decimal fraction, e.g. 0.42 = 42%) — ordered by date ASC. ' +
    'Use this to correlate ad spend trends from get_daily_performance with on-site ' +
    'behaviour, and to identify whether paid traffic quality is improving or declining.',
  input_schema:        daysSchema,
  requiredPermissions: [],
  toolSlug:            TOOL_SLUG,
  async execute(input, context) {
    const ga = await getAnalyticsServer(context.orgId);
    return callMcpTool(context.orgId, ga, 'ga4_get_sessions_overview', resolveRangeArgs(context, input));
  },
};

const googleAdsMonitorTools = [
  getCampaignPerformanceTool,
  getDailyPerformanceTool,
  getSearchTermsTool,
  getAnalyticsOverviewTool,
];

module.exports = { googleAdsMonitorTools, TOOL_SLUG };
