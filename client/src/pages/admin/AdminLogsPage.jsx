/**
 * AdminLogsPage — two tabs: Usage Logs (AI cost/token tracking) and Server Logs (app_logs).
 * Card-based presentation matching the Decision Log page style from the demo app.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../api/client';
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

function formatCost(usd) {
  if (usd == null) return '—';
  return `$${parseFloat(usd).toFixed(4)} USD`;
}

const fmtTs = (s) => {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-AU', { dateStyle: 'short', timeStyle: 'short' });
};

const fmtTokens = (t) => {
  if (!t) return '—';
  return t.toLocaleString('en-AU');
};

// ── Action bar (Export / Empty) ───────────────────────────────────────────────

function ActionBar({ onExport, onEmpty, emptyLabel = 'Empty' }) {
  const getIcon = useIcon();
  const [confirmEmpty, setConfirmEmpty] = useState(false);

  return (
    <div className="flex items-center gap-2 mb-4">
      <button
        onClick={onExport}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-opacity hover:opacity-70"
        style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
      >
        {getIcon('download', { size: 12 })}
        Export
      </button>

      {confirmEmpty ? (
        <div className="flex items-center gap-1">
          <Button variant="danger" onClick={() => { onEmpty(); setConfirmEmpty(false); }}>Confirm</Button>
          <button
            onClick={() => setConfirmEmpty(false)}
            className="px-3 py-1.5 rounded-lg text-xs border transition-opacity hover:opacity-70"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirmEmpty(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-opacity hover:opacity-70"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
        >
          {getIcon('trash', { size: 12 })}
          {emptyLabel}
        </button>
      )}
    </div>
  );
}

// ── Usage Logs tab ────────────────────────────────────────────────────────────

function UsageLogsTab() {
  const getIcon = useIcon();
  const [logs, setLogs]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [expandedRun, setExpandedRun] = useState(null);

  const fetchLogs = () => {
    setLoading(true);
    api.get('/admin/logs?limit=100')
      .then(setLogs)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchLogs(); }, []);

  const handleEmpty = async () => {
    try {
      await api.delete('/admin/logs');
      setLogs([]);
    } catch (e) {
      setError(e.message);
    }
  };

  const handleExport = () => {
    const a = document.createElement('a');
    a.href = '/api/admin/logs/export';
    a.download = 'usage-logs.json';
    a.click();
  };

  const totalTokens = logs.reduce((s, l) => s + (l.input_tokens || 0) + (l.output_tokens || 0), 0);
  const totalCost   = logs.reduce((s, l) => s + parseFloat(l.cost_usd || 0), 0);

  if (loading) {
    return (
      <div className="p-8 flex items-center gap-2" style={{ color: 'var(--color-muted)' }}>
        {getIcon('loader', { size: 16 })}
        <span className="text-sm">Loading usage logs…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <p className="text-sm" style={{ color: '#dc2626' }}>{error}</p>
      </div>
    );
  }

  return (
    <>
      {/* Summary cards */}
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

      <ActionBar onExport={handleExport} onEmpty={handleEmpty} emptyLabel="Empty usage logs" />

      {logs.length === 0 ? (
        <EmptyState icon="activity" message="No usage logs yet." hint="Logs appear here after the first AI tool run." />
      ) : (
        <div className="space-y-3">
          {logs.map((l) => (
            <UsageLogCard
              key={l.id}
              log={l}
              expanded={expandedRun === l.id}
              onToggle={() => setExpandedRun(expandedRun === l.id ? null : l.id)}
              getIcon={getIcon}
            />
          ))}
        </div>
      )}
    </>
  );
}

function UsageLogCard({ log, expanded, onToggle, getIcon }) {
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
    >
      {/* Summary row — always visible */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-4 text-left transition-colors hover:opacity-80"
        style={{ background: 'none', border: 'none', cursor: 'pointer' }}
      >
        <span style={{ color: 'var(--color-muted)', flexShrink: 0 }}>
          {getIcon(expanded ? 'chevron-down' : 'chevron-right', { size: 16 })}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              {log.tool_slug ?? 'Unknown tool'}
            </p>
            <span
              className="text-xs font-medium px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(99,102,241,0.10)', color: '#6366f1' }}
            >
              {log.model_id ?? '—'}
            </span>
          </div>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
            {fmtTs(log.created_at)} · {log.user_email ?? '—'}
          </p>
        </div>

        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
          {expanded ? 'Hide details' : 'View details'}
        </span>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ borderTop: '1px solid var(--color-border)' }}>
          <UsageLogDetail log={log} getIcon={getIcon} />
        </div>
      )}
    </div>
  );
}

function UsageLogDetail({ log, getIcon }) {
  // Build decision-style log entries
  const logEntries = [];

  // 1. Tool decision
  logEntries.push({
    type: 'decision',
    icon: 'cpu',
    label: 'Tool Execution',
    detail: `Tool: ${log.tool_slug ?? '—'}`,
    timestamp: log.created_at,
  });

  // 2. Model decision
  logEntries.push({
    type: 'decision',
    icon: 'bot',
    label: 'Model Selection',
    detail: `Model: ${log.model_id ?? '—'}`,
    timestamp: log.created_at,
  });

  // 3. Token usage step
  logEntries.push({
    type: 'step',
    icon: 'activity',
    label: 'Token Usage',
    detail: `${fmtTokens(log.input_tokens || 0)} input · ${fmtTokens(log.output_tokens || 0)} output`,
    timestamp: log.created_at,
  });

  // 4. Cost step
  logEntries.push({
    type: 'step',
    icon: 'trending-up',
    label: 'Cost',
    detail: formatCost(log.cost_usd),
    timestamp: log.created_at,
  });

  return (
    <div className="p-4 space-y-4">
      {/* Run metadata */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetaItem label="Tool" value={log.tool_slug ?? '—'} />
        <MetaItem label="Model" value={log.model_id ?? '—'} />
        <MetaItem label="User" value={log.user_email ?? '—'} />
        <MetaItem label="Time" value={fmtTs(log.created_at)} />
      </div>

      {/* Decision log entries */}
      <div className="space-y-0">
        <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>
          Decision Log
        </p>
        {logEntries.map((entry, i) => (
          <div key={i} className="flex gap-3">
            {/* Timeline spine */}
            <div className="flex flex-col items-center" style={{ width: 28, flexShrink: 0 }}>
              <div
                className="flex items-center justify-center rounded-full"
                style={{
                  width: 28,
                  height: 28,
                  background: entry.type === 'decision' ? '#fef3c7' : 'var(--color-surface)',
                  border: `2px solid ${entry.type === 'decision' ? '#f59e0b' : 'var(--color-border)'}`,
                  flexShrink: 0,
                }}
              >
                <span style={{ color: entry.type === 'decision' ? '#92400e' : 'var(--color-primary)' }}>
                  {getIcon(entry.icon, { size: 12 })}
                </span>
              </div>
              {i < logEntries.length - 1 && (
                <div style={{ width: 2, flex: 1, background: 'var(--color-border)', minHeight: 16 }} />
              )}
            </div>

            {/* Content */}
            <div className="pb-4 min-w-0 flex-1">
              <div className="flex items-baseline gap-2 flex-wrap">
                {entry.type === 'decision' && (
                  <span
                    className="text-xs font-medium px-1.5 py-0.5 rounded-full"
                    style={{ background: '#fef3c7', color: '#92400e' }}
                  >
                    Decision
                  </span>
                )}
                <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
                  {entry.label}
                </p>
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  {fmtTs(entry.timestamp)}
                </p>
              </div>
              {entry.detail && (
                <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                  {entry.detail}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
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

  const handleEmpty = async () => {
    try {
      await api.delete('/admin/server-logs');
      setLogs([]);
      setTotal(0);
    } catch (e) {
      setError(e.message);
    }
  };

  const handleExport = () => {
    const a = document.createElement('a');
    a.href = '/api/admin/server-logs/export';
    a.download = 'server-logs.json';
    a.click();
  };

  const totalPages  = Math.ceil(total / LIMIT);
  const currentPage = Math.floor(offset / LIMIT) + 1;

  if (loading) {
    return (
      <div className="p-8 flex items-center gap-2" style={{ color: 'var(--color-muted)' }}>
        {getIcon('loader', { size: 16 })}
        <span className="text-sm">Loading server logs…</span>
      </div>
    );
  }

  return (
    <>
      {error && <InlineBanner type="error" message={error} onDismiss={() => setError('')} />}

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

      <ActionBar onExport={handleExport} onEmpty={handleEmpty} emptyLabel="Empty server logs" />

      {logs.length === 0 ? (
        <EmptyState icon="file-text" message="No server log entries." hint="Warnings and errors will appear here automatically." />
      ) : (
        <div className="space-y-3">
          {logs.map((log) => (
            <ServerLogCard
              key={log.id}
              log={log}
              expanded={expanded === log.id}
              onToggle={() => setExpanded(expanded === log.id ? null : log.id)}
              getIcon={getIcon}
            />
          ))}
        </div>
      )}

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

function ServerLogCard({ log, expanded, onToggle, getIcon }) {
  const style = LEVEL_STYLE[log.level] || { background: 'var(--color-surface)', color: 'var(--color-muted)' };
  const hasMeta = log.meta && Object.keys(log.meta).length > 0;

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
    >
      {/* Summary row — always visible */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-4 text-left transition-colors hover:opacity-80"
        style={{ background: 'none', border: 'none', cursor: 'pointer' }}
      >
        <span style={{ color: 'var(--color-muted)', flexShrink: 0 }}>
          {getIcon(expanded ? 'chevron-down' : 'chevron-right', { size: 16 })}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold uppercase" style={style}>
              {log.level}
            </span>
            <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>
              {log.message}
            </p>
          </div>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
            {fmtTs(log.created_at)}
          </p>
        </div>

        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
          {expanded ? 'Hide details' : hasMeta ? 'View details' : ''}
        </span>
      </button>

      {/* Expanded detail */}
      {expanded && hasMeta && (
        <div style={{ borderTop: '1px solid var(--color-border)' }}>
          <div className="p-4">
            <pre
              className="text-xs rounded-xl p-3 overflow-x-auto"
              style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
            >
              {JSON.stringify(log.meta, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared components ─────────────────────────────────────────────────────────

function MetaItem({ label, value }) {
  return (
    <div className="rounded-lg p-2" style={{ background: 'var(--color-bg)' }}>
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</p>
      <p className="text-sm font-medium mt-0.5" style={{ color: 'var(--color-text)' }}>{value}</p>
    </div>
  );
}

// ── Page shell ────────────────────────────────────────────────────────────────

export default function AdminLogsPage() {
  const [tab, setTab] = useState('Usage Logs');

  return (
    <div className="p-6 max-w-5xl mx-auto">
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
