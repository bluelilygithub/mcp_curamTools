# MCP CuramTools - Security Implementation Plan

**IMPORTANT CONTEXT UPDATE:** This plan was written assuming a public SaaS project with a security team, budget, and penetration testing. The actual project context is documented in [PROJECT_IDENTITY.md](./PROJECT_IDENTITY.md) — an internal learning project for one organisation, built and maintained by a solo developer. Many recommendations in this plan are inappropriate for this context. Refer to [ds_r_securityplan_revised.md](./ds_r_securityplan_revised.md) for the scaled-down, context‑appropriate plan.

**Date:** 2026-04-16  
**Target Audience:** Development team  
**Purpose:** Actionable security improvements prioritized by risk level  
**Estimated Timeline:** 6-8 weeks for full implementation

## Overview

This document outlines a phased security improvement plan for MCP CuramTools. Issues are categorized by severity (Critical, Moderate, Low) with specific implementation tasks, acceptance criteria, and estimated effort.

---

## Phase 1: Critical Issues (Weeks 1-2)

### 1.1 Input Validation Framework
**Risk:** High - Injection attacks, data corruption  
**Location:** All API endpoints, MCP tool parameters  
**Effort:** 3-4 days

#### Tasks:
1. **Install validation library**
   ```bash
   cd server
   npm install joi  # or zod based on team preference
   ```

2. **Create validation schemas for core entities**
   - User input (login, registration, profile updates)
   - MCP tool parameters
   - File upload metadata
   - Agent configuration

3. **Implement middleware for request validation**
   ```javascript
   // server/middleware/validateRequest.js
   const validateRequest = (schema) => (req, res, next) => {
     const { error, value } = schema.validate(req.body);
     if (error) return res.status(400).json({ error: error.message });
     req.validatedBody = value;
     next();
   };
   ```

4. **Update existing routes to use validation**
   - Auth routes (login, register, password reset)
   - Agent execution endpoints
   - MCP tool call endpoints
   - Admin configuration endpoints

#### Acceptance Criteria:
- ✅ All API endpoints validate input against defined schemas
- ✅ Invalid requests return 400 with clear error messages
- ✅ No raw user input reaches business logic without validation
- ✅ MCP tool parameters validated against tool definitions

---

### 1.2 Secure Stdio Process Execution
**Risk:** Critical - Remote code execution  
**Location:** `server/platform/mcpRegistry.js`  
**Effort:** 2-3 days

#### Tasks:
1. **Implement command validation**
   ```javascript
   const ALLOWED_COMMANDS = ['node', 'python3', 'bash'];
   const ALLOWED_PATHS = ['/app/server/mcp-servers/', '/usr/local/bin/'];
   
   function validateCommand(command, args) {
     // Whitelist allowed commands
     // Validate path is within allowed directories
     // Sanitize arguments
   }
   ```

2. **Implement process sandboxing**
   ```javascript
   const child = spawn(command, args, {
     env: sanitizedEnv, // Only necessary env vars
     stdio: ['pipe', 'pipe', 'pipe'],
     uid: 1000, // Non-root user
     gid: 1000,
     cwd: '/tmp', // Restricted working directory
   });
   ```

3. **Add resource limits**
   ```javascript
   // Use setrlimit or containerization
   const { exec } = require('child_process');
   exec(`prlimit --cpu=30 --nproc=50 -- ${command}`, ...);
   ```

4. **Implement execution timeout**
   ```javascript
   const timeout = setTimeout(() => {
     child.kill('SIGKILL');
   }, 30000); // 30-second timeout
   ```

#### Acceptance Criteria:
- ✅ MCP server commands validated against whitelist
- ✅ Processes run with restricted privileges
- ✅ Resource limits enforced (CPU, memory, processes)
- ✅ Execution timeout of 30 seconds
- ✅ Environment variables sanitized

---

### 1.3 Authentication Rate Limiting
**Risk:** High - Account enumeration, brute force  
**Location:** `server/routes/auth.js`  
**Effort:** 1-2 days

#### Tasks:
1. **Extend existing rate limiter for auth endpoints**
   ```javascript
   // server/middleware/rateLimiter.js
   const authLimiter = createRateLimiter({
     windowMs: 15 * 60 * 1000, // 15 minutes
     max: 5, // 5 attempts per 15 minutes
     keyFn: (req) => `${req.ip}:${req.body.email}`,
   });
   ```

2. **Apply rate limiting to all auth endpoints**
   - `POST /api/auth/login`
   - `POST /api/auth/register`
   - `POST /api/auth/forgot-password`
   - `POST /api/auth/reset-password`

3. **Implement account lockout**
   ```sql
   -- Add to users table
   ALTER TABLE users ADD COLUMN IF NOT EXISTS login_attempts INTEGER DEFAULT 0;
   ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
   ```

4. **Update login logic**
   ```javascript
   // After failed login
   await pool.query(`
     UPDATE users 
     SET login_attempts = login_attempts + 1,
         locked_until = CASE 
           WHEN login_attempts >= 5 THEN NOW() + INTERVAL '15 minutes'
           ELSE locked_until
         END
     WHERE id = $1
   `, [user.id]);
   ```

#### Acceptance Criteria:
- ✅ Login attempts limited to 5 per 15 minutes per IP:email
- ✅ Accounts locked for 15 minutes after 5 failed attempts
- ✅ Rate limiting headers included in responses
- ✅ Clear error messages for rate-limited requests

---

### 1.4 File Upload Security
**Risk:** High - Malware distribution, memory exhaustion  
**Location:** `server/routes/docExtractor.js`, other upload endpoints  
**Effort:** 2-3 days

#### Tasks:
1. **Implement disk storage instead of memory**
   ```javascript
   const upload = multer({
     storage: multer.diskStorage({
       destination: '/tmp/uploads',
       filename: (req, file, cb) => {
         const safeName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
         cb(null, safeName);
       },
     }),
     limits: { fileSize: maxBytes },
   });
   ```

2. **Add file type verification**
   ```javascript
   const { fileTypeFromFile } = require('file-type');
   
   async function verifyFileType(filePath, expectedMime) {
     const type = await fileTypeFromFile(filePath);
     return type && type.mime === expectedMime;
   }
   ```

3. **Implement virus scanning (ClamAV integration)**
   ```javascript
   const { ClamScan } = require('clamscan');
   const clamscan = new ClamScan();
   
   async function scanFile(filePath) {
     const { is_infected, viruses } = await clamscan.scan_file(filePath);
     return !is_infected;
   }
   ```

4. **Add file size quotas per user/org**
   ```sql
   -- Track file storage usage
   CREATE TABLE IF NOT EXISTS storage_usage (
     org_id INTEGER REFERENCES organizations(id),
     user_id INTEGER REFERENCES users(id),
     bytes_used BIGINT DEFAULT 0,
     updated_at TIMESTAMPTZ DEFAULT NOW()
   );
   ```

#### Acceptance Criteria:
- ✅ Files stored on disk, not in memory
- ✅ File type verified against actual content (not just extension)
- ✅ Virus scanning implemented for all uploads
- ✅ Storage quotas enforced per user/org
- ✅ Temporary files cleaned up after processing

---

## Phase 2: Moderate Issues (Weeks 3-4)

### 2.1 Enhanced Session Security
**Risk:** Moderate - Session hijacking, fixation  
**Location:** `server/routes/auth.js`, `server/middleware/requireAuth.js`  
**Effort:** 2 days

#### Tasks:
1. **Implement session timeout**
   ```javascript
   // Update session validation
   const SESSION_TIMEOUT = 60 * 60 * 1000; // 1 hour
   if (new Date(row.expires_at) < new Date() - SESSION_TIMEOUT) {
     return res.status(401).json({ error: 'Session expired' });
   }
   ```

2. **Add concurrent session control**
   ```sql
   -- Limit to 3 concurrent sessions per user
   DELETE FROM auth_sessions 
   WHERE user_id = $1 AND expires_at < NOW()
   OR (SELECT COUNT(*) FROM auth_sessions WHERE user_id = $1) >= 3;
   ```

3. **Implement session rotation**
   ```javascript
   // Rotate session token on privilege escalation
   async function rotateSession(userId, oldToken) {
     const newToken = generateToken();
     await pool.query(`
       UPDATE auth_sessions 
       SET token = $1 
       WHERE token = $2
     `, [newToken, oldToken]);
     return newToken;
   }
   ```

4. **Add session metadata logging**
   ```sql
   ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS ip_address INET;
   ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS user_agent TEXT;
   ```

#### Acceptance Criteria:
- ✅ Sessions timeout after 1 hour of inactivity
- ✅ Maximum 3 concurrent sessions per user
- ✅ Session tokens rotated on password change
- ✅ Session metadata logged for auditing

---

### 2.2 Transport Security for MCP Connections
**Risk:** Moderate - Man-in-the-middle attacks  
**Location:** `server/platform/mcpRegistry.js`  
**Effort:** 1-2 days

#### Tasks:
1. **Implement TLS certificate validation**
   ```javascript
   const https = require('https');
   
   const agent = new https.Agent({
     rejectUnauthorized: true,
     checkServerIdentity: (host, cert) => {
       // Custom certificate validation
       if (cert.subject.CN !== expectedCN) {
         throw new Error('Certificate CN mismatch');
       }
     },
   });
   ```

2. **Add SSL/TLS configuration for SSE connections**
   ```javascript
   const options = {
     hostname: url.hostname,
     port: url.port || 443,
     path: url.pathname,
     method: 'GET',
     agent: tlsAgent,
     headers: { ... }
   };
   ```

3. **Implement connection encryption for stdio**
   ```javascript
   // Use encrypted pipe or wrap in TLS tunnel
   const { spawn } = require('child_process');
   const tls = require('tls');
   
   // Create TLS socket for child process communication
   ```

4. **Add certificate pinning for critical MCP servers**
   ```javascript
   const CERT_PINNED_SERVERS = {
     'finance-server': 'sha256=abc123...',
     'crm-server': 'sha256=def456...',
   };
   ```

#### Acceptance Criteria:
- ✅ All SSE connections validate server certificates
- ✅ Critical MCP servers use certificate pinning
- ✅ Stdio communication encrypted when possible
- ✅ Connection failures logged with SSL/TLS details

---

### 2.3 Security Audit Logging
**Risk:** Moderate - Lack of forensic capability  
**Location:** Platform-wide  
**Effort:** 2-3 days

#### Tasks:
1. **Create security events table**
   ```sql
   CREATE TABLE IF NOT EXISTS security_events (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id INTEGER REFERENCES organizations(id),
     user_id INTEGER REFERENCES users(id),
     event_type TEXT NOT NULL, -- 'login', 'role_change', 'mcp_register'
     event_data JSONB NOT NULL,
     ip_address INET,
     user_agent TEXT,
     created_at TIMESTAMPTZ DEFAULT NOW()
   );
   
   CREATE INDEX idx_security_events_org_time ON security_events(org_id, created_at DESC);
   ```

2. **Implement audit logging service**
   ```javascript
   // server/services/AuditLogger.js
   class AuditLogger {
     static async log(eventType, eventData, req) {
       await pool.query(`
         INSERT INTO security_events 
         (org_id, user_id, event_type, event_data, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6)
       `, [
         req.user?.orgId,
         req.user?.id,
         eventType,
         JSON.stringify(eventData),
         req.ip,
         req.headers['user-agent']
       ]);
     }
   }
   ```

3. **Instrument critical operations**
   - User login/logout
   - Role changes (grant/revoke)
   - MCP server registration/deregistration
   - Resource permission changes
   - Admin configuration changes
   - Password resets

4. **Create audit log viewer in admin UI**
   ```jsx
   // client/src/pages/admin/AdminAuditLogsPage.jsx
   // Table with filters for event type, user, date range
   ```

#### Acceptance Criteria:
- ✅ All security-relevant events logged
- ✅ Audit logs include user, IP, timestamp, and action details
- ✅ Admin UI for viewing and filtering audit logs
- ✅ Logs retained for 90 days minimum

---

### 2.4 Strengthened Password Policy
**Risk:** Moderate - Credential compromise  
**Location:** `server/routes/auth.js`  
**Effort:** 1 day

#### Tasks:
1. **Implement password complexity requirements**
   ```javascript
   function validatePassword(password) {
     if (password.length < 12) return 'Password must be at least 12 characters';
     if (!/[A-Z]/.test(password)) return 'Password must contain uppercase letter';
     if (!/[a-z]/.test(password)) return 'Password must contain lowercase letter';
     if (!/[0-9]/.test(password)) return 'Password must contain number';
     if (!/[^A-Za-z0-9]/.test(password)) return 'Password must contain special character';
     return null;
   }
   ```

2. **Add password history (prevent reuse)**
   ```sql
   CREATE TABLE IF NOT EXISTS password_history (
     user_id INTEGER REFERENCES users(id),
     password_hash TEXT NOT NULL,
     created_at TIMESTAMPTZ DEFAULT NOW()
   );
   
   -- Store last 5 passwords, check against them
   ```

3. **Implement password strength meter in UI**
   ```javascript
   // Client-side password strength estimation
   import zxcvbn from 'zxcvbn';
   
   const strength = zxcvbn(password);
   if (strength.score < 3) {
     // Require stronger password
   }
   ```

4. **Add password expiration (optional for admins)**
   ```sql
   ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
   
   -- Require password change every 90 days for admin users
   ```

#### Acceptance Criteria:
- ✅ Minimum 12-character passwords with complexity
- ✅ Password history prevents reuse of last 5 passwords
- ✅ Password strength meter in registration/change forms
- ✅ Optional password expiration for admin accounts

---

## Phase 3: Low-Level Issues (Weeks 5-6)

### 3.1 Multi-Factor Authentication
**Risk:** Low - Account takeover  
**Location:** Authentication system  
**Effort:** 3-4 days

#### Tasks:
1. **Implement TOTP (Time-based One-Time Password)**
   ```javascript
   const speakeasy = require('speakeasy');
   const QRCode = require('qrcode');
   
   // Generate secret for user
   const secret = speakeasy.generateSecret({
     name: `MCP CuramTools:${user.email}`,
   });
   ```

2. **Add MFA enrollment flow**
   - Generate QR code for authenticator apps
   - Verify initial setup with test code
   - Store encrypted secret in database

3. **Update login flow**
   ```javascript
   // After password verification
   if (user.mfa_enabled) {
     const token = req.body.totp_token;
     const verified = speakeasy.totp.verify({
       secret: user.mfa_secret,
       encoding: 'base32',
       token,
     });
     if (!verified) return res.status(401).json({ error: 'Invalid MFA code' });
   }
   ```

4. **Add backup codes**
   ```javascript
   function generateBackupCodes(count = 10) {
     return Array.from({ length: count }, () => 
       crypto.randomBytes(5).toString('hex').toUpperCase()
     );
   }
   ```

#### Acceptance Criteria:
- ✅ TOTP support for authenticator apps
- ✅ MFA enrollment/disrollment in user settings
- ✅ Backup code generation and storage
- ✅ Session remembered for 30 days on trusted devices

---

### 3.2 File Virus Scanning Integration
**Risk:** Low - Malware propagation  
**Location:** File upload endpoints  
**Effort:** 2 days

#### Tasks:
1. **Integrate ClamAV or similar antivirus**
   ```bash
   # Dockerfile addition
   RUN apt-get update && apt-get install -y clamav clamav-daemon
   ```

2. **Create virus scanning service**
   ```javascript
   // server/services/VirusScanner.js
   class VirusScanner {
     static async scanFile(filePath) {
       return new Promise((resolve, reject) => {
         const clamscan = new ClamScan();
         clamscan.scan_file(filePath, (err, result) => {
           if (err) return reject(err);
           resolve({
             clean: !result.is_infected,
             viruses: result.viruses,
           });
         });
       });
     }
   }
   ```

3. **Update file upload processing**
   ```javascript
   // Before processing file
   const scanResult = await VirusScanner.scanFile(tempFilePath);
   if (!scanResult.clean) {
     await fs.unlink(tempFilePath);
     return res.status(400).json({ 
       error: 'File contains malware',
       details: scanResult.viruses 
     });
   }
   ```

4. **Add virus detection logging**
   ```javascript
   // Log to security events
   await AuditLogger.log('virus_detected', {
     filename: file.originalname,
     fileSize: file.size,
     viruses: scanResult.viruses,
     user: req.user.id,
   }, req);
   ```

#### Acceptance Criteria:
- ✅ All uploaded files scanned for viruses
- ✅ Infected files rejected with clear error
- ✅ Virus detections logged to security events
- ✅ Antivirus definitions updated daily

---

### 3.3 Environment Variable Security
**Risk:** Low - Credential exposure  
**Location:** `server/platform/mcpRegistry.js`  
**Effort:** 1 day

#### Tasks:
1. **Implement environment sanitization**
   ```javascript
   function sanitizeEnvironment(extraEnv = {}) {
     const safeVars = [
       'PATH', 'NODE_ENV', 'TZ', 'LANG',
       // Application-specific safe vars
       'WP_URL', 'WP_USER', // WordPress
     ];
     
     const env = {};
     safeVars.forEach(key => {
       if (process.env[key]) env[key] = process.env[key];
     });
     
     // Add explicitly allowed extra env
     Object.assign(env, extraEnv);
     
     return env;
   }
   ```

2. **Update child process creation**
   ```javascript
   const child = spawn(command, args, {
     env: sanitizeEnvironment(server.config?.env),
     // ... other options
   });
   ```

3. **Add environment variable auditing**
   ```javascript
   // Log which env vars are passed to child processes
   await AuditLogger.log('mcp_process_spawn', {
     serverId: server.id,
     command: server.config.command,
     envKeys: Object.keys(sanitizedEnv),
   }, req);
   ```

4. **Implement secret management**
   ```javascript
   // Use AWS Secrets Manager or similar for sensitive credentials
   const { SecretsManager } = require('@aws-sdk/client-secrets-manager');
   const secrets = new SecretsManager();
   ```

#### Acceptance Criteria:
- ✅ Child processes receive only necessary environment variables
- ✅ Sensitive credentials not passed via environment
- ✅ Environment variable usage audited
- ✅ Secret management integration for production

---

## Implementation Guidelines

### Development Workflow
1. **Branch naming:** `security/[issue-number]-[description]`
   - `security/1-input-validation`
   - `security/2-auth-rate-limiting`

2. **Code review requirements:**
   - Security team review for critical issues
   - Two reviewers for moderate issues
   - One reviewer for low issues

3. **Testing requirements:**
   - Unit tests for all security functions
   - Integration tests for security workflows
   - Penetration testing for critical fixes

### Deployment Strategy
1. **Phase 1:** Deploy immediately after testing
2. **Phase 2:** Deploy after Phase 1 stabilization
3. **Phase 3:** Deploy as part of regular release cycle

### Monitoring and Validation
1. **Security metrics:**
   - Failed login attempts
   - Rate-limited requests
   - Virus detections
   - Security events logged

2. **Validation checklist:**
   - [ ] All critical issues addressed
   - [ ] No regression in existing functionality
   - [ ] Security tests passing
   - [ ] Performance impact acceptable

---

## Success Criteria

### Phase 1 Complete:
- ✅ No security vulnerabilities in OWASP Top 10
- ✅ Authentication protected against brute force
- ✅ File uploads secured against malware
- ✅ Input validation prevents injection attacks

### Phase 2 Complete:
- ✅ Comprehensive audit trail
- ✅ Enhanced session security
- ✅ Secure inter-service communication
- ✅ Strong password policies

### Phase 3 Complete:
- ✅ Optional MFA for sensitive accounts
- ✅ Comprehensive virus scanning
- ✅ Secure secret management
- ✅ Defense-in-depth security posture

---

## Resources Required

### Development Resources:
- 1 Senior Backend Developer (4 weeks)
- 1 Security-focused Developer (2 weeks)
- 1 Frontend Developer (1 week)

### Infrastructure:
- ClamAV server/container
- Security monitoring tooling
- Secret management service

### Testing:
- Penetration testing budget
- Security scanning tools
- Load testing for rate limiters

---

## Risk Mitigation

### Technical Risks:
- **Performance impact:** Test rate limiters under load
- **User experience:** Gradual rollout with opt-in for MFA
- **Backward compatibility:** Maintain existing API contracts

### Project Risks:
- **Timeline slippage:** Prioritize critical issues first
- **Scope creep:** Stick to defined phases
- **Testing gaps:** Allocate time for security testing

---

## Next Steps

1. **Immediate:** Review and prioritize this plan with stakeholders
2. **Week 1:** Begin implementation of Phase 1 (Critical issues)
3. **Week 3:** Security review of Phase 1 before deployment
4. **Week 4:** Begin Phase 2 implementation
5. **Week 6:** Complete security hardening
6. **Ongoing:** Regular security reviews and updates

---

*This plan should be reviewed quarterly and updated based on new threats, platform changes, and security audit findings.*