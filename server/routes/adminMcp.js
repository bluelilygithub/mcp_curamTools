/**
 * adminMcp.js — Admin routes for MCP server registry and resource permissions.
 * All routes require mcp:manage. org_id is always sourced from req.user.orgId.
 *
 * MCP Servers:
 *   GET    /api/admin/mcp-servers            — list registered servers for org
 *   POST   /api/admin/mcp-servers            — register a new server
 *   DELETE /api/admin/mcp-servers/:id        — deregister (soft)
 *   POST   /api/admin/mcp-servers/:id/connect    — connect a registered server
 *   POST   /api/admin/mcp-servers/:id/disconnect — disconnect a live server
 *
 * MCP Resources:
 *   GET    /api/admin/mcp-resources          — list resources (optionally ?serverId=)
 *   POST   /api/admin/mcp-resources          — register a resource URI
 *   DELETE /api/admin/mcp-resources/:id      — remove a resource record
 *
 * Resource Permissions:
 *   GET    /api/admin/mcp-resources/permissions          — list permissions (?resourceUri=)
 *   POST   /api/admin/mcp-resources/permissions          — grant a permission
 *   DELETE /api/admin/mcp-resources/permissions/:id      — revoke a permission
 */

const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { requirePermission } = require('../middleware/requirePermission');
const MCPRegistry = require('../platform/mcpRegistry');
const { cleanString, rejectUnknownKeys } = require('../platform/inputGuards');
const logger = require('../utils/logger');
const {
  grantResourcePermission,
  revokeResourcePermission,
  listResourcePermissions,
} = require('../services/PermissionService');

const router = express.Router();
router.use(requireAuth, requirePermission('mcp:manage'));

// ── MCP Servers ───────────────────────────────────────────────────────────────

router.get('/mcp-servers', async (req, res) => {
  try {
    const servers = await MCPRegistry.list(req.user.orgId);
    res.json(servers);
  } catch (err) {
    logger.error('admin/mcp-servers GET', { error: err.message });
    res.status(500).json({ error: 'Failed to list MCP servers.' });
  }
});

router.post('/mcp-servers', async (req, res) => {
  try {
    rejectUnknownKeys(req.body, ['name', 'transportType', 'endpointUrl', 'config'], 'MCP server request');
    const name = cleanString(req.body.name, { max: 80, field: 'name', required: true });
    const transportType = cleanString(req.body.transportType, { max: 20, field: 'transportType', required: true });
    const endpointUrl = cleanString(req.body.endpointUrl ?? '', { max: 1000, field: 'endpointUrl' }) || null;
    const server = await MCPRegistry.register(req.user.orgId, {
      name,
      transportType,
      endpointUrl,
      config: req.body.config || {},
    });
    res.status(201).json(server);
  } catch (err) {
    logger.error('admin/mcp-servers POST', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

router.put('/mcp-servers/:id', async (req, res) => {
  try {
    rejectUnknownKeys(req.body, ['name', 'transportType', 'endpointUrl', 'config'], 'MCP server request');
    const name = cleanString(req.body.name, { max: 80, field: 'name', required: true });
    const transportType = cleanString(req.body.transportType, { max: 20, field: 'transportType', required: true });
    const endpointUrl = cleanString(req.body.endpointUrl ?? '', { max: 1000, field: 'endpointUrl' }) || null;
    const result = await pool.query(
      `UPDATE mcp_servers
          SET name           = $1,
              transport_type = $2,
              endpoint_url   = $3,
              config         = $4
        WHERE id = $5 AND org_id = $6
        RETURNING *`,
      [name, transportType, endpointUrl, JSON.stringify(req.body.config || {}), req.params.id, req.user.orgId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'MCP server not found for this organisation.' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    logger.error('admin/mcp-servers PUT', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

router.delete('/mcp-servers/:id', async (req, res) => {
  try {
    await MCPRegistry.deregister(req.user.orgId, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    logger.error('admin/mcp-servers DELETE', { error: err.message });
    res.status(404).json({ error: err.message });
  }
});

router.get('/mcp-servers/:id/tools', async (req, res) => {
  try {
    // Auto-connect if not already connected
    const existing = MCPRegistry._connections.get(req.params.id);
    if (!existing || existing.status !== 'connected') {
      await MCPRegistry.connect(req.user.orgId, req.params.id);
    }
    const result = await MCPRegistry.send(req.user.orgId, req.params.id, 'tools/list');
    res.json(result.tools || []);
  } catch (err) {
    logger.error('admin/mcp-servers/tools', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// NEW: Discover resources from a connected MCP server
router.get('/mcp-servers/:id/resources', async (req, res) => {
  try {
    // Auto-connect if not already connected
    const existing = MCPRegistry._connections.get(req.params.id);
    if (!existing || existing.status !== 'connected') {
      await MCPRegistry.connect(req.user.orgId, req.params.id);
    }
    const result = await MCPRegistry.send(req.user.orgId, req.params.id, 'resources/list', {}, { userId: req.user.id });
    res.json(result.resources || []);
  } catch (err) {
    logger.error('admin/mcp-servers/resources', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// NEW: Read a resource from a connected MCP server
router.post('/mcp-servers/:id/resources/read', async (req, res) => {
  try {
    rejectUnknownKeys(req.body, ['uri'], 'MCP resource read request');
    const uri = cleanString(req.body.uri, { max: 1000, field: 'uri', required: true });
    // Auto-connect if not already connected
    const existing = MCPRegistry._connections.get(req.params.id);
    if (!existing || existing.status !== 'connected') {
      await MCPRegistry.connect(req.user.orgId, req.params.id);
    }
    const result = await MCPRegistry.send(req.user.orgId, req.params.id, 'resources/read', { uri }, { userId: req.user.id });
    res.json(result);
  } catch (err) {
    logger.error('admin/mcp-servers/resources/read', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

router.post('/mcp-servers/:id/call', async (req, res) => {
  try {
    rejectUnknownKeys(req.body, ['toolName', 'args'], 'MCP tool call request');
    const toolName = cleanString(req.body.toolName, { max: 120, field: 'toolName', required: true });
    const existing = MCPRegistry._connections.get(req.params.id);
    if (!existing || existing.status !== 'connected') {
      await MCPRegistry.connect(req.user.orgId, req.params.id);
    }
    const result = await MCPRegistry.send(req.user.orgId, req.params.id, 'tools/call', {
      name: toolName,
      arguments: req.body.args || {},
    });
    res.json(result);
  } catch (err) {
    logger.error('admin/mcp-servers/call', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

router.post('/mcp-servers/:id/connect', async (req, res) => {
  try {
    await MCPRegistry.connect(req.user.orgId, req.params.id);
    res.json({ ok: true, status: 'connected' });
  } catch (err) {
    logger.error('admin/mcp-servers/connect', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

router.post('/mcp-servers/:id/disconnect', async (req, res) => {
  try {
    await MCPRegistry.disconnect(req.user.orgId, req.params.id);
    res.json({ ok: true, status: 'disconnected' });
  } catch (err) {
    logger.error('admin/mcp-servers/disconnect', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// ── MCP Resources ─────────────────────────────────────────────────────────────

router.get('/mcp-resources', async (req, res) => {
  try {
    const params = [req.user.orgId];
    let query = `
      SELECT r.id, r.server_id, r.uri, r.name, r.description, r.metadata, r.created_at,
             s.name AS server_name
        FROM mcp_resources r
        JOIN mcp_servers s ON s.id = r.server_id
       WHERE r.org_id = $1`;
    if (req.query.serverId) {
      params.push(req.query.serverId);
      query += ` AND r.server_id = $2`;
    }
    query += ` ORDER BY r.uri ASC`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    logger.error('admin/mcp-resources GET', { error: err.message });
    res.status(500).json({ error: 'Failed to list MCP resources.' });
  }
});

router.post('/mcp-resources', async (req, res) => {
  try {
    rejectUnknownKeys(req.body, ['serverId', 'uri', 'name', 'description', 'metadata'], 'MCP resource request');
    const serverId = cleanString(req.body.serverId, { max: 80, field: 'serverId', required: true });
    const uri = cleanString(req.body.uri, { max: 1000, field: 'uri', required: true });
    const name = cleanString(req.body.name, { max: 120, field: 'name', required: true });
    const description = cleanString(req.body.description ?? '', { max: 500, field: 'description' }) || null;
    // Verify the server belongs to this org before associating a resource with it
    const serverCheck = await MCPRegistry.get(req.user.orgId, serverId);
    if (!serverCheck) {
      return res.status(404).json({ error: 'MCP server not found for this organisation.' });
    }
    const result = await pool.query(
      `INSERT INTO mcp_resources (server_id, org_id, uri, name, description, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (org_id, uri)
       DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, metadata = EXCLUDED.metadata
       RETURNING *`,
      [serverId, req.user.orgId, uri, name, description, JSON.stringify(req.body.metadata || {})]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    logger.error('admin/mcp-resources POST', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

router.delete('/mcp-resources/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM mcp_resources WHERE id = $1 AND org_id = $2 RETURNING id`,
      [req.params.id, req.user.orgId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Resource not found for this organisation.' });
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error('admin/mcp-resources DELETE', { error: err.message });
    res.status(500).json({ error: 'Failed to delete resource.' });
  }
});

// ── Resource Permissions ──────────────────────────────────────────────────────

router.get('/mcp-resources/permissions', async (req, res) => {
  try {
    const permissions = await listResourcePermissions(
      req.user.orgId,
      req.query.resourceUri || null
    );
    res.json(permissions);
  } catch (err) {
    logger.error('admin/mcp-resources/permissions GET', { error: err.message });
    res.status(500).json({ error: 'Failed to list permissions.' });
  }
});

router.post('/mcp-resources/permissions', async (req, res) => {
  try {
    rejectUnknownKeys(req.body, ['resourceUri', 'userId', 'roleName', 'permission'], 'MCP permission request');
    const resourceUri = cleanString(req.body.resourceUri, { max: 1000, field: 'resourceUri', required: true });
    const roleName = req.body.roleName == null ? null : cleanString(req.body.roleName, { max: 80, field: 'roleName' });
    const permission = cleanString(req.body.permission, { max: 20, field: 'permission', required: true });
    const userId = req.body.userId || null;
    if ((userId == null) === (roleName == null)) {
      return res.status(400).json({ error: 'Provide exactly one of userId or roleName.' });
    }
    await grantResourcePermission(
      req.user.orgId,
      resourceUri,
      { userId, roleName },
      permission,
      req.user.id
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    logger.error('admin/mcp-resources/permissions POST', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

router.delete('/mcp-resources/permissions/:id', async (req, res) => {
  try {
    await revokeResourcePermission(req.user.orgId, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    logger.error('admin/mcp-resources/permissions DELETE', { error: err.message });
    res.status(404).json({ error: err.message });
  }
});

module.exports = router;
