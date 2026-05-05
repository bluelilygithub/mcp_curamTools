/**
 * Auth routes — login, logout, register (invite-only), profile, password reset.
 */
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { createAuthRateLimiter } = require('../middleware/rateLimiter');
const { acceptInvitation, getInvitation } = require('../services/InvitationService');
const EmailService = require('../services/EmailService');

const router = express.Router();

const SESSION_TTL_DAYS = 7;

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Auth-specific rate limiter: 5 attempts per 15 minutes per IP:email
const authLimiter = createAuthRateLimiter();

// ── POST /api/auth/login ──────────────────────────────────────────────────
router.post('/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const userRes = await pool.query(
      `SELECT u.*, o.name AS org_name, o.org_type
         FROM users u
         LEFT JOIN organizations o ON o.id = u.org_id
        WHERE u.email = $1`,
      [email.toLowerCase().trim()]
    );

    if (userRes.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = userRes.rows[0];

    // Check if account is locked (same error message as invalid password)
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (!user.is_active) {
      return res.status(401).json({ error: 'Account is not yet activated. Check your invitation email.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    
    if (!valid) {
      // Increment failed attempts and lock if threshold reached
      await pool.query(`
        UPDATE users 
        SET login_attempts = COALESCE(login_attempts, 0) + 1,
            locked_until = CASE 
              WHEN COALESCE(login_attempts, 0) + 1 >= 5 THEN NOW() + INTERVAL '15 minutes'
              ELSE locked_until
            END
        WHERE id = $1
      `, [user.id]);
      
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Successful login: reset attempts and clear lock
    await pool.query(`
      UPDATE users 
      SET login_attempts = 0, locked_until = NULL 
      WHERE id = $1
    `, [user.id]);

    // Create session
    const token = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO auth_sessions (user_id, token, expires_at) VALUES ($1, $2, $3)`,
      [user.id, token, expiresAt]
    );

    // Load roles
    const rolesRes = await pool.query(
      `SELECT role_name AS name, scope_type FROM user_roles WHERE user_id = $1`,
      [user.id]
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone,
        orgId: user.org_id,
        orgName: user.org_name,
        orgType: user.org_type ?? 'internal',
        roles: rolesRes.rows,
      },
    });
  } catch (err) {
    console.error('[auth/login]', err.message);
    res.status(500).json({ error: 'Login failed.' });
  }
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────
router.post('/logout', requireAuth, async (req, res) => {
  const token = req.headers.authorization?.slice(7);
  if (token) {
    await pool.query('DELETE FROM auth_sessions WHERE token = $1', [token]).catch(() => {});
  }
  res.json({ ok: true });
});

// ── POST /api/auth/register (invite-only) ────────────────────────────────
router.post('/register', authLimiter, async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) {
    return res.status(400).json({ error: 'Invitation token and password are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  try {
    const { userId, email } = await acceptInvitation(token, password);

    // Clear any existing lock for new/activated user
    await pool.query('UPDATE users SET login_attempts = 0, locked_until = NULL WHERE id = $1', [userId]);

    // Create session immediately
    const sessionToken = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO auth_sessions (user_id, token, expires_at) VALUES ($1, $2, $3)`,
      [userId, sessionToken, expiresAt]
    );

    const userRes = await pool.query(
      `SELECT u.*, o.name AS org_name, o.org_type
         FROM users u
         LEFT JOIN organizations o ON o.id = u.org_id
        WHERE u.id = $1`,
      [userId]
    );
    const user = userRes.rows[0];
    const rolesRes = await pool.query(
      `SELECT role_name AS name, scope_type FROM user_roles WHERE user_id = $1`,
      [userId]
    );

    res.json({
      token: sessionToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone,
        orgId: user.org_id,
        orgName: user.org_name,
        orgType: user.org_type ?? 'internal',
        roles: rolesRes.rows,
      },
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── GET /api/auth/invite/:token — validate token ──────────────────────────
router.get('/invite/:token', async (req, res) => {
  try {
    const { email } = await getInvitation(req.params.token);
    res.json({ email });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── GET /api/auth/profile ─────────────────────────────────────────────────
router.get('/profile', requireAuth, async (req, res) => {
  try {
    const userRes = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.phone, u.timezone,
              u.org_id, o.name AS org_name, o.org_type
         FROM users u
         LEFT JOIN organizations o ON o.id = u.org_id
        WHERE u.id = $1`,
      [req.user.id]
    );
    const rolesRes = await pool.query(
      `SELECT role_name AS name, scope_type FROM user_roles WHERE user_id = $1`,
      [req.user.id]
    );
    const user = userRes.rows[0];
    res.json({
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      phone: user.phone,
      timezone: user.timezone,
      orgId: user.org_id,
      orgName: user.org_name,
      orgType: user.org_type ?? 'internal',
      roles: rolesRes.rows,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load profile.' });
  }
});

// ── PUT /api/auth/profile ─────────────────────────────────────────────────
router.put('/profile', requireAuth, async (req, res) => {
  const { firstName, lastName, phone, timezone } = req.body;
  try {
    await pool.query(
      `UPDATE users SET first_name = $1, last_name = $2, phone = $3, timezone = $4 WHERE id = $5`,
      [firstName ?? null, lastName ?? null, phone ?? null, timezone ?? 'UTC', req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update profile.' });
  }
});

// ── POST /api/auth/change-password ────────────────────────────────────────
router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required.' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }
  try {
    const userRes = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const user = userRes.rows[0];
    const match = await bcrypt.compare(currentPassword, user.password_hash);
    if (!match) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }
    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE users SET password_hash = $1, login_attempts = 0, locked_until = NULL WHERE id = $2', [hash, req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to change password.' });
  }
});

// ── POST /api/auth/forgot-password ────────────────────────────────────────
router.post('/forgot-password', authLimiter, async (req, res) => {
  const { email } = req.body;
  // Always respond 200 to prevent email enumeration
  if (!email) return res.json({ ok: true });

  try {
    const userRes = await pool.query(
      `SELECT u.id, u.org_id FROM users u WHERE u.email = $1 AND u.is_active = TRUE`,
      [email.toLowerCase().trim()]
    );
    if (userRes.rows.length === 0) return res.json({ ok: true });

    const { id: userId, org_id: orgId } = userRes.rows[0];
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await pool.query(
      `INSERT INTO system_settings (org_id, key, value, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (org_id, key) DO UPDATE SET value = $3, updated_at = NOW()`,
      [
        orgId,
        `password_reset_${resetToken}`,
        JSON.stringify({ userId, email, expiresAt: expiresAt.toISOString() }),
      ]
    );

    const appUrl = (process.env.APP_URL || 'http://localhost:5174').replace(/\/$/, '');
    await EmailService.sendPasswordReset(email, `${appUrl}/reset-password/${resetToken}`);
  } catch (err) {
    console.error('[auth/forgot-password]', err.message);
  }

  res.json({ ok: true });
});

// ── POST /api/auth/reset-password ─────────────────────────────────────────
router.post('/reset-password', authLimiter, async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) {
    return res.status(400).json({ error: 'Token and new password are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  try {
    const settingRes = await pool.query(
      `SELECT value FROM system_settings WHERE key = $1`,
      [`password_reset_${token}`]
    );
    if (settingRes.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset link.' });
    }
    const { userId, expiresAt } = settingRes.rows[0].value;
    if (new Date(expiresAt) < new Date()) {
      return res.status(400).json({ error: 'Reset link has expired.' });
    }

    const hash = await bcrypt.hash(password, 12);
    await pool.query('UPDATE users SET password_hash = $1, login_attempts = 0, locked_until = NULL WHERE id = $2', [hash, userId]);

    // Invalidate all active sessions
    await pool.query('DELETE FROM auth_sessions WHERE user_id = $1', [userId]);

    // Consume reset token
    await pool.query(
      `DELETE FROM system_settings WHERE key = $1`,
      [`password_reset_${token}`]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('[auth/reset-password]', err.message);
    res.status(500).json({ error: 'Password reset failed.' });
  }
});

module.exports = router;
