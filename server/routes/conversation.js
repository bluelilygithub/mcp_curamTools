'use strict';

/**
 * conversation.js — persistent multi-turn AI conversation for Google Ads.
 *
 * Conversations are stored in agent_conversations (JSONB messages array).
 * Each turn: load history → run ReAct loop with full tool suite → append response.
 *
 * Routes (all require auth):
 *   GET    /api/conversation             — list conversations for org
 *   POST   /api/conversation             — create new conversation
 *   GET    /api/conversation/:id         — get conversation with messages
 *   DELETE /api/conversation/:id         — delete conversation
 *   PUT    /api/conversation/:id/title   — rename conversation
 *   POST   /api/conversation/:id/message — send message (SSE stream)
 */

const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { createRateLimiter } = require('../middleware/rateLimiter');
const { agentOrchestrator } = require('../platform/AgentOrchestrator');
const AgentConfigService = require('../platform/AgentConfigService');
const CostGuardService = require('../services/CostGuardService');
const { logUsage } = require('../services/UsageLogger');
const { googleAdsConversationTools, TOOL_SLUG } = require('../agents/googleAdsConversation/tools');
const { buildSystemPrompt } = require('../agents/googleAdsConversation/prompt');

const router = express.Router();

// 20 messages per user per minute — prevents runaway LLM spend
const messageRateLimiter = createRateLimiter({ windowMs: 60_000, max: 20 });

// ── Context window management ─────────────────────────────────────────────────

const MAX_HISTORY_MESSAGES = 40; // ~20 turns before trimming
const TRIM_TO              = 36; // keep last 18 turns when over limit

/**
 * Trim conversation history to prevent context window overflow.
 * Always starts on a 'user' turn so the history remains well-formed.
 * Stored messages include text-only assistant replies (not tool call blocks),
 * so each message is small — but long threads accumulate fast.
 */
function trimHistory(history) {
  if (history.length <= MAX_HISTORY_MESSAGES) return history;
  const trimmed  = history.slice(-TRIM_TO);
  const firstUser = trimmed.findIndex((m) => m.role === 'user');
  return firstUser > 0 ? trimmed.slice(firstUser) : trimmed;
}

// ── List conversations ────────────────────────────────────────────────────────

router.get('/', requireAuth, async (req, res) => {
  try {
    const { orgId } = req.user;
    const result = await pool.query(
      `SELECT id, title, slug, created_at, updated_at,
              jsonb_array_length(messages) AS message_count
         FROM agent_conversations
        WHERE org_id = $1
        ORDER BY updated_at DESC
        LIMIT 50`,
      [orgId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[conversation list]', err.message);
    res.status(500).json({ error: 'Failed to load conversations.' });
  }
});

// ── Create conversation ───────────────────────────────────────────────────────

router.post('/', requireAuth, async (req, res) => {
  try {
    const { orgId } = req.user;
    const title = req.body.title ?? 'New conversation';
    const result = await pool.query(
      `INSERT INTO agent_conversations (org_id, slug, title, messages)
       VALUES ($1, $2, $3, '[]'::jsonb)
       RETURNING id, title, slug, created_at, updated_at`,
      [orgId, TOOL_SLUG, title]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[conversation create]', err.message);
    res.status(500).json({ error: 'Failed to create conversation.' });
  }
});

// ── Get conversation ──────────────────────────────────────────────────────────

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { orgId } = req.user;
    const result = await pool.query(
      `SELECT id, title, slug, messages, created_at, updated_at
         FROM agent_conversations
        WHERE id = $1 AND org_id = $2`,
      [req.params.id, orgId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Conversation not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[conversation get]', err.message);
    res.status(500).json({ error: 'Failed to load conversation.' });
  }
});

// ── Rename conversation ───────────────────────────────────────────────────────

router.put('/:id/title', requireAuth, async (req, res) => {
  try {
    const { orgId } = req.user;
    const { title } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Title is required.' });
    const result = await pool.query(
      `UPDATE agent_conversations SET title = $1, updated_at = NOW()
        WHERE id = $2 AND org_id = $3 RETURNING id, title`,
      [title.trim(), req.params.id, orgId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Conversation not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[conversation rename]', err.message);
    res.status(500).json({ error: 'Failed to rename conversation.' });
  }
});

// ── Delete conversation ───────────────────────────────────────────────────────

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { orgId } = req.user;
    await pool.query(
      `DELETE FROM agent_conversations WHERE id = $1 AND org_id = $2`,
      [req.params.id, orgId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[conversation delete]', err.message);
    res.status(500).json({ error: 'Failed to delete conversation.' });
  }
});

// ── Send message (SSE) ────────────────────────────────────────────────────────

router.post('/:id/message', requireAuth, messageRateLimiter, async (req, res) => {
  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const emit = (type, payload) => res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
  const done = () => { res.write('data: [DONE]\n\n'); res.end(); };

  const { orgId, id: userId } = req.user;
  const { message, startDate, endDate } = req.body;

  if (!message?.trim()) {
    emit('error', { error: 'Message is required.' });
    return done();
  }

  try {
    // Load conversation + history
    const convResult = await pool.query(
      `SELECT id, messages FROM agent_conversations WHERE id = $1 AND org_id = $2`,
      [req.params.id, orgId]
    );
    if (convResult.rows.length === 0) {
      emit('error', { error: 'Conversation not found.' });
      return done();
    }

    const conversation = convResult.rows[0];
    // Stored messages: [{ role, content }] — text-only, suitable for Anthropic multi-turn
    const history = trimHistory(conversation.messages ?? []);

    // Load agent admin config for model / token limits
    let adminConfig;
    try {
      adminConfig = await AgentConfigService.getAdminConfig(TOOL_SLUG);
    } catch {
      adminConfig = {};
    }

    if (adminConfig.enabled === false) {
      emit('error', { error: 'Conversation agent is currently disabled by an administrator.' });
      return done();
    }

    // Budget guard
    const maxTaskBudgetAud = adminConfig.max_task_budget_aud ?? null;
    let maxDailyBudgetAud = null;
    let dailyOrgSpendAud = 0;
    try {
      const orgBudget = await AgentConfigService.getOrgBudgetSettings(orgId);
      maxDailyBudgetAud = orgBudget.max_daily_org_budget_aud ?? null;
      if (maxDailyBudgetAud != null) {
        dailyOrgSpendAud = await CostGuardService.getDailyOrgSpendAud(orgId);
        CostGuardService.check({ taskCostAud: 0, maxTaskBudgetAud: null, dailyOrgSpendAud, maxDailyBudgetAud });
      }
    } catch (budgetErr) {
      if (budgetErr.name === 'BudgetExceededError') {
        emit('error', { error: budgetErr.message });
        return done();
      }
    }

    let taskCostAud = 0;

    emit('progress', { text: 'Thinking…' });

    const context = {
      orgId,
      userId,
      startDate: startDate ?? null,
      endDate:   endDate   ?? null,
      toolSlug:  TOOL_SLUG,
      req,
    };

    const { result, trace, iterations, tokensUsed } = await agentOrchestrator.run({
      systemPrompt:        buildSystemPrompt(await AgentConfigService.getAgentConfig(orgId, TOOL_SLUG).catch(() => ({}))),
      userMessage:         message.trim(),
      conversationHistory: history,
      tools:               googleAdsConversationTools,
      model:               adminConfig.model          ?? 'claude-sonnet-4-6',
      maxTokens:           adminConfig.max_tokens     ?? 8192,
      maxIterations:       adminConfig.max_iterations ?? 10,
      context,
      onStep: (text, partialTokens) => {
        emit('progress', { text });
        if (partialTokens) {
          taskCostAud += CostGuardService.computeCostAud(partialTokens);
          try { CostGuardService.check({ taskCostAud, maxTaskBudgetAud, dailyOrgSpendAud, maxDailyBudgetAud }); }
          catch (e) { emit('error', { error: e.message }); }
        }
      },
    });

    if (tokensUsed) {
      const finalCost = CostGuardService.computeCostAud(tokensUsed);
      taskCostAud = Math.max(taskCostAud, finalCost);
    }

    const assistantText = result?.summary ?? '';

    // Log tool calls for audit trail
    const toolCallNames = (trace ?? []).flatMap((step) => (step.toolCalls ?? []).map((tc) => tc.name));
    if (toolCallNames.length > 0) {
      console.log('[conversation:tools]', JSON.stringify({
        convId: req.params.id, orgId, iterations, tools: toolCallNames,
      }));
    }

    // Append user message + assistant response to stored history
    const assistantEntry = { role: 'assistant', content: assistantText };
    if (toolCallNames.length > 0) assistantEntry.toolCalls = toolCallNames;

    const updatedMessages = [
      ...history,
      { role: 'user', content: message.trim() },
      assistantEntry,
    ];

    // Auto-title from first user message if still default
    const isDefaultTitle = conversation.title == null || conversation.title === 'New conversation';
    const newTitle = isDefaultTitle
      ? message.trim().slice(0, 60) + (message.trim().length > 60 ? '…' : '')
      : undefined;

    await pool.query(
      `UPDATE agent_conversations
          SET messages   = $1::jsonb,
              updated_at = NOW()
              ${newTitle ? ', title = $3' : ''}
        WHERE id = $2`,
      newTitle
        ? [JSON.stringify(updatedMessages), req.params.id, newTitle]
        : [JSON.stringify(updatedMessages), req.params.id]
    );

    logUsage({ orgId, userId, slug: TOOL_SLUG, modelId: adminConfig.model, tokensUsed: tokensUsed ?? {}, costAud: taskCostAud })
      .catch((e) => console.error('[conversation usage log]', e.message));

    emit('result', {
      message:    assistantText,
      title:      newTitle,
      costAud:    taskCostAud,
      tokensUsed: tokensUsed ?? {},
    });

  } catch (err) {
    console.error('[conversation message]', err.message);
    emit('error', { error: err.message });
  }

  done();
});

module.exports = router;
