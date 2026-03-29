'use strict';

/**
 * GoogleAnalyticsService — Google Analytics Data API (GA4) data layer.
 *
 * Shared domain service — used by all Google Ads agents in MCP_curamTools.
 * Makes authenticated REST calls to the GA4 Data API v1beta.
 * Auth: OAuth2 via googleapis (same grant as GoogleAdsService).
 *
 * Required environment variables:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 *   GOOGLE_GA4_PROPERTY_ID  — numeric GA4 property ID (e.g. "123456789")
 */

const { google } = require('googleapis');

const API_BASE = 'https://analyticsdata.googleapis.com/v1beta';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d) {
  return d.toISOString().split('T')[0];
}

function dateRange(days) {
  const end   = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  return { startDate: fmtDate(start), endDate: fmtDate(end) };
}

/** GA4 returns dates as YYYYMMDD — normalise to YYYY-MM-DD. */
function normDate(raw) {
  if (!raw || raw.length !== 8) return raw;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

// ─── GoogleAnalyticsService ───────────────────────────────────────────────────

class GoogleAnalyticsService {
  constructor() {
    this._oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    this._oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    this._propertyId = process.env.GOOGLE_GA4_PROPERTY_ID ?? '';
  }

  async _getAccessToken() {
    const { token } = await this._oauth2.getAccessToken();
    return token;
  }

  async _runReport(body) {
    const accessToken = await this._getAccessToken();

    const response = await fetch(
      `${API_BASE}/properties/${this._propertyId}:runReport`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Google Analytics API ${response.status}: ${text}`);
    }

    return response.json();
  }

  /** Convert GA4's parallel header/row structure into flat objects. */
  _parseRows(data) {
    const dimKeys = (data.dimensionHeaders ?? []).map((h) => h.name);
    const metKeys = (data.metricHeaders   ?? []).map((h) => h.name);

    return (data.rows ?? []).map((row) => {
      const obj = {};
      (row.dimensionValues ?? []).forEach((dv, i) => { obj[dimKeys[i]] = dv.value; });
      (row.metricValues    ?? []).forEach((mv, i) => { obj[metKeys[i]] = mv.value; });
      return obj;
    });
  }

  // ── Public methods ────────────────────────────────────────────────────────

  /**
   * Daily session metrics. One row per day ordered ASC. Suitable for charting.
   * bounceRate is a decimal fraction (0.42 = 42%).
   * @param {number} [days=30]
   */
  async getSessionsOverview(days = 30) {
    const { startDate, endDate } = dateRange(days);

    const data = await this._runReport({
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'date' }],
      metrics: [
        { name: 'sessions' },
        { name: 'activeUsers' },
        { name: 'newUsers' },
        { name: 'bounceRate' },
      ],
      orderBys: [{ dimension: { dimensionName: 'date' }, desc: false }],
    });

    return this._parseRows(data).map((r) => ({
      date:        normDate(r.date        ?? ''),
      sessions:    parseInt(r.sessions    ?? '0'),
      activeUsers: parseInt(r.activeUsers ?? '0'),
      newUsers:    parseInt(r.newUsers    ?? '0'),
      bounceRate:  parseFloat(r.bounceRate ?? '0'),
    }));
  }

  /**
   * Traffic source breakdown — one row per default channel group.
   * @param {number} [days=30]
   */
  async getTrafficSources(days = 30) {
    const { startDate, endDate } = dateRange(days);

    const data = await this._runReport({
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: [
        { name: 'sessions' },
        { name: 'conversions' },
        { name: 'totalRevenue' },
      ],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    });

    return this._parseRows(data).map((r) => ({
      channel:      r.sessionDefaultChannelGroup ?? '',
      sessions:     parseInt(r.sessions          ?? '0'),
      conversions:  parseFloat(r.conversions     ?? '0'),
      totalRevenue: parseFloat(r.totalRevenue     ?? '0'),
    }));
  }

  /**
   * Top 20 landing pages by session volume.
   * @param {number} [days=30]
   */
  async getLandingPagePerformance(days = 30) {
    const { startDate, endDate } = dateRange(days);

    const data = await this._runReport({
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'landingPage' }],
      metrics: [
        { name: 'sessions' },
        { name: 'conversions' },
        { name: 'bounceRate' },
        { name: 'averageSessionDuration' },
      ],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 20,
    });

    return this._parseRows(data).map((r) => ({
      page:               r.landingPage                        ?? '',
      sessions:           parseInt(r.sessions                  ?? '0'),
      conversions:        parseFloat(r.conversions             ?? '0'),
      bounceRate:         parseFloat(r.bounceRate              ?? '0'),
      avgSessionDuration: parseFloat(r.averageSessionDuration  ?? '0'),
    }));
  }

  /**
   * Conversion events (eventCount > 0 only), broken down by event name and date.
   * @param {number} [days=30]
   */
  async getConversionEvents(days = 30) {
    const { startDate, endDate } = dateRange(days);

    const data = await this._runReport({
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'eventName' }, { name: 'date' }],
      metrics: [{ name: 'eventCount' }, { name: 'conversions' }],
      metricFilter: {
        filter: {
          fieldName: 'conversions',
          numericFilter: {
            operation: 'GREATER_THAN',
            value: { doubleValue: 0 },
          },
        },
      },
      orderBys: [
        { dimension: { dimensionName: 'date' }, desc: false },
        { metric: { metricName: 'conversions' }, desc: true },
      ],
    });

    return this._parseRows(data).map((r) => ({
      event:       r.eventName           ?? '',
      date:        normDate(r.date       ?? ''),
      eventCount:  parseInt(r.eventCount ?? '0'),
      conversions: parseFloat(r.conversions ?? '0'),
    }));
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

const googleAnalyticsService = new GoogleAnalyticsService();

module.exports = { GoogleAnalyticsService, googleAnalyticsService };
