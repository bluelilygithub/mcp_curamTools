# Permissions Model

This application uses a backwards-compatible permission layer over the existing role system. The goal is to make access control more expressive without breaking current users, routes, or admin workflows.

The current roles still matter:

- `org_admin`
- `org_member`
- `ads_operator`

The new layer adds named capabilities such as `admin:access`, `lessons:manage`, `mcp:manage`, and `google_ads:manage`. Capabilities are derived from roles in `PermissionService`, so existing users do not need to be migrated before routes can adopt capability checks.

---

## Current Design

### Authentication

Authentication is still handled by `requireAuth`.

`requireAuth` validates the bearer session token, confirms the user is active, checks session expiry, and attaches `req.user`:

```js
{
  id,
  email,
  orgId,
  org_id,
  orgName,
  orgType,
  firstName,
  lastName
}
```

Use `requireAuth` before any role or permission middleware.

### Legacy Roles

Roles are stored in `user_roles`.

`PermissionService.hasRole(userId, roleNames, scope?)` remains available and is still used where a route intentionally needs a raw legacy role check.

Global roles satisfy scoped checks. Most current assignments use `scope_type = 'global'`.

### Capability Permissions

Capabilities are derived in `PermissionService.getEffectivePermissions(userId)`.

The built-in role map currently is:

```js
const ROLE_PERMISSIONS = {
  org_admin: ['*'],
  ads_operator: [
    'agents:run',
    'agents:run:ads',
    'reports:view',
  ],
  org_member: [
    'agents:run',
    'agents:run:basic',
    'conversation:use',
    'reports:view',
  ],
};
```

`org_admin` maps to `*`, so it remains the platform-wide admin role.

During migration, each legacy role name is also exposed as a capability. This means existing checks such as `requiredPermission: 'ads_operator'` keep working.

### Resource Permissions

MCP resource permissions are separate from route-level capabilities.

`resource_permissions` controls access to specific MCP resource URIs. It supports user-specific and role-specific allow/deny rules. Deny wins. No matching rule means deny by default.

Do not confuse:

- route capabilities, such as `mcp:manage`
- resource permissions, such as allowing a role to access a particular MCP resource URI

---

## How To Use It

### Protect A New Route

Prefer `requirePermission()` for new protected routes.

```js
const { requireAuth } = require('../middleware/requireAuth');
const { requirePermission } = require('../middleware/requirePermission');

router.post(
  '/models/reset',
  requireAuth,
  requirePermission('models:manage'),
  async (req, res) => {
    // handler
  }
);
```

Use capability names that describe the action, not the current role.

Good:

```js
requirePermission('lessons:manage')
requirePermission('mcp:manage')
requirePermission('google_ads:manage')
requirePermission('models:manage')
```

Avoid for new work:

```js
requireRole(['org_admin'])
```

Raw role checks are still allowed only when the code intentionally needs a legacy role boundary.

### Protect A New Agent

Agents registered through `createAgentRoute()` pass `requiredPermission`.

Existing role-style values still work:

```js
createAgentRoute({
  slug: 'ads-copy-diagnostic',
  runFn: runAdsCopyDiagnostic,
  requiredPermission: 'ads_operator',
});
```

For new agents, prefer capability-style names:

```js
createAgentRoute({
  slug: 'example-report',
  runFn: runExampleReport,
  requiredPermission: 'agents:run:reports',
});
```

`createAgentRoute()` calls `requirePermission(requiredPermission || 'agents:run')`, so `org_admin` still passes automatically through `*`.

### Assign Roles To An Agent

For standard agents registered through `createAgentRoute`, admins can override the coded default from:

```text
Admin > Agents > Agent Access
```

Each agent has two modes:

1. **Use code default**

The route's `requiredPermission` remains in effect. For example, many Google Ads agents default to `ads_operator`, while demo/document agents often default to `org_member`.

2. **Selected roles**

The selected roles become the allowed roles for that agent. This is stored in the agent's admin config as `allowed_roles`.

```json
{
  "allowed_roles": ["org_member", "ads_operator"]
}
```

`org_admin` is always allowed, even when it is not listed.

If `allowed_roles` is empty or `null`, the agent falls back to the coded route default.

This UI currently applies to standard `createAgentRoute` agents only. Custom direct routes need their own explicit access check before exposing role assignment controls.

### Check A Permission In Code

Use `PermissionService.hasPermission()` for non-middleware checks.

```js
const { hasPermission } = require('../services/PermissionService');

if (!(await hasPermission(req.user.id, 'lessons:manage'))) {
  return res.status(403).json({ error: 'Insufficient permissions.' });
}
```

Use `getEffectivePermissions()` when you need to inspect or return the user's resolved capabilities.

```js
const { getEffectivePermissions } = require('../services/PermissionService');

const permissions = await getEffectivePermissions(req.user.id);
```

Do not query `user_roles` directly from route handlers.

### Add A New Capability

For now, add built-in capability mappings in `ROLE_PERMISSIONS`.

Example:

```js
const ROLE_PERMISSIONS = {
  org_admin: ['*'],
  ads_operator: [
    'agents:run',
    'agents:run:ads',
    'reports:view',
    'google_ads:manage',
  ],
};
```

Then use the capability in routes:

```js
requirePermission('google_ads:manage')
```

Do not remove the legacy role name unless all callers have been migrated and tested.

### Naming Capabilities

Use the format:

```text
area:action
area:action:scope
```

Examples:

- `admin:access`
- `agents:run`
- `agents:run:ads`
- `lessons:manage`
- `models:manage`
- `mcp:manage`
- `knowledge:manage`
- `google_ads:manage`
- `reports:view`
- `conversation:use`

Use nouns for the area and verbs for the action. Keep names stable once used in route guards.

### Wildcards

The permission matcher supports:

```text
*
admin:*
```

`*` grants everything.

`admin:*` grants capabilities that start with `admin:`.

Use wildcards sparingly. Prefer explicit capabilities unless a role truly owns a whole area.

---

## Migration Rules

1. Preserve existing roles.

Do not remove or redefine `org_admin`, `org_member`, or `ads_operator`.

2. Move route checks gradually.

Convert one route group at a time from `requireRole()` to `requirePermission()`.

3. Keep role names valid during migration.

`getEffectivePermissions()` adds the user's role names as capabilities, so old `requiredPermission: 'ads_operator'` checks keep working.

4. Prefer capabilities for new routes.

New work should not add more raw `requireRole(['org_admin'])` unless there is a specific reason.

5. Keep MCP resource permissions separate.

Route capability checks decide whether the user can manage or enter a feature. Resource permissions decide whether the user can access a specific MCP resource URI.

6. Use `req.user.orgId`.

Permission-sensitive code must use the organisation from `req.user`, not from request body/query params.

---

## Current Capability Adoption

The first retrofit pass wires these areas through `requirePermission()`:

- shared agent run routes via `createAgentRoute`
- per-agent role overrides for standard route-factory agents through `Admin > Agents > Agent Access`
- main admin router via `admin:access`
- Lessons management via `lessons:manage`
- MCP admin via `mcp:manage`
- admin knowledge via `knowledge:manage`
- Google Ads customer/assignment management via `google_ads:manage`

Some routes still use `requireRole(['org_admin'])`. That is acceptable during migration. Convert them only when the capability boundary is clear.

---

## Testing Checklist

After changing permissions:

1. Run syntax checks for touched files.

```powershell
node --check "server/services/PermissionService.js"
node --check "server/middleware/requirePermission.js"
```

2. Run the platform smoke test.

```powershell
npm test
```

3. Manually verify at least:

- `org_admin` can still access admin routes.
- `ads_operator` can still run Ads agents.
- `org_member` can still access member-level agents.
- unauthenticated requests receive `401`.
- authenticated-but-unpermitted requests receive `403`.

4. For routes using `req.user.orgId`, confirm they do not accept client-supplied org IDs for permission decisions.

---

## Future Extension

The next step, if needed, is custom capability grants for custom roles.

A likely additive table would be:

```sql
org_role_permissions (
  org_id INTEGER NOT NULL,
  role_name TEXT NOT NULL,
  permission TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (org_id, role_name, permission)
)
```

`getEffectivePermissions()` can then merge:

1. built-in `ROLE_PERMISSIONS`
2. legacy role names
3. custom role permissions from the database

That should be added only when the current role map becomes too coarse. Until then, keep the system simple.
