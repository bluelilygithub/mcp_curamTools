require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function initSchema() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Enable pgvector extension (idempotent)
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');

    // ── Platform tables ────────────────────────────────────────────────────

    await client.query(`
      CREATE TABLE IF NOT EXISTS organizations (
        id         SERIAL PRIMARY KEY,
        name       TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            SERIAL PRIMARY KEY,
        org_id        INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
        email         TEXT NOT NULL UNIQUE,
        password_hash TEXT,
        first_name    TEXT,
        last_name     TEXT,
        phone         TEXT,
        is_active     BOOLEAN NOT NULL DEFAULT FALSE,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token      TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_token
        ON auth_sessions(token)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_roles (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role_name  TEXT NOT NULL,
        scope_type TEXT NOT NULL DEFAULT 'global',
        scope_id   TEXT,
        granted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_roles_user_id
        ON user_roles(user_id)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        id         SERIAL PRIMARY KEY,
        org_id     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        key        TEXT NOT NULL,
        value      JSONB,
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(org_id, key)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_configs (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id              INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        slug                TEXT NOT NULL,
        config              JSONB NOT NULL DEFAULT '{}',
        intelligence_profile JSONB,
        updated_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
        updated_at          TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(org_id, slug)
      )
    `);

    // Idempotent add of intelligence_profile in case this table existed without it
    await client.query(`
      ALTER TABLE agent_configs
        ADD COLUMN IF NOT EXISTS intelligence_profile JSONB
    `);

    // Idempotent add of timezone to users
    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC'
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_runs (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id       INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
        slug         TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'running'
                       CHECK (status IN ('running', 'complete', 'error')),
        result       JSONB,
        error        TEXT,
        run_at       TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_agent_runs_org_slug_run_at
        ON agent_runs(org_id, slug, run_at DESC)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS usage_logs (
        id            SERIAL PRIMARY KEY,
        org_id        INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
        user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
        tool_slug     TEXT,
        model_id      TEXT,
        input_tokens  INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        cost_usd      NUMERIC(10, 6) DEFAULT 0,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_usage_logs_org_created
        ON usage_logs(org_id, created_at DESC)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS email_templates (
        id         SERIAL PRIMARY KEY,
        slug       TEXT NOT NULL UNIQUE,
        subject    TEXT NOT NULL,
        body_html  TEXT NOT NULL,
        body_text  TEXT NOT NULL,
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS mcp_servers (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id         INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        name           TEXT NOT NULL,
        transport_type TEXT NOT NULL CHECK (transport_type IN ('sse', 'stdio')),
        endpoint_url   TEXT,
        config         JSONB DEFAULT '{}',
        is_active      BOOLEAN DEFAULT TRUE,
        created_at     TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (org_id, name)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS mcp_resources (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        server_id   UUID NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
        org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        uri         TEXT NOT NULL,
        name        TEXT NOT NULL,
        description TEXT,
        metadata    JSONB DEFAULT '{}',
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (org_id, uri)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS resource_permissions (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id       INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        resource_uri TEXT NOT NULL,
        user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
        role_name    TEXT,
        permission   TEXT NOT NULL CHECK (permission IN ('allow', 'deny')),
        granted_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at   TIMESTAMPTZ DEFAULT NOW(),
        CHECK (
          (user_id IS NOT NULL AND role_name IS NULL) OR
          (user_id IS NULL AND role_name IS NOT NULL)
        )
      )
    `);

    // Partial unique indexes handle the user_id XOR role_name constraint cleanly
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_resource_perm_user
        ON resource_permissions(org_id, resource_uri, user_id)
        WHERE user_id IS NOT NULL
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_resource_perm_role
        ON resource_permissions(org_id, resource_uri, role_name)
        WHERE role_name IS NOT NULL
    `);

    await client.query('COMMIT');

    // Seed default email templates (ON CONFLICT DO NOTHING — never overwrites admin edits)
    await seedEmailTemplates(client);

    // Seed admin user from env
    await seedAdminUser();

    console.log('[db] Schema initialised');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[db] Schema init failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

async function seedEmailTemplates() {
  const { EMAIL_DEFAULTS } = require('./utils/emailDefaults');
  for (const tpl of EMAIL_DEFAULTS) {
    await pool.query(
      `INSERT INTO email_templates (slug, subject, body_html, body_text)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (slug) DO NOTHING`,
      [tpl.slug, tpl.subject, tpl.body_html, tpl.body_text]
    );
  }
}

async function seedAdminUser() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const orgName = process.env.ORG_NAME || 'Default Organisation';

  if (!email || !password) return;

  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash(password, 12);

  // Upsert org
  let orgRes = await pool.query(
    `INSERT INTO organizations (name) VALUES ($1)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [orgName]
  );
  if (orgRes.rows.length === 0) {
    orgRes = await pool.query('SELECT id FROM organizations WHERE name = $1', [orgName]);
  }
  const orgId = orgRes.rows[0].id;

  // Upsert admin user
  const userRes = await pool.query(
    `INSERT INTO users (org_id, email, password_hash, first_name, is_active)
     VALUES ($1, $2, $3, 'Admin', TRUE)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
     RETURNING id`,
    [orgId, email, hash]
  );
  const userId = userRes.rows[0].id;

  // Grant org_admin role if not already granted
  await pool.query(
    `INSERT INTO user_roles (user_id, role_name, scope_type)
     VALUES ($1, 'org_admin', 'global')
     ON CONFLICT DO NOTHING`,
    [userId]
  );

  // Seed default system settings for this org
  const defaultSettings = [
    { key: 'app_name', value: { value: orgName } },
    { key: 'timezone', value: { value: 'Australia/Sydney' } },
    { key: 'allowed_file_types', value: { value: ['pdf', 'docx', 'txt', 'md', 'csv', 'xlsx'] } },
  ];
  for (const s of defaultSettings) {
    await pool.query(
      `INSERT INTO system_settings (org_id, key, value, updated_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (org_id, key) DO NOTHING`,
      [orgId, s.key, JSON.stringify(s.value), userId]
    );
  }

  console.log(`[db] Admin seeded: ${email} (org: ${orgName})`);
}

module.exports = { pool, initSchema };
