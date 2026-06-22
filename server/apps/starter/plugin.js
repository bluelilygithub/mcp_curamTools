'use strict';

const agentManifest = require('./agentManifest');

/**
 * Starter app — minimal plugin on core (dev / copy-paste template).
 * Enable locally: EXTRA_PLUGINS=starter in server/.env
 */
module.exports = {
  id: 'starter',
  label: 'Starter (template)',
  agentManifest,
  mcpServers: [],
  registerRoutes(app) {
    app.use('/api/starter', require('./routes'));
  },
};
