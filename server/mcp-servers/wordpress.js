/**
 * wordpress.js — Stdio MCP server for WordPress data via direct MySQL connection.
 *
 * Connects directly to the WordPress database, bypassing the REST API and any
 * WAF / CAPTCHA protection on the HTTP layer.
 *
 * Communicates via stdin/stdout (JSON-RPC, one message per line).
 * Registered in Admin > MCP Servers as transport type: stdio.
 *
 * Required env vars:
 *   WP_DB_HOST — MySQL server host (SiteGround site IP)
 *   WP_DB_NAME — WordPress database name
 *   WP_DB_USER — MySQL username
 *   WP_DB_PASS — MySQL password
 *   WP_DB_PORT — MySQL port (optional, default 3306)
 */

'use strict';

const mysql    = require('mysql2/promise');
const readline = require('readline');

const DB_CONFIG = {
  host:               process.env.WP_DB_HOST,
  port:               parseInt(process.env.WP_DB_PORT || '3306'),
  database:           process.env.WP_DB_NAME,
  user:               process.env.WP_DB_USER,
  password:           process.env.WP_DB_PASS,
  ssl:                { rejectUnauthorized: false },
  connectTimeout:     10000,
};

let pool = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({ ...DB_CONFIG, waitForConnections: true, connectionLimit: 3 });
  }
  return pool;
}

async function query(sql, params = []) {
  const [rows] = await getPool().query(sql, params);
  return rows;
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'wp_get_enquiries',
    description: 'Fetch clientenquiry leads directly from the WordPress database. Includes UTM attribution, search term, device type, landing page, gclid, GA4 client ID, enquiry status, and reason_not_interested. Years of history available. Use start_date/end_date for period filtering.',
    inputSchema: {
      type: 'object',
      properties: {
        limit:      { type: 'number',  description: 'Max records to return. Default 500. Use 2000+ for full historical analysis.' },
        start_date: { type: 'string',  description: 'Filter enquiries on or after this date (YYYY-MM-DD).' },
        end_date:   { type: 'string',  description: 'Filter enquiries on or before this date (YYYY-MM-DD).' },
        status:     { type: 'string',  description: 'Filter by enquiry_status value if known.' },
      },
    },
  },
  {
    name: 'wp_enquiry_field_check',
    description: 'Returns a sample of recent clientenquiry records with all meta keys and values. Use to diagnose which fields are populated and what values they hold.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'wp_get_server_ip',
    description: 'Returns the outbound IP address of this MCP server process.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'wp_get_not_interested_reasons',
    description: 'Returns all clientenquiry records that have a reason_not_interested value, with their UTM attribution. Use this specifically for analysing why leads did not proceed.',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'Filter on or after this date (YYYY-MM-DD).' },
        end_date:   { type: 'string', description: 'Filter on or before this date (YYYY-MM-DD).' },
      },
    },
  },
  {
    name: 'wp_find_meta_key',
    description: 'Search bqq_postmeta for rows matching a key or value pattern. Use to find the exact meta_key a field is stored under.',
    inputSchema: {
      type: 'object',
      properties: {
        key_like:   { type: 'string', description: 'Partial meta_key to search for (SQL LIKE pattern, e.g. "reason").' },
        value_like: { type: 'string', description: 'Partial meta_value to search for.' },
      },
    },
  },
  {
    name: 'wp_get_enquiry_details',
    description: 'Extended clientenquiry records with full CRM fields beyond the basic wp_get_enquiries tool. Adds: sales_rep, package_type, enquiry_source, contacted_date, invoiced_date, completion_date, appointment_date, calculated_value, final_value, technician, job_number. Use for lead velocity, pipeline value, and sales rep analysis. Years of history available.',
    inputSchema: {
      type: 'object',
      properties: {
        limit:      { type: 'number', description: 'Max records. Default 1000. Use 3000+ for full history.' },
        start_date: { type: 'string', description: 'Filter enquiries on or after this date (YYYY-MM-DD).' },
        end_date:   { type: 'string', description: 'Filter enquiries on or before this date (YYYY-MM-DD).' },
        status:     { type: 'string', description: 'Filter by enquiry_status value.' },
      },
    },
  },
  {
    name: 'wp_get_progress_details',
    description: 'Fetch progress_details ACF repeater rows (Enquiry Related Activities) for clientenquiry records. Each row contains: entry_date (d/m/Y g:i a — when logged), next_event (scheduled follow-up datetime), next_action (Phone/Email/Appointment/Invoice/Warranty), event_message (notes), staff_member. All enquiries in the range are returned — posts with zero activity rows are included with row_count=0. Use for lead velocity, follow-up intensity, response time, and activity heatmap analysis.',
    inputSchema: {
      type: 'object',
      properties: {
        limit:      { type: 'number', description: 'Max enquiries to scan. Default 1000.' },
        start_date: { type: 'string', description: 'Filter enquiries submitted on or after this date (YYYY-MM-DD).' },
        end_date:   { type: 'string', description: 'Filter enquiries submitted on or before this date (YYYY-MM-DD).' },
      },
    },
  },
];

// ── Tool handlers ─────────────────────────────────────────────────────────────

async function callTool(name, args = {}) {
  switch (name) {

    case 'wp_get_enquiries': {
      const limit  = Math.min(parseInt(args.limit || 500), 5000);
      const params = [];

      let sql = `
        SELECT
          p.ID              AS id,
          p.post_date       AS date,
          p.post_status     AS post_status,
          pm_es.meta_value  AS enquiry_status,
          pm_src.meta_value AS utm_source,
          pm_med.meta_value AS utm_medium,
          pm_cmp.meta_value AS utm_campaign,
          pm_ag.meta_value  AS utm_ad_group,
          pm_trm.meta_value AS utm_term,
          pm_con.meta_value AS utm_content,
          pm_st.meta_value  AS search_term,
          pm_dev.meta_value AS device_type,
          pm_lp.meta_value  AS landing_page,
          pm_rp.meta_value  AS referral_page,
          pm_gc.meta_value  AS gclid,
          pm_ga.meta_value  AS ga4_client_id,
          pm_ni.meta_value  AS reason_not_interested
        FROM bqq_posts p
        LEFT JOIN bqq_postmeta pm_es  ON p.ID = pm_es.post_id  AND pm_es.meta_key  = 'enquiry_status'
        LEFT JOIN bqq_postmeta pm_src ON p.ID = pm_src.post_id AND pm_src.meta_key = 'utm_source'
        LEFT JOIN bqq_postmeta pm_med ON p.ID = pm_med.post_id AND pm_med.meta_key = 'utm_medium'
        LEFT JOIN bqq_postmeta pm_cmp ON p.ID = pm_cmp.post_id AND pm_cmp.meta_key = 'utm_campaign'
        LEFT JOIN bqq_postmeta pm_ag  ON p.ID = pm_ag.post_id  AND pm_ag.meta_key  = 'utm_ad_group'
        LEFT JOIN bqq_postmeta pm_trm ON p.ID = pm_trm.post_id AND pm_trm.meta_key = 'utm_term'
        LEFT JOIN bqq_postmeta pm_con ON p.ID = pm_con.post_id AND pm_con.meta_key = 'utm_content'
        LEFT JOIN bqq_postmeta pm_st  ON p.ID = pm_st.post_id  AND pm_st.meta_key  = 'search_term'
        LEFT JOIN bqq_postmeta pm_dev ON p.ID = pm_dev.post_id AND pm_dev.meta_key = 'device_type'
        LEFT JOIN bqq_postmeta pm_lp  ON p.ID = pm_lp.post_id  AND pm_lp.meta_key  = 'landing_page'
        LEFT JOIN bqq_postmeta pm_rp  ON p.ID = pm_rp.post_id  AND pm_rp.meta_key  = 'referral_page'
        LEFT JOIN bqq_postmeta pm_gc  ON p.ID = pm_gc.post_id  AND pm_gc.meta_key  = 'gclib'
        LEFT JOIN bqq_postmeta pm_ga  ON p.ID = pm_ga.post_id  AND pm_ga.meta_key  = 'ga4_client_id'
        LEFT JOIN bqq_postmeta pm_ni  ON p.ID = pm_ni.post_id  AND pm_ni.meta_key  = 'reason_not_interested'
        WHERE p.post_type = 'clientenquiry'
          AND p.post_status != 'trash'
      `;

      if (args.start_date) { sql += ` AND p.post_date >= ?`; params.push(args.start_date + ' 00:00:00'); }
      if (args.end_date)   { sql += ` AND p.post_date <= ?`; params.push(args.end_date   + ' 23:59:59'); }
      if (args.status)     { sql += ` AND pm_es.meta_value = ?`; params.push(args.status); }

      sql += ` ORDER BY p.post_date DESC LIMIT ${limit}`;

      const rows = await query(sql, params);

      // Normalise — strip nulls and empty strings
      const str = (v) => (v != null && String(v).trim() !== '' ? String(v).trim() : null);
      return rows.map((r) => ({
        id:             r.id,
        date:           r.date,
        enquiry_status: str(r.enquiry_status),
        utm_source:     str(r.utm_source),
        utm_medium:     str(r.utm_medium),
        utm_campaign:   str(r.utm_campaign),
        utm_ad_group:   str(r.utm_ad_group),
        utm_term:       str(r.utm_term),
        utm_content:    str(r.utm_content),
        search_term:    str(r.search_term),
        device_type:    str(r.device_type),
        landing_page:   str(r.landing_page),
        referral_page:  str(r.referral_page),
        gclid:                  str(r.gclid),
        ga4_client_id:          str(r.ga4_client_id),
        reason_not_interested:  str(r.reason_not_interested),
      }));
    }

    case 'wp_enquiry_field_check': {
      // Fetch the raw meta keys for the 5 most recent enquiries
      const posts = await query(
        `SELECT ID, post_date FROM bqq_posts WHERE post_type = 'clientenquiry' AND post_status != 'trash' ORDER BY post_date DESC LIMIT 5`
      );
      if (!posts.length) return { error: 'No clientenquiry posts found.' };

      const results = [];
      for (const post of posts) {
        const meta = await query(`SELECT meta_key, meta_value FROM bqq_postmeta WHERE post_id = ?`, [post.ID]);
        const populated = meta.filter((m) => m.meta_value != null && String(m.meta_value).trim() !== '');
        results.push({
          id:    post.ID,
          date:  post.post_date,
          keys:  populated.map((m) => m.meta_key),
          sample: Object.fromEntries(populated.slice(0, 15).map((m) => [m.meta_key, m.meta_value])),
        });
      }
      return results;
    }

    case 'wp_get_not_interested_reasons': {
      const params = [];
      let sql = `
        SELECT
          p.ID              AS id,
          p.post_date       AS date,
          pm_r.meta_value   AS reason_not_interested,
          pm_es.meta_value  AS enquiry_status,
          pm_src.meta_value AS utm_source,
          pm_cmp.meta_value AS utm_campaign,
          pm_med.meta_value AS utm_medium,
          pm_dev.meta_value AS device_type,
          pm_st.meta_value  AS search_term
        FROM bqq_posts p
        INNER JOIN bqq_postmeta pm_r
          ON p.ID = pm_r.post_id AND pm_r.meta_key = 'reason_not_interested' AND pm_r.meta_value != ''
        LEFT JOIN bqq_postmeta pm_es
          ON p.ID = pm_es.post_id  AND pm_es.meta_key  = 'enquiry_status'
        LEFT JOIN bqq_postmeta pm_src
          ON p.ID = pm_src.post_id AND pm_src.meta_key = 'utm_source'
        LEFT JOIN bqq_postmeta pm_cmp
          ON p.ID = pm_cmp.post_id AND pm_cmp.meta_key = 'utm_campaign'
        LEFT JOIN bqq_postmeta pm_med
          ON p.ID = pm_med.post_id AND pm_med.meta_key = 'utm_medium'
        LEFT JOIN bqq_postmeta pm_dev
          ON p.ID = pm_dev.post_id AND pm_dev.meta_key = 'device_type'
        LEFT JOIN bqq_postmeta pm_st
          ON p.ID = pm_st.post_id  AND pm_st.meta_key  = 'search_term'
        WHERE p.post_type = 'clientenquiry'
          AND p.post_status != 'trash'
      `;
      if (args.start_date) { sql += ` AND p.post_date >= ?`; params.push(args.start_date + ' 00:00:00'); }
      if (args.end_date)   { sql += ` AND p.post_date <= ?`; params.push(args.end_date   + ' 23:59:59'); }
      sql += ` ORDER BY p.post_date DESC`;

      const rows = await query(sql, params);
      const str = (v) => (v != null && String(v).trim() !== '' ? String(v).trim() : null);
      return rows.map((r) => ({
        id:                    r.id,
        date:                  r.date,
        reason_not_interested: str(r.reason_not_interested),
        enquiry_status:        str(r.enquiry_status),
        utm_source:            str(r.utm_source),
        utm_campaign:          str(r.utm_campaign),
        utm_medium:            str(r.utm_medium),
        device_type:           str(r.device_type),
        search_term:           str(r.search_term),
      }));
    }

    case 'wp_find_meta_key': {
      const conditions = [];
      const params = [];
      if (args.key_like)   { conditions.push(`pm.meta_key   LIKE ?`); params.push(`%${args.key_like}%`); }
      if (args.value_like) { conditions.push(`pm.meta_value LIKE ?`); params.push(`%${args.value_like}%`); }
      if (!conditions.length) throw new Error('Provide key_like or value_like.');
      const rows = await query(
        `SELECT pm.meta_key, pm.meta_value, pm.post_id, p.post_type
           FROM bqq_postmeta pm
           JOIN bqq_posts p ON p.ID = pm.post_id
          WHERE ${conditions.join(' AND ')}
          LIMIT 30`,
        params
      );
      return rows;
    }

    case 'wp_get_server_ip': {
      const https = require('https');
      return new Promise((resolve, reject) => {
        https.get('https://api.ipify.org?format=json', (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try { resolve({ ip: JSON.parse(data).ip }); }
            catch { resolve({ raw: data }); }
          });
        }).on('error', reject);
      });
    }

    case 'wp_get_enquiry_details': {
      const limit  = Math.min(parseInt(args.limit || 1000), 5000);
      const params = [];

      let sql = `
        SELECT
          p.ID                AS id,
          p.post_date         AS date,
          pm_es.meta_value    AS enquiry_status,
          pm_src.meta_value   AS utm_source,
          pm_med.meta_value   AS utm_medium,
          pm_cmp.meta_value   AS utm_campaign,
          pm_ag.meta_value    AS utm_ad_group,
          pm_trm.meta_value   AS utm_term,
          pm_dev.meta_value   AS device_type,
          pm_lp.meta_value    AS landing_page,
          pm_gc.meta_value    AS gclid,
          pm_ni.meta_value    AS reason_not_interested,
          pm_jn.meta_value    AS job_number,
          pm_sr.meta_value    AS sales_rep,
          pm_pt.meta_value    AS package_type,
          pm_eqs.meta_value   AS enquiry_source,
          pm_cd.meta_value    AS contacted_date,
          pm_inv.meta_value   AS invoiced_date,
          pm_cpd.meta_value   AS completion_date,
          pm_apd.meta_value   AS appointment_date,
          pm_cv.meta_value    AS calculated_value,
          pm_fv.meta_value    AS final_value,
          pm_tech.meta_value  AS technician
        FROM bqq_posts p
        LEFT JOIN bqq_postmeta pm_es   ON p.ID = pm_es.post_id   AND pm_es.meta_key   = 'enquiry_status'
        LEFT JOIN bqq_postmeta pm_src  ON p.ID = pm_src.post_id  AND pm_src.meta_key  = 'utm_source'
        LEFT JOIN bqq_postmeta pm_med  ON p.ID = pm_med.post_id  AND pm_med.meta_key  = 'utm_medium'
        LEFT JOIN bqq_postmeta pm_cmp  ON p.ID = pm_cmp.post_id  AND pm_cmp.meta_key  = 'utm_campaign'
        LEFT JOIN bqq_postmeta pm_ag   ON p.ID = pm_ag.post_id   AND pm_ag.meta_key   = 'utm_ad_group'
        LEFT JOIN bqq_postmeta pm_trm  ON p.ID = pm_trm.post_id  AND pm_trm.meta_key  = 'utm_term'
        LEFT JOIN bqq_postmeta pm_dev  ON p.ID = pm_dev.post_id  AND pm_dev.meta_key  = 'device_type'
        LEFT JOIN bqq_postmeta pm_lp   ON p.ID = pm_lp.post_id   AND pm_lp.meta_key   = 'landing_page'
        LEFT JOIN bqq_postmeta pm_gc   ON p.ID = pm_gc.post_id   AND pm_gc.meta_key   = 'gclid'
        LEFT JOIN bqq_postmeta pm_ni   ON p.ID = pm_ni.post_id   AND pm_ni.meta_key   = 'reason_not_interested'
        LEFT JOIN bqq_postmeta pm_jn   ON p.ID = pm_jn.post_id   AND pm_jn.meta_key   = 'job_number'
        LEFT JOIN bqq_postmeta pm_sr   ON p.ID = pm_sr.post_id   AND pm_sr.meta_key   = 'sales_rep'
        LEFT JOIN bqq_postmeta pm_pt   ON p.ID = pm_pt.post_id   AND pm_pt.meta_key   = 'package_type'
        LEFT JOIN bqq_postmeta pm_eqs  ON p.ID = pm_eqs.post_id  AND pm_eqs.meta_key  = 'enquiry_source'
        LEFT JOIN bqq_postmeta pm_cd   ON p.ID = pm_cd.post_id   AND pm_cd.meta_key   = 'contacted_date'
        LEFT JOIN bqq_postmeta pm_inv  ON p.ID = pm_inv.post_id  AND pm_inv.meta_key  = 'invoiced_date'
        LEFT JOIN bqq_postmeta pm_cpd  ON p.ID = pm_cpd.post_id  AND pm_cpd.meta_key  = 'completion_date'
        LEFT JOIN bqq_postmeta pm_apd  ON p.ID = pm_apd.post_id  AND pm_apd.meta_key  = 'appointment_date'
        LEFT JOIN bqq_postmeta pm_cv   ON p.ID = pm_cv.post_id   AND pm_cv.meta_key   = 'calculated_value'
        LEFT JOIN bqq_postmeta pm_fv   ON p.ID = pm_fv.post_id   AND pm_fv.meta_key   = 'final_value'
        LEFT JOIN bqq_postmeta pm_tech ON p.ID = pm_tech.post_id AND pm_tech.meta_key = 'technician'
        WHERE p.post_type = 'clientenquiry'
          AND p.post_status != 'trash'
      `;

      if (args.start_date) { sql += ` AND p.post_date >= ?`; params.push(args.start_date + ' 00:00:00'); }
      if (args.end_date)   { sql += ` AND p.post_date <= ?`; params.push(args.end_date   + ' 23:59:59'); }
      if (args.status)     { sql += ` AND pm_es.meta_value = ?`; params.push(args.status); }

      sql += ` ORDER BY p.post_date DESC LIMIT ${limit}`;

      const rows = await query(sql, params);
      const str = (v) => (v != null && String(v).trim() !== '' ? String(v).trim() : null);
      return rows.map((r) => ({
        id:               r.id,
        date:             r.date,
        enquiry_status:   str(r.enquiry_status),
        utm_source:       str(r.utm_source),
        utm_medium:       str(r.utm_medium),
        utm_campaign:     str(r.utm_campaign),
        utm_ad_group:     str(r.utm_ad_group),
        utm_term:         str(r.utm_term),
        device_type:      str(r.device_type),
        landing_page:     str(r.landing_page),
        gclid:            str(r.gclid),
        reason_not_interested: str(r.reason_not_interested),
        job_number:       str(r.job_number),
        sales_rep:        str(r.sales_rep),
        package_type:     str(r.package_type),
        enquiry_source:   str(r.enquiry_source),
        contacted_date:   str(r.contacted_date),
        invoiced_date:    str(r.invoiced_date),
        completion_date:  str(r.completion_date),
        appointment_date: str(r.appointment_date),
        calculated_value: str(r.calculated_value),
        final_value:      str(r.final_value),
        technician:       str(r.technician),
      }));
    }

    case 'wp_get_progress_details': {
      const limit  = Math.min(parseInt(args.limit || 1000), 5000);
      const params = [];

      // Step 1 — all post IDs + dates in the range
      let postSql = `
        SELECT p.ID AS post_id, p.post_date AS enquiry_date
        FROM bqq_posts p
        WHERE p.post_type = 'clientenquiry'
          AND p.post_status != 'trash'
      `;
      if (args.start_date) { postSql += ` AND p.post_date >= ?`; params.push(args.start_date + ' 00:00:00'); }
      if (args.end_date)   { postSql += ` AND p.post_date <= ?`; params.push(args.end_date   + ' 23:59:59'); }
      postSql += ` ORDER BY p.post_date DESC LIMIT ${limit}`;

      const posts = await query(postSql, params);
      if (!posts.length) return [];

      const postIds = posts.map((p) => p.post_id);

      // Step 2 — all progress_details meta rows for those IDs
      const placeholders = postIds.map(() => '?').join(',');
      const metaRows = await query(
        `SELECT pm.post_id, pm.meta_key, pm.meta_value
           FROM bqq_postmeta pm
          WHERE pm.post_id IN (${placeholders})
            AND pm.meta_key NOT LIKE '\\_%'
            AND (
              pm.meta_key = 'progress_details'
              OR pm.meta_key REGEXP '^progress_details_[0-9]+_(staff_member|entry_date|next_event|next_action|event_message)$'
            )
          ORDER BY pm.post_id, pm.meta_key`,
        postIds
      );

      // Step 3 — group into per-post structure; include all posts even with zero rows
      const byPost = new Map();
      for (const p of posts) {
        byPost.set(p.post_id, { post_id: p.post_id, enquiry_date: p.enquiry_date, count: null, rows: {} });
      }
      for (const row of metaRows) {
        const post = byPost.get(row.post_id);
        if (!post) continue;
        if (row.meta_key === 'progress_details') {
          post.count = parseInt(row.meta_value) || 0;
          continue;
        }
        const m = row.meta_key.match(/^progress_details_(\d+)_(.+)$/);
        if (!m) continue;
        const [, idx, field] = m;
        if (!post.rows[idx]) post.rows[idx] = { index: parseInt(idx) };
        post.rows[idx][field] = row.meta_value || null;
      }

      return Array.from(byPost.values()).map((p) => {
        const sortedRows = Object.values(p.rows).sort((a, b) => a.index - b.index);
        return {
          post_id:      p.post_id,
          enquiry_date: p.enquiry_date,
          row_count:    p.count !== null ? p.count : sortedRows.length,
          rows:         sortedRows,
        };
      });
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── JSON-RPC transport ────────────────────────────────────────────────────────

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function respondError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

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
          serverInfo:      { name: 'wordpress-mcp', version: '2.0.0' },
        });
        break;

      case 'notifications/initialized':
        break;

      case 'tools/list':
        respond(id, { tools: TOOLS });
        break;

      case 'tools/call': {
        const result = await callTool(params.name, params.arguments || {});
        respond(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        });
        break;
      }

      default:
        respondError(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    respondError(id, -32000, err.message);
  }
});

rl.on('close', async () => {
  if (pool) await pool.end();
  process.exit(0);
});
