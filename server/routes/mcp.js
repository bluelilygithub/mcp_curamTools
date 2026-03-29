/**
 * mcp.js — MCP HTTP/SSE transport endpoints.
 * Delegates message dispatch to mcpServer (platform/mcpServer.js).
 *
 * Endpoints:
 *   GET  /api/mcp/sse     — SSE stream (server → client notifications)
 *   POST /api/mcp/message — client sends JSON-RPC 2.0 messages
 *   GET  /api/mcp         — server capabilities (unauthenticated discovery)
 */
const express = require('express');
const { mcpServer } = require('../platform/mcpServer');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

// ── GET /api/mcp — capability discovery ──────────────────────────────────
router.get('/', (req, res) => {
  res.json({
    name: 'mcp-curamtools',
    version: '1.0.0',
    protocolVersion: '2024-11-05',
    transport: 'http+sse',
    endpoints: {
      sse: '/api/mcp/sse',
      message: '/api/mcp/message',
    },
  });
});

// ── GET /api/mcp/sse — SSE stream ────────────────────────────────────────
router.get('/sse', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const clientId = mcpServer.addClient(res);

  // Send initial endpoint event (MCP SSE convention)
  res.write(`event: endpoint\ndata: ${JSON.stringify({ uri: '/api/mcp/message' })}\n\n`);

  req.on('close', () => {
    console.log(`[mcp/sse] Client ${clientId} disconnected`);
  });
});

// ── POST /api/mcp/message — JSON-RPC 2.0 message handler ─────────────────
router.post('/message', requireAuth, async (req, res) => {
  const message = req.body;
  if (!message?.jsonrpc) {
    return res.status(400).json({ error: 'Invalid JSON-RPC message.' });
  }

  const context = { user: req.user, orgId: req.user.orgId };
  const response = await mcpServer.handleMessage(message, context);

  // null response means notification (no reply needed)
  if (response === null) {
    return res.status(204).end();
  }

  res.json(response);
});

module.exports = router;
