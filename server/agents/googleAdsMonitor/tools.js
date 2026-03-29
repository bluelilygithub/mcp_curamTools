'use strict';

/**
 * Google Ads Monitor — tool definitions.
 *
 * Four tools exported as an array. Each tool has the Anthropic schema fields
 * (name, description, input_schema) plus an execute(input, context) function.
 * AgentOrchestrator strips execute before sending schemas to Claude.
 *
 * toolSlug = 'google-ads-monitor' is a security annotation used by any future
 * ToolRegistry if cross-agent tool isolation is introduced. It is not enforced
 * by AgentOrchestrator today but must be present for forward compatibility.
 *
 * context.days is the authoritative date range (from the UI or config).
 * input.days is Claude's optional argument — used only as a last fallback.
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

// ── Tool definitions ──────────────────────────────────────────────────────────

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
    return googleAdsService.getCampaignPerformance(context.days ?? input.days ?? 30);
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
    return googleAdsService.getDailyPerformance(context.days ?? input.days ?? 30);
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
    return googleAdsService.getSearchTerms(context.days ?? input.days ?? 30);
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
    return googleAnalyticsService.getSessionsOverview(context.days ?? input.days ?? 30);
  },
};

// ── Export ────────────────────────────────────────────────────────────────────

const googleAdsMonitorTools = [
  getCampaignPerformanceTool,
  getDailyPerformanceTool,
  getSearchTermsTool,
  getAnalyticsOverviewTool,
];

module.exports = { googleAdsMonitorTools, TOOL_SLUG };
