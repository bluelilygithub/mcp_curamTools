const SYSTEM_ROLE_OPTIONS = [
  {
    name: 'org_member',
    label: 'Member',
    description: 'General organisation user. Can run basic/member agents when granted.',
    assignableToAgents: true,
  },
  {
    name: 'ads_operator',
    label: 'Ads Operator',
    description: 'Advertising/reporting operator. Can run ads-focused agents when granted.',
    assignableToAgents: true,
  },
  {
    name: 'org_admin',
    label: 'Admin',
    description: 'Full admin access. Always allowed to run agents.',
    assignableToAgents: false,
  },
];

const AGENT_DEFAULT_ACCESS = {
  'google-ads-monitor':          'ads_operator',
  'google-ads-freeform':         'ads_operator',
  'google-ads-change-impact':    'ads_operator',
  'google-ads-change-audit':     'ads_operator',
  'ads-bounce-analysis':         'ads_operator',
  'auction-insights':            'ads_operator',
  'competitor-keyword-intel':    'ads_operator',
  'google-ads-strategic-review': 'ads_operator',
  'keyword-opportunity':         'ads_operator',
  'ads-copy-gate':               'ads_operator',
  'ads-copy-playbook':           'ads_operator',
  'ads-setup-architect':         'ads_operator',
  'ads-copy-diagnostic':         'ads_operator',
  'ads-attribution-summary':     'ads_operator',
  'daypart-intelligence':        'ads_operator',
  'cost-per-booked-job':         'ads_operator',
  'wp-theme-extractor':          'org_member',
  'diamondplate-data':           'org_member',
  'search-term-intelligence':    'org_member',
  'lead-velocity':               'org_member',
  'ai-visibility-monitor':       'org_member',
  'geo-heatmap':                 'org_member',
  'demo-document-analyzer':      'org_member',
  'spec-validator':              'org_member',
  'demo-spec-validator':         'org_member',
  'demo-tender-response':        'org_member',
  'not-interested-report':       'org_admin',
  'high-intent-advisor':         'org_admin',
};

function roleLabel(roleName) {
  return SYSTEM_ROLE_OPTIONS.find((role) => role.name === roleName)?.label ?? roleName;
}

function getDefaultAccess(slug) {
  const roleName = AGENT_DEFAULT_ACCESS[slug] ?? null;
  return {
    roleName,
    label: roleName ? roleLabel(roleName) : null,
  };
}

module.exports = {
  SYSTEM_ROLE_OPTIONS,
  AGENT_DEFAULT_ACCESS,
  getDefaultAccess,
  roleLabel,
};
