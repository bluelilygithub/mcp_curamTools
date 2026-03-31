/**
 * wordpress.js — Stdio MCP server wrapping the WordPress REST API
 *
 * Communicates via stdin/stdout (JSON-RPC, one message per line).
 * Registered in Admin > MCP Servers as transport type: stdio.
 *
 * Required env vars (set in Railway / .env):
 *   WP_URL     — WordPress site base URL, e.g. https://diamondplate.com.au
 *   WP_USER    — WordPress username for Basic Auth
 *   WP_APP_VAR — WordPress application password
 */

const https = require('https');
const http  = require('http');
const readline = require('readline');

const WP_URL  = (process.env.WP_URL  || 'https://diamondplate.com.au').replace(/\/$/, '');
const WP_USER = process.env.WP_USER  || 'master';
const WP_PASS = process.env.WP_APP_VAR || '';
const AUTH    = Buffer.from(`${WP_USER}:${WP_PASS}`).toString('base64');

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'wp_get_user',
    description: 'Get a WordPress user by ID. Returns name, email, slug, and roles.',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: { type: 'number', description: 'WordPress user ID (e.g. 1 for admin)' },
      },
      required: ['user_id'],
    },
  },
  {
    name: 'wp_list_users',
    description: 'List WordPress users. Returns id, name, slug, and roles for each user.',
    inputSchema: {
      type: 'object',
      properties: {
        per_page: { type: 'number', description: 'Max users to return (1-100, default 10)' },
      },
    },
  },
  {
    name: 'wp_list_posts',
    description: 'List published WordPress posts. Returns id, title, status, date, and link.',
    inputSchema: {
      type: 'object',
      properties: {
        per_page: { type: 'number', description: 'Max posts to return (1-100, default 10)' },
        status:   { type: 'string', description: 'Post status filter: publish, draft, any (default: publish)' },
      },
    },
  },
  {
    name: 'wp_get_post',
    description: 'Get a single WordPress post by ID. Returns title, content, status, date, and link.',
    inputSchema: {
      type: 'object',
      properties: {
        post_id: { type: 'number', description: 'WordPress post ID' },
      },
      required: ['post_id'],
    },
  },
  {
    name: 'wp_get_enquiries',
    description: 'Fetch clientenquiry posts with UTM tracking fields and enquiry status. Returns raw REST API response so the field structure can be inspected.',
    inputSchema: {
      type: 'object',
      properties: {
        per_page:   { type: 'number', description: 'Max enquiries to return (1-100, default 20)' },
        start_date: { type: 'string', description: 'ISO date filter — enquiries on or after this date (YYYY-MM-DD)' },
        end_date:   { type: 'string', description: 'ISO date filter — enquiries on or before this date (YYYY-MM-DD)' },
      },
    },
  },
  {
    name: 'wp_enquiry_field_check',
    description: 'Fetches a single clientenquiry post (the most recent one) and returns its full raw REST API response. Use this to discover exactly which keys hold the ACF/meta fields.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'wp_get_server_ip',
    description: 'Returns the outbound IP address of this MCP server process. Use this to find the IP that needs to be whitelisted in SiteGround or any WAF/firewall protecting the WordPress site.',
    inputSchema: { type: 'object', properties: {} },
  },
];

// ── WordPress REST API helper ─────────────────────────────────────────────────

function wpRequest(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${WP_URL}/wp-json/wp/v2${path}`);
    const transport = url.protocol === 'https:' ? https : http;

    const req = transport.request(
      {
        hostname: url.hostname,
        port:     url.port || (url.protocol === 'https:' ? 443 : 80),
        path:     url.pathname + url.search,
        method:   'GET',
        headers: {
          Authorization: `Basic ${AUTH}`,
          Accept:        'application/json',
          'User-Agent':  'MCP-curamTools/1.0 (WordPress REST API client)',
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 400) {
              reject(new Error(parsed.message || `HTTP ${res.statusCode}`));
            } else {
              resolve(parsed);
            }
          } catch {
            reject(new Error(`Non-JSON response (HTTP ${res.statusCode}): ${data.slice(0, 120)}`));
          }
        });
      }
    );

    req.on('error', reject);
    req.end();
  });
}

// ── Tool handlers ─────────────────────────────────────────────────────────────

async function callTool(name, args = {}) {
  switch (name) {
    case 'wp_get_user': {
      const u = await wpRequest(`/users/${args.user_id}`);
      return { id: u.id, name: u.name, slug: u.slug, email: u.email, roles: u.roles, registered: u.registered_date };
    }

    case 'wp_list_users': {
      const perPage = Math.min(args.per_page || 10, 100);
      const users = await wpRequest(`/users?per_page=${perPage}`);
      return users.map((u) => ({ id: u.id, name: u.name, slug: u.slug, roles: u.roles }));
    }

    case 'wp_list_posts': {
      const perPage = Math.min(args.per_page || 10, 100);
      const status  = args.status || 'publish';
      const posts   = await wpRequest(`/posts?per_page=${perPage}&status=${status}`);
      return posts.map((p) => ({ id: p.id, title: p.title?.rendered, status: p.status, date: p.date, link: p.link }));
    }

    case 'wp_get_post': {
      const p = await wpRequest(`/posts/${args.post_id}`);
      return {
        id:      p.id,
        title:   p.title?.rendered,
        content: p.content?.rendered?.replace(/<[^>]+>/g, '').trim().slice(0, 500),
        status:  p.status,
        date:    p.date,
        link:    p.link,
      };
    }

    case 'wp_enquiry_field_check': {
      // Fetch several recent enquiries and return their raw acf + meta so we can
      // see exactly which keys hold the data and what the values look like.
      const items = await wpRequest('/clientenquiry?per_page=10&orderby=date&order=desc');
      if (!Array.isArray(items) || items.length === 0) return { error: 'No clientenquiry posts found — post type may not be REST-enabled' };
      return items.map((item) => ({
        id:       item.id,
        date:     item.date,
        acf_type: Array.isArray(item.acf) ? 'array (empty — REST not enabled for this group)' : typeof item.acf,
        acf_keys: item.acf && !Array.isArray(item.acf) ? Object.keys(item.acf) : [],
        acf_sample: item.acf && !Array.isArray(item.acf)
          ? Object.fromEntries(Object.entries(item.acf).filter(([, v]) => v !== '' && v !== null && v !== false).slice(0, 10))
          : null,
        meta_keys: item.meta ? Object.keys(item.meta) : [],
        meta_sample: item.meta
          ? Object.fromEntries(Object.entries(item.meta).filter(([, v]) => v !== '' && v !== null).slice(0, 10))
          : null,
      }));
    }

    case 'wp_get_enquiries': {
      const perPage = Math.min(args.per_page || 20, 100);
      const params  = new URLSearchParams({ per_page: perPage, orderby: 'date', order: 'desc' });
      if (args.start_date) params.set('after',  args.start_date + 'T00:00:00');
      if (args.end_date)   params.set('before', args.end_date   + 'T23:59:59');
      const items = await wpRequest(`/clientenquiry?${params}`);
      if (!Array.isArray(items)) return { error: 'Unexpected response', raw: items };

      // Try both acf and meta key locations — which one has data depends on WP setup
      const str = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

      return items.map((item) => {
        const acf  = Array.isArray(item.acf) ? {} : (item.acf  || {});
        const meta = item.meta || {};
        // Prefer acf key if it has string values, fall back to meta
        const f = Object.keys(acf).length ? acf : meta;
        return {
          id:            item.id,
          date:          item.date,
          enquiry_status: str(f.enquiry_status),
          utm_source:    str(f.utm_source),
          utm_medium:    str(f.utm_medium),
          utm_campaign:  str(f.utm_campaign),
          utm_ad_group:  str(f.utm_ad_group),
          utm_term:      str(f.utm_term),
          utm_content:   str(f.utm_content),
          search_term:   str(f.search_term),
          device_type:   str(f.device_type),
          landing_page:  str(f.landing_page),
          referral_page: str(f.referral_page),
          gclid:         str(f.gclib),
          ga4_client_id: str(f.ga4_client_id),
        };
      });
    }

    case 'wp_get_server_ip': {
      return new Promise((resolve, reject) => {
        https.get('https://api.ipify.org?format=json', (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              const { ip } = JSON.parse(data);
              resolve({ ip, note: 'Whitelist this IP in SiteGround Site Tools > Security > IP Manager' });
            } catch {
              resolve({ raw: data });
            }
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
          serverInfo:      { name: 'wordpress-mcp', version: '1.0.0' },
        });
        break;

      case 'notifications/initialized':
        // No response needed for notifications
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

rl.on('close', () => process.exit(0));
