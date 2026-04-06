'use strict';

/**
 * Google Ads Change Audit — pre-fetch architecture.
 *
 * WHY: The original ReAct loop called get_campaign_performance twice per change
 * date (before + after), accumulating all results in Claude's context across
 * 15 iterations. On a 16-day window that cost ~$2.50 per run.
 *
 * This version pre-fetches ALL data in Node.js before Claude is called:
 *   1. Fetch change history for the audit period
 *   2. Identify unique change dates
 *   3. Fetch before/after campaign performance for each date in parallel
 *   4. Pass the complete dataset to Claude in a single message — no tools, no loop
 *
 * Estimated cost: $0.15–$0.35 per run (vs $2.50 with ReAct).
 */

const { agentOrchestrator } = require('../../platform/AgentOrchestrator');
const AgentConfigService    = require('../../platform/AgentConfigService');
const { getAdsServer, callMcpTool } = require('../../platform/mcpTools');
const { buildSystemPrompt } = require('./prompt');
const { TOOL_SLUG } = require('./tools');

function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

async function runGoogleAdsChangeAudit(context) {
  const { orgId, req, emit } = context;

  const config = Object.keys(context.config ?? {}).length > 0
    ? context.config
    : await AgentConfigService.getAgentConfig(orgId, TOOL_SLUG);

  const adminConfig = Object.keys(context.adminConfig ?? {}).length > 0
    ? context.adminConfig
    : await AgentConfigService.getAdminConfig(TOOL_SLUG);

  const customerId = req?.body?.customerId ?? null;
  const windowDays = config.comparison_window_days ?? 7;

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

  const today = new Date().toISOString().slice(0, 10);

  const customerConfig = customerId
    ? await AgentConfigService.getAgentConfigForCustomer(orgId, TOOL_SLUG, customerId)
    : config;

  const customerVars = customerId
    ? { customer_id: customerId, customer_name: customerConfig.customer_name ?? customerId }
    : {};

  // ── Step 1: Change history ────────────────────────────────────────────────
  // Google Ads Change History retains only 30 days. If the requested start date
  // falls outside that window, automatically clamp to 28 days ago and retry.

  emit('Fetching change history…');
  const adsServer = await getAdsServer(orgId);

  let changeHistory;
  let windowCapped       = false;
  let effectiveStartDate = startDate;

  try {
    changeHistory = await callMcpTool(orgId, adsServer, 'ads_get_change_history', {
      start_date:  startDate,
      end_date:    endDate,
      customer_id: customerId ?? null,
    });
  } catch (err) {
    if (String(err.message ?? '').includes('START_DATE_TOO_OLD')) {
      const safeStart = new Date();
      safeStart.setDate(safeStart.getDate() - 28);
      effectiveStartDate = safeStart.toISOString().slice(0, 10);
      windowCapped = true;
      emit(`⚠ Requested window starts ${startDate} — beyond Google Ads' 30-day Change History retention. Retrying from ${effectiveStartDate}.`);
      changeHistory = await callMcpTool(orgId, adsServer, 'ads_get_change_history', {
        start_date:  effectiveStartDate,
        end_date:    endDate,
        customer_id: customerId ?? null,
      });
    } else {
      throw err;
    }
  }

  if (!Array.isArray(changeHistory) || changeHistory.length === 0) {
    const { result, tokensUsed } = await agentOrchestrator.run({
      systemPrompt:  buildSystemPrompt(customerConfig, customerVars),
      userMessage:   `No changes were detected in the Google Ads account between ${startDate} and ${endDate}. Report this finding.`,
      tools:         [],
      maxIterations: 1,
      model:         adminConfig.model      ?? 'claude-sonnet-4-6',
      maxTokens:     adminConfig.max_tokens ?? 4096,
      fallbackModel: adminConfig.fallback_model ?? null,
      onStep:        emit,
      context:       { ...context, startDate, endDate, toolSlug: TOOL_SLUG, customerId },
    });
    return { result, trace: [], tokensUsed };
  }

  // ── Step 2: Identify unique change dates, fetch before/after in parallel ──

  const changeDates = [...new Set(
    changeHistory
      .map((c) => (c.changedAt ?? c.changed_at ?? '').slice(0, 10))
      .filter(Boolean)
  )].sort();

  emit(`Fetching before/after performance for ${changeDates.length} change date(s)…`);

  const performanceByDate = {};
  await Promise.all(changeDates.map(async (date) => {
    const beforeStart = addDays(date, -windowDays);
    const beforeEnd   = addDays(date, -1);
    const afterStart  = date;
    const afterEnd    = addDays(date, windowDays) > today ? today : addDays(date, windowDays);

    const [before, after] = await Promise.all([
      callMcpTool(orgId, adsServer, 'ads_get_campaign_performance', {
        start_date: beforeStart, end_date: beforeEnd, customer_id: customerId ?? null,
      }).catch((e) => ({ error: e.message })),
      callMcpTool(orgId, adsServer, 'ads_get_campaign_performance', {
        start_date: afterStart, end_date: afterEnd, customer_id: customerId ?? null,
      }).catch((e) => ({ error: e.message })),
    ]);

    performanceByDate[date] = {
      beforeWindow: `${beforeStart} to ${beforeEnd}`,
      afterWindow:  `${afterStart} to ${afterEnd}`,
      before,
      after,
    };
  }));

  // ── Step 3: Single Claude call — no tools, no loop ────────────────────────

  emit('Analysing changes…');

  const auditPayload = {
    auditPeriod:          `${effectiveStartDate} to ${endDate}`,
    comparisonWindowDays: windowDays,
    ...(windowCapped && {
      dataNote: `Change History was only available from ${effectiveStartDate} (requested ${startDate} was beyond Google Ads' 30-day retention limit). The audit covers the available window only.`,
    }),
    changeHistory,
    performanceByChangeDate: performanceByDate,
  };

  const userMessage =
    `Audit period: ${effectiveStartDate} to ${endDate}. ` +
    `All change history and before/after performance data has been pre-fetched below. ` +
    `Analyse the data and produce the full audit report.\n\n` +
    `\`\`\`json\n${JSON.stringify(auditPayload, null, 2)}\n\`\`\``;

  const { result, trace, tokensUsed } = await agentOrchestrator.run({
    systemPrompt:  buildSystemPrompt(customerConfig, customerVars),
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

module.exports = { runGoogleAdsChangeAudit };
