'use strict';

/**
 * GoogleAnalyticsService — Google Analytics Data API (GA4) data layer.
 *
 * Methods accept either:
 *   - a number (days lookback from today): getSessionsOverview(30)
 *   - a range object: getSessionsOverview({ startDate: '2026-03-01', endDate: '2026-03-29' })
 *
 * Required environment variables:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 *   GOOGLE_GA4_PROPERTY_ID
 */

const { google } = require('googleapis');

const API_BASE = 'https://analyticsdata.googleapis.com/v1beta';

function fmtDate(d) {
  return d.toISOString().split('T')[0];
}

function resolveRange(options) {
  if (options && typeof options === 'object' && options.startDate && options.endDate) {
    return { startDate: options.startDate, endDate: options.endDate };
  }
  const days = typeof options === 'number' ? options : (options?.days ?? 30);
  const end   = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  return { startDate: fmtDate(start), endDate: fmtDate(end) };
}

function normDate(raw) {
  if (!raw || raw.length !== 8) return raw;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

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
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Google Analytics API ${response.status}: ${text}`);
    }
    return response.json();
  }

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

  /**
   * @param {number|{startDate,endDate}} [options=30]
   */
  async getSessionsOverview(options = 30) {
    const { startDate, endDate } = resolveRange(options);

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

  async getTrafficSources(options = 30) {
    const { startDate, endDate } = resolveRange(options);

    const data = await this._runReport({
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'sessions' }, { name: 'conversions' }, { name: 'totalRevenue' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    });

    return this._parseRows(data).map((r) => ({
      channel:      r.sessionDefaultChannelGroup ?? '',
      sessions:     parseInt(r.sessions          ?? '0'),
      conversions:  parseFloat(r.conversions     ?? '0'),
      totalRevenue: parseFloat(r.totalRevenue     ?? '0'),
    }));
  }

  async getLandingPagePerformance(options = 30) {
    const { startDate, endDate } = resolveRange(options);

    const data = await this._runReport({
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'landingPage' }],
      metrics: [
        { name: 'sessions' }, { name: 'conversions' },
        { name: 'bounceRate' }, { name: 'averageSessionDuration' },
      ],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 20,
    });

    return this._parseRows(data).map((r) => ({
      page:               r.landingPage                       ?? '',
      sessions:           parseInt(r.sessions                 ?? '0'),
      conversions:        parseFloat(r.conversions            ?? '0'),
      bounceRate:         parseFloat(r.bounceRate             ?? '0'),
      avgSessionDuration: parseFloat(r.averageSessionDuration ?? '0'),
    }));
  }

  /**
   * Paid sessions that bounced, grouped by landing page and device category.
   * Filtered to cpc medium (Google Ads traffic only).
   */
  async getPaidBouncedSessions(options = 30) {
    const { startDate, endDate } = resolveRange(options);

    const data = await this._runReport({
      dateRanges: [{ startDate, endDate }],
      dimensions: [
        { name: 'landingPage' },
        { name: 'deviceCategory' },
      ],
      metrics: [
        { name: 'sessions' },
        { name: 'bounceRate' },
        { name: 'averageSessionDuration' },
      ],
      dimensionFilter: {
        filter: {
          fieldName: 'sessionMedium',
          stringFilter: { matchType: 'EXACT', value: 'cpc', caseSensitive: false },
        },
      },
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 50,
    });

    return this._parseRows(data).map((r) => ({
      landingPage:        r.landingPage                       ?? '',
      device:             r.deviceCategory                    ?? '',
      sessions:           parseInt(r.sessions                 ?? '0'),
      bounceRate:         parseFloat(r.bounceRate             ?? '0'),
      avgSessionDuration: parseFloat(r.averageSessionDuration ?? '0'),
    }));
  }

  async getConversionEvents(options = 30) {
    const { startDate, endDate } = resolveRange(options);

    const data = await this._runReport({
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'eventName' }, { name: 'date' }],
      metrics: [{ name: 'eventCount' }, { name: 'conversions' }],
      metricFilter: {
        filter: {
          fieldName: 'conversions',
          numericFilter: { operation: 'GREATER_THAN', value: { doubleValue: 0 } },
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

const googleAnalyticsService = new GoogleAnalyticsService();

module.exports = { GoogleAnalyticsService, googleAnalyticsService };
