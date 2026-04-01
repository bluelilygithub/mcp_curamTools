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
    description: 'Fetch clientenquiry leads directly from the WordPress database. Includes UTM attribution, search term, device type, landing page, gclid, GA4 client ID, and enquiry status. Years of history available. Use start_date/end_date for period filtering.',
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
];

// ── Tool handlers ─────────────────────────────────────────────────────────────

async function callTool(name, args = {}) {
  switch (name) {

    case 'wp_get_enquiries': {
      const limit  = Math.min(parseInt(args.limit || 500), 5000);
      const params = [];

      let sql = `
        SELECT
          p.ID            AS id,
          p.post_date     AS date,
          p.post_status   AS post_status,
          MAX(CASE WHEN pm.meta_key = 'enquiry_status'  THEN pm.meta_value END) AS enquiry_status,
          MAX(CASE WHEN pm.meta_key = 'utm_source'      THEN pm.meta_value END) AS utm_source,
          MAX(CASE WHEN pm.meta_key = 'utm_medium'      THEN pm.meta_value END) AS utm_medium,
          MAX(CASE WHEN pm.meta_key = 'utm_campaign'    THEN pm.meta_value END) AS utm_campaign,
          MAX(CASE WHEN pm.meta_key = 'utm_ad_group'    THEN pm.meta_value END) AS utm_ad_group,
          MAX(CASE WHEN pm.meta_key = 'utm_term'        THEN pm.meta_value END) AS utm_term,
          MAX(CASE WHEN pm.meta_key = 'utm_content'     THEN pm.meta_value END) AS utm_content,
          MAX(CASE WHEN pm.meta_key = 'search_term'     THEN pm.meta_value END) AS search_term,
          MAX(CASE WHEN pm.meta_key = 'device_type'     THEN pm.meta_value END) AS device_type,
          MAX(CASE WHEN pm.meta_key = 'landing_page'    THEN pm.meta_value END) AS landing_page,
          MAX(CASE WHEN pm.meta_key = 'referral_page'   THEN pm.meta_value END) AS referral_page,
          MAX(CASE WHEN pm.meta_key = 'gclib'           THEN pm.meta_value END) AS gclid,
          MAX(CASE WHEN pm.meta_key = 'ga4_client_id'   THEN pm.meta_value END) AS ga4_client_id
        FROM bqq_posts p
        LEFT JOIN bqq_postmeta pm ON p.ID = pm.post_id
        WHERE p.post_type = 'clientenquiry'
          AND p.post_status != 'trash'
      `;

      if (args.start_date) { sql += ` AND p.post_date >= ?`; params.push(args.start_date + ' 00:00:00'); }
      if (args.end_date)   { sql += ` AND p.post_date <= ?`; params.push(args.end_date   + ' 23:59:59'); }
      if (args.status)     { sql += ` AND EXISTS (SELECT 1 FROM bqq_postmeta WHERE post_id = p.ID AND meta_key = 'enquiry_status' AND meta_value = ?)`; params.push(args.status); }

      sql += ` GROUP BY p.ID, p.post_date, p.post_status ORDER BY p.post_date DESC LIMIT ${limit}`;

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
        gclid:          str(r.gclid),
        ga4_client_id:  str(r.ga4_client_id),
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
