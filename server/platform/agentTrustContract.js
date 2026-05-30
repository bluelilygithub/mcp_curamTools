'use strict';

const DEFAULT_TRUST_CONTRACT = {
  requiresDataGaps: true,
  dataGapSourceIds: [],
  dependencies: [],
};

const AGENT_TRUST_CONTRACTS = {
  'ads-copy-diagnostic': {
    dataGapSourceIds: [
      'adGroupAds',
      'assetPerformance',
      'adGroupPerformance',
      'searchTermsByAdGroup',
      'qualityScores',
      'landingPagePerformance',
      'paidBouncedSessions',
    ],
  },
  'ads-copy-playbook': {
    dataGapSourceIds: [
      'diagnosticResult',
      'adGroupAds',
      'assetPerformance',
      'searchTermsByAdGroup',
      'qualityScores',
    ],
    dependencies: [
      {
        slug: 'ads-copy-diagnostic',
        label: 'Copy Diagnostic',
        required: true,
        maxAgeDays: 7,
        allowedStatuses: ['complete', 'needs_review'],
        usage: 'confirmed diagnostic input',
      },
    ],
  },
  'ads-copy-gate': {
    dataGapSourceIds: ['playbookResult', 'diagnosticResult'],
    dependencies: [
      {
        slug: 'ads-copy-playbook',
        label: 'Copy Playbook',
        required: true,
        maxAgeDays: 7,
        allowedStatuses: ['complete', 'needs_review'],
        usage: 'primary gated playbook',
      },
      {
        slug: 'ads-copy-diagnostic',
        label: 'Copy Diagnostic',
        required: true,
        maxAgeDays: 14,
        allowedStatuses: ['complete', 'needs_review'],
        usage: 'supporting diagnostic context',
      },
    ],
  },
  'google-ads-monitor': {
    dataGapSourceIds: [
      'campaignPerformance',
      'dailyPerformance',
      'searchTerms',
      'activeKeywords',
      'sessionsOverview',
    ],
  },
  'keyword-opportunity': {
    dataGapSourceIds: [
      'activeKeywords',
      'negativeKeywords',
      'keywordIdeas',
      'searchTerms',
      'campaignPerformance',
      'trafficSources',
      'enquiries',
      'competitorResearch',
    ],
  },
  'ai-visibility-monitor': {
    dataGapSourceIds: [
      'monitoringPrompts',
      'promptResults',
      'webSearchResults',
      'citedUrls',
    ],
  },
  // Investigation agent uses Investigation Log / Dead Ends / Open Threads instead of Data Gaps.
  // Section validation is done in the agent's runFn via boundsFailed.
  'anomaly-investigator': {
    requiresDataGaps: false,
    dataGapSourceIds: [],
  },
};

function cloneDependencies(dependencies = []) {
  return dependencies.map((dependency) => ({
    ...dependency,
    allowedStatuses: dependency.allowedStatuses ?? ['complete', 'needs_review'],
    stalePolicy: dependency.stalePolicy ?? 'warn',
    reviewPolicy: dependency.reviewPolicy ?? 'warn',
  }));
}

function resolveTrustContract(slug, override = {}) {
  if (override === false) {
    return {
      ...DEFAULT_TRUST_CONTRACT,
      requiresDataGaps: false,
      dependencies: [],
    };
  }

  const agentContract = AGENT_TRUST_CONTRACTS[slug] ?? {};
  const merged = {
    ...DEFAULT_TRUST_CONTRACT,
    ...agentContract,
    ...(override ?? {}),
  };

  return {
    ...merged,
    dataGapSourceIds: [
      ...(override?.dataGapSourceIds ?? agentContract.dataGapSourceIds ?? DEFAULT_TRUST_CONTRACT.dataGapSourceIds),
    ],
    dependencies: cloneDependencies(
      override?.dependencies ?? agentContract.dependencies ?? DEFAULT_TRUST_CONTRACT.dependencies
    ),
  };
}

function getReportDependenciesForAgent(slug) {
  return cloneDependencies(AGENT_TRUST_CONTRACTS[slug]?.dependencies ?? []);
}

function summariseTrustContract(contract = DEFAULT_TRUST_CONTRACT) {
  return {
    requires_data_gaps: contract.requiresDataGaps !== false,
    data_gap_source_ids: contract.dataGapSourceIds ?? [],
    dependency_count: contract.dependencies?.length ?? 0,
    dependency_contract: cloneDependencies(contract.dependencies ?? []).map((dependency) => ({
      slug: dependency.slug,
      label: dependency.label,
      required: dependency.required !== false,
      maxAgeDays: dependency.maxAgeDays ?? null,
      allowedStatuses: dependency.allowedStatuses,
      stalePolicy: dependency.stalePolicy,
      reviewPolicy: dependency.reviewPolicy,
      usage: dependency.usage ?? null,
    })),
  };
}

function buildTrustPromptContext(contract) {
  if (contract?.requiresDataGaps === false) return '';

  const sourceLine = contract?.dataGapSourceIds?.length
    ? `Use only these source IDs when naming gaps: ${contract.dataGapSourceIds.map((id) => `\`${id}\``).join(', ')}.`
    : 'Use the clearest source IDs available from tool names, dependency labels, uploaded files, API datasets, or `general` if no distinct source exists.';

  return [
    '## Platform Trust Contract',
    '',
    'Your final answer must include a markdown heading exactly `### Data Gaps`.',
    sourceLine,
    'Format each disclosed gap as `- source_id: what was missing and why it matters`.',
    'If every source returned usable data, write exactly: `No data gaps detected.`',
    'This section is audited against platform evidence. Do not omit it, even when the report otherwise looks complete.',
  ].join('\n');
}

module.exports = {
  DEFAULT_TRUST_CONTRACT,
  AGENT_TRUST_CONTRACTS,
  resolveTrustContract,
  getReportDependenciesForAgent,
  summariseTrustContract,
  buildTrustPromptContext,
};
