'use strict';

/**
 * Lessons & Rules Repository routes.
 *
 * Runtime/propose endpoints are authenticated and org-scoped. Management
 * endpoints are org_admin only and use LessonRepositoryService for validation,
 * audit appends, soft-delete, and global organisation permission checks.
 */
const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { requireRole } = require('../middleware/requireRole');
const AgentConfigService = require('../platform/AgentConfigService');
const Lessons = require('../services/LessonRepositoryService');

const router = express.Router();

// GET /api/lessons/runtime/:agentId — formatted prompt block for this user org.
router.get('/runtime/:agentId', requireAuth, async (req, res) => {
  try {
    const text = await Lessons.loadLessonsForAgent(req.params.agentId, req.user.orgId);
    res.json({ agent_id: req.params.agentId, organisation_id: req.user.orgId, text });
  } catch (err) {
    console.error('[lessons runtime]', err.message);
    res.status(500).json({ error: 'Failed to load runtime lessons.' });
  }
});

// POST /api/lessons/propose — agent write-back. Stored under-review only.
router.post('/propose', requireAuth, async (req, res) => {
  try {
    const { agent_id, agentId, category, title, content } = req.body;
    const lessonId = await Lessons.proposeLesson(agent_id ?? agentId, req.user.orgId, category, title, content);
    res.json({ lessonId, status: 'under-review' });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to propose lesson.' });
  }
});

router.use(requireAuth, requireRole(['org_admin']));

router.get('/meta', async (req, res) => {
  try {
    const agentSlugs = [
      ...new Set([
        ...Object.keys(AgentConfigService.ADMIN_DEFAULTS).filter((s) => s !== '_platform'),
        ...Object.keys(AgentConfigService.AGENT_MODEL_REQUIREMENTS),
      ]),
    ].sort();

    const orgQuery = Lessons.isSuperAdmin(req.user)
      ? `SELECT id, name, org_type FROM organizations ORDER BY name ASC`
      : `SELECT id, name, org_type FROM organizations WHERE id = $1 ORDER BY name ASC`;
    const orgParams = Lessons.isSuperAdmin(req.user) ? [] : [req.user.orgId];
    const [{ rows: orgs }, categories] = await Promise.all([
      pool.query(orgQuery, orgParams),
      Lessons.listCategories(req.user),
    ]);

    res.json({
      agents: [{ slug: Lessons.ALL, label: 'All Agents' }, ...agentSlugs.map((slug) => ({ slug, label: slug }))],
      organisations: [
        ...(Lessons.isSuperAdmin(req.user) ? [{ id: Lessons.ALL, name: 'All Organisations', org_type: 'global' }] : []),
        ...orgs,
      ],
      categories,
      canUseGlobalOrganisation: Lessons.isSuperAdmin(req.user),
    });
  } catch (err) {
    console.error('[lessons meta]', err.message);
    res.status(500).json({ error: 'Failed to load lessons metadata.' });
  }
});

router.get('/', async (req, res) => {
  try {
    const result = await Lessons.listLessons(req.user, req.query);
    res.json(result);
  } catch (err) {
    console.error('[lessons list]', err.message);
    res.status(500).json({ error: 'Failed to load lessons.' });
  }
});

router.post('/', async (req, res) => {
  try {
    const result = await Lessons.createLesson(req.body, req.user);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to create lesson.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const lesson = await Lessons.getLesson(req.params.id, req.user);
    if (!lesson) return res.status(404).json({ error: 'Lesson not found.' });
    res.json(lesson);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load lesson.' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const lesson = await Lessons.updateLesson(req.params.id, req.body, req.user);
    if (!lesson) return res.status(404).json({ error: 'Lesson not found.' });
    res.json(lesson);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to update lesson.' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const ok = await Lessons.deleteLesson(req.params.id, req.user, req.body?.reason);
    if (!ok) return res.status(404).json({ error: 'Lesson not found.' });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to delete lesson.' });
  }
});

module.exports = router;
