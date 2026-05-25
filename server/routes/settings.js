/**
 * settings.js — user-facing settings routes (models tab).
 * Accessible to any authenticated user (requireAuth only, no admin gate).
 *
 * Sections:
 *   Models        GET/PUT /api/settings/models
 *   Default model GET/PUT /api/settings/default-model
 *   Fallback model GET/PUT /api/settings/fallback-model
 *   Model test    POST    /api/settings/models/:modelId/test
 *   Model status  GET     /api/settings/model-status
 */
const express = require('express');
const https   = require('https');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const AgentConfigService = require('../platform/AgentConfigService');

const router = express.Router();
router.use(requireAuth);

// ── Model defaults ──────────────────────────────────────────────────────────

const MODEL_DEFAULTS = AgentConfigService.normalizeModelList([
  {
    id: 'deepseek-chat', name: 'DeepSeek V3', tier: 'advanced', enabled: true,
    provider: 'deepseek',
    emoji: '🧠', label: 'Standard', tagline: 'Smart & cost-effective',
    desc: 'Default model for all agents — analysis, writing, and tool workloads.',
    inputPricePer1M: 0.27, outputPricePer1M: 1.10, contextWindow: 64000,
    capabilities: { tool_use: true, vision: false, long_context: false, json_reliable: true },
  },
  {
    id: 'deepseek-reasoner', name: 'DeepSeek R1', tier: 'premium', enabled: true,
    provider: 'deepseek',
    emoji: '🔬', label: 'Premium', tagline: 'Deep reasoning',
    desc: 'Best for complex multi-step reasoning tasks.',
    inputPricePer1M: 0.55, outputPricePer1M: 2.19, contextWindow: 64000,
    capabilities: { tool_use: true, vision: false, long_context: false, json_reliable: true },
  },
  {
    id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', tier: 'advanced', enabled: false,
    provider: 'anthropic',
    emoji: '🧠', label: 'Claude', tagline: 'Anthropic fallback',
    desc: 'Fallback option if DeepSeek is unavailable.',
    inputPricePer1M: 3.00, outputPricePer1M: 15.00, contextWindow: 200000,
  },
]);

// ── Models CRUD ─────────────────────────────────────────────────────────────

router.get('/models', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT value FROM system_settings WHERE org_id = $1 AND key = 'ai_models'`,
      [req.user.orgId]
    );
    res.json(r.rows.length > 0 ? AgentConfigService.normalizeModelList(r.rows[0]?.value) : MODEL_DEFAULTS);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load models.' });
  }
});

router.put('/models', async (req, res) => {
  const { models } = req.body;
  if (!Array.isArray(models)) return res.status(400).json({ error: 'models must be an array.' });
  const normalizedModels = AgentConfigService.normalizeModelList(models);
  try {
    await pool.query(
      `INSERT INTO system_settings (org_id, key, value, updated_by, updated_at)
       VALUES ($1, 'ai_models', $2, $3, NOW())
       ON CONFLICT (org_id, key) DO UPDATE SET value = $2, updated_by = $3, updated_at = NOW()`,
      [req.user.orgId, JSON.stringify(normalizedModels), req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update models.' });
  }
});

router.post('/models/reset', async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM system_settings WHERE org_id = $1 AND key = 'ai_models'`,
      [req.user.orgId]
    );
    res.json({ models: MODEL_DEFAULTS });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reset models.' });
  }
});

// ── Default model ───────────────────────────────────────────────────────────

router.get('/default-model', async (req, res) => {
  try {
    const modelId = await AgentConfigService.getOrgDefaultModel(req.user.orgId);
    res.json({ model_id: modelId });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load default model.' });
  }
});

router.put('/default-model', async (req, res) => {
  try {
    const modelId = req.body.model_id ?? null;
    await AgentConfigService.updateOrgDefaultModel(req.user.orgId, modelId, req.user.id);
    res.json({ model_id: modelId });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update default model.' });
  }
});

// ── Fallback model ──────────────────────────────────────────────────────────

router.get('/fallback-model', async (req, res) => {
  try {
    const modelId = await AgentConfigService.getOrgFallbackModel(req.user.orgId);
    res.json({ model_id: modelId });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load fallback model.' });
  }
});

router.put('/fallback-model', async (req, res) => {
  try {
    const modelId = req.body.model_id ?? null;
    await AgentConfigService.updateOrgFallbackModel(req.user.orgId, modelId, req.user.id);
    res.json({ model_id: modelId });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update fallback model.' });
  }
});

// ── Lesson AI model ─────────────────────────────────────────────────────────

router.get('/lesson-model', async (req, res) => {
  try {
    const modelId = await AgentConfigService.getOrgLessonModel(req.user.orgId);
    res.json({ model_id: modelId });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load lesson model.' });
  }
});

router.put('/lesson-model', async (req, res) => {
  try {
    const modelId = req.body.model_id ?? null;
    await AgentConfigService.updateOrgLessonModel(req.user.orgId, modelId, req.user.id);
    res.json({ model_id: modelId });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update lesson model.' });
  }
});


// ── Model test ──────────────────────────────────────────────────────────────

/** @private https.request wrapper returning { status, body } */
function httpsPost(hostname, path, reqHeaders, bodyObj) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(bodyObj);
    const req = https.request(
      { hostname, path, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(bodyStr), ...reqHeaders } },
      (resp) => {
        let data = '';
        resp.on('data', (c) => { data += c; });
        resp.on('end', () => {
          try { resolve({ status: resp.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: resp.statusCode, body: data }); }
        });
      }
    );
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

router.post('/models/:modelId/test', async (req, res) => {
  const { modelId } = req.params;
  const start = Date.now();
  const logger = require('../utils/logger');
  const { PROVIDERS, resolveProvider, getAdapterWithCustom } = require('../platform/providerRegistry');
  const { getCustomProviders } = require('../platform/AgentConfigService');

  const customProviders = await getCustomProviders(req.user.orgId).catch(() => []);

  // Find which env var is needed
  const lower = modelId.toLowerCase();
  let envVarNeeded = null;
  let foundInRegistry = false;

  for (const prov of Object.values(PROVIDERS)) {
    if (prov.modelPrefixes.some((pfx) => lower.startsWith(pfx.toLowerCase()))) {
      envVarNeeded = prov.envVar;
      foundInRegistry = true;
      break;
    }
  }

  if (!foundInRegistry) {
    // Check custom providers
    for (const cp of customProviders) {
      if (lower === cp.key.toLowerCase() || lower.startsWith(cp.key.toLowerCase() + '-')) {
        envVarNeeded = cp.apiKeyEnv;
        break;
      }
    }
    // Fallback: env var convention
    if (!envVarNeeded) {
      const dashIdx = modelId.indexOf('-');
      const prefix  = dashIdx > 0 ? modelId.slice(0, dashIdx).toUpperCase() : modelId.toUpperCase();
      envVarNeeded  = `${prefix}_API_KEY`;
    }
  }

  if (envVarNeeded && !process.env[envVarNeeded]) {
    const msg = `${envVarNeeded} is not set — add it to Railway env vars and redeploy.`;
    logger.error(`Model test failed: ${modelId}`, { model: modelId, reason: msg, user: req.user.email });
    return res.status(500).json({ ok: false, error: msg });
  }

  try {
    const adapter = getAdapterWithCustom(modelId, customProviders);
    await adapter.chat({
      model:      modelId,
      max_tokens: 10,
      system:     null,
      messages:   [{ role: 'user', content: 'Reply with the single word: ok' }],
      tools:      undefined,
    });
    logger.info(`Model test passed: ${modelId}`, { model: modelId, latencyMs: Date.now() - start });
    return res.json({ ok: true, latencyMs: Date.now() - start });
  } catch (err) {
    logger.error(`Model test failed: ${modelId}`, { model: modelId, error: err.message, user: req.user.email });
    return res.json({ ok: false, error: err.message, latencyMs: Date.now() - start });
  }
});

// ── Model / provider status ─────────────────────────────────────────────────

router.get('/model-status', async (req, res) => {
  const { PROVIDERS } = require('../platform/providerRegistry');
  const { getCustomProviders } = require('../platform/AgentConfigService');

  const status = {};
  for (const [key, prov] of Object.entries(PROVIDERS)) {
    status[key] = { label: prov.label, configured: !!process.env[prov.envVar] };
  }

  try {
    const customs = await getCustomProviders(req.user.orgId);
    for (const cp of customs) {
      if (cp.builtin) {
        if (cp.hidden) {
          delete status[cp.key];
        } else if (status[cp.key]) {
          if (cp.label)     status[cp.key].label = cp.label;
          if (cp.apiKeyEnv) status[cp.key].configured = !!process.env[cp.apiKeyEnv];
        }
      } else {
        if (!status[cp.key]) {
          status[cp.key] = {
            label:      cp.label || cp.key,
            configured: !!process.env[cp.apiKeyEnv],
            custom:     true,
          };
        }
      }
    }
  } catch { /* non-fatal */ }

  res.json(status);
});

module.exports = router;
