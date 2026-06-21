'use strict';

/**
 * Idempotent column, constraint, and index patches for databases that
 * predated the current CREATE TABLE definitions in db.js initSchema().
 */

module.exports = {
  id: '001',
  name: 'platform_schema_patches',

  async up(client) {
    // user_roles — dedupe before unique indexes (legacy installs only)
    await client.query(`
      DELETE FROM user_roles
      WHERE id NOT IN (
        SELECT MIN(id)
        FROM user_roles
        GROUP BY user_id, role_name, scope_type, COALESCE(scope_id, '')
      )
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_user_roles_no_scope
        ON user_roles(user_id, role_name, scope_type)
        WHERE scope_id IS NULL
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_user_roles_with_scope
        ON user_roles(user_id, role_name, scope_type, scope_id)
        WHERE scope_id IS NOT NULL
    `);

    // agent_configs — per-customer configs
    await client.query(`ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS intelligence_profile JSONB`);
    await client.query(`ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS customer_id TEXT DEFAULT NULL`);
    await client.query(`ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS custom_prompt TEXT`);
    await client.query(`ALTER TABLE agent_configs DROP CONSTRAINT IF EXISTS agent_configs_org_id_slug_key`);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_configs_org_slug_default
        ON agent_configs(org_id, slug)
        WHERE customer_id IS NULL
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_configs_org_slug_customer
        ON agent_configs(org_id, slug, customer_id)
        WHERE customer_id IS NOT NULL
    `);

    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC'
    `);
    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS default_model_id TEXT
    `);
    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS login_attempts INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ
    `);

    await client.query(`ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS cache_read_tokens     INTEGER       DEFAULT 0`);
    await client.query(`ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS cache_creation_tokens INTEGER       DEFAULT 0`);
    await client.query(`ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS cost_aud              NUMERIC(10,6) DEFAULT 0`);

    await client.query(`ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS customer_id TEXT`);
    await client.query(`ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS campaign_id TEXT`);

    await client.query(`
      ALTER TABLE doc_extraction_runs
        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ
    `);
    await client.query(`
      ALTER TABLE doc_extraction_runs
        ADD COLUMN IF NOT EXISTS label        TEXT,
        ADD COLUMN IF NOT EXISTS purpose      TEXT,
        ADD COLUMN IF NOT EXISTS instructions TEXT
    `);
    await client.query(`
      ALTER TABLE doc_extraction_runs
        ADD COLUMN IF NOT EXISTS storage_key TEXT
    `);

    await client.query(`
      ALTER TABLE media_gen_runs
        ADD COLUMN IF NOT EXISTS storage_key TEXT,
        ADD COLUMN IF NOT EXISTS cost_usd    NUMERIC(10,4)
    `);

    await client.query(`ALTER TABLE agent_suggestions ADD COLUMN IF NOT EXISTS user_action TEXT`);
    await client.query(`ALTER TABLE agent_suggestions ADD COLUMN IF NOT EXISTS user_reason TEXT`);

    await client.query(`ALTER TABLE agent_runs DROP CONSTRAINT IF EXISTS agent_runs_status_check`);
    await client.query(`
      ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_status_check
        CHECK (status IN ('running', 'complete', 'error', 'needs_review'))
    `);

    await client.query(`
      ALTER TABLE organizations
        ADD COLUMN IF NOT EXISTS org_type TEXT NOT NULL DEFAULT 'internal'
    `);
    await client.query(`
      ALTER TABLE organizations
        DROP CONSTRAINT IF EXISTS organizations_org_type_check
    `);
    await client.query(`
      ALTER TABLE organizations
        ADD CONSTRAINT organizations_org_type_check
          CHECK (org_type IN ('internal', 'demo'))
    `);

    await client.query(`ALTER TABLE transaction_logs ADD COLUMN IF NOT EXISTS prompt_text TEXT`);
    await client.query(`ALTER TABLE transaction_logs ADD COLUMN IF NOT EXISTS response_text TEXT`);
  },
};
