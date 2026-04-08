'use strict';

/**
 * DiamondPlate Data — CRM lead intelligence agent.
 *
 * Pre-fetch architecture: four sources fetched in parallel in Node.js,
 * passed to Claude in a single call. No ReAct loop — data requirements are fixed.
 *
 * Sources:
 *   1. WordPress CRM enquiries (filtered by date range)
 *   2. WordPress not-interested reasons (full history)
 *   3. GA4 traffic sources (sessions by channel for the period)
 *   4. GA4 landing page performance (top pages by sessions)
 */

const { agentOrchestrator } = require('../../platform/AgentOrchestrator');
const AgentConfigService    = require('../../platform/AgentConfigService');
const { getAdsServer, getAnalyticsServer, getWordPressServer, callMcpTool } = require('../../platform/mcpTools');
const { buildSystemPrompt } = require('./prompt');
const { TOOL_SLUG }         = require('./tools');

// ── Aggregation helpers ───────────────────────────────────────────────────────

function countBy(arr, key) {
  const out = {};
  for (const item of arr) {
    const val = (item[key] != null && String(item[key]).trim() !== '') ? String(item[key]).trim() : '(none)';
    out[val] = (out[val] || 0) + 1;
  }
  return out;
}

function topN(counts, n) {
  return Object.entries(counts)
    .sort(function(a, b) { return b[1] - a[1]; })
    .slice(0, n)
    .reduce(function(acc, entry) { acc[entry[0]] = entry[1]; return acc; }, {});
}

function extractQsParam(url, param) {
  if (!url) return null;
  try {
    return new URL(url).searchParams.get(param) || null;
  } catch { return null; }
}

function aggregateEnquiries(raw, startDate, endDate) {
  if (!raw || !Array.isArray(raw)) return raw;

  // Backfill utm_ad_group from the landing_page query string when the CRM field is empty
  // (handler bug — utm_ad_group not always saved to its own meta key yet)
  const rows = raw.map(function(r) {
    if (r.utm_ad_group) return r;
    const adGroup = extractQsParam(r.landing_page, 'utm_ad_group');
    return adGroup ? Object.assign({}, r, { utm_ad_group: adGroup }) : r;
  });

  return {
    total:           rows.length,
    period:          startDate + ' to ' + endDate,
    byStatus:        countBy(rows, 'enquiry_status'),
    byDevice:        countBy(rows, 'device_type'),
    bySource:        topN(countBy(rows, 'utm_source'),    10),
    byMedium:        topN(countBy(rows, 'utm_medium'),    10),
    byCampaign:      topN(countBy(rows, 'utm_campaign'),  10),
    byAdGroup:       topN(countBy(rows, 'utm_ad_group'),  10),
    topUtmTerms:     topN(countBy(rows, 'utm_term'),      20),
    topSearchTerms:  topN(countBy(rows, 'search_term'),   20),
    topLandingPages: topN(countBy(rows, 'landing_page'),  15),
  };
}

function aggregateNotInterested(raw, startDate, endDate) {
  if (!raw || !Array.isArray(raw)) return raw;

  return {
    total:    raw.length,
    period:   startDate + ' to ' + endDate,
    byReason: topN(countBy(raw, 'reason_not_interested'), 20),
  };
}

// ── Agent run ─────────────────────────────────────────────────────────────────

async function runDiamondplateData(context) {
  const { orgId, req, emit } = context;

  const config = Object.keys(context.config || {}).length > 0
    ? context.config
    : await AgentConfigService.getAgentConfig(orgId, TOOL_SLUG);

  const adminConfig = Object.keys(context.adminConfig || {}).length > 0
    ? context.adminConfig
    : await AgentConfigService.getAdminConfig(TOOL_SLUG);

  let startDate = (req && req.body && req.body.startDate) ? req.body.startDate : null;
  let endDate   = (req && req.body && req.body.endDate)   ? req.body.endDate   : null;

  if (!startDate || !endDate) {
    const days  = (req && req.body && req.body.days) ? req.body.days : 30;
    const end   = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    startDate = start.toISOString().slice(0, 10);
    endDate   = end.toISOString().slice(0, 10);
  }

  const rangeArgs = { start_date: startDate, end_date: endDate };

  // ── Pre-fetch all four sources in parallel ────────────────────────────────

  emit('Fetching CRM and analytics data...');

  const gaServer  = await getAnalyticsServer(orgId).catch(function() { return null; });
  const wpServer  = await getWordPressServer(orgId).catch(function() { return null; });
  const adsServer = await getAdsServer(orgId).catch(function() { return null; });

  function notConfigured(source) {
    return { error: source + ' MCP server is not configured for this organisation.' };
  }

  const results = await Promise.all([
    wpServer
      ? callMcpTool(orgId, wpServer, 'wp_get_enquiries', {
          limit:      2000,
          start_date: startDate,
          end_date:   endDate,
        }).catch(function(e) { return { error: e.message }; })
      : Promise.resolve(notConfigured('WordPress')),

    wpServer
      ? callMcpTool(orgId, wpServer, 'wp_get_not_interested_reasons', {})
          .catch(function(e) { return { error: e.message }; })
      : Promise.resolve(notConfigured('WordPress')),

    gaServer
      ? callMcpTool(orgId, gaServer, 'ga4_get_traffic_sources', rangeArgs)
          .catch(function(e) { return { error: e.message }; })
      : Promise.resolve(notConfigured('Google Analytics')),

    gaServer
      ? callMcpTool(orgId, gaServer, 'ga4_get_landing_page_performance', rangeArgs)
          .catch(function(e) { return { error: e.message }; })
      : Promise.resolve(notConfigured('Google Analytics')),

    adsServer
      ? callMcpTool(orgId, adsServer, 'ads_get_change_history', (function() {
          // Google Ads change history API hard limit: 30 days. Cap start_date if range is longer.
          var thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
          var cappedStart = rangeArgs.start_date > thirtyDaysAgo.toISOString().slice(0, 10)
            ? rangeArgs.start_date
            : thirtyDaysAgo.toISOString().slice(0, 10);
          return { start_date: cappedStart, end_date: rangeArgs.end_date };
        })())
          .catch(function(e) { return { error: e.message }; })
      : Promise.resolve(notConfigured('Google Ads')),
  ]);

  const rawEnquiries      = results[0];
  const rawNotInterested  = results[1];
  const trafficSources    = results[2];
  const landingPages      = results[3];
  const changeHistory     = results[4];

  // Emit diagnostic progress so errors are visible in the UI
  if (rawEnquiries && rawEnquiries.error) {
    emit('WordPress enquiries: ' + rawEnquiries.error);
  } else if (Array.isArray(rawEnquiries)) {
    emit('Fetched ' + rawEnquiries.length + ' CRM enquiries');
  }

  if (rawNotInterested && rawNotInterested.error) {
    emit('Not-interested reasons: ' + rawNotInterested.error);
  } else if (Array.isArray(rawNotInterested)) {
    emit('Fetched ' + rawNotInterested.length + ' not-interested records');
  }

  if (trafficSources && trafficSources.error) {
    emit('GA4 traffic: ' + trafficSources.error);
  }

  if (landingPages && landingPages.error) {
    emit('GA4 landing pages: ' + landingPages.error);
  }

  if (changeHistory && changeHistory.error) {
    emit('Ads change history: ' + changeHistory.error);
  } else if (Array.isArray(changeHistory)) {
    emit('Fetched ' + changeHistory.length + ' campaign change events');
  }

  // ── Aggregate before passing to Claude ───────────────────────────────────

  emit('Aggregating lead data...');

  const enquirySummary     = aggregateEnquiries(rawEnquiries, startDate, endDate);
  const notInterestedSummary = aggregateNotInterested(rawNotInterested, startDate, endDate);

  // ── Single Claude call ────────────────────────────────────────────────────

  emit('Analysing lead intelligence...');

  const payload = {
    period:              startDate + ' to ' + endDate,
    enquirySummary:      enquirySummary,
    notInterestedReasons:notInterestedSummary,
    ga4TrafficSources:   trafficSources,
    ga4LandingPages:     landingPages,
    campaignChangeHistory: changeHistory,
  };

  const userMessage =
    'Produce the DiamondPlate Data lead intelligence report for the period ' + startDate + ' to ' + endDate + '. ' +
    'All data has been pre-fetched below. Focus on the CRM enquiry data as the primary source of truth. ' +
    'GA4 data provides supporting context for traffic volume and landing page behaviour.\n\n' +
    '```json\n' + JSON.stringify(payload, null, 2) + '\n```';

  const run = await agentOrchestrator.run({
    systemPrompt:  buildSystemPrompt(config),
    userMessage:   userMessage,
    tools:         [],
    maxIterations: 1,
    model:         (adminConfig.model)      || 'claude-sonnet-4-6',
    maxTokens:     (adminConfig.max_tokens) || 6144,
    fallbackModel: (adminConfig.fallback_model) || null,
    onStep:        emit,
    context:       Object.assign({}, context, { startDate: startDate, endDate: endDate, toolSlug: TOOL_SLUG }),
  });

  return { result: run.result, trace: run.trace, tokensUsed: run.tokensUsed };
}

module.exports = { runDiamondplateData };
