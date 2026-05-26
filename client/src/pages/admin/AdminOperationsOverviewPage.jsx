import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import InlineBanner from '../../components/ui/InlineBanner';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'attention', label: 'Needs attention' },
  { id: 'errors', label: 'Errors' },
  { id: 'workflows', label: 'Workflows' },
  { id: 'chained', label: 'Chained' },
  { id: 'privacy', label: 'Privacy covered' },
];

function fmtAud(value) {
  if (value == null) return 'Not set';
  return `$${Number(value ?? 0).toFixed(2)}`;
}

function fmtDate(value) {
  if (!value) return 'Never';
  try {
    return new Date(value).toLocaleString('en-AU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}

function fmtTokens(value) {
  const n = Number(value ?? 0);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function signalColor(severity) {
  if (severity === 'critical') return '#dc2626';
  if (severity === 'warning') return '#d97706';
  return 'var(--color-primary)';
}

function StatCard({ label, value, sub }) {
  return (
    <div className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>{label}</p>
      <p className="text-2xl font-bold mt-1" style={{ color: 'var(--color-text)' }}>{value}</p>
      {sub && <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{sub}</p>}
    </div>
  );
}

function Detail({ label, value, tone }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>{label}</p>
      <p className="text-sm font-medium mt-0.5 break-words" style={{ color: tone ?? 'var(--color-text)' }}>{value ?? 'None'}</p>
    </div>
  );
}

function AgentCard({ agent }) {
  const warningSignals = agent.signals?.filter((signal) => ['critical', 'warning'].includes(signal.severity)) ?? [];
  const dependencies = agent.trust_contract?.dependency_contract ?? [];
  const workflow = agent.workflow_contract;

  return (
    <section className="rounded-2xl border p-5 space-y-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-semibold font-mono" style={{ color: 'var(--color-text)' }}>{agent.slug}</h2>
            {!agent.enabled && (
              <span className="text-[11px] rounded-full px-2 py-0.5" style={{ background: '#fef3c7', color: '#92400e' }}>
                disabled
              </span>
            )}
            {workflow && (
              <span className="text-[11px] rounded-full px-2 py-0.5" style={{ background: '#eff6ff', color: '#1d4ed8' }}>
                workflow
              </span>
            )}
            {dependencies.length > 0 && (
              <span className="text-[11px] rounded-full px-2 py-0.5" style={{ background: '#f5f3ff', color: '#6d28d9' }}>
                chained
              </span>
            )}
          </div>
          <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
            Last run: {fmtDate(agent.latest_run?.run_at)} · status: {agent.latest_run?.status ?? 'none'}
          </p>
        </div>
        <Link to="/admin/agents" className="text-xs font-medium" style={{ color: 'var(--color-primary)' }}>
          Agent settings
        </Link>
      </div>

      {warningSignals.length > 0 && (
        <div className="space-y-1.5">
          {warningSignals.slice(0, 3).map((signal, index) => (
            <div key={`${signal.label}-${index}`} className="rounded-xl px-3 py-2 text-xs" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
              <span className="font-semibold" style={{ color: signalColor(signal.severity) }}>{signal.label}: </span>
              <span style={{ color: 'var(--color-muted)' }}>{signal.detail}</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Detail label="Model" value={agent.model ?? 'No resolved model'} tone={agent.model ? undefined : '#dc2626'} />
        <Detail label="Fallback" value={agent.fallback_model ?? 'None'} />
        <Detail label="Run Budget" value={fmtAud(agent.max_task_budget_aud)} tone={agent.max_task_budget_aud == null ? '#d97706' : undefined} />
        <Detail label="30d Cost" value={fmtAud(agent.usage_30d?.usage_cost_aud ?? agent.usage_30d?.run_cost_aud ?? 0)} />
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Detail label="Access" value={agent.access_mode === 'configured_roles' ? agent.allowed_roles?.join(', ') : agent.default_access_label} />
        <Detail label="Limits" value={`${agent.max_tokens ?? 'auto'} tokens · ${agent.max_iterations ?? 'auto'} iterations`} />
        <Detail label="30d Runs" value={`${agent.usage_30d?.runs ?? 0} runs · ${agent.usage_30d?.error_runs ?? 0} errors`} />
        <Detail label="Tokens" value={fmtTokens(agent.usage_30d?.total_tokens)} />
      </div>

      <div className="flex gap-2 flex-wrap text-xs">
        <span className="rounded-full px-2.5 py-1" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>
          Trust: {agent.trust_contract ? 'policy declared' : 'none'}
        </span>
        <span className="rounded-full px-2.5 py-1" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>
          Dependencies: {dependencies.length}
        </span>
        <span className="rounded-full px-2.5 py-1" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>
          Workflow: {workflow ? `${workflow.stage_count} stages` : 'none'}
        </span>
        <span className="rounded-full px-2.5 py-1" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>
          Privacy: {agent.privacy_coverage?.length ? agent.privacy_coverage.join(', ') : 'not targeted'}
        </span>
        {agent.has_custom_prompt && (
          <span className="rounded-full px-2.5 py-1" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>
            custom prompt
          </span>
        )}
      </div>
    </section>
  );
}

export default function AdminOperationsOverviewPage() {
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    api.get('/admin/operations-overview')
      .then(setData)
      .catch((err) => setError(err.message || 'Failed to load operations overview'))
      .finally(() => setLoading(false));
  }, []);

  const agents = data?.agents ?? [];
  const filteredAgents = useMemo(() => {
    if (filter === 'attention') {
      return agents.filter((agent) => agent.signals?.some((signal) => ['critical', 'warning'].includes(signal.severity)));
    }
    if (filter === 'errors') {
      return agents.filter((agent) => agent.signals?.some((signal) => signal.severity === 'critical'));
    }
    if (filter === 'workflows') return agents.filter((agent) => agent.workflow_contract);
    if (filter === 'chained') return agents.filter((agent) => agent.trust_contract?.dependency_contract?.length > 0);
    if (filter === 'privacy') return agents.filter((agent) => agent.privacy_coverage?.length > 0);
    return agents;
  }, [agents, filter]);

  const summary = data?.summary ?? {};
  const dailyBudget = summary.daily_budget_aud;
  const dailySpend = Number(summary.daily_spend_aud ?? 0);
  const dailyBudgetSub = dailyBudget == null
    ? 'No daily cap configured'
    : `${Math.round((dailySpend / Math.max(Number(dailyBudget), 0.01)) * 100)}% used today`;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Operations Overview</h1>
          <p className="text-sm mt-0.5 max-w-3xl" style={{ color: 'var(--color-muted)' }}>
            A single admin view of model routing, budgets, access, trust, workflow, privacy coverage, and recent run health.
          </p>
        </div>
        <Link to="/admin/monitoring" className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
          Back to Monitoring
        </Link>
      </div>

      {error && <InlineBanner type="error" message={error} onDismiss={() => setError('')} />}

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading operations overview...</p>
      ) : (
        <>
          <InlineBanner
            type="info"
            message={data?.privacy?.note ?? 'Privacy controls are targeted by flow; this page shows coverage rather than claiming universal redaction.'}
          />

          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-4">
            <StatCard label="Agents" value={summary.agents_total ?? 0} sub={`${summary.enabled_agents ?? 0} enabled`} />
            <StatCard label="Attention" value={summary.agents_needing_attention ?? 0} sub="warnings or errors" />
            <StatCard label="Errors" value={summary.agents_with_errors ?? 0} sub="critical posture" />
            <StatCard label="Daily Spend" value={fmtAud(summary.daily_spend_aud)} sub={dailyBudgetSub} />
            <StatCard label="Default Model" value={summary.default_model ?? 'Not set'} sub="org default" />
            <StatCard label="Fallback" value={summary.fallback_model ?? 'None'} sub="org fallback" />
            <StatCard label="Workflows" value={summary.workflow_agents ?? 0} sub="hybrid contracts" />
            <StatCard label="Privacy Fields" value={(summary.extraction_privacy_fields ?? 0) + (summary.crm_privacy_fields ?? 0)} sub="targeted exclusions" />
          </div>

          <section className="rounded-2xl border overflow-hidden" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
            <div className="p-4 border-b flex items-start justify-between gap-4 flex-wrap" style={{ borderColor: 'var(--color-border)' }}>
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Agent Operational Posture</p>
                <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                  Showing {filteredAgents.length} of {agents.length} agents. Generated {fmtDate(data?.generated_at)}.
                </p>
              </div>
              <div className="flex gap-1 flex-wrap">
                {FILTERS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setFilter(item.id)}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium"
                    style={{
                      background: filter === item.id ? 'var(--color-surface)' : 'transparent',
                      color: filter === item.id ? 'var(--color-text)' : 'var(--color-muted)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="p-4 grid xl:grid-cols-2 gap-4">
              {filteredAgents.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No agents match this filter.</p>
              ) : filteredAgents.map((agent) => (
                <AgentCard key={agent.slug} agent={agent} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
