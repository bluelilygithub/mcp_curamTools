/**
 * Agent manifest — single source of truth for all SSE agents.
 *
 * Each entry drives route registration, scheduler wiring, and load-failure isolation.
 * Module paths are relative to server/agents/.
 *
 * Adding an agent: add one entry here + create the agent files.
 * No other file needs editing for basic registration.
 *
 * Fields:
 *   slug        — URL path segment and agent identifier
 *   module      — path relative to server/agents/ (no .js extension needed)
 *   export      — named export from that module
 *   permission  — requiredPermission passed to createAgentRoute
 *   rateLimit   — optional; runs per user per 5 min (default: 5)
 *   schedule    — optional cron string (UTC); registers with AgentScheduler on load
 */
module.exports = [
  // ── Google Ads ─────────────────────────────────────────────────────────────
  {
    slug:       'google-ads-monitor',
    module:     'googleAdsMonitor',
    export:     'runGoogleAdsMonitor',
    permission: 'ads_operator',
    schedule:   '0 6,18 * * *',          // 06:00 + 18:00 UTC (16:00 + 04:00 AEST)
  },
  {
    slug:       'google-ads-freeform',
    module:     'googleAdsFreeform',
    export:     'runGoogleAdsFreeform',
    permission: 'ads_operator',
  },
  {
    slug:       'google-ads-change-impact',
    module:     'googleAdsChangeImpact',
    export:     'runGoogleAdsChangeImpact',
    permission: 'ads_operator',
  },
  {
    slug:       'google-ads-change-audit',
    module:     'googleAdsChangeAudit',
    export:     'runGoogleAdsChangeAudit',
    permission: 'ads_operator',
  },
  {
    slug:       'ads-bounce-analysis',
    module:     'adsBounceAnalysis',
    export:     'runAdsBounceAnalysis',
    permission: 'ads_operator',
  },
  {
    slug:       'auction-insights',
    module:     'auctionInsights',
    export:     'runAuctionInsights',
    permission: 'ads_operator',
  },
  {
    slug:       'competitor-keyword-intel',
    module:     'competitorKeywordIntel',
    export:     'runCompetitorKeywordIntel',
    permission: 'ads_operator',
  },
  {
    slug:       'google-ads-strategic-review',
    module:     'googleAdsStrategicReview',
    export:     'runGoogleAdsStrategicReview',
    permission: 'ads_operator',
  },
  {
    slug:       'keyword-opportunity',
    module:     'keywordOpportunity',
    export:     'runKeywordOpportunity',
    permission: 'ads_operator',
  },
  {
    slug:       'ads-copy-gate',
    module:     'adsCopyGate',
    export:     'runAdsCopyGate',
    permission: 'ads_operator',
  },
  {
    slug:       'ads-copy-playbook',
    module:     'adsCopyPlaybook',
    export:     'runAdsCopyPlaybook',
    permission: 'ads_operator',
  },
  {
    slug:       'ads-setup-architect',
    module:     'profitabilitySuite/adsSetupArchitect',
    export:     'runAdsSetupArchitect',
    permission: 'ads_operator',
  },
  {
    slug:       'ads-copy-diagnostic',
    module:     'adsCopyDiagnostic',
    export:     'runAdsCopyDiagnostic',
    permission: 'ads_operator',
  },
  {
    slug:       'ads-attribution-summary',
    module:     'adsAttributionSummary',
    export:     'runAdsAttributionSummary',
    permission: 'ads_operator',
  },

  // ── Analytics + CRM ────────────────────────────────────────────────────────
  {
    slug:       'wp-theme-extractor',
    module:     'wpThemeExtractor',
    export:     'runWpThemeExtractor',
    permission: 'org_member',
    rateLimit:  20,
  },
  {
    slug:       'diamondplate-data',
    module:     'diamondplateData',
    export:     'runDiamondplateData',
    permission: 'org_member',
  },
  {
    slug:       'search-term-intelligence',
    module:     'searchTermIntelligence',
    export:     'runSearchTermIntelligence',
    permission: 'org_member',
  },
  {
    slug:       'daypart-intelligence',
    module:     'daypartIntelligence',
    export:     'runDaypartIntelligence',
    permission: 'ads_operator',
  },
  {
    slug:       'cost-per-booked-job',
    module:     'costPerBookedJob',
    export:     'runCostPerBookedJob',
    permission: 'ads_operator',
  },
  {
    slug:       'lead-velocity',
    module:     'leadVelocity',
    export:     'runLeadVelocity',
    permission: 'org_member',
  },
  {
    slug:       'ai-visibility-monitor',
    module:     'aiVisibilityMonitor',
    export:     'runAiVisibilityMonitor',
    permission: 'org_member',
    schedule:   '0 7 * * 1',             // 07:00 UTC Monday (17:00 AEST Monday)
  },
  {
    slug:       'not-interested-report',
    module:     'notInterestedReport',
    export:     'runNotInterestedReport',
    permission: 'org_admin',
  },
  {
    slug:       'geo-heatmap',
    module:     'geoHeatmap',
    export:     'runGeoHeatmap',
    permission: 'org_member',
  },
  {
    slug:       'high-intent-advisor',
    module:     'highIntentAdvisor',
    export:     'runHighIntentAdvisor',
    permission: 'org_admin',
    // schedule deferred — add after manual QA
  },

  // ── Demo Suite ─────────────────────────────────────────────────────────────
  {
    slug:       'demo-document-analyzer',
    module:     'demoSuite/documentAnalyzer',
    export:     'runDocumentAnalyzer',
    permission: 'org_member',
    rateLimit:  20,
  },
  {
    slug:       'spec-validator',
    module:     'specValidator/index',
    export:     'runSpecValidator',
    permission: 'org_member',
    rateLimit:  10,
  },
  {
    slug:       'demo-spec-validator',
    module:     'specValidator/index',     // same module as spec-validator
    export:     'runSpecValidator',
    permission: 'org_member',
    rateLimit:  20,
  },
  {
    slug:       'demo-tender-response',
    module:     'demoSuite/tenderResponse',
    export:     'runTenderResponse',
    permission: 'org_member',
    rateLimit:  10,
  },
];
