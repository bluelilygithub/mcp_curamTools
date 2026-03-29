/**
 * DashboardPage — greeting h1, org_name subline, tool card grid, lastVisitedTool link.
 */
import { Link } from 'react-router-dom';
import useAuthStore from '../stores/authStore';
import useToolStore from '../stores/toolStore';
import { getPermittedTools } from '../config/tools';
import EmptyState from '../components/ui/EmptyState';
import { useIcon } from '../providers/IconProvider';
import Button from '../components/ui/Button';

function ToolCard({ tool }) {
  const getIcon = useIcon();
  const { setLastVisitedTool } = useToolStore();

  return (
    <div
      className="rounded-xl shadow-sm p-6 flex flex-col items-center text-center border"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
    >
      <span style={{ color: 'var(--color-primary)' }}>
        {getIcon(tool.icon, { size: 32 })}
      </span>
      <h2
        className="mt-3 font-bold text-lg"
        style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-text)' }}
      >
        {tool.name}
      </h2>
      <p className="text-sm mt-1 flex-1" style={{ color: 'var(--color-muted)' }}>
        {tool.description}
      </p>
      <Link to={tool.path} onClick={() => setLastVisitedTool(tool.id)} className="w-full mt-4">
        <Button variant="primary" className="w-full justify-center">
          Launch
        </Button>
      </Link>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuthStore();
  const { lastVisitedTool } = useToolStore();
  const primaryRole = user?.roles?.find((r) => r.scope_type === 'global')?.name;
  const tools = getPermittedTools(primaryRole);
  const lastTool = tools.find((t) => t.id === lastVisitedTool);

  const firstName = user?.firstName || user?.email?.split('@')[0] || 'there';

  return (
    <div className="p-8">
      {/* Greeting */}
      <div className="mb-8">
        <h1
          className="text-2xl font-bold"
          style={{ color: 'var(--color-text)' }}
        >
          Hello, {firstName}
        </h1>
        {user?.orgName && (
          <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
            {user.orgName}
          </p>
        )}
      </div>

      {/* Last visited tool link */}
      {lastTool && (
        <div className="mb-6">
          <Link
            to={lastTool.path}
            className="text-sm hover:opacity-70 transition-all"
            style={{ color: 'var(--color-primary)' }}
          >
            ← Continue with {lastTool.name}
          </Link>
        </div>
      )}

      {/* Tool card grid */}
      {tools.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {tools.map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </div>
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
