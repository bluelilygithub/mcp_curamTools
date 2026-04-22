'use strict';

/**
 * GoogleAdsService — Google Ads API v23 data layer.
 *
 * Shared domain service — used by all Google Ads agents in MCP_curamTools.
 * All monetary values returned in AUD (cost_micros ÷ 1,000,000).
 *
 * Methods accept either:
 *   - a number (days lookback from today): getCampaignPerformance(30)
 *   - a range object: getCampaignPerformance({ startDate: '2026-03-01', endDate: '2026-03-29' })
 *
 * Required environment variables:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 *   GOOGLE_ADS_CUSTOMER_ID, GOOGLE_ADS_MANAGER_ID, GOOGLE_ADS_DEVELOPER_TOKEN
 */

const { google } = require('googleapis');

const API_VERSION = 'v23';
const ADS_BASE    = `https://googleads.googleapis.com/${API_VERSION}`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d) {
  return d.toISOString().split('T')[0];
}

function dateRangeFromDays(days) {
  const to   = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { from: fmtDate(from), to: fmtDate(to) };
}

/**
 * Resolve a { from, to } GAQL range from either a number (days) or { startDate, endDate }.
 */
function resolveRange(options) {
  if (options && typeof options === 'object' && options.startDate && options.endDate) {
    return { from: options.startDate, to: options.endDate };
  }
  const days = typeof options === 'number' ? options : (options?.days ?? 30);
  return dateRangeFromDays(days);
}

// ─── GoogleAdsService ─────────────────────────────────────────────────────────

class GoogleAdsService {
  constructor() {
    this._oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    this._oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

    this._customerId = (process.env.GOOGLE_ADS_CUSTOMER_ID ?? '').replace(/-/g, '');
    this._managerId  = (process.env.GOOGLE_ADS_MANAGER_ID  ?? '').replace(/-/g, '');
    this._devToken   = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '';
  }

  async _getAccessToken() {
    const { token } = await this._oauth2.getAccessToken();
    return token;
  }

  /**
   * @param {string} gaql
   * @param {string|null} [customerId] — override the env default customer ID for multi-account runs
   */
  async _search(gaql, customerId = null) {
    const accessToken = await this._getAccessToken();
    const cid = customerId ? customerId.replace(/-/g, '') : this._customerId;

    const response = await fetch(
      `${ADS_BASE}/customers/${cid}/googleAds:search`,
      {
        method: 'POST',
        headers: {
          'Authorization':     `Bearer ${accessToken}`,
          'developer-token':   this._devToken,
          'login-customer-id': this._managerId,
          'Content-Type':      'application/json',
        },
        body: JSON.stringify({ query: gaql }),
      }
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Google Ads API ${response.status}: ${body}`);
    }

    const data = await response.json();
    return data.results ?? [];
  }

  // ── Public methods ────────────────────────────────────────────────────────

  /**
   * @param {number|{startDate,endDate}} [options=30]
   * @param {string|null} [customerId]
   */
  async getCampaignPerformance(options = 30, customerId = null) {
    const { from, to } = resolveRange(options);

    const results = await this._search(`
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.bidding_strategy_type,
        campaign.target_cpa.target_cpa_micros,
        campaign.target_roas.target_roas,
        campaign.maximize_conversions.target_cpa_micros,
        campaign.maximize_conversion_value.target_roas,
        campaign_budget.amount_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.ctr,
        metrics.average_cpc
      FROM campaign
      WHERE campaign.status = 'ENABLED'
        AND segments.date BETWEEN '${from}' AND '${to}'
    `, customerId);

    return results.map((r) => {
      const strategyType = r.campaign?.biddingStrategyType ?? 'UNKNOWN';

      // Resolve target CPA in AUD — may come from tCPA or Max Conversions with target
      const targetCpaMicros =
        parseInt(r.campaign?.targetCpa?.targetCpaMicros ?? '0') ||
        parseInt(r.campaign?.maximizeConversions?.targetCpaMicros ?? '0');

      // Resolve target ROAS — may come from tROAS or Max Conversion Value with target
      const targetRoas =
        parseFloat(r.campaign?.targetRoas?.targetRoas ?? '0') ||
        parseFloat(r.campaign?.maximizeConversionValue?.targetRoas ?? '0');

      return {
        id:             r.campaign?.id          ?? null,
        name:           r.campaign?.name        ?? '',
        status:         r.campaign?.status      ?? '',
        biddingStrategy: strategyType,
        targetCpaAud:   targetCpaMicros > 0 ? targetCpaMicros / 1_000_000 : null,
        targetRoas:     targetRoas       > 0 ? targetRoas                  : null,
        budget:         parseInt(r.campaignBudget?.amountMicros ?? '0') / 1_000_000,
        impressions:    parseInt(r.metrics?.impressions         ?? '0'),
        clicks:         parseInt(r.metrics?.clicks              ?? '0'),
        cost:           parseInt(r.metrics?.costMicros          ?? '0') / 1_000_000,
        conversions:    parseFloat(r.metrics?.conversions       ?? '0'),
        ctr:            parseFloat(r.metrics?.ctr               ?? '0'),
        avgCpc:         parseInt(r.metrics?.averageCpc          ?? '0') / 1_000_000,
      };
    });
  }

  /**
   * @param {number|{startDate,endDate}} [options=30]
   * @param {string|null} [customerId]
   */
  async getDailyPerformance(options = 30, customerId = null) {
    const { from, to } = resolveRange(options);

    const results = await this._search(`
      SELECT
        segments.date,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions
      FROM customer
      WHERE segments.date BETWEEN '${from}' AND '${to}'
      ORDER BY segments.date ASC
    `, customerId);

    return results.map((r) => ({
      date:        r.segments?.date                  ?? '',
      impressions: parseInt(r.metrics?.impressions   ?? '0'),
      clicks:      parseInt(r.metrics?.clicks        ?? '0'),
      cost:        parseInt(r.metrics?.costMicros    ?? '0') / 1_000_000,
      conversions: parseFloat(r.metrics?.conversions ?? '0'),
    }));
  }

  /**
   * @param {number|{startDate,endDate}} [options=30]
   * @param {string|null} [customerId]
   */
  async getSearchTerms(options = 30, customerId = null) {
    const { from, to } = resolveRange(options);

    const results = await this._search(`
      SELECT
        search_term_view.search_term,
        search_term_view.status,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.ctr
      FROM search_term_view
      WHERE segments.date BETWEEN '${from}' AND '${to}'
      ORDER BY metrics.clicks DESC
      LIMIT 50
    `, customerId);

    return results.map((r) => ({
      term:        r.searchTermView?.searchTerm  ?? '',
      status:      r.searchTermView?.status      ?? '',
      impressions: parseInt(r.metrics?.impressions ?? '0'),
      clicks:      parseInt(r.metrics?.clicks      ?? '0'),
      cost:        parseInt(r.metrics?.costMicros  ?? '0') / 1_000_000,
      conversions: parseFloat(r.metrics?.conversions ?? '0'),
      ctr:         parseFloat(r.metrics?.ctr         ?? '0'),
    }));
  }

  /**
   * @param {string|null} [customerId]
   */
  async getBudgetPacing(customerId = null) {
    const results = await this._search(`
      SELECT
        campaign.name,
        campaign_budget.amount_micros,
        metrics.cost_micros
      FROM campaign
      WHERE campaign.status = 'ENABLED'
        AND segments.date DURING THIS_MONTH
    `, customerId);

    return results.map((r) => ({
      name:          r.campaign?.name                                     ?? '',
      monthlyBudget: parseInt(r.campaignBudget?.amountMicros ?? '0') / 1_000_000,
      spentToDate:   parseInt(r.metrics?.costMicros          ?? '0') / 1_000_000,
    }));
  }
  /**
   * Generate keyword ideas from a competitor URL or seed keywords.
   * Uses the Google Ads Keyword Plan Idea Service — free, no extra quota.
   *
   * @param {object} options
   * @param {string}   [options.url]       — competitor or seed URL
   * @param {string[]} [options.keywords]  — seed keyword list (used if no url)
   * @param {string|null} [customerId]
   * @returns keyword ideas with avg monthly searches, competition, and CPC range (AUD)
   */
  async generateKeywordIdeas({ url = null, keywords = [] } = {}, customerId = null) {
    const accessToken = await this._getAccessToken();
    const cid = customerId ? customerId.replace(/-/g, '') : this._customerId;

    const seed = url
      ? { urlSeed: { url } }
      : { keywordSeed: { keywords } };

    const body = {
      pageSize: 100,
      language:          'languageConstants/1000',       // English
      geoTargetConstants: ['geoTargetConstants/2036'],   // Australia
      keywordPlanNetwork: 'GOOGLE_SEARCH',
      ...seed,
    };

    const response = await fetch(
      `${ADS_BASE}/customers/${cid}:generateKeywordIdeas`,
      {
        method: 'POST',
        headers: {
          'Authorization':     `Bearer ${accessToken}`,
          'developer-token':   this._devToken,
          'login-customer-id': this._managerId,
          'Content-Type':      'application/json',
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Google Ads generateKeywordIdeas ${response.status}: ${text}`);
    }

    const data = await response.json();
    return (data.results ?? []).map((r) => ({
      keyword:          r.text ?? '',
      avgMonthlySearches: parseInt(r.keywordIdeaMetrics?.avgMonthlySearches ?? '0'),
      competition:      r.keywordIdeaMetrics?.competition ?? 'UNSPECIFIED',
      competitionIndex: parseInt(r.keywordIdeaMetrics?.competitionIndex ?? '0'),
      lowCpc:           parseInt(r.keywordIdeaMetrics?.lowTopOfPageBidMicros  ?? '0') / 1_000_000,
      highCpc:          parseInt(r.keywordIdeaMetrics?.highTopOfPageBidMicros ?? '0') / 1_000_000,
    })).sort((a, b) => b.avgMonthlySearches - a.avgMonthlySearches);
  }

  /**
   * Auction Insights — competitor domains appearing in the same auctions.
   * Works with Explorer/Test developer token access.
   * @param {number|{startDate,endDate}} [options=30]
   * @param {string|null} [customerId]
   */
  async getAuctionInsights(options = 30, customerId = null) {
    const { from, to } = resolveRange(options);

    const results = await this._search(`
      SELECT
        segments.auction_insight_domain,
        metrics.search_impression_share,
        metrics.auction_insight_search_top_impression_percentage,
        metrics.auction_insight_search_absolute_top_impression_percentage,
        metrics.auction_insight_search_outranking_share,
        campaign.name
      FROM auction_insight
      WHERE segments.date BETWEEN '${from}' AND '${to}'
      ORDER BY metrics.search_impression_share DESC
    `, customerId);

    // Aggregate by domain across campaigns
    const byDomain = new Map();
    for (const r of results) {
      const domain = r.segments?.auctionInsightDomain ?? '(unknown)';
      if (!byDomain.has(domain)) {
        byDomain.set(domain, {
          domain,
          campaigns:             [],
          impressionShare:       0,
          topOfPageRate:         0,
          absoluteTopOfPageRate: 0,
          outrankingShare:       0,
          _count:                0,
        });
      }
      const entry = byDomain.get(domain);
      entry.campaigns.push(r.campaign?.name ?? '');
      entry.impressionShare       += parseFloat(r.metrics?.searchImpressionShare                              ?? '0');
      entry.topOfPageRate         += parseFloat(r.metrics?.auctionInsightSearchTopImpressionPercentage        ?? '0');
      entry.absoluteTopOfPageRate += parseFloat(r.metrics?.auctionInsightSearchAbsoluteTopImpressionPercentage ?? '0');
      entry.outrankingShare       += parseFloat(r.metrics?.auctionInsightSearchOutrankingShare                ?? '0');
      entry._count                += 1;
    }

    return [...byDomain.values()].map((e) => ({
      domain:               e.domain,
      campaigns:            [...new Set(e.campaigns)],
      impressionShare:      e._count ? e.impressionShare       / e._count : 0,
      topOfPageRate:        e._count ? e.topOfPageRate         / e._count : 0,
      absoluteTopOfPageRate: e._count ? e.absoluteTopOfPageRate / e._count : 0,
      outrankingShare:      e._count ? e.outrankingShare       / e._count : 0,
    })).sort((a, b) => b.impressionShare - a.impressionShare);
  }

  /**
   * Impression share per campaign — own visibility metrics for context alongside auction insights.
   * @param {number|{startDate,endDate}} [options=30]
   * @param {string|null} [customerId]
   */
  async getImpressionShareByCampaign(options = 30, customerId = null) {
    const { from, to } = resolveRange(options);

    const results = await this._search(`
      SELECT
        campaign.name,
        metrics.search_impression_share,
        metrics.search_rank_lost_impression_share,
        metrics.search_budget_lost_impression_share
      FROM campaign
      WHERE campaign.status = 'ENABLED'
        AND segments.date BETWEEN '${from}' AND '${to}'
    `, customerId);

    return results.map((r) => ({
      campaign:       r.campaign?.name ?? '',
      impressionShare: parseFloat(r.metrics?.searchImpressionShare          ?? '0'),
      lostToRank:      parseFloat(r.metrics?.searchRankLostImpressionShare   ?? '0'),
      lostToBudget:    parseFloat(r.metrics?.searchBudgetLostImpressionShare ?? '0'),
    })).sort((a, b) => b.impressionShare - a.impressionShare);
  }

  /**
   * Returns all active keywords currently in Diamond Plate's Google Ads account.
   * @param {string|null} [customerId]
   */
  async getActiveKeywords(customerId = null) {
    const results = await this._search(`
      SELECT
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,
        ad_group_criterion.status,
        ad_group_criterion.cpc_bid_micros,
        campaign.name,
        ad_group.name
      FROM ad_group_criterion
      WHERE ad_group_criterion.type = 'KEYWORD'
        AND ad_group_criterion.status = 'ENABLED'
        AND campaign.status = 'ENABLED'
        AND ad_group.status = 'ENABLED'
      ORDER BY ad_group_criterion.cpc_bid_micros DESC
      LIMIT 200
    `, customerId);

    return results.map((r) => ({
      keyword:   r.adGroupCriterion?.keyword?.text      ?? '',
      matchType: r.adGroupCriterion?.keyword?.matchType ?? '',
      bid:       parseInt(r.adGroupCriterion?.cpcBidMicros ?? '0') / 1_000_000,
      campaign:  r.campaign?.name                       ?? '',
      adGroup:   r.adGroup?.name                        ?? '',
    }));
  }

  /**
   * Returns all enabled RSA ads with headlines, descriptions, ad strength, and final URLs.
   * @param {string|null} [customerId]
   */
  async getAdGroupAds(customerId = null) {
    const results = await this._search(`
      SELECT
        campaign.id,
        campaign.name,
        ad_group.id,
        ad_group.name,
        ad_group_ad.ad.id,
        ad_group_ad.ad.responsive_search_ad.headlines,
        ad_group_ad.ad.responsive_search_ad.descriptions,
        ad_group_ad.ad.final_urls,
        ad_group_ad.status,
        ad_group_ad.ad_strength
      FROM ad_group_ad
      WHERE campaign.status = 'ENABLED'
        AND ad_group.status = 'ENABLED'
        AND ad_group_ad.status = 'ENABLED'
        AND ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'
      ORDER BY campaign.name, ad_group.name
    `, customerId);

    return results.map((r) => ({
      campaignId:   r.campaign?.id   ?? '',
      campaign:     r.campaign?.name ?? '',
      adGroupId:    r.adGroup?.id    ?? '',
      adGroup:      r.adGroup?.name  ?? '',
      adId:         r.adGroupAd?.ad?.id ?? '',
      adStrength:   r.adGroupAd?.adStrength ?? 'UNSPECIFIED',
      finalUrls:    r.adGroupAd?.ad?.finalUrls ?? [],
      headlines:    (r.adGroupAd?.ad?.responsiveSearchAd?.headlines ?? []).map((h) => ({
        text:        h.text ?? '',
        pinnedField: h.pinnedField ?? null,
      })),
      descriptions: (r.adGroupAd?.ad?.responsiveSearchAd?.descriptions ?? []).map((d) => ({
        text:        d.text ?? '',
        pinnedField: d.pinnedField ?? null,
      })),
    }));
  }

  /**
   * Returns asset performance labels for enabled RSA ad assets.
   * Joins ad_group_ad_asset_view with asset to get text + performance label.
   * @param {string|null} [customerId]
   */
  async getAdAssetPerformance(customerId = null) {
    const results = await this._search(`
      SELECT
        campaign.name,
        ad_group.name,
        ad_group_ad.ad.id,
        ad_group_ad_asset_view.field_type,
        ad_group_ad_asset_view.performance_label,
        ad_group_ad_asset_view.pinned_field,
        ad_group_ad_asset_view.enabled,
        asset.text_asset.text
      FROM ad_group_ad_asset_view
      WHERE campaign.status = 'ENABLED'
        AND ad_group.status = 'ENABLED'
        AND ad_group_ad.status = 'ENABLED'
      ORDER BY campaign.name, ad_group.name
    `, customerId);

    return results
      .filter((r) => r.adGroupAdAssetView?.enabled !== false)
      .map((r) => ({
        campaign:         r.campaign?.name ?? '',
        adGroup:          r.adGroup?.name  ?? '',
        adId:             r.adGroupAd?.ad?.id ?? '',
        fieldType:        r.adGroupAdAssetView?.fieldType        ?? '',
        performanceLabel: r.adGroupAdAssetView?.performanceLabel ?? 'UNSPECIFIED',
        pinnedField:      r.adGroupAdAssetView?.pinnedField      ?? null,
        text:             r.asset?.textAsset?.text               ?? '',
      }));
  }

  /**
   * Returns performance metrics per ad group (impressions, clicks, cost, conversions, CTR, conv rate, CPA).
   * @param {number|{startDate,endDate}} [options=30]
   * @param {string|null} [customerId]
   */
  async getAdGroupPerformance(options = 30, customerId = null) {
    const { from, to } = resolveRange(options);

    const results = await this._search(`
      SELECT
        campaign.name,
        ad_group.name,
        ad_group.status,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.ctr,
        metrics.average_cpc,
        metrics.conversions_from_interactions_rate,
        metrics.cost_per_conversion
      FROM ad_group
      WHERE campaign.status = 'ENABLED'
        AND ad_group.status = 'ENABLED'
        AND segments.date BETWEEN '${from}' AND '${to}'
      ORDER BY metrics.impressions DESC
    `, customerId);

    return results.map((r) => ({
      campaign:    r.campaign?.name  ?? '',
      adGroup:     r.adGroup?.name   ?? '',
      impressions: parseInt(r.metrics?.impressions ?? '0'),
      clicks:      parseInt(r.metrics?.clicks ?? '0'),
      cost:        parseInt(r.metrics?.costMicros ?? '0') / 1_000_000,
      conversions: parseFloat(r.metrics?.conversions ?? '0'),
      ctr:         parseFloat(r.metrics?.ctr ?? '0'),
      avgCpc:      parseInt(r.metrics?.averageCpc ?? '0') / 1_000_000,
      convRate:    parseFloat(r.metrics?.conversionsFromInteractionsRate ?? '0'),
      cpa:         parseInt(r.metrics?.costPerConversion ?? '0') / 1_000_000,
    }));
  }

  /**
   * Returns top search terms grouped by ad group — up to 20 per ad group.
   * @param {number|{startDate,endDate}} [options=30]
   * @param {string|null} [customerId]
   */
  async getSearchTermsByAdGroup(options = 30, customerId = null) {
    const { from, to } = resolveRange(options);

    const results = await this._search(`
      SELECT
        campaign.name,
        ad_group.name,
        search_term_view.search_term,
        search_term_view.status,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.ctr
      FROM search_term_view
      WHERE campaign.status = 'ENABLED'
        AND ad_group.status = 'ENABLED'
        AND segments.date BETWEEN '${from}' AND '${to}'
      ORDER BY metrics.clicks DESC
      LIMIT 1000
    `, customerId);

    // Group by campaign + ad group, keep top 20 per group
    const groups = {};
    for (const r of results) {
      const key = `${r.campaign?.name ?? ''}|||${r.adGroup?.name ?? ''}`;
      if (!groups[key]) groups[key] = { campaign: r.campaign?.name ?? '', adGroup: r.adGroup?.name ?? '', terms: [] };
      if (groups[key].terms.length < 20) {
        groups[key].terms.push({
          term:        r.searchTermView?.searchTerm ?? '',
          status:      r.searchTermView?.status     ?? '',
          impressions: parseInt(r.metrics?.impressions ?? '0'),
          clicks:      parseInt(r.metrics?.clicks ?? '0'),
          cost:        parseInt(r.metrics?.costMicros ?? '0') / 1_000_000,
          conversions: parseFloat(r.metrics?.conversions ?? '0'),
          ctr:         parseFloat(r.metrics?.ctr ?? '0'),
        });
      }
    }
    return Object.values(groups);
  }

  /**
   * Returns keyword quality scores with QS components per ad group.
   * Components: searchPredictedCtr, creativeQualityScore, postClickQualityScore
   * Values: BELOW_AVERAGE, AVERAGE, ABOVE_AVERAGE
   * @param {string|null} [customerId]
   */
  async getQualityScores(customerId = null) {
    const results = await this._search(`
      SELECT
        campaign.name,
        ad_group.name,
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,
        ad_group_criterion.quality_info.quality_score,
        ad_group_criterion.quality_info.creative_quality_score,
        ad_group_criterion.quality_info.post_click_quality_score,
        ad_group_criterion.quality_info.search_predicted_ctr
      FROM ad_group_criterion
      WHERE ad_group_criterion.type = 'KEYWORD'
        AND ad_group_criterion.status = 'ENABLED'
        AND campaign.status = 'ENABLED'
        AND ad_group.status = 'ENABLED'
      ORDER BY campaign.name, ad_group.name
      LIMIT 500
    `, customerId);

    return results.map((r) => ({
      campaign:          r.campaign?.name                                        ?? '',
      adGroup:           r.adGroup?.name                                         ?? '',
      keyword:           r.adGroupCriterion?.keyword?.text                       ?? '',
      matchType:         r.adGroupCriterion?.keyword?.matchType                  ?? '',
      qualityScore:      r.adGroupCriterion?.qualityInfo?.qualityScore           ?? null,
      expectedCtr:       r.adGroupCriterion?.qualityInfo?.searchPredictedCtr     ?? 'UNKNOWN',
      adRelevance:       r.adGroupCriterion?.qualityInfo?.creativeQualityScore   ?? 'UNKNOWN',
      landingPageExp:    r.adGroupCriterion?.qualityInfo?.postClickQualityScore  ?? 'UNKNOWN',
    }));
  }

  /**
   * Returns recent change history events (bid/budget/status changes, ad edits).
   * @param {number|{startDate,endDate}} [options=7]
   * @param {string|null} [customerId]
   */
  async getChangeHistory(options = 7, customerId = null) {
    let { from, to } = resolveRange(options);
    // change_event API only allows up to 30 days back — cap the start date
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const maxFrom = thirtyDaysAgo.toISOString().slice(0, 10);
    if (from < maxFrom) from = maxFrom;

    const results = await this._search(`
      SELECT
        change_event.change_date_time,
        change_event.change_resource_type,
        change_event.changed_fields,
        change_event.client_type,
        change_event.resource_change_operation,
        campaign.name
      FROM change_event
      WHERE change_event.change_date_time >= '${from} 00:00:00'
        AND change_event.change_date_time <= '${to} 23:59:59'
      ORDER BY change_event.change_date_time DESC
      LIMIT 50
    `, customerId);

    return results.map((r) => ({
      changedAt:      r.changeEvent?.changeDateTimeAsString ?? r.changeEvent?.changeDateTime ?? '',
      resourceType:   r.changeEvent?.changeResourceType    ?? '',
      changedFields:  r.changeEvent?.changedFields         ?? [],
      clientType:     r.changeEvent?.clientType            ?? '',
      operation:      r.changeEvent?.resourceChangeOperation ?? '',
      campaignName:   r.campaign?.name                     ?? '',
    }));
  }
}

const googleAdsService = new GoogleAdsService();

module.exports = { GoogleAdsService, googleAdsService };
