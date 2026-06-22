'use strict';

const agentManifest = require('./agentManifest');

/** Engineering application plugin — demo routes and AEC agents. */
module.exports = {
  id: 'engineering',
  label: 'Engineering',
  agentManifest,
  mcpServers: [],
  registerRoutes(app) {
    app.use('/api/demo', require('../../routes/demo'));
    app.use('/api/doc-extractor', require('../../routes/docExtractor'));
  },
};
