import { Link, useLocation } from 'react-router-dom';
import TOOLS from '../../config/tools';

const ADMIN_LABELS = {
  '/admin': 'Admin',
  '/admin/organizations': 'Organisations',
  '/admin/users': 'Users',
  '/admin/models': 'Models',
  '/admin/providers': 'Providers',
  '/admin/agents': 'Agents',
  '/admin/mcp-servers': 'MCP Servers',
  '/admin/mcp-resources': 'MCP Resources',
  '/admin/prompts': 'MCP Prompts',
  '/admin/lessons': 'Lessons & Rules',
  '/admin/email-templates': 'Email Templates',
  '/admin/knowledge': 'Knowledge Base',
  '/admin/competitors': 'Competitors',
  '/admin/monitoring': 'Monitoring',
  '/admin/operations': 'Operations',
  '/admin/diagnostics': 'Diagnostics',
  '/admin/usage': 'Usage & Cost',
  '/admin/logs': 'Raw Logs',
  '/admin/agent-trust': 'Agent Runs',
  '/admin/claude-sessions': 'Claude Sessions',
  '/admin/monitoring/decision-log': 'Decision Log',
  '/admin/monitoring/transactions': 'Transaction Log',
  '/admin/monitoring/events': 'Agent Event Log',
  '/admin/sql': 'SQL Console',
  '/admin/settings': 'App Settings',
  '/admin/security': 'Security',
  '/admin/data-privacy': 'Data Privacy',
  '/admin/storage': 'File Storage',
};

const MONITORING_PATHS = new Set([
  '/admin/monitoring',
  '/admin/operations',
  '/admin/diagnostics',
  '/admin/usage',
  '/admin/logs',
  '/admin/agent-trust',
  '/admin/claude-sessions',
  '/admin/monitoring/decision-log',
  '/admin/monitoring/transactions',
  '/admin/monitoring/events',
]);

const SETTINGS_TABS = {
  appearance: 'Appearance',
  models: 'Models',
  budget: 'Budget',
};

function toolLabel(pathname) {
  return TOOLS.find((tool) => tool.path.split('?')[0] === pathname)?.name;
}

function buildCrumbs(pathname, searchParams) {
  if (pathname === '/' || pathname === '/dashboard') return [];

  const crumbs = [{ label: 'Home', to: '/dashboard' }];

  if (pathname === '/tools') {
    crumbs.push({ label: 'Tools' });
    return crumbs;
  }

  if (pathname.startsWith('/tools/')) {
    crumbs.push({ label: 'Tools', to: '/tools' });
    crumbs.push({ label: toolLabel(pathname) ?? 'Tool' });
    return crumbs;
  }

  if (pathname === '/settings') {
    crumbs.push({ label: 'Settings', to: '/settings' });
    const tab = SETTINGS_TABS[searchParams.get('tab')];
    if (tab) crumbs.push({ label: tab });
    return tab ? crumbs : crumbs.slice(0, -1).concat({ label: 'Settings' });
  }

  if (pathname.startsWith('/admin')) {
    crumbs.push({ label: 'Admin', to: '/admin' });
    if (MONITORING_PATHS.has(pathname) && pathname !== '/admin/monitoring') {
      crumbs.push({ label: 'Monitoring', to: '/admin/monitoring' });
    }
    crumbs.push({ label: ADMIN_LABELS[pathname] ?? 'Admin Page' });
    return crumbs;
  }

  if (pathname.startsWith('/demo')) {
    crumbs.push({ label: 'Demo', to: '/demo/dashboard' });
    if (pathname !== '/demo/dashboard') crumbs.push({ label: 'Run' });
    return crumbs;
  }

  return crumbs;
}

export default function Breadcrumbs() {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const crumbs = buildCrumbs(location.pathname, searchParams);

  if (crumbs.length === 0) return null;

  return (
    <nav className="px-8 pt-4 text-xs" aria-label="Breadcrumb">
      <ol className="flex items-center gap-2 flex-wrap" style={{ color: 'var(--color-muted)' }}>
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <li key={`${crumb.label}-${index}`} className="flex items-center gap-2">
              {index > 0 && <span aria-hidden="true">/</span>}
              {crumb.to && !isLast ? (
                <Link to={crumb.to} className="hover:opacity-70" style={{ color: 'var(--color-muted)', textDecoration: 'none' }}>
                  {crumb.label}
                </Link>
              ) : (
                <span style={{ color: isLast ? 'var(--color-text)' : 'var(--color-muted)' }}>{crumb.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
