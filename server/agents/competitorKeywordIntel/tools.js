'use strict';

/**
 * Competitor Keyword Intel — tool definitions.
 *
 * All external data is fetched via the registered Google Ads MCP server.
 *
 * Required MCP servers:
 *   - Google Ads (args include 'google-ads.js')
 */

const { getAdsServer, callMcpTool } = require('../../platform/mcpTools');
const AgentConfigService            = require('../../platform/AgentConfigService');

const TOOL_SLUG = 'competitor-keyword-intel';

// ── Fallback competitors if none configured in settings ───────────────────────

const DEFAULT_COMPETITORS = [
  { name: 'Ceramic Pro Australia',  url: 'https://ceramicpro.com.au' },
  { name: 'Gtechniq Australia',     url: 'https://gtechniq.com/en-au' },
  { name: 'Gyeon Australia',        url: 'https://gyeonquartz.com.au' },
  { name: 'IGL Coatings Australia', url: 'https://iglcoatings.com/au' },
  { name: 'CarPro Australia',       url: 'https://carpro.com.au' },
  { name: 'Xpel Australia',         url: 'https://xpel.com.au' },
];

async function loadCompetitors(orgId) {
  try {
    const settings = await AgentConfigService.getCompetitorSettings(orgId);
    if (Array.isArray(settings.competitors) && settings.competitors.length > 0) {
      return settings.competitors;
    }
    return DEFAULT_COMPETITORS;
  } catch {
    return DEFAULT_COMPETITORS;
  }
}

async function loadMinVolume(orgId) {
  try {
    const monitorConfig = await AgentConfigService.getAgentConfig(orgId, 'google-ads-monitor');
    return parseInt(monitorConfig.min_search_volume ?? 50);
  } catch {
    return 50;
  }
}

// ── Seed keywords for Diamond Plate's market ─────────────────────────────────

const SEED_KEYWORDS = [
  'graphene ceramic coating',
  'graphene coating car australia',
  'ceramic coating australia',
  'ceramic coating car',
  'paint protection coating australia',
  'car paint protection film australia',
  'nano ceramic coating',
  'professional ceramic coating',
  'ceramic coating cost australia',
  'best ceramic coating australia',
];

// ── Tools ─────────────────────────────────────────────────────────────────────

const getCompetitorListTool = {
  name: 'get_competitor_list',
  description: 'Returns the list of competitor URLs configured for analysis. Call this first to know which competitors to pass to get_competitor_keywords.',
  input_schema: { type: 'object', properties: {}, required: [] },
  requiredPermissions: [],
  toolSlug: TOOL_SLUG,
  async execute(_input, context) {
    return loadCompetitors(context.orgId);
  },
};

const getCompetitorKeywordsTool = {
  name: 'get_competitor_keywords',
  description:
    'Pull keyword ideas from a competitor website URL using the Google Ads Keyword Planner. ' +
    'Returns keywords Google associates with that URL, with Australian monthly search volume, ' +
    'competition level (LOW/MEDIUM/HIGH), and CPC range (AUD). ' +
    'First call get_competitor_list to see available competitors, then call this once per competitor.',
  input_schema: {
    type: 'object',
    properties: {
      competitor_url: {
        type:        'string',
        description: 'The competitor URL to analyse — get the list from get_competitor_list first.',
      },
    },
    required: ['competitor_url'],
  },
  requiredPermissions: [],
  toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const minVolume = await loadMinVolume(context.orgId);
    const ads       = await getAdsServer(context.orgId);
    const ideas     = await callMcpTool(context.orgId, ads, 'ads_generate_keyword_ideas', {
      url:         input.competitor_url,
      customer_id: context.customerId ?? null,
    });
    const filtered = ideas.filter((k) => k.avgMonthlySearches >= minVolume);
    return { url: input.competitor_url, minVolumeApplied: minVolume, keywords: filtered };
  },
};

const getSeedKeywordsTool = {
  name: 'get_seed_keywords',
  description:
    'Expand keyword ideas from Diamond Plate\'s core seed terms using the Google Ads Keyword Planner. ' +
    'Returns related keywords with Australian monthly search volume, competition level, and CPC range. ' +
    'Use this to find keyword gaps — terms with search volume that competitors target but Diamond Plate does not.',
  input_schema: { type: 'object', properties: {}, required: [] },
  requiredPermissions: [],
  toolSlug: TOOL_SLUG,
  async execute(_input, context) {
    const minVolume = await loadMinVolume(context.orgId);
    const ads       = await getAdsServer(context.orgId);
    const ideas     = await callMcpTool(context.orgId, ads, 'ads_generate_keyword_ideas', {
      keywords:    SEED_KEYWORDS,
      customer_id: context.customerId ?? null,
    });
    const filtered = ideas.filter((k) => k.avgMonthlySearches >= minVolume);
    return { seedKeywords: SEED_KEYWORDS, minVolumeApplied: minVolume, keywords: filtered };
  },
};

const getOwnKeywordsTool = {
  name: 'get_own_keywords',
  description:
    'Retrieve the keywords Diamond Plate Australia is currently bidding on in Google Ads. ' +
    'Returns keyword text, match type, status, and bid. ' +
    'Use this to identify gaps — keywords competitors rank for that Diamond Plate is not bidding on.',
  input_schema: { type: 'object', properties: {}, required: [] },
  requiredPermissions: [],
  toolSlug: TOOL_SLUG,
  async execute(_input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_get_active_keywords', {
      customer_id: context.customerId ?? null,
    });
  },
};

const competitorKeywordIntelTools = [
  getCompetitorListTool,
  getCompetitorKeywordsTool,
  getSeedKeywordsTool,
  getOwnKeywordsTool,
];

module.exports = { competitorKeywordIntelTools, TOOL_SLUG };
