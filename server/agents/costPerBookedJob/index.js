'use strict';

/**
 * Cost Per Booked Job — cross-references Google Ads campaign spend with CRM close rates
 * to reveal the true cost per booked job, vs what Google Ads reports as CPA.
 *
 * Pre-fetch architecture: fetches Ads campaign performance and CRM enquiry_details in
 * parallel. CRM totals are computed across ALL enquiries (matching what the business owner
 * sees in the CRM), with paid (cpc) attribution shown as a subset. The two sides are kept
 * independent — CRM outcomes by utm_campaign, Ads spend by campaign name — because
 * utm_campaign values in tracking templates rarely match Ads campaign names exactly.
 *
 * Returns { result: { summary, data: { charts, startDate, endDate } }, trace, tokensUsed }
 */

const { agentOrchestrator } = require('../../platform/AgentOrchestrator');
const AgentConfigService    = require('../../platform/AgentConfigService');
const { getAdsServer, getWordPressServer, callMcpTool } = require('../../platform/mcpTools');
const { buildSystemPrompt } = require('./prompt');
const { TOOL_SLUG }         = require('./tools');

const WON_STATUS  = new Set(['completed', 'assigned']);
const LOST_STATUS = new Set(['notinterested', 'cancelled']);

function round2(n) {
  return n !== null && !isNaN(n) ? Math.round(n * 100) / 100 : null;
}

function round1(n) {
  return n !== null && !isNaN(n) ? Math.round(n * 10) / 10 : null;
}

function buildCharts(campaigns, enquiries, expectedCloseRate, avgJobValue) {
  // ── CRM: classify every enquiry, no medium filter ─────────────────────────
  let allEnquiries   = 0, allCompleted   = 0, allNotInt   = 0, allOpen   = 0;
  let paidEnquiries  = 0, paidCompleted  = 0, paidNotInt  = 0, paidOpen  = 0;
  let untracked      = 0;

  const crmMap = {};

  for (const enq of enquiries) {
    const isPaid      = enq.utm_medium === 'cpc' || (enq.gclid && String(enq.gclid).trim() !== '');
    const isWon       = WON_STATUS.has(enq.enquiry_status);
    const isLost      = LOST_STATUS.has(enq.enquiry_status);
    const isOpen      = !isWon && !isLost;
    const hasNoMedium = !enq.utm_medium && !(enq.gclid && String(enq.gclid).trim() !== '');

    allEnquiries++;
    if (isWon)       allCompleted++;
    else if (isLost) allNotInt++;
    else             allOpen++;

    if (isPaid) {
      paidEnquiries++;
      if (isWon)       paidCompleted++;
      else if (isLost) paidNotInt++;
      else             paidOpen++;
    }

    if (hasNoMedium) untracked++;

    if (isPaid) {
      const key = (enq.utm_campaign || '(no utm_campaign)').trim();
      if (!crmMap[key]) crmMap[key] = { utmCampaign: key, enquiries: 0, completed: 0, notInterested: 0, open: 0 };
      crmMap[key].enquiries++;
      if (isWon)       crmMap[key].completed++;
      else if (isLost) crmMap[key].notInterested++;
      else             crmMap[key].open++;
    }
  }

  const allTerminal  = allCompleted  + allNotInt;
  const paidTerminal = paidCompleted + paidNotInt;

  const allCloseRate  = allTerminal  >= 3 ? round1((allCompleted  / allTerminal)  * 100) : null;
  const paidCloseRate = paidTerminal >= 3 ? round1((paidCompleted / paidTerminal) * 100) : null;
  const openLeadPct   = allEnquiries > 0  ? round1((allOpen / allEnquiries) * 100)       : null;

  // ── Ads side ──────────────────────────────────────────────────────────────
  const adsCampaigns = campaigns.map((c) => ({
    campaign:    c.name,
    status:      c.status,
    spend:       round2(c.cost),
    impressions: c.impressions,
    clicks:      c.clicks,
    conversions: c.conversions,
    adsCpa:      c.conversions > 0 ? round2(c.cost / c.conversions) : null,
  })).sort((a, b) => b.spend - a.spend);

  // ── CRM breakdown by utm_campaign ─────────────────────────────────────────
  const crmByUtmCampaign = Object.values(crmMap)
    .sort((a, b) => b.enquiries - a.enquiries)
    .map((r) => {
      const terminal  = r.completed + r.notInterested;
      const closeRate = terminal >= 3 ? round1((r.completed / terminal) * 100) : null;
      // Projected booked jobs per campaign using expected close rate
      const projectedCompleted = expectedCloseRate != null
        ? Math.round(r.completed + (r.open * expectedCloseRate))
        : null;
      return { ...r, terminal, closeRate, projectedCompleted };
    });

  // ── Account totals ────────────────────────────────────────────────────────
  const totalAdsSpend       = campaigns.reduce((s, c) => s + (c.cost        || 0), 0);
  const totalAdsConversions = campaigns.reduce((s, c) => s + (c.conversions || 0), 0);
  const accountAdsCpa       = totalAdsConversions > 0 ? round2(totalAdsSpend / totalAdsConversions) : null;

  const accountCostPerBookedJob = allCompleted > 0 ? round2(totalAdsSpend / allCompleted)   : null;
  const accountCostPerEnquiry   = allEnquiries > 0 ? round2(totalAdsSpend / allEnquiries)   : null;
  const paidCostPerBookedJob    = paidCompleted > 0 ? round2(totalAdsSpend / paidCompleted) : null;

  // ── Projected totals (using expected close rate on open leads) ────────────
  // Projection = confirmed booked jobs + (open leads × expected close rate)
  // This is the best forward estimate when a large proportion of leads are still open.
  let projectedBookedJobs        = null;
  let projectedCostPerBookedJob  = null;
  let closeRateIsReliable        = openLeadPct !== null && openLeadPct < 25;

  if (expectedCloseRate != null && allOpen > 0) {
    projectedBookedJobs       = Math.round(allCompleted + (allOpen * expectedCloseRate));
    projectedCostPerBookedJob = projectedBookedJobs > 0
      ? round2(totalAdsSpend / projectedBookedJobs)
      : null;
  }

  const accountTotals = {
    allEnquiries,
    allCompleted,
    allNotInterested:     allNotInt,
    allOpen,
    allTerminal,
    allCloseRate,
    openLeadPct,
    closeRateIsReliable,
    paidEnquiries,
    paidCompleted,
    paidNotInterested:    paidNotInt,
    paidOpen,
    paidTerminal,
    paidCloseRate,
    untrackedEnquiries:   untracked,
    totalAdsSpend:        round2(totalAdsSpend),
    totalAdsConversions,
    accountAdsCpa,
    accountCostPerBookedJob,
    paidCostPerBookedJob,
    accountCostPerEnquiry,
    // Projection fields (null if expectedCloseRate not configured)
    expectedCloseRate:          expectedCloseRate != null ? round1(expectedCloseRate * 100) : null,
    projectedBookedJobs,
    projectedCostPerBookedJob,
    // Revenue and ROAS (null if avgJobValue not configured)
    avgJobValue:                avgJobValue != null ? round2(avgJobValue) : null,
    estimatedRevenue:           (() => {
      if (avgJobValue == null) return null;
      const jobs = projectedBookedJobs ?? allCompleted;
      return jobs > 0 ? round2(jobs * avgJobValue) : null;
    })(),
    roas: (() => {
      if (avgJobValue == null || totalAdsSpend === 0) return null;
      const jobs = projectedBookedJobs ?? allCompleted;
      return jobs > 0 ? round2((jobs * avgJobValue) / totalAdsSpend) : null;
    })(),
    breakEvenCpa:               avgJobValue != null && expectedCloseRate != null
      ? round2(avgJobValue * expectedCloseRate)
      : null,
  };

  return { crmByUtmCampaign, adsCampaigns, accountTotals };
}

async function runCostPerBookedJob(context) {
  const { orgId, req, emit } = context;

  const config = Object.keys(context.config || {}).length > 0
    ? context.config
    : await AgentConfigService.getAgentConfig(orgId, TOOL_SLUG);

  const adminConfig = Object.keys(context.adminConfig || {}).length > 0
    ? context.adminConfig
    : await AgentConfigService.getAdminConfig(TOOL_SLUG);

  let startDate = req?.body?.startDate ?? null;
  let endDate   = req?.body?.endDate   ?? null;

  if (!startDate || !endDate) {
    const days  = req?.body?.days ?? 90;
    const end   = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    startDate = start.toISOString().slice(0, 10);
    endDate   = end.toISOString().slice(0, 10);
  }

  const customerId = req?.body?.customerId ?? null;
  const rangeArgs  = { start_date: startDate, end_date: endDate };

  emit('Connecting to Google Ads and WordPress CRM…');

  const [adsServer, wpServer] = await Promise.all([
    getAdsServer(orgId).catch(() => null),
    getWordPressServer(orgId).catch(() => null),
  ]);

  if (!adsServer) throw new Error('Google Ads MCP server is not configured for this organisation.');
  if (!wpServer)  throw new Error('WordPress MCP server is not configured for this organisation.');

  emit('Fetching campaign performance and CRM enquiries in parallel…');

  const [campaigns, enquiries] = await Promise.all([
    callMcpTool(orgId, adsServer, 'ads_get_campaign_performance', {
      ...rangeArgs,
      customer_id: customerId ?? null,
    }).catch((e) => { emit('Ads error: ' + e.message); return []; }),
    callMcpTool(orgId, wpServer, 'wp_get_enquiry_details', {
      ...rangeArgs,
      limit: 2000,
    }).catch((e) => { emit('CRM error: ' + e.message); return []; }),
  ]);

  emit(`Fetched ${campaigns.length} Ads campaigns and ${enquiries.length} CRM enquiries`);

  if (!campaigns.length) throw new Error('No campaign data returned from Google Ads. Check the date range and Ads connection.');

  emit('Computing cost per booked job…');

  const monitorConfig     = await AgentConfigService.getAgentConfig(orgId, 'google-ads-monitor');
  const rawRate           = monitorConfig?.expected_close_rate;
  const expectedCloseRate = rawRate != null && !isNaN(parseFloat(rawRate)) ? parseFloat(rawRate) : null;
  const rawJobValue       = monitorConfig?.average_job_value;
  const avgJobValue       = rawJobValue != null && !isNaN(parseFloat(rawJobValue)) ? parseFloat(rawJobValue) : null;

  const charts = buildCharts(campaigns, enquiries, expectedCloseRate, avgJobValue);
  const { accountTotals } = charts;

  emit(`All enquiries: ${accountTotals.allEnquiries} · Booked jobs: ${accountTotals.allCompleted} · Close rate: ${accountTotals.allCloseRate ?? '—'}% · Cost/booked job: $${accountTotals.accountCostPerBookedJob ?? '—'}`);

  const agentPayload = {
    period:           `${startDate} to ${endDate}`,
    accountTotals,
    adsCampaigns:     charts.adsCampaigns,
    crmByUtmCampaign: charts.crmByUtmCampaign,
    notes: [
      'allEnquiries / allCompleted / allCloseRate: ALL CRM enquiries for the period regardless of traffic source. These match what the business owner sees in the CRM dashboard.',
      'paidEnquiries / paidCompleted / paidCloseRate: subset with utm_medium=cpc (tracked Google Ads traffic only).',
      'untrackedEnquiries: enquiries with no utm_medium — likely Google Ads clicks where UTM parameters were not captured (tracking gap).',
      'accountCostPerBookedJob = totalAdsSpend / allCompleted. Uses all CRM booked jobs as denominator. Most useful business metric — slightly understates Google Ads-specific cost if some booked jobs came from organic.',
      'paidCostPerBookedJob = totalAdsSpend / paidCompleted. Conservative view — only paid-attributed booked jobs in denominator.',
      'closeRate = completed / (completed + notInterested + cancelled). Open leads excluded — understated for periods under 60 days.',
      'crmByUtmCampaign groups paid (cpc) enquiries by utm_campaign value. Cannot be joined per-campaign to adsCampaigns because utm_campaign values may differ from Ads campaign names.',
    ],
  };

  const userMessage =
    `Produce the Cost Per Booked Job report for ${startDate} to ${endDate}.\n` +
    `All data has been pre-computed below. Do not request additional data.\n\n` +
    '```json\n' + JSON.stringify(agentPayload, null, 2) + '\n```';

  emit('Analysing true campaign ROI…');

  const run = await agentOrchestrator.run({
    systemPrompt:  buildSystemPrompt(config),
    userMessage,
    tools:         [],
    maxIterations: 1,
    model:         adminConfig.model          ?? 'claude-sonnet-4-6',
    maxTokens:     adminConfig.max_tokens     ?? 4096,
    fallbackModel: adminConfig.fallback_model ?? null,
    onStep:        emit,
    context:       { ...context, startDate, endDate, toolSlug: TOOL_SLUG, customerId },
  });

  return {
    result: {
      summary: run.result.summary,
      data:    { charts, startDate, endDate },
    },
    trace:      run.trace,
    tokensUsed: run.tokensUsed,
  };
}

module.exports = { runCostPerBookedJob };
