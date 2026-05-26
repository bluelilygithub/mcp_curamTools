/**
 * admin.js — admin-only routes.
 * All routes require requireAuth + requirePermission('admin:access').
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
const { requirePermission } = require('../middleware/requirePermission');
const { grantRole, revokeRole, getUserRoles, getAgentAccessDecision } = require('../services/PermissionService');
const { createInvitation, resendInvitation } = require('../services/InvitationService');
const AgentConfigService = require('../platform/AgentConfigService');
const { SYSTEM_ROLE_OPTIONS, getDefaultAccess } = require('../platform/AgentAccessRegistry');
const { buildCredentialScopeReport } = require('../platform/credentialScopeRegistry');
const {
  resolveWorkflowContract,
  summariseWorkflowContract,
} = require('../platform/hybridWorkflowRegistry');
const {
  resolveTrustContract,
  summariseTrustContract,
} = require('../platform/agentTrustContract');
const CostGuardService = require('../services/CostGuardService');
const EmailTemplateService = require('../services/EmailTemplateService');
const { proposeLessonFromRun } = require('../services/LessonRepositoryService');

const router = express.Router();
router.use(requireAuth, requirePermission('admin:access'));

const SYSTEM_ROLE_NAMES = SYSTEM_ROLE_OPTIONS.map((role) => role.name);

// ── Users ─────────────────────────────────────────────────────────────────

router.get('/users', async (req, res) => {
  try {
    const res2 = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.phone, u.is_active, u.created_at,
              u.default_model_id, u.org_id, o.name AS org_name,
              array_agg(DISTINCT r.role_name) FILTER (WHERE r.role_name IS NOT NULL) AS roles,
              array_agg(DISTINCT d.name)      FILTER (WHERE d.id       IS NOT NULL) AS department_names
         FROM users u
         LEFT JOIN organizations o    ON o.id            = u.org_id
         LEFT JOIN user_roles r       ON r.user_id       = u.id
         LEFT JOIN user_departments ud ON ud.user_id      = u.id
         LEFT JOIN departments d       ON d.id            = ud.department_id
        WHERE u.org_id = $1
        GROUP BY u.id, o.name
        ORDER BY u.created_at DESC`,
      [req.user.orgId]
    );
    res.json(res2.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load users.' });
  }
});

// ── Organisations ─────────────────────────────────────────────────────────────

router.get('/organizations', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, org_type, created_at FROM organizations ORDER BY name ASC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load organisations.' });
  }
});

router.post('/organizations', async (req, res) => {
  const { name, orgType = 'internal' } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required.' });
  if (!['internal', 'demo'].includes(orgType)) return res.status(400).json({ error: 'Invalid org type.' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO organizations (name, org_type) VALUES ($1, $2) RETURNING id, name, org_type, created_at`,
      [name.trim(), orgType]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create organisation.' });
  }
});

// ── Invite ─────────────────────────────────────────────────────────────────

router.post('/users/invite', async (req, res) => {
  try {
    const { email, role = 'org_member', orgId } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required.' });
    const targetOrgId = orgId ? parseInt(orgId) : req.user.orgId;
    const result = await createInvitation(email, targetOrgId, role, req.user.id);
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
  const { firstName, lastName, phone, isActive, role, defaultModelId, orgId } = req.body;
  const userId = parseInt(req.params.id);
  try {
    await pool.query(
      `UPDATE users SET first_name = $1, last_name = $2, phone = $3, is_active = $4, default_model_id = $5
         ${orgId ? ', org_id = $7' : ''}
       WHERE id = $6`,
      orgId
        ? [firstName, lastName, phone, isActive, defaultModelId ?? null, userId, parseInt(orgId)]
        : [firstName, lastName, phone, isActive, defaultModelId ?? null, userId]
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

router.get('/access-roles', async (req, res) => {
  try {
    const { rows: customRoles } = await pool.query(
      `SELECT id, name, label, description, color
         FROM org_roles
        WHERE org_id = $1
        ORDER BY label`,
      [req.user.orgId]
    );
    res.json({
      systemRoles: SYSTEM_ROLE_OPTIONS,
      customRoles,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load access roles.' });
  }
});

router.put('/users/:id/system-roles', async (req, res) => {
  const userId = parseInt(req.params.id);
  const requestedRoles = Array.isArray(req.body.roleNames)
    ? [...new Set(req.body.roleNames.map((r) => String(r).trim()).filter(Boolean))]
    : [];
  const invalid = requestedRoles.filter((role) => !SYSTEM_ROLE_NAMES.includes(role));
  if (invalid.length > 0) {
    return res.status(400).json({ error: `Invalid system role: ${invalid[0]}` });
  }

  try {
    const check = await pool.query('SELECT id FROM users WHERE id = $1 AND org_id = $2', [userId, req.user.orgId]);
    if (!check.rows.length) return res.status(404).json({ error: 'User not found.' });

    const currentRoles = await getUserRoles(userId);
    const isRemovingOwnAdmin = userId === req.user.id
      && currentRoles.some((role) => role.role_name === 'org_admin')
      && !requestedRoles.includes('org_admin');
    if (isRemovingOwnAdmin) {
      return res.status(400).json({ error: 'You cannot remove your own admin role.' });
    }

    await pool.query(
      `DELETE FROM user_roles
        WHERE user_id = $1
          AND scope_type = 'global'
          AND role_name = ANY($2)`,
      [userId, SYSTEM_ROLE_NAMES]
    );
    for (const roleName of requestedRoles) {
      await grantRole(userId, roleName, { scopeType: 'global', scopeId: null }, req.user.id);
    }
    res.json({ ok: true, roleNames: requestedRoles });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update system roles.' });
  }
});

async function getUserAgentAccessPreview(userId, orgId) {
  const slugs = Object.keys(AgentConfigService.ADMIN_DEFAULTS).filter((s) => s !== '_platform');
  const rows = [];
  for (const slug of slugs) {
    const config = await AgentConfigService.getAdminConfig(slug, orgId);
    const defaultAccess = getDefaultAccess(slug);
    if (!defaultAccess.roleName) continue;
    const decision = await getAgentAccessDecision(userId, defaultAccess.roleName, config.allowed_roles);
    rows.push({
      slug,
      allowed: decision.allowed,
      reason: decision.reason,
      mode: decision.mode,
      requiredRoles: decision.requiredRoles ?? null,
      requiredPermission: decision.requiredPermission ?? defaultAccess.roleName,
      default_role: defaultAccess.roleName,
      default_label: defaultAccess.label,
    });
  }
  return rows;
}

router.get('/users/:id/access-preview', async (req, res) => {
  const userId = parseInt(req.params.id);
  try {
    const check = await pool.query('SELECT id FROM users WHERE id = $1 AND org_id = $2', [userId, req.user.orgId]);
    if (!check.rows.length) return res.status(404).json({ error: 'User not found.' });
    const roles = await getUserRoles(userId);
    const agents = await getUserAgentAccessPreview(userId, req.user.orgId);
    res.json({
      roles: roles.map((role) => role.role_name),
      agents,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load access preview.' });
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

const MODEL_DEFAULTS = AgentConfigService.MODEL_DEFAULTS;

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
    const allModels = modelsRow.rows.length > 0
      ? AgentConfigService.normalizeModelList(modelsRow.rows[0]?.value)
      : MODEL_DEFAULTS;

    const configs = await Promise.all(
      slugs.map(async (slug) => {
        const defaultAccess = getDefaultAccess(slug);
        return {
          slug,
          ...(await AgentConfigService.getAdminConfig(slug, req.user.orgId)),
          default_required_permission: defaultAccess.roleName,
          default_access_label:        defaultAccess.label,
          model_requirements: AgentConfigService.AGENT_MODEL_REQUIREMENTS[slug] ?? AgentConfigService.AGENT_MODEL_REQUIREMENTS._platform,
          recommended_model: AgentConfigService.getRecommendedModel(slug, allModels),
        };
      })
    );
    res.json(configs);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load agent configs.' });
  }
});

router.get('/agents/:slug', async (req, res) => {
  try {
    const config = await AgentConfigService.getAdminConfig(req.params.slug, req.user.orgId);
    const defaultAccess = getDefaultAccess(req.params.slug);
    res.json({
      ...config,
      default_required_permission: defaultAccess.roleName,
      default_access_label:        defaultAccess.label,
      model_requirements: AgentConfigService.AGENT_MODEL_REQUIREMENTS[req.params.slug] ?? AgentConfigService.AGENT_MODEL_REQUIREMENTS._platform,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load agent admin config.' });
  }
});

router.put('/agents/:slug', async (req, res) => {
  try {
    const patch = { ...req.body };
    if (Object.prototype.hasOwnProperty.call(patch, 'allowed_roles')) {
      const allowedRoles = Array.isArray(patch.allowed_roles)
        ? [...new Set(patch.allowed_roles.map((r) => String(r).trim()).filter(Boolean))]
        : [];
      const { rows: customRoles } = await pool.query(
        `SELECT name FROM org_roles WHERE org_id = $1`,
        [req.user.orgId]
      );
      const validRoles = new Set([
        ...SYSTEM_ROLE_OPTIONS.filter((role) => role.assignableToAgents !== false).map((role) => role.name),
        ...customRoles.map((r) => r.name),
      ]);
      const invalid = allowedRoles.filter((role) => !validRoles.has(role));
      if (invalid.length > 0) {
        return res.status(400).json({ error: `Invalid agent access role: ${invalid[0]}` });
      }
      patch.allowed_roles = allowedRoles.length > 0 ? allowedRoles : null;
    }

    const updated = await AgentConfigService.updateAdminConfig(
      req.params.slug,
      patch,
      req.user.id,
      req.user.orgId
    );
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update agent admin config.' });
  }
});

router.get('/agents/:slug/access-preview', async (req, res) => {
  try {
    const config = await AgentConfigService.getAdminConfig(req.params.slug, req.user.orgId);
    const defaultAccess = getDefaultAccess(req.params.slug);
    if (!defaultAccess.roleName) {
      return res.json({
        slug: req.params.slug,
        supported: false,
        users: [],
        allowedCount: 0,
        deniedCount: 0,
      });
    }

    const { rows: users } = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.is_active,
              array_agg(DISTINCT ur.role_name) FILTER (WHERE ur.role_name IS NOT NULL) AS roles
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id
        WHERE u.org_id = $1
        GROUP BY u.id
        ORDER BY u.email`,
      [req.user.orgId]
    );

    const decisions = [];
    for (const user of users) {
      const decision = await getAgentAccessDecision(user.id, defaultAccess.roleName, config.allowed_roles);
      decisions.push({
        id: user.id,
        email: user.email,
        name: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email,
        is_active: user.is_active,
        roles: user.roles ?? [],
        allowed: decision.allowed,
        reason: decision.reason,
      });
    }

    res.json({
      slug: req.params.slug,
      supported: true,
      mode: Array.isArray(config.allowed_roles) && config.allowed_roles.length > 0 ? 'configured_roles' : 'code_default',
      configuredRoles: config.allowed_roles ?? null,
      defaultRole: defaultAccess.roleName,
      defaultLabel: defaultAccess.label,
      allowedCount: decisions.filter((user) => user.allowed).length,
      deniedCount: decisions.filter((user) => !user.allowed).length,
      users: decisions,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load agent access preview.' });
  }
});

// ── Operations Overview ───────────────────────────────────────────────────

const PRIVACY_COVERAGE_BY_AGENT = {
  'doc-extractor': ['extraction'],
  'demo-document-analyzer': ['extraction'],
  'spec-validator': ['extraction'],
  'demo-spec-validator': ['extraction'],
  'not-interested-report': ['crm'],
};

function buildPostureSignals({ config, resolvedConfig, latestRun, usage, trustContract, workflowContract, privacyCoverage, resolutionError }) {
  const signals = [];
  if (resolutionError) {
    signals.push({ severity: 'critical', label: 'Model resolution error', detail: resolutionError });
  }
  if (config.enabled === false) {
    signals.push({ severity: 'warning', label: 'Disabled', detail: 'Agent kill switch is off.' });
  }
  if (!resolvedConfig?.model && !resolutionError) {
    signals.push({ severity: 'critical', label: 'No model', detail: 'No agent model or organisation default model is resolved.' });
  }
  if (!config.max_task_budget_aud) {
    signals.push({ severity: 'warning', label: 'No per-run budget', detail: 'This agent has no explicit max_task_budget_aud.' });
  }
  if (latestRun?.status === 'error') {
    signals.push({ severity: 'critical', label: 'Last run failed', detail: latestRun.error ?? 'Last run ended with error status.' });
  } else if (latestRun?.status === 'needs_review') {
    signals.push({ severity: 'warning', label: 'Review needed', detail: 'The latest run is waiting for human review.' });
  }
  if (Number(usage?.review_runs ?? 0) > 0) {
    signals.push({ severity: 'warning', label: 'Review backlog', detail: `${usage.review_runs} run(s) needed review in the last 30 days.` });
  }
  if (Number(usage?.error_runs ?? 0) > 0) {
    signals.push({ severity: 'warning', label: 'Recent errors', detail: `${usage.error_runs} error run(s) in the last 30 days.` });
  }
  if (trustContract?.dependency_contract?.length > 0) {
    signals.push({ severity: 'info', label: 'Chained report', detail: `${trustContract.dependency_contract.length} upstream dependency rule(s).` });
  }
  if (workflowContract) {
    signals.push({ severity: 'info', label: 'Hybrid workflow', detail: `${workflowContract.stage_count} stage(s), ${workflowContract.gate_count} gate(s).` });
  }
  if (privacyCoverage.length > 0) {
    signals.push({ severity: 'info', label: 'Privacy coverage', detail: privacyCoverage.join(', ') });
  }
  return signals;
}

router.get('/operations-overview', async (req, res) => {
  const orgId = req.user.orgId;
  const slugs = Object.keys(AgentConfigService.ADMIN_DEFAULTS).filter((slug) => slug !== '_platform');

  try {
    const [
      orgBudget,
      dailySpendAud,
      defaultModel,
      fallbackModel,
      extractionPrivacy,
      crmPrivacy,
      latestRuns,
      runAgg,
      usageAgg,
      operatorRows,
    ] = await Promise.all([
      AgentConfigService.getOrgBudgetSettings(orgId),
      CostGuardService.getDailyOrgSpendAud(orgId).catch(() => 0),
      AgentConfigService.getOrgDefaultModel(orgId).catch(() => null),
      AgentConfigService.getOrgFallbackModel(orgId).catch(() => null),
      AgentConfigService.getExtractionPrivacySettings(orgId).catch(() => ({ excluded_field_names: [] })),
      AgentConfigService.getCrmPrivacySettings(orgId).catch(() => ({ excluded_fields: [] })),
      pool.query(
        `SELECT DISTINCT ON (slug) slug, status, error, run_at, completed_at, result
           FROM agent_runs
          WHERE org_id = $1
          ORDER BY slug, run_at DESC`,
        [orgId]
      ),
      pool.query(
        `SELECT slug,
                COUNT(*)::int AS runs,
                COUNT(*) FILTER (WHERE status = 'needs_review')::int AS review_runs,
                COUNT(*) FILTER (WHERE status = 'error')::int AS error_runs,
                COALESCE(SUM((result->>'costAud')::numeric), 0)::numeric AS cost_aud,
                MAX(run_at) AS last_run_at
           FROM agent_runs
          WHERE org_id = $1 AND run_at >= NOW() - INTERVAL '30 days'
          GROUP BY slug`,
        [orgId]
      ),
      pool.query(
        `SELECT tool_slug AS slug,
                COUNT(*)::int AS usage_rows,
                COALESCE(SUM(cost_aud), 0)::numeric AS usage_cost_aud,
                COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens), 0)::bigint AS total_tokens,
                MAX(created_at) AS last_usage_at
           FROM usage_logs
          WHERE org_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
            AND tool_slug IS NOT NULL
          GROUP BY tool_slug`,
        [orgId]
      ),
      pool.query(
        `SELECT slug,
                custom_prompt IS NOT NULL AND length(trim(custom_prompt)) > 0 AS has_custom_prompt,
                intelligence_profile IS NOT NULL AS has_intelligence_profile
           FROM agent_configs
          WHERE org_id = $1 AND customer_id IS NULL`,
        [orgId]
      ),
    ]);

    const latestBySlug = new Map(latestRuns.rows.map((row) => [row.slug, row]));
    const runAggBySlug = new Map(runAgg.rows.map((row) => [row.slug, row]));
    const usageBySlug = new Map(usageAgg.rows.map((row) => [row.slug, row]));
    const operatorBySlug = new Map(operatorRows.rows.map((row) => [row.slug, row]));

    const agents = await Promise.all(slugs.map(async (slug) => {
      const config = await AgentConfigService.getAdminConfig(slug, orgId);
      let resolvedConfig = null;
      let resolutionError = null;
      try {
        resolvedConfig = await AgentConfigService.getResolvedAdminConfig(slug, orgId);
      } catch (err) {
        resolutionError = err.message;
      }

      const defaultAccess = getDefaultAccess(slug);
      const trustContract = summariseTrustContract(resolveTrustContract(slug, {}));
      const workflowContract = summariseWorkflowContract(resolveWorkflowContract(slug));
      const latestRun = latestBySlug.get(slug) ?? null;
      const runUsage = runAggBySlug.get(slug) ?? {};
      const tokenUsage = usageBySlug.get(slug) ?? {};
      const operatorConfig = operatorBySlug.get(slug) ?? {};
      const privacyCoverage = PRIVACY_COVERAGE_BY_AGENT[slug] ?? [];
      const signals = buildPostureSignals({
        config,
        resolvedConfig,
        latestRun,
        usage: runUsage,
        trustContract,
        workflowContract,
        privacyCoverage,
        resolutionError,
      });

      return {
        slug,
        enabled: config.enabled !== false,
        model: resolvedConfig?.model ?? config.model ?? null,
        model_source: resolvedConfig?.model_source ?? (config.model ? 'agent-config' : null),
        fallback_model: resolvedConfig?.fallback_model ?? null,
        fallback_model_source: resolvedConfig?.fallback_model_source ?? null,
        max_tokens: config.max_tokens ?? null,
        max_iterations: config.max_iterations ?? null,
        max_task_budget_aud: config.max_task_budget_aud ?? null,
        allowed_roles: config.allowed_roles ?? null,
        default_access_label: defaultAccess.label,
        default_required_permission: defaultAccess.roleName,
        access_mode: Array.isArray(config.allowed_roles) && config.allowed_roles.length > 0 ? 'configured_roles' : 'code_default',
        has_custom_prompt: operatorConfig.has_custom_prompt === true,
        has_intelligence_profile: operatorConfig.has_intelligence_profile === true,
        trust_contract: trustContract,
        workflow_contract: workflowContract,
        privacy_coverage: privacyCoverage,
        latest_run: latestRun ? {
          id: latestRun.id,
          status: latestRun.status,
          error: latestRun.error,
          run_at: latestRun.run_at,
          completed_at: latestRun.completed_at,
        } : null,
        usage_30d: {
          runs: Number(runUsage.runs ?? 0),
          review_runs: Number(runUsage.review_runs ?? 0),
          error_runs: Number(runUsage.error_runs ?? 0),
          run_cost_aud: Number(runUsage.cost_aud ?? 0),
          usage_rows: Number(tokenUsage.usage_rows ?? 0),
          usage_cost_aud: Number(tokenUsage.usage_cost_aud ?? 0),
          total_tokens: Number(tokenUsage.total_tokens ?? 0),
          last_run_at: runUsage.last_run_at ?? null,
          last_usage_at: tokenUsage.last_usage_at ?? null,
        },
        resolution_error: resolutionError,
        signals,
      };
    }));

    const summary = {
      agents_total: agents.length,
      enabled_agents: agents.filter((agent) => agent.enabled).length,
      agents_with_errors: agents.filter((agent) => agent.signals.some((signal) => signal.severity === 'critical')).length,
      agents_needing_attention: agents.filter((agent) => agent.signals.some((signal) => ['critical', 'warning'].includes(signal.severity))).length,
      workflow_agents: agents.filter((agent) => agent.workflow_contract).length,
      chained_agents: agents.filter((agent) => agent.trust_contract?.dependency_contract?.length > 0).length,
      daily_budget_aud: orgBudget.max_daily_org_budget_aud ?? null,
      daily_spend_aud: Number(dailySpendAud ?? 0),
      default_model: defaultModel,
      fallback_model: fallbackModel,
      extraction_privacy_fields: extractionPrivacy.excluded_field_names?.length ?? 0,
      crm_privacy_fields: crmPrivacy.excluded_fields?.length ?? 0,
    };

    res.json({
      generated_at: new Date().toISOString(),
      summary,
      privacy: {
        extraction: extractionPrivacy,
        crm: crmPrivacy,
        note: 'Privacy exclusions are targeted controls for extraction and CRM flows, not a universal prompt redaction layer.',
      },
      agents,
    });
  } catch (err) {
    console.error('[operations-overview]', err.message);
    res.status(500).json({ error: 'Failed to load operations overview.' });
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

router.get('/credential-scopes', async (req, res) => {
  try {
    const report = await buildCredentialScopeReport(req.user.orgId);
    res.json(report);
  } catch (err) {
    console.error('[admin/credential-scopes]', err.message);
    res.status(500).json({ error: 'Failed to load credential scope report.' });
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

// DELETE /admin/logs — empty all usage logs for this org
router.delete('/logs', async (req, res) => {
  try {
    await pool.query('DELETE FROM usage_logs WHERE org_id = $1', [req.user.orgId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to empty usage logs.' });
  }
});

// GET /admin/logs/export — export usage logs as JSON
router.get('/logs/export', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT ul.id, ul.tool_slug, ul.model_id, ul.input_tokens, ul.output_tokens,
              ul.cost_usd, ul.created_at,
              u.email AS user_email
         FROM usage_logs ul
         LEFT JOIN users u ON u.id = ul.user_id
        WHERE ul.org_id = $1
        ORDER BY ul.created_at DESC`,
      [req.user.orgId]
    );
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="usage-logs.json"');
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to export usage logs.' });
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

// DELETE /admin/server-logs — empty all server logs
router.delete('/server-logs', async (req, res) => {
  try {
    await pool.query('DELETE FROM app_logs');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to empty server logs.' });
  }
});

// GET /admin/server-logs/export — export server logs as JSON
router.get('/server-logs/export', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, level, message, meta, created_at
         FROM app_logs
        ORDER BY created_at DESC`
    );
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="server-logs.json"');
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to export server logs.' });
  }
});

// ── SQL Console ───────────────────────────────────────────────────────────

const { logUsage } = require('../services/UsageLogger');
const { cleanString, rejectUnknownKeys, cleanBoolean } = require('../platform/inputGuards');
const AUD_PER_USD_SQL = 1.55;
const SQL_ROW_LIMIT = 500;
const SQL_TIMEOUT_MS = 10_000;

/**
 * Resolves the best model for the org.
 * Priority: (1) explicit modelId override, (2) org default model (even if not in ai_models —
 * supports custom providers), (3) first enabled advanced tier, (4) first enabled model.
 * Returns { id, inputPricePer1M, outputPricePer1M }.
 */
async function getDefaultModel(orgId, modelId = null) {
  const [models, orgDefaultId] = await Promise.all([
    AgentConfigService.getOrgModels(orgId),
    AgentConfigService.getOrgDefaultModel(orgId),
  ]);
  const enabled = models.filter((m) => m.enabled);

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
  const resolved =
    enabled.find((m) => m.tier === 'advanced') ??
    enabled[0];

  if (!resolved) {
    throw Object.assign(new Error('No enabled model is configured. Set a default model in Settings > Models.'), { status: 400 });
  }
  return resolved;
}

const WRITE_KEYWORDS = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'TRUNCATE', 'ALTER', 'CREATE', 'GRANT', 'REVOKE'];
const READ_KEYWORDS = ['SELECT', 'WITH', 'SHOW', 'EXPLAIN'];
const WRITE_CONFIRMATION = 'EXECUTE WRITE';

function firstSqlKeyword(sql) {
  return sql.trim().replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').trim().split(/\s+/)[0].toUpperCase();
}

function stripTrailingSemicolon(sql) {
  return sql.trim().replace(/;\s*$/, '');
}

function hasMultipleStatements(sql) {
  return /;\s*\S/.test(sql.trim());
}

function isWriteSql(sql) {
  return WRITE_KEYWORDS.includes(firstSqlKeyword(sql)) || !READ_KEYWORDS.includes(firstSqlKeyword(sql));
}

function addReadLimit(sql) {
  const kw = firstSqlKeyword(sql);
  if (!['SELECT', 'WITH'].includes(kw)) return stripTrailingSemicolon(sql);
  return `SELECT * FROM (${stripTrailingSemicolon(sql)}) AS guarded_query LIMIT ${SQL_ROW_LIMIT}`;
}

async function logSqlAudit({ req, sql, source, allowWrite, writeConfirmed, status, command = null, rowCount = null, duration = null, error = null, generatedFromNlp = false }) {
  await pool.query(
    `INSERT INTO sql_audit_logs
      (org_id, user_id, source, sql_text, command, allow_write, write_confirmed, status, row_count, duration_ms, error_message, generated_from_nlp)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      req.user.orgId,
      req.user.id,
      source,
      sql,
      command,
      allowWrite,
      writeConfirmed,
      status,
      rowCount,
      duration,
      error,
      generatedFromNlp,
    ]
  ).catch((err) => console.error('[SQL Audit]', err.message));
}

async function execSql(sql, { allowWrite, writeConfirmation, source, generatedFromNlp, req }) {
  const kw = firstSqlKeyword(sql);
  const writeSql = isWriteSql(sql);
  const writeConfirmed = String(writeConfirmation ?? '').trim() === WRITE_CONFIRMATION;
  const auditBase = { req, sql, source, allowWrite, writeConfirmed, generatedFromNlp };

  try {
    if (hasMultipleStatements(sql)) {
      throw Object.assign(new Error('Multiple SQL statements are blocked. Run one statement at a time.'), { status: 400 });
    }
    if (writeSql && !allowWrite) {
      throw Object.assign(new Error(`Write or non-read statements are blocked. Enable writes to run ${kw}.`), { status: 400 });
    }
    if (writeSql && !writeConfirmed) {
      throw Object.assign(new Error(`Type "${WRITE_CONFIRMATION}" to confirm write execution.`), { status: 400 });
    }

    const executableSql = writeSql ? stripTrailingSemicolon(sql) : addReadLimit(sql);
    const start = Date.now();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL statement_timeout = ${SQL_TIMEOUT_MS}`);
      const result = await client.query(executableSql);
      await client.query('COMMIT');
      const duration = Date.now() - start;
      const rows = result.rows ?? [];
      const columns = rows.length > 0 ? Object.keys(rows[0]) : (result.fields?.map(f => f.name) ?? []);
      console.log(`[SQL Console] ${req.user.email} ran: ${sql.slice(0, 120).replace(/\n/g, ' ')} — ${rows.length} rows in ${duration}ms`);
      await logSqlAudit({ ...auditBase, status: 'success', command: result.command ?? kw, rowCount: result.rowCount ?? rows.length, duration });
      return {
        command: result.command ?? kw,
        rowCount: result.rowCount ?? rows.length,
        columns,
        rows,
        duration,
        guarded: {
          rowLimit: writeSql ? null : SQL_ROW_LIMIT,
          timeoutMs: SQL_TIMEOUT_MS,
          writeConfirmed,
        },
      };
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    await logSqlAudit({ ...auditBase, status: 'error', command: kw, error: err.message });
    throw err;
  }
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
  try {
    rejectUnknownKeys(req.body, ['sql', 'allowWrite', 'writeConfirmation', 'source', 'generatedFromNlp'], 'SQL request');
    const sql = cleanString(req.body.sql, { max: 20_000, field: 'sql', required: true });
    const data = await execSql(sql, {
      allowWrite: cleanBoolean(req.body.allowWrite),
      writeConfirmation: req.body.writeConfirmation,
      source: cleanString(req.body.source ?? 'manual', { max: 40, field: 'source' }) || 'manual',
      generatedFromNlp: cleanBoolean(req.body.generatedFromNlp),
      req,
    });
    res.json(data);
  } catch (err) {
    console.error(`[SQL Console] Error for ${req.user.email}:`, err.message);
    res.status(err.status ?? 400).json({ error: err.message });
  }
});

router.post('/sql/nlp', async (req, res) => {
  const { getProvider } = require('../platform/AgentOrchestrator');
  const { getCustomProviders } = require('../platform/AgentConfigService');

  try {
    rejectUnknownKeys(req.body, ['question', 'modelId'], 'SQL NLP request');
    const question = cleanString(req.body.question, { max: 2000, field: 'question', required: true, scan: true });
    const modelId = cleanString(req.body.modelId ?? '', { max: 200, field: 'modelId' }) || null;
    const { buildSystemPrompt } = require('../agents/sqlNlp/prompt');

    const [schema, modelDef, customProviders, sqlNlpConfig] = await Promise.all([
      getDbSchema(),
      getDefaultModel(req.user.orgId, modelId),
      getCustomProviders(req.user.orgId),
      AgentConfigService.getAdminConfig('sql-nlp', req.user.orgId).catch(() => ({})),
    ]);

    const provider = getProvider(modelDef.id, customProviders);
    const instructions = buildSystemPrompt(sqlNlpConfig);

    const response = await provider.chat({
      model: modelDef.id,
      max_tokens: 8192,
      system: null,
      messages: [{
        role: 'user',
        content: `${instructions}\n\n## Schema\n${schema}\n\n## Question\n${question}`,
      }],
    });

    const generatedSql = response.content[0]?.text?.trim() ?? '';
    if (!generatedSql) throw new Error('Model returned an empty response.');

    if (generatedSql.startsWith('-- CANNOT_ANSWER:')) {
      const reason = generatedSql.replace('-- CANNOT_ANSWER:', '').trim();
      return res.json({ cannotAnswer: true, reason });
    }

    // Log usage to usage_logs
    const tokensUsed = { input: response.usage.input_tokens, output: response.usage.output_tokens };
    const costAud = (
      tokensUsed.input  * (modelDef.inputPricePer1M  / 1_000_000) +
      tokensUsed.output * (modelDef.outputPricePer1M / 1_000_000)
    ) * AUD_PER_USD_SQL;
    logUsage({ orgId: req.user.orgId, userId: req.user.id, slug: 'sql-console-nlp', modelId: modelDef.id, tokensUsed, costAud }).catch(() => {});

    console.log(`[SQL Console NLP] ${req.user.email} (${modelDef.id}): "${question.slice(0, 80)}" → ${generatedSql.slice(0, 120)} [${tokensUsed.input}in/${tokensUsed.output}out, A$${costAud.toFixed(4)}]`);

    proposeLessonFromRun({
      agentId:        'sql-console-nlp',
      organisationId: req.user.orgId,
      runId:          null,
      summary:        `Question: ${question}\nGenerated SQL for human review: ${generatedSql}`,
    }).catch((e) => console.warn('[SQL Console NLP] lesson proposal skipped:', e.message));

    res.json({
      generatedSql,
      modelId: modelDef.id,
      tokensUsed,
      costAud,
      requiresExecutionReview: true,
      command: firstSqlKeyword(generatedSql),
      writeLike: isWriteSql(generatedSql),
    });
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

router.post('/claude-session-config/start', async (req, res) => {
  try {
    const current = await pool.query(
      `SELECT value FROM system_settings WHERE org_id = $1 AND key = 'claude_session_config' LIMIT 1`,
      [req.user.orgId]
    );
    const existing = { ...CLAUDE_SESSION_DEFAULTS, ...(current.rows[0]?.value ?? {}) };
    const merged   = { ...existing, session_started_at: new Date().toISOString() };
    await pool.query(
      `INSERT INTO system_settings (org_id, key, value, updated_by, updated_at)
       VALUES ($1, 'claude_session_config', $2, $3, NOW())
       ON CONFLICT (org_id, key) DO UPDATE SET value = $2, updated_by = $3, updated_at = NOW()`,
      [req.user.orgId, JSON.stringify(merged), req.user.id]
    );
    res.json(merged);
  } catch (err) {
    res.status(500).json({ error: 'Failed to record session start.' });
  }
});

router.post('/claude-session-config/clear-start', async (req, res) => {
  try {
    const current = await pool.query(
      `SELECT value FROM system_settings WHERE org_id = $1 AND key = 'claude_session_config' LIMIT 1`,
      [req.user.orgId]
    );
    const existing = { ...CLAUDE_SESSION_DEFAULTS, ...(current.rows[0]?.value ?? {}) };
    const { session_started_at: _removed, ...merged } = existing;
    await pool.query(
      `INSERT INTO system_settings (org_id, key, value, updated_by, updated_at)
       VALUES ($1, 'claude_session_config', $2, $3, NOW())
       ON CONFLICT (org_id, key) DO UPDATE SET value = $2, updated_by = $3, updated_at = NOW()`,
      [req.user.orgId, JSON.stringify(merged), req.user.id]
    );
    res.json(merged);
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear session start.' });
  }
});

// ── Competitor Settings ───────────────────────────────────────────────────
//
// GET  /admin/competitors — returns org competitor list
// PUT  /admin/competitors — replaces competitor list (max 10)

router.get('/competitors', async (req, res) => {
  try {
    const settings = await AgentConfigService.getCompetitorSettings(req.user.orgId);
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load competitor settings.' });
  }
});

router.put('/competitors', async (req, res) => {
  try {
    const raw = req.body.competitors;
    if (!Array.isArray(raw)) return res.status(400).json({ error: 'competitors must be an array.' });

    const competitors = raw
      .slice(0, 10)
      .map((c) => ({
        name:  (c.name  || '').trim().slice(0, 100),
        url:   (c.url   || '').trim().slice(0, 300),
        notes: (c.notes || '').trim().slice(0, 200) || undefined,
      }))
      .filter((c) => c.name && c.url);

    const updated = await AgentConfigService.updateCompetitorSettings(
      req.user.orgId,
      { competitors },
      req.user.id
    );
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update competitor settings.' });
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

// ── Agent Trust ────────────────────────────────────────────────────────────
//
// GET /admin/agent-trust
// Review queue for agent outputs that have weak evidence, stale dependencies,
// or data integrity warnings. Uses existing agent_runs result metadata only.

function deriveTrustSignals(run) {
  const result = run.result ?? {};
  const bounds = Array.isArray(result.boundsFailed) ? result.boundsFailed : [];
  const dependencyWarnings = Array.isArray(result.report_dependency_warnings)
    ? result.report_dependency_warnings
    : [];
  const gapReview = result.data_gap_review ?? {};
  const signals = [];

  for (const warning of bounds) {
    const category = warning.category ?? 'bounds_warning';
    let reason = warning.message ?? 'Run has a data integrity warning.';
    if (category === 'missing_gap_section') reason = 'Required Data Gaps section was missing.';
    if (category === 'silent_data_gap') reason = warning.message ?? 'A source returned no data but the report did not disclose it.';
    signals.push({
      type: category,
      severity: warning.severity ?? 'review',
      source: warning.label ?? warning.tool ?? 'run',
      reason,
      details: warning.details ?? [],
      action: warning.action ?? null,
      evidenceLevel: warning.evidenceLevel ?? null,
    });
  }

  for (const warning of dependencyWarnings) {
    const label = warning.label ?? warning.slug ?? 'Dependency';
    const reason = warning.reason === 'stale'
      ? `${label} dependency is stale (${warning.ageDays} days old).`
      : `${label} dependency is marked ${warning.reason}.`;
    signals.push({
      type: `dependency_${warning.reason}`,
      severity: 'warn',
      source: warning.slug ?? 'dependency',
      reason,
      details: [
        warning.runId ? `run: ${warning.runId}` : null,
        warning.policy ? `policy: ${warning.policy}` : null,
      ].filter(Boolean),
    });
  }

  if (result.report_dependency_error?.details?.length > 0) {
    for (const detail of result.report_dependency_error.details) {
      signals.push({
        type: `dependency_${detail.reason ?? 'missing'}`,
        severity: 'error',
        source: detail.slug ?? 'dependency',
        reason: `${detail.label ?? detail.slug ?? 'Dependency'} could not be resolved before the run started.`,
        details: [
          detail.allowedStatuses ? `allowed: ${detail.allowedStatuses.join(', ')}` : null,
          detail.maxAgeDays != null ? `max age: ${detail.maxAgeDays} days` : null,
        ].filter(Boolean),
      });
    }
  }

  if (run.status === 'needs_review' && signals.length === 0) {
    signals.push({
      type: 'needs_review',
      severity: 'review',
      source: run.slug,
      reason: 'Run is marked needs_review.',
    });
  }

  if (run.status === 'error') {
    signals.push({
      type: 'error',
      severity: 'error',
      source: run.slug,
      reason: run.error ?? 'Run ended with an error.',
    });
  }

  return {
    signals,
    declaredDataGaps: Array.isArray(result.data_gaps) ? result.data_gaps : [],
    confirmedDataGaps: Array.isArray(gapReview.confirmedGaps) ? gapReview.confirmedGaps : [],
    silentDataGaps: Array.isArray(gapReview.silentGaps) ? gapReview.silentGaps : [],
    fabricatedDataGaps: Array.isArray(gapReview.fabricatedGaps) ? gapReview.fabricatedGaps : [],
    dependencies: Array.isArray(result.report_dependencies) ? result.report_dependencies : [],
    dependencyContract: Array.isArray(result.report_dependency_contract)
      ? result.report_dependency_contract
      : result.trust_contract?.dependency_contract ?? [],
    dependencyWarnings,
    workflowContract: result.workflow_contract ?? summariseWorkflowContract(resolveWorkflowContract(run.slug)),
  };
}

function deriveRunObservability(run) {
  const result = run.result ?? {};
  const tokens = result.tokensUsed ?? {};
  const runAt = run.run_at ? new Date(run.run_at).getTime() : null;
  const completedAt = run.completed_at ? new Date(run.completed_at).getTime() : null;
  const traceSummary = result.trace_summary ?? {};
  const fallbackEvents = Array.isArray(traceSummary.fallback_events) ? traceSummary.fallback_events : [];
  const progressLog = Array.isArray(result.progressLog) ? result.progressLog : [];
  const capabilityWarnings = [
    ...(Array.isArray(result.capability_warnings) ? result.capability_warnings : []),
    ...(Array.isArray(result.fallback_capability_warnings) ? result.fallback_capability_warnings : []),
  ];

  return {
    model: result.model ?? null,
    model_source: result.model_source ?? null,
    fallback_model: result.fallback_model ?? null,
    fallback_model_source: result.fallback_model_source ?? null,
    fallback_used: fallbackEvents.length > 0,
    fallback_events: fallbackEvents,
    prompt_version: result.prompt_version ?? null,
    cost_aud: Number(result.costAud ?? 0),
    tokens: {
      input: Number(tokens.input ?? 0),
      output: Number(tokens.output ?? 0),
      cacheRead: Number(tokens.cacheRead ?? 0),
      cacheWrite: Number(tokens.cacheWrite ?? 0),
    },
    duration_ms: runAt && completedAt ? Math.max(0, completedAt - runAt) : null,
    progress_count: progressLog.length,
    trace_summary: {
      iterations: Number(traceSummary.iterations ?? 0),
      tool_calls: Array.isArray(traceSummary.tool_calls) ? traceSummary.tool_calls : [],
    },
    capability_warnings: capabilityWarnings,
  };
}

router.get('/agent-trust', async (req, res) => {
  const orgId = req.user.orgId;
  const days = Math.min(Math.max(parseInt(req.query.days ?? '30', 10), 1), 90);
  const scope = req.query.scope === 'review' ? 'review' : 'all';
  const includeAllRuns = scope === 'all';

  try {
    const { rows } = await pool.query(
      `SELECT id, slug, status, result, error, run_at, completed_at
         FROM agent_runs
        WHERE org_id = $1
          AND run_at >= NOW() - ($2 || ' days')::interval
          AND ($3::boolean OR (
            status = 'needs_review'
            OR status = 'error'
            OR (result IS NOT NULL AND result ? 'data_gap_review')
            OR (result IS NOT NULL AND result ? 'report_dependency_warnings')
          ))
        ORDER BY run_at DESC
        LIMIT 100`,
      [orgId, days, includeAllRuns]
    );

    const runs = rows.map((run) => {
      const trust = deriveTrustSignals(run);
      const observability = deriveRunObservability(run);
      return {
        id: run.id,
        slug: run.slug,
        status: run.status,
        run_at: run.run_at,
        completed_at: run.completed_at,
        error: run.error,
        result: run.result,
        observability,
        ...trust,
      };
    });

    const summary = {
      total_runs: runs.length,
      runs_needing_review: runs.filter((run) => run.status === 'needs_review').length,
      error_runs: runs.filter((run) => run.status === 'error').length,
      runs_with_signals: runs.filter((run) => run.signals.length > 0).length,
      clean_runs: runs.filter((run) => run.signals.length === 0).length,
      silent_data_gaps: runs.reduce((sum, run) => sum + run.silentDataGaps.length, 0),
      missing_gap_sections: runs.reduce(
        (sum, run) => sum + run.signals.filter((signal) => signal.type === 'missing_gap_section').length,
        0
      ),
      stale_chained_dependencies: runs.reduce(
        (sum, run) => sum + run.signals.filter((signal) => signal.type === 'dependency_stale').length,
        0
      ),
      total_signals: runs.reduce((sum, run) => sum + run.signals.length, 0),
      total_cost_aud: runs.reduce((sum, run) => sum + Number(run.observability.cost_aud ?? 0), 0),
      fallback_runs: runs.filter((run) => run.observability.fallback_used).length,
      total_input_tokens: runs.reduce((sum, run) => sum + Number(run.observability.tokens.input ?? 0), 0),
      total_output_tokens: runs.reduce((sum, run) => sum + Number(run.observability.tokens.output ?? 0), 0),
    };

    res.json({ days, scope, summary, runs });
  } catch (err) {
    console.error('[agent-trust]', err.message);
    res.status(500).json({ error: 'Failed to load agent trust queue.' });
  }
});

// ── Usage Warnings ────────────────────────────────────────────────────────
//
// GET /admin/usage-warnings
// Computes proactive warnings from usage_logs. Returns warnings[].
// Checks: budget pace, agent over budget, cache health, cost spike,
//         stale agents, overkill model tier.

function fmtCompactTokens(n) {
  const value = Number(n ?? 0);
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function getLowCacheDrivers(rows, limit = 3) {
  return rows
    .map((row) => {
      const totalInput = Number(row.total_input ?? 0);
      const cacheRead = Number(row.cache_read ?? 0);
      return {
        tool_slug: row.tool_slug,
        runs: Number(row.runs ?? 0),
        total_input: totalInput,
        cache_read: cacheRead,
        cost_aud: Number(row.cost_aud ?? 0),
        cache_hit_rate: totalInput > 0 ? cacheRead / totalInput : 0,
      };
    })
    .filter((row) => row.total_input > 0 && row.cache_hit_rate < 0.05)
    .sort((a, b) => b.total_input - a.total_input)
    .slice(0, limit);
}

function describeCacheDrivers(drivers) {
  if (!drivers.length) return '';
  return drivers
    .map((d) => `${d.tool_slug} (${fmtCompactTokens(d.total_input)} input, ${(d.cache_hit_rate * 100).toFixed(1)}% cache)`)
    .join(', ');
}

router.get('/usage-warnings', async (req, res) => {
  const orgId = req.user.orgId;

  try {
    const [
      budgetSettings,
      daily7dRes,
      cacheRes,
      cacheByToolRes,
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
        `SELECT COALESCE(tool_slug, 'unknown') AS tool_slug,
                COUNT(*)::int AS runs,
                COALESCE(SUM(cache_read_tokens), 0)::bigint AS cache_read,
                COALESCE(SUM(input_tokens + cache_read_tokens + cache_creation_tokens), 0)::bigint AS total_input,
                COALESCE(SUM(cost_aud), 0)::numeric AS cost_aud
           FROM usage_logs
          WHERE org_id = $1 AND created_at >= NOW() - INTERVAL '7 days'
          GROUP BY tool_slug
          ORDER BY total_input DESC
          LIMIT 8`,
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
          AgentConfigService.getAdminConfig(r.tool_slug, req.user.orgId).then((cfg) => ({ slug: r.tool_slug, cfg, row: r }))
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
        const drivers = getLowCacheDrivers(cacheByToolRes.rows);
        const driverText = describeCacheDrivers(drivers);
        warnings.push({
          type: 'cache_health',
          severity: 'warning',
          title: 'Low cache hit rate',
          detail: `${(hitRate * 100).toFixed(1)}% over last 7 days.${driverText ? ` Largest low-cache input drivers: ${driverText}.` : ''} This may be expected for document, live-data, or pre-fetch agents; optimise these first only if cost pressure appears.`,
        });
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
    const allModels = modelsRow.rows.length > 0
      ? AgentConfigService.normalizeModelList(modelsRow.rows[0]?.value)
      : MODEL_DEFAULTS;
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

// ── Usage Intelligence ─────────────────────────────────────────────────────
//
// GET /admin/usage-intelligence
// Management summary for Admin > Usage: health, forecast, cost drivers,
// and concrete actions derived from the same usage data as warnings.

function daysInMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function usageAction({ type, severity = 'info', title, detail, action, metric = null }) {
  return { type, severity, title, detail, action, metric };
}

function buildUsageAccountingDiagnostics({ modelUsageRows, models, zeroCostRunsWithTokens, cacheRow, recentRuns }) {
  const modelMap = new Map(models.map((model) => [model.id, model]));
  const usageByModel = new Map();

  for (const row of modelUsageRows) {
    const modelId = row.model_id ?? 'unknown';
    const current = usageByModel.get(modelId) ?? { model_id: modelId, runs: 0 };
    current.runs += Number(row.runs ?? 0);
    usageByModel.set(modelId, current);
  }

  const modelPricing = [...usageByModel.values()].map((usage) => {
    const model = modelMap.get(usage.model_id);
    return {
      ...usage,
      listed_in_catalogue: !!model,
      ...CostGuardService.describePricingForModel(usage.model_id, model),
    };
  });

  const fallbackPricedModels = modelPricing.filter((entry) => entry.source === 'fallback_sonnet');
  const providerPricedModels = modelPricing.filter((entry) => entry.source === 'provider_prefix' || entry.source === 'known_table');
  const configuredPricedModels = modelPricing.filter((entry) => entry.source === 'configured_model');
  const cacheTrackedRuns = Number(cacheRow?.runs ?? 0);
  const cacheReadTokens = Number(cacheRow?.cache_read ?? 0);

  const warnings = [];
  if (zeroCostRunsWithTokens > 0) {
    warnings.push({
      type: 'zero_cost_with_tokens',
      severity: 'warning',
      title: 'Some usage has tokens but zero cost',
      detail: `${zeroCostRunsWithTokens} recent run${zeroCostRunsWithTokens === 1 ? '' : 's'} recorded tokens with no AUD cost.`,
      action: 'Check model pricing and direct routes that bypass the shared cost guard.',
    });
  }
  if (fallbackPricedModels.length > 0) {
    warnings.push({
      type: 'fallback_pricing',
      severity: 'info',
      title: 'Some models use fallback pricing',
      detail: fallbackPricedModels.map((entry) => entry.model_id).join(', '),
      action: 'Add these models to Settings > Models with explicit input/output prices for cleaner reporting.',
    });
  }

  return {
    accounting_mode: 'response_delta',
    accounting_label: 'Live budget checks use per-response token deltas',
    recent_runs: recentRuns,
    zero_cost_runs_with_tokens: zeroCostRunsWithTokens,
    cache_tracking: {
      tracked_runs: cacheTrackedRuns,
      cache_read_tokens: cacheReadTokens,
      provider_note: cacheReadTokens > 0
        ? 'Prompt cache reads are being reported by at least one provider.'
        : 'No cache reads reported in the last 7 days. This is normal for non-Anthropic providers or low-volume periods.',
    },
    pricing_sources: {
      configured_model: configuredPricedModels.length,
      built_in_or_prefix: providerPricedModels.length,
      fallback_sonnet: fallbackPricedModels.length,
    },
    model_pricing: modelPricing.sort((a, b) => b.runs - a.runs).slice(0, 8),
    warnings,
  };
}

router.get('/usage-intelligence', async (req, res) => {
  const orgId = req.user.orgId;

  try {
    const [
      budgetSettings,
      monthRes,
      daily7dRes,
      cacheRes,
      cacheByToolRes,
      spikeRes,
      topToolsRes,
      modelUsageRes,
      modelsRow,
      zeroCostRes,
    ] = await Promise.all([
      AgentConfigService.getOrgBudgetSettings(orgId),

      pool.query(
        `SELECT COALESCE(SUM(cost_aud), 0)::numeric AS cost_aud,
                COUNT(*)::int AS runs
           FROM usage_logs
          WHERE org_id = $1
            AND created_at >= date_trunc('month', NOW())`,
        [orgId]
      ),

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
        `SELECT COALESCE(tool_slug, 'unknown') AS tool_slug,
                COUNT(*)::int AS runs,
                COALESCE(SUM(cache_read_tokens), 0)::bigint AS cache_read,
                COALESCE(SUM(input_tokens + cache_read_tokens + cache_creation_tokens), 0)::bigint AS total_input,
                COALESCE(SUM(cost_aud), 0)::numeric AS cost_aud
           FROM usage_logs
          WHERE org_id = $1 AND created_at >= NOW() - INTERVAL '7 days'
          GROUP BY tool_slug
          ORDER BY total_input DESC
          LIMIT 8`,
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
        `SELECT COALESCE(tool_slug, 'unknown') AS tool_slug,
                COUNT(*)::int AS runs,
                COALESCE(SUM(cost_aud), 0)::numeric AS cost_aud,
                COALESCE(AVG(cost_aud), 0)::numeric AS avg_cost_aud,
                COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens), 0)::bigint AS total_tokens,
                MAX(created_at) AS last_run_at
           FROM usage_logs
          WHERE org_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
          GROUP BY tool_slug
          ORDER BY cost_aud DESC
          LIMIT 5`,
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

      pool.query(
        `SELECT COUNT(*)::int AS runs
           FROM usage_logs
          WHERE org_id = $1
            AND created_at >= NOW() - INTERVAL '30 days'
            AND COALESCE(cost_aud, 0) = 0
            AND COALESCE(input_tokens, 0)
              + COALESCE(output_tokens, 0)
              + COALESCE(cache_read_tokens, 0)
              + COALESCE(cache_creation_tokens, 0) > 0`,
        [orgId]
      ),
    ]);

    const monthCost = Number(monthRes.rows[0]?.cost_aud ?? 0);
    const monthRuns = Number(monthRes.rows[0]?.runs ?? 0);
    const now = new Date();
    const dayOfMonth = Math.max(now.getDate(), 1);
    const projectedMonthAud = dayOfMonth > 0 ? (monthCost / dayOfMonth) * daysInMonth(now) : 0;

    const daily7Rows = daily7dRes.rows;
    const avg7dAud = daily7Rows.length > 0
      ? daily7Rows.reduce((sum, row) => sum + Number(row.cost_aud), 0) / daily7Rows.length
      : 0;

    const maxDaily = budgetSettings.max_daily_org_budget_aud;
    const dailyBudgetPct = maxDaily ? avg7dAud / maxDaily : null;

    const cacheRow = cacheRes.rows[0] ?? {};
    const totalInput = Number(cacheRow.total_input ?? 0);
    const cacheHitRate = totalInput > 0 ? Number(cacheRow.cache_read ?? 0) / totalInput : 0;
    const lowCacheDrivers = getLowCacheDrivers(cacheByToolRes.rows);
    const lowCacheDriverText = describeCacheDrivers(lowCacheDrivers);

    const spikeRow = spikeRes.rows[0] ?? {};
    const avgDaily30 = Number(spikeRow.avg_daily ?? 0);
    const yesterdayAud = Number(spikeRow.yesterday ?? 0);
    const total30dCost = topToolsRes.rows.reduce((sum, row) => sum + Number(row.cost_aud), 0);

    const topCostDrivers = topToolsRes.rows.map((row) => {
      const costAud = Number(row.cost_aud);
      const runs = Number(row.runs);
      return {
        tool_slug:      row.tool_slug,
        runs,
        cost_aud:       costAud,
        avg_cost_aud:   Number(row.avg_cost_aud),
        total_tokens:   Number(row.total_tokens),
        share_of_cost:  total30dCost > 0 ? costAud / total30dCost : 0,
        last_run_at:    row.last_run_at,
      };
    });

    const actions = [];

    const allModels = modelsRow.rows.length > 0
      ? AgentConfigService.normalizeModelList(modelsRow.rows[0]?.value)
      : MODEL_DEFAULTS;
    const accountingDiagnostics = buildUsageAccountingDiagnostics({
      modelUsageRows: modelUsageRes.rows,
      models: allModels,
      zeroCostRunsWithTokens: Number(zeroCostRes.rows[0]?.runs ?? 0),
      cacheRow,
      recentRuns: monthRuns,
    });
    const modelTierMap = Object.fromEntries(allModels.map((m) => [m.id, m.tier]));
    const TIER_RANK = { standard: 0, advanced: 1, premium: 2 };
    const { AGENT_MODEL_REQUIREMENTS } = AgentConfigService;
    for (const { tool_slug, model_id, runs } of modelUsageRes.rows) {
      const modelTier = modelTierMap[model_id];
      const agentReq = AGENT_MODEL_REQUIREMENTS[tool_slug];
      if (!modelTier || !agentReq) continue;
      if ((TIER_RANK[modelTier] ?? 0) > (TIER_RANK[agentReq.tier] ?? 0)) {
        const rec = AgentConfigService.getRecommendedModel(tool_slug, allModels);
        actions.push(usageAction({
          type: 'overkill_model',
          severity: 'info',
          title: `${tool_slug} may be over-provisioned`,
          detail: `${model_id} is ${modelTier}, but this agent is configured as ${agentReq.tier}.`,
          action: rec?.id
            ? `Review Admin > Agents and consider ${rec.name} for this agent.`
            : 'Review Admin > Agents and consider a lower-tier enabled model.',
          metric: `${runs} runs in 30 days`,
        }));
      }
    }

    if (dailyBudgetPct != null) {
      if (dailyBudgetPct >= 1) {
        actions.push(usageAction({
          type: 'budget_pacing',
          severity: 'critical',
          title: 'Daily budget pressure is critical',
          detail: `The 7-day average is $${avg7dAud.toFixed(4)} AUD/day against a $${maxDaily.toFixed(2)} daily limit.`,
          action: 'Reduce high-cost agents, lower model tiers, or increase the daily organisation budget.',
          metric: `${Math.round(dailyBudgetPct * 100)}% of daily limit`,
        }));
      } else if (dailyBudgetPct >= 0.8) {
        actions.push(usageAction({
          type: 'budget_pacing',
          severity: 'warning',
          title: 'Daily budget is under pressure',
          detail: `The 7-day average is $${avg7dAud.toFixed(4)} AUD/day against a $${maxDaily.toFixed(2)} daily limit.`,
          action: 'Review the top cost drivers before this becomes a hard budget stop.',
          metric: `${Math.round(dailyBudgetPct * 100)}% of daily limit`,
        }));
      }
    }

    for (const driver of topCostDrivers) {
      const cfg = await AgentConfigService.getAdminConfig(driver.tool_slug, orgId);
      const limit = cfg.max_task_budget_aud;
      if (!limit) continue;
      const pct = driver.avg_cost_aud / limit;
      if (pct >= 0.9) {
        actions.push(usageAction({
          type: 'agent_avg_cost',
          severity: pct >= 1 ? 'critical' : 'warning',
          title: `${driver.tool_slug} is expensive per run`,
          detail: `Average run cost is $${driver.avg_cost_aud.toFixed(4)} AUD against a $${Number(limit).toFixed(2)} per-run budget.`,
          action: 'Inspect recent runs, model choice, max tokens, and whether the agent can pre-fetch less context.',
          metric: `${Math.round(pct * 100)}% of per-run budget`,
        }));
      }
    }

    if (Number(cacheRow.runs ?? 0) >= 5 && cacheHitRate < 0.15) {
      actions.push(usageAction({
        type: 'cache_health',
        severity: 'warning',
        title: 'Prompt cache effectiveness is low',
        detail: `Cache read rate is ${(cacheHitRate * 100).toFixed(1)}% over the last 7 days.${lowCacheDriverText ? ` Largest low-cache input drivers: ${lowCacheDriverText}.` : ''}`,
        action: 'Treat this as expected for document, live-data, or pre-fetch agents unless costs are rising. If optimisation is needed, start with the listed agents and reduce changing context before changing cache settings.',
        metric: `${cacheRow.runs} recent runs`,
      }));
    }

    if (avgDaily30 > 0.001 && yesterdayAud > avgDaily30 * 2.5) {
      actions.push(usageAction({
        type: 'cost_spike',
        severity: 'warning',
        title: 'Spend spiked yesterday',
        detail: `Yesterday was $${yesterdayAud.toFixed(4)} AUD versus a $${avgDaily30.toFixed(4)} 30-day daily average.`,
        action: 'Check which agent ran yesterday and whether the run volume or model choice changed.',
        metric: `${(yesterdayAud / avgDaily30).toFixed(1)}x baseline`,
      }));
    }

    if (topCostDrivers.length > 0 && actions.length === 0) {
      const top = topCostDrivers[0];
      actions.push(usageAction({
        type: 'top_driver',
        severity: 'info',
        title: `${top.tool_slug} is the main cost driver`,
        detail: `It represents ${Math.round(top.share_of_cost * 100)}% of 30-day agent/tool spend.`,
        action: 'No immediate issue detected. Use this as the first place to optimise if budget pressure appears.',
        metric: `$${top.cost_aud.toFixed(4)} AUD`,
      }));
    }

    const criticalCount = actions.filter((a) => a.severity === 'critical').length;
    const warningCount = actions.filter((a) => a.severity === 'warning').length;
    const status = criticalCount > 0 ? 'action_needed' : warningCount > 0 ? 'watch' : 'healthy';
    const score = Math.max(0, 100 - (criticalCount * 35) - (warningCount * 15) - Math.min(actions.filter((a) => a.severity === 'info').length * 3, 9));

    res.json({
      health: {
        status,
        score,
        label: status === 'action_needed' ? 'Action Needed' : status === 'watch' ? 'Watch' : 'Healthy',
        summary: status === 'action_needed'
          ? 'Usage needs admin attention.'
          : status === 'watch'
            ? 'Usage is acceptable but some signals need watching.'
            : 'No major usage pressure detected.',
      },
      forecast: {
        month_to_date_aud: monthCost,
        projected_month_aud: projectedMonthAud,
        current_day_of_month: dayOfMonth,
        days_in_month: daysInMonth(now),
        runs_month_to_date: monthRuns,
        daily_budget_aud: maxDaily,
        avg_7d_aud: avg7dAud,
        daily_budget_pct: dailyBudgetPct,
      },
      cacheDiagnostics: {
        hit_rate: cacheHitRate,
        low_cache_drivers: lowCacheDrivers,
      },
      accountingDiagnostics,
      topCostDrivers,
      recommendedActions: actions.slice(0, 6),
    });
  } catch (err) {
    console.error('[usage-intelligence]', err.message);
    res.status(500).json({ error: 'Failed to compute usage intelligence.' });
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
