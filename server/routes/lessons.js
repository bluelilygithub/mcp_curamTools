'use strict';

/**
 * Lessons & Rules Repository routes.
 *
 * Runtime/propose endpoints are authenticated and org-scoped. Management
 * endpoints require the lessons:manage capability and use LessonRepositoryService for validation,
 * audit appends, soft-delete, and global organisation permission checks.
 */
const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { requirePermission } = require('../middleware/requirePermission');
const AgentConfigService = require('../platform/AgentConfigService');
const { getProvider } = require('../platform/AgentOrchestrator');
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

router.use(requireAuth, requirePermission('lessons:manage'));

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

router.post('/:id/comments', async (req, res) => {
  try {
    const lesson = await Lessons.addLessonComment(req.params.id, req.body, req.user);
    if (!lesson) return res.status(404).json({ error: 'Lesson not found.' });
    res.json(lesson);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to add comment.' });
  }
});

// POST /api/lessons/:id/revise — AI-powered lesson content revision.
// Takes a human prompt, calls the lesson AI model, returns revised content.
router.post('/:id/revise', async (req, res) => {
  try {
    const lesson = await Lessons.getLesson(req.params.id, req.user);
    if (!lesson) return res.status(404).json({ error: 'Lesson not found.' });

    const prompt = String(req.body.prompt ?? '').trim();
    if (!prompt) return res.status(400).json({ error: 'Revision prompt is required.' });

    // Resolve the lesson AI model
    const modelId = await AgentConfigService.getOrgLessonModel(req.user.orgId);
    if (!modelId) return res.status(400).json({ error: 'No lesson AI model configured. Set one in Settings > Models.' });

    const customProviders = await AgentConfigService.getCustomProviders(req.user.orgId).catch(() => []);
    const provider = getProvider(modelId, customProviders);

    const systemPrompt = 'You are a lesson refinement assistant. Your role is to revise lesson content based on the reviewer\'s instructions. Preserve the core learning, improve clarity, and incorporate the reviewer\'s guidance. Return only the revised lesson content — no commentary, no markdown fences.';

    const userMessage = [
      'Current lesson content:',
      lesson.content,
      '',
      'Reviewer instructions:',
      prompt,
      '',
      'Return the complete revised lesson content only.',
    ].join('\n');

    const response = await provider.chat({
      model: modelId,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const revisedContent = response?.content?.map((b) => b.text).filter(Boolean).join('').trim();
    if (!revisedContent) return res.status(500).json({ error: 'AI returned empty content.' });

    // Preview only — caller decides whether to persist via PATCH
    res.json({ revised_content: revisedContent });
  } catch (err) {
    console.error('[lessons revise]', err.message);
    res.status(500).json({ error: err.message || 'Failed to revise lesson.' });
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
