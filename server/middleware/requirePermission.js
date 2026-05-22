/**
 * requirePermission middleware factory.
 *
 * Compatibility layer over existing roles:
 * - org_admin has '*'
 * - legacy role names still satisfy matching checks during migration
 * - new routes can require capability names such as 'models:manage'
 */
const { hasPermission } = require('../services/PermissionService');

function requirePermission(permission) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    try {
      const permitted = await hasPermission(req.user.id, permission);
      if (!permitted) {
        return res.status(403).json({ error: 'Insufficient permissions.' });
      }
      next();
    } catch (err) {
      console.error('[requirePermission]', err.message);
      res.status(500).json({ error: 'Permission check failed.' });
    }
  };
}

module.exports = { requirePermission };
