# Tender Response Generator — Scenario Document
## Curam Engineering
**Document Purpose: Internal reference for consultant. Not for distribution.**
**Version 1.0 | May 2026**

---

## 1. What This Document Is

This is a thinking document. It describes the business problem being solved, the scenario being demonstrated, and the system being built — in plain language, before any slide is designed or any code is shown to a client.

Its secondary purpose is to serve as the source material for a slide deck. Every section here maps to a slide or a slide group. Nothing should appear in the slide deck that isn't grounded here first.

---

## 2. The Business Problem

Engineering firms that pursue public and private sector contracts must respond to Requests for Tender (RFTs). This is expensive, slow, and inconsistent.

A typical tender response for a mid-sized infrastructure project requires:
- Reading and interpreting a complex technical specification
- Identifying every mandatory requirement and evaluation criterion
- Retrieving relevant past project experience from institutional memory
- Drafting technically credible responses across multiple volumes
- Verifying that every claim made is supported by documentary evidence
- Ensuring compliance with Australian Standards, state regulations, and client-specific requirements

In most engineering firms this process is handled by a senior engineer or bid manager working largely from memory and a folder of past submissions. The result is responses that are:
- **Inconsistent** — different authors produce different quality across tenders
- **Slow** — a meaningful response takes days, not hours
- **Risky** — claims are made that cannot always be evidenced if challenged
- **Expensive** — senior engineering time is the firm's most valuable resource

The problem is not that engineers can't write good tender responses. The problem is that the process of finding, verifying, and assembling the right evidence is manual, repetitive, and time-consuming.

---

## 3. The Scenario

### 3.1 The Firm
**Curam Engineering** is a fictitious but representative mid-sized Queensland engineering firm. For the purposes of this demo, they specialise in marine and civil infrastructure. They employ 70+ staff, are led by engineers who have grown into management roles, and pursue a steady pipeline of public sector contracts.

This firm is not chosen because marine infrastructure is unique. It is chosen because marine RFTs are technically demanding enough to make the demo credible, and familiar enough to any infrastructure engineer that they can immediately assess whether the output is accurate.

### 3.2 The Trigger Event
Curam Engineering receives **RFT-2026-045** from the Port of Brisbane: a tender for the design, supply, and construction of Berth 4 and 5 rehabilitation works, valued at approximately $15–25M. Closing date is 16 June 2026 — five weeks away.

The RFT requires:
- Three mandatory pass/fail certifications (ISO 9001, 14001, 45001 and PQC Level 2+)
- Demonstrated C5-M marine corrosion environment experience
- A named RPEQ-registered structural engineer
- Three reference projects with verified client contacts
- A marine-specific WHS plan and environmental management plan
- A Level 3 construction programme
- Responses across four submission volumes

This is a real workload. In the current manual process, a firm like Curam would spend 3–5 days of senior engineering time assembling a compliant first draft.

### 3.3 The Proposed Solution
The Tender Response Generator is an AI-assisted application that compresses that process. It does not replace the engineer. It does the retrieval, matching, and first-draft generation — and then hands control to the engineer for review, correction, and sign-off before anything leaves the firm.

The engineer remains accountable. The system makes them faster and more consistent.

---

## 4. What the System Does — In Plain Language

The system works in four stages. Each stage is visible to the user.

### Stage 1 — Ingest and Parse
The engineer uploads the RFT document. The system reads it and extracts every requirement: mandatory gates, evaluation criteria, technical standards referenced, and submission deliverables. These are displayed as a structured requirement list — not buried in the original PDF.

This stage uses the LLM to interpret natural language requirements. It does not guess. Where a requirement is ambiguous, it flags it for human review rather than assuming an interpretation.

### Stage 2 — Match Requirements to Evidence
The system searches the firm's evidence pack — past projects, personnel records, certifications, insurance — and matches each requirement to the best available evidence.

This matching is transparent. For every requirement, the system shows:
- Which evidence record it matched to
- Why it matched (the specific fields that triggered the match)
- A confidence indicator (strong match, partial match, no match found)

A **no match** does not generate a response. It generates a blocker that the engineer must resolve — either by providing alternative evidence or by acknowledging the gap before submission.

This is the most important design decision in the system. It is what separates a useful tool from a liability.

### Stage 3 — Draft Generation
For requirements with matched evidence, the system generates a first-draft response paragraph. The draft:
- Is written in the firm's established voice and tone (defined in the Style Guide)
- Cites the evidence source inline (e.g., REF-005, CRT-003, PER-002)
- Conforms to Australian engineering terminology and Queensland regulatory references
- Frames Australian Standards as a baseline, not an achievement

The draft is explicitly a first draft. It is presented to the engineer alongside the source evidence, not as a finished product.

### Stage 4 — Human-in-the-Loop Review
The engineer sees a split-screen interface:
- **Left panel**: the generated draft response
- **Right panel**: the source evidence it was drawn from

The engineer can approve, edit, or reject each response block. Every decision is logged — what was approved, what was changed, and what was rejected. This log is the audit trail.

Nothing proceeds to the final document until the engineer has made an explicit decision on every block.

---

## 5. What Makes This Different from Asking ChatGPT

This is the question any sceptical engineer will ask. The answer has four parts.

**Grounded in your data, not general knowledge.**
The system does not generate responses from what an LLM knows about marine engineering in general. It generates responses from **Curam Engineering's** specific verified evidence — projects, people, and certifications in the evidence pack. If the evidence doesn't exist in the library, the claim doesn't get made.

**Deterministic where it matters.**
Compliance checking — does a certificate exist, is it current, does a project value meet the mandatory threshold — is handled by rule-based logic and Python, not by the LLM. The LLM writes prose. It does not decide whether ISO 45001 is current. A structured data check does that.

**Every claim is traceable.**
Every sentence in the generated draft carries an evidence ID. The engineer can see, for every claim, exactly which document it came from. This is the audit trail that makes the output defensible — to a client, to a regulator, or to a partner firm.

**Model-agnostic.**
The system is not locked to a single LLM provider. It can run on Anthropic Claude, OpenAI GPT, or Azure OpenAI — which matters for firms that are already committed to a particular cloud environment. For an Azure house, this means the system can be deployed within their existing Azure infrastructure, keeping tender data inside their own environment.

---

## 6. Addressing the Two Primary Objections

### 6.1 Security — "Where Does Our Data Go?"

This is the first question any commercial firm will ask, and it deserves a direct answer before they ask it.

**In the demo:** Data passes through the Anthropic API. This is disclosed upfront. The demo uses synthetic data under the **Curam Engineering** brand — so no real client firm data is ever used during demonstration.

**In a production deployment:** The system is designed to run against Azure OpenAI, which means:
- Data stays within the firm's Azure tenancy
- No data is used to train external models
- Access controls, audit logging, and data residency are all managed within the firm's existing Azure governance framework
- This is the same infrastructure their engineers already use for other business applications

The security conversation is not a blocker. It is a deployment configuration decision.

### 6.2 Accuracy — "What If It Gets Something Wrong?"

This is the more important objection, and it is the one the system is specifically designed to address.

The risk of an AI tender tool is not that it produces bad prose. It is that it produces a confident, well-written claim that is factually wrong — and that claim makes it into a submitted tender.

The system addresses this at three points:

**Point 1 — Evidence-gated generation.** The LLM cannot generate a claim that doesn't have a verified evidence record behind it. No evidence, no claim. The system surfaces a gap, not a fabrication.

**Point 2 — Deterministic compliance checks.** Pass/fail gate requirements (certifications, project values, mandatory thresholds) are checked against structured data — not interpreted by the LLM. If ISO 45001 is in renewal, the system flags it as RENEWING, not CURRENT. This is not an AI judgment. It is a data check.

**Point 3 — Human sign-off on every block.** Nothing leaves the system without an engineer's explicit approval. The HITL interface is not a formality — it is a mandatory step. The audit log records who approved what and when. The engineer's professional accountability is preserved.

The system makes engineers faster. It does not make decisions for them.

---

## 7. The Evidence Pack — What the System Runs On

The demo uses six files representing a complete but minimal evidence pack. In a real deployment for Curam Engineering, these files would be populated from the firm's actual records.

| File | Layer | What It Provides |
|---|---|---|
| RFT-2026-045 (PDF) | Demand | The requirement set — what must be answered |
| Compliance_Rules_Seed_v2.csv | Logic | Pre-validated requirement-to-evidence mappings and pass/fail gate rules |
| Voice_of_Firm_Style_Guide.md | Logic | Approved claims, prohibited claims, writing rules, tone by volume |
| Project_Experience_Library_Extended.xlsx | Evidence | 8 verified projects with metadata for retrieval and matching |
| Personnel_Register.xlsx | Evidence | 8 named personnel with qualifications, registration numbers, and project history |
| Certificates_Insurance_Register.xlsx | Evidence | ISO certifications, PQC prequalification, RPEQ registrations, insurance policies |

The evidence pack is the firm's institutional memory in structured form. Building it is a one-time effort. Maintaining it is a per-tender update. Every subsequent tender draws from the same library, improving in quality as more projects are added.

---

## 8. What the Demo Shows

The demo is structured around a single scenario: Curam Engineering responding to RFT-2026-045.

The walkthrough follows this sequence:

1. **Upload the RFT** — the system parses it and displays the extracted requirement list
2. **Run the compliance check** — the system checks mandatory gates and displays a traffic-light status (green/amber/red) for each
3. **Show a gap** — ISO 45001 is flagged amber (renewal in progress); the system surfaces this as a HITL decision point rather than generating a non-compliant claim
4. **Run evidence matching** — the system matches C5-M experience requirements to REF-001, REF-004, REF-005, REF-006 and displays the match rationale
5. **Generate a draft response** — the system produces a paragraph for the C5-M criterion, citing specific projects and outcomes
6. **Show the HITL interface** — the engineer sees the draft on the left and the source evidence on the right; they approve, edit, or reject
7. **Show the audit log** — every decision, every token call, every agent switch is recorded
8. **Demonstrate model switching** — show the same request run against a different LLM to illustrate provider independence

The demo does not attempt to show a complete tender response. It shows one criterion, end to end, with full transparency. That is enough.

---

## 9. What This Is Not

It is important to be honest about scope, especially with a technically sophisticated audience.

**This is not a tender automation system.** It does not produce a submission-ready document. It produces a verified, engineer-reviewed first draft that still requires professional judgment, formatting, and sign-off.

**This is not a compliance guarantee.** The system reduces the risk of non-compliant claims. It does not eliminate it. The engineer remains the responsible professional.

**This is not a black box.** Every step is logged, every source is cited, every decision is recorded. If a claim is challenged post-submission, the audit trail shows exactly where it came from and who approved it.

**This is not a finished product.** The demo is a proof of concept built to mirror a scenario Curam Engineering would recognise. A production deployment would require integration with their actual document management systems, population of their real evidence library, and configuration to their Azure environment.

---

## 10. The Conversation This Is Designed to Start

The goal of the demo is not to sell a product. It is to open a specific conversation:

*"Your firm spends significant senior engineering time on tender responses that follow a largely repeatable pattern. We can build a system that handles the retrieval, matching, and first-draft generation — grounded in your own verified data, running inside your Azure environment, with every claim traceable and every decision logged. The engineer stays in control. The process gets faster and more consistent."*

The next step is not a proposal. It is a conversation about what their current process actually looks like — how many tenders per year, who does the work, where the pain is sharpest — so that a scoped proposal can be built around their specific situation.

---

## 11. Open Questions Before the Demo

These are unresolved assumptions that need to be either confirmed or deliberately set aside before the slide deck is built:

| Question | Why It Matters |
|---|---|
| Does Curam use a document management system (SharePoint, Teams)? | Determines how the evidence pack would be maintained in production |
| How many tenders do they submit per year? | Frames the ROI conversation |
| Do they have a dedicated bid manager or is it done by project engineers? | Changes who the primary user of the system is |
| Are they already using any AI tools internally? | Sets the baseline for the "what's different" conversation |
| What is their Azure licensing level? | Determines whether Azure OpenAI is readily available or a new cost |
| Who in the room has sign-off authority for a pilot engagement? | Determines the call to action at the end of the meeting |

---

*This document is the consultant's working reference. It should be updated after the demo meeting with what was learned.*
*Next output from this document: slide deck structure and speaker notes.*
