'use strict';

/**
 * Auction Insights — tool definitions.
 *
 * Uses the Google Ads Auction Insights report, which works with Explorer/Test
 * developer token access. Shows which competitor domains are appearing in the
 * same auctions as Diamond Plate, with impression share and outranking data.
 */

const { googleAdsService } = require('../../services/GoogleAdsService');

const TOOL_SLUG = 'auction-insights';

const daysSchema = {
  type: 'object',
  properties: {
    days: { type: 'integer', description: 'Number of days to look back. Defaults to 30.', default: 30 },
  },
  required: [],
};

function rangeOrDays(context, input) {
  if (context.startDate && context.endDate) {
    return { startDate: context.startDate, endDate: context.endDate };
  }
  return context.days ?? input.days ?? 30;
}

// ── Tool: auction insights by competitor domain ───────────────────────────────

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
    return googleAdsService.getAuctionInsights(rangeOrDays(context, input), context.customerId ?? null);
  },
};

// ── Tool: own campaign performance for context ────────────────────────────────

const getCampaignPerformanceTool = {
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
    return googleAdsService.getImpressionShareByCampaign(rangeOrDays(context, input), context.customerId ?? null);
  },
};

const auctionInsightsTools = [
  getAuctionInsightsTool,
  getCampaignPerformanceTool,
];

module.exports = { auctionInsightsTools, TOOL_SLUG };
