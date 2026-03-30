'use strict';

/**
 * Ads Attribution Summary — tool definitions.
 *
 * Pulls Google Ads campaign totals, GA4 session overview, and WordPress
 * client enquiries into one context so the agent can write a brief
 * cross-channel attribution summary.
 *
 * WordPress data is fetched via the registered MCP server for the org
 * (the server whose config command includes "wordpress.js"). This keeps
 * the WordPress integration in one place — configured once in Admin > MCP
 * Servers, used by any agent that needs it.
 */

const { googleAdsService }       = require('../../services/GoogleAdsService');
const { googleAnalyticsService } = require('../../services/GoogleAnalyticsService');
const MCPRegistry                = require('../../platform/mcpRegistry');

const TOOL_SLUG = 'ads-attribution-summary';

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

/**
 * Find and auto-connect the WordPress MCP server for this org.
 * Matches by looking for a server whose config args include "wordpress.js".
 */
async function getWordpressServer(orgId) {
  const servers = await MCPRegistry.list(orgId);
  const wp = servers.find((s) => {
    const args = s.config?.args ?? [];
    return args.some((a) => String(a).includes('wordpress'));
  });
  if (!wp) throw new Error('No WordPress MCP server registered for this organisation. Add one in Admin > MCP Servers.');

  // Auto-connect if not already connected
  if (wp.connection_status !== 'connected') {
    await MCPRegistry.connect(orgId, wp.id);
  }
  return wp;
}

// ── Tool: Google Ads campaign performance ─────────────────────────────────────

const getCampaignPerformanceTool = {
  name: 'get_campaign_performance',
  description:
    'Retrieve total spend, conversions, and CPA per campaign over the date range. ' +
    'Use this to summarise overall ad investment and conversion output.',
  input_schema:        daysSchema,
  requiredPermissions: [],
  toolSlug:            TOOL_SLUG,
  async execute(input, context) {
    return googleAdsService.getCampaignPerformance(rangeOrDays(context, input), context.customerId ?? null);
  },
};

// ── Tool: GA4 session overview ────────────────────────────────────────────────

const getAnalyticsOverviewTool = {
  name: 'get_analytics_overview',
  description:
    'Retrieve total sessions, active users, and average bounce rate from GA4 over the date range. ' +
    'Use this to summarise paid traffic volume and quality.',
  input_schema:        daysSchema,
  requiredPermissions: [],
  toolSlug:            TOOL_SLUG,
  async execute(input, context) {
    return googleAnalyticsService.getSessionsOverview(rangeOrDays(context, input));
  },
};

// ── Tool: WordPress enquiries via MCP ─────────────────────────────────────────

const getWpEnquiriesTool = {
  name: 'get_wp_enquiries',
  description:
    'Fetch client enquiries from WordPress (clientenquiry post type) over the date range. ' +
    'Returns each enquiry with its status, UTM source/medium/campaign, and device type. ' +
    'Use this to count leads generated, understand their sales status, and attribute them ' +
    'to ad campaigns via utm_campaign and utm_source.',
  input_schema: {
    type: 'object',
    properties: {
      days: { type: 'integer', description: 'Number of days to look back. Defaults to 30.', default: 30 },
    },
    required: [],
  },
  requiredPermissions: [],
  toolSlug:            TOOL_SLUG,
  async execute(input, context) {
    const wp = await getWordpressServer(context.orgId);

    // Determine date range
    let startDate = context.startDate ?? null;
    let endDate   = context.endDate   ?? null;
    if (!startDate || !endDate) {
      const days  = context.days ?? input.days ?? 30;
      const end   = new Date();
      const start = new Date();
      start.setDate(start.getDate() - days);
      startDate = start.toISOString().slice(0, 10);
      endDate   = end.toISOString().slice(0, 10);
    }

    const result = await MCPRegistry.send(context.orgId, wp.id, 'tools/call', {
      name:      'wp_get_enquiries',
      arguments: { per_page: 100, start_date: startDate, end_date: endDate },
    });

    // MCP returns { content: [{ type: 'text', text: '...' }] }
    const raw = result?.content?.[0]?.text;
    if (!raw) throw new Error('Empty response from WordPress MCP server');
    return JSON.parse(raw);
  },
};

const adsAttributionSummaryTools = [
  getCampaignPerformanceTool,
  getAnalyticsOverviewTool,
  getWpEnquiriesTool,
];

module.exports = { adsAttributionSummaryTools, TOOL_SLUG };
