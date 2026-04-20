/**
 * Tool registry — single source of truth for sidebar and dashboard.
 * getPermittedTools(role) filters by permitted roles.
 *
 * Each tool entry:
 *   id          — unique slug (matches agent slug)
 *   name        — display name
 *   description — shown on dashboard card
 *   icon        — semantic icon name (from IconProvider)
 *   path        — React Router path
 *   roles       — roles that may access this tool (org_admin always passes)
 *
 * Add new tools here when agents are built.
 */

const TOOLS = [
  {
    id:          'google-ads-monitor',
    name:        'Google Ads Monitor',
    description: 'AI-powered analysis of Google Ads campaign performance, search intent, and budget pacing.',
    icon:        'bar-chart',
    path:        '/tools/google-ads-monitor',
    roles:       ['ads_operator', 'org_admin'],
  },
  {
    id:          'diamondplate-data',
    name:        'DiamondPlate Data',
    description: 'CRM lead intelligence — analyse enquiry volume, conversion patterns, channel attribution, and why leads don\'t convert.',
    icon:        'trending-up',
    path:        '/tools/diamondplate-data',
    roles:       ['org_member', 'org_admin'],
  },
  {
    id:          'ai-visibility-monitor',
    name:        'AI Visibility Monitor',
    description: 'Track how Diamond Plate Australia appears in AI-generated search responses. Monitors brand presence, competitor mentions, and cited sources across weekly web search prompts.',
    icon:        'eye',
    path:        '/tools/google-ads-monitor?tab=ai-visibility',
    roles:       ['org_member', 'org_admin'],
  },
  {
    id:          'doc-extractor',
    name:        'Document Extractor',
    description: 'Upload any image document and extract structured fields using Claude Vision. Compare accuracy across AI providers.',
    icon:        'file-text',
    path:        '/tools/doc-extractor',
    roles:       ['org_member', 'org_admin'],
  },
  {
    id:          'media-gen',
    name:        'Media Generator',
    description: 'Generate images and videos using Fal.ai models. Provide a text prompt and optional reference image to create AI-generated media.',
    icon:        'film',
    path:        '/tools/media-gen',
    roles:       ['org_member', 'org_admin'],
  },
  {
    id:          'high-intent-advisor',
    name:        'High Intent Advisor',
    description: 'Daily suggestions for attracting high-intent customers based on your ad, analytics, and CRM data.',
    icon:        'target',
    path:        '/tools/high-intent-advisor',
    roles:       ['org_admin'],
  },
  {
    id:          'not-interested-report',
    name:        'Not Interested Report',
    description: 'Diagnoses why wrong-product and wrong-location leads are getting through. Separates ads targeting gaps from sales qualification failures using CRM call notes and Ads keyword data.',
    icon:        'alert-circle',
    path:        '/tools/not-interested-report',
    roles:       ['org_admin'],
  },
];

/**
 * Return tools the given role may access.
 * org_admin always sees all tools.
 */
export function getPermittedTools(roleName) {
  if (roleName === 'org_admin') return TOOLS;
  return TOOLS.filter((t) => t.roles.includes(roleName) || t.roles.includes('org_member'));
}

export default TOOLS;
