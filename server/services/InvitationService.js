/**
 * InvitationService — admin-controlled user onboarding.
 * No open registration — all users enter via invitation.
 *
 * Flow:
 *   admin invites → inactive user + 48h token → activation email
 *   → user sets password → account activated → logged in immediately
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const EmailService = require('./EmailService');

const TOKEN_EXPIRY_HOURS = 48;
const SETTING_KEY = 'invitation_token';

/**
 * Create an inactive user and send an invitation email.
 * @returns {{ userId, token }}
 */
async function createInvitation(email, orgId, roleName = 'org_member', invitedBy = null) {
  // Check for existing user
  const existing = await pool.query('SELECT id, is_active FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0 && existing.rows[0].is_active) {
    throw new Error('A user with that email already exists and is active.');
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

  let userId;
  if (existing.rows.length > 0) {
    // Re-invitation: update token
    userId = existing.rows[0].id;
    await pool.query(
      `DELETE FROM system_settings
        WHERE key LIKE 'invitation_token_%' AND value->>'userId' = $1::text`,
      [String(userId)]
    );
  } else {
    // Create inactive user
    const res = await pool.query(
      `INSERT INTO users (org_id, email, is_active)
       VALUES ($1, $2, FALSE)
       RETURNING id`,
      [orgId, email]
    );
    userId = res.rows[0].id;

    // Assign role
    await pool.query(
      `INSERT INTO user_roles (user_id, role_name, scope_type, granted_by)
       VALUES ($1, $2, 'global', $3)
       ON CONFLICT DO NOTHING`,
      [userId, roleName, invitedBy]
    );
  }

  // Store invitation token in system_settings (keyed by token)
  await pool.query(
    `INSERT INTO system_settings (org_id, key, value, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (org_id, key) DO UPDATE SET value = $3, updated_at = NOW()`,
    [
      orgId,
      `invitation_token_${token}`,
      JSON.stringify({ userId, email, expiresAt: expiresAt.toISOString() }),
      invitedBy,
    ]
  );

  // Send invitation email
  const appUrl = process.env.APP_URL || 'http://localhost:5174';
  const activationUrl = `${appUrl}/invite/${token}`;
  console.log(`[InvitationService] Activation URL for ${email}: ${activationUrl}`);
  await EmailService.sendInvitation(email, activationUrl);

  return { userId, token, activationUrl };
}

/**
 * Validate an invitation token. Returns { email, userId } or throws.
 */
async function getInvitation(token) {
  const res = await pool.query(
    `SELECT value FROM system_settings WHERE key = $1`,
    [`invitation_token_${token}`]
  );
  if (res.rows.length === 0) throw new Error('Invalid or expired invitation link.');

  const { userId, email, expiresAt } = res.rows[0].value;
  if (new Date(expiresAt) < new Date()) throw new Error('Invitation link has expired.');

  return { userId, email };
}

/**
 * Accept an invitation: set password, activate account, consume token.
 */
async function acceptInvitation(token, password) {
  const { userId, email } = await getInvitation(token);
  const hash = await bcrypt.hash(password, 12);

  await pool.query(
    `UPDATE users SET password_hash = $1, is_active = TRUE WHERE id = $2`,
    [hash, userId]
  );

  // Consume token
  await pool.query(
    `DELETE FROM system_settings WHERE key = $1`,
    [`invitation_token_${token}`]
  );

  return { userId, email };
}

/**
 * Resend an invitation: invalidate existing tokens and issue a fresh one.
 */
async function resendInvitation(userId, invitedBy) {
  const userRes = await pool.query(
    'SELECT email, org_id FROM users WHERE id = $1', [userId]
  );
  if (userRes.rows.length === 0) throw new Error('User not found.');
  const { email, org_id: orgId } = userRes.rows[0];

  // Remove any existing invitation tokens for this user
  await pool.query(
    `DELETE FROM system_settings
      WHERE org_id = $1 AND key LIKE 'invitation_token_%'
        AND value->>'userId' = $2::text`,
    [orgId, String(userId)]
  );

  return createInvitation(email, orgId, 'org_member', invitedBy);
}

module.exports = { createInvitation, getInvitation, acceptInvitation, resendInvitation };
