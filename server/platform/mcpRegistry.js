/**
 * mcpRegistry.js — Multi-Server Discovery primitive
 *
 * Manages the lifecycle of remote MCP server connections for the platform.
 * All operations are scoped to org_id, which must come from verified context
 * (req.user.org_id) — never from user-supplied request data.
 *
 * Transport support:
 *   sse   — Remote HTTP/SSE server (MCP SSE transport spec)
 *   stdio — Local subprocess communicating via stdin/stdout
 *
 * Stage 1 delivers: DB-backed registry + connection lifecycle.
 * Stage 2 (resource-level permissions) will query this registry to enforce
 * resource URI access rules without requiring changes to this layer.
 */

const { pool } = require('../db');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const logger = require('../utils/logger');

class MCPRegistryClass extends EventEmitter {
  constructor() {
    super();
    // serverId → { status, send, cleanup }
    this._connections = new Map();
    this._pendingRpc = new Map(); // rpcId → { resolve, reject, timeout }
  }

  // ── DB layer ──────────────────────────────────────────────────────────────

  /**
   * Register (or update) a remote MCP server for an org.
   * name + org_id is unique — re-registering the same name updates the record.
   */
  async register(orgId, { name, transportType, endpointUrl = null, config = {} }) {
    if (!orgId) throw new Error('org_id is required');
    if (!['sse', 'stdio'].includes(transportType)) {
      throw new Error(`Invalid transport_type "${transportType}". Must be sse or stdio.`);
    }
    if (transportType === 'sse' && !endpointUrl) {
      throw new Error('endpoint_url is required for sse transport');
    }

    const res = await pool.query(
      `INSERT INTO mcp_servers (org_id, name, transport_type, endpoint_url, config, is_active)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       ON CONFLICT (org_id, name)
       DO UPDATE SET
         transport_type = EXCLUDED.transport_type,
         endpoint_url   = EXCLUDED.endpoint_url,
         config         = EXCLUDED.config,
         is_active      = TRUE
       RETURNING *`,
      [orgId, name, transportType, endpointUrl, JSON.stringify(config)]
    );

    return res.rows[0];
  }

  /**
   * Soft-deactivate a server. Does not drop data or history.
   * Also disconnects any live connection for this server.
   */
  async deregister(orgId, serverId) {
    if (!orgId) throw new Error('org_id is required');

    await this.disconnect(orgId, serverId);

    const res = await pool.query(
      `UPDATE mcp_servers SET is_active = FALSE
       WHERE id = $1 AND org_id = $2
       RETURNING id`,
      [serverId, orgId]
    );

    if (res.rows.length === 0) {
      throw new Error(`MCP server ${serverId} not found for this organisation`);
    }
  }

  /**
   * List all active MCP servers registered for an org.
   * Enriches each row with its live connection status.
   */
  async list(orgId) {
    if (!orgId) throw new Error('org_id is required');

    const res = await pool.query(
      `SELECT id, name, transport_type, endpoint_url, config, is_active, created_at
         FROM mcp_servers
        WHERE org_id = $1 AND is_active = TRUE
        ORDER BY name ASC`,
      [orgId]
    );

    return res.rows.map(row => ({
      ...row,
      connection_status: this._connectionStatus(row.id),
    }));
  }

  /**
   * Get a single server, strictly scoped to org_id.
   * Returns null if not found or belongs to a different org.
   */
  async get(orgId, serverId) {
    if (!orgId) throw new Error('org_id is required');

    const res = await pool.query(
      `SELECT * FROM mcp_servers
        WHERE id = $1 AND org_id = $2 AND is_active = TRUE`,
      [serverId, orgId]
    );

    return res.rows[0] || null;
  }

  // ── Connection lifecycle ──────────────────────────────────────────────────

  /**
   * Establish a live connection to a registered MCP server.
   * Idempotent — calling connect on an already-connected server is a no-op.
   */
  async connect(orgId, serverId) {
    if (!orgId) throw new Error('org_id is required');

    const existing = this._connections.get(serverId);
    if (existing?.status === 'connected') return existing;

    const server = await this.get(orgId, serverId);
    if (!server) throw new Error(`MCP server ${serverId} not found for this organisation`);

    this._connections.set(serverId, { status: 'connecting', send: null, cleanup: null });

    try {
      const conn = server.transport_type === 'sse'
        ? await this._connectSSE(server)
        : await this._connectStdio(server);

      this._connections.set(serverId, conn);
      this.emit('connected', { serverId, name: server.name });
      logger.info(`MCP connected: ${server.name}`, { transport: server.transport_type, serverId });
      return conn;
    } catch (err) {
      this._connections.delete(serverId);
      logger.error(`MCP connection failed: ${server.name}`, { error: err.message, serverId });
      throw err;
    }
  }

  /**
   * Tear down a live connection. Safe to call on an unconnected server.
   */
  async disconnect(orgId, serverId) {
    if (!orgId) throw new Error('org_id is required');

    const conn = this._connections.get(serverId);
    if (!conn) return;

    try {
      if (conn.cleanup) conn.cleanup();
    } catch (_) {}

    this._connections.delete(serverId);
    this.emit('disconnected', { serverId });
    logger.info(`MCP disconnected: ${serverId}`);
  }

  /**
   * Send a JSON-RPC request to a connected MCP server.
   * Returns a Promise that resolves with the server's response.
   * org_id is enforced — the server must belong to the calling org.
   */
  async send(orgId, serverId, method, params = {}) {
    if (!orgId) throw new Error('org_id is required');

    const conn = this._connections.get(serverId);
    if (!conn || conn.status !== 'connected') {
      throw new Error(`MCP server ${serverId} is not connected`);
    }

    // Verify ownership before every send
    const server = await this.get(orgId, serverId);
    if (!server) throw new Error(`MCP server ${serverId} not found for this organisation`);

    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const message = { jsonrpc: '2.0', id, method, params };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._pendingRpc.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, 30000);

      this._pendingRpc.set(id, { resolve, reject, timeout });
      conn.send(message);
    });
  }

  // ── Transport implementations ─────────────────────────────────────────────

  /**
   * SSE transport — MCP over HTTP Server-Sent Events.
   *
   * Protocol:
   *   1. GET endpoint_url  — establishes SSE stream
   *   2. Server emits `endpoint` event with a POST URL for JSON-RPC messages
   *   3. Responses arrive via the SSE stream, correlated by JSON-RPC id
   */
  _connectSSE(server) {
    return new Promise((resolve, reject) => {
      const url = new URL(server.endpoint_url);
      const transport = url.protocol === 'https:' ? https : http;
      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          'Cache-Control': 'no-cache',
          ...(server.config?.headers || {}),
        },
      };

      let postUrl = null;
      let buffer = '';
      let eventType = 'message';
      let settled = false;

      const req = transport.request(options, (res) => {
        if (res.statusCode !== 200) {
          if (!settled) { settled = true; reject(new Error(`SSE connect failed: HTTP ${res.statusCode}`)); }
          return;
        }

        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          buffer += chunk;
          const lines = buffer.split('\n');
          buffer = lines.pop(); // keep incomplete line

          for (const line of lines) {
            if (line.startsWith('event:')) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              const data = line.slice(5).trim();
              this._handleSSEData(server.id, eventType, data, (url) => {
                postUrl = url;
                if (!settled) {
                  settled = true;
                  resolve({
                    status: 'connected',
                    send: (msg) => this._postSSE(postUrl, msg, server.config?.headers),
                    cleanup: () => { req.destroy(); },
                  });
                }
              });
              eventType = 'message'; // reset
            }
          }
        });

        res.on('end', () => {
          this._connections.delete(server.id);
          this.emit('disconnected', { serverId: server.id, reason: 'stream ended' });
        });
      });

      req.on('error', (err) => {
        if (!settled) { settled = true; reject(err); }
        else {
          this._connections.delete(server.id);
          this.emit('disconnected', { serverId: server.id, reason: err.message });
        }
      });

      req.end();
    });
  }

  _handleSSEData(serverId, eventType, data, onEndpoint) {
    if (eventType === 'endpoint') {
      onEndpoint(data.trim());
      return;
    }

    // JSON-RPC response or notification
    try {
      const msg = JSON.parse(data);
      if (msg.id && this._pendingRpc.has(msg.id)) {
        const { resolve, reject, timeout } = this._pendingRpc.get(msg.id);
        this._pendingRpc.delete(msg.id);
        clearTimeout(timeout);
        if (msg.error) reject(new Error(msg.error.message || 'RPC error'));
        else resolve(msg.result);
      } else if (!msg.id) {
        // Server-sent notification
        this.emit('notification', { serverId, method: msg.method, params: msg.params });
      }
    } catch (_) {}
  }

  _postSSE(postUrl, message, extraHeaders = {}) {
    const body = JSON.stringify(message);
    const url = new URL(postUrl);
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...extraHeaders,
      },
    });
    req.on('error', (err) => logger.error('MCP SSE post error', { error: err.message }));
    req.write(body);
    req.end();
  }

  /**
   * Stdio transport — MCP over subprocess stdin/stdout.
   *
   * config must include:
   *   command: string      — executable path
   *   args: string[]       — command arguments (optional)
   *   env: object          — extra env vars (optional)
   */
  _connectStdio(server) {
    return new Promise((resolve, reject) => {
      const { command, args = [], env = {} } = server.config || {};
      if (!command) return reject(new Error('stdio transport requires config.command'));

      const child = spawn(command, args, {
        env: this._sanitizeEnvironment(env),
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let buffer = '';
      let settled = false;

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.id && this._pendingRpc.has(msg.id)) {
              const { resolve: res, reject: rej, timeout } = this._pendingRpc.get(msg.id);
              this._pendingRpc.delete(msg.id);
              clearTimeout(timeout);
              if (msg.error) rej(new Error(msg.error.message || 'RPC error'));
              else res(msg.result);
            } else if (!msg.id) {
              this.emit('notification', { serverId: server.id, method: msg.method, params: msg.params });
            }
            // First message signals the process is alive — resolve connection
            if (!settled) {
              settled = true;
              resolve({
                status: 'connected',
                send: (message) => {
                  child.stdin.write(JSON.stringify(message) + '\n');
                },
                cleanup: () => {
                  child.stdin.end();
                  child.kill();
                },
              });
            }
          } catch (_) {}
        }
      });

      child.stderr.on('data', (data) => {
        logger.warn(`MCP stdio stderr: ${server.name}`, { output: data.toString().trim() });
      });

      child.on('error', (err) => {
        if (!settled) { settled = true; reject(err); }
        else {
          this._connections.delete(server.id);
          this.emit('disconnected', { serverId: server.id, reason: err.message });
        }
      });

      child.on('exit', (code) => {
        if (!settled) { settled = true; reject(new Error(`Process exited (code ${code}) before responding — check command/args in config`)); }
        this._connections.delete(server.id);
        this.emit('disconnected', { serverId: server.id, reason: `exit code ${code}` });
      });

      // Send MCP initialize handshake — first message to the process
      const initMsg = {
        jsonrpc: '2.0',
        id: 'init',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'mcp-curamtools', version: '1.0.0' },
        },
      };
      child.stdin.write(JSON.stringify(initMsg) + '\n');
    });
  }

  // ── Environment sanitization ──────────────────────────────────────────────

  /**
   * Sanitize environment variables before passing to child processes.
   * Returns only safe variables that child processes might need.
   */
  _sanitizeEnvironment(extraEnv = {}) {
    // Safe variables that child processes might need
    const safeVars = [
      'PATH', 'NODE_ENV', 'TZ', 'LANG', 'LC_ALL',
      'NODE_PATH', 'HOME', 'USER', 'LOGNAME',
      // Application-specific safe variables (MCP server credentials)
      'WP_URL', 'WP_USER', 'WP_APP_PASSWORD', // WordPress MCP server
      'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', // Google Ads
      'GOOGLE_ANALYTICS_CLIENT_ID', 'GOOGLE_ANALYTICS_CLIENT_SECRET',
      'ANTHROPIC_API_KEY', 'FAL_API_KEY',
    ];
    
    const env = {};
    safeVars.forEach(key => {
      if (process.env[key] !== undefined) {
        env[key] = process.env[key];
      }
    });
    
    // Add explicitly allowed extra env from server config
    Object.assign(env, extraEnv);
    
    return env;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _connectionStatus(serverId) {
    return this._connections.get(serverId)?.status || 'disconnected';
  }

  /** Disconnect all servers — called on graceful server shutdown. */
  async disconnectAll() {
    for (const [serverId, conn] of this._connections.entries()) {
      try {
        if (conn.cleanup) conn.cleanup();
      } catch (_) {}
      this._connections.delete(serverId);
    }
  }
}

const MCPRegistry = new MCPRegistryClass();
module.exports = MCPRegistry;
