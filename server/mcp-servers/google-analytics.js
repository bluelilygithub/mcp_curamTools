/**
 * google-analytics.js — Stdio MCP server wrapping GoogleAnalyticsService (GA4 Data API)
 *
 * Communicates via stdin/stdout (JSON-RPC, one message per line).
 * Register in Admin > MCP Servers as transport type: stdio, command: node,
 * args: ["/path/to/server/mcp-servers/google-analytics.js"].
 *
 * Required env vars (inherited from parent process or Railway):
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 *   GOOGLE_GA4_PROPERTY_ID
 */

'use strict';

const readline = require('readline');
const { GoogleAnalyticsService } = require('../services/GoogleAnalyticsService');

const ga = new GoogleAnalyticsService();

// ── Shared input schema ───────────────────────────────────────────────────────

const dateRangeProps = {
  days: {
    type:        'integer',
    description: 'Number of days to look back from today. Ignored if start_date + end_date are provided.',
  },
  start_date: {
    type:        'string',
    description: 'Range start date YYYY-MM-DD. Use with end_date for a precise window.',
  },
  end_date: {
    type:        'string',
    description: 'Range end date YYYY-MM-DD. Use with start_date for a precise window.',
  },
};

function resolveOptions(args) {
  if (args.start_date && args.end_date) return { startDate: args.start_date, endDate: args.end_date };
  return args.days ?? 30;
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
  {
    name:        'ga4_get_sessions_overview',
    description: 'Daily GA4 session metrics: date, sessions, activeUsers, newUsers, bounceRate (decimal, e.g. 0.42 = 42%). Ordered by date ASC. Use to identify traffic trends and paid traffic quality over time.',
    inputSchema: {
      type:       'object',
      properties: dateRangeProps,
    },
  },
  {
    name:        'ga4_get_traffic_sources',
    description: 'Sessions, conversions, and revenue grouped by traffic channel (Organic Search, Paid Search, Direct, etc.). Use to understand the channel mix and relative contribution of paid vs organic traffic.',
    inputSchema: {
      type:       'object',
      properties: dateRangeProps,
    },
  },
  {
    name:        'ga4_get_landing_page_performance',
    description: 'Top 20 landing pages by sessions: sessions, conversions, bounce rate, average session duration. Use to identify which pages paid traffic lands on and whether they convert.',
    inputSchema: {
      type:       'object',
      properties: dateRangeProps,
    },
  },
  {
    name:        'ga4_get_paid_bounced_sessions',
    description: 'GA4 sessions from paid search (cpc medium) grouped by landing page and device category. Returns sessions, bounce rate, and average session duration per landing page + device combination. Use to find which landing pages are failing paid traffic and whether mobile or desktop is worse.',
    inputSchema: {
      type:       'object',
      properties: dateRangeProps,
    },
  },
  {
    name:        'ga4_get_conversion_events',
    description: 'Conversion events by event name and date: event count and conversion count. Only returns events with at least one conversion. Use to understand when and how often users complete key actions.',
    inputSchema: {
      type:       'object',
      properties: dateRangeProps,
    },
  },
];

// ── Tool handlers ─────────────────────────────────────────────────────────────

async function callTool(name, args = {}) {
  switch (name) {
    case 'ga4_get_sessions_overview':
      return ga.getSessionsOverview(resolveOptions(args));

    case 'ga4_get_traffic_sources':
      return ga.getTrafficSources(resolveOptions(args));

    case 'ga4_get_landing_page_performance':
      return ga.getLandingPagePerformance(resolveOptions(args));

    case 'ga4_get_paid_bounced_sessions':
      return ga.getPaidBouncedSessions(resolveOptions(args));

    case 'ga4_get_conversion_events':
      return ga.getConversionEvents(resolveOptions(args));

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
          serverInfo:      { name: 'google-analytics-mcp', version: '1.0.0' },
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

rl.on('close', () => process.exit(0));
