'use strict';

/**
 * Competitor Keyword Intel — tool definitions.
 *
 * Uses the Google Ads Keyword Plan Idea Service (free, part of existing API
 * access) to pull keyword data from competitor URLs and seed terms relevant
 * to Diamond Plate Australia — graphene ceramic coating for cars.
 */

const { googleAdsService }   = require('../../services/GoogleAdsService');
const AgentConfigService     = require('../../platform/AgentConfigService');

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

/** Load competitor list from monitor config, falling back to defaults. */
async function loadCompetitors(orgId) {
  try {
    const monitorConfig = await AgentConfigService.getAgentConfig(orgId, 'google-ads-monitor');
    const raw = (monitorConfig.competitor_urls ?? '').trim();
    if (!raw) return DEFAULT_COMPETITORS;
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((url) => ({
        name: new URL(url).hostname.replace(/^www\./, ''),
        url,
      }));
  } catch {
    return DEFAULT_COMPETITORS;
  }
}

/** Load min search volume from monitor config. */
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

// ── Tool: keyword ideas from a competitor URL ─────────────────────────────────

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
    const ideas = await googleAdsService.generateKeywordIdeas(
      { url: input.competitor_url },
      context.customerId ?? null
    );
    const filtered = ideas.filter((k) => k.avgMonthlySearches >= minVolume);
    return { url: input.competitor_url, minVolumeApplied: minVolume, keywords: filtered };
  },
};

const getCompetitorListTool = {
  name: 'get_competitor_list',
  description: 'Returns the list of competitor URLs configured for analysis. Call this first to know which competitors to pass to get_competitor_keywords.',
  input_schema: { type: 'object', properties: {}, required: [] },
  requiredPermissions: [],
  toolSlug: TOOL_SLUG,
  async execute(_input, context) {
    const competitors = await loadCompetitors(context.orgId);
    return competitors;
  },
};

// ── Tool: keyword ideas from seed terms ──────────────────────────────────────

const getSeedKeywordsTool = {
  name: 'get_seed_keywords',
  description:
    'Expand keyword ideas from Diamond Plate\'s core seed terms using the Google Ads Keyword Planner. ' +
    'Returns related keywords with Australian monthly search volume, competition level, and CPC range. ' +
    'Use this to find keyword gaps — terms with search volume that competitors target but Diamond Plate does not.',
  input_schema: {
    type:       'object',
    properties: {},
    required:   [],
  },
  requiredPermissions: [],
  toolSlug: TOOL_SLUG,
  async execute(_input, context) {
    const minVolume = await loadMinVolume(context.orgId);
    const ideas = await googleAdsService.generateKeywordIdeas(
      { keywords: SEED_KEYWORDS },
      context.customerId ?? null
    );
    const filtered = ideas.filter((k) => k.avgMonthlySearches >= minVolume);
    return { seedKeywords: SEED_KEYWORDS, minVolumeApplied: minVolume, keywords: filtered };
  },
};

// ── Tool: Diamond Plate's own active keywords ─────────────────────────────────

const getOwnKeywordsTool = {
  name: 'get_own_keywords',
  description:
    'Retrieve the keywords Diamond Plate Australia is currently bidding on in Google Ads. ' +
    'Returns keyword text, match type, status, and bid. ' +
    'Use this to identify gaps — keywords competitors rank for that Diamond Plate is not bidding on.',
  input_schema: {
    type:       'object',
    properties: {},
    required:   [],
  },
  requiredPermissions: [],
  toolSlug: TOOL_SLUG,
  async execute(_input, context) {
    return googleAdsService.getActiveKeywords(context.customerId ?? null);
  },
};

const competitorKeywordIntelTools = [
  getCompetitorListTool,
  getCompetitorKeywordsTool,
  getSeedKeywordsTool,
  getOwnKeywordsTool,
];

module.exports = { competitorKeywordIntelTools, TOOL_SLUG };
