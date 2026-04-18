# MCP CuramTools - Revised Security Implementation Plan

**Date:** 2026-04-16 (revised)  
**Target Audience:** Solo developer / learning project  
**Purpose:** Actionable security improvements scaled to a one-person, one-organisation project  
**Estimated Timeline:** 3-5 days of focused work

> **Project Context:** This plan assumes the project identity documented in [PROJECT_IDENTITY.md](./PROJECT_IDENTITY.md) — an internal learning project for one organisation, built and maintained by a solo developer.

## Overview

This revised plan addresses the specific feedback that the original security plan was written for a different project (public SaaS with team, budget, and penetration testing). The focus is now on the three legitimate security improvements identified as genuinely missing and worth acting on, scaled to the actual context of a solo developer building a learning project for a single organisation.

### Key Adjustments from Original Plan:
1. **Removed** team/budget assumptions (no "Senior Backend Developer for 4 weeks")
2. **Removed** inappropriate recommendations (AWS Secrets Manager, ClamAV, disk storage on Railway)
3. **Corrected** technical errors (JavaScript date comparison, SQL logic, Railway ephemeral storage)
4. **Acknowledged** existing security strengths (Helmet.js CSP already implemented)
5. **Focused** on the three legitimate items that match the actual threat model

---

## The Three Legitimate Items

### 1. Rate Limiting on Authentication Endpoints
**Risk:** Medium - Account enumeration, credential stuffing  
**Location:** `server/routes/auth.js` (login, register, password reset)  
**Effort:** 1-2 hours

#### Current State:
- Rate limiting exists (`createRateLimiter`) but is only applied to agent endpoints (`docExtractor`, `conversation`, `createAgentRoute`)
- Authentication endpoints have no rate limiting, making them vulnerable to brute force attacks

#### Implementation:
1. **Create auth-specific rate limiter** in `server/middleware/rateLimiter.js`:
```javascript
// Add to server/middleware/rateLimiter.js (or create separate auth limiter)
const createAuthRateLimiter = () => createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  keyFn: (req) => `${req.ip}:${req.body?.email?.toLowerCase()?.trim() || 'unknown'}`,
});
```

2. **Apply to auth routes** in `server/routes/auth.js`:
```javascript
const { createAuthRateLimiter } = require('../middleware/rateLimiter');
const authLimiter = createAuthRateLimiter();

// Apply to login, register, forgot-password, reset-password
router.post('/login', authLimiter, async (req, res) => { ... });
router.post('/register', authLimiter, async (req, res) => { ... });
router.post('/forgot-password', authLimiter, async (req, res) => { ... });
router.post('/reset-password', authLimiter, async (req, res) => { ... });
```

3. **Add account lockout** (optional but recommended):
```javascript
// In login handler after failed attempt
await pool.query(`
  UPDATE users 
  SET login_attempts = COALESCE(login_attempts, 0) + 1,
      locked_until = CASE 
        WHEN COALESCE(login_attempts, 0) >= 5 THEN NOW() + INTERVAL '15 minutes'
        ELSE locked_until
      END
  WHERE id = $1
`, [user.id]);
```

#### Acceptance Criteria:
- ✅ Login attempts limited to 5 per 15 minutes per IP:email combination
- ✅ Clear 429 response with "Too many requests" message
- ✅ Rate limiting applies to registration and password reset endpoints
- ✅ Optional: Account locked for 15 minutes after 5 failed attempts (prevents further DB queries)

---

### 2. Scoped Environment for Stdio Spawn
**Risk:** Low-Medium - Credential leakage to child processes  
**Location:** `server/platform/mcpRegistry.js` (`_connectStdio`)  
**Effort:** 2-3 hours

#### Current State:
```javascript
const child = spawn(command, args, {
  env: { ...process.env, ...env }, // Passes ALL environment variables
  stdio: ['pipe', 'pipe', 'pipe'],
});
```
- Child processes inherit the full parent environment, potentially exposing secrets
- Already noted as a gap in project documentation

#### Implementation:
1. **Create environment sanitization function**:
```javascript
// Add to server/platform/mcpRegistry.js or a shared utility
function sanitizeEnvironment(extraEnv = {}) {
  // Safe variables that child processes might need
  const safeVars = [
    'PATH', 'NODE_ENV', 'TZ', 'LANG', 'LC_ALL',
    'NODE_PATH', 'HOME', 'USER', 'LOGNAME',
    // Application-specific safe variables
    'WP_URL', 'WP_USER', 'WP_APP_PASSWORD', // WordPress MCP server
    'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', // Google Ads
    'GOOGLE_ANALYTICS_CLIENT_ID', 'GOOGLE_ANALYTICS_CLIENT_SECRET',
    'ANTHROPIC_API_KEY', 'FAL_API_KEY',
  ];
  
  const env = {};
  safeVars.forEach(key => {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  });
  
  // Add explicitly allowed extra env from server config
  Object.assign(env, extraEnv);
  
  return env;
}
```

2. **Update `_connectStdio` method**:
```javascript
_connectStdio(server) {
  return new Promise((resolve, reject) => {
    const { command, args = [], env = {} } = server.config || {};
    if (!command) return reject(new Error('stdio transport requires config.command'));

    const child = spawn(command, args, {
      env: sanitizeEnvironment(env), // SANITIZED
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    
    // ... rest of existing implementation
  });
}
```

3. **Add validation for command and args** (bonus security):
```javascript
// Whitelist allowed commands for stdio transport
const ALLOWED_COMMANDS = ['node', 'python3', 'bash', 'sh'];
const ALLOWED_PATHS = ['/app/server/mcp-servers/', '/usr/local/bin/', '/usr/bin/'];

function validateCommand(command, args) {
  const basename = command.split('/').pop();
  if (!ALLOWED_COMMANDS.includes(basename)) {
    throw new Error(`Command "${basename}" is not allowed`);
  }
  
  // Optional: validate command path is within allowed directories
  const resolved = require('path').resolve(command);
  if (!ALLOWED_PATHS.some(path => resolved.startsWith(path))) {
    throw new Error(`Command path "${resolved}" is not in allowed directories`);
  }
  
  return { command, args };
}
```

#### Acceptance Criteria:
- ✅ Child processes receive only necessary environment variables
- ✅ Sensitive secrets not exposed to MCP servers (e.g., database credentials, JWT secrets)
- ✅ Backward compatible — existing MCP server configurations continue to work
- ✅ Optional: Command validation prevents arbitrary command execution

---

### 3. Authentication Rate Limiting + Account Lockout
**Risk:** Medium - Credential stuffing, account takeover  
**Location:** `server/routes/auth.js`  
**Effort:** 2-3 hours (includes database schema updates)

#### Current State:
- No rate limiting on auth endpoints (covered in Item 1)
- No account lockout mechanism
- Failed login attempts are not tracked

#### Implementation:
1. **Extend users table schema** (idempotent migration):
```sql
-- In server/db.js initSchema() function
await pool.query(`
  ALTER TABLE users ADD COLUMN IF NOT EXISTS login_attempts INTEGER DEFAULT 0;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
`);
```

2. **Update login logic** in `server/routes/auth.js`:
```javascript
router.post('/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  // ... existing validation

  try {
    const userRes = await pool.query(
      `SELECT u.*, o.name AS org_name
         FROM users u
         LEFT JOIN organizations o ON o.id = u.org_id
        WHERE u.email = $1`,
      [email.toLowerCase().trim()]
    );

    if (userRes.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = userRes.rows[0];

    // Check if account is locked
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return res.status(401).json({ 
        error: 'Account is temporarily locked. Try again later.' 
      });
    }

    // Validate password
    const valid = await bcrypt.compare(password, user.password_hash);
    
    if (!valid) {
      // Increment failed attempts
      await pool.query(`
        UPDATE users 
        SET login_attempts = login_attempts + 1,
            locked_until = CASE 
              WHEN login_attempts + 1 >= 5 THEN NOW() + INTERVAL '15 minutes'
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
    
    // ... rest of successful login flow
  } catch (err) {
    // ... error handling
  }
});
```

3. **Fix the JavaScript date comparison bug** (from original plan):
```javascript
// CORRECT: Compare Date objects directly
if (user.locked_until && new Date(user.locked_until) > new Date()) {
  // Account is locked
}

// WRONG (from original plan): Can't subtract number from Date
// if (new Date(row.expires_at) < new Date() - SESSION_TIMEOUT)
```

4. **Fix the SQL logic bug** (from original plan):
```sql
-- CORRECT: Use parentheses to group conditions properly
DELETE FROM auth_sessions 
WHERE user_id = $1 
  AND (expires_at < NOW() 
       OR (SELECT COUNT(*) FROM auth_sessions WHERE user_id = $1) >= 3);

-- WRONG (from original plan): Missing parentheses changes logic
-- DELETE FROM auth_sessions WHERE user_id = $1 AND expires_at < NOW() OR (...)
```

#### Acceptance Criteria:
- ✅ Failed login attempts tracked per user
- ✅ Accounts locked after 5 failed attempts (15-minute lockout)
- ✅ Lock automatically clears after timeout
- ✅ Successful login resets attempt counter
- ✅ Clear error messages for locked accounts
- ✅ No SQL or JavaScript syntax errors

---

## Additional Small Improvements (Optional)

### 4. Input Validation for Critical Endpoints
**Effort:** 2-3 hours

While the platform has strong architectural security (org isolation, parameterized queries), adding basic input validation to a few critical endpoints would be prudent:

```javascript
// Simple validation helper
function validateEmail(email) {
  return typeof email === 'string' && 
         email.includes('@') && 
         email.length <= 255;
}

function validatePassword(password) {
  return typeof password === 'string' && 
         password.length >= 8 && 
         password.length <= 100;
}

// Apply in auth routes before processing
router.post('/login', authLimiter, (req, res, next) => {
  const { email, password } = req.body;
  if (!validateEmail(email) || !validatePassword(password)) {
    return res.status(400).json({ error: 'Invalid input format.' });
  }
  next();
}, async (req, res) => { ... });
```

### 5. Session Management Enhancement
**Effort:** 1-2 hours

Add idle timeout (in addition to the existing 7-day absolute TTL):

```javascript
// In server/middleware/requireAuth.js
const SESSION_IDLE_TIMEOUT = 60 * 60 * 1000; // 1 hour

// After verifying session exists
if (new Date(row.expires_at) < new Date()) {
  // Absolute expiry (already implemented)
  await pool.query('DELETE FROM auth_sessions WHERE token = $1', [token]);
  return res.status(401).json({ error: 'Session expired.' });
}

// Optional: Check last activity (requires last_activity column)
// const idleCutoff = new Date(Date.now() - SESSION_IDLE_TIMEOUT);
// if (new Date(row.last_activity) < idleCutoff) {
//   // Session idle timeout
// }
```

---

## Implementation Timeline & Resources

### Solo Developer Timeline:
- **Day 1:** Rate limiting on auth endpoints (Item 1)
- **Day 2:** Scoped environment for stdio spawn (Item 2)
- **Day 3:** Account lockout implementation (Item 3)
- **Day 4:** Optional improvements (Input validation, session enhancements)
- **Day 5:** Testing and deployment

### Testing Strategy:
1. **Manual testing:** Verify rate limiting works with curl/Postman
2. **Integration testing:** Ensure MCP servers still function with sanitized environment
3. **Database testing:** Verify schema migrations apply cleanly
4. **Regression testing:** Confirm existing auth flows still work

### Deployment Considerations:
- **Railway ephemeral storage:** File uploads using `multer.memoryStorage()` are correct for Railway (files processed and discarded immediately)
- **Environment variables:** No AWS Secrets Manager needed; Railway's environment variables are sufficient
- **Zero-downtime:** Schema changes use `ADD COLUMN IF NOT EXISTS` for backward compatibility

---

## What's Not Needed (Based on Actual Context)

### Unnecessary for this project:
1. **ClamAV / virus scanning:** Internal invite-only tool with known users; file uploads are for document extraction, not general file sharing
2. **AWS Secrets Manager:** Railway environment variables are the appropriate secret management solution
3. **Penetration testing budget:** Solo developer project; manual security review suffices
4. **Multi-factor authentication (MFA):** Low priority for internal learning project
5. **Disk storage for uploads:** `multer.memoryStorage()` is correct for Railway's ephemeral filesystem

### Already implemented (acknowledged):
1. **Helmet.js with CSP:** Already configured in `server/index.js`
2. **Organizational isolation:** Strongly enforced throughout codebase
3. **BCrypt password hashing:** 12 rounds already used
4. **Parameterized queries:** SQL injection protection in place
5. **Rate limiting on agent endpoints:** Already implemented via `createRateLimiter`

---

## Success Criteria

### Minimal Viable Security Improvements:
- ✅ Authentication endpoints protected against brute force
- ✅ Child processes don't inherit sensitive environment variables
- ✅ Accounts temporarily lock after repeated failed attempts
- ✅ No new security regressions introduced

### Measurable Outcomes:
- Failed login attempts tracked in database
- Rate limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`) on auth responses
- Environment variable audit shows only safe vars passed to child processes
- Zero authentication-related incidents in regular usage

---

## Next Steps

1. **Immediate:** Implement Item 1 (auth rate limiting) - smallest impact, quick win
2. **Follow-up:** Item 2 (scoped environment) - addresses noted gap in documentation
3. **Complete:** Item 3 (account lockout) - provides defense-in-depth
4. **Optional:** Input validation and session enhancements if time permits

This revised plan focuses on **what matters** for your specific context: a solo developer building a learning project for one organisation. Each item is small, specific, and can be implemented in isolation without disrupting the existing platform.

---

*This plan should be considered complete after implementing Items 1-3. Additional security improvements can be added later if the project's scope changes (e.g., becomes public-facing or handles more sensitive data).*