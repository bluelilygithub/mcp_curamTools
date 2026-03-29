/**
 * persistRun — the ONLY write path to agent_runs.
 * Called by createAgentRoute (HTTP-triggered runs) and AgentScheduler (cron-triggered runs).
 * Never call from agent code or domain service code.
 */
const { pool } = require('../db');

/**
 * @param {object} params
 * @param {string}  params.slug         — agent identifier e.g. 'google-ads-monitor'
 * @param {number}  params.orgId        — organisation FK
 * @param {string}  params.status       — 'running' | 'complete' | 'error'
 * @param {object}  [params.result]     — JSONB result payload (summary, data, suggestions, tokensUsed)
 * @param {string}  [params.error]      — error message string (status === 'error')
 * @param {Date}    [params.runAt]      — run start time (defaults to NOW())
 * @param {string}  [params.runId]      — existing UUID to update (for completing a 'running' row)
 * @param {string}  [params.customerId] — Google Ads customer ID (multi-customer runs)
 * @param {string}  [params.campaignId] — campaign ID (campaign-scoped runs)
 */
async function persistRun({ slug, orgId, status, result = null, error = null, runAt = null, runId = null, customerId = null, campaignId = null }) {
  if (runId) {
    // Update an existing 'running' row to complete/error
    const res = await pool.query(
      `UPDATE agent_runs
          SET status       = $1,
              result       = $2,
              error        = $3,
              completed_at = NOW()
        WHERE id = $4
        RETURNING id`,
      [status, result ? JSON.stringify(result) : null, error, runId]
    );
    return res.rows[0]?.id ?? null;
  }

  // Insert a new row
  const res = await pool.query(
    `INSERT INTO agent_runs (org_id, slug, status, result, error, run_at, customer_id, campaign_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      orgId,
      slug,
      status,
      result ? JSON.stringify(result) : null,
      error,
      runAt ?? new Date(),
      customerId,
      campaignId,
    ]
  );
  return res.rows[0].id;
}

module.exports = { persistRun };
