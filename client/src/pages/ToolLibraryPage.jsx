import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useIcon } from '../providers/IconProvider';
import useAuthStore from '../stores/authStore';
import useToolStore from '../stores/toolStore';
import { getPermittedToolGroups } from '../config/tools';

function ToolCard({ tool }) {
  const getIcon = useIcon();
  const { setLastVisitedTool } = useToolStore();

  return (
    <Link
      to={tool.path}
      onClick={() => setLastVisitedTool(tool.id)}
      className="block rounded-2xl border p-4 transition-opacity hover:opacity-80"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', textDecoration: 'none' }}
    >
      <div className="flex items-start gap-3">
        <span
          className="rounded-xl p-2 shrink-0"
          style={{ background: 'rgba(var(--color-primary-rgb), 0.1)', color: 'var(--color-primary)' }}
        >
          {getIcon(tool.icon, { size: 18 })}
        </span>
        <div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{tool.name}</h3>
          <p className="text-xs mt-1 leading-5" style={{ color: 'var(--color-muted)' }}>{tool.description}</p>
        </div>
      </div>
    </Link>
  );
}

export default function ToolLibraryPage() {
  const [searchParams] = useSearchParams();
  const { user } = useAuthStore();
  const primaryRole = user?.roles?.find((r) => r.scope_type === 'global')?.name;
  const toolGroups = getPermittedToolGroups(primaryRole);
  const [search, setSearch] = useState(searchParams.get('search') ?? '');

  useEffect(() => {
    setSearch(searchParams.get('search') ?? '');
  }, [searchParams]);

  const filteredGroups = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return toolGroups;

    return toolGroups
      .map(({ group, tools }) => ({
        group,
        tools: tools.filter((tool) => {
          const haystack = `${tool.name} ${tool.description} ${group}`.toLowerCase();
          return haystack.includes(term);
        }),
      }))
      .filter(({ tools }) => tools.length > 0);
  }, [search, toolGroups]);

  const totalTools = toolGroups.reduce((sum, group) => sum + group.tools.length, 0);
  const filteredCount = filteredGroups.reduce((sum, group) => sum + group.tools.length, 0);

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--color-text)' }}>Tools</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
            Browse the available agents and utilities without crowding day-to-day navigation.
          </p>
        </div>

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tools..."
          className="w-full md:w-72 rounded-xl px-3 py-2 text-sm outline-none"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
        />
      </div>

      <div className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          Showing <span className="font-semibold" style={{ color: 'var(--color-text)' }}>{filteredCount}</span> of{' '}
          <span className="font-semibold" style={{ color: 'var(--color-text)' }}>{totalTools}</span> tools
        </p>
      </div>

      {filteredGroups.length > 0 ? (
        <div className="space-y-6">
          {filteredGroups.map(({ group, tools }) => (
            <section key={group} className="space-y-3">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                  {group}
                </h2>
              </div>
              <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
                {tools.map((tool) => (
                  <ToolCard key={tool.id} tool={tool} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border p-8 text-center" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>No matching tools</p>
          <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>Try a broader search term.</p>
        </div>
      )}
    </div>
  );
}
