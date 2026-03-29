'use strict';

/**
 * Google Ads Change Impact — tool definitions.
 *
 * Includes get_change_history (not present in other agents) alongside
 * the standard performance tools for before/after comparison.
 */

const { googleAdsService }       = require('../../services/GoogleAdsService');
const { googleAnalyticsService } = require('../../services/GoogleAnalyticsService');

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

function rangeOrDays(context, input, defaultDays = 7) {
  if (context.startDate && context.endDate) {
    return { startDate: context.startDate, endDate: context.endDate };
  }
  return context.days ?? input.days ?? defaultDays;
}

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
    return googleAdsService.getChangeHistory(rangeOrDays(context, input, 7), context.customerId ?? null);
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
    return googleAdsService.getCampaignPerformance(rangeOrDays(context, input, 7), context.customerId ?? null);
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
    return googleAdsService.getDailyPerformance(rangeOrDays(context, input, 7), context.customerId ?? null);
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
    return googleAnalyticsService.getSessionsOverview(rangeOrDays(context, input, 7));
  },
};

const googleAdsChangeImpactTools = [
  getChangeHistoryTool,
  getCampaignPerformanceTool,
  getDailyPerformanceTool,
  getAnalyticsOverviewTool,
];

module.exports = { googleAdsChangeImpactTools, TOOL_SLUG };
