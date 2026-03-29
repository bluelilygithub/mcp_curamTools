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
              array_agg(DISTINCT r.role_name) FILTER (WHERE r.role_name IS NOT NULL) AS roles
         FROM users u
         LEFT JOIN user_roles r ON r.user_id = u.id
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
  const { firstName, lastName, phone, isActive, role } = req.body;
  const userId = parseInt(req.params.id);
  try {
    await pool.query(
      `UPDATE users SET first_name = $1, last_name = $2, phone = $3, is_active = $4 WHERE id = $5`,
      [firstName, lastName, phone, isActive, userId]
    );
    if (role) {
      // Replace global role
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
// Uses native fetch — no SDK dependency required.

router.post('/models/:modelId/test', async (req, res) => {
  const { modelId } = req.params;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ ok: false, error: 'ANTHROPIC_API_KEY is not set on the server.' });
  }

  const start = Date.now();
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
  res.json({ anthropic: !!process.env.ANTHROPIC_API_KEY });
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
  // Return admin config for all known agent slugs
  const slugs = Object.keys(AgentConfigService.ADMIN_DEFAULTS).filter((s) => s !== '_platform');
  try {
    const configs = await Promise.all(
      slugs.map(async (slug) => ({
        slug,
        ...(await AgentConfigService.getAdminConfig(slug)),
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

  // ── 7. Google Analytics (GA4) ──────────────────────────────────────────────
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
  res.json({ results });
});

module.exports = router;
