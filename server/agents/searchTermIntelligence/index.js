'use strict';

/**
 * Search Term Intelligence — pre-fetch architecture.
 *
 * Cross-references Google Ads search terms with WordPress CRM lead outcomes
 * and GA4 landing page bounce data to surface:
 *   1. Most popular search terms by click volume
 *   2. Terms driving high-bounce traffic (GA4 paid bounced sessions)
 *   3. Terms producing not_interested leads (CRM enquiry_status / reason_not_interested)
 *
 * Matching logic (Node.js, before Claude runs):
 *   - CRM records are matched to Ads terms via the search_term field (actual query,
 *     populated via GCLID lookup) with utm_term as fallback (bidded keyword).
 *   - Landing pages from matched CRM records (path extracted from full URL) are
 *     looked up in GA4 paid bounce data to compute a weighted average bounce rate.
 *
 * Pre-fetch fetches all three sources in parallel, aggregates in Node.js,
 * and passes a single structured payload to Claude — no tools, no loop.
 */

const { agentOrchestrator }  = require('../../platform/AgentOrchestrator');
const AgentConfigService     = require('../../platform/AgentConfigService');
const {
  getAdsServer,
  getAnalyticsServer,
  getWordPressServer,
  callMcpTool,
} = require('../../platform/mcpTools');
const { buildSystemPrompt }  = require('./prompt');
const { TOOL_SLUG }          = require('./tools');

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeTerm(s) {
  if (!s) return null;
  return s.toLowerCase().trim();
}

function extractPath(url) {
  if (!url) return null;
  try { return new URL(url).pathname; }
  catch { return url.startsWith('/') ? url : null; }
}

function topN(obj, n) {
  return Object.entries(obj)
    .sort(function(a, b) { return b[1] - a[1]; })
    .slice(0, n)
    .reduce(function(acc, entry) { acc[entry[0]] = entry[1]; return acc; }, {});
}

// ── Agent run ─────────────────────────────────────────────────────────────────

async function runSearchTermIntelligence(context) {
  const { orgId, req, emit } = context;

  const adminConfig = await AgentConfigService.getAdminConfig(TOOL_SLUG);
  const agentConfig = await AgentConfigService.getAgentConfig(orgId, TOOL_SLUG);

  let startDate = (req && req.body && req.body.startDate) ? req.body.startDate : null;
  let endDate   = (req && req.body && req.body.endDate)   ? req.body.endDate   : null;

  if (!startDate || !endDate) {
    var days  = (req && req.body && req.body.days) ? req.body.days : 30;
    var end   = new Date();
    var start = new Date();
    start.setDate(start.getDate() - days);
    startDate = start.toISOString().slice(0, 10);
    endDate   = end.toISOString().slice(0, 10);
  }

  var rangeArgs  = { start_date: startDate, end_date: endDate };
  var customerId = (req && req.body && req.body.customerId) ? req.body.customerId : null;

  // ── Pre-fetch all three sources in parallel ───────────────────────────────

  emit('Fetching search terms, bounce data, and CRM leads...');

  var adsServerP = getAdsServer(orgId).catch(function() { return null; });
  var gaServerP  = getAnalyticsServer(orgId).catch(function() { return null; });
  var wpServerP  = getWordPressServer(orgId).catch(function() { return null; });

  var servers = await Promise.all([adsServerP, gaServerP, wpServerP]);
  var adsServer = servers[0];
  var gaServer  = servers[1];
  var wpServer  = servers[2];

  function notConfigured(source) {
    return { error: source + ' MCP server is not configured for this organisation.' };
  }

  var fetches = await Promise.all([
    adsServer
      ? callMcpTool(orgId, adsServer, 'ads_get_search_terms', Object.assign({}, rangeArgs, { customer_id: customerId }))
          .catch(function(e) { return { error: e.message }; })
      : Promise.resolve(notConfigured('Google Ads')),

    gaServer
      ? callMcpTool(orgId, gaServer, 'ga4_get_paid_bounced_sessions', rangeArgs)
          .catch(function(e) { return { error: e.message }; })
      : Promise.resolve(notConfigured('Google Analytics')),

    wpServer
      ? callMcpTool(orgId, wpServer, 'wp_get_enquiries', {
          limit:      2000,
          start_date: startDate,
          end_date:   endDate,
        }).catch(function(e) { return { error: e.message }; })
      : Promise.resolve(notConfigured('WordPress')),
  ]);

  var adsSearchTerms    = fetches[0];
  var ga4BouncedSessions = fetches[1];
  var crmEnquiries      = fetches[2];

  // Progress diagnostics
  if (adsSearchTerms && adsSearchTerms.error) {
    emit('Ads search terms: ' + adsSearchTerms.error);
  } else if (Array.isArray(adsSearchTerms)) {
    emit('Fetched ' + adsSearchTerms.length + ' search terms from Google Ads');
  }

  if (ga4BouncedSessions && ga4BouncedSessions.error) {
    emit('GA4 bounce data: ' + ga4BouncedSessions.error);
  } else if (Array.isArray(ga4BouncedSessions)) {
    emit('Fetched GA4 bounce data for ' + ga4BouncedSessions.length + ' landing page/device combinations');
  }

  if (crmEnquiries && crmEnquiries.error) {
    emit('CRM enquiries: ' + crmEnquiries.error);
  } else if (Array.isArray(crmEnquiries)) {
    emit('Fetched ' + crmEnquiries.length + ' CRM leads');
  }

  // ── Aggregate ────────────────────────────────────────────────────────────

  emit('Cross-referencing search terms with CRM and bounce data...');

  // GA4 bounce lookup: path → { sessions, totalBounceSessions, bounceRate }
  var ga4ByPath = {};
  if (Array.isArray(ga4BouncedSessions)) {
    for (var i = 0; i < ga4BouncedSessions.length; i++) {
      var row  = ga4BouncedSessions[i];
      var path = row.landingPage || '/';
      if (!ga4ByPath[path]) ga4ByPath[path] = { sessions: 0, totalBounceSessions: 0, bounceRate: 0 };
      ga4ByPath[path].sessions            += row.sessions;
      ga4ByPath[path].totalBounceSessions += Math.round(row.sessions * (row.bounceRate || 0));
    }
    // Compute weighted average bounce rate per path
    var pathKeys = Object.keys(ga4ByPath);
    for (var j = 0; j < pathKeys.length; j++) {
      var d = ga4ByPath[pathKeys[j]];
      d.bounceRate = d.sessions > 0 ? d.totalBounceSessions / d.sessions : 0;
    }
  }

  // CRM index: normalizedTerm → [records], indexed by both search_term and utm_term
  var crmBySearchTerm = {};
  var crmByUtmTerm    = {};

  if (Array.isArray(crmEnquiries)) {
    for (var k = 0; k < crmEnquiries.length; k++) {
      var rec = crmEnquiries[k];
      var st  = normalizeTerm(rec.search_term);
      if (st) {
        if (!crmBySearchTerm[st]) crmBySearchTerm[st] = [];
        crmBySearchTerm[st].push(rec);
      }
      var ut = normalizeTerm(rec.utm_term);
      if (ut) {
        if (!crmByUtmTerm[ut]) crmByUtmTerm[ut] = [];
        crmByUtmTerm[ut].push(rec);
      }
    }
  }

  // Enrich each Ads search term with CRM and GA4 context
  var adsTermsArray = Array.isArray(adsSearchTerms) ? adsSearchTerms : [];

  var searchTermAnalysis = adsTermsArray.map(function(adsTerm) {
    var norm = normalizeTerm(adsTerm.term);
    // Prefer search_term match (actual query); fall back to utm_term (bidded keyword)
    var crmRecords = crmBySearchTerm[norm] || crmByUtmTerm[norm] || [];

    // Collect distinct landing page paths from CRM records for this term
    var seenPaths = {};
    var landingPagePaths = [];
    for (var m = 0; m < crmRecords.length; m++) {
      var p = extractPath(crmRecords[m].landing_page);
      if (p && !seenPaths[p]) { seenPaths[p] = true; landingPagePaths.push(p); }
      if (landingPagePaths.length >= 5) break;
    }

    // Compute weighted GA4 bounce rate across associated landing pages
    var totalSessions       = 0;
    var totalBounceSessions = 0;
    for (var n = 0; n < landingPagePaths.length; n++) {
      var ga4 = ga4ByPath[landingPagePaths[n]];
      if (ga4) {
        totalSessions       += ga4.sessions;
        totalBounceSessions += ga4.totalBounceSessions;
      }
    }
    var ga4BounceRate = totalSessions > 0
      ? Math.round((totalBounceSessions / totalSessions) * 1000) / 10
      : null;

    // Not-interested stats
    var notInterestedRecs = crmRecords.filter(function(r) {
      return r.enquiry_status === 'not_interested' || (r.reason_not_interested != null && r.reason_not_interested !== '');
    });
    var reasonCounts = {};
    for (var o = 0; o < notInterestedRecs.length; o++) {
      var reason = notInterestedRecs[o].reason_not_interested;
      if (reason) reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    }

    return {
      term:                 adsTerm.term,
      status:               adsTerm.status,
      clicks:               adsTerm.clicks,
      impressions:          adsTerm.impressions,
      costAud:              Math.round((adsTerm.cost || 0) * 100) / 100,
      conversions:          adsTerm.conversions,
      ctr:                  Math.round((adsTerm.ctr || 0) * 10000) / 100,
      crmLeads:             crmRecords.length,
      notInterested:        notInterestedRecs.length,
      notInterestedPct:     crmRecords.length > 0
        ? Math.round((notInterestedRecs.length / crmRecords.length) * 100)
        : null,
      notInterestedReasons: Object.keys(reasonCounts).length ? topN(reasonCounts, 5) : null,
      topLandingPages:      landingPagePaths,
      ga4BounceRatePct:     ga4BounceRate,
      ga4Sessions:          totalSessions > 0 ? totalSessions : null,
    };
  });

  // CRM-only not-interested: terms in CRM that produced not-interested leads
  // but are NOT in the Ads top 50 (e.g. longer-tail, organic, unmeasured)
  var adsTermNorms = {};
  for (var q = 0; q < adsTermsArray.length; q++) {
    var nt = normalizeTerm(adsTermsArray[q].term);
    if (nt) adsTermNorms[nt] = true;
  }

  var crmOnlyByTerm = {};
  if (Array.isArray(crmEnquiries)) {
    for (var r2 = 0; r2 < crmEnquiries.length; r2++) {
      var rec2 = crmEnquiries[r2];
      var isNi = rec2.enquiry_status === 'not_interested' ||
                 (rec2.reason_not_interested != null && rec2.reason_not_interested !== '');
      if (!isNi) continue;
      var termKey = normalizeTerm(rec2.search_term) || normalizeTerm(rec2.utm_term);
      if (!termKey || adsTermNorms[termKey]) continue;
      if (!crmOnlyByTerm[termKey]) crmOnlyByTerm[termKey] = { term: termKey, count: 0 };
      crmOnlyByTerm[termKey].count++;
    }
  }
  var crmOnlyNotInterestedTerms = Object.values(crmOnlyByTerm)
    .sort(function(a, b) { return b.count - a.count; })
    .slice(0, 20);

  // Summary stats
  var totalLeads         = Array.isArray(crmEnquiries) ? crmEnquiries.length : 0;
  var totalNotInterested = Array.isArray(crmEnquiries)
    ? crmEnquiries.filter(function(r3) {
        return r3.enquiry_status === 'not_interested' ||
               (r3.reason_not_interested != null && r3.reason_not_interested !== '');
      }).length
    : 0;
  var matchedLeads = searchTermAnalysis.reduce(function(s, t) { return s + t.crmLeads; }, 0);

  // ── Build payload and call Claude ─────────────────────────────────────────

  emit('Generating search term intelligence report...');

  var payload = {
    period: startDate + ' to ' + endDate,
    summary: {
      totalAdsSearchTerms:  adsTermsArray.length,
      totalCrmLeads:        totalLeads,
      totalNotInterested:   totalNotInterested,
      matchedLeads:         matchedLeads,
    },
    searchTermAnalysis:           searchTermAnalysis,
    crmOnlyNotInterestedTerms:    crmOnlyNotInterestedTerms,
    ga4LandingPageBounce:         ga4ByPath,
  };

  var userMessage =
    'Produce the Search Term Intelligence report for the period ' + startDate + ' to ' + endDate + '. ' +
    'All data has been pre-fetched and cross-referenced. ' +
    'Identify the most costly bouncing and not-interested search terms, and provide actionable recommendations.\n\n' +
    '```json\n' + JSON.stringify(payload, null, 2) + '\n```';

  var run = await agentOrchestrator.run({
    systemPrompt:  buildSystemPrompt(agentConfig),
    userMessage:   userMessage,
    tools:         [],
    maxIterations: 1,
    model:         adminConfig.model          ?? 'claude-sonnet-4-6',
    maxTokens:     adminConfig.max_tokens     ?? 6144,
    fallbackModel: adminConfig.fallback_model ?? null,
    onStep:        emit,
    context:       Object.assign({}, context, { startDate: startDate, endDate: endDate, toolSlug: TOOL_SLUG }),
  });

  return { result: run.result, trace: run.trace, tokensUsed: run.tokensUsed };
}

module.exports = { runSearchTermIntelligence };
