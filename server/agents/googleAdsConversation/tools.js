'use strict';

/**
 * Google Ads Conversation — full tool suite.
 *
 * All data via registered MCP servers — Google Ads, Google Analytics, and WordPress CRM.
 * The conversation agent has access to every data dimension so it can
 * answer any question the user asks across the thread.
 *
 * Required MCP servers:
 *   - Google Ads       (args include 'google-ads.js')
 *   - Google Analytics (args include 'google-analytics.js')
 *   - WordPress        (args include 'wordpress.js')
 *
 * DATA COVERAGE NOTE:
 *   Google Ads and GA4 data: available from ~March 2026 onwards only.
 *   WordPress CRM enquiries: 3 years of history available.
 *   Do NOT cross-reference CRM data with Google data for periods before March 2026.
 */

const { getAdsServer, getAnalyticsServer, getWordPressServer, getPlatformServer, getKnowledgeBaseServer, callMcpTool, resolveRangeArgs } = require('../../platform/mcpTools');

const TOOL_SLUG = 'google-ads-conversation';

const daysSchema = {
  type: 'object',
  properties: {
    days: { type: 'integer', description: 'Days to look back. Defaults to 30.', default: 30 },
    start_date: { type: 'string', description: 'Range start YYYY-MM-DD. Use with end_date.' },
    end_date:   { type: 'string', description: 'Range end YYYY-MM-DD. Use with start_date.' },
  },
  required: [],
};

function resolveConvArgs(context, input) {
  if (input.start_date && input.end_date) return { start_date: input.start_date, end_date: input.end_date };
  return resolveRangeArgs(context, input);
}

// ── Google Ads tools ──────────────────────────────────────────────────────────

const getCampaignPerformanceTool = {
  name: 'get_campaign_performance',
  description: 'Campaign totals: impressions, clicks, cost (AUD), conversions, CPA, CTR, avg CPC, budget. Call for any question about campaign efficiency, spend, or conversion rates.',
  input_schema: daysSchema, requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_get_campaign_performance', {
      ...resolveConvArgs(context, input), customer_id: context.customerId ?? null,
    });
  },
};

const getDailyPerformanceTool = {
  name: 'get_daily_performance',
  description: 'Account-level daily metrics: date, impressions, clicks, cost, conversions. Use for trend, pacing, or day-of-week questions.',
  input_schema: daysSchema, requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_get_daily_performance', {
      ...resolveConvArgs(context, input), customer_id: context.customerId ?? null,
    });
  },
};

const getSearchTermsTool = {
  name: 'get_search_terms',
  description: 'Top 50 search queries that triggered ads by clicks. Use for intent, wasted spend, negative keyword, or ad relevance questions.',
  input_schema: daysSchema, requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_get_search_terms', {
      ...resolveConvArgs(context, input), customer_id: context.customerId ?? null,
    });
  },
};

const getBudgetPacingTool = {
  name: 'get_budget_pacing',
  description: 'Current month spend vs monthly budget per campaign. Use for budget questions or to check if a campaign is on track.',
  input_schema: { type: 'object', properties: {}, required: [] },
  requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(_input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_get_budget_pacing', { customer_id: context.customerId ?? null });
  },
};

const getAuctionInsightsTool = {
  name: 'get_auction_insights',
  description: 'Competitor domains in the same auctions: impression share, top-of-page rate, abs. top rate, outranking share. Use for competitor or visibility questions.',
  input_schema: daysSchema, requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_get_auction_insights', {
      ...resolveConvArgs(context, input), customer_id: context.customerId ?? null,
    });
  },
};

const getImpressionShareTool = {
  name: 'get_impression_share',
  description: 'Own impression share per campaign: share won, lost to rank, lost to budget. Use to diagnose visibility loss or budget vs quality issues.',
  input_schema: daysSchema, requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_get_impression_share_by_campaign', {
      ...resolveConvArgs(context, input), customer_id: context.customerId ?? null,
    });
  },
};

const getActiveKeywordsTool = {
  name: 'get_active_keywords',
  description: 'All active keywords with match type, bid (AUD), campaign, and ad group. Use for keyword strategy, gap analysis, or bid questions.',
  input_schema: { type: 'object', properties: {}, required: [] },
  requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(_input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_get_active_keywords', { customer_id: context.customerId ?? null });
  },
};

const getChangeHistoryTool = {
  name: 'get_change_history',
  description: 'Recent account changes: bids, budgets, paused/enabled, ad edits, keyword changes. Use for any question about what changed recently.',
  input_schema: daysSchema, requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const ads = await getAdsServer(context.orgId);
    return callMcpTool(context.orgId, ads, 'ads_get_change_history', {
      ...resolveConvArgs(context, input), customer_id: context.customerId ?? null,
    });
  },
};

// ── GA4 tools ─────────────────────────────────────────────────────────────────

const getSessionsOverviewTool = {
  name: 'get_sessions_overview',
  description: 'Daily GA4 sessions, active users, new users, bounce rate. Use for traffic trend or overall site health questions.',
  input_schema: daysSchema, requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const ga = await getAnalyticsServer(context.orgId);
    return callMcpTool(context.orgId, ga, 'ga4_get_sessions_overview', resolveConvArgs(context, input));
  },
};

const getTrafficSourcesTool = {
  name: 'get_traffic_sources',
  description: 'Sessions, conversions, and revenue by channel (Paid Search, Organic, Direct, etc.). Use for channel mix or ROI comparison questions.',
  input_schema: daysSchema, requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const ga = await getAnalyticsServer(context.orgId);
    return callMcpTool(context.orgId, ga, 'ga4_get_traffic_sources', resolveConvArgs(context, input));
  },
};

const getLandingPagePerformanceTool = {
  name: 'get_landing_page_performance',
  description: 'Top 20 landing pages: sessions, conversions, bounce rate, avg session duration. Use for landing page quality or CRO questions.',
  input_schema: daysSchema, requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const ga = await getAnalyticsServer(context.orgId);
    return callMcpTool(context.orgId, ga, 'ga4_get_landing_page_performance', resolveConvArgs(context, input));
  },
};

const getPaidBouncedSessionsTool = {
  name: 'get_paid_bounced_sessions',
  description: 'Paid (cpc) sessions grouped by landing page + device: sessions, bounce rate, avg duration. Use for paid traffic quality or device-specific questions.',
  input_schema: daysSchema, requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const ga = await getAnalyticsServer(context.orgId);
    return callMcpTool(context.orgId, ga, 'ga4_get_paid_bounced_sessions', resolveConvArgs(context, input));
  },
};

const getConversionEventsTool = {
  name: 'get_conversion_events',
  description: 'Conversion events by name and date: event count and conversion count. Use for conversion tracking or funnel questions.',
  input_schema: daysSchema, requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const ga = await getAnalyticsServer(context.orgId);
    return callMcpTool(context.orgId, ga, 'ga4_get_conversion_events', resolveConvArgs(context, input));
  },
};

// ── WordPress / CRM tools ─────────────────────────────────────────────────────

const getNotInterestedReasonsTool = {
  name: 'get_not_interested_reasons',
  description: 'Returns ALL CRM records where a reason_not_interested value was recorded, with UTM attribution and search term. Use this for any question about why leads did not proceed — it fetches the full dataset regardless of volume, not limited to the most recent records.',
  input_schema: {
    type: 'object',
    properties: {
      start_date: { type: 'string', description: 'Filter on or after this date (YYYY-MM-DD).' },
      end_date:   { type: 'string', description: 'Filter on or before this date (YYYY-MM-DD).' },
    },
    required: [],
  },
  requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const wp = await getWordPressServer(context.orgId);
    return callMcpTool(context.orgId, wp, 'wp_get_not_interested_reasons', {
      start_date: input.start_date ?? undefined,
      end_date:   input.end_date   ?? undefined,
    });
  },
};

const getEnquiriesTool = {
  name: 'get_enquiries',
  description: 'CRM enquiry/lead records from WordPress. Includes UTM source, medium, campaign, ad group, search term, device type, landing page, gclid, GA4 client ID, enquiry status, and reason_not_interested (why a lead did not proceed). Years of history available. Use for lead volume, lead quality, campaign-to-lead attribution, or any question about what happened after the click. Use start_date and end_date to fetch specific periods; use a high limit to retrieve bulk data. For specific analysis of not-interested reasons, use wp_get_not_interested_reasons instead — it queries all records with that field populated regardless of volume.',
  input_schema: {
    type: 'object',
    properties: {
      limit:      { type: 'integer', description: 'Max records to return. Default 500. Use 2000+ for full historical analysis.' },
      start_date: { type: 'string',  description: 'Fetch enquiries on or after this date (YYYY-MM-DD).' },
      end_date:   { type: 'string',  description: 'Fetch enquiries on or before this date (YYYY-MM-DD).' },
    },
    required: [],
  },
  requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const wp = await getWordPressServer(context.orgId);
    return callMcpTool(context.orgId, wp, 'wp_get_enquiries', {
      limit:      input.limit      ?? 500,
      start_date: input.start_date ?? undefined,
      end_date:   input.end_date   ?? undefined,
    });
  },
};

const enquiryFieldCheckTool = {
  name: 'enquiry_field_check',
  description: 'Shows every populated meta key and its value for the 5 most recent clientenquiry records. Use when you need to verify which fields actually exist in the database, discover unexpected fields, or confirm an ACF field name before referencing it.',
  input_schema: { type: 'object', properties: {}, required: [] },
  requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(_input, context) {
    const wp = await getWordPressServer(context.orgId);
    return callMcpTool(context.orgId, wp, 'wp_enquiry_field_check', {});
  },
};

const findMetaKeyTool = {
  name: 'find_meta_key',
  description: 'Search bqq_postmeta for rows matching a partial key or value pattern. Use to locate the exact meta_key a field is stored under — useful when a field name is uncertain or when looking for ACF fields. Note: ACF stores each field twice — the real value under the plain key (e.g. reason_not_interested) and an internal pointer under an underscore-prefixed key (e.g. _reason_not_interested). Always use the plain key.',
  input_schema: {
    type: 'object',
    properties: {
      key_like:   { type: 'string', description: 'Partial meta_key to search for (e.g. "reason" matches reason_not_interested).' },
      value_like: { type: 'string', description: 'Partial meta_value to search for.' },
    },
    required: [],
  },
  requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const wp = await getWordPressServer(context.orgId);
    return callMcpTool(context.orgId, wp, 'wp_find_meta_key', {
      key_like:   input.key_like   ?? undefined,
      value_like: input.value_like ?? undefined,
    });
  },
};

// ── Platform / report history tools ──────────────────────────────────────────

const listReportAgentsTool = {
  name: 'list_report_agents',
  description: 'Lists all report agents that have stored history — with run counts and last run date. Call this before get_report_history to discover what historical data is available.',
  input_schema: { type: 'object', properties: {}, required: [] },
  requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(_input, context) {
    const platform = await getPlatformServer(context.orgId);
    return callMcpTool(context.orgId, platform, 'list_report_agents', { org_id: context.orgId });
  },
};

const getReportHistoryTool = {
  name: 'get_report_history',
  description: 'Fetches stored historical reports for a specific agent — full summary text included. Use to analyse trends, compare periods, or answer questions about what past reports found. Available slugs: google-ads-monitor, google-ads-strategic-review, ads-attribution-summary, google-ads-change-impact, google-ads-change-audit.',
  input_schema: {
    type: 'object',
    properties: {
      slug:       { type: 'string',  description: 'Agent slug to fetch history for.' },
      limit:      { type: 'integer', description: 'Number of runs to return. Default 10.' },
      start_date: { type: 'string',  description: 'Only runs on or after this date (YYYY-MM-DD).' },
      end_date:   { type: 'string',  description: 'Only runs on or before this date (YYYY-MM-DD).' },
    },
    required: ['slug'],
  },
  requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const platform = await getPlatformServer(context.orgId);
    return callMcpTool(context.orgId, platform, 'get_report_history', {
      org_id:     context.orgId,
      slug:       input.slug,
      limit:      input.limit      ?? 10,
      start_date: input.start_date ?? undefined,
      end_date:   input.end_date   ?? undefined,
    });
  },
};

const searchReportHistoryTool = {
  name: 'search_report_history',
  description: 'Full-text search across all stored report summaries. Use to find reports that mentioned a specific topic, campaign, keyword, issue, or metric value. Returns matching reports ranked by relevance.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string',  description: 'Search terms, e.g. "CPA conversion rate" or "brand campaign negative keywords".' },
      slug:  { type: 'string',  description: 'Optional: restrict search to a specific agent slug.' },
      limit: { type: 'integer', description: 'Max results. Default 10.' },
    },
    required: ['query'],
  },
  requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const platform = await getPlatformServer(context.orgId);
    return callMcpTool(context.orgId, platform, 'search_report_history', {
      org_id: context.orgId,
      query:  input.query,
      slug:   input.slug   ?? undefined,
      limit:  input.limit  ?? 10,
    });
  },
};

// ── Knowledge base / RAG tools ────────────────────────────────────────────────

const searchKnowledgeTool = {
  name: 'search_knowledge',
  description: 'Semantic search across all indexed knowledge — past report summaries and any custom documents added to the knowledge base. Use when you need context that may have been captured in a previous report or document rather than live data. More powerful than keyword search — finds conceptually related content.',
  input_schema: {
    type: 'object',
    properties: {
      query:       { type: 'string',  description: 'What you are looking for — natural language.' },
      source_type: { type: 'string',  description: 'Optional: "agent_run" for report history only, "document" for added docs only.' },
      limit:       { type: 'integer', description: 'Max results. Default 8.' },
    },
    required: ['query'],
  },
  requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const kb = await getKnowledgeBaseServer(context.orgId);
    return callMcpTool(context.orgId, kb, 'search_knowledge', {
      org_id:      context.orgId,
      query:       input.query,
      source_type: input.source_type ?? undefined,
      limit:       input.limit       ?? 8,
    });
  },
};

const addDocumentTool = {
  name: 'add_document',
  description: 'Add a document to the knowledge base so it can be retrieved in future conversations. Use to store product information, SOPs, competitor notes, strategic briefs, or any reference material.',
  input_schema: {
    type: 'object',
    properties: {
      title:    { type: 'string', description: 'Document title.' },
      content:  { type: 'string', description: 'Full document text.' },
      category: { type: 'string', description: 'Optional category: "product", "competitor", "sop", "strategy", etc.' },
    },
    required: ['title', 'content'],
  },
  requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const kb = await getKnowledgeBaseServer(context.orgId);
    return callMcpTool(context.orgId, kb, 'add_document', {
      org_id:   context.orgId,
      title:    input.title,
      content:  input.content,
      category: input.category ?? undefined,
    });
  },
};

const flagPromptForReviewTool = {
  name: 'flag_prompt_for_review',
  description: 'Raise a flag for admin review of a system prompt. Use when you notice your own prompt is outdated, references stale business context, or would benefit from an update.',
  input_schema: {
    type: 'object',
    properties: {
      slug:   { type: 'string', description: 'Agent slug whose prompt needs review.' },
      reason: { type: 'string', description: 'Why the prompt needs updating (max 300 chars).' },
    },
    required: ['slug', 'reason'],
  },
  requiredPermissions: [], toolSlug: TOOL_SLUG,
  async execute(input, context) {
    const platform = await getPlatformServer(context.orgId);
    return callMcpTool(context.orgId, platform, 'flag_prompt_for_review', {
      org_id: context.orgId,
      slug:   input.slug,
      reason: input.reason,
    });
  },
};

const googleAdsConversationTools = [
  // Google Ads
  getCampaignPerformanceTool,
  getDailyPerformanceTool,
  getSearchTermsTool,
  getBudgetPacingTool,
  getActiveKeywordsTool,
  getChangeHistoryTool,
  // GA4
  getSessionsOverviewTool,
  getLandingPagePerformanceTool,
  // CRM
  getEnquiriesTool,
  getNotInterestedReasonsTool,
  enquiryFieldCheckTool,
  findMetaKeyTool,
  // Platform history + RAG
  getReportHistoryTool,
  searchKnowledgeTool,
  addDocumentTool,
];

module.exports = { googleAdsConversationTools, TOOL_SLUG };
