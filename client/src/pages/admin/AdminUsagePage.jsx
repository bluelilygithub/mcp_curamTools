import { useState, useEffect } from 'react';
import api from '../../api/client';
import InlineBanner from '../../components/ui/InlineBanner';

const PERIODS = [7, 30, 90];

function fmtAud(val) {
  const n = Number(val ?? 0);
  return `$${n.toFixed(4)}`;
}

function fmtTokens(val) {
  const n = Number(val ?? 0);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtPct(val) {
  return `${(Number(val ?? 0) * 100).toFixed(1)}%`;
}

function StatCard({ label, value, sub }) {
  return (
    <div
      className="rounded-2xl border p-5 flex flex-col gap-1"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
    >
      <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
        {label}
      </p>
      <p className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>{value}</p>
      {sub && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{sub}</p>}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section
      className="rounded-2xl border p-6 space-y-4"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
    >
      <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function UsageTable({ rows, keyField, keyLabel }) {
  if (!rows?.length) {
    return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No data for this period.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
            <th className="text-left py-2 pr-4 font-medium">{keyLabel}</th>
            <th className="text-right py-2 px-2 font-medium">Runs</th>
            <th className="text-right py-2 px-2 font-medium">Input</th>
            <th className="text-right py-2 px-2 font-medium">Output</th>
            <th className="text-right py-2 px-2 font-medium">Cache read</th>
            <th className="text-right py-2 pl-2 font-medium">Cost (AUD)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r[keyField]}
              style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text)' }}
            >
              <td className="py-2 pr-4 font-mono text-xs" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r[keyField]}
              </td>
              <td className="text-right py-2 px-2">{r.runs}</td>
              <td className="text-right py-2 px-2">{fmtTokens(r.input_tokens)}</td>
              <td className="text-right py-2 px-2">{fmtTokens(r.output_tokens)}</td>
              <td className="text-right py-2 px-2">{fmtTokens(r.cache_read_tokens)}</td>
              <td className="text-right py-2 pl-2 font-medium">{fmtAud(r.cost_aud)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DailyChart({ daily }) {
  if (!daily?.length) {
    return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No data for this period.</p>;
  }
  const maxCost = Math.max(...daily.map((d) => Number(d.cost_aud)), 0.000001);
  return (
    <div className="space-y-2">
      {daily.map((d) => {
        const pct = (Number(d.cost_aud) / maxCost) * 100;
        const label = typeof d.day === 'string' ? d.day : new Date(d.day).toISOString().slice(0, 10);
        return (
          <div key={label} className="flex items-center gap-3">
            <span
              className="text-xs font-mono shrink-0 text-right"
              style={{ width: 80, color: 'var(--color-muted)' }}
            >
              {label}
            </span>
            <div
              className="flex-1 rounded-full overflow-hidden"
              style={{ height: 8, background: 'var(--color-border)' }}
            >
              <div
                className="h-full rounded-full"
                style={{ width: `${pct}%`, background: 'var(--color-primary)', transition: 'width 300ms ease' }}
              />
            </div>
            <span
              className="text-xs shrink-0 text-right font-medium"
              style={{ width: 64, color: 'var(--color-text)' }}
            >
              {fmtAud(d.cost_aud)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function AdminUsagePage() {
  const [days,    setDays]    = useState(30);
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    api.get(`/admin/usage-stats?days=${days}`)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [days]);

  const t = data?.totals ?? {};
  const totalTokens =
    (t.input_tokens ?? 0) + (t.output_tokens ?? 0) +
    (t.cache_read_tokens ?? 0) + (t.cache_creation_tokens ?? 0);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">

      {/* Header + period selector */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Token Usage</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
            AI token consumption and cost across all agents and tools.
          </p>
        </div>
        <div
          className="flex gap-1 rounded-xl p-1"
          style={{ background: 'var(--color-border)' }}
        >
          {PERIODS.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
              style={{
                background: days === d ? 'var(--color-surface)' : 'transparent',
                color:      days === d ? 'var(--color-text)'    : 'var(--color-muted)',
              }}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {error && <InlineBanner type="error" message={error} onDismiss={() => setError('')} />}

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Total cost"
              value={fmtAud(t.cost_aud)}
              sub={`AUD — ${t.runs ?? 0} runs`}
            />
            <StatCard
              label="Total tokens"
              value={fmtTokens(totalTokens)}
              sub={`${fmtTokens(t.output_tokens)} output`}
            />
            <StatCard
              label="Cache hit rate"
              value={fmtPct(t.cache_hit_rate)}
              sub={`${fmtTokens(t.cache_read_tokens)} cached reads`}
            />
            <StatCard
              label="Est. cache savings"
              value={fmtAud(t.cache_savings_aud)}
              sub="AUD vs uncached"
            />
          </div>

          {/* Daily cost chart */}
          <Section title={`Daily cost (AUD) — last ${days} days`}>
            <DailyChart daily={data?.daily} />
          </Section>

          {/* Breakdowns */}
          <div className="grid md:grid-cols-2 gap-6">
            <Section title="By model">
              <UsageTable rows={data?.by_model} keyField="model_id" keyLabel="Model" />
            </Section>
            <Section title="By agent / tool">
              <UsageTable rows={data?.by_tool} keyField="tool_slug" keyLabel="Agent" />
            </Section>
          </div>
        </>
      )}
    </div>
  );
}
