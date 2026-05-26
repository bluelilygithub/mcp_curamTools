/**
 * CostGuardService — Budget-Aware Circuit Breaker (Stage 3)
 *
 * Two guardrails:
 *   max_task_budget_aud   — per-run AUD ceiling (from agent adminConfig)
 *   max_daily_org_budget_aud — org-wide daily AUD ceiling (from system_settings)
 *
 * Design: getDailyOrgSpendAud() is called ONCE at run start to avoid mid-stream DB queries.
 * check() is a pure function — no async, no DB queries. Safe to call on every SSE progress event.
 *
 * Currency: all values in AUD. AUD_PER_USD is approximate — update system_settings
 * 'platform_aud_rate' if exchange rate precision matters for your use case.
 */

const { pool } = require('../db');

// Approximate AUD/USD rate. All cost calculations use AUD throughout.
const AUD_PER_USD = 1.55;

// Claude Sonnet 4.6 pricing (Standard fallback)
// USD rates: input $3/MTok, output $15/MTok, cache_read $0.30/MTok, cache_write $3.75/MTok
const SONNET_RATES = {
  input:       3.00 * AUD_PER_USD / 1_000_000,
  output:      15.00 * AUD_PER_USD / 1_000_000,
  cacheRead:   0.30 * AUD_PER_USD / 1_000_000,
  cacheWrite:  3.75 * AUD_PER_USD / 1_000_000,
};

// DeepSeek Reasoner (R1) pricing
// USD rates: input $0.55/MTok, output $2.19/MTok (no cache breakdown in simple model)
const DEEPSEEK_RATES = {
  input:       0.55 * AUD_PER_USD / 1_000_000,
  output:      2.19 * AUD_PER_USD / 1_000_000,
  cacheRead:   0.14 * AUD_PER_USD / 1_000_000, // DeepSeek cached input rate
  cacheWrite:  0.55 * AUD_PER_USD / 1_000_000,
};

// Claude Haiku 4.5 pricing
// USD rates: input $0.80/MTok, output $4.00/MTok
const HAIKU_RATES = {
  input:       0.80 * AUD_PER_USD / 1_000_000,
  output:      4.00 * AUD_PER_USD / 1_000_000,
  cacheRead:   0.08 * AUD_PER_USD / 1_000_000,
  cacheWrite:  1.00 * AUD_PER_USD / 1_000_000,
};

const MODEL_RATES = {
  'claude-sonnet-4-6': SONNET_RATES,
  'claude-haiku-4-5-20251001': HAIKU_RATES,
  'deepseek-reasoner': DEEPSEEK_RATES,
  'deepseek-chat': {
    input:  0.14 * AUD_PER_USD / 1_000_000,
    output: 0.28 * AUD_PER_USD / 1_000_000,
  }
};

function ratesFromModelConfig(modelConfig, cacheRates = null) {
  const inputPrice = Number(modelConfig?.inputPricePer1M);
  const outputPrice = Number(modelConfig?.outputPricePer1M);
  if (!Number.isFinite(inputPrice) || !Number.isFinite(outputPrice) || inputPrice <= 0 || outputPrice <= 0) {
    return null;
  }
  return {
    input:      inputPrice * AUD_PER_USD / 1_000_000,
    output:     outputPrice * AUD_PER_USD / 1_000_000,
    // The model editor does not store cache-specific prices yet. For known
    // providers, keep their cache rates; for custom models, use input rate.
    cacheRead:  cacheRates?.cacheRead  ?? inputPrice * AUD_PER_USD / 1_000_000,
    cacheWrite: cacheRates?.cacheWrite ?? inputPrice * AUD_PER_USD / 1_000_000,
  };
}

function getKnownRateMatch(modelId) {
  if (!modelId) return { rates: SONNET_RATES, source: 'fallback_sonnet', matchedModel: 'claude-sonnet-4-6' };
  const lower = modelId.toLowerCase();

  if (MODEL_RATES[lower]) return { rates: MODEL_RATES[lower], source: 'known_table', matchedModel: lower };

  if (lower.startsWith('deepseek-')) return { rates: DEEPSEEK_RATES, source: 'provider_prefix', matchedModel: 'deepseek-*' };
  if (lower.startsWith('claude-haiku-') || lower.startsWith('claude-3-5-haiku')) {
    return { rates: HAIKU_RATES, source: 'provider_prefix', matchedModel: 'claude-haiku-*' };
  }
  if (lower.startsWith('claude-sonnet-') || lower.startsWith('claude-3-5-sonnet')) {
    return { rates: SONNET_RATES, source: 'provider_prefix', matchedModel: 'claude-sonnet-*' };
  }

  return { rates: SONNET_RATES, source: 'fallback_sonnet', matchedModel: 'claude-sonnet-4-6' };
}

/**
 * Get the rates for a given model ID.
 * Uses editable model catalogue prices when supplied, then known provider rates,
 * then a conservative Sonnet fallback if the model is unknown.
 */
function getRatesForModel(modelId, modelConfig = null) {
  const known = getKnownRateMatch(modelId);
  const configuredRates = ratesFromModelConfig(modelConfig, known.source === 'fallback_sonnet' ? null : known.rates);
  if (configuredRates) return configuredRates;
  return known.rates;
}

function describePricingForModel(modelId, modelConfig = null) {
  const known = getKnownRateMatch(modelId);
  const configuredRates = ratesFromModelConfig(modelConfig, known.source === 'fallback_sonnet' ? null : known.rates);
  if (configuredRates) {
    return {
      modelId,
      source: 'configured_model',
      label: 'Model catalogue pricing',
      matchedModel: modelConfig.id ?? modelId,
      hasConfiguredPricing: true,
    };
  }
  return {
    modelId,
    source: known.source,
    label: known.source === 'fallback_sonnet' ? 'Fallback Sonnet estimate' : 'Built-in provider pricing',
    matchedModel: known.matchedModel,
    hasConfiguredPricing: false,
  };
}

// ── Error type ─────────────────────────────────────────────────────────────

class BudgetExceededError extends Error {
  /**
   * @param {'task'|'daily_org'} type
   * @param {number} limit   — the configured ceiling (AUD)
   * @param {number} actual  — the accumulated spend (AUD)
   */
  constructor(type, limit, actual) {
    const limitStr = `$${limit.toFixed(2)} AUD`;
    const actualStr = `$${actual.toFixed(4)} AUD`;
    const message =
      type === 'task'
        ? `Task budget exceeded: ${actualStr} used (limit: ${limitStr})`
        : `Daily org budget exceeded: ${actualStr} used today (limit: ${limitStr})`;
    super(message);
    this.name = 'BudgetExceededError';
    this.type = type;
    this.limit = limit;
    this.actual = actual;
  }
}

// ── Utilities ──────────────────────────────────────────────────────────────

/**
 * Compute AUD cost from a tokensUsed object and model ID.
 * tokensUsed: { input, output, cacheRead, cacheWrite } — all fields optional.
 * modelId: string — used to select the correct pricing rates.
 */
function computeCostAud(tokensUsed = {}, modelId = null, modelConfig = null) {
  const rates = getRatesForModel(modelId, modelConfig);
  return (
    (tokensUsed.input      || 0) * (rates.input      || 0) +
    (tokensUsed.output     || 0) * (rates.output     || 0) +
    (tokensUsed.cacheRead  || 0) * (rates.cacheRead  || 0) +
    (tokensUsed.cacheWrite || 0) * (rates.cacheWrite || 0)
  );
}

/**
 * Load today's total AUD spend for an org from usage_logs.
 * Call ONCE at run start — stores the result and passes it into check().
 * Not called mid-stream: this is the only DB query in this service.
 */
async function getDailyOrgSpendAud(orgId) {
  const res = await pool.query(
    `SELECT COALESCE(SUM(cost_usd), 0) AS total_usd
       FROM usage_logs
      WHERE org_id = $1
        AND created_at >= CURRENT_DATE`,
    [orgId]
  );
  return parseFloat(res.rows[0].total_usd) * AUD_PER_USD;
}

// ── Circuit breaker ────────────────────────────────────────────────────────

/**
 * Pure budget check — no async, no DB queries.
 * Call after every cost accumulation event during a run.
 *
 * @param {object} opts
 *   taskCostAud        — accumulated AUD cost for this run so far
 *   maxTaskBudgetAud   — per-run ceiling from adminConfig (null = unlimited)
 *   dailyOrgSpendAud   — today's spend loaded once at run start (AUD)
 *   maxDailyBudgetAud  — org daily ceiling from getOrgBudgetSettings (null = unlimited)
 *
 * Throws BudgetExceededError if either limit is breached.
 * Task limit is checked before daily limit — more specific error wins.
 */
function check({ taskCostAud, maxTaskBudgetAud, dailyOrgSpendAud, maxDailyBudgetAud }) {
  if (maxTaskBudgetAud != null && taskCostAud >= maxTaskBudgetAud) {
    throw new BudgetExceededError('task', maxTaskBudgetAud, taskCostAud);
  }
  const totalDailyAud = dailyOrgSpendAud + taskCostAud;
  if (maxDailyBudgetAud != null && totalDailyAud >= maxDailyBudgetAud) {
    throw new BudgetExceededError('daily_org', maxDailyBudgetAud, totalDailyAud);
  }
}

module.exports = {
  BudgetExceededError,
  computeCostAud,
  describePricingForModel,
  getRatesForModel,
  getDailyOrgSpendAud,
  check,
};
