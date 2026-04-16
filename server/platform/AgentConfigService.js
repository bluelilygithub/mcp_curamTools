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
  'ai-visibility-monitor': {
    // Structured competitor list — each entry has a display name and optional URL.
    // Stored as JSONB; the agent uses the names for mention detection in AI responses.
    competitors: [
      { name: 'Ceramic Pro',  url: 'ceramicpro.com.au' },
      { name: 'Gtechniq',     url: 'gtechniq.com' },
      { name: 'IGL Coatings', url: 'iglcoatings.com' },
      { name: 'Gyeon',        url: 'gyeonquartz.com.au' },
      { name: 'Autobond',     url: 'autobond.com.au' },
    ],
  },
};

const ADMIN_DEFAULTS = {
  'google-ads-monitor': {
    enabled:              true,
    model:                'claude-sonnet-4-6',
    max_tokens:           8192,
    max_iterations:       10,
    max_task_budget_aud:  2.00,
    fallback_model:       null,
  },
  'google-ads-freeform': {
    enabled:             true,
    model:               'claude-sonnet-4-6',
    max_tokens:          8192,
    max_iterations:      12,
    max_task_budget_aud: 2.00,
    fallback_model:      null,
  },
  'google-ads-change-impact': {
    enabled:             true,
    model:               'claude-sonnet-4-6',
    max_tokens:          8192,
    max_iterations:      10,
    max_task_budget_aud: 2.00,
    fallback_model:      null,
  },
  'google-ads-change-audit': {
    enabled:             true,
    model:               'claude-sonnet-4-6',
    max_tokens:          8192,
    max_iterations:      15,   // higher — runs multiple before/after tool call pairs
    max_task_budget_aud: 3.00, // higher budget — multiple before/after query pairs per change
    fallback_model:      null,
  },
  'doc-extractor': {
    enabled:             true,
    model:               'claude-sonnet-4-6',
    max_tokens:          4096, // 2048 was too low for complex multi-field documents
    max_task_budget_aud: 0.50, // single image, single call — low ceiling
    fallback_model:      null,
    // File upload constraints — configurable per-org
    allowed_mime_types:   ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'],
    max_file_bytes:       20 * 1024 * 1024, // 20 MB
    max_files_per_batch:  20,               // max files accepted in a single request
    // PDF processing
    max_pdf_pages:        10,               // pages processed per PDF (cost control)
    pdf_dpi:              150,              // rasterisation quality: 100 | 150 | 200
  },
  'ai-visibility-monitor': {
    enabled:             true,
    model:               'claude-sonnet-4-6',
    max_tokens:          8192,   // final narrative analysis call — 29 prompts needs headroom
    max_task_budget_aud: 3.00,   // covers 26 web search calls + 1 analysis call
    fallback_model:      null,
  },
  _platform: {
    enabled: true,
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    max_iterations: 10,
    max_task_budget_aud: 2.00,  // per-run AUD ceiling; null = unlimited
    fallback_model: null,
  },
};

// ── Model requirements per agent ──────────────────────────────────────────
// tier: the minimum capability tier the agent needs.
//   'standard' — brief/simple output, pre-fetch, no ReAct loop
//   'advanced'  — multi-section analysis, cross-source reasoning
//   'premium'   — complex multi-step reasoning (reserved for future use)
// reason: shown in the Admin UI next to the recommendation.

const AGENT_MODEL_REQUIREMENTS = {
  'google-ads-conversation':     { tier: 'advanced', reason: 'Multi-turn reasoning with dynamic tool selection' },
  'google-ads-strategic-review': { tier: 'advanced', reason: 'Multi-step hypothesis validation against live data' },
  'google-ads-change-audit':     { tier: 'advanced', reason: 'Complex narrative audit with before/after comparison' },
  'google-ads-monitor':          { tier: 'advanced', reason: 'Multi-section performance report with cross-source analysis' },
  'google-ads-change-impact':    { tier: 'advanced', reason: 'Timeline analysis with performance discontinuity detection' },
  'google-ads-freeform':         { tier: 'advanced', reason: 'Open-ended Q&A with live data retrieval' },
  'competitor-keyword-intel':    { tier: 'advanced', reason: 'Competitive gap analysis requiring detailed reasoning' },
  'ads-attribution-summary':     { tier: 'standard', reason: 'Brief structured summary from pre-fetched data' },
  'ads-bounce-analysis':         { tier: 'standard', reason: 'Structured bounce report from pre-fetched data' },
  'auction-insights':            { tier: 'standard', reason: 'Structured competitive metrics report' },
  'diamondplate-data':           { tier: 'advanced', reason: 'Cross-source CRM lead intelligence with channel, device, and conversion analysis' },
  'search-term-intelligence':    { tier: 'advanced', reason: 'Cross-source analysis joining Ads search terms, GA4 bounce data, and CRM lead outcomes' },
  'ai-visibility-monitor':       { tier: 'advanced', reason: 'Multi-prompt web search with cross-source brand and competitor analysis' },
  'doc-extractor':               { tier: 'advanced', reason: 'Vision extraction quality scales with model capability — Sonnet handles complex layouts, poor scans, and dense forms significantly better than Haiku' },
  _platform:                     { tier: 'advanced', reason: 'Default for unrecognised agents' },
};

// Tier capability order: standard < advanced < premium
const TIER_ORDER = ['standard', 'advanced', 'premium'];

/**
 * Given a list of all models (from admin/models), return the recommended model
 * for the given agent slug.
 *
 * @param {string}  slug          — agent slug
 * @param {Array}   allModels     — full model list from admin/models (may include disabled)
 * @returns {{ id: string, name: string, tier: string, reason: string } | null}
 */
function getRecommendedModel(slug, allModels) {
  const req         = AGENT_MODEL_REQUIREMENTS[slug] ?? AGENT_MODEL_REQUIREMENTS._platform;
  const requiredIdx = TIER_ORDER.indexOf(req.tier);
  const enabled     = allModels.filter((m) => m.enabled !== false);

  if (enabled.length === 0) return null;

  const atOrAbove = enabled.filter((m) => TIER_ORDER.indexOf(m.tier ?? 'advanced') >= requiredIdx);
  const below     = enabled.filter((m) => TIER_ORDER.indexOf(m.tier ?? 'advanced') <  requiredIdx);

  atOrAbove.sort((a, b) => {
    const ai = TIER_ORDER.indexOf(a.tier ?? 'advanced');
    const bi = TIER_ORDER.indexOf(b.tier ?? 'advanced');
    if (ai !== bi) return (ai - requiredIdx) - (bi - requiredIdx);
    return (b.outputPricePer1M ?? 0) - (a.outputPricePer1M ?? 0);
  });

  below.sort((a, b) => {
    const ai = TIER_ORDER.indexOf(a.tier ?? 'advanced');
    const bi = TIER_ORDER.indexOf(b.tier ?? 'advanced');
    if (ai !== bi) return bi - ai;
    return (b.outputPricePer1M ?? 0) - (a.outputPricePer1M ?? 0);
  });

  const pick = atOrAbove[0] ?? below[0];
  if (!pick) return null;
  return { id: pick.id, name: pick.name, tier: pick.tier, reason: req.reason };
}

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

/**
 * Returns lightweight metadata for a prompt row — last editor, timestamp,
 * and the model that was active when the prompt was last saved.
 */
async function getAgentConfigMeta(orgId, slug) {
  try {
    const res = await pool.query(
      `SELECT
         ac.updated_at,
         ac.config->>'model_at_last_edit' AS model_at_last_edit,
         u.email                           AS updated_by_email
       FROM agent_configs ac
       LEFT JOIN users u ON u.id = ac.updated_by
      WHERE ac.org_id = $1 AND ac.slug = $2 AND ac.customer_id IS NULL`,
      [orgId, slug]
    );
    if (res.rows.length === 0) return { updated_at: null, updated_by_email: null, model_at_last_edit: null };
    return res.rows[0];
  } catch {
    return { updated_at: null, updated_by_email: null, model_at_last_edit: null };
  }
}

// ── Data Privacy settings ─────────────────────────────────────────────────────
//
// Two independent stores, both under system_settings:
//
//   'extraction_privacy'  — field names stripped from AI extraction results
//                           BEFORE they are saved to the database.
//                           Applies to doc-extractor and any future tool that
//                           returns fields: [{ name, value, confidence }].
//                           Enforced at the route layer (post-extraction).
//
//   'crm_privacy'         — ACF meta_key names stripped from CRM data
//                           BEFORE it reaches the LLM (pre-AI).
//                           Enforced at the tool execute layer in
//                           agents/googleAdsConversation/tools.js.
//
// Both are managed from the unified Admin › Data Privacy page.

const EXTRACTION_PRIVACY_DEFAULTS = {
  excluded_field_names: [], // snake_case names — matched against extracted field.name
};

/**
 * Returns org-level extraction privacy settings.
 * excluded_field_names: snake_case field names to strip from extraction results before DB save.
 * Applied universally to any tool that produces fields: [{ name, value, ... }].
 */
async function getExtractionPrivacySettings(orgId) {
  try {
    const res = await pool.query(
      `SELECT value FROM system_settings WHERE org_id = $1 AND key = 'extraction_privacy' LIMIT 1`,
      [orgId]
    );
    if (res.rows.length === 0) return { ...EXTRACTION_PRIVACY_DEFAULTS };
    return { ...EXTRACTION_PRIVACY_DEFAULTS, ...(res.rows[0].value || {}) };
  } catch (err) {
    console.error('[AgentConfigService] getExtractionPrivacySettings error:', err.message);
    return { ...EXTRACTION_PRIVACY_DEFAULTS };
  }
}

/**
 * Saves org-level extraction privacy settings.
 */
async function updateExtractionPrivacySettings(orgId, patch, updatedBy) {
  const current = await getExtractionPrivacySettings(orgId);
  const merged  = { ...current, ...patch };
  await pool.query(
    `INSERT INTO system_settings (org_id, key, value, updated_by, updated_at)
     VALUES ($1, 'extraction_privacy', $2, $3, NOW())
     ON CONFLICT (org_id, key)
     DO UPDATE SET value = $2, updated_by = $3, updated_at = NOW()`,
    [orgId, JSON.stringify(merged), updatedBy]
  );
  return merged;
}

// ── CRM Privacy settings (system_settings key: 'crm_privacy') ───────────────

const CRM_PRIVACY_DEFAULTS = {
  excluded_fields: [], // ACF field names to strip before data reaches the LLM
};

/**
 * Returns org-level CRM privacy settings.
 * excluded_fields: array of ACF meta_key names to strip from all CRM tool results.
 */
async function getCrmPrivacySettings(orgId) {
  try {
    const res = await pool.query(
      `SELECT value FROM system_settings WHERE org_id = $1 AND key = 'crm_privacy' LIMIT 1`,
      [orgId]
    );
    if (res.rows.length === 0) return { ...CRM_PRIVACY_DEFAULTS };
    return { ...CRM_PRIVACY_DEFAULTS, ...(res.rows[0].value || {}) };
  } catch (err) {
    console.error('[AgentConfigService] getCrmPrivacySettings error:', err.message);
    return { ...CRM_PRIVACY_DEFAULTS };
  }
}

/**
 * Saves org-level CRM privacy settings.
 */
async function updateCrmPrivacySettings(orgId, patch, updatedBy) {
  const current = await getCrmPrivacySettings(orgId);
  const merged  = { ...current, ...patch };
  await pool.query(
    `INSERT INTO system_settings (org_id, key, value, updated_by, updated_at)
     VALUES ($1, 'crm_privacy', $2, $3, NOW())
     ON CONFLICT (org_id, key)
     DO UPDATE SET value = $2, updated_by = $3, updated_at = NOW()`,
    [orgId, JSON.stringify(merged), updatedBy]
  );
  return merged;
}

// ── Storage settings (system_settings key: 'storage_settings') ───────────────
//
// Controls whether and how Doc Extractor (and future tools) store files in S3.
// AWS credentials stay as env vars (secrets); bucket/region live here because
// admins may reasonably change them without a redeploy.

const STORAGE_SETTINGS_DEFAULTS = {
  enabled:           false,
  default_behaviour: 'do_not_store', // 'store_original' | 'store_redacted' | 'do_not_store'
  aws_bucket:        null,
  aws_region:        'ap-southeast-2',
};

/**
 * Returns org-level storage settings.
 */
async function getStorageSettings(orgId) {
  try {
    const res = await pool.query(
      `SELECT value FROM system_settings WHERE org_id = $1 AND key = 'storage_settings' LIMIT 1`,
      [orgId]
    );
    if (res.rows.length === 0) return { ...STORAGE_SETTINGS_DEFAULTS };
    return { ...STORAGE_SETTINGS_DEFAULTS, ...(res.rows[0].value || {}) };
  } catch (err) {
    console.error('[AgentConfigService] getStorageSettings error:', err.message);
    return { ...STORAGE_SETTINGS_DEFAULTS };
  }
}

/**
 * Saves org-level storage settings.
 */
async function updateStorageSettings(orgId, patch, updatedBy) {
  const current = await getStorageSettings(orgId);
  const merged  = { ...current, ...patch };
  await pool.query(
    `INSERT INTO system_settings (org_id, key, value, updated_by, updated_at)
     VALUES ($1, 'storage_settings', $2, $3, NOW())
     ON CONFLICT (org_id, key)
     DO UPDATE SET value = $2, updated_by = $3, updated_at = NOW()`,
    [orgId, JSON.stringify(merged), updatedBy]
  );
  return merged;
}

// ── Custom AI Providers ────────────────────────────────────────────────────

/**
 * Returns the org's custom provider definitions.
 * Each entry: { key, label, apiKeyEnv, baseUrl }
 * key is lowercase, used as prefix in model IDs (e.g. 'seedance' matches 'seedance-video-3')
 */
async function getCustomProviders(orgId) {
  try {
    const res = await pool.query(
      `SELECT value FROM system_settings WHERE org_id = $1 AND key = 'custom_providers' LIMIT 1`,
      [orgId]
    );
    return Array.isArray(res.rows[0]?.value) ? res.rows[0].value : [];
  } catch (err) {
    console.error('[AgentConfigService] getCustomProviders error:', err.message);
    return [];
  }
}

/**
 * Replaces the org's custom providers list.
 */
async function updateCustomProviders(orgId, providers, updatedBy) {
  await pool.query(
    `INSERT INTO system_settings (org_id, key, value, updated_by, updated_at)
     VALUES ($1, 'custom_providers', $2, $3, NOW())
     ON CONFLICT (org_id, key)
     DO UPDATE SET value = $2, updated_by = $3, updated_at = NOW()`,
    [orgId, JSON.stringify(providers), updatedBy]
  );
  return providers;
}

module.exports = {
  getAgentConfig,
  getAgentConfigMeta,
  updateAgentConfig,
  getAgentConfigForCustomer,
  updateAgentConfigForCustomer,
  listCustomerConfigs,
  getAdminConfig,
  updateAdminConfig,
  getOrgBudgetSettings,
  updateOrgBudgetSettings,
  getExtractionPrivacySettings,
  updateExtractionPrivacySettings,
  getCrmPrivacySettings,
  updateCrmPrivacySettings,
  getStorageSettings,
  updateStorageSettings,
  getCustomProviders,
  updateCustomProviders,
  AGENT_DEFAULTS,
  ADMIN_DEFAULTS,
  AGENT_MODEL_REQUIREMENTS,
  getRecommendedModel,
};
