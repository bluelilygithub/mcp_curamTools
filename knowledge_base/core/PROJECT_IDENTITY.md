# MCP CuramTools — Project Identity

## What this project IS

- **Internal learning project** operated by **Blue Lily** (solo developer, maintainer of the repo)
- **Two product applications** on one deployment today — see [APPS.md](../architecture/APPS.md):
  - **Diamond Plate** — marketing/Ads/CRM tools for Diamond Plate Australia (`org_type = internal`)
  - **Engineering** — AEC demo agents for client demo orgs (`org_type = demo`, e.g. Curam Engineering)
- **Core platform** — shared agent runtime, MCP, auth, memory, models (documented in APPS.md)
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

**Evolution:** Security and operational controls are **not frozen** at the threat model described above. As usage and exposure change, controls (rate limits, auth hardening, data boundaries, dependency updates) should be **reviewed and tightened incrementally** — still proportionate to context, but not treated as permanently “good enough” by default.

## Development & maintenance context

- **One person** maintains everything: code, deployment, database, monitoring
- **Learning focus** — the project explores AI agent patterns, MCP servers, and platform primitives
- **Documentation‑driven** — all decisions and patterns are captured in Markdown files
- **Zero‑budget** for external services beyond Railway hosting and AI API costs
- **Time‑constrained** — features are implemented as needed, not as comprehensive product releases

## Product norms: prompts, LLM display, and reports

The platform treats **how people enter instructions**, **how model output is shown**, and **how artefacts are saved or shared** as cross-cutting product decisions — not something each tool reinvents.

1. **Prompt and instruction fields (including voice)**  
   Optional free-text fields before a run, follow-up questions, and HITL edit areas use the same **textarea** styling (rounded corners, platform colour tokens). Where dictation helps, **`MicButton`** is anchored **inside** the field (bottom-right), wired through **`useSpeechInput`**, with transcript **append** semantics — copy the pattern from **`DocumentAnalyzer.jsx`** or **`TenderResponseGenerator.jsx`**. Do not add bespoke `SpeechRecognition` code on feature pages.

2. **Formatted responses from the LLM**  
   User-visible prose that can carry structure (lists, emphasis, headings, tables) is rendered with **`MarkdownRenderer`** using the **`text=`** prop. Server-side prompts should steer models toward **markdown the renderer supports** so layout stays consistent. Avoid `<pre>` or `whitespace-pre-wrap` for normal assistant output. When a run carries soft warnings (bounds, compliance caveats), place **`BoundsWarningPanel`** above the markdown block where that pattern already applies.

3. **Reports, exports, and getting back to a run**  
   Printable or emailable deliverables go through **`exportService`** (`exportPdf`, `fetchPdfBlob` for preview, `exportText` for plain files) and the shared **`POST /api/export/pdf`** pipeline. Demo email uses org-scoped **`POST /api/demo/runs/:runId/...`** routes (e.g. certificate vs tender draft) so attachments never leave the owning org. Prefer the **preview (eye) → download → mail** control cluster when several actions exist. Saved work lives in **`agent_runs`**; surfaces **recent runs**, **`?runId=`** deep links, and **`DecisionLogPage`** are the standard ways to return to a report.

**Authoritative checklist for demo pages:** [DEMO-AGENTS.md](../../DEMO-AGENTS.md) — section *Standard demo UI: prompts, formatted LLM output, and reports*. **Primitive reference:** [PLATFORM-PRIMITIVES.md](../../PLATFORM-PRIMITIVES.md) (`MarkdownRenderer`, `MicButton`, `exportService`, voice hooks).

## Quality gate — golden-path smoke

Changes that touch the **shared agent/PDF spine** can break many demos at once. **Before you treat such a change as done**, run **`npm test`** from the **repository root** (after `cd server && npm install`). That command runs the golden-path smoke: it loads **`markdownPdfBuffer`**, the **`export`** route, **`createAgentRoute`**, validates the **tender** agent file with `node --check`, and (when Chromium is installed) renders a minimal markdown→PDF. It does **not** call live agents or external APIs.

**Run it whenever you modify:** `server/services/markdownPdfBuffer.js`, `server/routes/export.js`, `server/platform/createAgentRoute.js`, `server/platform/AgentScheduler.js`, `server/platform/promptVersions.js`, or `server/agents/demoSuite/tenderResponse/index.js` — and **before merging** work that substantially refactors any of those paths.

Details: [scripts/smoke/README.md](../../scripts/smoke/README.md); demo author checklist: [DEMO-AGENTS.md](../../DEMO-AGENTS.md) (*Golden-path smoke*).

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
