# SPEC — Tender Response Generator
## New Demo Agent for CuramTools Platform
**Pass this document to Claude Code before any implementation work begins.**
**Read DEMO-AGENTS.md, DECISIONS.md, and PLATFORM-PRIMITIVES.md before writing a single line.**

---

## What This Is

A new demo agent that ingests an RFT (Request for Tender) PDF, retrieves a firm's evidence pack from AWS S3, matches requirements to evidence, generates a first-draft compliance response, and gates every output behind a Human-in-the-Loop review step.

This agent follows the existing three-stage pattern established by `spec-validator`. It is a demo-only agent to begin with. Dual-slug registration can be added later.

---

## Slugs

| Slug | Type |
|---|---|
| `demo-tender-response` | Demo (initial build) |
| `tender-response` | Internal (future — do not wire yet) |

---

## File Locations — Follow Platform Conventions Exactly

| File | Location |
|---|---|
| Agent runFn | `server/agents/demoSuite/tenderResponse/index.js` |
| Python compliance checker | `server/agents/demoSuite/tenderResponse/compliance.py` |
| Prompt definitions | `server/agents/demoSuite/tenderResponse/prompt.js` |
| Catalog entry | `server/demo/demoCatalog.js` |
| Agent config entries | `server/platform/AgentConfigService.js` |
| Route registration | `server/routes/agents.js` |
| HITL + S3 endpoints | `server/routes/demo.js` |
| UI page | `client/src/pages/demo/TenderResponseGenerator.jsx` |
| App route | `client/src/App.jsx` → `/demo/run/demo-tender-response` |
| Decision log steps | `client/src/pages/demo/DecisionLogPage.jsx` |

---

## Pipeline — Four Stages

### Stage 1 — RFT Ingestion and Requirement Extraction
**Model:** Vision model (`adminConfig.model`)
**Input:** RFT PDF uploaded as base64, rasterised via Ghostscript (existing pattern — cap 8 pages)
**Output:** Structured JSON list of requirements, each with:
- `requirement_id` (e.g., REQ-001)
- `category` (Certification / Safety / Experience / Technical / Insurance / Environmental / Design)
- `requirement_text`
- `is_mandatory` (boolean — pass/fail gate)
- `evaluation_weight` (percentage if stated in RFT, null if not)

No matching, no drafting, no analysis at this stage. Extraction only.
Log step: `rft_extraction`

---

### Stage 2 — Evidence Retrieval from S3
**Model:** None — deterministic only
**Input:** Requirement list from Stage 1 + org S3 path
**Process:** Python subprocess retrieves the six evidence pack files from S3, parses their content, and runs structured matching logic:
- CSV rules matched by category and keyword
- XLSX project records matched by corrosivity class, ICCP flag, dredging flag, value threshold, year
- Personnel records matched by registration type and project cross-reference
- Certificate records checked for status (CURRENT / RENEWING / EXPIRED) and expiry date against tender close date

**Output per requirement:**
- `match_status`: `STRONG` / `PARTIAL` / `NONE`
- `evidence_ids`: list of matched record IDs (REF-xxx, CRT-xxx, PER-xxx, INS-xxx)
- `match_rationale`: plain text explanation of why this evidence was selected
- `blocker`: boolean — true if mandatory requirement has no match or a RENEWING/EXPIRED certificate

NONE match on a mandatory requirement → blocker flag, no draft generated for that requirement.
RENEWING certificate on a mandatory requirement → blocker flag surfaced in HITL, draft generated with explicit renewal language from Style Guide rules.

This is the stage that makes the system defensible. Python handles all threshold checks (e.g., project value > $5M, certificate not expired). The LLM does not make these determinations.

Log step: `evidence_retrieval`

---

### Stage 3 — Draft Generation
**Model:** Synthesis model resolved from the organisation default, falling back to the already resolved extraction model when needed. Do not hardcode a model ID.
**Input:** Each requirement with STRONG or PARTIAL match + its matched evidence records + Style Guide constraints
**Output per requirement:**
- `draft_response`: a single response paragraph, written in firm voice
- `evidence_citations`: inline evidence IDs used in the draft (e.g., [REF-005], [CRT-004])
- `confidence`: `HIGH` / `MEDIUM` / `LOW` based on match strength and evidence recency

Constraints the prompt must enforce:
- Active voice, metric-first outcomes
- Australian Standards cited as floor not ceiling
- No claim made without a cited evidence ID
- ISO 45001 renewal language used exactly where CRT-003 is the matched certificate
- No content generated for blocker requirements

Log step: `draft_generation`

---

### Stage 4 — Human-in-the-Loop Review
**Model:** None — engineer decision only
**Pattern:** Follows existing HITL pattern from `document-analyzer` and `spec-validator`
**Each requirement block surfaces:**
- Left panel: generated draft response with inline evidence citations
- Right panel: the source evidence record(s) it was drawn from
- Confidence indicator (HIGH / MEDIUM / LOW)
- Blocker flag where applicable (amber for RENEWING, red for NONE)

**Review states:** `pending` / `approved` / `edited` / `rejected`

**Server-side enforcement rules:**
- LOW confidence + approved with no comment → 422
- Blocker requirement approved with no resolution comment → 422
- Rejected requirement permanently blocks certificate

**`edited` state:** When an engineer modifies the draft text before approving, the state is `edited` not `approved`. The audit log stores both the original draft and the edited version. This is a new platform-level HITL state — document it in DECISIONS.md as a reusable capability when it is built, so future agents can adopt the same pattern.

Log step: `review_action` (per PATCH, consistent with existing pattern)

---

## Evidence Pack — S3 Structure

S3 serves two distinct roles in this agent. Both must be understood before building.

### Role 1 — Pre-Loaded Evidence Pack (org-scoped, always present)

The six evidence files are stored in S3 under the org's path before any demo runs. They are loaded once by whoever sets up the demo org and remain in place.

| File | S3 Key |
|---|---|
| `Compliance_Rules_Seed_v2.csv` | `curam-engineering/evidence-pack/compliance-rules.csv` |
| `Voice_of_Firm_Style_Guide.md` | `curam-engineering/evidence-pack/style-guide.md` |
| `Project_Experience_Library_Extended.xlsx` | `curam-engineering/evidence-pack/projects.xlsx` |
| `Personnel_Register.xlsx` | `curam-engineering/evidence-pack/personnel.xlsx` |
| `Certificates_Insurance_Register.xlsx` | `curam-engineering/evidence-pack/certificates.xlsx` |

The agent retrieves these autonomously at run time. The audience does not upload them. This is intentional — the system should appear to already know where the firm's evidence lives, not wait to be hand-fed files it should already have access to.

### Role 2 — Audience Upload Pathway (session-scoped, optional substitution)

The audience can substitute any evidence pack file with their own version for testing. This is the "bring your own documents" capability that makes the demo credible to firms who want to test against their actual data.

**Behaviour:**
- Substituted files are written to a session-scoped S3 path: `curam-engineering/session/<runId>/`
- The agent uses session-scoped files in preference to the org-scoped pack where both exist for the same file type
- Session files are ephemeral — they are not retained after the run completes
- The UI clearly labels which files are org defaults and which are session substitutions

**What the audience can substitute:**
- Any of the three XLSX evidence files (projects, personnel, certificates)
- The compliance rules CSV and style guide MD are platform-controlled for this build and cannot be substituted — document this constraint in DECISIONS.md

### RFT Upload
The RFT PDF is always uploaded by the user at the start of the run — it is never pre-loaded. After the run completes, it is saved to `curam-engineering/rft/<runId>/RFT.pdf` via the existing `save-to-s3` pattern in `demo.js`.

---

## Python Subprocess — compliance.py

Handles all deterministic checks. Must not delegate any of these to the LLM:

- Certificate expiry: compare expiry date against tender close date (hardcode `2026-06-16` for demo; make configurable later)
- Certificate status: CURRENT → pass, RENEWING → amber blocker, EXPIRED → red blocker
- Project value threshold: value field parsed to float, compared against `> 5000000` for mandatory gate
- Project recency: year field compared against `current year - 5` for mandatory gate
- Corrosivity class matching: exact string match on classification field
- ICCP / dredging flags: boolean field check
- RPEQ registration: presence check on registration number field (non-empty, non-placeholder)

Returns structured JSON consumed by Stage 2 matching logic.

Follow the existing subprocess pattern from `spec-validator` exactly:
- `execFileAsync` with `shell: false`
- 30-second timeout
- 10 MB buffer
- `PYTHON_EXEC` env var

Add `openpyxl` and `pandas` to the Dockerfile Python layer for XLSX parsing. Add to existing `pip install` line — do not create a separate layer.

---

## Decision Trace Steps

Register all of the following in `DecisionLogPage.jsx` stepMeta:

| step | Label | highlight |
|---|---|---|
| `rft_extraction` | RFT Requirement Extraction | false |
| `evidence_retrieval` | Evidence Pack Retrieval | true |
| `compliance_check` | Deterministic Compliance Check | true |
| `model_selection` | Extraction Model | true |
| `synthesis_model_selection` | Draft Generation Model | true |
| `draft_generation` | Draft Response Generation | false |
| `review_action` | Engineer Review Decision | false |
| `blocker_flagged` | Compliance Blocker Identified | true |

---

## UI — TenderResponseGenerator.jsx

### Processing Modal Stages

```
Stage 1 — Parsing RFT        "Vision model extracts requirements from the tender document."
Stage 2 — Retrieving Evidence "Python retrieves and matches your evidence pack from S3."
Stage 3 — Generating Drafts  "Synthesis model drafts responses grounded in matched evidence."
```

Estimated duration label: `"Typical processing time: 3–5 minutes."`

### Pre-Run — Evidence Pack Browser

Displayed before the RFT is uploaded and the run starts. This is the first thing the audience sees when they arrive at the page.

Shows the current evidence pack as a file tree, sourced from the org-scoped S3 path. Each file entry shows:
- File name and type icon
- Last modified date
- A badge: `org default` (pre-loaded) or `session file` (audience-substituted)
- An upload control to substitute the file with their own version for testing

This panel makes the repository visible and tangible before any processing begins. The audience can see exactly what the system is working from and optionally replace any of the three XLSX files with their own. The compliance rules CSV and style guide MD are shown as read-only — no upload control, a tooltip explains they are platform-controlled for this build.

### Results Display

Four panels, in sequence after processing:

**Panel 1 — Coverage Report**
Traffic-light summary before any draft is shown:
- Green: requirement matched, draft ready for review
- Amber: partial match or RENEWING certificate — HITL decision required
- Red: no match found — blocker, no draft generated

This is the first results panel the engineer sees. It answers "what can we respond to and what can't we" before a single draft is read.

**Panel 2 — HITL Review Interface**
One card per requirement. Left/right split as described in pipeline Stage 4. Engineer works through cards sequentially. Progress indicator shows X of Y reviewed.

**Panel 3 — Output Summary**
Available only when all non-blocker requirements are reviewed and none are rejected.
Shows: requirements responded to, requirements blocked, evidence records used, engineer decisions logged.
Certificate export gate follows existing pattern — all reviewed, none rejected.

### Model Display
Show both models used (extraction and synthesis) in the UI header, consistent with existing two-model display pattern in other demo agents.

---

## SSE Progress Strings — Server Emits

```
Stage 1: running RFT extraction…
Stage 1 complete — extracted N requirements.
Stage 2: retrieving evidence pack from S3…
Stage 2: running deterministic compliance checks…
Stage 2 complete — N matched, N partial, N blocked.
Stage 3: generating draft responses…
Stage 3 complete.
```

---

## Demo Org Provisioning — SQL

```sql
-- Run in Admin > SQL Console after agent is deployed
INSERT INTO org_agent_manifest (org_id, slug, enabled, is_configured, sort_order)
VALUES (<curam_org_id>, 'demo-tender-response', true, true, 2);
```

Sort order 2 assumes document-analyzer (0) and spec-validator (1) are already assigned.

---

## Known Constraints and Edge Cases

These are intentional behaviours, not bugs. Do not smooth them over:

| Scenario | Expected Behaviour |
|---|---|
| ISO 45001 (CRT-003) status = RENEWING | Amber blocker. Draft generated using renewal language. Engineer must comment before approving. |
| REF-002 cited for C5-M requirement | Should not match — REF-002 is C4 Marine. Python matching must use exact corrosivity class string. |
| REF-007 ($3.2M) cited for >$5M mandatory gate | Must not satisfy the gate. Python threshold check blocks it. |
| PER-006 described as team member | Prompt must use "subconsultant" — sourced from Personnel Register notes field. |
| Mandatory requirement with no evidence match | Red blocker. No draft. Cannot be approved. Permanently blocks certificate. |

---

## What This Agent Demonstrates to the Client

In order of importance for the demo audience:

1. **The system refuses to fabricate** — blocked requirements surface as gaps, not confident wrong answers
2. **Deterministic checks are not AI** — Python decides compliance thresholds, not the LLM
3. **Every claim is traceable** — evidence IDs in every draft, source document shown alongside
4. **The engineer stays in control** — nothing leaves the system without explicit sign-off
5. **Model switching is visible** — two models shown, both logged, both swappable via admin config
6. **The repository is searched, not hand-fed** — evidence retrieved from S3 autonomously after RFT upload

---

## What to Read Before Starting

In this order:

1. `DEMO-AGENTS.md` — platform patterns, constraints, checklist
2. `DECISIONS.md` — non-obvious prior decisions that must not be re-litigated
3. `PLATFORM-PRIMITIVES.md` — shared services and how to call them
4. `Evidence_Pack_Overview.md` — what each of the six evidence files contains and how they relate
5. `Curam_Engineering_Scenario_Document.md` — the business context this agent is demonstrating

Do not start writing code until you have read all five.

---

## Out of Scope for This Build

- Full tender document assembly (the agent drafts responses per requirement — it does not produce a formatted submission-ready Word or PDF document)
- Real SharePoint or Azure Blob integration (S3 only for this build)
- Internal slug (`tender-response`) wiring — demo slug only
- Multi-RFT comparison
- Scoring or ranking of response quality

---

*Add DECISIONS.md entry for the `edited` HITL state before closing the first session.*
*Add CHANGELOG.md session entry on completion.*
