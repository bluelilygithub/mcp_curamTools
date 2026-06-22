'use strict';

/**
 * Combined MCP manifest — core + all app plugins (backward compatible).
 * Prefer CORE_MCP_SERVERS + app manifests for new code; see createPlatform().
 */

const { CORE_MCP_SERVERS } = require('./manifest.core');
const { DIAMOND_PLATE_MCP_SERVERS } = require('./manifest.diamond-plate');

const BUILTIN_MCP_SERVERS = [...CORE_MCP_SERVERS, ...DIAMOND_PLATE_MCP_SERVERS];

module.exports = {
  BUILTIN_MCP_SERVERS,
  CORE_MCP_SERVERS,
  DIAMOND_PLATE_MCP_SERVERS,
};
