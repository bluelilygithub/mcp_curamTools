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

    // Enable pg_trgm for efficient ILIKE searches with leading wildcards
    await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');

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

    // Remove duplicate rows that accumulated before the unique index was added.
    // Must run before index creation — duplicates cause CREATE UNIQUE INDEX to fail.
    // Keeps the earliest row (lowest id) for each logical combination.
    await client.query(`
      DELETE FROM user_roles
      WHERE id NOT IN (
        SELECT MIN(id)
        FROM user_roles
        GROUP BY user_id, role_name, scope_type, COALESCE(scope_id, '')
      )
    `);

    // Unique constraint so ON CONFLICT DO NOTHING works correctly.
    // scope_id is nullable; two partial indexes cover both cases since
    // standard UNIQUE treats NULL != NULL.
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
        id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id               INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        slug                 TEXT NOT NULL,
        customer_id          TEXT DEFAULT NULL,
        config               JSONB NOT NULL DEFAULT '{}',
        intelligence_profile JSONB,
        custom_prompt        TEXT,
        updated_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
        updated_at           TIMESTAMPTZ DEFAULT NOW()
        -- UNIQUE constraint replaced by partial indexes below
      )
    `);

    // Idempotent column additions (existing installs)
    await client.query(`ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS intelligence_profile JSONB`);
    await client.query(`ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS customer_id TEXT DEFAULT NULL`);
    await client.query(`ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS custom_prompt TEXT`);

    // Drop old UNIQUE(org_id, slug) constraint and replace with partial indexes
    // (existing installs have the constraint; new installs don't — DROP IF EXISTS handles both)
    await client.query(`ALTER TABLE agent_configs DROP CONSTRAINT IF EXISTS agent_configs_org_id_slug_key`);

    // Partial unique indexes: one default config per (org, slug), one per customer
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

    // ── Org structure tables ───────────────────────────────────────────────

    // Idempotent: add default_model_id to users
    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS default_model_id TEXT
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS departments (
        id          SERIAL PRIMARY KEY,
        org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        description TEXT,
        color       TEXT NOT NULL DEFAULT '#6366f1',
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (org_id, name)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_departments (
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, department_id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS org_roles (
        id          SERIAL PRIMARY KEY,
        org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        label       TEXT NOT NULL,
        description TEXT,
        color       TEXT NOT NULL DEFAULT '#6366f1',
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (org_id, name)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_departments_user_id
        ON user_departments(user_id)
    `);

    // ── Google Ads multi-customer tables ───────────────────────────────────

    // Extend agent_runs with customer/campaign metadata (idempotent)
    await client.query(`ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS customer_id TEXT`);
    await client.query(`ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS campaign_id TEXT`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS google_ads_customers (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id        INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        customer_id   TEXT NOT NULL,
        customer_name TEXT NOT NULL,
        is_active     BOOLEAN NOT NULL DEFAULT TRUE,
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (org_id, customer_id)
      )
    `);

    // ── Application logs ──────────────────────────────────────────────────────

    await client.query(`
      CREATE TABLE IF NOT EXISTS app_logs (
        id         SERIAL PRIMARY KEY,
        level      TEXT NOT NULL,
        message    TEXT NOT NULL,
        meta       JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_app_logs_level      ON app_logs(level)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_app_logs_created_at ON app_logs(created_at DESC)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS campaign_agent_assignments (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id        INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        customer_id   TEXT NOT NULL,
        campaign_id   TEXT NOT NULL,
        campaign_name TEXT,
        agent_slug    TEXT NOT NULL,
        config        JSONB NOT NULL DEFAULT '{}',
        is_active     BOOLEAN NOT NULL DEFAULT TRUE,
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (org_id, customer_id, campaign_id, agent_slug)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_conversations (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        slug       TEXT NOT NULL DEFAULT 'google-ads-conversation',
        title      TEXT,
        messages   JSONB NOT NULL DEFAULT '[]',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_agent_conversations_org
        ON agent_conversations(org_id, slug, created_at DESC)
    `);

    // ── pgvector RAG ───────────────────────────────────────────────────────────
    await client.query(`CREATE EXTENSION IF NOT EXISTS vector`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS embeddings (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        source_type TEXT NOT NULL,
        source_id   TEXT,
        content     TEXT NOT NULL,
        metadata    JSONB DEFAULT '{}',
        embedding   vector(${1536}),
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (org_id, source_type, source_id)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_embeddings_org
        ON embeddings(org_id, source_type)
    `);

    // Prompt flags — raised by agents or model-change detection; resolved by admins
    await client.query(`
      CREATE TABLE IF NOT EXISTS prompt_flags (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id      INTEGER     NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        slug        TEXT        NOT NULL,
        reason      TEXT        NOT NULL,
        flagged_at  TIMESTAMPTZ DEFAULT NOW(),
        resolved_at TIMESTAMPTZ,
        resolved_by INTEGER     REFERENCES users(id) ON DELETE SET NULL
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_prompt_flags_org_slug
        ON prompt_flags(org_id, slug)
        WHERE resolved_at IS NULL
    `);

    // ── Document Extractor ─────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS doc_extraction_runs (
        id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id       INTEGER     NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        user_id      INTEGER     REFERENCES users(id) ON DELETE SET NULL,
        filename     TEXT        NOT NULL,
        mime_type    TEXT        NOT NULL,
        model        TEXT        NOT NULL,
        status       TEXT        NOT NULL DEFAULT 'pending',
        result       JSONB,
        error        TEXT,
        created_at   TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      )
    `);

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
      CREATE INDEX IF NOT EXISTS idx_doc_extraction_runs_org
        ON doc_extraction_runs(org_id, created_at DESC)
    `);

    // GIN trgm index — supports leading-wildcard ILIKE on label and filename without full scans.
    // Concats both columns so a single index covers the OR predicate in the search query.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_doc_extraction_runs_search
        ON doc_extraction_runs
        USING GIN ((COALESCE(label, '') || ' ' || filename) gin_trgm_ops)
    `);

    await client.query(`
      ALTER TABLE doc_extraction_runs
        ADD COLUMN IF NOT EXISTS storage_key TEXT
    `);

    // ── Export Logs ────────────────────────────────────────────────────────────
    // Generic reusable log — any tool that exports data writes here.
    // tool_slug identifies the source tool; run_ids is an array of source record IDs.
    await client.query(`
      CREATE TABLE IF NOT EXISTS export_logs (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id      INTEGER     NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        user_id     INTEGER     REFERENCES users(id) ON DELETE SET NULL,
        tool_slug   TEXT        NOT NULL,
        run_ids     TEXT[]      NOT NULL DEFAULT '{}',
        format      TEXT        NOT NULL,
        field_count INTEGER,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_export_logs_org
        ON export_logs(org_id, created_at DESC)
    `);

    // ── AI Visibility Prompts ──────────────────────────────────────────────────
    // Stores the monitoring prompts used by the AI Visibility Monitor agent.
    // Configurable per-org without code changes — add/edit/toggle via the UI.
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_visibility_prompts (
        id          SERIAL      PRIMARY KEY,
        org_id      INTEGER     NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        prompt_text TEXT        NOT NULL,
        category    TEXT        NOT NULL DEFAULT 'general',
        label       TEXT,
        is_active   BOOLEAN     DEFAULT true,
        sort_order  INTEGER     DEFAULT 0,
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        updated_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_visibility_prompts_org
        ON ai_visibility_prompts(org_id, sort_order)
    `);

    // ── Media Generator ────────────────────────────────────────────────────────
    // Stores image and video generation runs via Fal.ai.
    await client.query(`
      CREATE TABLE IF NOT EXISTS media_gen_runs (
        id                   SERIAL      PRIMARY KEY,
        org_id               INTEGER     NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        user_id              INTEGER     REFERENCES users(id) ON DELETE SET NULL,
        model                TEXT        NOT NULL,
        output_type          TEXT        NOT NULL DEFAULT 'video',
        prompt               TEXT        NOT NULL,
        reference_image_url  TEXT,
        duration             TEXT,
        aspect_ratio         TEXT,
        fal_request_id       TEXT,
        status               TEXT        NOT NULL DEFAULT 'pending',
        result               JSONB,
        error                TEXT,
        created_at           TIMESTAMPTZ DEFAULT NOW(),
        completed_at         TIMESTAMPTZ,
        deleted_at           TIMESTAMPTZ
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_media_gen_runs_org
        ON media_gen_runs(org_id, created_at DESC)
    `);

    await client.query(`
      ALTER TABLE media_gen_runs
        ADD COLUMN IF NOT EXISTS storage_key TEXT,
        ADD COLUMN IF NOT EXISTS cost_usd    NUMERIC(10,4)
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
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
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

  // Insert admin user on first run only — never overwrite an existing password
  let userRes = await pool.query(
    `INSERT INTO users (org_id, email, password_hash, first_name, is_active)
     VALUES ($1, $2, $3, 'Admin', TRUE)
     ON CONFLICT (email) DO NOTHING
     RETURNING id`,
    [orgId, email, hash]
  );
  if (userRes.rows.length === 0) {
    userRes = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  }
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
