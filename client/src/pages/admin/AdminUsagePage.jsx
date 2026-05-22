import { useState, useEffect } from 'react';
import api from '../../api/client';
import InlineBanner from '../../components/ui/InlineBanner';

const PERIODS = [7, 30, 90];

const WARNING_STYLES = {
  critical: { bg: 'var(--color-error-subtle, #fef2f2)', border: '#ef4444', text: '#b91c1c', icon: '🔴' },
  warning:  { bg: 'var(--color-warning-subtle, #fffbeb)', border: '#f59e0b', text: '#92400e', icon: '⚠️' },
  info:     { bg: 'var(--color-info-subtle, #eff6ff)',    border: '#3b82f6', text: '#1e40af', icon: 'ℹ️' },
};

function WarningBanner({ warning }) {
  const s = WARNING_STYLES[warning.severity] ?? WARNING_STYLES.info;
  return (
    <div
      className="rounded-xl px-4 py-3 flex gap-3 text-sm"
      style={{ background: s.bg, border: `1px solid ${s.border}` }}
    >
      <span>{s.icon}</span>
      <div>
        <span className="font-semibold" style={{ color: s.text }}>{warning.title} — </span>
        <span style={{ color: s.text }}>{warning.detail}</span>
      </div>
    </div>
  );
}

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

function HealthPanel({ intelligence }) {
  if (!intelligence) return null;

  const health = intelligence.health ?? {};
  const forecast = intelligence.forecast ?? {};
  const drivers = intelligence.topCostDrivers ?? [];
  const actions = intelligence.recommendedActions ?? [];
  const healthColor = {
    healthy:       '#16a34a',
    watch:         '#d97706',
    action_needed: '#dc2626',
  }[health.status] ?? 'var(--color-primary)';
  const budgetPct = forecast.daily_budget_pct != null ? Math.min(forecast.daily_budget_pct, 1.5) : null;

  return (
    <section
      className="rounded-2xl border p-6 space-y-5"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>
            Usage Health
          </p>
          <div className="flex items-end gap-3">
            <span className="text-3xl font-bold" style={{ color: healthColor }}>
              {health.label ?? 'Healthy'}
            </span>
            <span className="text-sm mb-1" style={{ color: 'var(--color-muted)' }}>
              {health.score ?? 100}/100
            </span>
          </div>
          <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
            {health.summary}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 min-w-[280px]">
          <div className="rounded-xl border p-3" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
            <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Month forecast</p>
            <p className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>{fmtAud(forecast.projected_month_aud)}</p>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              {fmtAud(forecast.month_to_date_aud)} month to date
            </p>
          </div>
          <div className="rounded-xl border p-3" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
            <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>7d daily avg</p>
            <p className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>{fmtAud(forecast.avg_7d_aud)}</p>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              {forecast.daily_budget_aud ? `${Math.round((forecast.daily_budget_pct ?? 0) * 100)}% of daily limit` : 'No daily limit set'}
            </p>
          </div>
        </div>
      </div>

      {budgetPct != null && (
        <div>
          <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--color-muted)' }}>
            <span>Daily budget pressure</span>
            <span>{Math.round((forecast.daily_budget_pct ?? 0) * 100)}%</span>
          </div>
          <div className="rounded-full overflow-hidden" style={{ height: 8, background: 'var(--color-border)' }}>
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(budgetPct * 100, 100)}%`,
                background: budgetPct >= 1 ? '#dc2626' : budgetPct >= 0.8 ? '#d97706' : '#16a34a',
              }}
            />
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>
            Recommended Actions
          </p>
          {actions.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No usage actions needed.</p>
          ) : (
            <div className="space-y-2">
              {actions.map((action, idx) => {
                const style = WARNING_STYLES[action.severity] ?? WARNING_STYLES.info;
                return (
                  <div key={`${action.type}-${idx}`} className="rounded-xl border p-3" style={{ borderColor: style.border, background: style.bg }}>
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-semibold" style={{ color: style.text }}>{action.title}</p>
                      {action.metric && <span className="text-xs whitespace-nowrap" style={{ color: style.text }}>{action.metric}</span>}
                    </div>
                    <p className="text-xs mt-1" style={{ color: style.text }}>{action.detail}</p>
                    <p className="text-xs mt-2 font-medium" style={{ color: style.text }}>{action.action}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>
            Top Cost Drivers
          </p>
          {drivers.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No usage recorded yet.</p>
          ) : (
            <div className="space-y-2">
              {drivers.map((driver) => (
                <div key={driver.tool_slug} className="rounded-xl border p-3" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-mono text-xs" style={{ color: 'var(--color-text)' }}>{driver.tool_slug}</span>
                    <span className="font-semibold" style={{ color: 'var(--color-text)' }}>{fmtAud(driver.cost_aud)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                    <span>{driver.runs} runs · avg {fmtAud(driver.avg_cost_aud)}</span>
                    <span>{Math.round((driver.share_of_cost ?? 0) * 100)}% of 30d spend</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default function AdminUsagePage() {
  const [days,     setDays]     = useState(30);
  const [data,     setData]     = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [intel,    setIntel]    = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    Promise.all([
      api.get(`/admin/usage-stats?days=${days}`),
      api.get('/admin/usage-warnings'),
      api.get('/admin/usage-intelligence'),
    ])
      .then(([stats, warn, intelligence]) => {
        setData(stats);
        setWarnings(warn.warnings ?? []);
        setIntel(intelligence);
      })
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
          <HealthPanel intelligence={intel} />

          {/* Warnings */}
          {warnings.length > 0 && (
            <div className="space-y-2">
              {warnings.map((w, i) => <WarningBanner key={i} warning={w} />)}
            </div>
          )}

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
