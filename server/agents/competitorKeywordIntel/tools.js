'use strict';

/**
 * Competitor Keyword Intel — tool definitions.
 *
 * Uses the Google Ads Keyword Plan Idea Service (free, part of existing API
 * access) to pull keyword data from competitor URLs and seed terms relevant
 * to Diamond Plate Australia — graphene ceramic coating for cars.
 */

const { googleAdsService } = require('../../services/GoogleAdsService');

const TOOL_SLUG = 'competitor-keyword-intel';

// ── Known competitors in the Australian ceramic/graphene coating market ───────

const COMPETITORS = [
  { name: 'Ceramic Pro Australia',  url: 'https://ceramicpro.com.au' },
  { name: 'Gtechniq Australia',     url: 'https://gtechniq.com/en-au' },
  { name: 'Gyeon Australia',        url: 'https://gyeonquartz.com.au' },
  { name: 'IGL Coatings Australia', url: 'https://iglcoatings.com/au' },
  { name: 'CarPro Australia',       url: 'https://carpro.com.au' },
  { name: 'Xpel Australia',         url: 'https://xpel.com.au' },
];

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
    `Available competitors: ${COMPETITORS.map((c) => c.name).join(', ')}. ` +
    'Call this once per competitor. Use the name field to select — e.g. "Ceramic Pro Australia".',
  input_schema: {
    type: 'object',
    properties: {
      competitor_name: {
        type:        'string',
        description: `One of: ${COMPETITORS.map((c) => c.name).join(', ')}`,
      },
    },
    required: ['competitor_name'],
  },
  requiredPermissions: [],
  toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const competitor = COMPETITORS.find(
      (c) => c.name.toLowerCase() === (input.competitor_name ?? '').toLowerCase()
    );
    if (!competitor) {
      return { error: `Unknown competitor "${input.competitor_name}". Choose from: ${COMPETITORS.map((c) => c.name).join(', ')}` };
    }
    const ideas = await googleAdsService.generateKeywordIdeas(
      { url: competitor.url },
      context.customerId ?? null
    );
    return { competitor: competitor.name, url: competitor.url, keywords: ideas };
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
    const ideas = await googleAdsService.generateKeywordIdeas(
      { keywords: SEED_KEYWORDS },
      context.customerId ?? null
    );
    return { seedKeywords: SEED_KEYWORDS, keywords: ideas };
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
  getCompetitorKeywordsTool,
  getSeedKeywordsTool,
  getOwnKeywordsTool,
];

module.exports = { competitorKeywordIntelTools, COMPETITORS, TOOL_SLUG };
