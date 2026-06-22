'use strict';

const { DIAMOND_PLATE_MCP_SERVERS } = require('../../mcp-servers/manifest.diamond-plate');
const agentManifest = require('./agentManifest');

/** Diamond Plate application plugin — routes, agents, MCP adapters. */
module.exports = {
  id: 'diamond-plate',
  label: 'Diamond Plate',
  agentManifest,
  mcpServers: DIAMOND_PLATE_MCP_SERVERS,
  registerRoutes(app) {
    app.use('/api/google-ads', require('../../routes/googleAds'));
    app.use('/api/dashboard', require('../../routes/dashboard'));
    app.use('/api/conversation', require('../../routes/conversation'));
    app.use('/api/youtube', require('../../routes/youtube'));
    app.use('/api/media-gen', require('../../routes/mediaGen'));
  },
};
