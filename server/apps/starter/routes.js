'use strict';

/**
 * Starter app API — minimal authenticated route on core auth.
 *
 * GET /api/starter/health
 */

const express = require('express');
const { requireAuth } = require('../../middleware/requireAuth');

const router = express.Router();

router.get('/health', requireAuth, (req, res) => {
  res.json({
    ok: true,
    app: 'starter',
    orgId: req.user.orgId,
    orgType: req.user.orgType,
  });
});

module.exports = router;
