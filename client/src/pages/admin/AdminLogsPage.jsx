/**
 * AdminLogsPage — two tabs: Usage Logs (AI cost/token tracking) and Server Logs (app_logs).
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../api/client';
import { fmtDateTime } from '../../utils/date';
import InlineBanner from '../../components/ui/InlineBanner';
import EmptyState from '../../components/ui/EmptyState';
import Button from '../../components/ui/Button';
import { useIcon } from '../../providers/IconProvider';

// ── Shared styles ─────────────────────────────────────────────────────────────

const TABS = ['Usage Logs', 'Server Logs'];

const LEVEL_STYLE = {
  error: { background: 'rgba(239,68,68,0.10)',  color: '#ef4444' },
  warn:  { background: 'rgba(245,158,11,0.10)', color: '#d97706' },
  info:  { background: 'rgba(99,102,241,0.10)', color: '#6366f1' },
};

const SERVER_LEVELS = ['all', 'error', 'warn', 'info'];

function formatDate(iso) {
  if (!iso) return '—';
  return fmtDateTime(iso);
}

function formatCost(usd) {
  if (usd == null) return '—';
  return `$${parseFloat(usd).toFixed(4)} USD`;
}

// ── Usage Logs tab ────────────────────────────────────────────────────────────

function UsageLogsTab() {
  const [logs, setLogs]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    api.get('/admin/logs?limit=100')
      .then(setLogs)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const totalTokens = logs.reduce((s, l) => s + (l.input_tokens || 0) + (l.output_tokens || 0), 0);
  const totalCost   = logs.reduce((s, l) => s + parseFloat(l.cost_usd || 0), 0);

  return (
    <>
      {error && <InlineBanner type="error" message={error} className="mb-4" />}

      {logs.length > 0 && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          {[
            { label: 'Total tokens', value: totalTokens.toLocaleString() },
            { label: 'Est. cost',    value: formatCost(totalCost) },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
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
                    <th key={col} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>{col}</th>
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
    </>
  );
}

// ── Server Logs tab ───────────────────────────────────────────────────────────

const LIMIT = 50;

function ServerLogsTab() {
  const getIcon = useIcon();
  const [logs, setLogs]               = useState([]);
  const [total, setTotal]             = useState(0);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [level, setLevel]             = useState('all');
  const [search, setSearch]           = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [offset, setOffset]           = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [expanded, setExpanded]       = useState(null);
  const intervalRef = useRef(null);

  const fetchLogs = useCallback(() => {
    const params = new URLSearchParams({ limit: LIMIT, offset });
    if (level !== 'all') params.set('level', level);
    if (search) params.set('search', search);

    api.get(`/admin/server-logs?${params}`)
      .then((data) => { setLogs(data.logs || []); setTotal(data.total || 0); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [level, search, offset]);

  useEffect(() => { setLoading(true); fetchLogs(); }, [fetchLogs]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchLogs, 15000);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [autoRefresh, fetchLogs]);

  const handleSearch = (e) => { e.preventDefault(); setOffset(0); setSearch(searchInput); };

  const totalPages  = Math.ceil(total / LIMIT);
  const currentPage = Math.floor(offset / LIMIT) + 1;

  return (
    <>
      {error && <InlineBanner type="error" message={error} onDismiss={() => setError('')} className="mb-4" />}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex rounded-xl border overflow-hidden text-xs" style={{ borderColor: 'var(--color-border)' }}>
          {SERVER_LEVELS.map((l) => (
            <button
              key={l}
              onClick={() => { setLevel(l); setOffset(0); }}
              className="px-3 py-1.5 font-medium capitalize transition-colors"
              style={{
                background: level === l ? 'var(--color-primary)' : 'var(--color-surface)',
                color:      level === l ? '#fff' : 'var(--color-muted)',
              }}
            >
              {l}
            </button>
          ))}
        </div>

        <form onSubmit={handleSearch} className="flex items-center gap-2 flex-1 min-w-48">
          <input
            type="text" value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search messages…"
            className="flex-1 px-3 py-1.5 rounded-xl border text-sm outline-none"
            style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          />
          <Button variant="primary" type="submit">Search</Button>
          {search && (
            <button type="button" onClick={() => { setSearchInput(''); setSearch(''); setOffset(0); }} className="text-xs hover:opacity-70" style={{ color: 'var(--color-muted)' }}>
              Clear
            </button>
          )}
        </form>

        <button
          onClick={() => setAutoRefresh((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-opacity hover:opacity-70"
          style={{
            borderColor: autoRefresh ? 'var(--color-primary)' : 'var(--color-border)',
            color:       autoRefresh ? 'var(--color-primary)' : 'var(--color-muted)',
          }}
        >
          {getIcon('refresh-cw', { size: 12 })} {autoRefresh ? 'Auto on' : 'Auto-refresh'}
        </button>

        <button onClick={() => { setLoading(true); fetchLogs(); }} className="w-8 h-8 flex items-center justify-center rounded-lg hover:opacity-60" style={{ color: 'var(--color-muted)' }} title="Refresh">
          {getIcon('refresh-cw', { size: 15 })}
        </button>

        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{total} {total === 1 ? 'entry' : 'entries'}</p>
      </div>

      <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
        {loading ? (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</div>
        ) : logs.length === 0 ? (
          <EmptyState icon="file-text" message="No server log entries." hint="Warnings and errors will appear here automatically." />
        ) : (
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
                {['Time', 'Level', 'Message', ''].map((col) => (
                  <th key={col} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                const style    = LEVEL_STYLE[log.level] || { background: 'var(--color-surface)', color: 'var(--color-muted)' };
                const isExpanded = expanded === log.id;
                const hasMeta    = log.meta && Object.keys(log.meta).length > 0;
                return (
                  <>
                    <tr key={log.id} style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg)' }}>
                      <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: 'var(--color-muted)' }}>{formatDate(log.created_at)}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold uppercase" style={style}>{log.level}</span>
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text)' }}>{log.message}</td>
                      <td className="px-4 py-3 text-right">
                        {hasMeta && (
                          <button onClick={() => setExpanded(isExpanded ? null : log.id)} className="text-xs hover:opacity-70" style={{ color: 'var(--color-muted)' }}>
                            {getIcon(isExpanded ? 'chevron-up' : 'chevron-down', { size: 14 })}
                          </button>
                        )}
                      </td>
                    </tr>
                    {isExpanded && hasMeta && (
                      <tr key={`${log.id}-meta`} style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
                        <td colSpan={4} className="px-4 py-3">
                          <pre className="text-xs rounded-xl p-3 overflow-x-auto" style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
                            {JSON.stringify(log.meta, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <Button variant="secondary" onClick={() => setOffset((o) => Math.max(0, o - LIMIT))} disabled={offset === 0}>
            {getIcon('chevron-left', { size: 12 })} Previous
          </Button>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Page {currentPage} of {totalPages}</p>
          <Button variant="secondary" onClick={() => setOffset((o) => o + LIMIT)} disabled={offset + LIMIT >= total}>
            Next {getIcon('chevron-right', { size: 12 })}
          </Button>
        </div>
      )}
    </>
  );
}

// ── Page shell ────────────────────────────────────────────────────────────────

export default function AdminLogsPage() {
  const [tab, setTab] = useState('Usage Logs');

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Logs</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>AI usage and server activity.</p>
      </div>

      {/* Tab bar */}
      <div className="flex rounded-xl border overflow-hidden text-sm mb-6" style={{ borderColor: 'var(--color-border)', width: 'fit-content' }}>
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-4 py-2 font-medium transition-colors"
            style={{
              background: tab === t ? 'var(--color-primary)' : 'var(--color-surface)',
              color:      tab === t ? '#fff' : 'var(--color-muted)',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Usage Logs'  && <UsageLogsTab />}
      {tab === 'Server Logs' && <ServerLogsTab />}
    </div>
  );
}
