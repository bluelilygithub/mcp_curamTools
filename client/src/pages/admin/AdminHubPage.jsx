import { Link } from 'react-router-dom';
import { useIcon } from '../../providers/IconProvider';

const ADMIN_GROUPS = [
  {
    title: 'People & Access',
    description: 'Control who can use the platform and how access is organised.',
    items: [
      { title: 'Organisations', path: '/admin/organizations', icon: 'building', summary: 'Manage organisation records and tenant-level details.' },
      { title: 'Users', path: '/admin/users', icon: 'users', summary: 'Invite users, review accounts, and manage access.' },
      { title: 'Departments', path: '/admin/departments', icon: 'bookmark', summary: 'Group users and operating areas.' },
      { title: 'Org Roles', path: '/admin/org-roles', icon: 'tag', summary: 'Configure organisation role assignments.' },
    ],
  },
  {
    title: 'AI Configuration',
    description: 'Configure model providers, agents, prompts, and MCP capabilities.',
    items: [
      { title: 'Providers', path: '/admin/providers', icon: 'globe', summary: 'Provider keys, model availability, and routing configuration.' },
      { title: 'Models', path: '/admin/models', icon: 'layers', summary: 'Model catalogue, capabilities, and pricing assumptions.' },
      { title: 'Agents', path: '/admin/agents', icon: 'bot', summary: 'Agent settings, model choices, budgets, and access.' },
      { title: 'MCP Servers', path: '/admin/mcp-servers', icon: 'server', summary: 'Manage connected MCP servers.' },
      { title: 'MCP Resources', path: '/admin/mcp-resources', icon: 'layers', summary: 'Inspect registered resources exposed through MCP.' },
      { title: 'MCP Prompts', path: '/admin/prompts', icon: 'file-text', summary: 'Manage prompt templates and prompt surfaces.' },
      { title: 'Lessons & Rules', path: '/admin/lessons', icon: 'bookmark', summary: 'Maintain reusable lessons, guidance, and operating rules.' },
    ],
  },
  {
    title: 'Knowledge & Content',
    description: 'Maintain source material the tools and agents depend on.',
    items: [
      { title: 'Email Templates', path: '/admin/email-templates', icon: 'mail', summary: 'Edit operational email templates.' },
      { title: 'Knowledge Base', path: '/admin/knowledge', icon: 'book-open', summary: 'Manage internal reference material.' },
      { title: 'Competitors', path: '/admin/competitors', icon: 'target', summary: 'Maintain competitor context for analysis tools.' },
    ],
  },
  {
    title: 'Usage, Reliability & Audit',
    description: 'Watch cost, usage, run quality, logs, and operational health.',
    items: [
      { title: 'Monitoring', path: '/admin/monitoring', icon: 'activity', summary: 'Launchpad for agent runs, usage, logs, and audit trails.' },
      { title: 'Operations Overview', path: '/admin/operations', icon: 'shield', summary: 'Platform posture across models, budgets, access, privacy, and UX coverage.' },
      { title: 'Diagnostics', path: '/admin/diagnostics', icon: 'zap', summary: 'Live checks for database, providers, MCP, email, and integrations.' },
      { title: 'Usage & Cost', path: '/admin/usage', icon: 'trending-up', summary: 'Token, cost, budget pressure, and usage reporting.' },
      { title: 'Agent Runs', path: '/admin/agent-trust', icon: 'shield', summary: 'Run history, review signals, model use, and data gaps.' },
      { title: 'Raw Logs', path: '/admin/logs', icon: 'activity', summary: 'Raw usage log rows and server log access.' },
      { title: 'SQL Console', path: '/admin/sql', icon: 'database', summary: 'Direct database inspection for trusted admins.' },
    ],
  },
  {
    title: 'System & Privacy',
    description: 'Configure system-wide settings, storage, and data-handling controls.',
    items: [
      { title: 'App Settings', path: '/admin/settings', icon: 'settings', summary: 'Application-level settings and defaults.' },
      { title: 'Security', path: '/admin/security', icon: 'shield', summary: 'Security settings and access controls.' },
      { title: 'Data Privacy', path: '/admin/data-privacy', icon: 'eye-off', summary: 'Field exclusions and privacy behaviour for extraction flows.' },
      { title: 'File Storage', path: '/admin/storage', icon: 'archive', summary: 'Storage policy and S3-backed file handling.' },
    ],
  },
];

function AdminCard({ item }) {
  const getIcon = useIcon();

  return (
    <Link
      to={item.path}
      className="block rounded-2xl border p-4 transition-opacity hover:opacity-80"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', textDecoration: 'none' }}
    >
      <div className="flex items-start gap-3">
        <span className="rounded-xl p-2 shrink-0" style={{ background: 'var(--color-bg)', color: 'var(--color-primary)' }}>
          {getIcon(item.icon, { size: 18 })}
        </span>
        <div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{item.title}</h3>
          <p className="text-xs mt-1 leading-5" style={{ color: 'var(--color-muted)' }}>{item.summary}</p>
        </div>
      </div>
    </Link>
  );
}

export default function AdminHubPage() {
  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--color-text)' }}>Admin</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
          System controls grouped by the job you are trying to do, instead of a long sidebar list.
        </p>
      </div>

      <div className="grid gap-5">
        {ADMIN_GROUPS.map((group) => (
          <section
            key={group.title}
            className="rounded-2xl border p-5"
            style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
          >
            <div className="mb-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                {group.title}
              </h2>
              <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>{group.description}</p>
            </div>
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
              {group.items.map((item) => (
                <AdminCard key={item.path} item={item} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
