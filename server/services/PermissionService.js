/**
 * PermissionService — single source of truth for all authorisation checks.
 * Every route and future agent calls this — nothing writes its own permission SQL.
 */
const { pool } = require('../db');

/**
 * Check if a user holds any of the given roles at the given scope.
 * A global role satisfies any scope check.
 *
 * @param {number}   userId     — user id
 * @param {string[]} roleNames  — role name(s) to check
 * @param {object}   [scope]    — { scopeType, scopeId } — omit for global-only check
 */
async function hasRole(userId, roleNames, scope = null) {
  if (!userId || !roleNames?.length) return false;
  const names = Array.isArray(roleNames) ? roleNames : [roleNames];

  // Global roles always satisfy
  const globalRes = await pool.query(
    `SELECT 1 FROM user_roles
      WHERE user_id = $1
        AND role_name = ANY($2)
        AND scope_type = 'global'
      LIMIT 1`,
    [userId, names]
  );
  if (globalRes.rows.length > 0) return true;

  // Scoped check
  if (scope?.scopeType && scope?.scopeId) {
    const scopedRes = await pool.query(
      `SELECT 1 FROM user_roles
        WHERE user_id = $1
          AND role_name = ANY($2)
          AND scope_type = $3
          AND scope_id = $4
        LIMIT 1`,
      [userId, names, scope.scopeType, String(scope.scopeId)]
    );
    return scopedRes.rows.length > 0;
  }

  return false;
}

/**
 * Convenience check for the org_admin global role.
 */
async function isOrgAdmin(userId) {
  return hasRole(userId, ['org_admin']);
}

/**
 * Return all role assignments for a user, optionally filtered by scope type.
 */
async function getUserRoles(userId, scopeType = null) {
  const params = [userId];
  let query = `SELECT role_name, scope_type, scope_id FROM user_roles WHERE user_id = $1`;
  if (scopeType) {
    query += ` AND scope_type = $2`;
    params.push(scopeType);
  }
  query += ` ORDER BY scope_type, role_name`;
  const res = await pool.query(query, params);
  return res.rows;
}

/**
 * Grant a role to a user.
 */
async function grantRole(userId, roleName, scope = { scopeType: 'global', scopeId: null }, grantedBy = null) {
  await pool.query(
    `INSERT INTO user_roles (user_id, role_name, scope_type, scope_id, granted_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING`,
    [userId, roleName, scope.scopeType, scope.scopeId ? String(scope.scopeId) : null, grantedBy]
  );
}

/**
 * Revoke a role from a user.
 */
async function revokeRole(userId, roleName, scope = { scopeType: 'global', scopeId: null }) {
  await pool.query(
    `DELETE FROM user_roles
      WHERE user_id = $1
        AND role_name = $2
        AND scope_type = $3
        AND (scope_id = $4 OR ($4 IS NULL AND scope_id IS NULL))`,
    [userId, roleName, scope.scopeType, scope.scopeId ? String(scope.scopeId) : null]
  );
}

/**
 * Return models the user may use for a tool, resolved from system_settings + user roles.
 * Falls back to all available models if no per-tool restriction is configured.
 */
async function getPermittedModels(userId, toolSlug) {
  const admin = await isOrgAdmin(userId);
  if (admin) {
    // Admins can use all models
    const res = await pool.query(
      `SELECT value FROM system_settings WHERE key = 'ai_models' LIMIT 1`
    );
    return res.rows[0]?.value ?? [];
  }

  // Check for tool-specific model restriction
  const res = await pool.query(
    `SELECT value FROM system_settings WHERE key = $1 LIMIT 1`,
    [`tool_models_${toolSlug}`]
  );
  return res.rows[0]?.value ?? [];
}

/**
 * Check whether a user may use a specific model for a tool.
 */
async function canUseModel(userId, toolSlug, modelId) {
  const permitted = await getPermittedModels(userId, toolSlug);
  if (!permitted || permitted.length === 0) return true; // no restriction
  return permitted.some((m) => (typeof m === 'string' ? m : m.id) === modelId);
}

/**
 * Check whether a user may access a specific MCP resource URI within their org.
 *
 * Resolution order:
 *   1. org_admin — always allowed.
 *   2. Explicit deny for this user or any of their roles — denied.
 *   3. Explicit allow for this user or any of their roles — allowed.
 *   4. No matching rule — denied (deny by default).
 *
 * @param {number} userId      — user id (from req.user.id)
 * @param {string} resourceUri — MCP resource URI e.g. 'mcp://finance/invoices'
 * @param {number} orgId       — org id (from req.user.orgId — never from request data)
 */
async function canAccessResource(userId, resourceUri, orgId) {
  if (!userId || !resourceUri || !orgId) return false;

  if (await isOrgAdmin(userId)) return true;

  // Collect the user's role names for role-based rule matching
  const rolesRes = await pool.query(
    `SELECT DISTINCT role_name FROM user_roles WHERE user_id = $1`,
    [userId]
  );
  const roleNames = rolesRes.rows.map(r => r.role_name);

  const permRes = await pool.query(
    `SELECT permission FROM resource_permissions
      WHERE org_id = $1
        AND resource_uri = $2
        AND (
          user_id = $3
          OR (role_name IS NOT NULL AND role_name = ANY($4))
        )`,
    [orgId, resourceUri, userId, roleNames]
  );

  if (permRes.rows.length === 0) return false; // deny by default

  // Any explicit deny wins
  if (permRes.rows.some(r => r.permission === 'deny')) return false;

  return permRes.rows.some(r => r.permission === 'allow');
}

/**
 * Grant a resource permission to a user or role.
 * Upserts — re-granting the same subject on the same URI updates the permission type.
 *
 * Provide exactly one of userId or roleName.
 */
async function grantResourcePermission(orgId, resourceUri, { userId = null, roleName = null }, permission, grantedBy) {
  if (!orgId || !resourceUri || !permission) throw new Error('orgId, resourceUri, and permission are required');
  if (!['allow', 'deny'].includes(permission)) throw new Error('permission must be allow or deny');
  if ((userId == null) === (roleName == null)) throw new Error('Provide exactly one of userId or roleName');

  if (userId != null) {
    await pool.query(
      `INSERT INTO resource_permissions (org_id, resource_uri, user_id, permission, granted_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (org_id, resource_uri, user_id) WHERE user_id IS NOT NULL
       DO UPDATE SET permission = EXCLUDED.permission, granted_by = EXCLUDED.granted_by`,
      [orgId, resourceUri, userId, permission, grantedBy]
    );
  } else {
    await pool.query(
      `INSERT INTO resource_permissions (org_id, resource_uri, role_name, permission, granted_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (org_id, resource_uri, role_name) WHERE role_name IS NOT NULL
       DO UPDATE SET permission = EXCLUDED.permission, granted_by = EXCLUDED.granted_by`,
      [orgId, resourceUri, roleName, permission, grantedBy]
    );
  }
}

/**
 * Revoke a resource permission by its id, scoped to org_id.
 */
async function revokeResourcePermission(orgId, permissionId) {
  if (!orgId || !permissionId) throw new Error('orgId and permissionId are required');
  const res = await pool.query(
    `DELETE FROM resource_permissions WHERE id = $1 AND org_id = $2 RETURNING id`,
    [permissionId, orgId]
  );
  if (res.rows.length === 0) throw new Error('Permission not found or does not belong to this organisation');
}

/**
 * List all resource permissions for a given org, optionally filtered by resourceUri.
 */
async function listResourcePermissions(orgId, resourceUri = null) {
  if (!orgId) throw new Error('orgId is required');
  const params = [orgId];
  let query = `
    SELECT rp.id, rp.resource_uri, rp.user_id, rp.role_name, rp.permission, rp.created_at,
           u.email AS user_email
      FROM resource_permissions rp
      LEFT JOIN users u ON u.id = rp.user_id
     WHERE rp.org_id = $1`;
  if (resourceUri) {
    params.push(resourceUri);
    query += ` AND rp.resource_uri = $2`;
  }
  query += ` ORDER BY rp.resource_uri, rp.created_at DESC`;
  const res = await pool.query(query, params);
  return res.rows;
}

module.exports = {
  hasRole,
  isOrgAdmin,
  getUserRoles,
  grantRole,
  revokeRole,
  getPermittedModels,
  canUseModel,
  canAccessResource,
  grantResourcePermission,
  revokeResourcePermission,
  listResourcePermissions,
};
