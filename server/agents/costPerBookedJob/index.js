'use strict';

/**
 * Cost Per Booked Job — cross-references Google Ads campaign spend with CRM close rates
 * to reveal the true cost per booked job, vs what Google Ads reports as CPA.
 *
 * Pre-fetch architecture: fetches Ads campaign performance and CRM enquiry_details in
 * parallel. The two sides are kept independent — CRM outcomes by utm_campaign, Ads spend
 * by campaign name — because utm_campaign values in tracking templates rarely match Ads
 * campaign names exactly. Account-level cost per booked job is computed directly:
 * total Ads spend / total CRM booked jobs (paid traffic).
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

function buildCharts(campaigns, enquiries) {
  // ── CRM side: outcomes by utm_campaign (paid traffic only) ────────────────
  const crmMap = {};
  for (const enq of enquiries) {
    if (enq.utm_medium !== 'cpc') continue;
    const key = (enq.utm_campaign || '(no utm_campaign)').trim();
    if (!crmMap[key]) crmMap[key] = { utmCampaign: key, enquiries: 0, completed: 0, notInterested: 0, open: 0 };
    crmMap[key].enquiries++;
    if (WON_STATUS.has(enq.enquiry_status))       crmMap[key].completed++;
    else if (LOST_STATUS.has(enq.enquiry_status)) crmMap[key].notInterested++;
    else                                           crmMap[key].open++;
  }

  const crmByUtmCampaign = Object.values(crmMap)
    .sort((a, b) => b.enquiries - a.enquiries)
    .map((r) => {
      const terminal  = r.completed + r.notInterested;
      const closeRate = terminal >= 3 ? round1((r.completed / terminal) * 100) : null;
      return { ...r, terminal, closeRate };
    });

  // ── Ads side: spend and CPA by campaign name ──────────────────────────────
  const adsCampaigns = campaigns.map((c) => ({
    campaign:    c.name,
    status:      c.status,
    spend:       round2(c.cost),
    impressions: c.impressions,
    clicks:      c.clicks,
    conversions: c.conversions,
    adsCpa:      c.conversions > 0 ? round2(c.cost / c.conversions) : null,
  })).sort((a, b) => b.spend - a.spend);

  // ── Account-level totals ──────────────────────────────────────────────────
  const totalAdsSpend      = campaigns.reduce((s, c) => s + (c.cost       || 0), 0);
  const totalAdsConversions = campaigns.reduce((s, c) => s + (c.conversions || 0), 0);

  const allCrmPaid     = Object.values(crmMap);
  const totalEnquiries  = allCrmPaid.reduce((s, r) => s + r.enquiries,    0);
  const totalCompleted  = allCrmPaid.reduce((s, r) => s + r.completed,    0);
  const totalNotInt     = allCrmPaid.reduce((s, r) => s + r.notInterested, 0);
  const totalTerminal   = totalCompleted + totalNotInt;
  const totalOpen       = allCrmPaid.reduce((s, r) => s + r.open, 0);

  const accountCloseRate        = totalTerminal >= 3 ? round1((totalCompleted / totalTerminal) * 100) : null;
  const accountCostPerEnquiry   = totalEnquiries > 0  ? round2(totalAdsSpend / totalEnquiries)  : null;
  const accountCostPerBookedJob = totalCompleted > 0   ? round2(totalAdsSpend / totalCompleted)  : null;
  const accountAdsCpa           = totalAdsConversions > 0 ? round2(totalAdsSpend / totalAdsConversions) : null;

  const accountTotals = {
    totalAdsSpend:           round2(totalAdsSpend),
    totalAdsConversions,
    accountAdsCpa,
    totalPaidEnquiries:      totalEnquiries,
    totalBookedJobs:         totalCompleted,
    totalNotInterested:      totalNotInt,
    totalOpen,
    totalTerminal,
    accountCloseRate,
    accountCostPerEnquiry,
    accountCostPerBookedJob,
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

  const charts = buildCharts(campaigns, enquiries);

  emit(`Account close rate: ${charts.accountTotals.accountCloseRate ?? '—'}% · Cost per booked job: $${charts.accountTotals.accountCostPerBookedJob ?? '—'}`);

  const agentPayload = {
    period:            `${startDate} to ${endDate}`,
    accountTotals:     charts.accountTotals,
    adsCampaigns:      charts.adsCampaigns,
    crmByUtmCampaign:  charts.crmByUtmCampaign,
    notes: [
      'accountCostPerBookedJob = total Ads spend / total CRM booked jobs (paid traffic, utm_medium=cpc). This is the headline metric.',
      'accountAdsCpa = total Ads spend / Google Ads-reported conversions (form fills / calls). This is what Google Ads shows.',
      'closeRate = completed / (completed + notInterested + cancelled). Open leads excluded — understated for periods under 60 days.',
      'The CRM and Ads sides cannot be joined per-campaign because utm_campaign values in tracking templates may differ from Ads campaign names. Both sides are shown independently.',
      'If totalOpen is high relative to totalEnquiries, close rate will improve as those leads resolve.',
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
