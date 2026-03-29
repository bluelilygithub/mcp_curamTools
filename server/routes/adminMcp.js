/**
 * adminMcp.js — Admin routes for MCP server registry and resource permissions.
 * All routes require org_admin. org_id is always sourced from req.user.orgId.
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
const { requireRole } = require('../middleware/requireRole');
const MCPRegistry = require('../platform/mcpRegistry');
const {
  grantResourcePermission,
  revokeResourcePermission,
  listResourcePermissions,
} = require('../services/PermissionService');

const router = express.Router();
router.use(requireAuth, requireRole(['org_admin']));

// ── MCP Servers ───────────────────────────────────────────────────────────────

router.get('/mcp-servers', async (req, res) => {
  try {
    const servers = await MCPRegistry.list(req.user.orgId);
    res.json(servers);
  } catch (err) {
    console.error('[admin/mcp-servers GET]', err.message);
    res.status(500).json({ error: 'Failed to list MCP servers.' });
  }
});

router.post('/mcp-servers', async (req, res) => {
  const { name, transportType, endpointUrl, config } = req.body;
  if (!name || !transportType) {
    return res.status(400).json({ error: 'name and transportType are required.' });
  }
  try {
    const server = await MCPRegistry.register(req.user.orgId, {
      name,
      transportType,
      endpointUrl: endpointUrl || null,
      config: config || {},
    });
    res.status(201).json(server);
  } catch (err) {
    console.error('[admin/mcp-servers POST]', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.delete('/mcp-servers/:id', async (req, res) => {
  try {
    await MCPRegistry.deregister(req.user.orgId, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/mcp-servers DELETE]', err.message);
    res.status(404).json({ error: err.message });
  }
});

router.post('/mcp-servers/:id/connect', async (req, res) => {
  try {
    await MCPRegistry.connect(req.user.orgId, req.params.id);
    res.json({ ok: true, status: 'connected' });
  } catch (err) {
    console.error('[admin/mcp-servers/connect]', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.post('/mcp-servers/:id/disconnect', async (req, res) => {
  try {
    await MCPRegistry.disconnect(req.user.orgId, req.params.id);
    res.json({ ok: true, status: 'disconnected' });
  } catch (err) {
    console.error('[admin/mcp-servers/disconnect]', err.message);
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
    console.error('[admin/mcp-resources GET]', err.message);
    res.status(500).json({ error: 'Failed to list MCP resources.' });
  }
});

router.post('/mcp-resources', async (req, res) => {
  const { serverId, uri, name, description, metadata } = req.body;
  if (!serverId || !uri || !name) {
    return res.status(400).json({ error: 'serverId, uri, and name are required.' });
  }
  try {
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
      [serverId, req.user.orgId, uri, name, description || null, JSON.stringify(metadata || {})]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[admin/mcp-resources POST]', err.message);
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
    console.error('[admin/mcp-resources DELETE]', err.message);
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
    console.error('[admin/mcp-resources/permissions GET]', err.message);
    res.status(500).json({ error: 'Failed to list permissions.' });
  }
});

router.post('/mcp-resources/permissions', async (req, res) => {
  const { resourceUri, userId, roleName, permission } = req.body;
  if (!resourceUri || !permission) {
    return res.status(400).json({ error: 'resourceUri and permission are required.' });
  }
  if ((userId == null) === (roleName == null)) {
    return res.status(400).json({ error: 'Provide exactly one of userId or roleName.' });
  }
  try {
    await grantResourcePermission(
      req.user.orgId,
      resourceUri,
      { userId: userId || null, roleName: roleName || null },
      permission,
      req.user.id
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error('[admin/mcp-resources/permissions POST]', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.delete('/mcp-resources/permissions/:id', async (req, res) => {
  try {
    await revokeResourcePermission(req.user.orgId, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/mcp-resources/permissions DELETE]', err.message);
    res.status(404).json({ error: err.message });
  }
});

module.exports = router;
