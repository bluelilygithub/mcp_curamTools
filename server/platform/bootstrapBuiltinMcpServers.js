'use strict';

const { pool } = require('../db');
const { BUILTIN_MCP_SERVERS } = require('../mcp-servers/manifest');

async function bootstrapBuiltinMcpServers() {
  if (process.env.BOOTSTRAP_BUILTIN_MCP_SERVERS === 'false') {
    return { skipped: true, orgCount: 0, serverCount: 0 };
  }

  const { rows: orgs } = await pool.query('SELECT id FROM organizations ORDER BY id ASC');
  if (orgs.length === 0 || BUILTIN_MCP_SERVERS.length === 0) {
    return { skipped: false, orgCount: orgs.length, serverCount: 0 };
  }

  let serverCount = 0;
  for (const org of orgs) {
    for (const server of BUILTIN_MCP_SERVERS) {
      await pool.query(
        `INSERT INTO mcp_servers (org_id, name, transport_type, endpoint_url, config, is_active)
         VALUES ($1, $2, $3, $4, $5, TRUE)
         ON CONFLICT (org_id, name)
         DO UPDATE SET
           transport_type = EXCLUDED.transport_type,
           endpoint_url   = EXCLUDED.endpoint_url,
           config         = COALESCE(mcp_servers.config, '{}'::jsonb) || EXCLUDED.config`,
        [
          org.id,
          server.name,
          server.transportType,
          server.endpointUrl,
          JSON.stringify(server.config || {}),
        ]
      );
      serverCount += 1;
    }
  }

  return { skipped: false, orgCount: orgs.length, serverCount };
}

module.exports = { bootstrapBuiltinMcpServers };
