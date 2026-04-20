'use strict';

/**
 * Cost Per Booked Job — cross-references Google Ads campaign spend with CRM close rates
 * to reveal the true cost per booked job, vs what Google Ads reports as CPA.
 *
 * Pre-fetch architecture: fetches Ads campaign performance and CRM enquiry_details in
 * parallel, computes per-campaign close rates and true CPAs in Node.js, calls Claude once.
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

function buildCampaignTable(campaigns, enquiries) {
  // Group paid CRM enquiries by utm_campaign (case-insensitive)
  const crmMap = {};
  for (const enq of enquiries) {
    if (enq.utm_medium !== 'cpc') continue;
    const key = (enq.utm_campaign || '(no campaign)').toLowerCase().trim();
    if (!crmMap[key]) crmMap[key] = { enquiries: 0, completed: 0, notInterested: 0, open: 0 };
    crmMap[key].enquiries++;
    if (WON_STATUS.has(enq.enquiry_status))  crmMap[key].completed++;
    else if (LOST_STATUS.has(enq.enquiry_status)) crmMap[key].notInterested++;
    else                                      crmMap[key].open++;
  }

  const matchedKeys = new Set();

  const campaignTable = campaigns.map((c) => {
    const key = c.name.toLowerCase().trim();
    matchedKeys.add(key);
    const crm = crmMap[key] || { enquiries: 0, completed: 0, notInterested: 0, open: 0 };
    const terminal = crm.completed + crm.notInterested;
    const closeRate       = terminal >= 3 ? round1((crm.completed / terminal) * 100) : null;
    const costPerEnquiry  = crm.enquiries  > 0 ? round2(c.cost / crm.enquiries)  : null;
    const costPerBookedJob = crm.completed > 0 ? round2(c.cost / crm.completed)  : null;
    const adsCpa          = c.conversions  > 0 ? round2(c.cost / c.conversions)  : null;

    return {
      campaign:         c.name,
      adsSpend:         round2(c.cost),
      adsCpa,
      enquiries:        crm.enquiries,
      completed:        crm.completed,
      notInterested:    crm.notInterested,
      open:             crm.open,
      terminal,
      closeRate,
      costPerEnquiry,
      costPerBookedJob,
    };
  });

  // UTM campaigns in CRM that did not match any Ads campaign name
  const unmatchedCrmCampaigns = Object.entries(crmMap)
    .filter(([key]) => key !== '(no campaign)' && !matchedKeys.has(key))
    .map(([campaign, data]) => ({ campaign, ...data }));

  // Account-level totals (Ads spend)
  const totalSpend     = campaigns.reduce((s, c) => s + (c.cost || 0), 0);
  const totalAdsCpaNum = campaigns.reduce((s, c) => s + (c.conversions || 0), 0);

  // Account-level CRM totals (paid enquiries only)
  const allPaid = Object.values(crmMap);
  const totalEnquiries   = allPaid.reduce((s, r) => s + r.enquiries,    0);
  const totalCompleted   = allPaid.reduce((s, r) => s + r.completed,    0);
  const totalNotInt      = allPaid.reduce((s, r) => s + r.notInterested, 0);
  const totalTerminal    = totalCompleted + totalNotInt;
  const accountCloseRate = totalTerminal >= 3 ? round1((totalCompleted / totalTerminal) * 100) : null;
  const accountCostPerEnquiry   = totalEnquiries > 0 ? round2(totalSpend / totalEnquiries)  : null;
  const accountCostPerBookedJob = totalCompleted > 0 ? round2(totalSpend / totalCompleted)  : null;
  const accountAdsCpa           = totalAdsCpaNum > 0 ? round2(totalSpend / totalAdsCpaNum)  : null;

  const accountTotals = {
    totalSpend:           round2(totalSpend),
    totalEnquiries,
    totalCompleted,
    totalNotInterested:   totalNotInt,
    totalTerminal,
    accountCloseRate,
    accountCostPerEnquiry,
    accountCostPerBookedJob,
    accountAdsCpa,
  };

  return { campaignTable, unmatchedCrmCampaigns, accountTotals };
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

  emit(`Fetched ${campaigns.length} campaigns and ${enquiries.length} CRM enquiries — computing true CPAs…`);

  if (!campaigns.length) throw new Error('No campaign data returned from Google Ads. Check the date range and Ads connection.');

  const { campaignTable, unmatchedCrmCampaigns, accountTotals } = buildCampaignTable(campaigns, enquiries);

  emit(`Computed cost per booked job for ${campaignTable.length} campaigns`);

  const agentPayload = {
    period:                  `${startDate} to ${endDate}`,
    accountTotals,
    campaignTable,
    unmatchedCrmCampaigns,
    notes: [
      'Close rate = completed / (completed + notinterested + cancelled). Open leads excluded.',
      'For date ranges under 60 days, close rates are understated as open leads have not yet resolved.',
      'UTM campaign attribution relies on tracking templates in Google Ads. Unmatched campaigns indicate a tracking gap.',
      'cost_per_booked_job = adsSpend / completed (CRM booked jobs). adsCpa = adsSpend / Google Ads conversions (form fills / calls).',
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

  // Build chart dataset for frontend rendering
  const charts = {
    campaignTable,
    accountTotals,
    unmatchedCrmCampaigns,
  };

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
