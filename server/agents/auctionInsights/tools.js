'use strict';

/**
 * Auction Insights — tool definitions.
 *
 * All external data is fetched via the registered Google Ads MCP server.
 *
 * Required MCP servers:
 *   - Google Ads (args include 'google-ads.js')
 */

const { getAdsServer, callMcpTool, resolveRangeArgs } = require('../../platform/mcpTools');

const TOOL_SLUG = 'auction-insights';

const daysSchema = {
  type: 'object',
  properties: {
    days: { type: 'integer', description: 'Number of days to look back. Defaults to 30.', default: 30 },
  },
  required: [],
};

const getAuctionInsightsTool = {
  name: 'get_auction_insights',
  description:
    'Returns competitor domains appearing in the same Google Ads auctions as Diamond Plate Australia. ' +
    'For each competitor: impression share (how often they appear when eligible), ' +
    'top-of-page rate, absolute top-of-page rate, and outranking share (how often Diamond Plate ' +
    'appears above them or they don\'t show when Diamond Plate does). ' +
    'Use this to identify the most aggressive bidding competitors and where Diamond Plate is losing visibility.',
  input_schema:        daysSchema,
  requiredPermissions: [],
  toolSlug:            TOOL_SLUG,
  async execute(input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_get_auction_insights', {
      ...resolveRangeArgs(context, input),
      customer_id: context.customerId ?? null,
    });
  },
};

const getOwnImpressionShareTool = {
  name: 'get_own_impression_share',
  description:
    'Returns Diamond Plate\'s own impression share, lost impression share (budget vs rank), ' +
    'and search top impression share per campaign. ' +
    'Use this alongside auction insights to show where Diamond Plate is losing to competitors ' +
    'due to rank (bid/quality) vs budget constraints.',
  input_schema:        daysSchema,
  requiredPermissions: [],
  toolSlug:            TOOL_SLUG,
  async execute(input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_get_impression_share_by_campaign', {
      ...resolveRangeArgs(context, input),
      customer_id: context.customerId ?? null,
    });
  },
};

const auctionInsightsTools = [
  getAuctionInsightsTool,
  getOwnImpressionShareTool,
];

module.exports = { auctionInsightsTools, TOOL_SLUG };
