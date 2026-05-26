'use strict';

const DEFAULT_WORKFLOW_CONTRACT = {
  type: 'standard_agent',
  label: 'Standard Agent Run',
  purpose: 'Runs through the shared agent route factory with platform guardrails.',
  stages: [],
  gates: [],
};

const WORKFLOW_CONTRACTS = {
  'spec-validator': {
    type: 'hybrid_ai_deterministic_review',
    label: 'Hydraulic Spec Validator',
    purpose: 'Verifies hydraulic calculation documents with AI extraction, deterministic Python calculations, AI synthesis, and human review before certificate export.',
    deterministicAuthority: 'Python hydraulic calculator is authoritative for quantitative verification.',
    stages: [
      {
        id: 'input_sanitisation',
        label: 'Input Sanitisation',
        kind: 'deterministic_gate',
        actor: 'code',
        required: true,
        blocksOnFailure: true,
        output: 'Clean PDF metadata and file hash.',
      },
      {
        id: 'vision_extraction',
        label: 'Vision Extraction',
        kind: 'ai_extraction',
        actor: 'model',
        required: true,
        blocksOnFailure: true,
        output: 'Structured pipe segments, pressure system, and stated assumptions.',
      },
      {
        id: 'python_calculation',
        label: 'Deterministic Calculation',
        kind: 'deterministic_validation',
        actor: 'python',
        required: true,
        blocksOnFailure: true,
        output: 'PASS/WARNING/FAIL results with formulas, working, standards, and library versions.',
      },
      {
        id: 'synthesis',
        label: 'Finding Synthesis',
        kind: 'ai_synthesis',
        actor: 'model',
        required: true,
        blocksOnFailure: true,
        output: 'Plain-language explanations and probabilistic engineering findings.',
      },
      {
        id: 'human_review',
        label: 'Human Review',
        kind: 'human_review',
        actor: 'reviewer',
        required: true,
        blocksOnFailure: false,
        output: 'Approved, rejected, or resubmit decisions for non-PASS findings.',
      },
    ],
    gates: [
      {
        id: 'certificate_export',
        label: 'Certificate Export Gate',
        condition: 'All findings reviewed; no pending_review, rejected, or resubmit findings remain.',
        blocks: ['export_pdf', 'email_certificate'],
      },
    ],
  },
  'demo-spec-validator': {
    aliasOf: 'spec-validator',
    label: 'Demo Hydraulic Spec Validator',
  },
  'demo-tender-response': {
    type: 'hybrid_ai_deterministic_review',
    label: 'Tender Response Generator',
    purpose: 'Extracts tender requirements, validates evidence through deterministic compliance checks, drafts responses from evidence, and requires human review closure.',
    deterministicAuthority: 'Python compliance checker is authoritative for evidence matching, blockers, and requirement status.',
    stages: [
      {
        id: 'rft_extraction',
        label: 'RFT Requirement Extraction',
        kind: 'ai_extraction',
        actor: 'model',
        required: true,
        blocksOnFailure: true,
        output: 'Structured mandatory gates and evaluation criteria.',
      },
      {
        id: 'evidence_retrieval',
        label: 'Evidence Retrieval',
        kind: 'deterministic_input',
        actor: 'code',
        required: true,
        blocksOnFailure: true,
        output: 'Evidence pack files and their source labels.',
      },
      {
        id: 'compliance_check',
        label: 'Deterministic Compliance Check',
        kind: 'deterministic_validation',
        actor: 'python',
        required: true,
        blocksOnFailure: true,
        output: 'STRONG/PARTIAL/NONE matches, blocker flags, and evidence IDs.',
      },
      {
        id: 'draft_generation',
        label: 'Evidence-Grounded Drafting',
        kind: 'ai_synthesis',
        actor: 'model',
        required: false,
        blocksOnFailure: false,
        output: 'Draft responses for non-RED-blocked matched requirements.',
      },
      {
        id: 'human_review',
        label: 'Tender Review Closure',
        kind: 'human_review',
        actor: 'reviewer',
        required: true,
        blocksOnFailure: false,
        output: 'Approved, edited, rejected, or blocked requirement decisions.',
      },
    ],
    gates: [
      {
        id: 'review_phase_close',
        label: 'Review Phase Closure',
        condition: 'Every actionable requirement is approved or rejected; no pending or edited rows remain.',
        blocks: ['final_submission_pack'],
      },
    ],
  },
};

function cloneContract(contract) {
  return JSON.parse(JSON.stringify(contract));
}

function resolveWorkflowContract(slug, override = null) {
  if (override === false) return null;

  const local = WORKFLOW_CONTRACTS[slug];
  if (!local && !override) return null;

  const base = local?.aliasOf
    ? { ...cloneContract(WORKFLOW_CONTRACTS[local.aliasOf] ?? DEFAULT_WORKFLOW_CONTRACT), ...local }
    : cloneContract(local ?? DEFAULT_WORKFLOW_CONTRACT);

  delete base.aliasOf;

  return {
    ...base,
    ...(override ?? {}),
    slug,
    stages: override?.stages ?? base.stages ?? [],
    gates: override?.gates ?? base.gates ?? [],
  };
}

function summariseWorkflowContract(contract) {
  if (!contract) return null;
  return {
    slug: contract.slug,
    type: contract.type,
    label: contract.label,
    purpose: contract.purpose,
    deterministicAuthority: contract.deterministicAuthority ?? null,
    stage_count: contract.stages?.length ?? 0,
    gate_count: contract.gates?.length ?? 0,
    stages: contract.stages ?? [],
    gates: contract.gates ?? [],
  };
}

module.exports = {
  WORKFLOW_CONTRACTS,
  resolveWorkflowContract,
  summariseWorkflowContract,
};
