/**
 * AdminDiagnosticsPage — runs backend health checks and displays pass/fail for
 * each integration: Database, Anthropic API, MailChannels, MCP Registry,
 * Google OAuth, Google Ads API, Google Analytics GA4.
 */
import { useState } from 'react';
import api from '../../api/client';
import Button from '../../components/ui/Button';
import InlineBanner from '../../components/ui/InlineBanner';

function StatusBadge({ ok }) {
  const bg    = ok ? '#16a34a' : '#dc2626';
  const label = ok ? 'OK'      : 'FAIL';
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold text-white"
      style={{ background: bg, minWidth: 44, justifyContent: 'center' }}
    >
      {label}
    </span>
  );
}

function CheckRow({ name, ok, detail }) {
  return (
    <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
      <td className="px-4 py-3 text-sm font-medium" style={{ color: 'var(--color-text)', width: 200 }}>
        {name}
      </td>
      <td className="px-4 py-3" style={{ width: 72 }}>
        <StatusBadge ok={ok} />
      </td>
      <td className="px-4 py-3 text-sm font-mono" style={{ color: ok ? 'var(--color-muted)' : '#dc2626' }}>
        {detail || '—'}
      </td>
    </tr>
  );
}

export default function AdminDiagnosticsPage() {
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  async function runChecks() {
    setLoading(true);
    setError('');
    setResults(null);
    try {
      const data = await api.post('/admin/diagnostics', {});
      setResults(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const passCount = results?.filter(r => r.ok).length ?? 0;
  const failCount = results?.filter(r => !r.ok).length ?? 0;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Diagnostics</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
            Run a live health check on all external integrations and services.
          </p>
        </div>
        <Button onClick={runChecks} disabled={loading}>
          {loading ? 'Running…' : 'Run Checks'}
        </Button>
      </div>

      {error && <InlineBanner type="error" message={error} className="mb-4" />}

      {results && (
        <>
          {/* Summary row */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            {[
              { label: 'Passed', value: passCount, color: '#16a34a' },
              { label: 'Failed', value: failCount, color: failCount > 0 ? '#dc2626' : 'var(--color-muted)' },
            ].map(({ label, value, color }) => (
              <div
                key={label}
                className="rounded-xl border p-4"
                style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
              >
                <p className="text-xs uppercase tracking-wider font-semibold mb-1" style={{ color: 'var(--color-muted)' }}>{label}</p>
                <p className="text-lg font-bold" style={{ color }}>{value}</p>
              </div>
            ))}
          </div>

          {/* Results table */}
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
            <table className="w-full" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
                  {['Check', 'Status', 'Detail'].map(col => (
                    <th
                      key={col}
                      className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider"
                      style={{ color: 'var(--color-muted)' }}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map(r => (
                  <CheckRow key={r.name} name={r.name} ok={r.ok} detail={r.detail} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!results && !loading && (
        <div
          className="rounded-2xl border p-10 text-center text-sm"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
        >
          Press <strong>Run Checks</strong> to test all integrations.
        </div>
      )}
    </div>
  );
}
