'use strict';

/**
 * Google Ads Change Impact — tool definitions.
 *
 * All external data is fetched via registered MCP servers (Admin > MCP Servers).
 *
 * Required MCP servers:
 *   - Google Ads       (args include 'google-ads.js')
 *   - Google Analytics (args include 'google-analytics.js')
 */

const { getAdsServer, getAnalyticsServer, callMcpTool, resolveRangeArgs } = require('../../platform/mcpTools');

const TOOL_SLUG = 'google-ads-change-impact';

const daysSchema = {
  type: 'object',
  properties: {
    days: {
      type:        'integer',
      description: 'Number of days to look back from today. Defaults to 7.',
      default:     7,
    },
  },
  required: [],
};

const getChangeHistoryTool = {
  name: 'get_change_history',
  description:
    'Retrieve recent account change events: bid changes, budget adjustments, ' +
    'status changes (paused/enabled), ad edits, keyword additions/removals. ' +
    'Returns: changedAt, resourceType, changedFields, clientType, operation, ' +
    'and campaignName. Call this first to understand what was changed and when — ' +
    'then compare performance before vs after.',
  input_schema:        daysSchema,
  requiredPermissions: [],
  toolSlug:            TOOL_SLUG,
  async execute(input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_get_change_history', {
      ...resolveRangeArgs(context, input, 7),
      customer_id: context.customerId ?? null,
    });
  },
};

const getCampaignPerformanceTool = {
  name: 'get_campaign_performance',
  description:
    'Retrieve performance totals for all enabled campaigns. Returns id, name, ' +
    'budget (AUD), impressions, clicks, cost (AUD), conversions, CTR, and average CPC. ' +
    'Use this to compare current period metrics against a prior period after a change.',
  input_schema:        daysSchema,
  requiredPermissions: [],
  toolSlug:            TOOL_SLUG,
  async execute(input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_get_campaign_performance', {
      ...resolveRangeArgs(context, input, 7),
      customer_id: context.customerId ?? null,
    });
  },
};

const getDailyPerformanceTool = {
  name: 'get_daily_performance',
  description:
    'Retrieve account-level daily metrics: date, impressions, clicks, cost (AUD), ' +
    'conversions. Use this to pinpoint the exact day performance shifted after a change ' +
    'by looking for discontinuities in the trend.',
  input_schema:        daysSchema,
  requiredPermissions: [],
  toolSlug:            TOOL_SLUG,
  async execute(input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_get_daily_performance', {
      ...resolveRangeArgs(context, input, 7),
      customer_id: context.customerId ?? null,
    });
  },
};

const getAnalyticsOverviewTool = {
  name: 'get_analytics_overview',
  description:
    'Retrieve daily GA4 session metrics: sessions, activeUsers, newUsers, bounceRate. ' +
    'Use this to determine whether a change to ad settings affected on-site behaviour, ' +
    'not just ad metrics.',
  input_schema:        daysSchema,
  requiredPermissions: [],
  toolSlug:            TOOL_SLUG,
  async execute(input, context) {
    const ga = await getAnalyticsServer(context.orgId);
    return callMcpTool(context.orgId, ga, 'ga4_get_sessions_overview', resolveRangeArgs(context, input, 7));
  },
};

const googleAdsChangeImpactTools = [
  getChangeHistoryTool,
  getCampaignPerformanceTool,
  getDailyPerformanceTool,
  getAnalyticsOverviewTool,
];

module.exports = { googleAdsChangeImpactTools, TOOL_SLUG };
