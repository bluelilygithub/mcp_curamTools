'use strict';

/**
 * dashboard.js — Aggregated data routes for management dashboards.
 *
 * GET /api/dashboard/campaign-performance
 *   Fetches campaign performance, daily trend, search terms, budget pacing,
 *   and impression share in one parallel request for the chart dashboard.
 *
 * GET /api/dashboard/roi-analysis
 *   Fetches Google Ads daily spend + WordPress final_value revenue in parallel,
 *   aggregates by month, and returns ROAS vs industry benchmark vs target.
 *
 *   Query params (both endpoints):
 *     days      — lookback days (default 90)
 *     startDate — YYYY-MM-DD (overrides days)
 *     endDate   — YYYY-MM-DD (overrides days)
 */

const express      = require('express');
const { requireAuth }       = require('../middleware/requireAuth');
const { googleAdsService }  = require('../services/GoogleAdsService');
const MCPRegistry           = require('../platform/mcpRegistry');

const router = express.Router();

// ── Constants ─────────────────────────────────────────────────────────────────

const MGMT_FEE_PER_MONTH     = 1500;   // AUD — campaign management fee
const INDUSTRY_ROAS_BENCHMARK = 3.5;   // Car Detailing AU Google Ads industry average
const REVENUE_TARGET          = 50000; // AUD per month

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveDateRange(days, startDate, endDate) {
  if (startDate && endDate) return { startDate, endDate };
  const end   = new Date();
  const start = new Date();
  start.setDate(start.getDate() - (parseInt(days, 10) || 90));
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate:   end.toISOString().slice(0, 10),
  };
}

/** Find, auto-connect, and call wp_get_enquiry_details via MCPRegistry.
 *  Returns array of enquiry rows, or null if WordPress MCP not configured/reachable. */
async function fetchWordpressEnquiries(orgId, startDate, endDate) {
  try {
    const servers = await MCPRegistry.list(orgId);
    const wp = servers.find((s) =>
      (s.config?.args ?? []).some((a) => String(a).includes('wordpress'))
    );
    if (!wp) return null;
    if (wp.connection_status !== 'connected') await MCPRegistry.connect(orgId, wp.id);
    const result = await MCPRegistry.send(orgId, wp.id, 'tools/call', {
      name:      'wp_get_enquiry_details',
      arguments: { start_date: startDate, end_date: endDate, limit: 3000 },
    });
    const raw = result?.content?.[0]?.text;
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) {
    console.error('[dashboard/roi-analysis] WordPress fetch failed:', e.message);
    return null;
  }
}

/** Parse a monetary string like "990.00", "$1,200", "1200" to a float. */
function parseMonetary(v) {
  if (v == null || v === '') return 0;
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ''));
  return isNaN(n) ? 0 : n;
}

/** Pro-rate $1,500/mo management fee to the days of `yearMonth` covered by [rangeStart, rangeEnd]. */
function calcMgmtFee(yearMonth, rangeStart, rangeEnd) {
  const [y, m] = yearMonth.split('-').map(Number);
  const mFirst  = new Date(y, m - 1, 1);
  const mLast   = new Date(y, m, 0);          // last day of month
  const rFirst  = new Date(rangeStart);
  const rLast   = new Date(rangeEnd);
  const effFrom = mFirst > rFirst ? mFirst : rFirst;
  const effTo   = mLast  < rLast  ? mLast  : rLast;
  const covered = Math.max(0, Math.round((effTo - effFrom) / 86400000) + 1);
  const total   = Math.round((mLast - mFirst) / 86400000) + 1;
  return (covered / total) * MGMT_FEE_PER_MONTH;
}

// ── GET /campaign-performance ─────────────────────────────────────────────────

router.get('/campaign-performance', requireAuth, async (req, res) => {
  try {
    const { days = '90', startDate, endDate } = req.query;
    const options =
      startDate && endDate
        ? { startDate, endDate }
        : parseInt(days, 10) || 90;

    const [campaigns, dailyPerformance, searchTerms, budgetPacing, impressionShare] =
      await Promise.all([
        googleAdsService.getCampaignPerformance(options),
        googleAdsService.getDailyPerformance(options),
        googleAdsService.getSearchTerms(options),
        googleAdsService.getBudgetPacing(),
        googleAdsService.getImpressionShareByCampaign(options),
      ]);

    res.json({ campaigns, dailyPerformance, searchTerms, budgetPacing, impressionShare });
  } catch (err) {
    console.error('[dashboard/campaign-performance]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /roi-analysis ─────────────────────────────────────────────────────────

router.get('/roi-analysis', requireAuth, async (req, res) => {
  try {
    const { days = '90', startDate: qStart, endDate: qEnd } = req.query;
    const { startDate, endDate } = resolveDateRange(days, qStart, qEnd);
    const options = { startDate, endDate };

    // Parallel: Google Ads daily spend + WordPress final_value enquiries
    const [daily, enquiries] = await Promise.all([
      googleAdsService.getDailyPerformance(options),
      fetchWordpressEnquiries(req.user.orgId, startDate, endDate),
    ]);

    // Aggregate ad spend by month (YYYY-MM)
    const spendByMonth = {};
    for (const row of daily) {
      const month = String(row.date ?? '').slice(0, 7);
      if (!month) continue;
      spendByMonth[month] = (spendByMonth[month] ?? 0) + (row.cost ?? 0);
    }

    // Aggregate revenue by month from final_value (enquiry submission date)
    const revenueByMonth = {};
    if (enquiries) {
      for (const row of enquiries) {
        const val = parseMonetary(row.final_value);
        if (val <= 0) continue;
        // row.date from MySQL: "YYYY-MM-DD HH:mm:ss" or ISO string
        const month = String(row.date ?? '').slice(0, 7);
        if (!month) continue;
        revenueByMonth[month] = (revenueByMonth[month] ?? 0) + val;
      }
    }

    // Build monthly series — only months that appear in ad spend data
    const months = Object.keys(spendByMonth).sort();
    const monthly = months.map((month) => {
      const adSpend        = Math.round(spendByMonth[month] ?? 0);
      const mgmtFee        = Math.round(calcMgmtFee(month, startDate, endDate));
      const totalCost      = adSpend + mgmtFee;
      const revenue        = Math.round(revenueByMonth[month] ?? 0);
      const roas           = totalCost > 0 && revenue > 0
        ? Math.round((revenue / totalCost) * 100) / 100
        : null;
      const industryRevenue = Math.round(totalCost * INDUSTRY_ROAS_BENCHMARK);
      return {
        month,
        adSpend,
        mgmtFee,
        totalCost,
        revenue,
        roas,
        targetRevenue:    REVENUE_TARGET,
        industryRevenue,
        industryRoas:     INDUSTRY_ROAS_BENCHMARK,
      };
    });

    // Period totals
    const tot = monthly.reduce(
      (a, m) => ({
        adSpend:   a.adSpend   + m.adSpend,
        mgmtFee:   a.mgmtFee   + m.mgmtFee,
        totalCost: a.totalCost + m.totalCost,
        revenue:   a.revenue   + m.revenue,
      }),
      { adSpend: 0, mgmtFee: 0, totalCost: 0, revenue: 0 }
    );
    const periodRoas   = tot.totalCost > 0 && tot.revenue > 0
      ? Math.round((tot.revenue / tot.totalCost) * 100) / 100
      : null;
    const netReturn    = tot.revenue - tot.totalCost;
    const revenueGap   = tot.revenue - (REVENUE_TARGET * months.length);

    res.json({
      monthly,
      totals: { ...tot, periodRoas, netReturn, revenueGap },
      meta: {
        startDate,
        endDate,
        months:               months.length,
        wordpressAvailable:   enquiries !== null,
        revenueTarget:        REVENUE_TARGET,
        industryRoas:         INDUSTRY_ROAS_BENCHMARK,
        mgmtFeePerMonth:      MGMT_FEE_PER_MONTH,
        industryBenchmarkSource:
          'Car Detailing / Auto Detailing AU — Google Ads industry average (WordStream, 3–5× ROAS). 3.5× used as conservative benchmark.',
        revenueNote:
          'Revenue = sum of final_value on clientenquiry records by enquiry submission date. ' +
          'Jobs invoiced after the period end will not appear in their enquiry month. ' +
          'Only records with a recorded final_value are included.',
      },
    });
  } catch (err) {
    console.error('[dashboard/roi-analysis]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
