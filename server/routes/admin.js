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

  // ── Google Gemini ─────────────────────────────────────────────────────────
  if (modelId.startsWith('gemini-')) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ ok: false, error: 'GEMINI_API_KEY environment variable is not set.' });
    }
    try {
      const { status, body } = await httpsPost(
        'generativelanguage.googleapis.com',
        `/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${apiKey}`,
        {},
        { contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: ok' }] }] }
      );
      const latencyMs = Date.now() - start;
      if (status !== 200) {
        const message = body?.error?.message ?? `HTTP ${status}`;
        return res.json({ ok: false, error: message, latencyMs });
      }
      return res.json({ ok: true, latencyMs });
    } catch (err) {
      return res.json({ ok: false, error: err.message, latencyMs: Date.now() - start });
    }
  }

  // ── Anthropic Claude ──────────────────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ ok: false, error: 'ANTHROPIC_API_KEY is not set on the server.' });
  }
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      modelId,
        max_tokens: 10,
        messages:   [{ role: 'user', content: 'Reply with the single word: ok' }],
      }),
    });
    const latencyMs = Date.now() - start;
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const message = body?.error?.message ?? `HTTP ${response.status}`;
      return res.json({ ok: false, error: message, latencyMs });
    }
    res.json({ ok: true, latencyMs });
  } catch (err) {
    res.json({ ok: false, error: err.message, latencyMs: Date.now() - start });
  }
});

router.get('/model-status', (req, res) => {
  res.json({
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    google:    !!process.env.GEMINI_API_KEY,
  });
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
 * Resolves the best enabled model for the org.
 * Prefers 'advanced' tier; falls back to first enabled, then Sonnet default.
 * Returns { id, inputPricePer1M, outputPricePer1M }.
 */
async function getDefaultModel(orgId) {
  const r = await pool.query(
    `SELECT value FROM system_settings WHERE org_id = $1 AND key = 'ai_models' LIMIT 1`,
    [orgId]
  );
  const models = Array.isArray(r.rows[0]?.value) ? r.rows[0].value : MODEL_DEFAULTS;
  const enabled = models.filter((m) => m.enabled);
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
  const Anthropic = require('@anthropic-ai/sdk');
  const { question, allowWrite = false } = req.body;
  if (!question?.trim()) return res.status(400).json({ error: 'No question provided.' });

  try {
    const [schema, modelDef] = await Promise.all([
      getDbSchema(),
      getDefaultModel(req.user.orgId),
    ]);

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await anthropic.messages.create({
      model: modelDef.id,
      max_tokens: 1024,
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

    const generatedSql = message.content[0]?.text?.trim() ?? '';
    if (!generatedSql) throw new Error('Claude returned an empty response.');

    // Log usage to usage_logs
    const tokensUsed = { input: message.usage.input_tokens, output: message.usage.output_tokens };
    const costAud = (
      tokensUsed.input  * (modelDef.inputPricePer1M  / 1_000_000) +
      tokensUsed.output * (modelDef.outputPricePer1M / 1_000_000)
    ) * AUD_PER_USD_SQL;
    logUsage({ orgId: req.user.orgId, userId: req.user.id, slug: 'sql-console-nlp', modelId: modelDef.id, tokensUsed, costAud }).catch(() => {});

    console.log(`[SQL Console NLP] ${req.user.email} (${modelDef.id}): "${question.slice(0, 80)}" → ${generatedSql.slice(0, 120)} [${tokensUsed.input}in/${tokensUsed.output}out, A$${costAud.toFixed(4)}]`);

    const data = await execSql(generatedSql, allowWrite, req.user.email);

    // Generate a plain-English answer for read-aloud
    const resultSummary = data.rows.length === 0
      ? 'The query returned no results.'
      : JSON.stringify(data.rows.slice(0, 20)); // cap rows sent to Claude
    const answerMsg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001', // fast + cheap for a one-sentence answer
      max_tokens: 256,
      messages: [{
        role: 'user',
        content: `Question: ${question}\n\nSQL results: ${resultSummary}\n\nAnswer the question in 1–2 plain English sentences based on the results. No markdown, no SQL.`,
      }],
    });
    const answer = answerMsg.content[0]?.text?.trim() ?? '';

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

  console.log(`[Diagnostics] Run by ${req.user.email} — ${results.filter(r => r.ok).length}/${results.length} passed`);
  res.json(results);
});

module.exports = router;
