'use strict';

/**
 * High Intent Advisor — tool definitions.
 *
 * 15 tools across Google Ads, GA4, WordPress CRM, and Platform MCP servers.
 * The agent uses these tools across three phases: review, gather, generate.
 *
 * Required MCP servers:
 *   - Google Ads       (args include 'google-ads.js')
 *   - Google Analytics (args include 'google-analytics.js')
 *   - WordPress        (args include 'wordpress.js')
 *   - Platform         (args include 'platform.js')
 *   - Knowledge Base   (args include 'knowledge-base.js')
 */

const {
  getAdsServer,
  getAnalyticsServer,
  getWordPressServer,
  getPlatformServer,
  getKnowledgeBaseServer,
  callMcpTool,
  resolveRangeArgs,
} = require('../../platform/mcpTools');

const TOOL_SLUG = 'high-intent-advisor';

const daysSchema = {
  type: 'object',
  properties: {
    days: { type: 'integer', description: 'Days to look back. Defaults to 30.', default: 30 },
  },
  required: [],
};

// ── Google Ads tools ──────────────────────────────────────────────────────────

const getCampaignPerformanceTool = {
  name: 'get_campaign_performance',
  description: 'Campaign totals: impressions, clicks, cost (AUD), conversions, CPA, CTR, avg CPC, budget. Use to assess campaign efficiency and conversion volume.',
  input_schema: daysSchema,
  requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_get_campaign_performance', {
      ...resolveRangeArgs(context, input),
      customer_id: context.customerId ?? null,
    });
  },
};

const getSearchTermsTool = {
  name: 'get_search_terms',
  description: 'Top 50 search queries that triggered ads by clicks. Intent signals must be fresh — do not rely on cached results. Use to identify high-intent vs low-intent query patterns.',
  input_schema: daysSchema,
  cacheable: false,
  requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_get_search_terms', {
      ...resolveRangeArgs(context, input),
      customer_id: context.customerId ?? null,
    });
  },
};

const getDailyPerformanceTool = {
  name: 'get_daily_performance',
  description: 'Account-level daily metrics: date, impressions, clicks, cost, conversions. Use to detect trends, day-of-week patterns, or budget pacing issues.',
  input_schema: daysSchema,
  requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_get_daily_performance', {
      ...resolveRangeArgs(context, input),
      customer_id: context.customerId ?? null,
    });
  },
};

const getBudgetPacingTool = {
  name: 'get_budget_pacing',
  description: 'Current month spend vs monthly budget per campaign. Live spend — always fresh. Use to identify over- or under-spending campaigns.',
  input_schema: { type: 'object', properties: {}, required: [] },
  cacheable: false,
  requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(_input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_get_budget_pacing', { customer_id: context.customerId ?? null });
  },
};

const getImpressionShareTool = {
  name: 'get_impression_share',
  description: 'Own impression share per campaign: share won, lost to rank, lost to budget. Use to diagnose visibility loss or whether budget or quality is the constraint.',
  input_schema: daysSchema,
  requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_get_impression_share_by_campaign', {
      ...resolveRangeArgs(context, input),
      customer_id: context.customerId ?? null,
    });
  },
};

// ── GA4 tools ─────────────────────────────────────────────────────────────────

const getPaidBouncedSessionsTool = {
  name: 'get_paid_bounced_sessions',
  description: 'GA4 paid (cpc) sessions by landing page and device: sessions, bounce rate, avg duration. Live — do not use cached results. Use to identify landing page quality issues and device-specific problems.',
  input_schema: daysSchema,
  cacheable: false,
  requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const ga = await getAnalyticsServer(context.orgId);
    return callMcpTool(context.orgId, ga, 'ga4_get_paid_bounced_sessions', resolveRangeArgs(context, input));
  },
};

const getLandingPagePerformanceTool = {
  name: 'get_landing_page_performance',
  description: 'Top landing pages: sessions, conversions, bounce rate, avg session duration. Use to find best-performing pages and pages that need CRO work.',
  input_schema: daysSchema,
  requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const ga = await getAnalyticsServer(context.orgId);
    return callMcpTool(context.orgId, ga, 'ga4_get_landing_page_performance', resolveRangeArgs(context, input));
  },
};

const getTrafficSourcesTool = {
  name: 'get_traffic_sources',
  description: 'Sessions, conversions by channel (Paid Search, Organic, Direct). Use to compare paid vs organic performance and identify channel mix opportunities.',
  input_schema: daysSchema,
  requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const ga = await getAnalyticsServer(context.orgId);
    return callMcpTool(context.orgId, ga, 'ga4_get_traffic_sources', resolveRangeArgs(context, input));
  },
};

// ── WordPress CRM tools ───────────────────────────────────────────────────────

const getEnquiriesTool = {
  name: 'get_enquiries',
  description: 'WordPress CRM enquiries: lead source, device, status, and attribution. Ground truth for conversion outcomes — always fresh. Use to understand what types of customers are enquiring and converting.',
  input_schema: {
    type: 'object',
    properties: {
      limit: { type: 'integer', description: 'Number of records to return. Defaults to 500.' },
    },
    required: [],
  },
  cacheable: false,
  requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const wp = await getWordPressServer(context.orgId);
    return callMcpTool(context.orgId, wp, 'wp_get_enquiries', { limit: input.limit ?? 500 });
  },
};

const getNotInterestedReasonsTool = {
  name: 'get_not_interested_reasons',
  description: 'Reasons leads gave for not proceeding. Use to identify product or messaging gaps that prevent conversion.',
  input_schema: { type: 'object', properties: {}, required: [] },
  requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(_input, context) {
    const wp = await getWordPressServer(context.orgId);
    return callMcpTool(context.orgId, wp, 'wp_get_not_interested_reasons', {});
  },
};

// ── Platform tools ────────────────────────────────────────────────────────────

const getPendingSuggestionsTool = {
  name: 'get_pending_suggestions',
  description: 'Returns all your prior suggestions with status pending or monitoring. Call this first in Phase 1 to review what was suggested before and assess outcomes.',
  input_schema: { type: 'object', properties: {}, required: [] },
  cacheable: false,
  requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(_input, context) {
    const platform = await getPlatformServer(context.orgId);
    return callMcpTool(context.orgId, platform, 'get_pending_suggestions', { org_id: context.orgId });
  },
};

const updateSuggestionOutcomeTool = {
  name: 'update_suggestion_outcome',
  description: 'Record your assessment of a prior suggestion: what outcome_metrics show now, your notes on whether it moved the needle, and an updated status if appropriate.',
  input_schema: {
    type: 'object',
    properties: {
      suggestion_id:   { type: 'string', description: 'UUID of the suggestion row.' },
      outcome_metrics: { type: 'object', description: 'Current metric values relevant to this suggestion.' },
      outcome_notes:   { type: 'string', description: 'Your assessment of whether this suggestion moved the needle.' },
      status:          { type: 'string', description: 'Updated status: monitoring or pending. Omit to leave unchanged.' },
    },
    required: ['suggestion_id', 'outcome_metrics', 'outcome_notes'],
  },
  cacheable: false,
  requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const platform = await getPlatformServer(context.orgId);
    return callMcpTool(context.orgId, platform, 'update_suggestion_outcome', {
      org_id:          context.orgId,
      suggestion_id:   input.suggestion_id,
      outcome_metrics: input.outcome_metrics,
      outcome_notes:   input.outcome_notes,
      status:          input.status ?? null,
    });
  },
};

const getReportHistoryTool = {
  name: 'get_report_history',
  description: 'Fetch historical report summaries for an agent slug. Use to check what recent monitoring reports found — trends, issues, and prior analysis.',
  input_schema: {
    type: 'object',
    properties: {
      slug:  { type: 'string', description: 'Agent slug (e.g. google-ads-monitor, ads-attribution-summary).' },
      limit: { type: 'integer', description: 'Number of runs to return. Default 5.' },
    },
    required: ['slug'],
  },
  requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const platform = await getPlatformServer(context.orgId);
    return callMcpTool(context.orgId, platform, 'get_report_history', {
      org_id: context.orgId,
      slug:   input.slug,
      limit:  input.limit ?? 5,
    });
  },
};

const getSuggestionHistoryTool = {
  name: 'get_suggestion_history',
  description: 'Full history of all suggestions for this org (all statuses). Use in Phase 1 to identify patterns: what categories get acted on, what gets dismissed and why, and which suggestion types have not moved metrics. Essential for calibrating Phase 3 output.',
  input_schema: {
    type: 'object',
    properties: {
      limit: { type: 'integer', description: 'Max rows. Default 100, max 200.' },
    },
    required: [],
  },
  cacheable: false,
  requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const platform = await getPlatformServer(context.orgId);
    return callMcpTool(context.orgId, platform, 'get_suggestion_history', {
      org_id: context.orgId,
      limit:  input.limit ?? 100,
    });
  },
};

const searchKnowledgeTool = {
  name: 'search_knowledge',
  description: 'Semantic search across indexed agent run summaries and documents. Use to find relevant prior analysis or context before generating a suggestion.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query.' },
      limit: { type: 'integer', description: 'Max results. Default 5.' },
    },
    required: ['query'],
  },
  requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const kb = await getKnowledgeBaseServer(context.orgId);
    return callMcpTool(context.orgId, kb, 'search_knowledge', {
      orgId: context.orgId,
      query: input.query,
      limit: input.limit ?? 5,
    });
  },
};

// ── Export ────────────────────────────────────────────────────────────────────

const highIntentAdvisorTools = [
  getCampaignPerformanceTool,
  getSearchTermsTool,
  getDailyPerformanceTool,
  getBudgetPacingTool,
  getImpressionShareTool,
  getPaidBouncedSessionsTool,
  getLandingPagePerformanceTool,
  getTrafficSourcesTool,
  getEnquiriesTool,
  getNotInterestedReasonsTool,
  getPendingSuggestionsTool,
  updateSuggestionOutcomeTool,
  getSuggestionHistoryTool,
  getReportHistoryTool,
  searchKnowledgeTool,
];

module.exports = { highIntentAdvisorTools, TOOL_SLUG };
