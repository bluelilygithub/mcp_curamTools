'use strict';

/**
 * mcpTools.js — Shared helpers for calling MCP servers from agent tools.
 *
 * Pattern: agents call external integrations (Google Ads, GA4, WordPress) via
 * registered MCP servers, not by importing service classes directly. This keeps
 * the integration configuration in Admin > MCP Servers — one place, one process.
 *
 * Usage in agent tools.js:
 *   const { getAdsServer, getAnalyticsServer, callMcpTool, resolveRangeArgs } = require('../../platform/mcpTools');
 *
 *   async execute(input, context) {
 *     const ads = await getAdsServer(context.orgId);
 *     return callMcpTool(context.orgId, ads, 'ads_get_campaign_performance', {
 *       ...resolveRangeArgs(context, input),
 *       customer_id: context.customerId ?? null,
 *     });
 *   }
 */

const MCPRegistry = require('./mcpRegistry');

// ── Server finders ────────────────────────────────────────────────────────────

/**
 * Resolve the registered Google Ads MCP server for this org.
 * Matches by looking for a server whose config args include 'google-ads'.
 * Auto-connects if the server is registered but not yet connected.
 *
 * @param {string} orgId
 * @returns {Promise<object>} server record from MCPRegistry
 */
async function getAdsServer(orgId) {
  const server = await findAndConnect(orgId, 'google-ads');
  if (!server) {
    throw new Error(
      'No Google Ads MCP server registered for this organisation. ' +
      'Add one in Admin > MCP Servers (command: node, args: [.../mcp-servers/google-ads.js]).'
    );
  }
  return server;
}

/**
 * Resolve the registered Google Analytics MCP server for this org.
 * Matches by looking for a server whose config args include 'google-analytics'.
 * Auto-connects if the server is registered but not yet connected.
 *
 * @param {string} orgId
 * @returns {Promise<object>} server record from MCPRegistry
 */
async function getAnalyticsServer(orgId) {
  const server = await findAndConnect(orgId, 'google-analytics');
  if (!server) {
    throw new Error(
      'No Google Analytics MCP server registered for this organisation. ' +
      'Add one in Admin > MCP Servers (command: node, args: [.../mcp-servers/google-analytics.js]).'
    );
  }
  return server;
}

/**
 * Resolve the registered WordPress MCP server for this org.
 * Matches by looking for a server whose config args include 'wordpress'.
 * Auto-connects if the server is registered but not yet connected.
 *
 * @param {string} orgId
 * @returns {Promise<object>} server record from MCPRegistry
 */
async function getWordPressServer(orgId) {
  const server = await findAndConnect(orgId, 'wordpress');
  if (!server) {
    throw new Error(
      'No WordPress MCP server registered for this organisation. ' +
      'Add one in Admin > MCP Servers (command: node, args: [.../mcp-servers/wordpress.js]).'
    );
  }
  return server;
}

/**
 * Resolve the registered Platform MCP server for this org.
 * Matches by looking for a server whose config args include 'platform'.
 */
async function getPlatformServer(orgId) {
  const server = await findAndConnect(orgId, 'platform');
  if (!server) {
    throw new Error(
      'No Platform MCP server registered for this organisation. ' +
      'Add one in Admin > MCP Servers (command: node, args: [.../mcp-servers/platform.js]).'
    );
  }
  return server;
}

async function getKnowledgeBaseServer(orgId) {
  const server = await findAndConnect(orgId, 'knowledge-base');
  if (!server) {
    throw new Error(
      'No Knowledge Base MCP server registered for this organisation. ' +
      'Add one in Admin > MCP Servers (command: node, args: [.../mcp-servers/knowledge-base.js]).'
    );
  }
  return server;
}

/** @private Find a server matching a slug keyword and auto-connect if needed. */
async function findAndConnect(orgId, keyword) {
  const servers = await MCPRegistry.list(orgId);
  const match = servers.find((s) => {
    const args = s.config?.args ?? [];
    return args.some((a) => String(a).includes(keyword));
  });
  if (!match) return null;
  if (match.connection_status !== 'connected') {
    await MCPRegistry.connect(orgId, match.id);
  }
  return match;
}

// ── Tool caller ───────────────────────────────────────────────────────────────

/**
 * Call a tool on an MCP server and return the parsed JSON result.
 *
 * @param {string} orgId
 * @param {object} server   — server record returned by getAdsServer / getAnalyticsServer
 * @param {string} toolName — MCP tool name (e.g. 'ads_get_campaign_performance')
 * @param {object} args     — tool arguments
 * @returns {Promise<any>}  — parsed JSON result from the MCP server
 */
async function callMcpTool(orgId, server, toolName, args = {}) {
  const result = await MCPRegistry.send(orgId, server.id, 'tools/call', {
    name:      toolName,
    arguments: args,
  });
  const raw = result?.content?.[0]?.text;
  if (!raw) throw new Error(`Empty response from MCP server for tool: ${toolName}`);
  return JSON.parse(raw);
}

// ── Date range helper ─────────────────────────────────────────────────────────

/**
 * Convert agent context + tool input into MCP-compatible date range args.
 * Priority: context.startDate/endDate > context.days > input.days > defaultDays.
 *
 * @param {object} context        — agent execution context
 * @param {object} input          — raw tool input from the agent
 * @param {number} [defaultDays]  — fallback if no dates or days found
 * @returns {{ start_date, end_date } | { days }}
 */
function resolveRangeArgs(context, input, defaultDays = 30) {
  if (context.startDate && context.endDate) {
    return { start_date: context.startDate, end_date: context.endDate };
  }
  return { days: context.days ?? input.days ?? defaultDays };
}

module.exports = { getAdsServer, getAnalyticsServer, getWordPressServer, getPlatformServer, getKnowledgeBaseServer, callMcpTool, resolveRangeArgs };
