'use strict';

/**
 * personalMemory.js — REST API for per-user personal memory.
 *
 * Any authenticated org member can capture, search, list, and delete their own thoughts.
 * Scoped strictly to req.user.orgId + req.user.id.
 *
 * Routes:
 *   POST   /api/personal-memory          — capture a thought
 *   GET    /api/personal-memory/search   — semantic search (?q=...)
 *   GET    /api/personal-memory          — list recent thoughts
 *   GET    /api/personal-memory/stats    — summary stats
 *   DELETE /api/personal-memory/:id      — delete one thought
 */

const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const PersonalMemoryService = require('../services/PersonalMemoryService');

const router = express.Router();
router.use(requireAuth);

router.post('/', async (req, res) => {
  try {
    const { orgId, id: userId } = req.user;
    const { content, metadata } = req.body ?? {};
    const result = await PersonalMemoryService.capture({ orgId, userId, content, metadata });
    res.status(result.created ? 201 : 200).json(result);
  } catch (err) {
    console.error('[personal-memory capture]', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.get('/search', async (req, res) => {
  try {
    const { orgId, id: userId } = req.user;
    const q = req.query.q ?? req.query.query;
    const limit = req.query.limit;
    const results = await PersonalMemoryService.search({ orgId, userId, query: q, limit });
    res.json({ results });
  } catch (err) {
    console.error('[personal-memory search]', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const { orgId, id: userId } = req.user;
    const stats = await PersonalMemoryService.stats({ orgId, userId });
    res.json(stats);
  } catch (err) {
    console.error('[personal-memory stats]', err.message);
    res.status(500).json({ error: 'Failed to load stats.' });
  }
});

router.get('/', async (req, res) => {
  try {
    const { orgId, id: userId } = req.user;
    const thoughts = await PersonalMemoryService.list({
      orgId,
      userId,
      limit:  req.query.limit,
      offset: req.query.offset,
    });
    res.json({ thoughts });
  } catch (err) {
    console.error('[personal-memory list]', err.message);
    res.status(500).json({ error: 'Failed to load thoughts.' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { orgId, id: userId } = req.user;
    const result = await PersonalMemoryService.remove({
      orgId,
      userId,
      id: req.params.id,
    });
    res.json(result);
  } catch (err) {
    console.error('[personal-memory delete]', err.message);
    const status = err.message === 'Thought not found.' ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
