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

// Claude Sonnet 4.6 pricing in AUD per token (approximate at 1.55 AUD/USD)
// USD rates: input $3/MTok, output $15/MTok, cache_read $0.30/MTok, cache_write $3.75/MTok
const TOKEN_COST_AUD = {
  input:       3.00 * AUD_PER_USD / 1_000_000,   // ~$0.00000465
  output:      15.00 * AUD_PER_USD / 1_000_000,  // ~$0.00002325
  cacheRead:   0.30 * AUD_PER_USD / 1_000_000,   // ~$0.000000465
  cacheWrite:  3.75 * AUD_PER_USD / 1_000_000,   // ~$0.00000581
};

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
 * Compute AUD cost from a tokensUsed object.
 * tokensUsed: { input, output, cacheRead, cacheWrite } — all fields optional.
 */
function computeCostAud(tokensUsed = {}) {
  return (
    (tokensUsed.input      || 0) * TOKEN_COST_AUD.input +
    (tokensUsed.output     || 0) * TOKEN_COST_AUD.output +
    (tokensUsed.cacheRead  || 0) * TOKEN_COST_AUD.cacheRead +
    (tokensUsed.cacheWrite || 0) * TOKEN_COST_AUD.cacheWrite
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
  getDailyOrgSpendAud,
  check,
};
