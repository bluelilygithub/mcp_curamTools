'use strict';

/**
 * Keyword Opportunity agent — hybrid pre-fetch architecture.
 *
 * Phase 1 (parallel): fixed MCP data — active keywords, search terms, campaign
 * structure, GA4 traffic sources, CRM enquiries (12m), global competitor list.
 *
 * Phase 2 (sequential): one Anthropic web search per competitor using the
 * web_search_20250305 beta tool (same pattern as ai-visibility-monitor).
 * Sequential to respect rate limits.
 *
 * Phase 3: single Claude analysis call — no tools, no loop.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { agentOrchestrator }  = require('../../platform/AgentOrchestrator');
const AgentConfigService     = require('../../platform/AgentConfigService');
const { getAdsServer, getAnalyticsServer, getWordPressServer, callMcpTool } = require('../../platform/mcpTools');
const { buildSystemPrompt }  = require('./prompt');
const { TOOL_SLUG }          = require('./tools');

const DEFAULT_COMPETITORS = [
  { name: 'Ceramic Pro Australia',  url: 'ceramicpro.com.au' },
  { name: 'Gtechniq Australia',     url: 'gtechniq.com' },
  { name: 'Gyeon Australia',        url: 'gyeonquartz.com.au' },
  { name: 'IGL Coatings',           url: 'iglcoatings.com' },
  { name: 'CarPro Australia',       url: 'carpro.com.au' },
];

async function runWebSearch(wsClient, query, model) {
  try {
    const response = await wsClient.messages.create({
      model,
      max_tokens: 1024,
      tools: [{
        type:          'web_search_20250305',
        name:          'web_search',
        max_uses:      2,
        user_location: { type: 'approximate', country: 'AU' },
      }],
      messages: [{ role: 'user', content: query }],
    });

    let responseText = '';
    const citedUrls = [];
    for (const block of response.content) {
      if (block.type === 'text') responseText += block.text;
      if (block.type === 'web_search_tool_result') {
        const items = Array.isArray(block.content) ? block.content : [];
        for (const item of items) {
          if (item.url && !citedUrls.includes(item.url)) citedUrls.push(item.url);
        }
      }
    }
    return { responseText: responseText.trim(), citedUrls };
  } catch (err) {
    return { error: err.message, responseText: '', citedUrls: [] };
  }
}

async function runKeywordOpportunity(context) {
  const { orgId, req, emit } = context;

  const adminConfig    = await AgentConfigService.getAdminConfig(TOOL_SLUG);
  const config         = await AgentConfigService.getAgentConfig(orgId, TOOL_SLUG);
  const companyProfile = await AgentConfigService.getCompanyProfile(orgId);

  const model      = adminConfig.model ?? 'claude-sonnet-4-6';
  const customerId = req?.body?.customerId ?? null;

  // ── Date ranges ────────────────────────────────────────────────────────────

  const today        = new Date().toISOString().slice(0, 10);
  const start90      = new Date(); start90.setDate(start90.getDate() - 90);
  const start365     = new Date(); start365.setFullYear(start365.getFullYear() - 1);
  const ninetyDaysAgo = start90.toISOString().slice(0, 10);
  const oneYearAgo    = start365.toISOString().slice(0, 10);

  const rangeArgs = { start_date: ninetyDaysAgo, end_date: today };
  const cidArgs   = { customer_id: customerId ?? null };

  // ── Phase 1: MCP data + competitor list in parallel ────────────────────────

  emit('Fetching keyword data, CRM enquiries, and competitor list…');

  const [adsServer, gaServer, wpServer, competitorSettings] = await Promise.all([
    getAdsServer(orgId),
    getAnalyticsServer(orgId),
    getWordPressServer(orgId),
    AgentConfigService.getCompetitorSettings(orgId),
  ]);

  const competitors = (Array.isArray(competitorSettings.competitors) && competitorSettings.competitors.length > 0)
    ? competitorSettings.competitors
    : DEFAULT_COMPETITORS;

  const [activeKeywords, searchTerms, campaignPerformance, trafficSources, enquiries] = await Promise.all([
    callMcpTool(orgId, adsServer, 'ads_get_active_keywords',      { ...cidArgs }).catch((e) => ({ error: e.message })),
    callMcpTool(orgId, adsServer, 'ads_get_search_terms',         { ...rangeArgs, ...cidArgs }).catch((e) => ({ error: e.message })),
    callMcpTool(orgId, adsServer, 'ads_get_campaign_performance', { ...rangeArgs, ...cidArgs }).catch((e) => ({ error: e.message })),
    callMcpTool(orgId, gaServer,  'ga4_get_traffic_sources',      rangeArgs).catch((e) => ({ error: e.message })),
    callMcpTool(orgId, wpServer,  'wp_get_enquiries',             { limit: 1000, start_date: oneYearAgo, end_date: today }).catch((e) => ({ error: e.message })),
  ]);

  // ── Phase 2: web search per competitor (sequential) ────────────────────────

  emit(`Researching ${competitors.length} competitor${competitors.length !== 1 ? 's' : ''} via web search…`);

  const wsClient = new Anthropic({
    apiKey:         process.env.ANTHROPIC_API_KEY,
    defaultHeaders: { 'anthropic-beta': 'web-search-2025-03-05' },
  });

  const competitorResearch = [];
  for (let i = 0; i < competitors.length; i++) {
    const c = competitors[i];
    emit(`[${i + 1}/${competitors.length}] Searching: ${c.name}`);
    const query = `"${c.name}" australia ceramic coating paint protection graphene services keywords`;
    const result = await runWebSearch(wsClient, query, model);
    competitorResearch.push({ competitor: { name: c.name, url: c.url }, ...result });
  }

  // ── Phase 3: single Claude analysis call ──────────────────────────────────

  emit('Identifying keyword opportunities…');

  const payload = {
    period:              `${ninetyDaysAgo} to ${today} (Ads/GA4); ${oneYearAgo} to ${today} (CRM)`,
    activeKeywords,
    searchTerms,
    campaignPerformance,
    trafficSources,
    enquiries,
    competitorResearch,
  };

  const userMessage =
    `Produce the Keyword Opportunity Report. All data has been pre-fetched below. ` +
    `${competitors.length} competitor${competitors.length !== 1 ? 's' : ''} researched via web search.\n\n` +
    `\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;

  const { result, trace, tokensUsed } = await agentOrchestrator.run({
    systemPrompt:  buildSystemPrompt(config, companyProfile),
    userMessage,
    tools:         [],
    maxIterations: 1,
    model,
    maxTokens:     adminConfig.max_tokens  ?? 8192,
    fallbackModel: adminConfig.fallback_model ?? null,
    onStep:        emit,
    context:       { ...context, toolSlug: TOOL_SLUG, customerId },
  });

  return { result, trace, tokensUsed };
}

module.exports = { runKeywordOpportunity };
