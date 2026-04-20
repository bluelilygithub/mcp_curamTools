'use strict';

/**
 * Not Interested Report — pre-fetch architecture.
 *
 * WHY PRE-FETCH: All data sources are fetched unconditionally every run.
 * The sequence is fixed: not-interested leads + progress notes + ads data.
 * A ReAct loop would add quadratic token cost for no benefit.
 *
 * Data flow:
 *  1. wp_get_not_interested_reasons  — all leads with reason + UTM attribution (all time)
 *  2. wp_get_progress_details         — recent progress notes; filtered in Node.js to not-interested IDs
 *  3. ads_get_search_terms            — recent search queries triggering ads
 *  4. ads_get_active_keywords         — all active keywords in account
 *  5. ads_get_campaign_performance    — campaign-level performance for context
 *
 * CRM privacy is applied pre-AI per platform convention.
 */

const { agentOrchestrator }  = require('../../platform/AgentOrchestrator');
const AgentConfigService     = require('../../platform/AgentConfigService');
const {
  getAdsServer,
  getWordPressServer,
  callMcpTool,
} = require('../../platform/mcpTools');
const { buildSystemPrompt }  = require('./prompt');
const { TOOL_SLUG }          = require('./tools');

// Focus categories — leads with these reasons are the primary subject of this report.
const FOCUS_REASONS = new Set(['wrong_product', 'wrong_location', 'wrong product', 'wrong location']);

function normaliseReason(raw) {
  if (!raw) return 'not_specified';
  return raw.trim().toLowerCase().replace(/\s+/g, '_');
}

function applyPrivacy(records, excludedFields) {
  if (!excludedFields || excludedFields.length === 0) return records;
  const excluded = new Set(excludedFields);
  return records.map((r) => {
    const clean = {};
    for (const [k, v] of Object.entries(r)) {
      if (!excluded.has(k)) clean[k] = v;
    }
    return clean;
  });
}

/**
 * Build the structured analysis payload that is passed to Claude.
 * Groups leads by normalised reason; attaches matching progress notes.
 * Returns both the grouped payload and summary counts for emit messages.
 */
function buildPayload({ notInterestedLeads, progressDetails, searchTerms, activeKeywords, campaignPerformance, rangeArgs }) {
  // Index progress notes by post_id
  const notesByPostId = new Map();
  for (const item of (progressDetails || [])) {
    const rows = item.rows
      ? Object.values(item.rows)
          .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
          .map((r) => ({
            staff_member: r.staff_member || null,
            next_action:  r.next_action  || null,
            message:      r.event_message || null,
          }))
          .filter((r) => r.message || r.staff_member)
      : [];
    if (rows.length > 0) notesByPostId.set(Number(item.post_id), rows);
  }

  // Group leads by reason
  const byReason = {};
  for (const lead of (notInterestedLeads || [])) {
    const reason = normaliseReason(lead.reason_not_interested);
    if (!byReason[reason]) byReason[reason] = { total: 0, by_campaign: {}, leads: [] };
    byReason[reason].total++;

    const campaign = lead.utm_campaign || null;
    if (campaign) {
      byReason[reason].by_campaign[campaign] = (byReason[reason].by_campaign[campaign] || 0) + 1;
    }

    byReason[reason].leads.push({
      id:           lead.id,
      date:         lead.date,
      utm_source:   lead.utm_source   || null,
      utm_medium:   lead.utm_medium   || null,
      utm_campaign: campaign,
      utm_ad_group: lead.utm_ad_group || null,
      search_term:  lead.search_term  || null,
      device_type:  lead.device_type  || null,
      notes:        notesByPostId.get(Number(lead.id)) ?? [],
    });
  }

  // Sort by_campaign into top-n array for readability
  const reasonSummary = {};
  for (const [reason, group] of Object.entries(byReason)) {
    reasonSummary[reason] = {
      total:           group.total,
      leads_with_notes: group.leads.filter((l) => l.notes.length > 0).length,
      top_campaigns:   Object.entries(group.by_campaign)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([campaign, count]) => ({ campaign, count })),
      leads:           group.leads,
    };
  }

  return {
    analysis_date:      new Date().toISOString().slice(0, 10),
    ads_data_range:     rangeArgs,
    not_interested_by_reason: reasonSummary,
    recent_search_terms:  searchTerms,
    active_keywords:      activeKeywords,
    campaign_performance: campaignPerformance,
  };
}

async function runNotInterestedReport(context) {
  const { orgId, req, emit } = context;

  const adminConfig = await AgentConfigService.getAdminConfig(TOOL_SLUG);

  // Ads date range — default 90 days (more search term / keyword signal)
  const days      = req?.body?.days ?? 90;
  const end       = new Date();
  const start     = new Date();
  start.setDate(start.getDate() - days);
  const startDate = start.toISOString().slice(0, 10);
  const endDate   = end.toISOString().slice(0, 10);
  const rangeArgs = { start_date: startDate, end_date: endDate };

  const customerId = req?.body?.customerId ?? null;

  // CRM privacy — apply pre-AI per platform convention
  const { excluded_fields: excludedCrmFields = [] } =
    await AgentConfigService.getCrmPrivacySettings(orgId);

  emit('Fetching not-interested leads from CRM…');

  const [adsServer, wpServer] = await Promise.all([
    getAdsServer(orgId),
    getWordPressServer(orgId),
  ]);

  // Phase 1 — CRM data (sequential: need lead IDs before filtering progress notes)
  const rawNotInterested = await callMcpTool(orgId, wpServer, 'wp_get_not_interested_reasons', {})
    .catch((e) => ({ error: e.message }));

  const notInterestedLeads = Array.isArray(rawNotInterested)
    ? applyPrivacy(rawNotInterested, excludedCrmFields)
    : [];

  const focusLeadIds = new Set(
    notInterestedLeads
      .filter((l) => {
        const r = normaliseReason(l.reason_not_interested);
        return FOCUS_REASONS.has(r) || FOCUS_REASONS.has(l.reason_not_interested?.trim().toLowerCase());
      })
      .map((l) => Number(l.id))
  );

  emit(`Found ${notInterestedLeads.length} not-interested leads (${focusLeadIds.size} wrong product/location). Fetching notes and ads data…`);

  // Phase 2 — progress notes + ads data in parallel
  const [rawProgressDetails, searchTerms, activeKeywords, campaignPerformance] = await Promise.all([
    callMcpTool(orgId, wpServer, 'wp_get_progress_details', { limit: 2000 })
      .catch((e) => ({ error: e.message })),
    callMcpTool(orgId, adsServer, 'ads_get_search_terms', { ...rangeArgs, customer_id: customerId })
      .catch((e) => ({ error: e.message })),
    callMcpTool(orgId, adsServer, 'ads_get_active_keywords', { customer_id: customerId })
      .catch((e) => ({ error: e.message })),
    callMcpTool(orgId, adsServer, 'ads_get_campaign_performance', { ...rangeArgs, customer_id: customerId })
      .catch((e) => ({ error: e.message })),
  ]);

  // Filter progress details to not-interested leads only
  const progressDetails = Array.isArray(rawProgressDetails)
    ? rawProgressDetails.filter((item) => focusLeadIds.has(Number(item.post_id)))
    : [];

  const leadsWithNotes = progressDetails.filter((item) => {
    const rowValues = item.rows ? Object.values(item.rows) : [];
    return rowValues.some((r) => r.event_message);
  }).length;

  emit(`Loaded ${progressDetails.length} leads with progress records (${leadsWithNotes} with notes). Building analysis…`);

  const payload = buildPayload({
    notInterestedLeads,
    progressDetails,
    searchTerms:        Array.isArray(searchTerms)       ? searchTerms       : [],
    activeKeywords:     Array.isArray(activeKeywords)    ? activeKeywords    : [],
    campaignPerformance: Array.isArray(campaignPerformance) ? campaignPerformance : [],
    rangeArgs,
  });

  const userMessage =
    `Produce the Not Interested diagnostic report. ` +
    `CRM data covers all time; Ads data covers ${startDate} to ${endDate}. ` +
    `All data has been pre-fetched. Follow the output format in the system prompt exactly.\n\n` +
    `\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;

  const { result, trace, tokensUsed } = await agentOrchestrator.run({
    systemPrompt:  buildSystemPrompt(),
    userMessage,
    tools:         [],
    maxIterations: 1,
    model:         adminConfig.model          ?? 'claude-sonnet-4-6',
    maxTokens:     adminConfig.max_tokens     ?? 4096,
    fallbackModel: adminConfig.fallback_model ?? null,
    onStep:        emit,
    context:       { ...context, toolSlug: TOOL_SLUG, customerId },
  });

  return { result, trace, tokensUsed };
}

module.exports = { runNotInterestedReport };
