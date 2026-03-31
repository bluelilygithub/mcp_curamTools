/**
 * AgentConfigService — the ONLY access path to system_settings and agent_configs.
 * Agent code must never query these tables directly.
 *
 * Two-store pattern:
 *   system_settings  → admin guardrails (model, max_tokens, kill switch) — org_admin only
 *   agent_configs    → operator settings (schedule, thresholds, lookback) — any auth user
 */
const { pool } = require('../db');

// ── Default configs ────────────────────────────────────────────────────────
// New agents append their defaults here. Do not remove existing entries.

const AGENT_DEFAULTS = {
  'google-ads-monitor': {
    schedule:                  '0 6,18 * * *', // 6 am and 6 pm UTC
    lookback_days:             30,
    ctr_low_threshold:         0.03,           // 3% — campaigns below this flagged as low CTR
    wasted_clicks_threshold:   5,              // clicks with 0 conversions before flagging
    impressions_ctr_threshold: 100,            // impressions floor for ad-copy opportunity check
    max_suggestions:           8,
    // Business context — shared by all ads sub-agents
    target_cpa:                null,           // AUD — target cost per conversion
    monthly_budget:            null,           // AUD — total monthly ad budget
    brand_keywords:            '',             // comma-separated brand terms e.g. "diamond plate,diamondplate"
    report_email:              '',             // default recipient for emailed reports
    // Bounce analysis
    bounce_rate_threshold:     0.5,            // 0–1; sessions above this flagged in bounce report
    // Competitor keyword intel
    competitor_urls:           '',             // one URL per line
    min_search_volume:         50,             // filter keywords below this monthly search count
  },
  'google-ads-freeform': {
    max_suggestions: 5,
  },
  'google-ads-change-impact': {
    lookback_days: 7,
    max_suggestions: 5,
  },
  'google-ads-change-audit': {
    lookback_days:           30,
    comparison_window_days:  7,   // days before/after each change for metric comparison
    max_suggestions:         5,
  },
};

const ADMIN_DEFAULTS = {
  'google-ads-monitor': {
    enabled:              true,
    model:                'claude-sonnet-4-6',
    max_tokens:           8192,
    max_iterations:       10,
    max_task_budget_aud:  2.00,
  },
  'google-ads-freeform': {
    enabled:             true,
    model:               'claude-sonnet-4-6',
    max_tokens:          8192,
    max_iterations:      12,
    max_task_budget_aud: 2.00,
  },
  'google-ads-change-impact': {
    enabled:             true,
    model:               'claude-sonnet-4-6',
    max_tokens:          8192,
    max_iterations:      10,
    max_task_budget_aud: 2.00,
  },
  'google-ads-change-audit': {
    enabled:             true,
    model:               'claude-sonnet-4-6',
    max_tokens:          8192,
    max_iterations:      15,   // higher — runs multiple before/after tool call pairs
    max_task_budget_aud: 3.00, // higher budget — multiple before/after query pairs per change
  },
  _platform: {
    enabled: true,
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    max_iterations: 10,
    max_task_budget_aud: 2.00,  // per-run AUD ceiling; null = unlimited
  },
};

function getDefaultAdminConfig(slug) {
  return ADMIN_DEFAULTS[slug] ?? { ...ADMIN_DEFAULTS._platform };
}

function getDefaultAgentConfig(slug) {
  return AGENT_DEFAULTS[slug] ?? {};
}

// ── Operator config (agent_configs) ───────────────────────────────────────

/**
 * Returns defaults merged with stored operator config + intelligence_profile.
 * Falls back to defaults on DB error.
 */
async function getAgentConfig(orgId, slug) {
  try {
    const res = await pool.query(
      `SELECT config, intelligence_profile, custom_prompt
         FROM agent_configs
        WHERE org_id = $1 AND slug = $2 AND customer_id IS NULL`,
      [orgId, slug]
    );
    const defaults = getDefaultAgentConfig(slug);
    if (res.rows.length === 0) return { ...defaults, intelligence_profile: null, custom_prompt: null };
    const { config, intelligence_profile, custom_prompt } = res.rows[0];
    return {
      ...defaults,
      ...(config || {}),
      intelligence_profile: intelligence_profile ?? null,
      custom_prompt: custom_prompt ?? null,
    };
  } catch (err) {
    console.error(`[AgentConfigService] getAgentConfig error (${slug}):`, err.message);
    return { ...getDefaultAgentConfig(slug), intelligence_profile: null, custom_prompt: null };
  }
}

/**
 * Upserts a partial patch into agent_configs. Returns the merged result.
 */
async function updateAgentConfig(orgId, slug, patch, updatedBy) {
  const { intelligence_profile, custom_prompt, ...configFields } = patch;

  const res = await pool.query(
    `INSERT INTO agent_configs (org_id, slug, config, intelligence_profile, custom_prompt, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (org_id, slug) WHERE customer_id IS NULL
     DO UPDATE SET
       config               = agent_configs.config || $3::jsonb,
       intelligence_profile = COALESCE($4, agent_configs.intelligence_profile),
       custom_prompt        = COALESCE($5, agent_configs.custom_prompt),
       updated_by           = $6,
       updated_at           = NOW()
     RETURNING config, intelligence_profile, custom_prompt`,
    [
      orgId,
      slug,
      JSON.stringify(configFields),
      intelligence_profile !== undefined ? JSON.stringify(intelligence_profile) : null,
      custom_prompt !== undefined ? custom_prompt : null,
      updatedBy,
    ]
  );
  const row = res.rows[0];
  return {
    ...getDefaultAgentConfig(slug),
    ...(row.config || {}),
    intelligence_profile: row.intelligence_profile ?? null,
    custom_prompt: row.custom_prompt ?? null,
  };
}

// ── Customer-level operator config ────────────────────────────────────────

/**
 * Returns config for a specific customerId, falling back to org-default if no
 * customer-specific row exists. Merges: system defaults → org default → customer override.
 */
async function getAgentConfigForCustomer(orgId, slug, customerId) {
  const orgDefault = await getAgentConfig(orgId, slug);
  try {
    const res = await pool.query(
      `SELECT config, intelligence_profile, custom_prompt
         FROM agent_configs
        WHERE org_id = $1 AND slug = $2 AND customer_id = $3`,
      [orgId, slug, customerId]
    );
    if (res.rows.length === 0) return orgDefault;
    const { config, intelligence_profile, custom_prompt } = res.rows[0];
    return {
      ...orgDefault,
      ...(config || {}),
      intelligence_profile: intelligence_profile ?? orgDefault.intelligence_profile,
      custom_prompt: custom_prompt ?? orgDefault.custom_prompt,
    };
  } catch (err) {
    console.error(`[AgentConfigService] getAgentConfigForCustomer error (${slug}/${customerId}):`, err.message);
    return orgDefault;
  }
}

/**
 * Upserts a customer-specific config row. Only stores the delta — falls back to
 * org-default at read time via getAgentConfigForCustomer.
 */
async function updateAgentConfigForCustomer(orgId, slug, customerId, patch, updatedBy) {
  const { intelligence_profile, custom_prompt, ...configFields } = patch;

  const res = await pool.query(
    `INSERT INTO agent_configs (org_id, slug, customer_id, config, intelligence_profile, custom_prompt, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (org_id, slug, customer_id) WHERE customer_id IS NOT NULL
     DO UPDATE SET
       config               = agent_configs.config || $4::jsonb,
       intelligence_profile = COALESCE($5, agent_configs.intelligence_profile),
       custom_prompt        = COALESCE($6, agent_configs.custom_prompt),
       updated_by           = $7,
       updated_at           = NOW()
     RETURNING config, intelligence_profile, custom_prompt`,
    [
      orgId,
      slug,
      customerId,
      JSON.stringify(configFields),
      intelligence_profile !== undefined ? JSON.stringify(intelligence_profile) : null,
      custom_prompt !== undefined ? custom_prompt : null,
      updatedBy,
    ]
  );
  const row = res.rows[0];
  return {
    ...getDefaultAgentConfig(slug),
    ...(row.config || {}),
    intelligence_profile: row.intelligence_profile ?? null,
    custom_prompt: row.custom_prompt ?? null,
  };
}

/**
 * Returns all customer-specific config rows for a given agent slug.
 * Used by AgentScheduler to enumerate customers that need scheduled runs.
 */
async function listCustomerConfigs(orgId, slug) {
  try {
    const res = await pool.query(
      `SELECT customer_id, config, intelligence_profile, custom_prompt
         FROM agent_configs
        WHERE org_id = $1 AND slug = $2 AND customer_id IS NOT NULL
        ORDER BY customer_id`,
      [orgId, slug]
    );
    return res.rows;
  } catch (err) {
    console.error(`[AgentConfigService] listCustomerConfigs error (${slug}):`, err.message);
    return [];
  }
}

// ── Admin config (system_settings) ────────────────────────────────────────

function slugToKey(slug) {
  return `agent_${slug.replace(/-/g, '_')}`;
}

/**
 * Returns defaults merged with stored admin config for the given slug.
 */
async function getAdminConfig(slug) {
  try {
    // Admin config is org-agnostic for now (all orgs share the same admin guardrails per slug)
    const res = await pool.query(
      `SELECT value FROM system_settings WHERE key = $1 LIMIT 1`,
      [slugToKey(slug)]
    );
    const defaults = getDefaultAdminConfig(slug);
    if (res.rows.length === 0) return defaults;
    return { ...defaults, ...(res.rows[0].value || {}) };
  } catch (err) {
    console.error(`[AgentConfigService] getAdminConfig error (${slug}):`, err.message);
    return getDefaultAdminConfig(slug);
  }
}

/**
 * Saves merged admin config to system_settings.
 */
async function updateAdminConfig(slug, patch, updatedBy) {
  const current = await getAdminConfig(slug);
  const merged = { ...current, ...patch };

  // Get the org_id of the admin (first org as fallback)
  const orgRes = await pool.query('SELECT id FROM organizations ORDER BY id LIMIT 1');
  const orgId = orgRes.rows[0]?.id;
  if (!orgId) throw new Error('No organisation found');

  await pool.query(
    `INSERT INTO system_settings (org_id, key, value, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (org_id, key)
     DO UPDATE SET value = $3, updated_by = $4, updated_at = NOW()`,
    [orgId, slugToKey(slug), JSON.stringify(merged), updatedBy]
  );
  return merged;
}

// ── Org-level platform budget (system_settings key: 'platform_budget') ──────

const PLATFORM_BUDGET_DEFAULTS = {
  max_daily_org_budget_aud: null, // null = unlimited
};

/**
 * Returns org-level budget settings. Stored in system_settings under 'platform_budget'.
 * Separate from agent admin config — this is an org-wide guardrail, not per-agent.
 */
async function getOrgBudgetSettings(orgId) {
  try {
    const res = await pool.query(
      `SELECT value FROM system_settings WHERE org_id = $1 AND key = 'platform_budget' LIMIT 1`,
      [orgId]
    );
    if (res.rows.length === 0) return { ...PLATFORM_BUDGET_DEFAULTS };
    return { ...PLATFORM_BUDGET_DEFAULTS, ...(res.rows[0].value || {}) };
  } catch (err) {
    console.error('[AgentConfigService] getOrgBudgetSettings error:', err.message);
    return { ...PLATFORM_BUDGET_DEFAULTS };
  }
}

/**
 * Saves org-level budget settings.
 */
async function updateOrgBudgetSettings(orgId, patch, updatedBy) {
  const current = await getOrgBudgetSettings(orgId);
  const merged = { ...current, ...patch };
  await pool.query(
    `INSERT INTO system_settings (org_id, key, value, updated_by, updated_at)
     VALUES ($1, 'platform_budget', $2, $3, NOW())
     ON CONFLICT (org_id, key)
     DO UPDATE SET value = $2, updated_by = $3, updated_at = NOW()`,
    [orgId, JSON.stringify(merged), updatedBy]
  );
  return merged;
}

module.exports = {
  getAgentConfig,
  updateAgentConfig,
  getAgentConfigForCustomer,
  updateAgentConfigForCustomer,
  listCustomerConfigs,
  getAdminConfig,
  updateAdminConfig,
  getOrgBudgetSettings,
  updateOrgBudgetSettings,
  AGENT_DEFAULTS,
  ADMIN_DEFAULTS,
};
