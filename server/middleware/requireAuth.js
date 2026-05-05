/**
 * requireAuth middleware — validates session token, attaches req.user.
 * Token source: Authorization: Bearer <token>
 */
const { pool } = require('../db');

async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  const token = header.slice(7).trim();
  if (!token) return res.status(401).json({ error: 'Authentication required.' });

  try {
    const result = await pool.query(
      `SELECT
         u.id, u.email, u.org_id, u.first_name, u.last_name,
         u.is_active,
         o.name AS org_name,
         o.org_type,
         s.expires_at
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN organizations o ON o.id = u.org_id
       WHERE s.token = $1`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Session not found or expired.' });
    }

    const row = result.rows[0];

    if (!row.is_active) {
      return res.status(401).json({ error: 'Account is inactive.' });
    }

    if (new Date(row.expires_at) < new Date()) {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }

    req.user = {
      id: row.id,
      email: row.email,
      orgId: row.org_id,
      org_id: row.org_id,
      orgName: row.org_name,
      orgType: row.org_type ?? 'internal',
      firstName: row.first_name,
      lastName: row.last_name,
    };

    next();
  } catch (err) {
    console.error('[requireAuth]', err.message);
    res.status(500).json({ error: 'Authentication check failed.' });
  }
}

module.exports = { requireAuth };
