'use strict';

/**
 * Lead Velocity — follow-up intensity and conversion speed agent.
 *
 * Pre-fetch architecture: extended enquiry data + progress_details repeater
 * fetched in parallel, metrics computed in Node.js, Claude called once.
 *
 * Returns { result: { summary, data: { charts, metrics } }, trace, tokensUsed }
 * The client reads result.data.charts for visualisations and result.summary for narrative.
 */

const { agentOrchestrator } = require('../../platform/AgentOrchestrator');
const AgentConfigService    = require('../../platform/AgentConfigService');
const { getWordPressServer, callMcpTool } = require('../../platform/mcpTools');
const { buildSystemPrompt } = require('./prompt');
const { TOOL_SLUG }         = require('./tools');

// ── Date parsing ──────────────────────────────────────────────────────────────

/**
 * Parse ACF date_time_picker value stored as "d/m/Y g:i a"
 * e.g. "08/04/2026 9:30 am"
 */
function parseAcfDatetime(str) {
  if (!str || typeof str !== 'string') return null;
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (!m) return null;
  const [, day, mon, yr, hr, min, ampm] = m;
  let h = parseInt(hr, 10);
  if (ampm.toLowerCase() === 'pm' && h !== 12) h += 12;
  if (ampm.toLowerCase() === 'am' && h === 12) h = 0;
  return new Date(parseInt(yr, 10), parseInt(mon, 10) - 1, parseInt(day, 10), h, parseInt(min, 10));
}

/**
 * Parse ACF date_picker value — handles Ymd (20260408), d/m/Y (08/04/2026),
 * or MySQL date string (2026-04-08).
 */
function parseAcfDate(str) {
  if (!str || typeof str !== 'string') return null;
  if (/^\d{8}$/.test(str)) {
    return new Date(parseInt(str.slice(0, 4), 10), parseInt(str.slice(4, 6), 10) - 1, parseInt(str.slice(6, 8), 10));
  }
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
    const [d, mo, y] = str.split('/');
    return new Date(parseInt(y, 10), parseInt(mo, 10) - 1, parseInt(d, 10));
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function daysBetween(a, b) {
  if (!(a instanceof Date) || !(b instanceof Date)) return null;
  const ms = b.getTime() - a.getTime();
  const days = Math.round(ms / (1000 * 60 * 60 * 24));
  return days < 0 ? 0 : days; // clamp negatives from data-entry errors
}

function responseBucket(days) {
  if (days === null || days === undefined) return 'No response';
  if (days === 0) return 'Same day';
  if (days === 1) return 'Next day';
  if (days <= 3)  return '2–3 days';
  if (days <= 7)  return '4–7 days';
  return '7+ days';
}

// ── Aggregation helpers ───────────────────────────────────────────────────────

function avg(arr) {
  const valid = arr.filter((v) => v !== null && !isNaN(v));
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
}

function round1(n) {
  return n !== null && n !== undefined && !isNaN(n) ? Math.round(n * 10) / 10 : null;
}

function countByKey(arr, key) {
  const out = {};
  for (const item of arr) {
    const val = item[key] != null && String(item[key]).trim() ? String(item[key]).trim() : '(none)';
    out[val] = (out[val] || 0) + 1;
  }
  return out;
}

// ── Core metrics computation ──────────────────────────────────────────────────

const TERMINAL_STATUSES = new Set(['completed', 'notinterested', 'cancelled', 'assigned']);
const WON_STATUSES      = new Set(['completed', 'assigned']);
const OPEN_STATUSES     = new Set(['new', 'contacted', 'emailed']);

const DAYS_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function computeAllMetrics(enquiries, progressMap) {
  const today = new Date();

  // Heatmap accumulator: day (0-6) x hour (0-23)
  const heatmapAcc = {};
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) heatmapAcc[`${d}-${h}`] = 0;
  }

  const metrics = enquiries.map((enq) => {
    const enquiryDate    = new Date(enq.date);
    const progressData   = progressMap.get(String(enq.id)) || { row_count: 0, rows: [] };
    const touchpointCount = progressData.row_count;

    // Parse and sort rows by entry_date
    const sortedRows = (progressData.rows || [])
      .map((r) => ({ ...r, _dt: parseAcfDatetime(r.entry_date) }))
      .filter((r) => r._dt)
      .sort((a, b) => a._dt - b._dt);

    // Accumulate heatmap counts
    for (const r of sortedRows) {
      const key = `${r._dt.getDay()}-${r._dt.getHours()}`;
      if (heatmapAcc[key] !== undefined) heatmapAcc[key]++;
    }

    const firstEntry = sortedRows[0];
    const lastEntry  = sortedRows[sortedRows.length - 1];

    const daysToFirstResponse = firstEntry ? daysBetween(enquiryDate, firstEntry._dt) : null;

    // Days to close: prefer completion_date, fall back to last activity row
    let daysToClose = null;
    if (enq.completion_date) {
      const cd = parseAcfDate(enq.completion_date);
      if (cd) daysToClose = daysBetween(enquiryDate, cd);
    }
    if (daysToClose === null && lastEntry) {
      daysToClose = daysBetween(enquiryDate, lastEntry._dt);
    }

    const isTerminal  = TERMINAL_STATUSES.has(enq.enquiry_status);
    const isWon       = WON_STATUSES.has(enq.enquiry_status);
    const isOpen      = OPEN_STATUSES.has(enq.enquiry_status) || (!isTerminal && !enq.enquiry_status);

    const daysSinceLast = lastEntry
      ? daysBetween(lastEntry._dt, today)
      : daysBetween(enquiryDate, today);

    const isStale = isOpen && daysSinceLast > 7;

    return {
      id:                  enq.id,
      date:                enq.date,
      enquiry_status:      enq.enquiry_status,
      utm_campaign:        enq.utm_campaign,
      utm_source:          enq.utm_source,
      utm_medium:          enq.utm_medium,
      device_type:         enq.device_type,
      sales_rep:           enq.sales_rep,
      package_type:        enq.package_type,
      enquiry_source:      enq.enquiry_source,
      final_value:         enq.final_value,
      touchpoints:         touchpointCount,
      daysToFirstResponse,
      daysToClose,
      isWon,
      isTerminal,
      isOpen,
      isStale,
      daysSinceLast,
      actionTypes:         sortedRows.map((r) => r.next_action).filter(Boolean),
    };
  });

  return { metrics, heatmapAcc };
}

// ── Chart dataset builders ────────────────────────────────────────────────────

function buildCharts(metrics, heatmapAcc) {
  const total = metrics.length;
  const won   = metrics.filter((m) => m.isWon).length;

  // 1. Status funnel
  const STATUS_ORDER = ['new', 'contacted', 'emailed', 'assigned', 'completed', 'notinterested', 'cancelled'];
  const STATUS_LABELS = {
    new: 'New', contacted: 'Contacted', emailed: 'Emailed',
    assigned: 'Invoiced', completed: 'Completed', notinterested: 'Not Interested', cancelled: 'Cancelled',
  };
  const statusCounts = countByKey(metrics, 'enquiry_status');
  const statusFunnel = STATUS_ORDER.map((k) => ({
    status: k, label: STATUS_LABELS[k] || k, value: statusCounts[k] || 0,
  })).filter((s) => s.value > 0);

  // 2. Touchpoint distribution
  const tpOrder = ['0', '1', '2', '3', '4', '5+'];
  const tpBuckets = Object.fromEntries(tpOrder.map((k) => [k, 0]));
  for (const m of metrics) {
    const k = m.touchpoints >= 5 ? '5+' : String(m.touchpoints);
    tpBuckets[k]++;
  }
  const touchpointDistribution = tpOrder.map((name) => ({ name, value: tpBuckets[name] }));

  // 3. Response time buckets
  const rtOrder = ['Same day', 'Next day', '2–3 days', '4–7 days', '7+ days', 'No response'];
  const rtBuckets = Object.fromEntries(rtOrder.map((k) => [k, 0]));
  for (const m of metrics) {
    rtBuckets[responseBucket(m.daysToFirstResponse)]++;
  }
  const responseTimeBuckets = rtOrder.map((name) => ({ name, value: rtBuckets[name] }));

  // 4. Velocity by campaign (top 10 by volume)
  const byCampaign = {};
  for (const m of metrics) {
    const k = m.utm_campaign || '(no campaign)';
    if (!byCampaign[k]) byCampaign[k] = { campaign: k, daysToClose: [], touchpoints: [], daysToFirst: [], won: 0, total: 0 };
    byCampaign[k].total++;
    byCampaign[k].touchpoints.push(m.touchpoints);
    if (m.daysToClose !== null)        byCampaign[k].daysToClose.push(m.daysToClose);
    if (m.daysToFirstResponse !== null) byCampaign[k].daysToFirst.push(m.daysToFirstResponse);
    if (m.isWon) byCampaign[k].won++;
  }
  const velocityByCampaign = Object.values(byCampaign)
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)
    .map((c) => ({
      campaign:           c.campaign,
      total:              c.total,
      avgDaysToClose:     round1(avg(c.daysToClose)),
      avgTouchpoints:     round1(avg(c.touchpoints)),
      avgDaysToFirstResp: round1(avg(c.daysToFirst)),
      conversionRate:     round1((c.won / c.total) * 100),
    }));

  // 5. Action type mix
  const actionCounts = {};
  for (const m of metrics) {
    for (const a of m.actionTypes) {
      actionCounts[a] = (actionCounts[a] || 0) + 1;
    }
  }
  const actionMix = Object.entries(actionCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value }));

  // 6. Activity heatmap
  const heatmapData = DAYS_LABELS.flatMap((day, di) =>
    Array.from({ length: 24 }, (_, h) => ({
      day, hour: h, count: heatmapAcc[`${di}-${h}`] || 0,
    }))
  );

  // 7. Scatter: touchpoints vs days-to-close (won leads only, for meaningful correlation)
  const scatterData = metrics
    .filter((m) => m.isWon && m.daysToClose !== null)
    .map((m) => ({
      x:        m.touchpoints,
      y:        m.daysToClose,
      campaign: m.utm_campaign || '(none)',
    }));

  // 8. Stale leads (open, last contact > 7 days ago) — top 20 by age
  const staleLeads = metrics
    .filter((m) => m.isStale)
    .sort((a, b) => b.daysSinceLast - a.daysSinceLast)
    .slice(0, 20)
    .map((m) => ({
      id:             m.id,
      date:           m.date,
      status:         m.enquiry_status,
      campaign:       m.utm_campaign,
      daysSinceLast:  m.daysSinceLast,
      touchpoints:    m.touchpoints,
      final_value:    m.final_value,
    }));

  // 9. Velocity by enquiry source
  const bySource = {};
  for (const m of metrics) {
    const k = m.enquiry_source || m.utm_source || '(unknown)';
    if (!bySource[k]) bySource[k] = { source: k, daysToClose: [], touchpoints: [], won: 0, total: 0 };
    bySource[k].total++;
    bySource[k].touchpoints.push(m.touchpoints);
    if (m.daysToClose !== null) bySource[k].daysToClose.push(m.daysToClose);
    if (m.isWon) bySource[k].won++;
  }
  const velocityBySource = Object.values(bySource)
    .sort((a, b) => b.total - a.total)
    .map((s) => ({
      source:         s.source,
      total:          s.total,
      avgDaysToClose: round1(avg(s.daysToClose)),
      avgTouchpoints: round1(avg(s.touchpoints)),
      conversionRate: round1((s.won / s.total) * 100),
    }));

  return {
    statusFunnel,
    touchpointDistribution,
    responseTimeBuckets,
    velocityByCampaign,
    velocityBySource,
    actionMix,
    heatmapData,
    scatterData,
    staleLeads,
    summary_stats: {
      total,
      won,
      conversionRate:    round1((won / total) * 100),
      avgTouchpoints:    round1(avg(metrics.map((m) => m.touchpoints))),
      avgDaysToClose:    round1(avg(metrics.filter((m) => m.daysToClose !== null).map((m) => m.daysToClose))),
      avgFirstResponse:  round1(avg(metrics.filter((m) => m.daysToFirstResponse !== null).map((m) => m.daysToFirstResponse))),
      zeroFollowUp:      metrics.filter((m) => m.touchpoints === 0).length,
      staleCount:        metrics.filter((m) => m.isStale).length,
    },
  };
}

// ── Agent run ─────────────────────────────────────────────────────────────────

async function runLeadVelocity(context) {
  const { orgId, req, emit } = context;

  const config = Object.keys(context.config || {}).length > 0
    ? context.config
    : await AgentConfigService.getAgentConfig(orgId, TOOL_SLUG);

  const adminConfig = Object.keys(context.adminConfig || {}).length > 0
    ? context.adminConfig
    : await AgentConfigService.getAdminConfig(TOOL_SLUG);

  // Date range
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

  const rangeArgs = { start_date: startDate, end_date: endDate, limit: 2000 };

  emit('Connecting to WordPress CRM…');

  const wpServer = await getWordPressServer(orgId).catch(() => null);
  if (!wpServer) {
    throw new Error('WordPress MCP server is not configured for this organisation.');
  }

  // ── Pre-fetch both datasets in parallel ──────────────────────────────────
  emit('Fetching enquiry details and activity records…');

  const [rawEnquiries, rawProgress] = await Promise.all([
    callMcpTool(orgId, wpServer, 'wp_get_enquiry_details', rangeArgs)
      .catch((e) => { emit('Enquiry details error: ' + e.message); return []; }),
    callMcpTool(orgId, wpServer, 'wp_get_progress_details', rangeArgs)
      .catch((e) => { emit('Progress details error: ' + e.message); return []; }),
  ]);

  emit(`Fetched ${rawEnquiries.length} enquiries and ${rawProgress.length} activity logs`);

  if (!rawEnquiries.length) {
    throw new Error('No enquiries found in this date range. Check the date filter or WordPress connection.');
  }

  // ── Build progress lookup map: post_id → progress data ──────────────────
  const progressMap = new Map();
  for (const p of rawProgress) {
    progressMap.set(String(p.post_id), p);
  }

  // ── Compute metrics ──────────────────────────────────────────────────────
  emit('Computing velocity metrics…');

  const { metrics, heatmapAcc } = computeAllMetrics(rawEnquiries, progressMap);
  const charts                  = buildCharts(metrics, heatmapAcc);

  emit(`Metrics computed: ${metrics.length} leads, ${charts.summary_stats.won} conversions`);

  // ── Assemble compact summary for Claude (no raw records — only aggregates) ─
  const agentPayload = {
    period:            `${startDate} to ${endDate}`,
    summary_stats:     charts.summary_stats,
    statusFunnel:      charts.statusFunnel,
    touchpointDist:    charts.touchpointDistribution,
    responseTimeDist:  charts.responseTimeBuckets,
    velocityByCampaign: charts.velocityByCampaign,
    velocityBySource:  charts.velocityBySource,
    actionMix:         charts.actionMix,
    staleLeads:        charts.staleLeads.slice(0, 10),
  };

  const userMessage =
    `Produce the Lead Velocity and Follow-up Intensity report for ${startDate} to ${endDate}.\n` +
    `All metrics have been pre-computed below. Do not request additional data.\n\n` +
    '```json\n' + JSON.stringify(agentPayload, null, 2) + '\n```';

  emit('Analysing velocity patterns…');

  const run = await agentOrchestrator.run({
    systemPrompt:  buildSystemPrompt(config),
    userMessage,
    tools:         [],
    maxIterations: 1,
    model:         adminConfig.model       || 'claude-sonnet-4-6',
    maxTokens:     adminConfig.max_tokens  || 6144,
    fallbackModel: adminConfig.fallback_model || null,
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

module.exports = { runLeadVelocity };
