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
   * @param {number|{startDate,endDate}} [options=30]
   */
  async getCampaignPerformance(options = 30) {
    const { from, to } = resolveRange(options);

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
   * @param {number|{startDate,endDate}} [options=30]
   */
  async getDailyPerformance(options = 30) {
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
    `);

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
   */
  async getSearchTerms(options = 30) {
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

const googleAdsService = new GoogleAdsService();

module.exports = { GoogleAdsService, googleAdsService };
