/**
 * AdminAgentTrustPage — review queue for agent outputs that need human attention.
 */
import { useEffect, useMemo, useState } from 'react';
import api from '../../api/client';
import InlineBanner from '../../components/ui/InlineBanner';
import MarkdownRenderer from '../../components/ui/MarkdownRenderer';
import BoundsWarningPanel from '../../components/ui/BoundsWarningPanel';
import DataGapsPanel from '../../components/ui/DataGapsPanel';

const PERIODS = [7, 30, 90];

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

function StatCard({ label, value, sub }) {
  return (
    <div className="rounded-xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>{label}</p>
      <p className="text-2xl font-bold mt-1" style={{ color: 'var(--color-text)' }}>{value}</p>
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

function DependencyList({ dependencies }) {
  if (!dependencies?.length) return null;
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
      <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>
        Chained Dependencies
      </p>
      <div className="space-y-1">
        {dependencies.map((dep) => (
          <div key={dep.runId} className="flex justify-between gap-3 text-xs">
            <span style={{ color: 'var(--color-text)' }}>{dep.label ?? dep.slug}</span>
            <span style={{ color: 'var(--color-muted)' }}>{fmtDate(dep.runAt)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdminAgentTrustPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    api.get(`/admin/agent-trust?days=${days}`)
      .then((payload) => {
        setData(payload);
        setSelectedId((current) => current ?? payload.runs?.[0]?.id ?? null);
      })
      .catch((e) => setError(e.message || 'Failed to load agent trust queue'))
      .finally(() => setLoading(false));
  }, [days]);

  const runs = data?.runs ?? [];
  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedId) ?? runs[0] ?? null,
    [runs, selectedId]
  );
  const summary = data?.summary ?? {};

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Agent Trust</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
            Review queue for weak evidence, missing data disclosure, and chained report handoffs.
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
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <StatCard label="Needs review" value={summary.runs_needing_review ?? 0} sub="runs" />
            <StatCard label="Silent gaps" value={summary.silent_data_gaps ?? 0} sub="undisclosed missing data" />
            <StatCard label="Missing sections" value={summary.missing_gap_sections ?? 0} sub="Data Gaps absent" />
            <StatCard label="Stale chains" value={summary.stale_chained_dependencies ?? 0} sub="dependency warnings" />
            <StatCard label="Signals" value={summary.total_signals ?? 0} sub={`last ${days} days`} />
          </div>

          <div className="grid lg:grid-cols-[360px,1fr] gap-5">
            <section className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
              <div className="p-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
                <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Review Queue</p>
                <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{runs.length} run{runs.length === 1 ? '' : 's'} with trust metadata</p>
              </div>
              <div className="max-h-[640px] overflow-y-auto">
                {runs.length === 0 ? (
                  <p className="text-sm p-4" style={{ color: 'var(--color-muted)' }}>No trust signals for this period.</p>
                ) : runs.map((run) => (
                  <button
                    key={run.id}
                    onClick={() => setSelectedId(run.id)}
                    className="w-full text-left p-4 border-b"
                    style={{
                      borderColor: 'var(--color-border)',
                      background: selectedRun?.id === run.id ? 'var(--color-bg)' : 'transparent',
                      cursor: 'pointer',
                    }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{run.slug}</p>
                      <span className="text-xs font-semibold uppercase" style={{ color: statusColor(run.status) }}>
                        {run.status}
                      </span>
                    </div>
                    <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{fmtDate(run.run_at)}</p>
                    <div className="mt-3">
                      <SignalList signals={run.signals} />
                    </div>
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-xl border p-5 min-h-[420px]" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
              {!selectedRun ? (
                <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Select a run to review.</p>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Run Detail</p>
                      <h2 className="text-lg font-semibold mt-1" style={{ color: 'var(--color-text)' }}>{selectedRun.slug}</h2>
                      <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{fmtDate(selectedRun.run_at)}</p>
                    </div>
                    <span className="text-xs font-semibold uppercase rounded-full px-2.5 py-1"
                      style={{ color: statusColor(selectedRun.status), background: `${statusColor(selectedRun.status)}20` }}>
                      {selectedRun.status}
                    </span>
                  </div>

                  <SignalList signals={selectedRun.signals} />
                  <DependencyList dependencies={selectedRun.dependencies} />
                  <BoundsWarningPanel boundsFailed={selectedRun.result?.boundsFailed} />
                  <DataGapsPanel dataGaps={selectedRun.declaredDataGaps} review={selectedRun.result?.data_gap_review} />

                  {selectedRun.result?.summary ? (
                    <div className="rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                      <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-muted)' }}>Report Summary</p>
                      <MarkdownRenderer text={selectedRun.result.summary} />
                    </div>
                  ) : (
                    <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No report summary available.</p>
                  )}
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
