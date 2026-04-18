# MCP CuramTools — Project Identity

## What this project IS

- **Internal learning project** for a single organisation (Blue Lily)
- **Solo developer** context — built and maintained by one person
- **Invite‑only users** — all users are known colleagues/manual invites
- **Not a public SaaS** — no anonymous signup, no payment processing
- **Not a commercial product** — no revenue generation, no customer support team
- **Railway‑hosted personal deployment** — single instance for the organisation's use

## What this project is NOT

- A multi‑tenant SaaS platform
- A publicly accessible web service (invite‑only, behind login)
- A revenue‑generating product
- A project with dedicated security resources or penetration testing budget
- A team‑maintained application with separate DevOps/SRE staff
- An open‑source project expecting external contributors

## Security context

**Threat model:** Internal misuse, not external attackers. The primary risks are:
- Accidental data exposure between users within the same org
- Rate‑limit exhaustion by a legitimate user
- Child processes inheriting sensitive environment variables
- Credential stuffing against the login endpoint (invite‑only doesn't mean immune)

**Not in scope:**
- Advanced persistent threats (APTs) or nation‑state actors
- DDoS protection beyond basic rate limiting
- Penetration testing beyond manual code review
- Compliance certifications (SOC2, ISO27001, etc.)
- Security monitoring/SIEM integration

**Appropriate security measures** (as implemented):
- Organisational isolation (`org_id` on every table)
- BCrypt password hashing (12 rounds)
- Helmet.js with sensible CSP
- Parameterized queries (SQL injection protection)
- Basic rate limiting on agent endpoints
- Railway environment variables for secrets

## Development & maintenance context

- **One person** maintains everything: code, deployment, database, monitoring
- **Learning focus** — the project explores AI agent patterns, MCP servers, and platform primitives
- **Documentation‑driven** — all decisions and patterns are captured in Markdown files
- **Zero‑budget** for external services beyond Railway hosting and AI API costs
- **Time‑constrained** — features are implemented as needed, not as comprehensive product releases

## Implications for contributions & AI sessions

When reviewing code or suggesting changes:

1. **Assume solo‑developer constraints** — no "security team review", no "dedicated QA"
2. **Prioritise simplicity** over enterprise‑grade completeness
3. **Railway‑native solutions** over AWS/GCP enterprise services
4. **Incremental improvements** over wholesale rewrites
5. **Context‑aware security** — the three legitimate gaps (auth rate limiting, scoped env for stdio, account lockout) matter; ClamAV and AWS Secrets Manager do not

## Success metrics

The project is successful when:
- The organisation's team can use AI‑powered tools for their work
- The solo developer learns and applies new patterns
- Monthly AI costs stay within expected bounds
- No security incidents occur from the actual threat model (internal misuse)
- The codebase remains maintainable by one person

## If this changes

If the project ever becomes:
- Publicly accessible
- Multi‑tenant
- Revenue‑generating
- Team‑maintained

...then this identity document must be updated first, and all security/architecture assumptions re‑evaluated.

---

*This document was created on 2026‑04‑16 after a security review mistakenly assumed public SaaS context. It exists to prevent similar misunderstandings by future readers (human or AI).*