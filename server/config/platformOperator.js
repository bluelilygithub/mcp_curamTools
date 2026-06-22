'use strict';

/**
 * Platform operator — Blue Lily admin on the platform template org.
 * May manage users (and scoped org metadata) across all organisations.
 */
const { pool } = require('../db');
const { isPlatformOrg } = require('./platformOrg');
const { isOrgAdmin } = require('../services/PermissionService');

async function isPlatformOperator(user) {
  if (!user?.id || user.orgType !== 'internal') return false;
  if (!isPlatformOrg(user.orgId)) return false;
  return isOrgAdmin(user.id);
}

/** Target user row if the operator may manage them; otherwise null. */
async function findManagedUser(userId, operator) {
  const parsedId = parseInt(userId, 10);
  if (!Number.isInteger(parsedId) || parsedId <= 0) return null;

  const res = await pool.query(
    'SELECT id, org_id FROM users WHERE id = $1',
    [parsedId]
  );
  if (!res.rows.length) return null;

  const target = res.rows[0];
  if (target.org_id === operator.orgId) return target;
  if (await isPlatformOperator(operator)) return target;
  return null;
}

/**
 * Org id for listing departments / org_roles / access-roles.
 * Platform operators may pass ?orgId=; others are pinned to their own org.
 */
async function resolveScopedOrgId(operator, queryOrgId) {
  const requested = queryOrgId != null && queryOrgId !== ''
    ? parseInt(queryOrgId, 10)
    : operator.orgId;
  if (!Number.isInteger(requested) || requested <= 0) return operator.orgId;
  if (requested === operator.orgId) return requested;
  if (await isPlatformOperator(operator)) return requested;
  return operator.orgId;
}

module.exports = {
  isPlatformOperator,
  findManagedUser,
  resolveScopedOrgId,
};
