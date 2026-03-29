/**
 * AdminLogsPage — usage log viewer with model, token, and cost columns.
 */
import { useState, useEffect } from 'react';
import api from '../../api/client';
import InlineBanner from '../../components/ui/InlineBanner';
import EmptyState from '../../components/ui/EmptyState';

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-AU', { dateStyle: 'short', timeStyle: 'short' });
}

function formatCost(usd) {
  if (usd == null) return '—';
  return `$${parseFloat(usd).toFixed(4)} USD`;
}

export default function AdminLogsPage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/admin/logs?limit=100')
      .then(setLogs)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const totalTokens = logs.reduce((s, l) => s + (l.input_tokens || 0) + (l.output_tokens || 0), 0);
  const totalCost = logs.reduce((s, l) => s + parseFloat(l.cost_usd || 0), 0);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Usage Logs</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>Recent AI usage across all tools. Showing last 100 records.</p>
      </div>

      {error && <InlineBanner type="error" message={error} />}

      {/* Summary stats */}
      {logs.length > 0 && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          {[
            { label: 'Total tokens', value: totalTokens.toLocaleString() },
            { label: 'Est. cost', value: formatCost(totalCost) },
          ].map(({ label, value }) => (
            <div
              key={label}
              className="rounded-xl border p-4"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
            >
              <p className="text-xs uppercase tracking-wider font-semibold mb-1" style={{ color: 'var(--color-muted)' }}>{label}</p>
              <p className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>{value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
        {loading ? (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</div>
        ) : logs.length === 0 ? (
          <EmptyState icon="activity" message="No usage logs yet." hint="Logs appear here after the first AI tool run." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="w-full" style={{ borderCollapse: 'collapse', minWidth: 600 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
                  {['Time', 'User', 'Tool', 'Model', 'In', 'Out', 'Cost'].map((col) => (
                    <th key={col} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-muted)' }}>{formatDate(l.created_at)}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text)' }}>{l.user_email || '—'}</td>
                    <td className="px-4 py-3 text-xs font-mono" style={{ color: 'var(--color-text)' }}>{l.tool_slug || '—'}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-muted)' }}>{l.model_id || '—'}</td>
                    <td className="px-4 py-3 text-xs text-right" style={{ color: 'var(--color-text)' }}>{(l.input_tokens || 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-xs text-right" style={{ color: 'var(--color-text)' }}>{(l.output_tokens || 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-xs text-right" style={{ color: 'var(--color-text)' }}>{formatCost(l.cost_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
