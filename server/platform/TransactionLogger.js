/**
 * TransactionLogger — platform-wide logging primitive.
 *
 * Two-container architecture:
 *   Container 1 — transaction_logs: universal ledger, fixed schema.
 *   Container 2 — agent_event_logs: per-agent detail, flexible fields.
 *
 * Every agent run creates one transaction_log row (started → completed/failed)
 * and one or more agent_event_log rows for each meaningful step.
 *
 * session_id links both containers together for cross-reference.
 *
 * Usage:
 *   const logger = new TransactionLogger({ orgId, agentSlug, sessionId });
 *   await logger.start({ action: 'document_analysis', documentRef: 'RAB_Subcontract.pdf' });
 *   await logger.step('model_selection', 'Model Selected', 'Claude Sonnet 4.6', { model: 'claude-sonnet-4-20250514' });
 *   await logger.complete({ outcome: 'All findings reviewed', metadata: { findingsCount: 12 } });
 *   await logger.fail({ error: 'Model API error' });
 */
const { pool } = require('../db');
const crypto = require('crypto');

class TransactionLogger {
  /**
   * @param {object}   params
   * @param {number}   params.orgId      — organisation FK
   * @param {string}   params.agentSlug  — agent identifier (e.g. 'demo-document-analyzer')
   * @param {string}   [params.sessionId] — optional; auto-generated as UUID v4 if omitted
   */
  constructor({ orgId, agentSlug, sessionId }) {
    if (!orgId) throw new Error('TransactionLogger: orgId is required');
    if (!agentSlug) throw new Error('TransactionLogger: agentSlug is required');

    this.orgId     = orgId;
    this.agentSlug = agentSlug;
    this.sessionId = sessionId || crypto.randomUUID();
    this._txId     = null; // set by start()
  }

  /**
   * Container 1: Record the start of a transaction.
   * Inserts a row into transaction_logs with status='started'.
   *
   * @param {object}  params
   * @param {string}  params.action       — what the agent is doing (e.g. 'document_analysis')
   * @param {string}  [params.documentRef] — document or entity being acted upon
   * @param {object}  [params.metadata]    — optional JSONB metadata
   * @returns {Promise<string>} transaction_logs id
   */
  async start({ action, documentRef = null, metadata = {} }) {
    const { rows } = await pool.query(
      `INSERT INTO transaction_logs (org_id, session_id, agent_slug, action, document_ref, outcome, status, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, 'started', $7)
       RETURNING id`,
      [this.orgId, this.sessionId, this.agentSlug, action, documentRef, 'In progress', JSON.stringify(metadata)]
    );
    this._txId = rows[0].id;
    return this._txId;
  }

  /**
   * Container 2: Record an agent-specific event.
   * Each event is a row in agent_event_logs with the agent's declared fields in `fields`.
   *
   * @param {string}  eventType   — machine-readable type (e.g. 'model_selection', 'deterministic_rule_match')
   * @param {string}  [label]     — human-readable label
   * @param {string}  [detail]    — human-readable detail text
   * @param {object}  [fields]    — agent-specific metadata fields (JSONB)
   * @param {Date}    [timestamp] — defaults to NOW()
   * @returns {Promise<string>} agent_event_logs id
   */
  async step(eventType, label = null, detail = null, fields = {}, timestamp = null) {
    const { rows } = await pool.query(
      `INSERT INTO agent_event_logs (org_id, session_id, agent_slug, event_type, event_label, event_detail, event_timestamp, fields)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, NOW()), $8)
       RETURNING id`,
      [this.orgId, this.sessionId, this.agentSlug, eventType, label, detail, timestamp, JSON.stringify(fields)]
    );
    return rows[0].id;
  }

  /**
   * Container 1: Mark the transaction as completed.
   * Updates the transaction_logs row created by start().
   *
   * @param {object}  params
   * @param {string}  params.outcome   — human-readable outcome summary
   * @param {object}  [params.metadata] — additional metadata to merge
   * @returns {Promise<void>}
   */
  async complete({ outcome, metadata = {} }) {
    if (!this._txId) throw new Error('TransactionLogger: must call start() before complete()');
    await pool.query(
      `UPDATE transaction_logs
          SET status = 'completed',
              outcome = $1,
              metadata = metadata || $2::jsonb
        WHERE id = $3`,
      [outcome, JSON.stringify(metadata), this._txId]
    );
  }

  /**
   * Container 1: Mark the transaction as failed.
   *
   * @param {object}  params
   * @param {string}  params.error     — error message
   * @param {object}  [params.metadata] — additional metadata
   * @returns {Promise<void>}
   */
  async fail({ error, metadata = {} }) {
    if (!this._txId) throw new Error('TransactionLogger: must call start() before fail()');
    await pool.query(
      `UPDATE transaction_logs
          SET status = 'failed',
              outcome = $1,
              metadata = metadata || $2::jsonb
        WHERE id = $3`,
      [error, JSON.stringify(metadata), this._txId]
    );
  }

  /**
   * Convenience: log a complete transaction in one call (start + events + complete).
   *
   * @param {object}  params
   * @param {string}  params.action       — what the agent is doing
   * @param {string}  [params.documentRef] — document or entity reference
   * @param {Array}   [params.events]      — array of { eventType, label, detail, fields }
   * @param {string}  params.outcome       — outcome summary
   * @param {object}  [params.metadata]    — transaction-level metadata
   * @returns {Promise<{ txId: string, sessionId: string }>}
   */
  async logTransaction({ action, documentRef = null, events = [], outcome, metadata = {} }) {
    await this.start({ action, documentRef, metadata });
    for (const ev of events) {
      await this.step(ev.eventType, ev.label, ev.detail, ev.fields);
    }
    await this.complete({ outcome, metadata });
    return { txId: this._txId, sessionId: this.sessionId };
  }
}

// ── Static helpers ───────────────────────────────────────────────────────────

/**
 * Declare the tracked fields for an agent.
 * Call this once when setting up a new agent.
 *
 * @param {string} agentSlug — agent identifier
 * @param {Array}  fields    — array of field declarations:
 *   [{ key: string, label: string, type: 'text'|'number'|'date'|'badge'|'link', options?: string[] }]
 */
async function declareAgentFields(agentSlug, fields) {
  await pool.query(
    `INSERT INTO agent_field_declarations (agent_slug, fields)
     VALUES ($1, $2)
     ON CONFLICT (agent_slug)
     DO UPDATE SET fields = $2, updated_at = NOW()`,
    [agentSlug, JSON.stringify(fields)]
  );
}

/**
 * Get the declared fields for an agent.
 *
 * @param {string} agentSlug
 * @returns {Promise<Array>} array of field declarations
 */
async function getAgentFields(agentSlug) {
  const { rows } = await pool.query(
    `SELECT fields FROM agent_field_declarations WHERE agent_slug = $1`,
    [agentSlug]
  );
  return rows.length > 0 ? rows[0].fields : [];
}

/**
 * Get all agents that have field declarations.
 *
 * @returns {Promise<Array>} array of { agent_slug, fields }
 */
async function getAllAgentFields() {
  const { rows } = await pool.query(
    `SELECT agent_slug, fields FROM agent_field_declarations ORDER BY agent_slug`
  );
  return rows;
}

module.exports = { TransactionLogger, declareAgentFields, getAgentFields, getAllAgentFields };
