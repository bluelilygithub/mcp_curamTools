require('dotenv').config();
const { pool } = require('./db');
const AgentConfigService = require('./platform/AgentConfigService');

async function test() {
  const users = await pool.query('SELECT * FROM users');
  console.log("Users:");
  for (const u of users.rows) {
    console.log(`User: ${u.email}, org: ${u.org_id}`);
    
    let adminConfig = await AgentConfigService.getAdminConfig('demo-document-analyzer');
    if (!adminConfig.model) {
      const orgDefault = await AgentConfigService.getOrgDefaultModel(u.org_id);
      if (orgDefault) adminConfig = { ...adminConfig, model: orgDefault };
    }
    console.log(`  -> adminConfig.model: ${adminConfig.model}`);
  }
  pool.end();
}
test();