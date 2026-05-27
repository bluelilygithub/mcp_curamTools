import { Link } from 'react-router-dom';
import useAuthStore from '../stores/authStore';
import useToolStore from '../stores/toolStore';
import { getPermittedToolGroups, getPermittedTools } from '../config/tools';
import EmptyState from '../components/ui/EmptyState';
import { useIcon } from '../providers/IconProvider';

function ActionCard({ title, description, to, icon, onClick, tone = 'default' }) {
  const getIcon = useIcon();

  return (
    <Link
      to={to}
      onClick={onClick}
      className="block rounded-2xl border p-5 transition-opacity hover:opacity-80"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', textDecoration: 'none' }}
    >
      <div className="flex items-start gap-3">
        <span
          className="rounded-xl p-2 shrink-0"
          style={{
            background: tone === 'primary' ? 'rgba(var(--color-primary-rgb), 0.1)' : 'var(--color-bg)',
            color: tone === 'primary' ? 'var(--color-primary)' : 'var(--color-muted)',
          }}
        >
          {getIcon(icon, { size: 18 })}
        </span>
        <div>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{title}</h2>
          <p className="text-xs mt-1 leading-5" style={{ color: 'var(--color-muted)' }}>{description}</p>
        </div>
      </div>
    </Link>
  );
}

function GroupSummary({ group, tools }) {
  return (
    <Link
      to={`/tools?search=${encodeURIComponent(group)}`}
      className="block rounded-2xl border p-4 transition-opacity hover:opacity-80"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', textDecoration: 'none' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{group}</h3>
          <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
            {tools.slice(0, 3).map((tool) => tool.name).join(', ')}
            {tools.length > 3 ? `, +${tools.length - 3} more` : ''}
          </p>
        </div>
        <span className="text-xs rounded-full px-2 py-0.5" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }}>
          {tools.length}
        </span>
      </div>
    </Link>
  );
}

export default function DashboardPage() {
  const { user } = useAuthStore();
  const { lastVisitedTool, setLastVisitedTool } = useToolStore();
  const primaryRole = user?.roles?.find((r) => r.scope_type === 'global')?.name;
  const isAdmin = primaryRole === 'org_admin';
  const tools = getPermittedTools(primaryRole);
  const toolGroups = getPermittedToolGroups(primaryRole);
  const lastTool = tools.find((t) => t.id === lastVisitedTool);

  const firstName = user?.firstName || user?.email?.split('@')[0] || 'there';
  const findTool = (id) => tools.find((tool) => tool.id === id);

  const commonActions = [
    findTool('diamondplate-data') && {
      title: 'Understand lead quality',
      description: 'Open CRM lead intelligence for enquiry volume, conversion patterns, and attribution.',
      to: findTool('diamondplate-data').path,
      icon: 'trending-up',
      toolId: 'diamondplate-data',
    },
    findTool('campaign-dashboard') && {
      title: 'Review campaign performance',
      description: 'Check spend, conversions, impression share, and search terms.',
      to: findTool('campaign-dashboard').path,
      icon: 'bar-chart',
      toolId: 'campaign-dashboard',
    },
    findTool('doc-extractor') && {
      title: 'Extract document fields',
      description: 'Upload a document and extract structured fields with AI assistance.',
      to: findTool('doc-extractor').path,
      icon: 'file-text',
      toolId: 'doc-extractor',
    },
  ].filter(Boolean);

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <section
        className="rounded-3xl border p-6 md:p-8"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-5">
          <div>
            <p className="text-sm mb-2" style={{ color: 'var(--color-muted)' }}>
              {user?.orgName ?? 'MCP CuramTools'}
            </p>
            <h1 className="text-3xl font-semibold" style={{ color: 'var(--color-text)' }}>
              Hello, {firstName}
            </h1>
            <p className="text-sm mt-2 max-w-2xl" style={{ color: 'var(--color-muted)' }}>
              Start with the work that needs attention, then use the tool library when you need the full catalogue.
            </p>
          </div>
          <Link
            to="/tools"
            className="rounded-xl px-4 py-2 text-sm font-medium text-center"
            style={{ background: 'var(--color-primary)', color: '#fff', textDecoration: 'none' }}
          >
            Open tool library
          </Link>
        </div>
      </section>

      {tools.length > 0 ? (
        <>
          <section>
            <div className="mb-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                Next Actions
              </h2>
            </div>
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
              {lastTool && (
                <ActionCard
                  title={`Continue with ${lastTool.name}`}
                  description="Return to the last tool you opened."
                  to={lastTool.path}
                  icon={lastTool.icon}
                  tone="primary"
                  onClick={() => setLastVisitedTool(lastTool.id)}
                />
              )}
              <ActionCard
                title="Browse all tools"
                description={`${tools.length} available tools grouped by purpose, with search.`}
                to="/tools"
                icon="layers"
                tone={!lastTool ? 'primary' : 'default'}
              />
              {isAdmin && (
                <>
                  <ActionCard
                    title="Review operations"
                    description="Check model routing, budgets, access, privacy coverage, and UX posture."
                    to="/admin/operations"
                    icon="shield"
                  />
                  <ActionCard
                    title="Open admin hub"
                    description="Manage people, AI configuration, knowledge, monitoring, privacy, and storage."
                    to="/admin"
                    icon="settings"
                  />
                </>
              )}
            </div>
          </section>

          {commonActions.length > 0 && (
            <section>
              <div className="mb-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                  Common Workflows
                </h2>
              </div>
              <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
                {commonActions.map((action) => (
                  <ActionCard
                    key={action.toolId}
                    title={action.title}
                    description={action.description}
                    to={action.to}
                    icon={action.icon}
                    onClick={() => setLastVisitedTool(action.toolId)}
                  />
                ))}
              </div>
            </section>
          )}

          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                Tool Areas
              </h2>
              <Link to="/tools" className="text-xs font-medium" style={{ color: 'var(--color-primary)' }}>
                View all
              </Link>
            </div>
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
              {toolGroups.map(({ group, tools: groupTools }) => (
                <GroupSummary key={group} group={group} tools={groupTools} />
              ))}
            </div>
          </section>
        </>
      ) : (
        <EmptyState
          icon="layers"
          message="No tools available yet."
          hint="Tools will appear here once they are configured by an administrator."
        />
      )}
    </div>
  );
}
