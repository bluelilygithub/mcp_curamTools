'use strict';

/**
 * Ads Bounce Analysis — tool definitions.
 *
 * All external data is fetched via registered MCP servers (Admin > MCP Servers).
 *
 * Required MCP servers:
 *   - Google Ads       (args include 'google-ads.js')
 *   - Google Analytics (args include 'google-analytics.js')
 */

const { getAdsServer, getAnalyticsServer, callMcpTool, resolveRangeArgs } = require('../../platform/mcpTools');

const TOOL_SLUG = 'ads-bounce-analysis';

const daysSchema = {
  type: 'object',
  properties: {
    days: { type: 'integer', description: 'Number of days to look back from today. Defaults to 30.', default: 30 },
  },
  required: [],
};

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
    'Retrieve GA4 sessions from paid search (Google Ads / cpc medium) grouped by ' +
    'landing page and device category, with bounce rate and average session duration. ' +
    'Use this to identify which landing pages are failing paid traffic, ' +
    'and whether the problem is worse on a particular device (mobile, desktop, tablet).',
  input_schema:        daysSchema,
  requiredPermissions: [],
  toolSlug:            TOOL_SLUG,
  async execute(input, context) {
    const ga = await getAnalyticsServer(context.orgId);
    return callMcpTool(context.orgId, ga, 'ga4_get_paid_bounced_sessions', resolveRangeArgs(context, input));
  },
};

const adsBounceAnalysisTools = [
  getSearchTermsTool,
  getPaidBouncedSessionsTool,
];

module.exports = { adsBounceAnalysisTools, TOOL_SLUG };
