/**
 * AdminAgentTrustPage — log-first view of agent trust and review signals.
 */
import { useEffect, useMemo, useState } from 'react';
import api from '../../api/client';
import InlineBanner from '../../components/ui/InlineBanner';
import MarkdownRenderer from '../../components/ui/MarkdownRenderer';
import BoundsWarningPanel from '../../components/ui/BoundsWarningPanel';
import DataGapsPanel from '../../components/ui/DataGapsPanel';

const PERIODS = [7, 30, 90];
const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'signals', label: 'Trust signals' },
  { id: 'needs_review', label: 'Needs review' },
  { id: 'data_gaps', label: 'Data gaps' },
  { id: 'dependencies', label: 'Dependencies' },
  { id: 'workflows', label: 'Workflows' },
  { id: 'fallbacks', label: 'Fallbacks' },
  { id: 'errors', label: 'Errors' },
];

function fmtDate(value) {
  if (!value) return '—';
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

function fmtDuration(ms) {
  if (ms == null) return '—';
  const seconds = Math.round(Number(ms) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
}

function fmtAud(value) {
  return `$${Number(value ?? 0).toFixed(4)}`;
}

function fmtTokens(value) {
  const n = Number(value ?? 0);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function StatCard({ label, value, sub }) {
  return (
    <div className="rounded-xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>{label}</p>
      <p className="text-2xl font-bold mt-1" style={{ color: 'var(--color-text)' }}>{value}</p>
      {sub && <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{sub}</p>}
    </div>
  );
}

function DetailCard({ label, value, sub }) {
  return (
    <div className="rounded-xl border p-3" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
      <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>{label}</p>
      <p className="text-sm font-semibold mt-1 break-words" style={{ color: 'var(--color-text)' }}>{value ?? '—'}</p>
      {sub && <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{sub}</p>}
    </div>
  );
}

function statusColor(status) {
  if (status === 'complete') return '#16a34a';
  if (status === 'error') return '#dc2626';
  if (status === 'needs_review') return '#d97706';
  return '#6b7280';
}

function SignalList({ signals }) {
  if (!signals?.length) {
    return <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No trust signals recorded.</p>;
  }
  return (
    <div className="space-y-1">
      {signals.slice(0, 4).map((signal, index) => (
        <div key={`${signal.type}-${index}`} className="rounded-lg px-2.5 py-1.5 text-xs"
          style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
          <span className="font-mono" style={{ color: 'var(--color-muted)' }}>{signal.source}</span>
          <span style={{ color: 'var(--color-muted)' }}> — </span>
          {signal.reason}
          {signal.evidenceLevel === 'partial' && (
            <div style={{ marginTop: 3, color: '#b45309' }}>
              Partial evidence gap: this does not mean every check failed.
            </div>
          )}
          {signal.action && (
            <div style={{ marginTop: 3, color: '#b45309' }}>
              Fix: {signal.action}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function DependencyList({ dependencies, contract = [], runs = [], onSelectRun }) {
  if (!dependencies?.length && !contract?.length) return null;
  const runIds = new Set(runs.map((run) => run.id));
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
      <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>
        Chained Dependencies
      </p>
      {contract?.length > 0 && (
        <div className="mb-3 space-y-1">
          {contract.map((dep) => (
            <div key={`contract-${dep.slug}`} className="text-xs" style={{ color: 'var(--color-muted)' }}>
              <span className="font-mono">{dep.slug}</span>
              <span> · {dep.required ? 'required' : 'optional'}</span>
              {dep.maxAgeDays != null && <span> · max {dep.maxAgeDays}d</span>}
              {dep.allowedStatuses?.length > 0 && <span> · allowed: {dep.allowedStatuses.join(', ')}</span>}
            </div>
          ))}
        </div>
      )}
      <div className="space-y-2">
        {dependencies.map((dep) => (
          <div key={dep.runId} className="rounded-lg border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="flex justify-between gap-3 text-xs">
              <span style={{ color: 'var(--color-text)' }}>{dep.label ?? dep.slug}</span>
              <span style={{ color: dep.stale || dep.status === 'needs_review' ? '#d97706' : '#16a34a' }}>
                {dep.stale ? 'stale' : dep.status === 'needs_review' ? 'needs review' : 'valid'}
              </span>
            </div>
            <div className="flex justify-between gap-3 text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
              <span>{fmtDate(dep.runAt)}{dep.ageDays != null ? ` · ${dep.ageDays}d old` : ''}</span>
              <span>{dep.usage}</span>
            </div>
            <button
              type="button"
              disabled={!runIds.has(dep.runId)}
              onClick={() => onSelectRun?.(dep.runId)}
              className="text-xs font-mono mt-1 text-left"
              style={{
                color: runIds.has(dep.runId) ? 'var(--color-primary)' : 'var(--color-muted)',
                background: 'transparent',
                border: 0,
                padding: 0,
                cursor: runIds.has(dep.runId) ? 'pointer' : 'default',
              }}
            >
              run_id: {dep.runId}{runIds.has(dep.runId) ? ' · open upstream' : ''}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function WorkflowContractPanel({ workflow }) {
  if (!workflow) return null;
  const stages = workflow.stages ?? [];
  const gates = workflow.gates ?? [];
  return (
    <div className="rounded-xl border p-3 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
          Hybrid Workflow Contract
        </p>
        <p className="text-sm font-semibold mt-1" style={{ color: 'var(--color-text)' }}>{workflow.label}</p>
        {workflow.purpose && <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{workflow.purpose}</p>}
        {workflow.deterministicAuthority && (
          <p className="text-xs mt-2 rounded-lg px-2 py-1.5" style={{ color: '#92400e', background: '#fef3c7' }}>
            {workflow.deterministicAuthority}
          </p>
        )}
      </div>

      {stages.length > 0 && (
        <div className="space-y-1.5">
          {stages.map((stage, index) => (
            <div key={stage.id ?? `${stage.label}-${index}`} className="rounded-lg border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
              <div className="flex justify-between gap-3 text-xs">
                <span className="font-semibold" style={{ color: 'var(--color-text)' }}>{index + 1}. {stage.label}</span>
                <span style={{ color: stage.blocksOnFailure ? '#dc2626' : 'var(--color-muted)' }}>
                  {stage.kind}{stage.blocksOnFailure ? ' · blocking' : ''}
                </span>
              </div>
              <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                {stage.actor ? `${stage.actor}: ` : ''}{stage.output}
              </p>
            </div>
          ))}
        </div>
      )}

      {gates.length > 0 && (
        <div className="space-y-1">
          {gates.map((gate) => (
            <p key={gate.id} className="text-xs" style={{ color: 'var(--color-muted)' }}>
              <span className="font-semibold" style={{ color: 'var(--color-text)' }}>{gate.label}:</span> {gate.condition}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function ObservabilityPanel({ run }) {
  const obs = run?.observability ?? {};
  const tokens = obs.tokens ?? {};
  const toolCalls = obs.trace_summary?.tool_calls ?? [];
  const fallbackEvents = obs.fallback_events ?? [];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <DetailCard label="Model" value={obs.model} sub={obs.model_source ? `source: ${obs.model_source}` : null} />
        <DetailCard label="Fallback" value={obs.fallback_model || 'None'} sub={obs.fallback_model_source ? `source: ${obs.fallback_model_source}` : null} />
        <DetailCard label="Cost" value={fmtAud(obs.cost_aud)} sub={`${fmtTokens(tokens.input)} in · ${fmtTokens(tokens.output)} out`} />
        <DetailCard label="Duration" value={fmtDuration(obs.duration_ms)} sub={obs.prompt_version ? `prompt: ${obs.prompt_version}` : null} />
      </div>

      {(obs.capability_warnings?.length > 0 || fallbackEvents.length > 0 || toolCalls.length > 0 || obs.progress_count > 0) && (
        <div className="rounded-xl border p-3 space-y-2" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Run Trail</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs" style={{ color: 'var(--color-muted)' }}>
            <span>Progress steps: {obs.progress_count ?? 0}</span>
            <span>Iterations: {obs.trace_summary?.iterations ?? 0}</span>
            <span>Tool calls: {toolCalls.length}</span>
            <span>Fallbacks: {fallbackEvents.length}</span>
          </div>
          {obs.capability_warnings?.map((warning, index) => (
            <p key={`cap-${index}`} className="text-xs" style={{ color: '#b45309' }}>{warning}</p>
          ))}
          {fallbackEvents.map((event, index) => (
            <p key={`fallback-${index}`} className="text-xs" style={{ color: '#b45309' }}>
              Fallback: {event.from} → {event.to}{event.reason ? ` (${event.reason})` : ''}
            </p>
          ))}
          {toolCalls.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {toolCalls.slice(0, 8).map((tool, index) => (
                <span
                  key={`${tool.name}-${index}`}
                  className="text-xs rounded px-1.5 py-0.5"
                  style={{ background: 'var(--color-surface)', color: tool.status === 'error' ? '#dc2626' : 'var(--color-muted)' }}
                >
                  {tool.name}{tool.fromCache ? ' cache' : ''}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminAgentTrustPage() {
  const [days, setDays] = useState(30);
  const [filter, setFilter] = useState('all');
  const [data, setData] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [showReport, setShowReport] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    api.get(`/admin/agent-trust?days=${days}&scope=all`)
      .then((payload) => {
        setData(payload);
        setSelectedId((current) => (
          payload.runs?.some((run) => run.id === current) ? current : payload.runs?.[0]?.id ?? null
        ));
        setShowReport(false);
      })
      .catch((e) => setError(e.message || 'Failed to load agent trust queue'))
      .finally(() => setLoading(false));
  }, [days]);

  const runs = data?.runs ?? [];
  const filteredRuns = useMemo(() => {
    if (filter === 'signals') return runs.filter((run) => run.signals?.length > 0);
    if (filter === 'needs_review') return runs.filter((run) => run.status === 'needs_review');
    if (filter === 'data_gaps') {
      return runs.filter((run) => (
        run.declaredDataGaps?.length > 0 ||
        run.confirmedDataGaps?.length > 0 ||
        run.silentDataGaps?.length > 0 ||
        run.signals?.some((signal) => signal.type === 'missing_gap_section' || signal.type === 'silent_data_gap')
      ));
    }
    if (filter === 'dependencies') return runs.filter((run) => run.dependencies?.length > 0 || run.signals?.some((signal) => signal.type?.startsWith('dependency_')));
    if (filter === 'workflows') return runs.filter((run) => run.workflowContract);
    if (filter === 'fallbacks') return runs.filter((run) => run.observability?.fallback_used);
    if (filter === 'errors') return runs.filter((run) => run.status === 'error');
    return runs;
  }, [filter, runs]);
  const selectedRun = useMemo(
    () => filteredRuns.find((run) => run.id === selectedId) ?? filteredRuns[0] ?? null,
    [filteredRuns, selectedId]
  );
  const summary = data?.summary ?? {};

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Agent Trust</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
            Log of recent agent runs with trust signals, data gaps, dependency warnings, and errors.
          </p>
        </div>
        <div className="flex gap-1 rounded-xl p-1" style={{ background: 'var(--color-border)' }}>
          {PERIODS.map((period) => (
            <button
              key={period}
              onClick={() => setDays(period)}
              className="rounded-lg px-3 py-1.5 text-sm font-medium"
              style={{
                background: days === period ? 'var(--color-surface)' : 'transparent',
                color: days === period ? 'var(--color-text)' : 'var(--color-muted)',
              }}
            >
              {period}d
            </button>
          ))}
        </div>
      </div>

      {error && <InlineBanner type="error" message={error} onDismiss={() => setError('')} />}

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-7 gap-4">
            <StatCard label="Log entries" value={summary.total_runs ?? runs.length} sub={`last ${days} days`} />
            <StatCard label="Needs review" value={summary.runs_needing_review ?? 0} sub="runs" />
            <StatCard label="Errors" value={summary.error_runs ?? 0} sub="failed runs" />
            <StatCard label="Silent gaps" value={summary.silent_data_gaps ?? 0} sub="undisclosed missing data" />
            <StatCard label="Signals" value={summary.total_signals ?? 0} sub={`last ${days} days`} />
            <StatCard label="Cost" value={fmtAud(summary.total_cost_aud)} sub={`${fmtTokens(summary.total_input_tokens)} in · ${fmtTokens(summary.total_output_tokens)} out`} />
            <StatCard label="Fallbacks" value={summary.fallback_runs ?? 0} sub="model retries" />
          </div>

          <section className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="p-4 border-b flex items-start justify-between gap-4 flex-wrap" style={{ borderColor: 'var(--color-border)' }}>
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Trust Log</p>
                <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                  Showing {filteredRuns.length} of {runs.length} recent run{runs.length === 1 ? '' : 's'}
                </p>
              </div>
              <div className="flex gap-1 flex-wrap">
                {FILTERS.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      setFilter(item.id);
                      setShowReport(false);
                    }}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium"
                    style={{
                      background: filter === item.id ? 'var(--color-bg)' : 'transparent',
                      color: filter === item.id ? 'var(--color-text)' : 'var(--color-muted)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="max-h-[520px] overflow-y-auto">
              {filteredRuns.length === 0 ? (
                <p className="text-sm p-4" style={{ color: 'var(--color-muted)' }}>No runs match this filter for this period.</p>
              ) : filteredRuns.map((run) => (
                <button
                  key={run.id}
                  onClick={() => {
                    setSelectedId(run.id);
                    setShowReport(false);
                  }}
                  className="w-full text-left p-4 border-b"
                  style={{
                    borderColor: 'var(--color-border)',
                    background: selectedRun?.id === run.id ? 'var(--color-bg)' : 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{run.slug}</p>
                      <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                        {fmtDate(run.run_at)} · {run.observability?.model ?? 'no model'} · {fmtAud(run.observability?.cost_aud)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs rounded-full px-2 py-1" style={{ color: 'var(--color-muted)', background: 'var(--color-surface)' }}>
                        {run.signals?.length ?? 0} signal{run.signals?.length === 1 ? '' : 's'}
                      </span>
                      {run.workflowContract && (
                        <span className="text-xs rounded-full px-2 py-1" style={{ color: 'var(--color-primary)', background: 'var(--color-bg)' }}>
                          workflow
                        </span>
                      )}
                      <span className="text-xs font-semibold uppercase" style={{ color: statusColor(run.status) }}>
                        {run.status}
                      </span>
                    </div>
                  </div>
                  <div className="mt-3">
                    <SignalList signals={run.signals} />
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-xl border p-5 min-h-[320px]" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            {!selectedRun ? (
              <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Select a run to review.</p>
            ) : (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Selected Run</p>
                    <h2 className="text-lg font-semibold mt-1" style={{ color: 'var(--color-text)' }}>{selectedRun.slug}</h2>
                    <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{fmtDate(selectedRun.run_at)}</p>
                  </div>
                  <span className="text-xs font-semibold uppercase rounded-full px-2.5 py-1"
                    style={{ color: statusColor(selectedRun.status), background: `${statusColor(selectedRun.status)}20` }}>
                    {selectedRun.status}
                  </span>
                </div>

                <SignalList signals={selectedRun.signals} />
                <ObservabilityPanel run={selectedRun} />
                <WorkflowContractPanel workflow={selectedRun.workflowContract} />
                <DependencyList
                  dependencies={selectedRun.dependencies}
                  contract={selectedRun.dependencyContract}
                  runs={runs}
                  onSelectRun={(runId) => {
                    setSelectedId(runId);
                    setShowReport(false);
                  }}
                />
                <BoundsWarningPanel boundsFailed={selectedRun.result?.boundsFailed} />
                <DataGapsPanel dataGaps={selectedRun.declaredDataGaps} review={selectedRun.result?.data_gap_review} />

                {selectedRun.result?.summary ? (
                  <div className="rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                    <button
                      onClick={() => setShowReport((current) => !current)}
                      className="w-full text-left p-4 flex items-center justify-between gap-3"
                      style={{ color: 'var(--color-text)' }}
                    >
                      <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                        Report Summary
                      </span>
                      <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                        {showReport ? 'Hide' : 'Show'}
                      </span>
                    </button>
                    {showReport && (
                      <div className="p-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
                        <MarkdownRenderer text={selectedRun.result.summary} />
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No report summary available.</p>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
