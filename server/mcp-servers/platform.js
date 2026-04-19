/**
 * platform.js — Stdio MCP server for internal platform data.
 *
 * Exposes historical agent run data from the PostgreSQL agent_runs table.
 * Allows the conversation agent to query, search, and reason over past reports.
 *
 * Required env vars:
 *   DATABASE_URL — PostgreSQL connection string (already set in Railway)
 */

'use strict';

const { Pool }   = require('pg');
const readline   = require('readline');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'list_report_agents',
    description: 'Lists all agent slugs that have stored report history, with their run counts and most recent run date. Call this first to discover what historical data is available.',
    inputSchema: {
      type: 'object',
      properties: {
        org_id: { type: 'number', description: 'Organisation ID to scope results.' },
      },
      required: ['org_id'],
    },
  },
  {
    name: 'get_report_history',
    description: 'Fetches historical report runs for a specific agent. Returns the full summary text and key metadata for each run so you can reason over trends, changes, and patterns across time.',
    inputSchema: {
      type: 'object',
      properties: {
        org_id:     { type: 'number', description: 'Organisation ID.' },
        slug:       { type: 'string', description: 'Agent slug (e.g. google-ads-monitor, google-ads-strategic-review, ads-attribution-summary). Use list_report_agents to find valid slugs.' },
        limit:      { type: 'number', description: 'Number of runs to return. Default 10, max 50.' },
        start_date: { type: 'string', description: 'Only include runs on or after this date (YYYY-MM-DD).' },
        end_date:   { type: 'string', description: 'Only include runs on or before this date (YYYY-MM-DD).' },
      },
      required: ['org_id', 'slug'],
    },
  },
  {
    name: 'search_report_history',
    description: 'Full-text search across all stored report summaries. Use to find reports that mentioned a specific topic, campaign name, keyword, or issue. Returns matching runs with the relevant summary excerpt.',
    inputSchema: {
      type: 'object',
      properties: {
        org_id: { type: 'number', description: 'Organisation ID.' },
        query:  { type: 'string', description: 'Search terms (e.g. "CPA conversion rate", "brand campaign", "negative keywords").' },
        slug:   { type: 'string', description: 'Optional: restrict search to a specific agent slug.' },
        limit:  { type: 'number', description: 'Max results to return. Default 10.' },
      },
      required: ['org_id', 'query'],
    },
  },
  {
    name: 'get_pending_suggestions',
    description: 'Returns all suggestions for this org with status pending or monitoring, ordered by priority (high first) then created_at DESC. Used by the High Intent Advisor to review its own prior suggestions before generating new ones.',
    inputSchema: {
      type: 'object',
      properties: {
        org_id: { type: 'number', description: 'Organisation ID to scope results.' },
      },
      required: ['org_id'],
    },
  },
  {
    name: 'update_suggestion_outcome',
    description: 'Updates outcome_metrics, outcome_notes, and reviewed_at on a suggestion row. Called by the High Intent Advisor during its review phase to record whether a past suggestion moved the needle.',
    inputSchema: {
      type: 'object',
      properties: {
        org_id:          { type: 'number', description: 'Organisation ID — must match the suggestion org.' },
        suggestion_id:   { type: 'string', description: 'UUID of the suggestion row.' },
        outcome_metrics: { type: 'object', description: 'Current metric values for comparison against baseline.' },
        outcome_notes:   { type: 'string', description: 'Agent assessment of whether this suggestion moved the needle.' },
        status:          { type: 'string', description: 'Updated status if appropriate: monitoring | pending.' },
      },
      required: ['org_id', 'suggestion_id', 'outcome_metrics', 'outcome_notes'],
    },
  },
  {
    name: 'get_suggestion_history',
    description: 'Returns the full history of suggestions for this org (all statuses: pending, monitoring, acted_on, dismissed), ordered by created_at DESC. Use in Phase 1 to identify patterns — what categories get acted on, what gets dismissed and why, and which suggestion types fail to move metrics.',
    inputSchema: {
      type: 'object',
      properties: {
        org_id: { type: 'number', description: 'Organisation ID to scope results.' },
        limit:  { type: 'number', description: 'Max rows to return. Default 100, max 200.' },
      },
      required: ['org_id'],
    },
  },
  {
    name: 'flag_prompt_for_review',
    description: 'Raise a flag on a prompt that needs admin review. Call this when you notice your own system prompt is outdated, references stale context, uses capabilities no longer available, or would benefit from an update. Flags are visible to administrators in the MCP Prompts page.',
    inputSchema: {
      type: 'object',
      properties: {
        org_id: { type: 'number', description: 'Organisation ID.' },
        slug:   { type: 'string', description: 'Agent slug whose prompt needs review (e.g. "google-ads-conversation").' },
        reason: { type: 'string', description: 'Concise explanation of why the prompt needs review (max 300 chars).' },
      },
      required: ['org_id', 'slug', 'reason'],
    },
  },
];

// ── Tool handlers ─────────────────────────────────────────────────────────────

async function callTool(name, args = {}) {
  switch (name) {

    case 'list_report_agents': {
      const { rows } = await pool.query(
        `SELECT
           slug,
           COUNT(*)::int                        AS run_count,
           MAX(run_at)                           AS last_run,
           SUM((result->>'costAud')::numeric)    AS total_cost_aud
         FROM agent_runs
         WHERE org_id = $1
           AND status = 'complete'
         GROUP BY slug
         ORDER BY last_run DESC`,
        [args.org_id]
      );
      return rows.map((r) => ({
        slug:           r.slug,
        run_count:      r.run_count,
        last_run:       r.last_run,
        total_cost_aud: r.total_cost_aud ? parseFloat(r.total_cost_aud).toFixed(4) : null,
      }));
    }

    case 'get_report_history': {
      const limit = Math.min(args.limit || 10, 50);
      const params = [args.org_id, args.slug];
      let sql = `
        SELECT
          id,
          slug,
          run_at,
          status,
          result->>'summary'                    AS summary,
          result->>'startDate'                  AS start_date,
          result->>'endDate'                    AS end_date,
          (result->>'costAud')::numeric         AS cost_aud,
          result->'tokensUsed'                  AS tokens_used
        FROM agent_runs
        WHERE org_id = $1
          AND slug   = $2
          AND status = 'complete'
      `;
      if (args.start_date) { sql += ` AND run_at >= $${params.length + 1}`; params.push(args.start_date); }
      if (args.end_date)   { sql += ` AND run_at <= $${params.length + 1}`; params.push(args.end_date + ' 23:59:59'); }
      sql += ` ORDER BY run_at DESC LIMIT ${limit}`;

      const { rows } = await pool.query(sql, params);
      return rows.map((r) => ({
        id:         r.id,
        run_at:     r.run_at,
        start_date: r.start_date,
        end_date:   r.end_date,
        cost_aud:   r.cost_aud ? parseFloat(r.cost_aud).toFixed(4) : null,
        summary:    r.summary ?? '',
      }));
    }

    case 'search_report_history': {
      const limit = Math.min(args.limit || 10, 30);
      const params = [args.org_id, args.query];
      let sql = `
        SELECT
          id,
          slug,
          run_at,
          result->>'startDate'  AS start_date,
          result->>'endDate'    AS end_date,
          result->>'summary'    AS summary,
          ts_rank(
            to_tsvector('english', COALESCE(result->>'summary', '')),
            plainto_tsquery('english', $2)
          ) AS rank
        FROM agent_runs
        WHERE org_id = $1
          AND status = 'complete'
          AND to_tsvector('english', COALESCE(result->>'summary', ''))
              @@ plainto_tsquery('english', $2)
      `;
      if (args.slug) { sql += ` AND slug = $${params.length + 1}`; params.push(args.slug); }
      sql += ` ORDER BY rank DESC, run_at DESC LIMIT ${limit}`;

      const { rows } = await pool.query(sql, params);
      return rows.map((r) => ({
        id:         r.id,
        slug:       r.slug,
        run_at:     r.run_at,
        start_date: r.start_date,
        end_date:   r.end_date,
        summary:    r.summary ?? '',
      }));
    }

    case 'get_pending_suggestions': {
      const { org_id } = args;
      if (!org_id) throw new Error('org_id is required');
      const { rows } = await pool.query(
        `SELECT id, category, priority, suggestion_text, rationale, status,
                baseline_metrics, outcome_notes, created_at, reviewed_at
         FROM agent_suggestions
         WHERE org_id = $1 AND status IN ('pending', 'monitoring')
         ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                  created_at DESC`,
        [org_id]
      );
      return rows;
    }

    case 'update_suggestion_outcome': {
      const { org_id, suggestion_id, outcome_metrics, outcome_notes, status } = args;
      if (!org_id || !suggestion_id || !outcome_metrics || !outcome_notes) {
        throw new Error('org_id, suggestion_id, outcome_metrics, and outcome_notes are required');
      }
      await pool.query(
        `UPDATE agent_suggestions
         SET outcome_metrics = $1,
             outcome_notes   = $2,
             reviewed_at     = now(),
             status          = COALESCE($3, status)
         WHERE id = $4 AND org_id = $5`,
        [outcome_metrics, outcome_notes, status ?? null, suggestion_id, org_id]
      );
      return { updated: true, suggestion_id };
    }

    case 'get_suggestion_history': {
      const { org_id, limit } = args;
      if (!org_id) throw new Error('org_id is required');
      const cap = Math.min(limit || 100, 200);
      const { rows } = await pool.query(
        `SELECT user_action, user_reason, outcome_notes, outcome_metrics,
                baseline_metrics, created_at, acted_on_at, reviewed_at,
                category, priority, suggestion_text, rationale, status
         FROM agent_suggestions
         WHERE org_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [org_id, cap]
      );
      return rows;
    }

    case 'flag_prompt_for_review': {
      const { org_id, slug, reason } = args;
      if (!org_id || !slug || !reason) throw new Error('org_id, slug, and reason are required');
      await pool.query(
        `INSERT INTO prompt_flags (org_id, slug, reason) VALUES ($1, $2, $3)`,
        [org_id, slug, reason]
      );
      return { flagged: true, slug, reason };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── JSON-RPC transport ────────────────────────────────────────────────────────

function send(obj)               { process.stdout.write(JSON.stringify(obj) + '\n'); }
function respond(id, result)     { send({ jsonrpc: '2.0', id, result }); }
function respondError(id, c, m)  { send({ jsonrpc: '2.0', id, error: { code: c, message: m } }); }

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }

  const { id, method, params = {} } = msg;

  try {
    switch (method) {
      case 'initialize':
        respond(id, {
          protocolVersion: '2024-11-05',
          capabilities:    { tools: {} },
          serverInfo:      { name: 'platform-mcp', version: '1.2.0' },
        });
        break;
      case 'notifications/initialized': break;
      case 'tools/list':
        respond(id, { tools: TOOLS });
        break;
      case 'tools/call': {
        const result = await callTool(params.name, params.arguments || {});
        respond(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
        break;
      }
      default:
        respondError(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    respondError(id, -32000, err.message);
  }
});

rl.on('close', async () => { await pool.end(); process.exit(0); });
