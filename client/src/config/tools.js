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
  // Example — uncomment and adapt when building the first agent:
  // {
  //   id: 'google-ads-monitor',
  //   name: 'Google Ads Monitor',
  //   description: 'AI-powered analysis of your Google Ads account performance.',
  //   icon: 'bar-chart',
  //   path: '/tools/google-ads-monitor',
  //   roles: ['ads_operator', 'org_admin'],
  // },
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
