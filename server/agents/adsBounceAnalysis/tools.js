'use strict';

/**
 * Ads Bounce Analysis — tool definitions.
 *
 * Identifies paid keywords that led to bounced sessions, which landing
 * pages they hit, and what device the visitor was using.
 */

const { googleAdsService }       = require('../../services/GoogleAdsService');
const { googleAnalyticsService } = require('../../services/GoogleAnalyticsService');

const TOOL_SLUG = 'ads-bounce-analysis';

const daysSchema = {
  type: 'object',
  properties: {
    days: { type: 'integer', description: 'Number of days to look back from today. Defaults to 30.', default: 30 },
  },
  required: [],
};

function rangeOrDays(context, input) {
  if (context.startDate && context.endDate) {
    return { startDate: context.startDate, endDate: context.endDate };
  }
  return context.days ?? input.days ?? 30;
}

// ── Tool: paid search terms ───────────────────────────────────────────────────

const getSearchTermsTool = {
  name: 'get_search_terms',
  description:
    'Retrieve the paid search terms (keywords) that triggered ads and received clicks. ' +
    'Returns term, impressions, clicks, cost (AUD), conversions, and CTR. ' +
    'Use this to understand which keywords were paid for in the period.',
  input_schema:        daysSchema,
  requiredPermissions: [],
  toolSlug:            TOOL_SLUG,
  async execute(input, context) {
    return googleAdsService.getSearchTerms(rangeOrDays(context, input), context.customerId ?? null);
  },
};

// ── Tool: paid bounced sessions by landing page + device ──────────────────────

const getPaidBouncedSessionsTool = {
  name: 'get_paid_bounced_sessions',
  description:
    'Retrieve GA4 sessions from paid search (Google Ads / cpc medium) grouped by ' +
    'landing page and device category, with bounce rate and average session duration. ' +
    'Use this to identify which landing pages are failing paid traffic, ' +
    'and whether the problem is worse on a particular device (mobile, desktop, tablet).',
  input_schema:        daysSchema,
  requiredPermissions: [],
  toolSlug:            TOOL_SLUG,
  async execute(input, context) {
    return googleAnalyticsService.getPaidBouncedSessions(rangeOrDays(context, input));
  },
};

const adsBounceAnalysisTools = [
  getSearchTermsTool,
  getPaidBouncedSessionsTool,
];

module.exports = { adsBounceAnalysisTools, TOOL_SLUG };
