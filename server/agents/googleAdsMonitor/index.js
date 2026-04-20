'use strict';

/**
 * Google Ads Monitor agent — pre-fetch architecture.
 *
 * WHY PRE-FETCH: All four data sources (campaign performance, daily performance,
 * search terms, GA4 sessions) are fetched unconditionally every run. The ReAct
 * loop added quadratic token cost for a fixed, predictable sequence.
 *
 * Pre-fetch pulls all four sources in parallel in Node.js, passes the complete
 * dataset to Claude in a single message, no tools, no loop.
 *
 * Estimated cost: ~$0.05–$0.15 per run (vs $0.30–$0.70 with ReAct).
 *
 * context shape (from createAgentRoute for HTTP runs):
 *   { orgId, userId, config, adminConfig, req, emit }
 *
 * req.body may contain:
 *   { startDate, endDate }  — date-picker selection
 *   { days }                — legacy lookback
 *   { customerId }          — run against a specific customer account
 *
 * Scheduled runs: AgentScheduler passes empty config/adminConfig, so both are
 * loaded from DB. If multiple google_ads_customers rows exist for this org,
 * runs are fanned out — one per customer — and the results array triggers
 * AgentScheduler's multi-run persist path.
 */

const { agentOrchestrator }  = require('../../platform/AgentOrchestrator');
const AgentConfigService     = require('../../platform/AgentConfigService');
const { pool }               = require('../../db');
const { getAdsServer, getAnalyticsServer, callMcpTool } = require('../../platform/mcpTools');
const { buildSystemPrompt }  = require('./prompt');
const { TOOL_SLUG }          = require('./tools');

async function runSingleCustomer(orgId, config, adminConfig, companyProfile, startDate, endDate, customerId, emit, context) {
  const customerVars = customerId
    ? { customer_id: customerId, customer_name: config.customer_name ?? customerId }
    : {};

  const rangeArgs = { start_date: startDate, end_date: endDate };

  // ── Pre-fetch: all four sources in parallel ─────────────────────────────────

  emit('Fetching campaign performance, daily trends, search terms, and GA4 data…');

  const [adsServer, gaServer] = await Promise.all([
    getAdsServer(orgId),
    getAnalyticsServer(orgId),
  ]);

  const [campaignPerformance, dailyPerformance, searchTerms, sessionsOverview] = await Promise.all([
    callMcpTool(orgId, adsServer, 'ads_get_campaign_performance', {
      ...rangeArgs,
      customer_id: customerId ?? null,
    }).catch((e) => ({ error: e.message })),
    callMcpTool(orgId, adsServer, 'ads_get_daily_performance', {
      ...rangeArgs,
      customer_id: customerId ?? null,
    }).catch((e) => ({ error: e.message })),
    callMcpTool(orgId, adsServer, 'ads_get_search_terms', {
      ...rangeArgs,
      customer_id: customerId ?? null,
    }).catch((e) => ({ error: e.message })),
    callMcpTool(orgId, gaServer, 'ga4_get_sessions_overview', rangeArgs)
      .catch((e) => ({ error: e.message })),
  ]);

  // ── Single Claude call — no tools, no loop ────────────────────────────────────

  emit('Analysing campaign performance…');

  const payload = {
    period: `${startDate} to ${endDate}`,
    campaignPerformance,
    dailyPerformance,
    searchTerms,
    sessionsOverview,
  };

  const userMessage =
    `Analyse campaign performance from ${startDate} to ${endDate}. ` +
    `All data has been pre-fetched below. Produce the full performance report with optimisation recommendations.\n\n` +
    `\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;

  const { result, trace, tokensUsed } = await agentOrchestrator.run({
    systemPrompt:  buildSystemPrompt(config, customerVars, companyProfile),
    userMessage,
    tools:         [],
    maxIterations: 1,
    model:         adminConfig.model      ?? 'claude-sonnet-4-6',
    maxTokens:     adminConfig.max_tokens ?? 8192,
    fallbackModel: adminConfig.fallback_model ?? null,
    onStep:        emit,
    context:       { ...context, startDate, endDate, toolSlug: TOOL_SLUG, customerId },
  });

  return { result, trace, tokensUsed };
}

async function runGoogleAdsMonitor(context) {
  const { orgId, req, emit } = context;

  const isScheduled = Object.keys(context.config ?? {}).length === 0;

  const config = !isScheduled
    ? context.config
    : await AgentConfigService.getAgentConfig(orgId, TOOL_SLUG);

  const adminConfig = !isScheduled
    ? context.adminConfig
    : await AgentConfigService.getAdminConfig(TOOL_SLUG);

  let startDate = req?.body?.startDate ?? null;
  let endDate   = req?.body?.endDate   ?? null;

  if (!startDate || !endDate) {
    const days  = req?.body?.days ?? config.lookback_days ?? 30;
    const end   = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    startDate = start.toISOString().slice(0, 10);
    endDate   = end.toISOString().slice(0, 10);
  }

  const companyProfile = await AgentConfigService.getCompanyProfile(orgId);

  // HTTP run: single customer (explicit or default)
  if (!isScheduled) {
    const customerId = req?.body?.customerId ?? null;
    const customerConfig = customerId
      ? await AgentConfigService.getAgentConfigForCustomer(orgId, TOOL_SLUG, customerId)
      : config;
    return runSingleCustomer(orgId, customerConfig, adminConfig, companyProfile, startDate, endDate, customerId, emit, context);
  }

  // Scheduled run: fan out across registered customers (if any)
  let customers = [];
  try {
    const res = await pool.query(
      `SELECT customer_id, customer_name FROM google_ads_customers
        WHERE org_id = $1 AND is_active = TRUE ORDER BY customer_id`,
      [orgId]
    );
    customers = res.rows;
  } catch (err) {
    console.error('[googleAdsMonitor] Could not load customers:', err.message);
  }

  if (customers.length === 0) {
    return runSingleCustomer(orgId, config, adminConfig, companyProfile, startDate, endDate, null, emit, context);
  }

  const results = [];
  for (const customer of customers) {
    const customerConfig = await AgentConfigService.getAgentConfigForCustomer(orgId, TOOL_SLUG, customer.customer_id);
    try {
      const outcome = await runSingleCustomer(
        orgId,
        { ...customerConfig, customer_name: customer.customer_name },
        adminConfig,
        companyProfile,
        startDate,
        endDate,
        customer.customer_id,
        () => {},
        context,
      );
      results.push({ customerId: customer.customer_id, status: 'complete', result: outcome.result });
    } catch (err) {
      results.push({ customerId: customer.customer_id, status: 'error', error: err.message });
    }
  }
  return results;
}

module.exports = { runGoogleAdsMonitor };
