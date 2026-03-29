'use strict';

/**
 * Google Ads customer/campaign management routes.
 *
 * Mounted at /api/google-ads in index.js.
 *
 * GET    /api/google-ads/customers                          — list registered customers
 * POST   /api/google-ads/customers                          — register a customer
 * PUT    /api/google-ads/customers/:customerId              — update customer name/active flag
 * DELETE /api/google-ads/customers/:customerId              — deactivate (soft delete)
 * GET    /api/google-ads/customers/:customerId/campaigns    — list campaigns for a customer
 * GET    /api/google-ads/campaign-assignments               — list all agent-campaign assignments
 * POST   /api/google-ads/campaign-assignments               — assign an agent to a campaign
 * DELETE /api/google-ads/campaign-assignments/:id           — remove an assignment
 */

const express      = require('express');
const { pool }     = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { requireRole } = require('../middleware/requireRole');
const { googleAdsService } = require('../services/GoogleAdsService');

const router = express.Router();

// ── Customers ─────────────────────────────────────────────────────────────

router.get('/customers', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, customer_id, customer_name, is_active, created_at
         FROM google_ads_customers
        WHERE org_id = $1
        ORDER BY customer_name`,
      [req.user.orgId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[googleAds customers GET]', err.message);
    res.status(500).json({ error: 'Failed to load customers.' });
  }
});

router.post('/customers', requireAuth, requireRole(['org_admin']), async (req, res) => {
  try {
    const { customer_id, customer_name } = req.body;
    if (!customer_id || !customer_name) {
      return res.status(400).json({ error: 'customer_id and customer_name are required.' });
    }
    const result = await pool.query(
      `INSERT INTO google_ads_customers (org_id, customer_id, customer_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (org_id, customer_id) DO UPDATE
         SET customer_name = EXCLUDED.customer_name, is_active = TRUE
       RETURNING *`,
      [req.user.orgId, customer_id, customer_name]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[googleAds customers POST]', err.message);
    res.status(500).json({ error: 'Failed to register customer.' });
  }
});

router.put('/customers/:customerId', requireAuth, requireRole(['org_admin']), async (req, res) => {
  try {
    const { customer_name, is_active } = req.body;
    const result = await pool.query(
      `UPDATE google_ads_customers
          SET customer_name = COALESCE($1, customer_name),
              is_active     = COALESCE($2, is_active)
        WHERE org_id = $3 AND customer_id = $4
        RETURNING *`,
      [customer_name ?? null, is_active ?? null, req.user.orgId, req.params.customerId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Customer not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[googleAds customers PUT]', err.message);
    res.status(500).json({ error: 'Failed to update customer.' });
  }
});

router.delete('/customers/:customerId', requireAuth, requireRole(['org_admin']), async (req, res) => {
  try {
    await pool.query(
      `UPDATE google_ads_customers SET is_active = FALSE
        WHERE org_id = $1 AND customer_id = $2`,
      [req.user.orgId, req.params.customerId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[googleAds customers DELETE]', err.message);
    res.status(500).json({ error: 'Failed to deactivate customer.' });
  }
});

// ── Campaigns (live from Google Ads API) ──────────────────────────────────

router.get('/customers/:customerId/campaigns', requireAuth, async (req, res) => {
  try {
    const campaigns = await googleAdsService.getCampaignPerformance(30, req.params.customerId);
    res.json(campaigns);
  } catch (err) {
    console.error('[googleAds campaigns GET]', err.message);
    res.status(500).json({ error: 'Failed to load campaigns: ' + err.message });
  }
});

// ── Campaign agent assignments ─────────────────────────────────────────────

router.get('/campaign-assignments', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, customer_id, campaign_id, campaign_name, agent_slug, config, is_active, created_at
         FROM campaign_agent_assignments
        WHERE org_id = $1
        ORDER BY customer_id, campaign_name`,
      [req.user.orgId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[googleAds campaign-assignments GET]', err.message);
    res.status(500).json({ error: 'Failed to load assignments.' });
  }
});

router.post('/campaign-assignments', requireAuth, requireRole(['org_admin']), async (req, res) => {
  try {
    const { customer_id, campaign_id, campaign_name, agent_slug, config } = req.body;
    if (!customer_id || !campaign_id || !agent_slug) {
      return res.status(400).json({ error: 'customer_id, campaign_id, and agent_slug are required.' });
    }
    const result = await pool.query(
      `INSERT INTO campaign_agent_assignments
         (org_id, customer_id, campaign_id, campaign_name, agent_slug, config)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (org_id, customer_id, campaign_id, agent_slug) DO UPDATE
         SET campaign_name = EXCLUDED.campaign_name,
             config        = EXCLUDED.config,
             is_active     = TRUE
       RETURNING *`,
      [req.user.orgId, customer_id, campaign_id, campaign_name ?? null, agent_slug, JSON.stringify(config ?? {})]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[googleAds campaign-assignments POST]', err.message);
    res.status(500).json({ error: 'Failed to create assignment.' });
  }
});

router.delete('/campaign-assignments/:id', requireAuth, requireRole(['org_admin']), async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM campaign_agent_assignments WHERE id = $1 AND org_id = $2`,
      [req.params.id, req.user.orgId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[googleAds campaign-assignments DELETE]', err.message);
    res.status(500).json({ error: 'Failed to delete assignment.' });
  }
});

module.exports = router;
