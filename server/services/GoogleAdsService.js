'use strict';

/**
 * GoogleAdsService — Google Ads API v23 data layer.
 *
 * Shared domain service — used by all Google Ads agents in MCP_curamTools.
 * Makes authenticated REST calls to the Google Ads API.
 * Auth: OAuth2 via googleapis (access token rotation handled automatically).
 *
 * All monetary values from the API are in micros (1/1,000,000 of the currency).
 * Every cost field is divided by 1,000,000 before being returned. Unit: AUD.
 *
 * Required environment variables:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 *   GOOGLE_ADS_CUSTOMER_ID      — advertiser account ID (dashes stripped automatically)
 *   GOOGLE_ADS_MANAGER_ID       — MCC account ID (required for manager-account auth)
 *   GOOGLE_ADS_DEVELOPER_TOKEN  — developer token from Google Ads API centre
 */

const { google } = require('googleapis');

const API_VERSION = 'v23';
const ADS_BASE    = `https://googleads.googleapis.com/${API_VERSION}`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d) {
  return d.toISOString().split('T')[0];
}

function dateRange(days) {
  const to   = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { from: fmtDate(from), to: fmtDate(to) };
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

  async _search(gaql) {
    const accessToken = await this._getAccessToken();

    const response = await fetch(
      `${ADS_BASE}/customers/${this._customerId}/googleAds:search`,
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
   * Campaign-level performance totals for all enabled campaigns.
   * All cost fields in AUD.
   * @param {number} [days=30]
   */
  async getCampaignPerformance(days = 30) {
    const { from, to } = dateRange(days);

    const results = await this._search(`
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
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
    `);

    return results.map((r) => ({
      id:          r.campaign?.id          ?? null,
      name:        r.campaign?.name        ?? '',
      status:      r.campaign?.status      ?? '',
      budget:      parseInt(r.campaignBudget?.amountMicros ?? '0') / 1_000_000,
      impressions: parseInt(r.metrics?.impressions         ?? '0'),
      clicks:      parseInt(r.metrics?.clicks              ?? '0'),
      cost:        parseInt(r.metrics?.costMicros          ?? '0') / 1_000_000,
      conversions: parseFloat(r.metrics?.conversions       ?? '0'),
      ctr:         parseFloat(r.metrics?.ctr               ?? '0'),
      avgCpc:      parseInt(r.metrics?.averageCpc          ?? '0') / 1_000_000,
    }));
  }

  /**
   * Daily aggregated account-level metrics. One row per day, ordered ASC.
   * Suitable for time-series charting. All cost fields in AUD.
   * @param {number} [days=30]
   */
  async getDailyPerformance(days = 30) {
    const { from, to } = dateRange(days);

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
    `);

    return results.map((r) => ({
      date:        r.segments?.date                            ?? '',
      impressions: parseInt(r.metrics?.impressions            ?? '0'),
      clicks:      parseInt(r.metrics?.clicks                 ?? '0'),
      cost:        parseInt(r.metrics?.costMicros             ?? '0') / 1_000_000,
      conversions: parseFloat(r.metrics?.conversions          ?? '0'),
    }));
  }

  /**
   * Top 50 actual user search queries by click volume.
   * Highest-signal dataset for intent analysis. All cost fields in AUD.
   * @param {number} [days=30]
   */
  async getSearchTerms(days = 30) {
    const { from, to } = dateRange(days);

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
    `);

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
   * Current month spend vs budget per campaign.
   * All cost fields in AUD.
   */
  async getBudgetPacing() {
    const results = await this._search(`
      SELECT
        campaign.name,
        campaign_budget.amount_micros,
        metrics.cost_micros
      FROM campaign
      WHERE campaign.status = 'ENABLED'
        AND segments.date DURING THIS_MONTH
    `);

    return results.map((r) => ({
      name:          r.campaign?.name                                     ?? '',
      monthlyBudget: parseInt(r.campaignBudget?.amountMicros ?? '0') / 1_000_000,
      spentToDate:   parseInt(r.metrics?.costMicros          ?? '0') / 1_000_000,
    }));
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

const googleAdsService = new GoogleAdsService();

module.exports = { GoogleAdsService, googleAdsService };
