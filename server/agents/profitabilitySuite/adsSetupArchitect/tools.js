'use strict';

const { getAdsServer, getWordPressServer, getPlatformServer, getKnowledgeBaseServer, callMcpTool } = require('../../../platform/mcpTools');

const TOOL_SLUG = 'ads-setup-architect';

const getCompetitorSettingsTool = {
  name: 'get_competitor_settings',
  description: 'Retrieve the configured list of 10 competitors and their websites for this organization.',
  input_schema: { type: 'object', properties: {}, required: [] },
  async execute(input, context) {
    const platform = await getPlatformServer(context.orgId);
    // Note: This assumes a tool named 'get_competitor_settings' exists on the platform server or we call AgentConfigService directly.
    // Given the architecture, I'll call AgentConfigService directly if possible, or use the platform server.
    // Actually, get_competitor_settings is NOT on the platform server according to MCP-SERVERS.md.
    // I will call AgentConfigService directly.
    const AgentConfigService = require('../../../platform/AgentConfigService');
    return AgentConfigService.getCompetitorSettings(context.orgId);
  },
};

const adsGenerateKeywordIdeasTool = {
  name: 'ads_generate_keyword_ideas',
  description: 'Generate keyword ideas from a competitor URL. Returns keywords with AU volume and CPC.',
  input_schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Competitor URL' },
    },
    required: ['url'],
  },
  async execute(input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_generate_keyword_ideas', {
      url: input.url,
      customer_id: context.customerId ?? null,
    });
  },
};

const adsGetAuctionInsightsTool = {
  name: 'ads_get_auction_insights',
  description: 'Competitor domains appearing in the same auctions as the account.',
  input_schema: { type: 'object', properties: {}, required: [] },
  async execute(input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_get_auction_insights', {
      customer_id: context.customerId ?? null,
    });
  },
};

const wpGetEnquiryDetailsTool = {
  name: 'wp_get_enquiry_details',
  description: 'Extended CRM records with final_value and enquiry themes. Use to find high-performing lead sources.',
  input_schema: {
    type: 'object',
    properties: {
      limit: { type: 'number', default: 500 },
    },
  },
  async execute(input, context) {
    const wp = await getWordPressServer(context.orgId);
    return callMcpTool(context.orgId, wp, 'wp_get_enquiry_details', {
      limit: input.limit || 500,
    });
  },
};

const searchKnowledgeTool = {
  name: 'search_knowledge',
  description: 'Search the knowledge base for Diamond Plate product info, differentiators, and SOPs.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
    },
    required: ['query'],
  },
  async execute(input, context) {
    const kb = await getKnowledgeBaseServer(context.orgId);
    return callMcpTool(context.orgId, kb, 'search_knowledge', {
      query: input.query,
    });
  },
};

const adsGetSearchTermsTool = {
  name: 'ads_get_search_terms',
  description: 'Retrieve recent search terms that triggered ads. Use before recommending negative keywords to verify a term actually generated traffic and understand its conversion signal.',
  input_schema: {
    type: 'object',
    properties: {
      start_date: { type: 'string', description: 'YYYY-MM-DD' },
      end_date:   { type: 'string', description: 'YYYY-MM-DD' },
    },
  },
  async execute(input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_get_search_terms', {
      customer_id: context.customerId ?? null,
      start_date:  input.start_date ?? null,
      end_date:    input.end_date   ?? null,
    });
  },
};

const adsGetAdGroupAdsTool = {
  name: 'ads_get_ad_group_ads',
  description: 'Retrieve current live RSA ad copy (headlines, descriptions) and ad strength. Use to verify existing copy before proposing new structures.',
  input_schema: { type: 'object', properties: {}, required: [] },
  async execute(_input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_get_ad_group_ads', { customer_id: context.customerId ?? null });
  },
};

const adsGetAdAssetPerformanceTool = {
  name: 'ads_get_ad_asset_performance',
  description: 'Retrieve current performance labels (BEST, GOOD, LOW, POOR) for all active headlines and descriptions. Use to identify failing assets that need replacement.',
  input_schema: { type: 'object', properties: {}, required: [] },
  async execute(_input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_get_ad_asset_performance', { customer_id: context.customerId ?? null });
  },
};

const adsSetupArchitectTools = [
  getCompetitorSettingsTool,
  adsGenerateKeywordIdeasTool,
  adsGetAuctionInsightsTool,
  adsGetSearchTermsTool,
  wpGetEnquiryDetailsTool,
  searchKnowledgeTool,
  adsGetAdGroupAdsTool,
  adsGetAdAssetPerformanceTool,
];

module.exports = { adsSetupArchitectTools, TOOL_SLUG };
