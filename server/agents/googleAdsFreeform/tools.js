'use strict';

/**
 * Google Ads Freeform — tool definitions.
 *
 * Same four data tools as the monitor. TOOL_SLUG is different so usage
 * is tracked separately and config is stored independently.
 */

const { googleAdsService }       = require('../../services/GoogleAdsService');
const { googleAnalyticsService } = require('../../services/GoogleAnalyticsService');

const TOOL_SLUG = 'google-ads-freeform';

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
    'Retrieve performance totals for every enabled Google Ads campaign. ' +
    'Returns id, name, status, budget (AUD), impressions, clicks, cost (AUD), ' +
    'conversions, CTR, and average CPC. Call this when the question involves ' +
    'campaign-level performance, budgets, or efficiency.',
  input_schema:        daysSchema,
  requiredPermissions: [],
  toolSlug:            TOOL_SLUG,
  async execute(input, context) {
    return googleAdsService.getCampaignPerformance(rangeOrDays(context, input), context.customerId ?? null);
  },
};

const getDailyPerformanceTool = {
  name: 'get_daily_performance',
  description:
    'Retrieve account-level daily metrics: date, impressions, clicks, cost (AUD), ' +
    'conversions — one row per day ordered ASC. Call this when the question involves ' +
    'trends, day-of-week patterns, or spend over time.',
  input_schema:        daysSchema,
  requiredPermissions: [],
  toolSlug:            TOOL_SLUG,
  async execute(input, context) {
    return googleAdsService.getDailyPerformance(rangeOrDays(context, input), context.customerId ?? null);
  },
};

const getSearchTermsTool = {
  name: 'get_search_terms',
  description:
    'Retrieve the top 50 actual user search queries that triggered ads, ordered by ' +
    'clicks DESC. Returns term, status, impressions, clicks, cost (AUD), conversions, ' +
    'and CTR. Call this for questions about what users are searching for, wasted spend, ' +
    'negative keywords, or ad copy relevance.',
  input_schema:        daysSchema,
  requiredPermissions: [],
  toolSlug:            TOOL_SLUG,
  async execute(input, context) {
    return googleAdsService.getSearchTerms(rangeOrDays(context, input), context.customerId ?? null);
  },
};

const getAnalyticsOverviewTool = {
  name: 'get_analytics_overview',
  description:
    'Retrieve daily GA4 session metrics: date, sessions, activeUsers, newUsers, ' +
    'bounceRate (decimal fraction). Call this when the question involves on-site ' +
    'behaviour, landing page quality, or correlating ad traffic with website outcomes.',
  input_schema:        daysSchema,
  requiredPermissions: [],
  toolSlug:            TOOL_SLUG,
  async execute(input, context) {
    return googleAnalyticsService.getSessionsOverview(rangeOrDays(context, input));
  },
};

const googleAdsFreeformTools = [
  getCampaignPerformanceTool,
  getDailyPerformanceTool,
  getSearchTermsTool,
  getAnalyticsOverviewTool,
];

module.exports = { googleAdsFreeformTools, TOOL_SLUG };
