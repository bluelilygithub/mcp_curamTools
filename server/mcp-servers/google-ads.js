/**
 * google-ads.js — Stdio MCP server wrapping GoogleAdsService (Google Ads API v23)
 *
 * Communicates via stdin/stdout (JSON-RPC, one message per line).
 * Register in Admin > MCP Servers as transport type: stdio, command: node,
 * args: ["/path/to/server/mcp-servers/google-ads.js"].
 *
 * Required env vars (inherited from parent process or Railway):
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 *   GOOGLE_ADS_CUSTOMER_ID, GOOGLE_ADS_MANAGER_ID, GOOGLE_ADS_DEVELOPER_TOKEN
 */

'use strict';

const readline = require('readline');
const { GoogleAdsService } = require('../services/GoogleAdsService');

const ads = new GoogleAdsService();

// ── Shared input schema fragments ─────────────────────────────────────────────

const dateRangeProps = {
  days: {
    type:        'integer',
    description: 'Number of days to look back from today. Ignored if start_date + end_date are provided.',
  },
  start_date: {
    type:        'string',
    description: 'Range start date YYYY-MM-DD. Use with end_date for a precise window.',
  },
  end_date: {
    type:        'string',
    description: 'Range end date YYYY-MM-DD. Use with start_date for a precise window.',
  },
  customer_id: {
    type:        'string',
    description: 'Override the default Google Ads customer ID for multi-account runs.',
  },
};

/** Convert MCP tool args to the format GoogleAdsService expects. */
function resolveOptions(args) {
  if (args.start_date && args.end_date) return { startDate: args.start_date, endDate: args.end_date };
  return args.days ?? 30;
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
  {
    name:        'ads_get_campaign_performance',
    description: 'Performance totals for every enabled Google Ads campaign over the date range. Returns id, name, status, monthly budget (AUD), impressions, clicks, cost (AUD), conversions, CTR, and average CPC.',
    inputSchema: {
      type:       'object',
      properties: dateRangeProps,
    },
  },
  {
    name:        'ads_get_daily_performance',
    description: 'Account-level daily metrics: date, impressions, clicks, cost (AUD), conversions — one row per day ordered ASC.',
    inputSchema: {
      type:       'object',
      properties: dateRangeProps,
    },
  },
  {
    name:        'ads_get_search_terms',
    description: 'Top 50 actual user search queries that triggered ads, ordered by clicks DESC. Returns term, status, impressions, clicks, cost (AUD), conversions, CTR.',
    inputSchema: {
      type:       'object',
      properties: dateRangeProps,
    },
  },
  {
    name:        'ads_get_budget_pacing',
    description: 'Monthly budget pacing per campaign: campaign name, monthly budget (AUD), spend to date (AUD). Uses THIS_MONTH segment.',
    inputSchema: {
      type:       'object',
      properties: {
        customer_id: dateRangeProps.customer_id,
      },
    },
  },
  {
    name:        'ads_generate_keyword_ideas',
    description: 'Generate keyword ideas from a competitor URL or seed keyword list using the Google Ads Keyword Plan Idea Service. Returns keywords with Australian monthly search volume, competition level, and CPC range (AUD).',
    inputSchema: {
      type:       'object',
      properties: {
        url: {
          type:        'string',
          description: 'Competitor or seed URL to generate keyword ideas from.',
        },
        keywords: {
          type:        'array',
          items:       { type: 'string' },
          description: 'Seed keyword list (used when url is not provided).',
        },
        customer_id: dateRangeProps.customer_id,
      },
    },
  },
  {
    name:        'ads_get_auction_insights',
    description: 'Competitor domains appearing in the same auctions as the account. For each competitor: impression share, top-of-page rate, absolute top-of-page rate, outranking share.',
    inputSchema: {
      type:       'object',
      properties: dateRangeProps,
    },
  },
  {
    name:        'ads_get_impression_share_by_campaign',
    description: 'Account impression share per campaign: impression share, lost to rank, lost to budget, top-of-page rate, absolute top-of-page rate.',
    inputSchema: {
      type:       'object',
      properties: dateRangeProps,
    },
  },
  {
    name:        'ads_get_active_keywords',
    description: 'All active keywords currently in the account: keyword text, match type, bid (AUD), campaign name, ad group name. Up to 200 keywords ordered by bid DESC.',
    inputSchema: {
      type:       'object',
      properties: {
        customer_id: dateRangeProps.customer_id,
      },
    },
  },
  {
    name:        'ads_get_change_history',
    description: 'Recent account change events: bid changes, budget adjustments, status changes, ad edits, keyword additions/removals. Returns changedAt, resourceType, changedFields, clientType, operation, campaignName.',
    inputSchema: {
      type:       'object',
      properties: dateRangeProps,
    },
  },
];

// ── Tool handlers ─────────────────────────────────────────────────────────────

async function callTool(name, args = {}) {
  const cid = args.customer_id ?? null;

  switch (name) {
    case 'ads_get_campaign_performance':
      return ads.getCampaignPerformance(resolveOptions(args), cid);

    case 'ads_get_daily_performance':
      return ads.getDailyPerformance(resolveOptions(args), cid);

    case 'ads_get_search_terms':
      return ads.getSearchTerms(resolveOptions(args), cid);

    case 'ads_get_budget_pacing':
      return ads.getBudgetPacing(cid);

    case 'ads_generate_keyword_ideas':
      return ads.generateKeywordIdeas({ url: args.url ?? null, keywords: args.keywords ?? [] }, cid);

    case 'ads_get_auction_insights':
      return ads.getAuctionInsights(resolveOptions(args), cid);

    case 'ads_get_impression_share_by_campaign':
      return ads.getImpressionShareByCampaign(resolveOptions(args), cid);

    case 'ads_get_active_keywords':
      return ads.getActiveKeywords(cid);

    case 'ads_get_change_history':
      return ads.getChangeHistory(resolveOptions(args), cid);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── JSON-RPC transport ────────────────────────────────────────────────────────

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function respondError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', async (line) => {
  if (!line.trim()) return;

  let msg;
  try { msg = JSON.parse(line); } catch { return; }

  const { id, method, params = {} } = msg;

  try {
    switch (method) {
      case 'initialize':
        respond(id, {
          protocolVersion: '2024-11-05',
          capabilities:    { tools: {} },
          serverInfo:      { name: 'google-ads-mcp', version: '1.0.0' },
        });
        break;

      case 'notifications/initialized':
        break;

      case 'tools/list':
        respond(id, { tools: TOOLS });
        break;

      case 'tools/call': {
        const result = await callTool(params.name, params.arguments || {});
        respond(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        });
        break;
      }

      default:
        respondError(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    respondError(id, -32000, err.message);
  }
});

rl.on('close', () => process.exit(0));
