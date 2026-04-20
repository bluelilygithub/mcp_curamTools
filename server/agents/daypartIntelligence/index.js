'use strict';

/**
 * Daypart Intelligence — enquiry timing and close rate by day-of-week and hour-of-day.
 *
 * Pre-fetch architecture: fetches CRM enquiry_details, computes all aggregates in Node.js,
 * passes compact stats to Claude once. Uses a minimum 90-day window regardless of UI
 * date selection to ensure statistically meaningful patterns.
 *
 * Returns { result: { summary, data: { charts, startDate, endDate } }, trace, tokensUsed }
 */

const { agentOrchestrator } = require('../../platform/AgentOrchestrator');
const AgentConfigService    = require('../../platform/AgentConfigService');
const { getWordPressServer, callMcpTool } = require('../../platform/mcpTools');
const { buildSystemPrompt } = require('./prompt');
const { TOOL_SLUG }         = require('./tools');

const DAYS       = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WON_STATUS = new Set(['completed', 'assigned']);
const LOST_STATUS = new Set(['notinterested', 'cancelled']);

function hourLabel(h) {
  if (h === 0)  return '12am';
  if (h < 12)   return `${h}am`;
  if (h === 12) return '12pm';
  return `${h - 12}pm`;
}

function round1(n) {
  return n !== null && !isNaN(n) ? Math.round(n * 10) / 10 : null;
}

function parseEnquiryDate(str) {
  if (!str || typeof str !== 'string') return null;
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  const [, yr, mo, dy, hr, mn] = m;
  if (+yr === 0) return null;
  const d = new Date(+yr, +mo - 1, +dy, +hr, +mn, 0);
  return isNaN(d.getTime()) ? null : d;
}

function buildCharts(enquiries) {
  const allDay   = {};
  const paidDay  = {};
  const allHour  = {};
  const paidHour = {};
  const allHeatmap  = {};
  const paidHeatmap = {};

  const closeAllDay   = {};
  const closePaidDay  = {};
  const closeAllHour  = {};
  const closePaidHour = {};

  // Initialise accumulators
  for (const d of DAYS) {
    allDay[d] = 0; paidDay[d] = 0;
    closeAllDay[d]  = { won: 0, total: 0 };
    closePaidDay[d] = { won: 0, total: 0 };
  }
  for (let h = 0; h < 24; h++) {
    allHour[h] = 0; paidHour[h] = 0;
    closeAllHour[h]  = { won: 0, total: 0 };
    closePaidHour[h] = { won: 0, total: 0 };
  }
  for (const d of DAYS) {
    for (let h = 0; h < 24; h++) {
      allHeatmap[`${d}-${h}`]  = 0;
      paidHeatmap[`${d}-${h}`] = 0;
    }
  }

  let totalEnquiries = 0;
  let totalPaid      = 0;
  let totalWon       = 0;
  let totalTerminal  = 0;

  for (const enq of enquiries) {
    const dt = parseEnquiryDate(enq.date);
    if (!dt) continue;

    const day    = DAYS[dt.getDay()];
    const hour   = dt.getHours();
    const isPaid = enq.utm_medium === 'cpc' || (enq.gclid && String(enq.gclid).trim() !== '');
    const isWon  = WON_STATUS.has(enq.enquiry_status);
    const isLost = LOST_STATUS.has(enq.enquiry_status);
    const isTerminal = isWon || isLost;

    totalEnquiries++;
    if (isPaid) totalPaid++;
    if (isTerminal) { totalTerminal++; if (isWon) totalWon++; }

    allDay[day]++;
    allHour[hour]++;
    allHeatmap[`${day}-${hour}`]++;

    if (isPaid) {
      paidDay[day]++;
      paidHour[hour]++;
      paidHeatmap[`${day}-${hour}`]++;
    }

    if (isTerminal) {
      closeAllDay[day].total++;
      closeAllHour[hour].total++;
      if (isWon) { closeAllDay[day].won++; closeAllHour[hour].won++; }

      if (isPaid) {
        closePaidDay[day].total++;
        closePaidHour[hour].total++;
        if (isWon) { closePaidDay[day].won++; closePaidHour[hour].won++; }
      }
    }
  }

  const toCloseRate = (obj) => obj.total >= 3 ? round1((obj.won / obj.total) * 100) : null;

  return {
    enquiryHeatmap: DAYS.flatMap((d) =>
      Array.from({ length: 24 }, (_, h) => ({ day: d, hour: h, count: allHeatmap[`${d}-${h}`] || 0 }))
    ),
    paidHeatmap: DAYS.flatMap((d) =>
      Array.from({ length: 24 }, (_, h) => ({ day: d, hour: h, count: paidHeatmap[`${d}-${h}`] || 0 }))
    ),
    enquiryByDay:     DAYS.map((d) => ({ name: d, value: allDay[d] })),
    paidByDay:        DAYS.map((d) => ({ name: d, value: paidDay[d] })),
    enquiryByHour:    Array.from({ length: 24 }, (_, h) => ({ name: hourLabel(h), hour: h, value: allHour[h] })),
    paidByHour:       Array.from({ length: 24 }, (_, h) => ({ name: hourLabel(h), hour: h, value: paidHour[h] })),
    closeRateByDay:   DAYS.map((d) => ({ name: d, rate: toCloseRate(closeAllDay[d]),  total: closeAllDay[d].total,  won: closeAllDay[d].won })),
    paidCloseRateByDay:  DAYS.map((d) => ({ name: d, rate: toCloseRate(closePaidDay[d]),  total: closePaidDay[d].total })),
    closeRateByHour:  Array.from({ length: 24 }, (_, h) => ({ name: hourLabel(h), hour: h, rate: toCloseRate(closeAllHour[h]),  total: closeAllHour[h].total })),
    paidCloseRateByHour: Array.from({ length: 24 }, (_, h) => ({ name: hourLabel(h), hour: h, rate: toCloseRate(closePaidHour[h]), total: closePaidHour[h].total })),
    summary_stats: {
      totalEnquiries,
      totalPaid,
      totalOrganic: totalEnquiries - totalPaid,
      totalWon,
      totalTerminal,
      overallCloseRate: totalTerminal > 0 ? round1((totalWon / totalTerminal) * 100) : null,
    },
  };
}

async function runDaypartIntelligence(context) {
  const { orgId, req, emit } = context;

  const config = Object.keys(context.config || {}).length > 0
    ? context.config
    : await AgentConfigService.getAgentConfig(orgId, TOOL_SLUG);

  const adminConfig = Object.keys(context.adminConfig || {}).length > 0
    ? context.adminConfig
    : await AgentConfigService.getAdminConfig(TOOL_SLUG);

  // Date range — enforce a minimum 90-day window for reliable patterns
  let endDate   = req?.body?.endDate   ?? null;
  let startDate = req?.body?.startDate ?? null;

  if (!endDate) endDate = new Date().toISOString().slice(0, 10);

  if (startDate) {
    const reqDays = Math.round((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24));
    if (reqDays < 90) {
      const d = new Date(endDate);
      d.setDate(d.getDate() - 90);
      startDate = d.toISOString().slice(0, 10);
    }
  } else {
    const d = new Date(endDate);
    d.setDate(d.getDate() - 90);
    startDate = d.toISOString().slice(0, 10);
  }

  emit('Connecting to WordPress CRM…');

  const wpServer = await getWordPressServer(orgId).catch(() => null);
  if (!wpServer) throw new Error('WordPress MCP server is not configured for this organisation.');

  emit(`Fetching enquiry data (${startDate} to ${endDate})…`);

  const enquiries = await callMcpTool(orgId, wpServer, 'wp_get_enquiry_details', {
    start_date: startDate,
    end_date:   endDate,
    limit:      3000,
  }).catch((e) => { emit('CRM error: ' + e.message); return []; });

  emit(`Fetched ${enquiries.length} enquiries — computing daypart patterns…`);

  if (!enquiries.length) {
    throw new Error('No enquiries found for this date range. Check the WordPress connection or extend the date range.');
  }

  const charts = buildCharts(enquiries);

  emit(`Patterns computed: ${charts.summary_stats.totalEnquiries} enquiries, ${charts.summary_stats.totalPaid} paid`);

  const monitorConfig     = await AgentConfigService.getAgentConfig(orgId, 'google-ads-monitor');
  const rawRate           = monitorConfig?.expected_close_rate;
  const expectedCloseRate = rawRate != null && !isNaN(parseFloat(rawRate)) ? parseFloat(rawRate) : null;

  const agentPayload = {
    period:             `${startDate} to ${endDate}`,
    expectedCloseRate:  expectedCloseRate !== null ? Math.round(expectedCloseRate * 1000) / 10 : null,
    summary_stats:      charts.summary_stats,
    enquiryByDay:       charts.enquiryByDay,
    paidByDay:          charts.paidByDay,
    enquiryByHour:      charts.enquiryByHour,
    paidByHour:         charts.paidByHour,
    closeRateByDay:     charts.closeRateByDay,
    paidCloseRateByDay: charts.paidCloseRateByDay,
    closeRateByHour:    charts.closeRateByHour,
    paidCloseRateByHour: charts.paidCloseRateByHour,
  };

  const userMessage =
    `Produce the Daypart Intelligence report for ${startDate} to ${endDate}.\n` +
    `All data has been pre-computed from the CRM below. Do not request additional data.\n\n` +
    '```json\n' + JSON.stringify(agentPayload, null, 2) + '\n```';

  emit('Analysing daypart patterns…');

  const run = await agentOrchestrator.run({
    systemPrompt:  buildSystemPrompt(config),
    userMessage,
    tools:         [],
    maxIterations: 1,
    model:         adminConfig.model          ?? 'claude-sonnet-4-6',
    maxTokens:     adminConfig.max_tokens     ?? 4096,
    fallbackModel: adminConfig.fallback_model ?? null,
    onStep:        emit,
    context:       { ...context, startDate, endDate, toolSlug: TOOL_SLUG },
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

module.exports = { runDaypartIntelligence };
