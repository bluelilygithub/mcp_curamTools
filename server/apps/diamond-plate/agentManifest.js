'use strict';

/**
 * Diamond Plate app — agent manifest (Google Ads, CRM, analytics).
 * Registered via apps/diamond-plate/plugin.js → createPlatform().
 */

module.exports = [
  {
    slug:       'google-ads-monitor',
    module:     'googleAdsMonitor',
    export:     'runGoogleAdsMonitor',
    permission: 'ads_operator',
    schedule:   '0 6,18 * * *',
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
    schedule:   '0 7 * * 1',
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
  },
  {
    slug:       'nightly-cost-alert',
    module:     'nightlyCostAlert',
    export:     'runNightlyCostAlert',
    permission: 'org_admin',
    schedule:   '0 22 * * *',
  },
  {
    slug:       'anomaly-investigator',
    module:     'anomalyInvestigator',
    export:     'runAnomalyInvestigator',
    permission: 'ads_operator',
  },
];
