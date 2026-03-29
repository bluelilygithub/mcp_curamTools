'use strict';

/**
 * Google Ads Monitor — tool definitions.
 *
 * context.startDate / context.endDate take priority when set (UI date-range picker).
 * Falls back to context.days (number) then input.days then 30.
 */

const { googleAdsService }       = require('../../services/GoogleAdsService');
const { googleAnalyticsService } = require('../../services/GoogleAnalyticsService');

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

function rangeOrDays(context, input) {
  if (context.startDate && context.endDate) {
    return { startDate: context.startDate, endDate: context.endDate };
  }
  return context.days ?? input.days ?? 30;
}

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
    return googleAdsService.getCampaignPerformance(rangeOrDays(context, input));
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
    return googleAdsService.getDailyPerformance(rangeOrDays(context, input));
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
    return googleAdsService.getSearchTerms(rangeOrDays(context, input));
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
    return googleAnalyticsService.getSessionsOverview(rangeOrDays(context, input));
  },
};

const googleAdsMonitorTools = [
  getCampaignPerformanceTool,
  getDailyPerformanceTool,
  getSearchTermsTool,
  getAnalyticsOverviewTool,
];

module.exports = { googleAdsMonitorTools, TOOL_SLUG };
