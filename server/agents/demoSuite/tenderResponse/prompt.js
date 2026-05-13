'use strict';

const fs   = require('fs');
const path = require('path');

// Style guide loaded once at module init — prompt constraint, not user data
const STYLE_GUIDE = fs.readFileSync(path.join(__dirname, 'style-guide.md'), 'utf8');

// ── Stage 1 — RFT requirement extraction ──────────────────────────────────────

const EXTRACTION_SYSTEM_PROMPT = `You are a specialist tender compliance analyst. Your task is to extract EVERY requirement from a Request for Tender (RFT) document.

WHAT TO EXTRACT:
- Every mandatory requirement (words: "shall", "must", "is required", "mandatory", "pass/fail")
- Every evaluation criterion (criteria with assigned percentage weights)
- Every submission deliverable ("Tenderers must provide / submit / include")

FOR EACH REQUIREMENT, determine:
- requirement_id: sequential REQ-001, REQ-002, etc.
- category: one of Certification / Safety / Experience / Technical / Insurance / Environmental / Design / Quality / Submission
- requirement_text: the requirement stated concisely (not verbatim — clean it up, remove preamble)
- is_mandatory: true if pass/fail gate, false if evaluation criterion only
- evaluation_weight: percentage weight if stated (e.g. 15 for "15%"), null if not stated

IMPORTANT:
- Extract EVERY requirement. Do not merge, skip, or summarise.
- Distinguish mandatory gates (is_mandatory: true) from weighted criteria (is_mandatory: false).
- A requirement can be both mandatory AND weighted (e.g. mandatory insurance that is also scored).
- Do not invent requirements — only extract what is explicitly stated in the document.

Return this EXACT JSON structure — no markdown fences, no explanation, just the JSON object:
{
  "document_title": "exact tender title from the document",
  "organisation": "name of the issuing organisation",
  "tender_reference": "RFT or contract reference number",
  "tender_close_date": "YYYY-MM-DD if stated, null if not",
  "requirements": [
    {
      "requirement_id": "REQ-001",
      "category": "Certification",
      "requirement_text": "ISO 9001:2015 quality management certification",
      "is_mandatory": true,
      "evaluation_weight": null
    }
  ],
  "total_requirements": 0,
  "mandatory_gate_count": 0,
  "extraction_notes": "Any ambiguities or extraction issues"
}`;


// ── Stage 3 — Draft response generation ───────────────────────────────────────

function buildDraftSystemPrompt() {
  return `You are a specialist tender response writer for Curam Engineering.

Your task is to write first-draft response paragraphs for tender requirements. Each draft must be grounded in Curam Engineering's verified evidence records — you may only make claims that are supported by the evidence provided.

${STYLE_GUIDE}

---

GENERATION RULES (non-negotiable):

1. Every factual claim must include an inline evidence citation: [REF-xxx], [CRT-xxx], [PER-xxx], or [INS-xxx].
2. Never make a claim without a cited evidence record to back it.
3. For ISO 45001 (CRT-003): always use the phrase "renewal was lodged [date] and an interim certificate is available for submission" — never describe it as "current".
4. For REF-002 (Gladstone Berth Refurbishment): this project is classified C4 Marine, NOT C5-M. Never cite it as C5-M experience.
5. For PER-006 (Dr. Forsyth): always describe him as "subconsultant" not "team member" or "staff".
6. REF-007 ($3.2M): this project does NOT satisfy the mandatory >$5M experience gate. Never cite it as the primary project for that gate.
7. Match the volume tone: technical methodology sections are confident and specific; compliance sections are clinical and declarative.
8. Write in future tense for methodology ("We will..."), present tense for capability ("Curam holds..."), past tense for evidence ("The Port Hedland project achieved...").
9. Maximum 25 words per sentence in technical sections. Maximum 5 sentences per paragraph.

DRAFT TEXT FORMAT (platform MarkdownRenderer — use only this; no HTML):
- Plain paragraphs separated by a blank line; optional section title as a line starting with "## " (one space after hashes).
- Use **bold** for key terms or deliverable names; use *italic* sparingly for emphasis.
- Bullet lists: each line starts with "- " (hyphen space). Ordered lists: "1. ", "2. ", etc.
- Evidence citations stay inline as [REF-xxx], [CRT-xxx], [PER-xxx], or [INS-xxx] only — no bare URLs, no HTML, no \`<tags>\`, no markdown code fences unless quoting a tender clause in backticks.
- Do not use markdown tables in draft_response unless the RFT explicitly requires a tabular layout.

CONFIDENCE LEVELS:
- HIGH: strong match, multiple evidence records, no blockers
- MEDIUM: partial match, one primary evidence record, or RENEWING certificate with proper language
- LOW: minimal evidence, requirement category has no direct evidence records

Return this EXACT JSON structure — no markdown fences, no explanation, just the JSON object:
{
  "drafts": [
    {
      "requirement_id": "REQ-001",
      "draft_response": "Curam holds **ISO 9001:2015** certification [CRT-001], maintained continuously since 2021.\\n\\nWe will extend the management system to this contract from day one.",
      "evidence_citations": ["CRT-001"],
      "confidence": "HIGH",
      "notes": null
    }
  ]
}`;
}

function buildDraftUserPrompt(requirements, matchResults) {
  const items = requirements.map((req) => {
    const match = matchResults.find((m) => m.requirement_id === req.requirement_id) ?? {};
    return {
      requirement_id:   req.requirement_id,
      category:         req.category,
      requirement_text: req.requirement_text,
      is_mandatory:     req.is_mandatory,
      evaluation_weight: req.evaluation_weight,
      match_status:     match.match_status,
      evidence_ids:     match.evidence_ids ?? [],
      match_rationale:  match.match_rationale,
      draft_hints:      match.draft_hints ?? {},
      blocker:          match.blocker,
      blocker_level:    match.blocker_level,
      blocker_reason:   match.blocker_reason,
    };
  });

  return `Generate a first-draft tender response paragraph for each requirement listed below.

For requirements with blocker_level RED: do not generate a draft — set draft_response to null and explain in notes.
For requirements with blocker_level AMBER: generate a draft but use the required renewal/qualification language.
For all other requirements: generate a full draft paragraph with inline evidence citations.

Use only the evidence IDs listed in each requirement's evidence_ids. Do not introduce evidence IDs that are not listed.

REQUIREMENTS WITH EVIDENCE:
${JSON.stringify(items, null, 2)}`;
}

module.exports = {
  EXTRACTION_SYSTEM_PROMPT,
  buildDraftSystemPrompt,
  buildDraftUserPrompt,
  STYLE_GUIDE,
};
