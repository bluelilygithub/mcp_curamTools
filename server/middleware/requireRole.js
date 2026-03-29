/**
 * requireRole middleware factory.
 * Delegates to PermissionService — no inline SQL here.
 *
 * Usage:
 *   router.post('/run', requireAuth, requireRole(['org_admin', 'ads_operator']), handler);
 */
const { hasRole } = require('../services/PermissionService');

function requireRole(allowedRoles) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    try {
      const permitted = await hasRole(req.user.id, allowedRoles);
      if (!permitted) {
        return res.status(403).json({ error: 'Insufficient permissions.' });
      }
      next();
    } catch (err) {
      console.error('[requireRole]', err.message);
      res.status(500).json({ error: 'Permission check failed.' });
    }
  };
}

module.exports = { requireRole };
