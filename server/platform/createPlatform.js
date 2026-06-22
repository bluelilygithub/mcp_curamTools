'use strict';

/**
 * createPlatform — bootstrap Express app with core routes + app plugins.
 *
 *   const platform = createPlatform({ plugins: [diamondPlate, engineering] });
 *   platform.start();
 */

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const { initSchema } = require('../db');
const logger = require('../utils/logger');
const { CORE_MCP_SERVERS } = require('../mcp-servers/manifest.core');
const { bootstrapBuiltinMcpServers } = require('./bootstrapBuiltinMcpServers');
const MCPRegistry = require('./mcpRegistry');
const { resolvePlugins } = require('./loadPlugins');

function applySecurityMiddleware(app) {
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'fonts.googleapis.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'fonts.googleapis.com', 'fonts.gstatic.com'],
        fontSrc: ["'self'", 'fonts.gstatic.com'],
        connectSrc: ["'self'"],
        imgSrc: [
          "'self'", 'data:', 'blob:',
          'https://fal.media', 'https://cdn.fal.run', 'https://storage.fal.run',
          'https://*.tile.openstreetmap.org', 'https://*.basemaps.cartocdn.com', 'https://i.ytimg.com',
        ],
        mediaSrc: ["'self'", 'blob:', 'https://fal.media', 'https://cdn.fal.run', 'https://storage.fal.run'],
        frameSrc: ['https://www.youtube-nocookie.com', 'https://www.youtube.com'],
        childSrc: ['https://www.youtube-nocookie.com', 'https://www.youtube.com'],
      },
    },
  }));

  const allowedOrigins = [
    process.env.APP_URL,
    'http://localhost:5174',
    'http://localhost:5173',
    'http://localhost:3000',
  ].filter(Boolean);

  app.use(cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`CORS: origin ${origin} not permitted`));
    },
    credentials: true,
  }));

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
}

function registerCoreRoutes(app) {
  app.use('/api/auth', require('../routes/auth'));
  app.use('/api/admin', require('../routes/admin'));
  app.use('/api/admin', require('../routes/adminMcp'));
  app.use('/api/mcp', require('../routes/mcp'));
  app.use('/api/personal-memory', require('../routes/personalMemory'));
  app.use('/api/suggestions', require('../routes/suggestions'));
  app.use('/api/admin/knowledge', require('../routes/adminKnowledge'));
  app.use('/api/lessons', require('../routes/lessons'));
  app.use('/api/export-log', require('../routes/exportLog'));
  app.use('/api/export', require('../routes/export'));
  app.use('/api/settings', require('../routes/settings'));
  app.use('/api/logs', require('../routes/logs'));
}

function registerStaticAndErrors(app) {
  const publicDir = path.join(__dirname, '../public');
  app.use(express.static(publicDir));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.use((err, req, res, _next) => {
    logger.error(err.message, { path: req.path, method: req.method });
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  });
}

function collectPluginAssets(plugins) {
  const agentManifest = [];
  const mcpServers = [...CORE_MCP_SERVERS];

  for (const plugin of plugins) {
    if (!plugin?.id) continue;
    if (Array.isArray(plugin.agentManifest)) {
      agentManifest.push(...plugin.agentManifest);
    }
    if (Array.isArray(plugin.mcpServers)) {
      mcpServers.push(...plugin.mcpServers);
    }
  }

  return { agentManifest, mcpServers };
}

function createPlatform({ plugins, pluginIds } = {}) {
  const resolvedPlugins = resolvePlugins({ plugins, pluginIds });
  const app = express();
  applySecurityMiddleware(app);

  const { agentManifest, mcpServers } = collectPluginAssets(resolvedPlugins);

  registerCoreRoutes(app);

  for (const plugin of resolvedPlugins) {
    if (typeof plugin.registerRoutes === 'function') {
      plugin.registerRoutes(app);
    }
  }

  const { agentsRouter, agentConfigsRouter, mountAgentManifest } = require('../routes/agents');
  mountAgentManifest(agentManifest);
  app.use('/api/agents', agentsRouter);
  app.use('/api/agent-configs', agentConfigsRouter);

  registerStaticAndErrors(app);

  let started = false;

  async function start() {
    if (started) {
      throw new Error('createPlatform.start() already called');
    }
    started = true;

    const PORT = process.env.PORT || 3001;

    await initSchema();

    const { runStartupChecks } = require('../services/SuggestionService');
    await runStartupChecks().catch((err) => {
      logger.warn('Suggestion startup checks failed', { error: err.message });
    });

    const result = await bootstrapBuiltinMcpServers(mcpServers);
    if (!result.skipped) {
      logger.info('Built-in MCP servers registered', {
        orgCount: result.orgCount,
        serverCount: result.serverCount,
        plugins: resolvedPlugins.map((p) => p.id),
      });
    }

    const server = app.listen(PORT, () => {
      logger.info(`MCP_curamTools running on port ${PORT}`);
    });

    const shutdown = async () => {
      await MCPRegistry.disconnectAll();
      server.close(() => process.exit(0));
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);

    return server;
  }

  return {
    app,
    plugins: resolvedPlugins,
    agentManifest,
    mcpServers,
    start,
  };
}

module.exports = { createPlatform, resolvePlugins };
