/**
 * admin.js — admin-only routes.
 * All routes require requireAuth + requireRole(['org_admin']).
 *
 * Sections:
 *   Users         GET/POST/PUT/DELETE /api/admin/users
 *   Invite        POST /api/admin/users/invite
 *   Models        GET/PUT /api/admin/models
 *   Agents        GET/PUT /api/admin/agents/:slug  (admin guardrails)
 *   App Settings  GET/PUT /api/admin/settings
 *   Email Tpl     GET/PUT /api/admin/email-templates/:slug
 *   Security      GET/PUT /api/admin/security
 *   Logs          GET     /api/admin/logs
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const https   = require('https');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { requireRole } = require('../middleware/requireRole');
const { grantRole, revokeRole, getUserRoles } = require('../services/PermissionService');
const { createInvitation, resendInvitation } = require('../services/InvitationService');
const AgentConfigService = require('../platform/AgentConfigService');
const EmailTemplateService = require('../services/EmailTemplateService');

const router = express.Router();
router.use(requireAuth, requireRole(['org_admin']));

// ── Users ─────────────────────────────────────────────────────────────────

router.get('/users', async (req, res) => {
  try {
    const res2 = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.phone, u.is_active, u.created_at,
              u.default_model_id,
              array_agg(DISTINCT r.role_name) FILTER (WHERE r.role_name IS NOT NULL) AS roles,
              array_agg(DISTINCT d.name)      FILTER (WHERE d.id       IS NOT NULL) AS department_names
         FROM users u
         LEFT JOIN user_roles r       ON r.user_id       = u.id
         LEFT JOIN user_departments ud ON ud.user_id      = u.id
         LEFT JOIN departments d       ON d.id            = ud.department_id
        WHERE u.org_id = $1
        GROUP BY u.id
        ORDER BY u.created_at DESC`,
      [req.user.orgId]
    );
    res.json(res2.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load users.' });
  }
});

router.post('/users/invite', async (req, res) => {
  try {
    const { email, role = 'org_member' } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required.' });
    const result = await createInvitation(email, req.user.orgId, role, req.user.id);
    res.json({ email: result.email, activationUrl: result.activationUrl, expiresAt: result.expiresAt });
  } catch (err) {
    console.error('[admin/invite]', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.post('/users/:id/resend-invite', async (req, res) => {
  try {
    const result = await resendInvitation(parseInt(req.params.id), req.user.id);
    res.json({ email: result.email, activationUrl: result.activationUrl, expiresAt: result.expiresAt });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/users/:id', async (req, res) => {
  const { firstName, lastName, phone, isActive, role, defaultModelId } = req.body;
  const userId = parseInt(req.params.id);
  try {
    await pool.query(
      `UPDATE users SET first_name = $1, last_name = $2, phone = $3, is_active = $4, default_model_id = $5 WHERE id = $6`,
      [firstName, lastName, phone, isActive, defaultModelId ?? null, userId]
    );
    if (role) {
      await pool.query(`DELETE FROM user_roles WHERE user_id = $1 AND scope_type = 'global'`, [userId]);
      await grantRole(userId, role, { scopeType: 'global', scopeId: null }, req.user.id);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update user.' });
  }
});

router.delete('/users/:id', async (req, res) => {
  const userId = parseInt(req.params.id);
  if (userId === req.user.id) {
    return res.status(400).json({ error: 'You cannot delete your own account.' });
  }
  try {
    await pool.query('DELETE FROM users WHERE id = $1 AND org_id = $2', [userId, req.user.orgId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete user.' });
  }
});

router.get('/users/:id/roles', async (req, res) => {
  try {
    const roles = await getUserRoles(parseInt(req.params.id));
    res.json(roles);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load user roles.' });
  }
});

router.post('/users/:id/grant-role', async (req, res) => {
  const userId = parseInt(req.params.id);
  if (userId === req.user.id) {
    return res.status(400).json({ error: 'You cannot change your own role.' });
  }
  const { roleName, scopeType = 'global' } = req.body;
  if (!roleName) return res.status(400).json({ error: 'roleName is required.' });
  // Verify target user belongs to this org
  const check = await pool.query('SELECT id FROM users WHERE id = $1 AND org_id = $2', [userId, req.user.orgId]);
  if (!check.rows.length) return res.status(404).json({ error: 'User not found.' });
  try {
    await grantRole(userId, roleName, { scopeType, scopeId: null }, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to grant role.' });
  }
});

router.post('/users/:id/revoke-role', async (req, res) => {
  const userId = parseInt(req.params.id);
  if (userId === req.user.id) {
    return res.status(400).json({ error: 'You cannot change your own role.' });
  }
  const { roleName, scopeType = 'global' } = req.body;
  if (!roleName) return res.status(400).json({ error: 'roleName is required.' });
  const check = await pool.query('SELECT id FROM users WHERE id = $1 AND org_id = $2', [userId, req.user.orgId]);
  if (!check.rows.length) return res.status(404).json({ error: 'User not found.' });
  try {
    await revokeRole(userId, roleName, { scopeType, scopeId: null });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to revoke role.' });
  }
});

// ── User departments ──────────────────────────────────────────────────────

router.get('/users/:id/departments', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT d.id, d.name, d.description, d.color
         FROM user_departments ud
         JOIN departments d ON d.id = ud.department_id
        WHERE ud.user_id = $1`,
      [parseInt(req.params.id)]
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load user departments.' });
  }
});

router.put('/users/:id/departments', async (req, res) => {
  const userId = parseInt(req.params.id);
  const { departmentIds = [] } = req.body;
  try {
    await pool.query('DELETE FROM user_departments WHERE user_id = $1', [userId]);
    if (departmentIds.length > 0) {
      const values = departmentIds.map((id, i) => `($1, $${i + 2})`).join(', ');
      await pool.query(
        `INSERT INTO user_departments (user_id, department_id) VALUES ${values}`,
        [userId, ...departmentIds]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update user departments.' });
  }
});

// ── User org-roles ────────────────────────────────────────────────────────

router.get('/users/:id/org-roles', async (req, res) => {
  try {
    // Return only roles that exist in org_roles (custom roles, not system roles)
    const r = await pool.query(
      `SELECT ur.role_name
         FROM user_roles ur
         JOIN org_roles rl ON rl.name = ur.role_name AND rl.org_id = $2
        WHERE ur.user_id = $1 AND ur.scope_type = 'global'`,
      [parseInt(req.params.id), req.user.orgId]
    );
    res.json(r.rows.map(row => row.role_name));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load user org-roles.' });
  }
});

router.put('/users/:id/org-roles', async (req, res) => {
  const userId = parseInt(req.params.id);
  const { roleNames = [] } = req.body;
  try {
    // Get all valid org role names for this org
    const validRoles = await pool.query(
      'SELECT name FROM org_roles WHERE org_id = $1', [req.user.orgId]
    );
    const validNames = validRoles.rows.map(r => r.name);
    // Remove existing custom role assignments
    if (validNames.length > 0) {
      await pool.query(
        `DELETE FROM user_roles WHERE user_id = $1 AND scope_type = 'global' AND role_name = ANY($2)`,
        [userId, validNames]
      );
    }
    // Grant selected roles
    for (const name of roleNames.filter(n => validNames.includes(n))) {
      await grantRole(userId, name, { scopeType: 'global', scopeId: null }, req.user.id);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update user org-roles.' });
  }
});

// ── Departments CRUD ──────────────────────────────────────────────────────

router.get('/departments', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT d.id, d.name, d.description, d.color, d.created_at,
              COUNT(ud.user_id)::int AS member_count
         FROM departments d
         LEFT JOIN user_departments ud ON ud.department_id = d.id
        WHERE d.org_id = $1
        GROUP BY d.id
        ORDER BY d.name`,
      [req.user.orgId]
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load departments.' });
  }
});

router.post('/departments', async (req, res) => {
  const { name, description = '', color = '#6366f1' } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required.' });
  try {
    const r = await pool.query(
      `INSERT INTO departments (org_id, name, description, color)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.orgId, name.trim(), description, color]
    );
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A department with that name already exists.' });
    res.status(500).json({ error: 'Failed to create department.' });
  }
});

router.put('/departments/:id', async (req, res) => {
  const { name, description, color } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required.' });
  try {
    const r = await pool.query(
      `UPDATE departments SET name = $1, description = $2, color = $3
        WHERE id = $4 AND org_id = $5 RETURNING *`,
      [name.trim(), description ?? '', color ?? '#6366f1', req.params.id, req.user.orgId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Department not found.' });
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A department with that name already exists.' });
    res.status(500).json({ error: 'Failed to update department.' });
  }
});

router.delete('/departments/:id', async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM departments WHERE id = $1 AND org_id = $2',
      [req.params.id, req.user.orgId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete department.' });
  }
});

// ── Org-roles CRUD ────────────────────────────────────────────────────────

router.get('/org-roles', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT or2.id, or2.name, or2.label, or2.description, or2.color, or2.created_at,
              COUNT(ur.id)::int AS member_count
         FROM org_roles or2
         LEFT JOIN user_roles ur ON ur.role_name = or2.name AND ur.scope_type = 'global'
        WHERE or2.org_id = $1
        GROUP BY or2.id
        ORDER BY or2.label`,
      [req.user.orgId]
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load org roles.' });
  }
});

router.post('/org-roles', async (req, res) => {
  const { name, label, description = '', color = '#6366f1' } = req.body;
  if (!name?.trim() || !label?.trim()) return res.status(400).json({ error: 'Name and label are required.' });
  // Enforce slug format (lowercase, alphanumeric + hyphens/underscores only)
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  try {
    const r = await pool.query(
      `INSERT INTO org_roles (org_id, name, label, description, color)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.orgId, slug, label.trim(), description, color]
    );
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A role with that name already exists.' });
    res.status(500).json({ error: 'Failed to create role.' });
  }
});

router.put('/org-roles/:id', async (req, res) => {
  const { label, description, color } = req.body;
  if (!label?.trim()) return res.status(400).json({ error: 'Label is required.' });
  try {
    const r = await pool.query(
      `UPDATE org_roles SET label = $1, description = $2, color = $3
        WHERE id = $4 AND org_id = $5 RETURNING *`,
      [label.trim(), description ?? '', color ?? '#6366f1', req.params.id, req.user.orgId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Role not found.' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update role.' });
  }
});

router.delete('/org-roles/:id', async (req, res) => {
  try {
    // Get role name before deleting so we can clean up user_roles
    const r = await pool.query(
      'SELECT name FROM org_roles WHERE id = $1 AND org_id = $2',
      [req.params.id, req.user.orgId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Role not found.' });
    const { name } = r.rows[0];
    // Remove all user assignments for this role
    await pool.query(
      `DELETE FROM user_roles WHERE role_name = $1 AND scope_type = 'global'`, [name]
    );
    await pool.query('DELETE FROM org_roles WHERE id = $1 AND org_id = $2', [req.params.id, req.user.orgId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete role.' });
  }
});

// ── Models ────────────────────────────────────────────────────────────────

const MODEL_DEFAULTS = [
  {
    id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', tier: 'standard', enabled: true,
    emoji: '⚡', label: 'Economy', tagline: 'Fast & cost-effective',
    desc: 'Best for high-volume tasks and simple tool calls.',
    inputPricePer1M: 0.80, outputPricePer1M: 4.00, contextWindow: 200000,
  },
  {
    id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', tier: 'advanced', enabled: true,
    emoji: '🧠', label: 'Standard', tagline: 'Smart & balanced',
    desc: 'Best for most work — writing, analysis, and agent tool workloads.',
    inputPricePer1M: 3.00, outputPricePer1M: 15.00, contextWindow: 200000,
  },
  {
    id: 'claude-opus-4-6', name: 'Claude Opus 4.6', tier: 'premium', enabled: false,
    emoji: '🔬', label: 'Premium', tagline: 'Most capable',
    desc: 'Best for complex reasoning and advanced multi-step agent tasks.',
    inputPricePer1M: 15.00, outputPricePer1M: 75.00, contextWindow: 200000,
  },
];

router.get('/models', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT value FROM system_settings WHERE org_id = $1 AND key = 'ai_models'`,
      [req.user.orgId]
    );
    res.json(r.rows[0]?.value ?? MODEL_DEFAULTS);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load models.' });
  }
});

router.put('/models', async (req, res) => {
  const { models } = req.body;
  if (!Array.isArray(models)) return res.status(400).json({ error: 'models must be an array.' });
  try {
    await pool.query(
      `INSERT INTO system_settings (org_id, key, value, updated_by, updated_at)
       VALUES ($1, 'ai_models', $2, $3, NOW())
       ON CONFLICT (org_id, key) DO UPDATE SET value = $2, updated_by = $3, updated_at = NOW()`,
      [req.user.orgId, JSON.stringify(models), req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update models.' });
  }
});

// ── Model test ────────────────────────────────────────────────────────────
// Sends a minimal one-token request to verify the API key and model are active.
// Anthropic: uses native fetch (existing).
// Google Gemini: uses https.request with explicit Content-Length (Railway-safe).

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
    logger.error(`Provider test failed: ${modelId}`, { model: modelId, reason: msg, user: req.user.email });
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
    logger.info(`Provider test passed: ${modelId}`, { model: modelId, latencyMs: Date.now() - start });
    return res.json({ ok: true, latencyMs: Date.now() - start });
  } catch (err) {
    logger.error(`Provider test failed: ${modelId}`, { model: modelId, error: err.message, user: req.user.email });
    return res.json({ ok: false, error: err.message, latencyMs: Date.now() - start });
  }
});

router.get('/model-status', async (req, res) => {
  const { PROVIDERS } = require('../platform/providerRegistry');
  const { getCustomProviders } = require('../platform/AgentConfigService');

  // Start with hardcoded built-ins
  const status = {};
  for (const [key, prov] of Object.entries(PROVIDERS)) {
    status[key] = { label: prov.label, configured: !!process.env[prov.envVar] };
  }

  try {
    const customs = await getCustomProviders(req.user.orgId);
    for (const cp of customs) {
      if (cp.builtin) {
        // Override or hide a built-in provider
        if (cp.hidden) {
          delete status[cp.key];
        } else if (status[cp.key]) {
          if (cp.label)     status[cp.key].label = cp.label;
          // If the user overrode the env var name, re-check with their var
          if (cp.apiKeyEnv) status[cp.key].configured = !!process.env[cp.apiKeyEnv];
        }
      } else {
        // Fully custom provider
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

// ── Custom Providers ──────────────────────────────────────────────────────────

router.get('/providers', async (req, res) => {
  const { getCustomProviders } = require('../platform/AgentConfigService');
  const providers = await getCustomProviders(req.user.orgId);
  // Annotate each with whether the env var is currently set
  const annotated = providers.map((p) => ({
    ...p,
    configured: !!process.env[p.apiKeyEnv],
  }));
  res.json(annotated);
});

router.put('/providers', async (req, res) => {
  const { updateCustomProviders } = require('../platform/AgentConfigService');
  const providers = req.body.providers;
  if (!Array.isArray(providers)) {
    return res.status(400).json({ error: 'providers must be an array' });
  }
  for (const p of providers) {
    if (!p.key) return res.status(400).json({ error: 'Each provider requires a key' });
    p.key = p.key.toLowerCase().trim();
    // Custom providers (non-builtin) require apiKeyEnv + baseUrl
    if (!p.builtin && (!p.apiKeyEnv || !p.baseUrl)) {
      return res.status(400).json({ error: `Custom provider "${p.key}" requires apiKeyEnv and baseUrl` });
    }
  }
  const saved = await updateCustomProviders(req.user.orgId, providers, req.user.id);
  res.json(saved.map((p) => ({ ...p, configured: p.apiKeyEnv ? !!process.env[p.apiKeyEnv] : null })));
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

// ── Agents (admin guardrails) ──────────────────────────────────────────────

router.get('/agents', async (req, res) => {
  const slugs = Object.keys(AgentConfigService.ADMIN_DEFAULTS).filter((s) => s !== '_platform');
  try {
    const modelsRow = await pool.query(
      `SELECT value FROM system_settings WHERE org_id = $1 AND key = 'ai_models'`,
      [req.user.orgId]
    );
    const allModels = modelsRow.rows[0]?.value ?? MODEL_DEFAULTS;

    const configs = await Promise.all(
      slugs.map(async (slug) => ({
        slug,
        ...(await AgentConfigService.getAdminConfig(slug)),
        recommended_model: AgentConfigService.getRecommendedModel(slug, allModels),
      }))
    );
    res.json(configs);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load agent configs.' });
  }
});

router.get('/agents/:slug', async (req, res) => {
  try {
    const config = await AgentConfigService.getAdminConfig(req.params.slug);
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load agent admin config.' });
  }
});

router.put('/agents/:slug', async (req, res) => {
  try {
    const updated = await AgentConfigService.updateAdminConfig(
      req.params.slug,
      req.body,
      req.user.id
    );
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update agent admin config.' });
  }
});

// ── App Settings ──────────────────────────────────────────────────────────

router.get('/settings', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT key, value FROM system_settings
        WHERE org_id = $1
          AND key IN ('app_name', 'timezone', 'allowed_file_types')`,
      [req.user.orgId]
    );
    const settings = {};
    for (const row of r.rows) settings[row.key] = row.value?.value ?? row.value;
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load settings.' });
  }
});

router.put('/settings', async (req, res) => {
  const allowed = ['app_name', 'timezone', 'allowed_file_types'];
  try {
    for (const [key, value] of Object.entries(req.body)) {
      if (!allowed.includes(key)) continue;
      await pool.query(
        `INSERT INTO system_settings (org_id, key, value, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (org_id, key) DO UPDATE SET value = $3, updated_by = $4, updated_at = NOW()`,
        [req.user.orgId, key, JSON.stringify({ value }), req.user.id]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update settings.' });
  }
});

// ── Org default model ─────────────────────────────────────────────────────

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

// ── Company Profile ───────────────────────────────────────────────────────

router.get('/company-profile', async (req, res) => {
  try {
    const profile = await AgentConfigService.getCompanyProfile(req.user.orgId);
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load company profile.' });
  }
});

router.put('/company-profile', async (req, res) => {
  try {
    const updated = await AgentConfigService.updateCompanyProfile(req.user.orgId, req.body, req.user.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update company profile.' });
  }
});

// ── Email Templates ───────────────────────────────────────────────────────

router.get('/email-templates', async (req, res) => {
  try {
    res.json(await EmailTemplateService.list());
  } catch (err) {
    res.status(500).json({ error: 'Failed to load email templates.' });
  }
});

router.get('/email-templates/:slug', async (req, res) => {
  try {
    res.json(await EmailTemplateService.get(req.params.slug));
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.put('/email-templates/:slug', async (req, res) => {
  try {
    const { subject, body_html, body_text } = req.body;
    res.json(await EmailTemplateService.upsert(req.params.slug, { subject, body_html, body_text }, req.user.id));
  } catch (err) {
    res.status(500).json({ error: 'Failed to update email template.' });
  }
});

router.post('/email-templates/:slug/reset', async (req, res) => {
  try {
    res.json(await EmailTemplateService.reset(req.params.slug, req.user.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Security settings ─────────────────────────────────────────────────────

const SECURITY_KEYS = [
  'security_login_rate_limit',
  'security_login_max_attempts',
  'security_lockout_minutes',
];

router.get('/security', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT key, value FROM system_settings WHERE org_id = $1 AND key = ANY($2)`,
      [req.user.orgId, SECURITY_KEYS]
    );
    const settings = {
      security_login_rate_limit: 5,
      security_login_max_attempts: 5,
      security_lockout_minutes: 15,
    };
    for (const row of r.rows) settings[row.key] = row.value?.value ?? row.value;
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load security settings.' });
  }
});

router.put('/security', async (req, res) => {
  try {
    for (const key of SECURITY_KEYS) {
      if (req.body[key] === undefined) continue;
      await pool.query(
        `INSERT INTO system_settings (org_id, key, value, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (org_id, key) DO UPDATE SET value = $3, updated_by = $4, updated_at = NOW()`,
        [req.user.orgId, key, JSON.stringify({ value: req.body[key] }), req.user.id]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update security settings.' });
  }
});

// ── Logs ──────────────────────────────────────────────────────────────────

router.get('/logs', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit ?? '100'), 500);
  const offset = parseInt(req.query.offset ?? '0');
  try {
    const r = await pool.query(
      `SELECT ul.id, ul.tool_slug, ul.model_id, ul.input_tokens, ul.output_tokens,
              ul.cost_usd, ul.created_at,
              u.email AS user_email
         FROM usage_logs ul
         LEFT JOIN users u ON u.id = ul.user_id
        WHERE ul.org_id = $1
        ORDER BY ul.created_at DESC
        LIMIT $2 OFFSET $3`,
      [req.user.orgId, limit, offset]
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load logs.' });
  }
});

// ── Server logs ───────────────────────────────────────────────────────────

router.get('/server-logs', async (req, res) => {
  const level  = req.query.level  || null;
  const search = req.query.search || null;
  const limit  = Math.min(parseInt(req.query.limit  || '100', 10), 500);
  const offset = parseInt(req.query.offset || '0', 10);

  try {
    const conditions = [];
    const params = [];

    if (level && level !== 'all') {
      params.push(level);
      conditions.push(`level = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`message ILIKE $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rows, count] = await Promise.all([
      pool.query(
        `SELECT id, level, message, meta, created_at
           FROM app_logs ${where}
           ORDER BY created_at DESC
           LIMIT ${limit} OFFSET ${offset}`,
        params
      ),
      pool.query(`SELECT COUNT(*) FROM app_logs ${where}`, params),
    ]);

    res.json({ logs: rows.rows, total: parseInt(count.rows[0].count, 10), limit, offset });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load server logs.' });
  }
});

// ── SQL Console ───────────────────────────────────────────────────────────

const { logUsage } = require('../services/UsageLogger');
const AUD_PER_USD_SQL = 1.55;

/**
 * Resolves the best model for the org.
 * Priority: (1) explicit modelId override, (2) org default model (even if not in ai_models —
 * supports custom providers), (3) first enabled advanced tier, (4) first enabled model,
 * (5) hardcoded Sonnet fallback.
 * Returns { id, inputPricePer1M, outputPricePer1M }.
 */
async function getDefaultModel(orgId, modelId = null) {
  const [modelsRow, defaultRow] = await Promise.all([
    pool.query(`SELECT value FROM system_settings WHERE org_id = $1 AND key = 'ai_models' LIMIT 1`, [orgId]),
    pool.query(`SELECT value FROM system_settings WHERE org_id = $1 AND key = 'default_model' LIMIT 1`, [orgId]),
  ]);
  const models  = Array.isArray(modelsRow.rows[0]?.value) ? modelsRow.rows[0].value : MODEL_DEFAULTS;
  const enabled = models.filter((m) => m.enabled);
  const orgDefaultId = defaultRow.rows[0]?.value?.model_id ?? null;

  if (modelId) {
    const match = enabled.find((m) => m.id === modelId);
    if (match) return match;
    // UI-selected model not in ai_models list (e.g. custom provider) — use it with unknown pricing
    return { id: modelId, inputPricePer1M: 0, outputPricePer1M: 0 };
  }
  if (orgDefaultId) {
    const match = enabled.find((m) => m.id === orgDefaultId);
    if (match) return match;
    // Org default not in ai_models list (e.g. custom provider) — still honor it
    return { id: orgDefaultId, inputPricePer1M: 0, outputPricePer1M: 0 };
  }
  return (
    enabled.find((m) => m.tier === 'advanced') ??
    enabled[0] ??
    MODEL_DEFAULTS.find((m) => m.tier === 'advanced') ??
    { id: 'claude-sonnet-4-6', inputPricePer1M: 3.00, outputPricePer1M: 15.00 }
  );
}

const WRITE_KEYWORDS = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'TRUNCATE', 'ALTER', 'CREATE', 'GRANT', 'REVOKE'];

function firstSqlKeyword(sql) {
  return sql.trim().replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').trim().split(/\s+/)[0].toUpperCase();
}

async function execSql(sql, allowWrite, userEmail) {
  const kw = firstSqlKeyword(sql);
  if (WRITE_KEYWORDS.includes(kw) && !allowWrite) {
    throw Object.assign(new Error(`Write statements are blocked. Enable "Allow writes" to run ${kw}.`), { status: 400 });
  }
  const start = Date.now();
  const result = await pool.query(sql);
  const duration = Date.now() - start;
  const rows = result.rows ?? [];
  const columns = rows.length > 0 ? Object.keys(rows[0]) : (result.fields?.map(f => f.name) ?? []);
  console.log(`[SQL Console] ${userEmail} ran: ${sql.slice(0, 120).replace(/\n/g, ' ')} — ${rows.length} rows in ${duration}ms`);
  return { command: result.command ?? kw, rowCount: result.rowCount ?? rows.length, columns, rows, duration };
}

async function getDbSchema() {
  const { rows } = await pool.query(`
    SELECT
      c.table_name,
      c.column_name,
      c.data_type,
      c.is_nullable,
      c.column_default
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_name = c.table_name AND t.table_schema = 'public'
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_name, c.ordinal_position
  `);

  // Group into table → columns map
  const tables = {};
  for (const r of rows) {
    if (!tables[r.table_name]) tables[r.table_name] = [];
    const nullable = r.is_nullable === 'YES' ? '' : ' NOT NULL';
    const def = r.column_default ? ` DEFAULT ${r.column_default}` : '';
    tables[r.table_name].push(`  ${r.column_name} ${r.data_type}${nullable}${def}`);
  }

  return Object.entries(tables)
    .map(([tbl, cols]) => `${tbl} (\n${cols.join(',\n')}\n)`)
    .join('\n\n');
}

router.post('/sql', async (req, res) => {
  const { sql, allowWrite = false } = req.body;
  if (!sql?.trim()) return res.status(400).json({ error: 'No SQL provided.' });
  try {
    const data = await execSql(sql, allowWrite, req.user.email);
    res.json(data);
  } catch (err) {
    console.error(`[SQL Console] Error for ${req.user.email}:`, err.message);
    res.status(err.status ?? 400).json({ error: err.message });
  }
});

router.post('/sql/nlp', async (req, res) => {
  const { getProvider } = require('../platform/AgentOrchestrator');
  const { getCustomProviders } = require('../platform/AgentConfigService');
  const { question, allowWrite = false, modelId = null } = req.body;
  if (!question?.trim()) return res.status(400).json({ error: 'No question provided.' });

  try {
    const [schema, modelDef, customProviders] = await Promise.all([
      getDbSchema(),
      getDefaultModel(req.user.orgId, modelId),
      getCustomProviders(req.user.orgId),
    ]);

    const provider = getProvider(modelDef.id, customProviders);

    const response = await provider.chat({
      model: modelDef.id,
      max_tokens: 2048,
      system: null,
      messages: [{
        role: 'user',
        content: `You are a PostgreSQL expert. Given the database schema below, write a single SQL query to answer the question.

Return ONLY the raw SQL query — no explanation, no markdown, no code fences. The query must be valid PostgreSQL.

## Schema
${schema}

## Question
${question}`,
      }],
    });

    const generatedSql = response.content[0]?.text?.trim() ?? '';
    if (!generatedSql) throw new Error('Model returned an empty response.');

    // Log usage to usage_logs
    const tokensUsed = { input: response.usage.input_tokens, output: response.usage.output_tokens };
    const costAud = (
      tokensUsed.input  * (modelDef.inputPricePer1M  / 1_000_000) +
      tokensUsed.output * (modelDef.outputPricePer1M / 1_000_000)
    ) * AUD_PER_USD_SQL;
    logUsage({ orgId: req.user.orgId, userId: req.user.id, slug: 'sql-console-nlp', modelId: modelDef.id, tokensUsed, costAud }).catch(() => {});

    console.log(`[SQL Console NLP] ${req.user.email} (${modelDef.id}): "${question.slice(0, 80)}" → ${generatedSql.slice(0, 120)} [${tokensUsed.input}in/${tokensUsed.output}out, A$${costAud.toFixed(4)}]`);

    const data = await execSql(generatedSql, allowWrite, req.user.email);

    // Generate a plain-English answer for read-aloud using the same model — wrapped in
    // try/catch so a provider error here never kills the SQL results already retrieved.
    let answer = '';
    try {
      const resultSummary = data.rows.length === 0
        ? 'The query returned no results.'
        : JSON.stringify(data.rows.slice(0, 20));
      const answerResponse = await provider.chat({
        model: modelDef.id,
        max_tokens: 256,
        system: null,
        messages: [{
          role: 'user',
          content: `Question: ${question}\n\nSQL results: ${resultSummary}\n\nAnswer the question in 1–2 plain English sentences based on the results. No markdown, no SQL.`,
        }],
      });
      answer = answerResponse.content[0]?.text?.trim() ?? '';
    } catch (answerErr) {
      console.warn(`[SQL Console NLP] Answer generation failed (${modelDef.id}):`, answerErr.message);
    }

    res.json({ ...data, generatedSql, modelId: modelDef.id, tokensUsed, costAud, answer });
  } catch (err) {
    console.error(`[SQL Console NLP] Error for ${req.user.email}:`, err.message);
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

// ── Data Privacy (unified) ────────────────────────────────────────────────
//
// GET  /admin/data-privacy  — returns both extraction_privacy and crm_privacy
// PUT  /admin/data-privacy  — updates either or both in one call
//
// Legacy /admin/crm-privacy routes kept for backwards compatibility.

router.get('/data-privacy', async (req, res) => {
  try {
    const [extraction, crm] = await Promise.all([
      AgentConfigService.getExtractionPrivacySettings(req.user.orgId),
      AgentConfigService.getCrmPrivacySettings(req.user.orgId),
    ]);
    res.json({ extraction, crm });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load data privacy settings.' });
  }
});

router.put('/data-privacy', async (req, res) => {
  try {
    const { extraction, crm } = req.body;
    const results = {};

    if (extraction !== undefined) {
      const { excluded_field_names } = extraction;
      if (!Array.isArray(excluded_field_names)) {
        return res.status(400).json({ error: 'extraction.excluded_field_names must be an array.' });
      }
      const clean = excluded_field_names.map((f) => String(f).trim().toLowerCase()).filter(Boolean);
      results.extraction = await AgentConfigService.updateExtractionPrivacySettings(
        req.user.orgId, { excluded_field_names: clean }, req.user.id
      );
    }

    if (crm !== undefined) {
      const { excluded_fields } = crm;
      if (!Array.isArray(excluded_fields)) {
        return res.status(400).json({ error: 'crm.excluded_fields must be an array.' });
      }
      const clean = excluded_fields.map((f) => String(f).trim().toLowerCase()).filter(Boolean);
      results.crm = await AgentConfigService.updateCrmPrivacySettings(
        req.user.orgId, { excluded_fields: clean }, req.user.id
      );
    }

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update data privacy settings.' });
  }
});

// ── CRM Privacy (legacy — kept for backwards compatibility) ───────────────

router.get('/crm-privacy', async (req, res) => {
  try {
    const settings = await AgentConfigService.getCrmPrivacySettings(req.user.orgId);
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load CRM privacy settings.' });
  }
});

router.put('/crm-privacy', async (req, res) => {
  try {
    const { excluded_fields } = req.body;
    if (!Array.isArray(excluded_fields)) {
      return res.status(400).json({ error: 'excluded_fields must be an array.' });
    }
    const clean = excluded_fields.map((f) => String(f).trim().toLowerCase()).filter(Boolean);
    const result = await AgentConfigService.updateCrmPrivacySettings(req.user.orgId, { excluded_fields: clean }, req.user.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update CRM privacy settings.' });
  }
});

// ── Claude Session Config ─────────────────────────────────────────────────
//
// GET  /admin/claude-session-config — returns claude_session_config for the org
// PUT  /admin/claude-session-config — updates daily_start, timezone

const CLAUDE_SESSION_DEFAULTS = {
  daily_start:       '06:00', // HH:MM — browser local time the 5-hour window begins
  weekly_start_day:  1,       // JS day index: 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat
};

router.get('/claude-session-config', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT value FROM system_settings WHERE org_id = $1 AND key = 'claude_session_config' LIMIT 1`,
      [req.user.orgId]
    );
    res.json({ ...CLAUDE_SESSION_DEFAULTS, ...(r.rows[0]?.value ?? {}) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load Claude session config.' });
  }
});

router.put('/claude-session-config', async (req, res) => {
  try {
    const current = await pool.query(
      `SELECT value FROM system_settings WHERE org_id = $1 AND key = 'claude_session_config' LIMIT 1`,
      [req.user.orgId]
    );
    const existing = { ...CLAUDE_SESSION_DEFAULTS, ...(current.rows[0]?.value ?? {}) };
    const patch    = {};
    if (typeof req.body.daily_start      === 'string') patch.daily_start      = req.body.daily_start.trim();
    if (typeof req.body.weekly_start_day === 'number') patch.weekly_start_day = req.body.weekly_start_day;
    const merged = { ...existing, ...patch };
    await pool.query(
      `INSERT INTO system_settings (org_id, key, value, updated_by, updated_at)
       VALUES ($1, 'claude_session_config', $2, $3, NOW())
       ON CONFLICT (org_id, key) DO UPDATE SET value = $2, updated_by = $3, updated_at = NOW()`,
      [req.user.orgId, JSON.stringify(merged), req.user.id]
    );
    res.json(merged);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update Claude session config.' });
  }
});

// ── Storage Settings ──────────────────────────────────────────────────────
//
// GET  /admin/storage-settings — returns current storage_settings for the org
// PUT  /admin/storage-settings — updates storage_settings (org_admin only)
//
// AWS credentials are env vars (secrets). bucket/region live in storage_settings
// so admins can change them without a redeploy.

router.get('/storage-settings', async (req, res) => {
  try {
    const settings = await AgentConfigService.getStorageSettings(req.user.orgId);
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load storage settings.' });
  }
});

router.put('/storage-settings', async (req, res) => {
  try {
    const { enabled, default_behaviour, aws_bucket, aws_region } = req.body;
    const patch = {};
    if (typeof enabled           === 'boolean') patch.enabled           = enabled;
    if (typeof default_behaviour === 'string')  patch.default_behaviour = default_behaviour;
    if (typeof aws_bucket        === 'string')  patch.aws_bucket        = aws_bucket.trim() || null;
    if (typeof aws_region        === 'string')  patch.aws_region        = aws_region.trim() || 'ap-southeast-2';
    const updated = await AgentConfigService.updateStorageSettings(req.user.orgId, patch, req.user.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update storage settings.' });
  }
});

// ── Diagnostics ───────────────────────────────────────────────────────────

router.post('/diagnostics', async (req, res) => {
  const https     = require('https');
  const Anthropic = require('@anthropic-ai/sdk');
  const { google } = require('googleapis');
  const MCPRegistry = require('../platform/mcpRegistry');
  const results   = [];

  async function check(name, fn) {
    try {
      const detail = await fn();
      results.push({ name, ok: true, detail });
    } catch (err) {
      results.push({ name, ok: false, detail: err.message });
    }
  }

  // ── 1. Database ────────────────────────────────────────────────────────────
  await check('Database', async () => {
    const { rows } = await pool.query('SELECT NOW() AS ts');
    return `Connected — server time ${rows[0].ts.toISOString()}`;
  });

  // ── 2. Anthropic API ───────────────────────────────────────────────────────
  await check('Anthropic API', async () => {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Reply with just: ok' }],
    });
    return 'API key valid — test message sent';
  });

  // ── 3. MailChannels ────────────────────────────────────────────────────────
  // Uses https.request (not fetch) — native fetch silently fails on Railway
  // with MailChannels. A 422 back means the key authenticated; 401 means invalid.
  await check('MailChannels', async () => {
    if (!process.env.MAIL_CHANNEL_API_KEY) throw new Error('MAIL_CHANNEL_API_KEY is not set');
    const payload = JSON.stringify({ personalizations: [] }); // deliberately invalid payload
    const statusCode = await new Promise((resolve, reject) => {
      const req2 = https.request(
        {
          hostname: 'api.mailchannels.net',
          path: '/tx/v1/send',
          method: 'POST',
          headers: {
            'Content-Type':   'application/json',
            'X-Api-Key':      process.env.MAIL_CHANNEL_API_KEY,
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (r) => { r.resume(); resolve(r.statusCode); }
      );
      req2.on('error', reject);
      req2.write(payload);
      req2.end();
    });
    if (statusCode === 401 || statusCode === 403) throw new Error(`API key rejected (HTTP ${statusCode})`);
    return `API key valid — from ${process.env.MAIL_FROM_EMAIL || 'noreply@curam-ai.com.au'}`;
  });

  // ── 4. MCP Registry ────────────────────────────────────────────────────────
  await check('MCP Registry', async () => {
    const servers = await MCPRegistry.list(req.user.orgId);
    if (servers.length === 0) return 'No MCP servers registered';
    const connected = servers.filter(s => s.connection_status === 'connected').length;
    const names = servers.map(s => `${s.name} (${s.connection_status})`).join(', ');
    return `${servers.length} server(s) registered, ${connected} connected — ${names}`;
  });

  // ── 5. Google OAuth ────────────────────────────────────────────────────────
  let accessToken = null;
  await check('Google OAuth', async () => {
    if (!process.env.GOOGLE_CLIENT_ID)     throw new Error('GOOGLE_CLIENT_ID is not set');
    if (!process.env.GOOGLE_CLIENT_SECRET) throw new Error('GOOGLE_CLIENT_SECRET is not set');
    if (!process.env.GOOGLE_REFRESH_TOKEN) throw new Error('GOOGLE_REFRESH_TOKEN is not set');
    const oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    const { token } = await oauth2.getAccessToken();
    accessToken = token;
    return `Token refreshed — ${token.slice(0, 10)}…`;
  });

  // ── 6. Google Ads API ──────────────────────────────────────────────────────
  await check('Google Ads API', async () => {
    if (!accessToken) throw new Error('Skipped — Google OAuth check failed');
    const customerId = (process.env.GOOGLE_ADS_CUSTOMER_ID ?? '').replace(/-/g, '');
    const managerId  = (process.env.GOOGLE_ADS_MANAGER_ID  ?? '').replace(/-/g, '');
    const devToken   = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '';
    if (!customerId) throw new Error('GOOGLE_ADS_CUSTOMER_ID is not set');
    if (!managerId)  throw new Error('GOOGLE_ADS_MANAGER_ID is not set');
    if (!devToken)   throw new Error('GOOGLE_ADS_DEVELOPER_TOKEN is not set');
    const r = await fetch(
      `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:search`,
      {
        method: 'POST',
        headers: {
          'Authorization':     `Bearer ${accessToken}`,
          'developer-token':   devToken,
          'login-customer-id': managerId,
          'Content-Type':      'application/json',
        },
        body: JSON.stringify({ query: 'SELECT customer.id FROM customer LIMIT 1' }),
      }
    );
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      const msg = body?.error?.details?.[0]?.errors?.[0]?.message ?? body?.error?.message ?? `HTTP ${r.status}`;
      throw new Error(msg);
    }
    const data = await r.json();
    const id = data.results?.[0]?.customer?.id ?? '(no result)';
    return `Customer ${id} accessible`;
  });

  // ── 7. WordPress REST API ─────────────────────────────────────────────────
  await check('WordPress API', async () => {
    if (!process.env.WP_APP_VAR) throw new Error('WP_APP_VAR is not set');
    const wpUrl  = (process.env.WP_URL  || 'https://diamondplate.com.au').replace(/\/$/, '');
    const wpUser = process.env.WP_USER  || 'master';
    const auth   = Buffer.from(`${wpUser}:${process.env.WP_APP_VAR}`).toString('base64');
    const url    = new URL(`${wpUrl}/wp-json/wp/v2/users/1`);
    const name   = await new Promise((resolve, reject) => {
      const req2 = https.request(
        {
          hostname: url.hostname,
          port: 443,
          path: url.pathname,
          method: 'GET',
          headers: { Authorization: `Basic ${auth}`, Accept: 'application/json', 'User-Agent': 'MCP-curamTools/1.0 (WordPress REST API client)' },
        },
        (r) => {
          let data = '';
          r.setEncoding('utf8');
          r.on('data', (c) => { data += c; });
          r.on('end', () => {
            if (r.statusCode !== 200) return reject(new Error(`HTTP ${r.statusCode} — ${data.slice(0, 120)}`));
            try { resolve(JSON.parse(data).name); } catch { reject(new Error(`Invalid JSON (HTTP 200) — ${data.slice(0, 120)}`)); }
          });
        }
      );
      req2.on('error', reject);
      req2.end();
    });
    return `Connected — admin user: ${name}`;
  });

  // ── 8. Google Analytics (GA4) ──────────────────────────────────────────────
  await check('Google Analytics (GA4)', async () => {
    if (!accessToken) throw new Error('Skipped — Google OAuth check failed');
    const propertyId = process.env.GOOGLE_GA4_PROPERTY_ID ?? '';
    if (!propertyId) throw new Error('GOOGLE_GA4_PROPERTY_ID is not set');
    const r = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
          metrics:    [{ name: 'sessions' }],
          limit:      1,
        }),
      }
    );
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error(body?.error?.message ?? `HTTP ${r.status}`);
    }
    const data = await r.json();
    return `Property ${propertyId} accessible — ${data.rowCount ?? 0} rows`;
  });

  // ── 9. AWS S3 ─────────────────────────────────────────────────────────────
  await check('AWS S3', async () => {
    const AgentConfigService = require('../platform/AgentConfigService');
    const StorageService     = require('../services/StorageService');

    if (!process.env.AWS_ACCESS_KEY_ID)     throw new Error('AWS_ACCESS_KEY_ID is not set');
    if (!process.env.AWS_SECRET_ACCESS_KEY) throw new Error('AWS_SECRET_ACCESS_KEY is not set');

    const settings = await AgentConfigService.getStorageSettings(req.user.orgId);
    const bucket   = settings.aws_bucket ?? process.env.AWS_S3_BUCKET;
    const region   = settings.aws_region ?? process.env.AWS_S3_REGION ?? 'ap-southeast-2';

    if (!bucket) throw new Error('S3 bucket not configured — set AWS_S3_BUCKET env var or configure storage_settings');

    await StorageService.healthCheck({ bucket, region });
    const status = settings.enabled ? `enabled (${settings.default_behaviour})` : 'disabled';
    return `Bucket "${bucket}" (${region}) reachable — storage ${status}`;
  });

  console.log(`[Diagnostics] Run by ${req.user.email} — ${results.filter(r => r.ok).length}/${results.length} passed`);
  res.json(results);
});

// ── Usage Warnings ────────────────────────────────────────────────────────
//
// GET /admin/usage-warnings
// Computes proactive warnings from usage_logs. Returns warnings[].
// Checks: budget pace, agent over budget, cache health, cost spike,
//         stale agents, overkill model tier.

router.get('/usage-warnings', async (req, res) => {
  const orgId = req.user.orgId;

  try {
    const [
      budgetSettings,
      daily7dRes,
      cacheRes,
      spikeRes,
      slugCostRes,
      staleRes,
      modelUsageRes,
      modelsRow,
    ] = await Promise.all([
      AgentConfigService.getOrgBudgetSettings(orgId),

      pool.query(
        `SELECT DATE(created_at AT TIME ZONE 'Australia/Brisbane') AS day,
                COALESCE(SUM(cost_aud), 0)::numeric AS cost_aud
           FROM usage_logs
          WHERE org_id = $1 AND created_at >= NOW() - INTERVAL '7 days'
          GROUP BY day`,
        [orgId]
      ),

      pool.query(
        `SELECT COUNT(*)::int AS runs,
                COALESCE(SUM(cache_read_tokens), 0)::bigint AS cache_read,
                COALESCE(SUM(input_tokens + cache_read_tokens + cache_creation_tokens), 0)::bigint AS total_input
           FROM usage_logs
          WHERE org_id = $1 AND created_at >= NOW() - INTERVAL '7 days'`,
        [orgId]
      ),

      pool.query(
        `SELECT COALESCE(AVG(daily_cost), 0)::numeric AS avg_daily,
                COALESCE(MAX(CASE WHEN day = CURRENT_DATE - 1 THEN daily_cost END), 0)::numeric AS yesterday
           FROM (
             SELECT DATE(created_at AT TIME ZONE 'Australia/Brisbane') AS day,
                    SUM(cost_aud) AS daily_cost
               FROM usage_logs
              WHERE org_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
              GROUP BY day
           ) t`,
        [orgId]
      ),

      pool.query(
        `SELECT tool_slug,
                COUNT(*)::int AS runs,
                AVG(cost_aud)::numeric AS avg_cost
           FROM usage_logs
          WHERE org_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
          GROUP BY tool_slug
         HAVING COUNT(*) >= 2`,
        [orgId]
      ),

      pool.query(
        `SELECT DISTINCT tool_slug
           FROM usage_logs
          WHERE org_id = $1
            AND created_at >= NOW() - INTERVAL '14 days'
            AND tool_slug NOT IN (
              SELECT DISTINCT tool_slug FROM usage_logs
               WHERE org_id = $1 AND created_at >= NOW() - INTERVAL '3 days'
            )`,
        [orgId]
      ),

      pool.query(
        `SELECT tool_slug, model_id, COUNT(*)::int AS runs
           FROM usage_logs
          WHERE org_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
            AND model_id IS NOT NULL AND tool_slug IS NOT NULL
          GROUP BY tool_slug, model_id`,
        [orgId]
      ),

      pool.query(
        `SELECT value FROM system_settings WHERE org_id = $1 AND key = 'ai_models' LIMIT 1`,
        [orgId]
      ),
    ]);

    const warnings = [];

    // 1. Budget pace
    const maxDaily = budgetSettings.max_daily_org_budget_aud;
    if (maxDaily != null && daily7dRes.rows.length > 0) {
      const avg = daily7dRes.rows.reduce((s, r) => s + Number(r.cost_aud), 0) / daily7dRes.rows.length;
      const pct = avg / maxDaily;
      if (pct >= 1.0) {
        warnings.push({ type: 'budget_pace', severity: 'critical', title: 'Daily budget exceeded', detail: `7-day avg $${avg.toFixed(4)} AUD/day exceeds $${maxDaily.toFixed(2)} limit.` });
      } else if (pct >= 0.8) {
        warnings.push({ type: 'budget_pace', severity: 'warning', title: 'Approaching daily budget', detail: `7-day avg $${avg.toFixed(4)} AUD/day is ${Math.round(pct * 100)}% of $${maxDaily.toFixed(2)} daily limit.` });
      }
    }

    // 2. Agent over budget
    if (slugCostRes.rows.length > 0) {
      const configs = await Promise.all(
        slugCostRes.rows.map((r) =>
          AgentConfigService.getAdminConfig(r.tool_slug).then((cfg) => ({ slug: r.tool_slug, cfg, row: r }))
        )
      );
      for (const { slug, cfg, row } of configs) {
        const limit = cfg.max_task_budget_aud;
        if (!limit) continue;
        const avg = Number(row.avg_cost);
        const pct = avg / limit;
        if (pct >= 0.9) {
          warnings.push({
            type:     'agent_over_budget',
            severity: pct >= 1.0 ? 'critical' : 'warning',
            title:    `${slug}: high avg run cost`,
            detail:   `Avg $${avg.toFixed(4)} AUD/run is ${Math.round(pct * 100)}% of $${limit.toFixed(2)} limit (${row.runs} runs, last 30 days).`,
          });
        }
      }
    }

    // 3. Cache health
    const cr = cacheRes.rows[0];
    if (cr && Number(cr.runs) >= 5) {
      const hitRate = Number(cr.total_input) > 0 ? Number(cr.cache_read) / Number(cr.total_input) : 0;
      if (hitRate < 0.15) {
        warnings.push({ type: 'cache_health', severity: 'warning', title: 'Low cache hit rate', detail: `${(hitRate * 100).toFixed(1)}% over last 7 days. Check if system prompts contain dynamic content that breaks the cache key.` });
      }
    }

    // 4. Cost spike
    const sr = spikeRes.rows[0];
    if (sr) {
      const avg = Number(sr.avg_daily);
      const yday = Number(sr.yesterday);
      if (avg > 0.001 && yday > avg * 2.5) {
        warnings.push({ type: 'spike', severity: 'warning', title: 'Cost spike yesterday', detail: `Yesterday $${yday.toFixed(4)} AUD was ${(yday / avg).toFixed(1)}× the 30-day daily avg ($${avg.toFixed(4)} AUD).` });
      }
    }

    // 5. Stale agents
    if (staleRes.rows.length > 0) {
      const slugs = staleRes.rows.map((r) => r.tool_slug).join(', ');
      warnings.push({ type: 'stale_agent', severity: 'info', title: 'Agent(s) inactive 3+ days', detail: `Ran in last 14 days but not last 3: ${slugs}.` });
    }

    // 6. Overkill model
    const allModels = Array.isArray(modelsRow.rows[0]?.value) ? modelsRow.rows[0].value : MODEL_DEFAULTS;
    const modelTierMap = Object.fromEntries(allModels.map((m) => [m.id, m.tier]));
    const TIER_RANK    = { standard: 0, advanced: 1 };
    const { AGENT_MODEL_REQUIREMENTS } = AgentConfigService;

    for (const { tool_slug, model_id, runs } of modelUsageRes.rows) {
      const modelTier = modelTierMap[model_id];
      const agentReq  = AGENT_MODEL_REQUIREMENTS[tool_slug];
      if (!modelTier || !agentReq) continue;
      if ((TIER_RANK[modelTier] ?? 0) > (TIER_RANK[agentReq.tier] ?? 0)) {
        warnings.push({ type: 'overkill_model', severity: 'info', title: `${tool_slug}: overkill model`, detail: `Using ${model_id} (${modelTier}) for ${runs} runs — agent only requires ${agentReq.tier}. Cheaper model available in Admin › Agents.` });
      }
    }

    res.json({ warnings });
  } catch (err) {
    console.error('[usage-warnings]', err.message);
    res.status(500).json({ error: 'Failed to compute usage warnings.' });
  }
});

// ── Usage Stats ───────────────────────────────────────────────────────────
//
// GET /admin/usage-stats?days=30
// Aggregated token and cost data for the org. days: 7 | 30 | 90 (default 30).

const AUD_PER_USD_STATS   = 1.55;
const CACHE_READ_PRICE_USD  = 0.30 / 1_000_000;  // per token
const NORMAL_INPUT_PRICE_USD = 3.00 / 1_000_000; // per token

router.get('/usage-stats', async (req, res) => {
  const days  = Math.min(Math.max(parseInt(req.query.days ?? '30', 10), 1), 90);
  const orgId = req.user.orgId;

  try {
    const interval = `${days} days`;

    const [totalsRes, byModelRes, byToolRes, dailyRes] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*)::int                                       AS runs,
           COALESCE(SUM(input_tokens),          0)::bigint    AS input_tokens,
           COALESCE(SUM(output_tokens),         0)::bigint    AS output_tokens,
           COALESCE(SUM(cache_read_tokens),     0)::bigint    AS cache_read_tokens,
           COALESCE(SUM(cache_creation_tokens), 0)::bigint    AS cache_creation_tokens,
           COALESCE(SUM(cost_aud),              0)::numeric   AS cost_aud
         FROM usage_logs
         WHERE org_id = $1 AND created_at >= NOW() - $2::INTERVAL`,
        [orgId, interval]
      ),
      pool.query(
        `SELECT
           COALESCE(model_id, 'unknown')                      AS model_id,
           COUNT(*)::int                                       AS runs,
           COALESCE(SUM(input_tokens),          0)::bigint    AS input_tokens,
           COALESCE(SUM(output_tokens),         0)::bigint    AS output_tokens,
           COALESCE(SUM(cache_read_tokens),     0)::bigint    AS cache_read_tokens,
           COALESCE(SUM(cache_creation_tokens), 0)::bigint    AS cache_creation_tokens,
           COALESCE(SUM(cost_aud),              0)::numeric   AS cost_aud
         FROM usage_logs
         WHERE org_id = $1 AND created_at >= NOW() - $2::INTERVAL
         GROUP BY model_id
         ORDER BY cost_aud DESC`,
        [orgId, interval]
      ),
      pool.query(
        `SELECT
           COALESCE(tool_slug, 'unknown')                     AS tool_slug,
           COUNT(*)::int                                       AS runs,
           COALESCE(SUM(input_tokens),          0)::bigint    AS input_tokens,
           COALESCE(SUM(output_tokens),         0)::bigint    AS output_tokens,
           COALESCE(SUM(cache_read_tokens),     0)::bigint    AS cache_read_tokens,
           COALESCE(SUM(cache_creation_tokens), 0)::bigint    AS cache_creation_tokens,
           COALESCE(SUM(cost_aud),              0)::numeric   AS cost_aud
         FROM usage_logs
         WHERE org_id = $1 AND created_at >= NOW() - $2::INTERVAL
         GROUP BY tool_slug
         ORDER BY cost_aud DESC`,
        [orgId, interval]
      ),
      pool.query(
        `SELECT
           DATE(created_at AT TIME ZONE 'Australia/Brisbane') AS day,
           COUNT(*)::int                                       AS runs,
           COALESCE(SUM(input_tokens + output_tokens +
                        cache_read_tokens + cache_creation_tokens), 0)::bigint AS total_tokens,
           COALESCE(SUM(cost_aud), 0)::numeric                AS cost_aud
         FROM usage_logs
         WHERE org_id = $1 AND created_at >= NOW() - $2::INTERVAL
         GROUP BY day
         ORDER BY day ASC`,
        [orgId, interval]
      ),
    ]);

    const t = totalsRes.rows[0];
    const cacheRead    = Number(t.cache_read_tokens);
    const totalInput   = Number(t.input_tokens) + Number(t.cache_read_tokens) + Number(t.cache_creation_tokens);
    const cacheHitRate = totalInput > 0 ? cacheRead / totalInput : 0;

    // Tokens served from cache would have cost NORMAL_INPUT_PRICE_USD each without caching
    const savingsUsd = cacheRead * (NORMAL_INPUT_PRICE_USD - CACHE_READ_PRICE_USD);
    const savingsAud = savingsUsd * AUD_PER_USD_STATS;

    res.json({
      days,
      totals: {
        runs:                  Number(t.runs),
        input_tokens:          Number(t.input_tokens),
        output_tokens:         Number(t.output_tokens),
        cache_read_tokens:     cacheRead,
        cache_creation_tokens: Number(t.cache_creation_tokens),
        cost_aud:              Number(t.cost_aud),
        cache_hit_rate:        cacheHitRate,
        cache_savings_aud:     savingsAud,
      },
      by_model: byModelRes.rows.map((r) => ({
        model_id:              r.model_id,
        runs:                  Number(r.runs),
        input_tokens:          Number(r.input_tokens),
        output_tokens:         Number(r.output_tokens),
        cache_read_tokens:     Number(r.cache_read_tokens),
        cache_creation_tokens: Number(r.cache_creation_tokens),
        cost_aud:              Number(r.cost_aud),
      })),
      by_tool: byToolRes.rows.map((r) => ({
        tool_slug:             r.tool_slug,
        runs:                  Number(r.runs),
        input_tokens:          Number(r.input_tokens),
        output_tokens:         Number(r.output_tokens),
        cache_read_tokens:     Number(r.cache_read_tokens),
        cache_creation_tokens: Number(r.cache_creation_tokens),
        cost_aud:              Number(r.cost_aud),
      })),
      daily: dailyRes.rows.map((r) => ({
        day:          r.day,
        runs:         Number(r.runs),
        total_tokens: Number(r.total_tokens),
        cost_aud:     Number(r.cost_aud),
      })),
    });
  } catch (err) {
    console.error('[usage-stats]', err.message);
    res.status(500).json({ error: 'Failed to load usage stats.' });
  }
});

module.exports = router;
