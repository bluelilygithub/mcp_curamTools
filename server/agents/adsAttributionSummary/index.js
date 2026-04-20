'use strict';

/**
 * Ads Attribution Summary agent — pre-fetch architecture.
 *
 * WHY PRE-FETCH: All three data sources (campaign performance, GA4 sessions,
 * WordPress enquiries) are fetched unconditionally every run.
 *
 * CRM enquiries are pre-computed in Node.js before Claude sees them, using
 * consistent paid-identification logic: utm_medium = 'cpc' OR gclid present.
 * This matches the business reality — enquiries with a gclid but no utm_medium
 * are Google Ads clicks where the UTM parameters were not captured (tracking gap).
 * Raw enquiry records are not passed to Claude; only pre-computed aggregates are.
 */

const { agentOrchestrator }  = require('../../platform/AgentOrchestrator');
const AgentConfigService     = require('../../platform/AgentConfigService');
const { getAdsServer, getAnalyticsServer, getWordPressServer, callMcpTool } = require('../../platform/mcpTools');
const { buildSystemPrompt }  = require('./prompt');
const { TOOL_SLUG }          = require('./tools');

function topN(obj, n) {
  return Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, value]) => ({ key, value }));
}

const WON_STATUS  = new Set(['completed', 'assigned']);
const LOST_STATUS = new Set(['notinterested', 'cancelled']);

function buildCrmSummary(rawEnquiries) {
  let total = 0, paid = 0, cpcTagged = 0, gclidOnly = 0, untracked = 0;
  let allWon = 0, allLost = 0;

  const byStatus      = {};
  const bySource      = {};
  const byMedium      = {};
  const byUtmCampaign = {};

  for (const enq of rawEnquiries) {
    const hasCpc      = enq.utm_medium === 'cpc';
    const hasGclid    = enq.gclid && String(enq.gclid).trim() !== '';
    const isPaid      = hasCpc || hasGclid;
    const isUntracked = !enq.utm_medium && !hasGclid;

    total++;
    if (isPaid)              paid++;
    if (hasCpc)              cpcTagged++;
    if (hasGclid && !hasCpc) gclidOnly++;
    if (isUntracked)         untracked++;

    if (WON_STATUS.has(enq.enquiry_status))  allWon++;
    if (LOST_STATUS.has(enq.enquiry_status)) allLost++;

    const status = enq.enquiry_status || 'unknown';
    byStatus[status] = (byStatus[status] || 0) + 1;

    if (enq.utm_source) bySource[enq.utm_source] = (bySource[enq.utm_source] || 0) + 1;
    if (enq.utm_medium) byMedium[enq.utm_medium] = (byMedium[enq.utm_medium] || 0) + 1;

    if (enq.utm_campaign) {
      const k = enq.utm_campaign;
      if (!byUtmCampaign[k]) byUtmCampaign[k] = { total: 0, paid: 0 };
      byUtmCampaign[k].total++;
      if (isPaid) byUtmCampaign[k].paid++;
    }
  }

  const allTerminal = allWon + allLost;
  const allOpen     = total - allTerminal;
  const allCloseRate = allTerminal >= 3
    ? Math.round((allWon / allTerminal) * 1000) / 10
    : null;
  const openLeadPct = total > 0 ? Math.round((allOpen / total) * 1000) / 10 : null;

  // Sort utm_campaign by total enquiries, top 15
  const topCampaigns = Object.entries(byUtmCampaign)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 15)
    .map(([campaign, counts]) => ({ campaign, ...counts }));

  return {
    total,
    paid,
    cpcTagged,
    gclidOnly,
    untracked,
    allWon,
    allLost,
    allOpen,
    allTerminal,
    allCloseRate,
    openLeadPct,
    byStatus,
    topSources:   topN(bySource,  8),
    topMediums:   topN(byMedium,  8),
    topCampaigns,
  };
}

async function runAdsAttributionSummary(context) {
  const { orgId, req, emit } = context;

  const adminConfig = await AgentConfigService.getAdminConfig(TOOL_SLUG);

  let startDate = req?.body?.startDate ?? null;
  let endDate   = req?.body?.endDate   ?? null;

  if (!startDate || !endDate) {
    const days  = req?.body?.days ?? 30;
    const end   = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    startDate = start.toISOString().slice(0, 10);
    endDate   = end.toISOString().slice(0, 10);
  }

  const customerId = req?.body?.customerId ?? null;
  const rangeArgs  = { start_date: startDate, end_date: endDate };

  emit('Fetching campaign performance, GA4 sessions, and CRM enquiries…');

  const [adsServer, gaServer, wpServer] = await Promise.all([
    getAdsServer(orgId),
    getAnalyticsServer(orgId),
    getWordPressServer(orgId),
  ]);

  const [campaignPerformance, sessionsOverview, rawEnquiries] = await Promise.all([
    callMcpTool(orgId, adsServer, 'ads_get_campaign_performance', {
      ...rangeArgs,
      customer_id: customerId ?? null,
    }).catch((e) => ({ error: e.message })),
    callMcpTool(orgId, gaServer, 'ga4_get_sessions_overview', rangeArgs)
      .catch((e) => ({ error: e.message })),
    callMcpTool(orgId, wpServer, 'wp_get_enquiries', {
      ...rangeArgs,
      limit: 1000,
    }).catch((e) => ({ error: e.message })),
  ]);

  emit('Computing CRM attribution summary…');

  const enquiries  = Array.isArray(rawEnquiries) ? rawEnquiries : [];
  const crmSummary = buildCrmSummary(enquiries);

  emit(`CRM: ${crmSummary.total} enquiries — ${crmSummary.paid} paid (${crmSummary.cpcTagged} cpc-tagged, ${crmSummary.gclidOnly} gclid-only), ${crmSummary.untracked} untracked`);

  const monitorConfig     = await AgentConfigService.getAgentConfig(orgId, 'google-ads-monitor');
  const rawRate           = monitorConfig?.expected_close_rate;
  const expectedCloseRate = rawRate != null && !isNaN(parseFloat(rawRate)) ? parseFloat(rawRate) : null;
  const rawJobValue       = monitorConfig?.average_job_value;
  const avgJobValue       = rawJobValue != null && !isNaN(parseFloat(rawJobValue)) ? parseFloat(rawJobValue) : null;

  let projection = null;
  if (expectedCloseRate != null && crmSummary.allOpen > 0) {
    const projectedWon  = Math.round(crmSummary.allWon + (crmSummary.allOpen * expectedCloseRate));
    const totalAdsSpend = Array.isArray(campaignPerformance)
      ? campaignPerformance.reduce((s, c) => s + (c.cost || 0), 0)
      : null;
    const projectedCostPerBookedJob = totalAdsSpend && projectedWon > 0
      ? Math.round((totalAdsSpend / projectedWon) * 100) / 100
      : null;
    const estimatedRevenue = avgJobValue && projectedWon > 0
      ? Math.round(projectedWon * avgJobValue * 100) / 100
      : null;
    projection = {
      expectedCloseRate:        Math.round(expectedCloseRate * 1000) / 10,
      avgJobValue:              avgJobValue ?? null,
      projectedBookedJobs:      projectedWon,
      projectedCostPerBookedJob,
      estimatedRevenue,
      roas:                     estimatedRevenue && totalAdsSpend > 0
        ? Math.round((estimatedRevenue / totalAdsSpend) * 100) / 100
        : null,
      breakEvenCpa:             avgJobValue && expectedCloseRate
        ? Math.round(avgJobValue * expectedCloseRate * 100) / 100
        : null,
      closeRateIsReliable:      crmSummary.openLeadPct !== null && crmSummary.openLeadPct < 25,
    };
  }

  const payload = {
    period: `${startDate} to ${endDate}`,
    campaignPerformance,
    sessionsOverview,
    crmSummary,
    projection,
    crmNote: rawEnquiries?.error ? `CRM error: ${rawEnquiries.error}` : null,
  };

  const userMessage =
    `Produce an attribution summary for the period ${startDate} to ${endDate}. ` +
    `All data has been pre-fetched and CRM aggregates pre-computed below. Write the cross-channel summary as instructed.\n\n` +
    `\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;

  emit('Building attribution summary…');

  const { result, trace, tokensUsed } = await agentOrchestrator.run({
    systemPrompt:  buildSystemPrompt(),
    userMessage,
    tools:         [],
    maxIterations: 1,
    model:         adminConfig.model          ?? 'claude-sonnet-4-6',
    maxTokens:     adminConfig.max_tokens     ?? 4096,
    fallbackModel: adminConfig.fallback_model ?? null,
    onStep:        emit,
    context:       { ...context, startDate, endDate, toolSlug: TOOL_SLUG, customerId },
  });

  return { result, trace, tokensUsed };
}

module.exports = { runAdsAttributionSummary };
