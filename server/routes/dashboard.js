'use strict';

/**
 * dashboard.js — Aggregated data routes for management dashboards.
 *
 * GET /api/dashboard/campaign-performance
 *   Fetches campaign performance, daily trend, search terms, budget pacing,
 *   and impression share in one parallel request for the chart dashboard.
 *
 *   Query params:
 *     days      — lookback days (default 90)
 *     startDate — YYYY-MM-DD (overrides days)
 *     endDate   — YYYY-MM-DD (overrides days)
 */

const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { googleAdsService } = require('../services/GoogleAdsService');

const router = express.Router();

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

module.exports = router;
