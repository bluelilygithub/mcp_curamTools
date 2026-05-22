# Tender Response Generator — Evidence Pack Overview
**Curam Engineering**
**Project: RFT-2026-045 | Port of Brisbane — Berth 4 & 5 Rehabilitation**
**Document Version: 1.0 | May 2026**

---

## Purpose of This Document

This document describes the six-file evidence pack that forms the data foundation of the Tender Response Generator. It records what each file contains, why it exists, and how the files relate to one another. It is intended for anyone building, maintaining, or demoing the agent — not for submission to the client.

---

## Architecture Overview

The six files divide into three functional layers:

```
┌─────────────────────────────────────────────────────┐
│  DEMAND LAYER                                       │
│  What the RFP requires                              │
│  └── RFT-2026-045_Marine_Infrastructure.pdf         │
└─────────────────────────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────┐
│  LOGIC LAYER                                        │
│  Rules for matching requirements to evidence        │
│  └── Compliance_Rules_Seed_v2.csv                   │
│  └── Voice_of_Firm_Style_Guide.md                   │
└─────────────────────────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────┐
│  EVIDENCE LAYER                                     │
│  Verified facts the agent draws claims from         │
│  └── Project_Experience_Library_Extended.xlsx       │
│  └── Personnel_Register.xlsx                        │
│  └── Certificates_Insurance_Register.xlsx           │
└─────────────────────────────────────────────────────┘
```

The agent reads the Demand Layer to understand what is required, applies the Logic Layer to determine what can be claimed and how it should be written, and retrieves from the Evidence Layer to populate and verify every claim.

---

## File 1 — RFT-2026-045_Marine_Infrastructure.pdf

### What It Contains
The Port of Brisbane's full Request for Tender document for the Berth 4 and 5 Rehabilitation project. It is a five-page document covering:
- Scope of works (piles, fender systems, ICCP, dredging, bollards, coatings)
- Mandatory compliance standards (AS 3600, AS 4997, AS 2159, AS 2832.1)
- Weighted evaluation criteria across six categories totalling 100%
- Three pass/fail mandatory eligibility requirements (ISO certifications, PQC Level 2+, maritime project >$5M)
- Required submission volumes (1–4) and lodgement instructions

### Purpose
This is the sole input to the Demand Layer. The agent parses this document first, extracting every "shall", "must", and mandatory requirement before any other processing begins. It is also the document against which all generated response content is validated.

### Relationships
- Drives the requirement list that the **Compliance Rules Seed** maps against
- Every evaluation criterion in this document has a corresponding evidence pathway through the **Project Library**, **Personnel Register**, and **Certificates Register**
- The submission volume structure (Vol 1–4) referenced in the **Style Guide** tone table is drawn directly from this document

---

## File 2 — Compliance_Rules_Seed_v2.csv

### What It Contains
Fifteen structured rules, each mapping a specific RFP clause requirement to a pre-approved standard response and evidence reference. Fields include:
- **Rule ID** — unique identifier
- **Category** — Certification, Safety, Environmental, Design, Experience, Insurance, Quality, Technical
- **RFP Clause Requirement** — the verbatim or paraphrased requirement from the RFT
- **Standard Response / Evidence Mapping** — the approved response text, including named evidence sources (REF-xxx, CRT-xxx, PER-xxx, INS-xxx)

Key rules cover the three mandatory pass/fail gates (Rules 1–3 for ISO certifications, Rule 5 for PQC), RPEQ requirements (Rule 7, citing RPEQ No. 21453), C5-M experience (Rule 9, citing four verified projects), and technical methodology (Rules 14–15).

### Purpose
This is the agent's primary matching engine input. Rather than asking the LLM to interpret the RFP from scratch, the Compliance Rules provide pre-validated requirement-to-response mappings that the agent uses as its first-pass draft anchors. It also functions as the pass/fail gate checker — any Rule ID marked as mandatory that cannot be satisfied by the evidence layer triggers a no-go flag in the HITL interface.

### Relationships
- References requirements extracted from the **RFT document**
- Response text cites evidence IDs (REF, CRT, PER, INS) that resolve to records in the **Project Library**, **Certificates Register**, and **Personnel Register**
- The **Style Guide** governs how the standard response text should be expanded and written when the agent drafts full paragraphs
- v2 supersedes the original `Compliance_Rules_Seed.csv` — three errors were corrected: ISO 45001 renewal language (Rule 3), RPEQ placeholder removed (Rule 7), and Gladstone incorrectly classified as C5-M corrected to cite four actual C5-M projects (Rule 9)

---

## File 3 — Project_Experience_Library_Extended.xlsx

### What It Contains
Eight verified project references (REF-001 to REF-008) forming the firm's retrievable evidence corpus for past work. Each record contains:
- Project ID, name, client, and client contact details
- Location, contract value, and year of completion
- Corrosivity classification (C3 Moderate / C4 Marine / C5-M Marine)
- Boolean flags for ICCP installed and dredging included
- Full project description and key outcomes with specific metrics
- Claimability status (all eight marked Approved)

REF-001 to REF-004 were carried over from the original library. REF-005 to REF-008 are new entries added to fill scope gaps identified in the RFT: ICCP retrofit (Mackay, REF-005), combined ICCP and dredging (Darwin, REF-006), bollard installation (Cairns, REF-007), and maintenance dredging with turbidity SEMP (Rockhampton, REF-008).

### Purpose
This is the primary retrieval corpus for the Evidence Layer. When the agent needs to substantiate an experience claim — particularly the 15%-weighted C5-M criterion and the mandatory >$5M maritime project gate — it retrieves from this library. The structured metadata fields (corrosivity class, ICCP flag, dredging flag) are designed to support both keyword matching and, if implemented, semantic similarity search.

### Relationships
- Supersedes both `Firm_Evidence_Library_Formatted.xlsx` and `Project_Experience_Reference_Library.xlsx` — the original two files contained identical data in slightly different schemas; both are now retired
- Evidence IDs (REF-xxx) are cited directly in the **Compliance Rules Seed** response mappings
- Personnel in the **Personnel Register** reference these project IDs in their "Key Relevant Projects" field, creating a bidirectional link between people and projects
- The **Style Guide** Approved Claims table cites specific REF IDs as the source for pre-cleared statements

---

## File 4 — Personnel_Register.xlsx

### What It Contains
Eight named personnel records (PER-001 to PER-008) covering the proposed project team. Each record contains:
- Personnel ID, full name, and role on this tender
- Qualifications and registration/licence details with real registration numbers
- Years of experience and key relevant project IDs (cross-referenced to the Project Library)
- Availability percentage and location
- Claimability status and notes

Key personnel include the Project Director (PER-001, RPEQ No. 18274), the Lead Structural Engineer and primary RPEQ signatory (PER-002, RPEQ No. 21453), the ICCP Specialist (PER-006, NACE CP-SPEC-7743), and the Lead Commercial Diver (PER-008, ADAS Part 3). One person (PER-006, Dr. Forsyth) is flagged as a subconsultant at 60% availability.

### Purpose
This file directly supports the 15%-weighted "key personnel and resourcing capacity" evaluation criterion. It also provides the RPEQ registration detail required as a mandatory submission in Volume 3, replacing the `Reg No. XXXXX` placeholder that existed in the original Compliance Rules. In the HITL interface, when the agent proposes a personnel claim, this register is the right-hand verification panel source.

### Relationships
- Personnel project references (column "Key Relevant Projects") link to **Project Library** REF IDs — PER-006 specifically references REF-001, REF-004, REF-005, and REF-006 following a correction made during pack assembly
- RPEQ numbers for PER-001 and PER-002 are duplicated in the **Certificates Register** (CRT-005, CRT-006) to provide a single-source verification point for the Volume 4 compliance submission
- The **Style Guide** evidence citation format (Section 6) governs how personnel are named in generated responses — always with Personnel ID and registration number inline

---

## File 5 — Certificates_Insurance_Register.xlsx

### What It Contains
Two sheets covering all mandatory compliance credentials:

**Sheet 1 — ISO & Prequalification (8 records, CRT-001 to CRT-008):**
Covers the three ISO management system certifications (9001, 14001, 45001), QLD PQC Level 3 prequalification, two RPEQ registrations, NACE cathodic protection specialist accreditation, and ADAS commercial diving supervisor licence. Each record includes the issuing body, certificate number, issue and expiry dates, current status, and the Volume 4 attachment filename it maps to. ISO 45001 (CRT-003) is intentionally flagged `RENEWING` — its expiry was 21 June 2025 and renewal was lodged 2 May 2026 — representing a realistic edge case for the HITL review interface.

**Sheet 2 — Insurance (5 records, INS-001 to INS-005):**
Covers Public Liability ($20M), Professional Indemnity ($10M), Workers Compensation, Marine Contractors All Risk ($30M), and Commercial Motor. Each record includes the insurer, policy number, cover limit, excess, and policy period.

### Purpose
This file is the evidence source for all three mandatory pass/fail gate requirements in the RFT. The agent checks this register before generating any compliance volume content — if a mandatory certificate is missing, expired, or flagged RENEWING without an interim certificate reference, the HITL interface surfaces a blocker rather than generating a response that papers over the gap. The `RENEWING` status on CRT-003 is the primary demo moment for this behaviour.

### Relationships
- CRT-001 to CRT-004 directly satisfy Rules 1, 2, 3, and 5 in the **Compliance Rules Seed**
- CRT-005 and CRT-006 (RPEQ registrations) cross-reference PER-001 and PER-002 in the **Personnel Register** — same registration numbers appear in both files
- INS-001 and INS-002 satisfy Rules 11 and 12 in the **Compliance Rules Seed**
- Attachment references (e.g., `Vol4_ISO9001.pdf`) map to the submission volume structure defined in the **RFT document**
- The **Style Guide** Prohibited Claims section (Section 5) explicitly flags that ISO 45001 must never be described as "current" — this prohibition is anchored in CRT-003's RENEWING status

---

## File 6 — Voice_of_Firm_Style_Guide.md

### What It Contains
A structured writing and constraint guide for the LLM generation layer, covering:
- **Firm identity statement** — who Curam Engineering is and how that should be evident in every response
- **Non-negotiable writing rules** — active voice, metric-first outcomes, standards as floor not ceiling, specific safety language, Queensland orientation
- **Sentence and paragraph style** — length limits, tense rules, terminology (Australian, not US)
- **Approved Claims table** — ten pre-cleared factual statements with source citations (REF, CRT, INS, PER IDs)
- **Prohibited Claims table** — six categories of statements that must not appear without explicit sign-off, including the ISO 45001 renewal constraint
- **Evidence citation format** — the inline `[REF-xxx]` and `(PER-xxx)` format that makes every generated claim traceable
- **Volume-specific tone guidance** — different register for each of the four submission volumes
- **Evaluator psychology notes** — how port authority evaluators read, to calibrate what the agent emphasises

### Purpose
This is the generation constraint layer. Without it, the LLM produces confident-sounding but generic boilerplate indistinguishable from any other firm's tender response. The Style Guide does two things simultaneously: it tells the agent *what* it is allowed to claim (Approved Claims, sourced to the evidence files), and it tells the agent *what it cannot claim* without triggering a HITL flag (Prohibited Claims). It is the document that transforms a capable LLM into a firm-specific, evidence-grounded drafting tool.

### Relationships
- The Approved Claims table (Section 4) is entirely sourced from the three Evidence Layer files — every claim maps to a specific REF, CRT, INS, or PER ID
- The Prohibited Claims table (Section 5) is anchored in known evidence gaps or legal risks — specifically CRT-003's RENEWING status, which is referenced explicitly
- The Volume tone table (Section 7) maps directly to the four submission volumes defined in the **RFT document**
- The evidence citation format (Section 6) defines the link syntax that connects generated response text back to the **Project Library**, **Personnel Register**, and **Certificates Register** for HITL verification

---

## Cross-Reference Summary

| Evidence ID | File | Referenced In |
|---|---|---|
| REF-001 to REF-008 | Project Library | Compliance Rules (Rules 8–10), Personnel Register (Key Projects), Style Guide (Approved Claims) |
| PER-001 to PER-008 | Personnel Register | Compliance Rules (Rule 7), Certificates Register (CRT-005, CRT-006), Style Guide (Approved Claims) |
| CRT-001 to CRT-008 | Certificates Register | Compliance Rules (Rules 1–3, 5), Style Guide (Approved Claims, Prohibited Claims) |
| INS-001 to INS-005 | Certificates Register | Compliance Rules (Rules 11–12), Style Guide (Approved Claims) |
| Vol 1–4 references | RFT Document | Style Guide (Volume tone table), Certificates Register (Attach Ref column) |

---

## Known Edge Cases for Demo

| Scenario | File | Field | Demo Behaviour |
|---|---|---|---|
| ISO 45001 renewal | Certificates Register | CRT-003 Status = RENEWING | Agent should surface a HITL flag, not generate a "current certification" claim |
| Gladstone (REF-002) is C4, not C5-M | Project Library | Corrosivity Class = C4 Marine | Agent should not cite REF-002 as C5-M evidence; four correct C5-M projects are REF-001, 004, 005, 006 |
| Dr. Forsyth is a subconsultant | Personnel Register | PER-006 Notes | Agent should qualify his involvement — "subconsultant" not "team member" |
| REF-007 value is $3.2M | Project Library | Value = $3,200,000 | Does not satisfy the mandatory >$5M gate on its own; must not be cited as the primary experience reference |

---

*Maintained by: Priya Nair (PER-007) | Approved by: James Whitfield (PER-001)*
*Next review: Prior to any new tender submission using this evidence pack*
