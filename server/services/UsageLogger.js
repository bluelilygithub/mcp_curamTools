const { pool } = require('../db');

const AUD_PER_USD = 1.55;

/**
 * Log a completed agent run to usage_logs.
 *
 * @param {object} params
 * @param {number} params.orgId
 * @param {number} params.userId
 * @param {string} params.slug       — agent identifier
 * @param {string} params.modelId    — model used for the run
 * @param {object} params.tokensUsed — { input, output, cacheRead, cacheWrite }
 * @param {number} params.costAud    — computed AUD cost from CostGuardService
 */
async function logUsage({ orgId, userId, slug, modelId, tokensUsed = {}, costAud = 0 }) {
  const costUsd = costAud / AUD_PER_USD;

  await pool.query(
    `INSERT INTO usage_logs
       (org_id, user_id, tool_slug, model_id,
        input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
        cost_usd, cost_aud)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      orgId,
      userId,
      slug,
      modelId || null,
      tokensUsed.input      ?? 0,
      tokensUsed.output     ?? 0,
      tokensUsed.cacheRead  ?? 0,
      tokensUsed.cacheWrite ?? 0,
      costUsd,
      costAud,
    ]
  );
}

module.exports = { logUsage };
