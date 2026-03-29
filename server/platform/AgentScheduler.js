/**
 * AgentScheduler — platform cron primitive.
 * All agent scheduled execution goes through this class.
 * Never configure node-cron directly in agent code.
 *
 * Usage:
 *   AgentScheduler.register({ slug, schedule, runFn, orgId });
 *   AgentScheduler.updateSchedule('my-agent', '0 9 * * *');
 */
const cron = require('node-cron');
const { pool } = require('../db');
const { persistRun } = require('./persistRun');

class AgentSchedulerClass {
  constructor() {
    // Map<slug, { task: cron.ScheduledTask, schedule: string, runFn: Function, orgId: number|null }>
    this._jobs = new Map();
  }

  /**
   * Register a cron job for a slug. Replaces any existing job for the same slug (idempotent).
   *
   * @param {string}        slug     — agent identifier
   * @param {string}        schedule — node-cron expression e.g. '0 6,18 * * *'
   * @param {Function}      runFn   — async (context) => any
   * @param {number|null}   orgId   — if null, resolved from DB (single active org fallback)
   */
  register({ slug, schedule, runFn, orgId = null }) {
    // Stop existing job if any
    this._stop(slug);

    if (!schedule || !cron.validate(schedule)) {
      console.warn(`[AgentScheduler] Invalid schedule for ${slug}: "${schedule}" — job not registered`);
      return;
    }

    const task = cron.schedule(schedule, async () => {
      const resolvedOrgId = orgId ?? await this._resolveOrgId();
      if (!resolvedOrgId) {
        console.error(`[AgentScheduler] Cannot resolve orgId for ${slug} — skipping tick`);
        return;
      }
      await this._tick(slug, runFn, resolvedOrgId);
    });

    this._jobs.set(slug, { task, schedule, runFn, orgId });
    console.log(`[AgentScheduler] Registered "${slug}" → "${schedule}"`);
  }

  /**
   * Update the cron schedule for an already-registered slug. Takes effect immediately.
   * @param {string} slug        — must match a previously registered slug
   * @param {string} newSchedule — new node-cron expression
   */
  updateSchedule(slug, newSchedule) {
    const job = this._jobs.get(slug);
    if (!job) {
      console.warn(`[AgentScheduler] updateSchedule: slug "${slug}" not registered`);
      return;
    }
    this.register({ slug, schedule: newSchedule, runFn: job.runFn, orgId: job.orgId });
  }

  /**
   * Return the current cron expression for the given slug, or null.
   */
  getSchedule(slug) {
    return this._jobs.get(slug)?.schedule ?? null;
  }

  /**
   * Stop the cron job for a slug without removing it from the registry.
   */
  _stop(slug) {
    const job = this._jobs.get(slug);
    if (job) {
      job.task.stop();
      this._jobs.delete(slug);
    }
  }

  /**
   * Execute the agent run for one cron tick. Persists result via persistRun.
   *
   * Multi-customer support: if runFn returns an array of
   * `{ customerId, result, status, error }` objects, each element is persisted
   * as a separate agent_runs row. Single-object returns (existing agents) are
   * unchanged — backward compatible.
   *
   * Errors never rethrow — a failing agent cannot crash the process.
   */
  async _tick(slug, runFn, orgId) {
    const startTime = new Date();
    let runId;
    try {
      // Single opening 'running' row — used for single-run agents; array-run agents
      // create their own rows per customer below and close this one immediately.
      runId = await persistRun({ slug, orgId, status: 'running', runAt: startTime });
      const outcome = await runFn({ orgId, userId: null, config: {}, adminConfig: {}, emit: () => {} });

      if (Array.isArray(outcome)) {
        // Multi-customer: close the placeholder row then persist one row per customer
        await persistRun({ slug, orgId, status: 'complete', result: { multi: true, count: outcome.length }, runId });

        for (const item of outcome) {
          const customerRunId = await persistRun({
            slug,
            orgId,
            status: 'running',
            runAt: startTime,
            customerId: item.customerId ?? null,
            campaignId: item.campaignId ?? null,
          });
          await persistRun({
            slug,
            orgId,
            status: item.status ?? (item.error ? 'error' : 'complete'),
            result: item.result ?? null,
            error: item.error ?? null,
            customerId: item.customerId ?? null,
            campaignId: item.campaignId ?? null,
            runId: customerRunId,
          });
        }
        console.log(`[AgentScheduler] ${slug} completed ${outcome.length} customer runs at ${new Date().toISOString()}`);
      } else {
        // Single-run (backward compatible)
        await persistRun({
          slug,
          orgId,
          status: 'complete',
          result: outcome?.result ?? outcome,
          runId,
        });
        console.log(`[AgentScheduler] ${slug} completed at ${new Date().toISOString()}`);
      }
    } catch (err) {
      console.error(`[AgentScheduler] ${slug} tick error:`, err.message);
      if (runId) {
        await persistRun({ slug, orgId, status: 'error', error: err.message, runId }).catch(() => {});
      }
    }
  }

  /**
   * Resolve orgId from DB when not supplied (single-org fallback).
   */
  async _resolveOrgId() {
    try {
      const res = await pool.query('SELECT id FROM organizations ORDER BY id LIMIT 1');
      return res.rows[0]?.id ?? null;
    } catch {
      return null;
    }
  }
}

// Export singleton
const AgentScheduler = new AgentSchedulerClass();
module.exports = { AgentScheduler };
