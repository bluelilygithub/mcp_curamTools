'use strict';

const { pool } = require('../db');
const { PROVIDERS } = require('./providerRegistry');
const AgentConfigService = require('./AgentConfigService');

const BASE_CREDENTIAL_SCOPES = [
  {
    key: 'google_ads',
    label: 'Google Ads',
    scope: 'external_account_scoped',
    envVars: [
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GOOGLE_REFRESH_TOKEN',
      'GOOGLE_ADS_DEVELOPER_TOKEN',
      'GOOGLE_ADS_MANAGER_ID',
      'GOOGLE_ADS_CUSTOMER_ID',
      'GOOGLE_ADS_ALLOWED_CUSTOMER_IDS',
    ],
    risk: 'medium',
    owner: 'platform',
    boundary: 'Shared OAuth/developer credentials are narrowed by GOOGLE_ADS_ALLOWED_CUSTOMER_IDS and org Google Ads customer assignments.',
    rotationNote: 'Rotate OAuth refresh token/developer token when Ads account access changes.',
  },
  {
    key: 'google_analytics',
    label: 'Google Analytics GA4',
    scope: 'global_shared',
    envVars: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN', 'GOOGLE_GA4_PROPERTY_ID'],
    risk: 'medium',
    owner: 'platform',
    boundary: 'Shared OAuth credential and GA4 property ID; no per-org GA4 property mapping is currently enforced.',
    rotationNote: 'Rotate Google refresh token if GA4 access changes.',
  },
  {
    key: 'aws_s3',
    label: 'AWS S3 Storage',
    scope: 'org_configured',
    envVars: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
    risk: 'medium',
    owner: 'platform',
    boundary: 'AWS credentials are shared env vars; bucket/region and object prefixes are org-scoped.',
    rotationNote: 'Rotate AWS access key if storage permissions or bucket access changes.',
  },
  {
    key: 'wordpress',
    label: 'WordPress / CRM',
    scope: 'global_shared',
    envVars: ['WP_URL', 'WP_USER', 'WP_APP_VAR', 'WP_DB_HOST', 'WP_DB_USER', 'WP_DB_PASS'],
    risk: 'medium',
    owner: 'platform',
    boundary: 'Shared WordPress credentials; CRM privacy rules can redact configured fields before model use.',
    rotationNote: 'Rotate app password and DB password when WordPress access changes.',
  },
  {
    key: 'search_api',
    label: 'Search API',
    scope: 'global_shared',
    envVars: ['SEARCH_API_KEY'],
    risk: 'low',
    owner: 'platform',
    boundary: 'Shared search provider key used by visibility monitoring; outputs are scoped by org prompts/settings.',
    rotationNote: 'Rotate if provider usage or billing ownership changes.',
  },
];

function envStatus(envVars = []) {
  return envVars.map((name) => ({ name, configured: !!process.env[name] }));
}

function summarizeEnv(envVars = []) {
  const vars = envStatus(envVars);
  return {
    vars,
    configuredCount: vars.filter((item) => item.configured).length,
    requiredCount: vars.length,
    fullyConfigured: vars.length > 0 && vars.every((item) => item.configured),
  };
}

function scopeLabel(scope) {
  return {
    global_shared: 'Global shared',
    org_configured: 'Org configured',
    org_secret: 'Org secret',
    external_account_scoped: 'External account scoped',
  }[scope] ?? scope;
}

async function getOrgUsage(orgId) {
  const [
    adsCustomers,
    mcpServers,
    storageSettings,
    customProviders,
    privacySettings,
  ] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS count
         FROM google_ads_customers
        WHERE org_id = $1 AND is_active = TRUE`,
      [orgId]
    ).then((res) => res.rows[0]?.count ?? 0).catch(() => 0),
    pool.query(
      `SELECT COUNT(*)::int AS count
         FROM mcp_servers
        WHERE org_id = $1 AND is_active = TRUE`,
      [orgId]
    ).then((res) => res.rows[0]?.count ?? 0).catch(() => 0),
    AgentConfigService.getStorageSettings(orgId).catch(() => ({})),
    AgentConfigService.getCustomProviders(orgId).catch(() => []),
    Promise.all([
      AgentConfigService.getExtractionPrivacySettings(orgId).catch(() => ({})),
      AgentConfigService.getCrmPrivacySettings(orgId).catch(() => ({})),
    ]),
  ]);

  return {
    activeGoogleAdsCustomers: adsCustomers,
    activeMcpServers: mcpServers,
    storageEnabled: storageSettings.enabled === true,
    storageBucketConfigured: !!storageSettings.aws_bucket,
    customProviderCount: customProviders.length,
    privacyRuleCount: [
      ...(privacySettings[0]?.excluded_field_names ?? []),
      ...(privacySettings[1]?.excluded_fields ?? []),
    ].length,
  };
}

function buildBaseCredentialEntry(definition, usage) {
  const env = summarizeEnv(definition.envVars);
  return {
    ...definition,
    scopeLabel: scopeLabel(definition.scope),
    env,
    configured: definition.envVars.length === 0 ? true : env.fullyConfigured,
    currentOrg: {
      usesCredential: (
        (definition.key === 'google_ads' && usage.activeGoogleAdsCustomers > 0) ||
        (definition.key === 'aws_s3' && usage.storageEnabled) ||
        (definition.key === 'wordpress' && usage.activeMcpServers > 0) ||
        (definition.key === 'search_api') ||
        (definition.key === 'google_analytics')
      ),
    },
  };
}

function buildProviderEntries(customProviders = []) {
  const builtins = Object.entries(PROVIDERS).map(([key, provider]) => ({
    key: `model_${key}`,
    label: provider.label,
    scope: 'global_shared',
    scopeLabel: scopeLabel('global_shared'),
    envVars: [provider.envVar],
    env: summarizeEnv([provider.envVar]),
    configured: !!process.env[provider.envVar],
    risk: 'low',
    owner: 'platform',
    boundary: 'Shared model provider key; usage is governed by org model catalogue/defaults and per-agent model resolution.',
    rotationNote: `Rotate ${provider.envVar} when provider access or billing ownership changes.`,
    currentOrg: { usesCredential: true },
  }));

  const customs = customProviders.map((provider) => ({
    key: `custom_provider_${provider.key}`,
    label: provider.label || provider.key,
    scope: 'org_configured',
    scopeLabel: scopeLabel('org_configured'),
    envVars: provider.apiKeyEnv ? [provider.apiKeyEnv] : [],
    env: summarizeEnv(provider.apiKeyEnv ? [provider.apiKeyEnv] : []),
    configured: provider.apiKeyEnv ? !!process.env[provider.apiKeyEnv] : false,
    risk: 'low',
    owner: 'org',
    boundary: 'Provider metadata is org-scoped; the secret is still referenced by environment variable name.',
    rotationNote: provider.apiKeyEnv ? `Rotate ${provider.apiKeyEnv} when this custom provider changes.` : 'Set an apiKeyEnv before use.',
    currentOrg: { usesCredential: true },
  }));

  return [...builtins, ...customs];
}

async function buildCredentialScopeReport(orgId) {
  const usage = await getOrgUsage(orgId);
  const customProviders = await AgentConfigService.getCustomProviders(orgId).catch(() => []);
  const baseEntries = BASE_CREDENTIAL_SCOPES.map((definition) => buildBaseCredentialEntry(definition, usage));
  const entries = [...baseEntries, ...buildProviderEntries(customProviders)];

  return {
    generatedAt: new Date().toISOString(),
    orgId,
    summary: {
      total: entries.length,
      configured: entries.filter((entry) => entry.configured).length,
      shared: entries.filter((entry) => entry.scope === 'global_shared').length,
      orgConfigured: entries.filter((entry) => entry.scope === 'org_configured').length,
      externalScoped: entries.filter((entry) => entry.scope === 'external_account_scoped').length,
      currentOrgUsage: usage,
    },
    entries,
  };
}

module.exports = {
  BASE_CREDENTIAL_SCOPES,
  buildCredentialScopeReport,
};
