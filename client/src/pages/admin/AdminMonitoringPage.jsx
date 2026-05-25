import { Link } from 'react-router-dom';
import { useIcon } from '../../providers/IconProvider';

const MONITORING_GROUPS = [
  {
    title: 'Agent Activity',
    description: 'Inspect what agents ran, what they produced, and whether outputs need review.',
    items: [
      {
        title: 'Agent Runs',
        path: '/admin/agent-trust',
        icon: 'shield',
        summary: 'Run history, status, model, cost, fallbacks, data gaps, dependencies, and review signals.',
      },
      {
        title: 'Decision Log',
        path: '/admin/monitoring/decision-log',
        icon: 'file-text',
        summary: 'Card-based run log for reopening prior demo/document outputs and reviewing persisted decisions.',
      },
    ],
  },
  {
    title: 'Cost & Usage',
    description: 'Understand spend, tokens, cache behaviour, and model usage patterns.',
    items: [
      {
        title: 'Usage & Cost',
        path: '/admin/usage',
        icon: 'trending-up',
        summary: 'Aggregated token/cost reporting, warnings, budget pressure, forecasts, and top cost drivers.',
      },
      {
        title: 'Raw Usage Logs',
        path: '/admin/logs',
        icon: 'activity',
        summary: 'Raw usage log rows and server log access, with export and empty-log controls.',
      },
    ],
  },
  {
    title: 'Audit Trails',
    description: 'Drill into transaction-style logs for workflows that record stage-by-stage decisions.',
    items: [
      {
        title: 'Transaction Log',
        path: '/admin/monitoring/transactions',
        icon: 'activity',
        summary: 'Universal transaction ledger keyed by session, agent, action, status, and outcome.',
      },
      {
        title: 'Agent Event Log',
        path: '/admin/monitoring/events',
        icon: 'list',
        summary: 'Per-agent event rows with declared metadata fields and transaction links.',
      },
    ],
  },
  {
    title: 'System Evidence',
    description: 'Operational checks and session metadata that support debugging.',
    items: [
      {
        title: 'Claude Sessions',
        path: '/admin/claude-sessions',
        icon: 'clock',
        summary: 'Claude session inspection and related operational context.',
      },
      {
        title: 'Diagnostics',
        path: '/admin/diagnostics',
        icon: 'zap',
        summary: 'Live health checks for database, model providers, MCP, email, and Google integrations.',
      },
    ],
  },
];

function MonitoringCard({ item }) {
  const getIcon = useIcon();
  return (
    <Link
      to={item.path}
      className="block rounded-2xl border p-4 transition-opacity hover:opacity-80"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', textDecoration: 'none' }}
    >
      <div className="flex items-start gap-3">
        <span
          className="rounded-xl p-2 shrink-0"
          style={{ background: 'var(--color-bg)', color: 'var(--color-primary)' }}
        >
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

export default function AdminMonitoringPage() {
  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Monitoring</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
          One place for agent runs, usage, logs, audit trails, and operational diagnostics.
        </p>
      </div>

      <div className="grid gap-5">
        {MONITORING_GROUPS.map((group) => (
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
            <div className="grid md:grid-cols-2 gap-3">
              {group.items.map((item) => (
                <MonitoringCard key={item.path} item={item} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
