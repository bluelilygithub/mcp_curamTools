# Database migrations

MCP CuramTools uses a **two-layer schema strategy**:

| Layer | Location | Purpose |
|-------|----------|---------|
| **Baseline** | `server/db.js` → `initSchema()` | `CREATE TABLE IF NOT EXISTS`, extensions, indexes for empty databases |
| **Migrations** | `server/migrations/` | Versioned, incremental changes — column adds, constraint fixes, data patches, destructive alters |

Applied migrations are recorded in **`schema_migrations`** (`id`, `name`, `applied_at`).

---

## Startup order

On server boot (`server/index.js` → `initSchema()`):

1. **Baseline schema** — single transaction: extensions + tables + indexes
2. **`runMigrations(pool)`** — one transaction per pending migration
3. **Seeds** — email templates, admin user from env

---

## Adding a migration

1. Create `server/migrations/NNN_short_name.js`:

```javascript
'use strict';

module.exports = {
  id: '004',           // zero-padded, never reuse
  name: 'short_name',  // snake_case description
  async up(client) {
    await client.query(`ALTER TABLE ...`);
  },
  // down(client) optional — not run automatically today
};
```

2. Register it in `server/migrations/index.js` (append only — **never reorder** existing ids).

3. Test locally: restart the server or run `npm run migrate` from `server/`.

4. Deploy to Railway — migrations run automatically on the next boot.

---

## Rules

- **Idempotent where possible** — use `IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, etc., so a migration survives partial applies during development.
- **One concern per migration** — column patches, embedding dimension changes, and data backfills should not share an id.
- **Destructive changes** (drop column, clear vectors, mass UPDATE) belong in migrations, not in `initSchema()`.
- **Never edit a migration that has already run in production** — add a new migration instead.
- **Fresh installs** — baseline `CREATE TABLE` should reflect the current column set; migrations remain for legacy databases.

---

## CLI

From `server/`:

```bash
npm run migrate
```

Applies pending migrations without starting the HTTP server. Requires `DATABASE_URL` and an existing baseline schema (run the server once on a new database, or apply baseline manually).

---

## Current migrations

| Id | Name | Description |
|----|------|-------------|
| `001` | `platform_schema_patches` | Legacy column/constraint/index patches |
| `002` | `embedding_vector_dimensions` | Align `embeddings` / `personal_thoughts` to 768-dim vectors |
| `003` | `system_settings_data_patches` | doc-extractor `max_tokens` bump |
| `004` | `organizations_description` | `organizations.description` for operator notes |

---

## Rollback

The runner records applied ids but does **not** auto-run `down()`. Roll back by:

1. Restoring a database snapshot (Railway Postgres backup), or
2. Writing a forward migration that reverses the change.

This matches the platform’s solo-operator, low-deploy-frequency context — full down migrations are optional and rarely worth maintaining unless a change is high-risk.
