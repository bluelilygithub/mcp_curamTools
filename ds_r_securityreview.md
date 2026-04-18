# MCP CuramTools - Security Review Findings

**Project Context:** This security review was conducted before the project's identity was documented. See [PROJECT_IDENTITY.md](./PROJECT_IDENTITY.md) for the actual context: internal learning project for one organisation, solo developer. This review assumes a public SaaS threat model; the actual threat model is internal misuse only.

**Date:** 2026-04-16  
**Reviewer:** AI Assistant (based on code review of actual implementation)  
**Scope:** Backend security controls, authentication, authorization, input validation, and system security

## Executive Summary

This security review examines the actual implementation of MCP CuramTools, contrasting documented architectural decisions with code-level security controls. While the platform demonstrates strong architectural security foundations (org isolation, single write paths, permission services), several critical web application security controls are missing or incomplete.

**Overall Risk Assessment:** **Medium-High**  
The platform is suitable for controlled environments but requires security hardening before handling highly sensitive data in production.

---

## Security Architecture Strengths

### 1. **Organizational Isolation** ✅
- `org_id` always sourced from verified session context (`req.user.org_id`)
- Never from user-supplied request data (body, params, query)
- Database queries consistently include `WHERE org_id = $1` predicates

### 2. **Authentication Foundation** ✅
- BCrypt password hashing (12 rounds)
- Secure session tokens (32-byte hex, 7-day TTL)
- Password reset with time-limited tokens and invalidation
- Protection against email enumeration in forgot-password flow

### 3. **Permission Model** ✅
- Single source of truth (`PermissionService.js`)
- Default-deny posture with deny-wins resolution
- Role-based access control with global and scoped permissions

### 4. **Platform Security Patterns** ✅
- Single write paths (`persistRun`, `UsageLogger`)
- Budget enforcement integrated into agent execution
- SQL injection prevention via parameterized queries

### 5. **Basic Security Headers** ✅
- Helmet.js with custom CSP configuration
- CORS restricted to allowed origins
- JSON body parsing with size limits

---

## Critical Security Gaps

### 1. **Insufficient Input Validation**
- **Location:** All API endpoints, MCP tool parameters
- **Risk:** High - Injection attacks, data corruption
- **Evidence:** No schema validation library (Joi, Zod, etc.)
- **Impact:** Potential for NoSQL/command injection via malformed JSON

### 2. **Unsafe Stdio Process Execution**
- **Location:** `server/platform/mcpRegistry.js` (`_connectStdio`)
- **Risk:** Critical - Remote code execution
- **Evidence:** `config.command` used directly in `spawn()` without validation
- **Impact:** Compromised MCP server config could execute arbitrary commands

### 3. **Missing Authentication Rate Limiting**
- **Location:** `server/routes/auth.js` (login, register, password reset)
- **Risk:** High - Account enumeration, credential stuffing
- **Evidence:** No rate limiting on authentication endpoints
- **Impact:** Brute force attacks on user accounts

### 4. **Insecure File Upload Handling**
- **Location:** `server/routes/docExtractor.js`
- **Risk:** High - Malware distribution, memory exhaustion
- **Evidence:** Files stored in memory (`multer.memoryStorage`)
- **Impact:** DoS via large files, malware propagation

---

## Moderate Security Concerns

### 5. **Weak Session Management**
- **Location:** `server/routes/auth.js`
- **Risk:** Moderate - Session hijacking, fixation
- **Evidence:** No session timeout beyond 7-day TTL, no concurrent session control
- **Impact:** Extended exposure window for stolen session tokens

### 6. **Inadequate Transport Security**
- **Location:** `server/platform/mcpRegistry.js` (`_connectSSE`)
- **Risk:** Moderate - Man-in-the-middle attacks
- **Evidence:** No certificate validation for SSE connections
- **Impact:** Interception of sensitive MCP server communications

### 7. **Missing Security Audit Logging**
- **Location:** Platform-wide
- **Risk:** Moderate - Lack of forensic capability
- **Evidence:** No logging of admin actions, role changes, MCP server registration
- **Impact:** Inability to investigate security incidents

### 8. **Password Policy Weaknesses**
- **Location:** `server/routes/auth.js`
- **Risk:** Moderate - Credential compromise
- **Evidence:** Only 8-character minimum, no complexity requirements
- **Impact:** Weak passwords susceptible to brute force

---

## Low-Level Security Issues

### 9. **Incomplete Error Handling**
- **Location:** Multiple files
- **Risk:** Low - Information leakage
- **Evidence:** `console.error` used instead of structured logger in some places
- **Impact:** Stack traces may leak implementation details

### 10. **Missing Multi-Factor Authentication**
- **Location:** Authentication system
- **Risk:** Low - Account takeover
- **Evidence:** No MFA support implemented
- **Impact:** Single factor authentication for sensitive accounts

### 11. **Environment Variable Leakage**
- **Location:** `server/platform/mcpRegistry.js`
- **Risk:** Low - Credential exposure
- **Evidence:** Child processes inherit full environment
- **Impact:** Sensitive env vars accessible to MCP servers

### 12. **No File Virus Scanning**
- **Location:** File upload endpoints
- **Risk:** Low - Malware propagation
- **Evidence:** No virus/malware scanning for uploaded files
- **Impact:** Platform could be used to distribute malware

---

## Code Review vs Documentation Discrepancies

| Security Control | Documented in MDs | Actually Implemented | Gap |
|-----------------|-------------------|---------------------|-----|
| Org Isolation | ✅ | ✅ | None |
| Single Write Paths | ✅ | ✅ | None |
| Budget Enforcement | ✅ | ✅ | None |
| Rate Limiting | ❌ | ⚠️ (partial) | Missing on auth endpoints |
| Input Validation | ❌ | ❌ | No framework |
| Process Security | ❌ | ⚠️ (basic) | No sandboxing |
| File Upload Security | ❌ | ⚠️ (basic) | No virus scanning |

**Key Finding:** Documentation accurately describes architectural security but omits implementation-level security controls.

---

## Risk Assessment Matrix

| Issue | Likelihood | Impact | Overall Risk |
|-------|------------|--------|--------------|
| Unsafe Stdio Execution | Medium | Critical | **High** |
| Missing Input Validation | High | High | **High** |
| No Auth Rate Limiting | High | Medium | **High** |
| Insecure File Uploads | Medium | High | **High** |
| Weak Session Management | Medium | Medium | **Moderate** |
| Missing Transport Security | Medium | Medium | **Moderate** |
| No Security Audit Logs | High | Low | **Moderate** |
| Weak Password Policy | High | Low | **Moderate** |
| No MFA | Low | Medium | **Low** |
| Environment Leakage | Low | Low | **Low** |

---

## Platform Security Posture Summary

### **Defense-in-Depth Assessment:**
1. **Prevention:** Strong (org isolation, permissions, SQL injection prevention)
2. **Detection:** Weak (limited logging, no monitoring)
3. **Response:** Weak (no incident response procedures)
4. **Recovery:** Unknown (no documented backup/restore)

### **Positive Indicators:**
- Thoughtful architectural security decisions
- Consistent use of security patterns
- Proper separation of concerns
- Budget-aware execution controls

### **Negative Indicators:**
- Missing basic web security controls
- Insufficient input validation
- Process isolation vulnerabilities
- Inadequate authentication security

---

## Recommendations Priority

### **Immediate Action Required (1-2 weeks):**
1. Implement comprehensive input validation framework
2. Add rate limiting to authentication endpoints
3. Secure stdio process execution with sandboxing
4. Implement file upload security controls

### **Short-Term Improvements (1 month):**
5. Enhance session security with timeouts and controls
6. Add security audit logging for admin actions
7. Implement transport security for MCP connections
8. Strengthen password policy requirements

### **Long-Term Enhancements (3+ months):**
9. Implement multi-factor authentication
10. Add file virus scanning capability
11. Establish security monitoring and alerting
12. Conduct regular security penetration testing

---

## Conclusion

MCP CuramTools demonstrates **strong architectural security** but suffers from **weak implementation security**. The platform is built on sound security principles (least privilege, defense in depth, org isolation) but lacks critical web application security controls.

**Production Readiness:** Not recommended for handling sensitive data without addressing critical issues.

**Next Steps:** Implement the security plan outlined in `ds_r_securityplan.md` to address identified gaps before production deployment with sensitive business data.

---

*This review is based on automated code analysis and should be supplemented with manual penetration testing before production deployment.*