/**
 * mcpServer — MCP HTTP/SSE server scaffold.
 * Provides tool, resource, and prompt registration.
 * No agent-specific logic lives here.
 *
 * MCP protocol: https://modelcontextprotocol.io
 * Transport: HTTP + SSE (JSON-RPC 2.0)
 *
 * Agents register their tools/resources/prompts on startup:
 *   mcpServer.registerTool({ name, description, inputSchema, handler });
 *   mcpServer.registerResource({ uri, name, description, handler });
 *   mcpServer.registerPrompt({ name, description, arguments, handler });
 */

const { EventEmitter } = require('events');

const MCP_VERSION = '2024-11-05';
const SERVER_NAME = 'mcp-curamtools';
const SERVER_VERSION = '1.0.0';

class McpServer extends EventEmitter {
  constructor() {
    super();
    // Registry maps
    this._tools = new Map();      // name → { description, inputSchema, handler }
    this._resources = new Map();  // uri → { name, description, handler }
    this._prompts = new Map();    // name → { description, arguments, handler }

    // Active SSE clients: Map<clientId, res>
    this._clients = new Map();
    this._clientSeq = 0;
  }

  // ── Registration API ─────────────────────────────────────────────────────

  /**
   * Register an MCP tool.
   * @param {object} tool
   * @param {string}   tool.name        — unique tool name
   * @param {string}   tool.description — human-readable description
   * @param {object}   tool.inputSchema — JSON Schema for tool input
   * @param {Function} tool.handler     — async (input, context) => any
   */
  registerTool({ name, description, inputSchema, handler }) {
    if (this._tools.has(name)) {
      console.warn(`[mcpServer] Tool "${name}" already registered — overwriting`);
    }
    this._tools.set(name, { name, description, inputSchema: inputSchema ?? {}, handler });
    console.log(`[mcpServer] Tool registered: ${name}`);
  }

  /**
   * Register an MCP resource.
   * @param {object} resource
   * @param {string}   resource.uri         — resource URI (e.g. 'ads://campaigns')
   * @param {string}   resource.name        — human-readable name
   * @param {string}   resource.description — description
   * @param {Function} resource.handler     — async (uri, context) => { contents: [...] }
   */
  registerResource({ uri, name, description, handler }) {
    this._resources.set(uri, { uri, name, description, handler });
    console.log(`[mcpServer] Resource registered: ${uri}`);
  }

  /**
   * Register an MCP prompt template.
   * @param {object} prompt
   * @param {string}   prompt.name        — unique prompt name
   * @param {string}   prompt.description — description
   * @param {Array}    prompt.arguments   — [{ name, description, required }]
   * @param {Function} prompt.handler     — async (args, context) => { messages: [...] }
   */
  registerPrompt({ name, description, arguments: args, handler }) {
    this._prompts.set(name, { name, description, arguments: args ?? [], handler });
    console.log(`[mcpServer] Prompt registered: ${name}`);
  }

  // ── SSE client management ─────────────────────────────────────────────────

  addClient(res) {
    const id = ++this._clientSeq;
    this._clients.set(id, res);
    res.on('close', () => this._clients.delete(id));
    return id;
  }

  broadcastNotification(method, params) {
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params });
    for (const res of this._clients.values()) {
      res.write(`data: ${msg}\n\n`);
    }
  }

  // ── Message dispatch ──────────────────────────────────────────────────────

  async handleMessage(message, context = {}) {
    const { id, method, params } = message;

    try {
      const result = await this._dispatch(method, params, context);
      return { jsonrpc: '2.0', id, result };
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: err.message },
      };
    }
  }

  async _dispatch(method, params, context) {
    switch (method) {
      case 'initialize':
        return {
          protocolVersion: MCP_VERSION,
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
          capabilities: {
            tools: this._tools.size > 0 ? {} : undefined,
            resources: this._resources.size > 0 ? {} : undefined,
            prompts: this._prompts.size > 0 ? {} : undefined,
          },
        };

      case 'tools/list':
        return {
          tools: Array.from(this._tools.values()).map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema,
          })),
        };

      case 'tools/call': {
        const tool = this._tools.get(params?.name);
        if (!tool) throw new Error(`Unknown tool: ${params?.name}`);
        const output = await tool.handler(params?.arguments ?? {}, context);
        return { content: [{ type: 'text', text: typeof output === 'string' ? output : JSON.stringify(output) }] };
      }

      case 'resources/list':
        return {
          resources: Array.from(this._resources.values()).map(({ uri, name, description }) => ({
            uri, name, description,
          })),
        };

      case 'resources/read': {
        const resource = this._resources.get(params?.uri);
        if (!resource) throw new Error(`Unknown resource: ${params?.uri}`);
        return await resource.handler(params.uri, context);
      }

      case 'prompts/list':
        return {
          prompts: Array.from(this._prompts.values()).map(({ name, description, arguments: args }) => ({
            name, description, arguments: args,
          })),
        };

      case 'prompts/get': {
        const prompt = this._prompts.get(params?.name);
        if (!prompt) throw new Error(`Unknown prompt: ${params?.name}`);
        return await prompt.handler(params?.arguments ?? {}, context);
      }

      case 'notifications/initialized':
        // Client acknowledgement — no response needed
        return null;

      default:
        throw new Error(`Method not found: ${method}`);
    }
  }
}

// Export singleton
const mcpServer = new McpServer();
module.exports = { mcpServer };
