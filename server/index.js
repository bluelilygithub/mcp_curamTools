require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const { initSchema } = require('./db');
const logger = require('./utils/logger');

const app = express();

// ── Security middleware ────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'fonts.googleapis.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'fonts.googleapis.com', 'fonts.gstatic.com'],
      fontSrc: ["'self'", 'fonts.gstatic.com'],
      connectSrc: ["'self'"],
      imgSrc:     ["'self'", 'data:', 'blob:', 'https://fal.media', 'https://cdn.fal.run', 'https://storage.fal.run', 'https://*.tile.openstreetmap.org'],
      mediaSrc:   ["'self'", 'blob:', 'https://fal.media', 'https://cdn.fal.run', 'https://storage.fal.run'],
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

// ── Body parsing ───────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── API routes ─────────────────────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/admin', require('./routes/adminMcp'));
app.use('/api/mcp', require('./routes/mcp'));

// agents.js exports { agentsRouter, agentConfigsRouter }
const { agentsRouter, agentConfigsRouter } = require('./routes/agents');
app.use('/api/agents', agentsRouter);
app.use('/api/agent-configs', agentConfigsRouter);

app.use('/api/google-ads', require('./routes/googleAds'));
app.use('/api/conversation', require('./routes/conversation'));
app.use('/api/admin/knowledge', require('./routes/adminKnowledge'));
app.use('/api/doc-extractor',  require('./routes/docExtractor'));
app.use('/api/media-gen',      require('./routes/mediaGen'));
app.use('/api/export-log',    require('./routes/exportLog'));
app.use('/api/export',        require('./routes/export'));

// ── Static files (production) ──────────────────────────────────────────────
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));
app.get('*', (req, res) => {
  // Only serve index.html for non-API routes
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(publicDir, 'index.html'));
});

// ── Global error handler ───────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  logger.error(err.message, { path: req.path, method: req.method });
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ── Start ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;

const MCPRegistry = require('./platform/mcpRegistry');

initSchema()
  .then(() => {
    const server = app.listen(PORT, () => {
      logger.info(`MCP_curamTools running on port ${PORT}`);
    });

    // Graceful shutdown — disconnect all MCP server connections cleanly
    const shutdown = async () => {
      await MCPRegistry.disconnectAll();
      server.close(() => process.exit(0));
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  })
  .catch((err) => {
    logger.error('Failed to initialise schema — exiting', { error: err.message });
    process.exit(1);
  });

module.exports = app;
