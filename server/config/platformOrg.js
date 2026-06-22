'use strict';

/**
 * Platform org — operator template for system_settings / model catalogue inheritance.
 * Defaults to org id 1 for backward compatibility. Set PLATFORM_ORG_ID in production
 * if the seeded admin org is not id 1.
 */

function getPlatformOrgId() {
  const parsed = parseInt(process.env.PLATFORM_ORG_ID, 10);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  return 1;
}

/** Coerce request org id; invalid values fall back to platform org (legacy behaviour). */
function resolveOrgId(orgId) {
  const parsed = parseInt(orgId, 10);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  return getPlatformOrgId();
}

function isPlatformOrg(orgId) {
  return resolveOrgId(orgId) === getPlatformOrgId();
}

module.exports = {
  getPlatformOrgId,
  resolveOrgId,
  isPlatformOrg,
};
