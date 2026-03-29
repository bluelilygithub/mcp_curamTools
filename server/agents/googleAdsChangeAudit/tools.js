'use strict';

/**
 * Google Ads Change Audit — tool definitions.
 *
 * Key difference from other agents: tools expose start_date/end_date in
 * their input schema so the agent can request specific before/after windows
 * for each change rather than just "last N days". This is what enables
 * quantitative before/after metric comparison per change event.
 */

const { googleAdsService }       = require('../../services/GoogleAdsService');
const { googleAnalyticsService } = require('../../services/GoogleAnalyticsService');

const TOOL_SLUG = 'google-ads-change-audit';

const dateRangeSchema = {
  type: 'object',
  properties: {
    days: {
      type:        'integer',
      description: 'Number of days to look back from today. Use for initial context, not for before/after windows.',
      default:     30,
    },
    start_date: {
      type:        'string',
      description: 'Specific window start date YYYY-MM-DD. Use with end_date to query a precise before or after period.',
    },
    end_date: {
      type:        'string',
      description: 'Specific window end date YYYY-MM-DD. Use with start_date to query a precise before or after period.',
    },
  },
  required: [],
};

/**
 * Resolve date range:
 *   1. Explicit start_date + end_date from tool input (for targeted before/after windows)
 *   2. Context dates (set by index.js from req.body)
 *   3. days parameter
 *   4. Default 30 days
 */
function resolveInput(context, input) {
  if (input.start_date && input.end_date) {
    return { startDate: input.start_date, endDate: input.end_date };
  }
  if (context.startDate && context.endDate) {
    return { startDate: context.startDate, endDate: context.endDate };
  }
  return input.days ?? 30;
}

const getChangeHistoryTool = {
  name: 'get_change_history',
  description:
    'Retrieve recent account change events: bid changes, budget adjustments, status changes ' +
    '(paused/enabled), ad edits, keyword additions/removals. Returns: changedAt, resourceType, ' +
    'changedFields, clientType, operation, campaignName. ' +
    'Call this first — it gives you the list of changes to audit. ' +
    'Use start_date/end_date for a precise window, or days for a rolling lookback.',
  input_schema:        dateRangeSchema,
  requiredPermissions: [],
  toolSlug:            TOOL_SLUG,
  async execute(input, context) {
    return googleAdsService.getChangeHistory(resolveInput(context, input), context.customerId ?? null);
  },
};

const getCampaignPerformanceTool = {
  name: 'get_campaign_performance',
  description:
    'Retrieve campaign performance totals for a date window. Returns id, name, budget (AUD), ' +
    'impressions, clicks, cost (AUD), conversions, CTR, avgCpc. ' +
    'For before/after comparison: call this twice — once with the before window ' +
    '(start_date to the day before the change) and once with the after window ' +
    '(change date to 7 days after). Compare the two result sets to compute deltas.',
  input_schema:        dateRangeSchema,
  requiredPermissions: [],
  toolSlug:            TOOL_SLUG,
  async execute(input, context) {
    return googleAdsService.getCampaignPerformance(resolveInput(context, input), context.customerId ?? null);
  },
};

const getDailyPerformanceTool = {
  name: 'get_daily_performance',
  description:
    'Retrieve account-level daily metrics: date, impressions, clicks, cost (AUD), conversions. ' +
    'Use start_date/end_date to bracket a before or after period. ' +
    'Useful for identifying the exact day a change took effect and computing daily averages.',
  input_schema:        dateRangeSchema,
  requiredPermissions: [],
  toolSlug:            TOOL_SLUG,
  async execute(input, context) {
    return googleAdsService.getDailyPerformance(resolveInput(context, input), context.customerId ?? null);
  },
};

const getAnalyticsOverviewTool = {
  name: 'get_analytics_overview',
  description:
    'Retrieve daily GA4 session metrics: sessions, activeUsers, newUsers, bounceRate. ' +
    'Use to check whether a change that improved ad metrics also improved on-site behaviour. ' +
    'Use start_date/end_date for precise before/after windows.',
  input_schema:        dateRangeSchema,
  requiredPermissions: [],
  toolSlug:            TOOL_SLUG,
  async execute(input, context) {
    return googleAnalyticsService.getSessionsOverview(resolveInput(context, input));
  },
};

const googleAdsChangeAuditTools = [
  getChangeHistoryTool,
  getCampaignPerformanceTool,
  getDailyPerformanceTool,
  getAnalyticsOverviewTool,
];

module.exports = { googleAdsChangeAuditTools, TOOL_SLUG };
