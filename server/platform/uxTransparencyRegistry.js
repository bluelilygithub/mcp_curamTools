'use strict';

const FEATURE_DEFINITIONS = [
  { id: 'streaming_progress', label: 'Streaming Progress' },
  { id: 'saved_history', label: 'Saved History' },
  { id: 'run_deep_link', label: 'Run ID / Deep Link' },
  { id: 'evidence_panel', label: 'Evidence / Source Panel' },
  { id: 'data_gap_panel', label: 'Data Gaps' },
  { id: 'bounds_review', label: 'Bounds / Review Warnings' },
  { id: 'follow_up_grounding', label: 'Grounded Follow-Up' },
  { id: 'export_support', label: 'Export Support' },
  { id: 'human_review', label: 'Human Review' },
  { id: 'dependency_visibility', label: 'Dependency Visibility' },
  { id: 'workflow_visibility', label: 'Workflow Visibility' },
];

const DEFAULT_UX_TRANSPARENCY = {
  label: 'Standard Agent Surface',
  summary: 'No explicit UX transparency contract has been declared for this agent.',
  userSurface: null,
  adminSurface: '/admin/operations',
  features: {},
};

const GOOGLE_ADS_CARD_FEATURES = {
  streaming_progress: 'covered',
  saved_history: 'covered',
  run_deep_link: 'covered',
  evidence_panel: 'partial',
  data_gap_panel: 'covered',
  bounds_review: 'covered',
  follow_up_grounding: 'missing',
  export_support: 'missing',
  human_review: 'missing',
  dependency_visibility: 'partial',
  workflow_visibility: 'missing',
};

const UX_TRANSPARENCY_CONTRACTS = {
  'google-ads-monitor': {
    label: 'Google Ads Monitor Card',
    summary: 'Dashboard card with streaming progress, run history, result rendering, data gaps, and bounds warnings.',
    userSurface: '/tools/google-ads-monitor',
    adminSurface: '/admin/agent-trust',
    features: GOOGLE_ADS_CARD_FEATURES,
  },
  'google-ads-freeform': {
    label: 'Google Ads Freeform Card',
    summary: 'Dashboard card with streaming progress, run history, markdown result rendering, and trust panels.',
    userSurface: '/tools/google-ads-monitor',
    adminSurface: '/admin/agent-trust',
    features: GOOGLE_ADS_CARD_FEATURES,
  },
  'google-ads-change-impact': {
    label: 'Google Ads Change Impact Card',
    summary: 'Dashboard card with streaming progress, run history, markdown result rendering, and trust panels.',
    userSurface: '/tools/google-ads-monitor',
    adminSurface: '/admin/agent-trust',
    features: GOOGLE_ADS_CARD_FEATURES,
  },
  'google-ads-change-audit': {
    label: 'Google Ads Change Audit Card',
    summary: 'Dashboard card with streaming progress, run history, markdown result rendering, and trust panels.',
    userSurface: '/tools/google-ads-monitor',
    adminSurface: '/admin/agent-trust',
    features: GOOGLE_ADS_CARD_FEATURES,
  },
  'ads-copy-diagnostic': {
    label: 'Ads Copy Diagnostic',
    summary: 'First report in the copy workflow, visible through the Google Ads dashboard and Agent Trust.',
    userSurface: '/tools/google-ads-monitor',
    adminSurface: '/admin/agent-trust',
    features: {
      ...GOOGLE_ADS_CARD_FEATURES,
      dependency_visibility: 'missing',
    },
  },
  'ads-copy-playbook': {
    label: 'Ads Copy Playbook',
    summary: 'Chained copy report with upstream dependency visibility in the operator card and Agent Trust.',
    userSurface: '/tools/google-ads-monitor',
    adminSurface: '/admin/agent-trust',
    features: {
      ...GOOGLE_ADS_CARD_FEATURES,
      dependency_visibility: 'covered',
    },
  },
  'ads-copy-gate': {
    label: 'Ads Copy Gate',
    summary: 'Chained gate report with upstream dependency visibility in the operator card and Agent Trust.',
    userSurface: '/tools/google-ads-monitor',
    adminSurface: '/admin/agent-trust',
    features: {
      ...GOOGLE_ADS_CARD_FEATURES,
      dependency_visibility: 'covered',
    },
  },
  'keyword-opportunity': {
    label: 'Keyword Opportunity',
    summary: 'Dashboard report with streaming progress and result history; evidence is summarised rather than inspectable source-by-source.',
    userSurface: '/tools/google-ads-monitor',
    adminSurface: '/admin/agent-trust',
    features: GOOGLE_ADS_CARD_FEATURES,
  },
  'not-interested-report': {
    label: 'Not Interested Report',
    summary: 'Tool page presents operational progress and strategic output, with CRM privacy coverage handled server-side.',
    userSurface: '/tools/not-interested-report',
    adminSurface: '/admin/operations',
    features: {
      streaming_progress: 'covered',
      saved_history: 'partial',
      run_deep_link: 'partial',
      evidence_panel: 'partial',
      data_gap_panel: 'missing',
      bounds_review: 'missing',
      follow_up_grounding: 'missing',
      export_support: 'missing',
      human_review: 'missing',
      dependency_visibility: 'missing',
      workflow_visibility: 'missing',
    },
  },
  'high-intent-advisor': {
    label: 'High Intent Advisor',
    summary: 'Suggestion workflow with visible progress and suggestion history, but limited run-level evidence inspection.',
    userSurface: '/tools/high-intent-advisor',
    adminSurface: '/admin/operations',
    features: {
      streaming_progress: 'covered',
      saved_history: 'covered',
      run_deep_link: 'missing',
      evidence_panel: 'partial',
      data_gap_panel: 'missing',
      bounds_review: 'missing',
      follow_up_grounding: 'missing',
      export_support: 'missing',
      human_review: 'partial',
      dependency_visibility: 'missing',
      workflow_visibility: 'missing',
    },
  },
  'doc-extractor': {
    label: 'Document Extractor',
    summary: 'Extraction flow with upload limits, history, extraction privacy, and structured field output.',
    userSurface: '/tools/doc-extractor',
    adminSurface: '/admin/operations',
    features: {
      streaming_progress: 'partial',
      saved_history: 'covered',
      run_deep_link: 'partial',
      evidence_panel: 'partial',
      data_gap_panel: 'missing',
      bounds_review: 'missing',
      follow_up_grounding: 'missing',
      export_support: 'partial',
      human_review: 'missing',
      dependency_visibility: 'missing',
      workflow_visibility: 'missing',
    },
  },
  'demo-document-analyzer': {
    label: 'Document Analyzer',
    summary: 'Document review flow with processing modal, decision log deep links, follow-up questions, review actions, and export.',
    userSurface: '/demo/run/demo-document-analyzer',
    adminSurface: '/admin/agent-trust',
    features: {
      streaming_progress: 'covered',
      saved_history: 'covered',
      run_deep_link: 'covered',
      evidence_panel: 'covered',
      data_gap_panel: 'partial',
      bounds_review: 'covered',
      follow_up_grounding: 'covered',
      export_support: 'covered',
      human_review: 'covered',
      dependency_visibility: 'missing',
      workflow_visibility: 'missing',
    },
  },
  'spec-validator': {
    label: 'Spec Validator',
    summary: 'Hybrid engineering validation UI with staged progress, deterministic evidence, human review, export gate, and workflow visibility.',
    userSurface: '/tools/spec-validator',
    adminSurface: '/admin/agent-trust',
    features: {
      streaming_progress: 'covered',
      saved_history: 'covered',
      run_deep_link: 'covered',
      evidence_panel: 'covered',
      data_gap_panel: 'partial',
      bounds_review: 'covered',
      follow_up_grounding: 'covered',
      export_support: 'covered',
      human_review: 'covered',
      dependency_visibility: 'missing',
      workflow_visibility: 'covered',
    },
  },
  'demo-spec-validator': {
    aliasOf: 'spec-validator',
    label: 'Demo Spec Validator',
    userSurface: '/demo/run/demo-spec-validator',
  },
  'demo-tender-response': {
    label: 'Tender Response Generator',
    summary: 'Hybrid tender workflow with staged processing, evidence matching, human review closure, and workflow visibility.',
    userSurface: '/demo/run/demo-tender-response',
    adminSurface: '/admin/agent-trust',
    features: {
      streaming_progress: 'covered',
      saved_history: 'covered',
      run_deep_link: 'covered',
      evidence_panel: 'covered',
      data_gap_panel: 'partial',
      bounds_review: 'covered',
      follow_up_grounding: 'missing',
      export_support: 'partial',
      human_review: 'covered',
      dependency_visibility: 'missing',
      workflow_visibility: 'covered',
    },
  },
  'wp-theme-extractor': {
    label: 'WordPress Theme Extractor',
    summary: 'Theme extraction flow with progress, file outputs, and run history, but limited review/evidence panels.',
    userSurface: '/tools/wp-theme-extractor',
    adminSurface: '/admin/operations',
    features: {
      streaming_progress: 'covered',
      saved_history: 'covered',
      run_deep_link: 'partial',
      evidence_panel: 'partial',
      data_gap_panel: 'missing',
      bounds_review: 'missing',
      follow_up_grounding: 'missing',
      export_support: 'covered',
      human_review: 'missing',
      dependency_visibility: 'missing',
      workflow_visibility: 'missing',
    },
  },
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function resolveUxTransparencyContract(slug) {
  const local = UX_TRANSPARENCY_CONTRACTS[slug];
  if (!local) return { ...clone(DEFAULT_UX_TRANSPARENCY), slug };

  const base = local.aliasOf
    ? { ...clone(UX_TRANSPARENCY_CONTRACTS[local.aliasOf] ?? DEFAULT_UX_TRANSPARENCY), ...local }
    : clone(local);

  delete base.aliasOf;
  return {
    ...base,
    slug,
    features: {
      ...(local.aliasOf ? UX_TRANSPARENCY_CONTRACTS[local.aliasOf]?.features ?? {} : {}),
      ...(local.features ?? {}),
    },
  };
}

function summariseUxTransparency(contract) {
  if (!contract) return null;
  const features = FEATURE_DEFINITIONS.map((feature) => ({
    ...feature,
    status: contract.features?.[feature.id] ?? 'missing',
  }));
  const covered = features.filter((feature) => feature.status === 'covered').length;
  const partial = features.filter((feature) => feature.status === 'partial').length;
  const score = Math.round(((covered + partial * 0.5) / features.length) * 100);
  const status = score >= 75 ? 'strong' : score >= 40 ? 'partial' : 'thin';

  return {
    slug: contract.slug,
    label: contract.label,
    summary: contract.summary,
    userSurface: contract.userSurface ?? null,
    adminSurface: contract.adminSurface ?? null,
    score,
    status,
    covered,
    partial,
    missing: features.length - covered - partial,
    features,
  };
}

module.exports = {
  FEATURE_DEFINITIONS,
  UX_TRANSPARENCY_CONTRACTS,
  resolveUxTransparencyContract,
  summariseUxTransparency,
};
