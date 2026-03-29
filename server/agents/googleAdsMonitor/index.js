'use strict';

/**
 * Google Ads Monitor agent — runFn entry point.
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
const { googleAdsMonitorTools, TOOL_SLUG } = require('./tools');
const { buildSystemPrompt }  = require('./prompt');

function buildUserMessage(startDate, endDate) {
  return (
    `Analyse campaign performance from ${startDate} to ${endDate} ` +
    'and provide optimisation recommendations focused on high-intent traffic within current budget.'
  );
}

async function runSingleCustomer(orgId, config, adminConfig, startDate, endDate, customerId, emit, context) {
  const customerVars = customerId
    ? { customer_id: customerId, customer_name: config.customer_name ?? customerId }
    : {};

  const { result, trace, tokensUsed } = await agentOrchestrator.run({
    systemPrompt:  buildSystemPrompt(config, customerVars),
    userMessage:   buildUserMessage(startDate, endDate),
    tools:         googleAdsMonitorTools,
    model:         adminConfig.model          ?? 'claude-sonnet-4-6',
    maxTokens:     adminConfig.max_tokens     ?? 8192,
    maxIterations: adminConfig.max_iterations ?? 10,
    onStep:        emit,
    context:       { ...context, startDate, endDate, toolSlug: TOOL_SLUG, customerId },
  });

  return { result, trace, tokensUsed };
}

async function runGoogleAdsMonitor(context) {
  const { orgId, req, emit } = context;

  const isScheduled = Object.keys(context.config ?? {}).length === 0;

  // Load org-level config (always used as base)
  const config = !isScheduled
    ? context.config
    : await AgentConfigService.getAgentConfig(orgId, TOOL_SLUG);

  const adminConfig = !isScheduled
    ? context.adminConfig
    : await AgentConfigService.getAdminConfig(TOOL_SLUG);

  // Date range resolution: explicit dates > days param > config default > 30 days
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

  // HTTP run: single customer (explicit or default)
  if (!isScheduled) {
    const customerId = req?.body?.customerId ?? null;
    const customerConfig = customerId
      ? await AgentConfigService.getAgentConfigForCustomer(orgId, TOOL_SLUG, customerId)
      : config;
    return runSingleCustomer(orgId, customerConfig, adminConfig, startDate, endDate, customerId, emit, context);
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
    // No multi-customer rows — single default run
    return runSingleCustomer(orgId, config, adminConfig, startDate, endDate, null, emit, context);
  }

  // Multi-customer: return array so AgentScheduler persists one row per customer
  const results = [];
  for (const customer of customers) {
    const customerConfig = await AgentConfigService.getAgentConfigForCustomer(orgId, TOOL_SLUG, customer.customer_id);
    try {
      const outcome = await runSingleCustomer(
        orgId,
        { ...customerConfig, customer_name: customer.customer_name },
        adminConfig,
        startDate,
        endDate,
        customer.customer_id,
        () => {},  // no SSE emit for scheduled runs
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
