/**
 * TransactionLogPage — Container 1: Universal Transaction Log.
 *
 * Displays the platform-wide ledger that every agent writes to.
 * Fixed columns: timestamp, agent, action, document ref, outcome, status.
 * Links to agent-specific event logs via session_id.
 *
 * Matches the presentation style of the existing DecisionLogPage.
 */
import { useEffect, useState, useCallback } from 'react';
import { useIcon } from '../../providers/IconProvider';
import { useSearchParams, Link } from 'react-router-dom';
import api from '../../api/client';
import LogTable from '../../components/logs/LogTable';
import InlineBanner from '../../components/ui/InlineBanner';

const TRANSACTION_COLUMNS = [
  { key: 'created_at',  label: 'Timestamp', type: 'date' },
  { key: 'agent_slug',  label: 'Agent',     type: 'text' },
  { key: 'action',      label: 'Action',    type: 'text' },
  { key: 'document_ref',label: 'Document',  type: 'text' },
  { key: 'outcome',     label: 'Outcome',   type: 'text' },
  { key: 'status',      label: 'Status',    type: 'badge' },
];

export default function TransactionLogPage() {
  const getIcon = useIcon();
  const [searchParams] = useSearchParams();
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const sessionFilter = searchParams.get('session_id') || '';

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const url = sessionFilter
        ? `/logs/transactions?session_id=${encodeURIComponent(sessionFilter)}&limit=200`
        : '/logs/transactions?limit=200';
      const data = await api.get(url);
      setTransactions(data.transactions ?? []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [sessionFilter]);

  useEffect(() => { fetchTransactions(); }, [fetchTransactions]);

  const handleExport = () => {
    const a = document.createElement('a');
    a.href = '/api/logs/transactions/export';
    a.download = 'transaction-log.json';
    a.click();
  };

  const renderDetail = (tx) => (
    <TransactionDetail tx={tx} getIcon={getIcon} />
  );

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
          Transaction Log
        </h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
          Platform-wide ledger — every agent writes here. Each row represents one transaction
          with a shared <code className="text-xs" style={{ background: 'var(--color-bg)', padding: '1px 4px', borderRadius: 3 }}>session_id</code> linking to the agent-specific event log.
        </p>
      </div>

      {error && <InlineBanner type="error" message={error} onDismiss={() => setError('')} />}

      <LogTable
        columns={TRANSACTION_COLUMNS}
        rows={transactions}
        loading={loading}
        onExport={handleExport}
        renderDetail={renderDetail}
        emptyMessage="No transactions recorded yet. Run an agent to see entries here."
      />
    </div>
  );
}

function TransactionDetail({ tx, getIcon }) {
  const [events, setEvents] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/logs/transactions/${tx.id}`)
      .then((data) => {
        setEvents(data.events ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [tx.id]);

  return (
    <div className="p-4 space-y-3">
      {/* Metadata grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetaItem label="Session ID" value={tx.session_id} mono linkTo={`/demo/logs/events?session_id=${tx.session_id}`} />
        <MetaItem label="Transaction ID" value={tx.id} mono />
        <MetaItem label="Agent" value={tx.agent_slug} />
        <MetaItem label="Action" value={tx.action} />
      </div>

      {/* Linked events from Container 2 */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>
          Agent Events (Container 2)
        </p>
        {loading ? (
          <div className="flex items-center gap-2" style={{ color: 'var(--color-muted)' }}>
            {getIcon('loader', { size: 12 })}
            <span className="text-xs">Loading events…</span>
          </div>
        ) : events && events.length > 0 ? (
          <div className="space-y-1">
            {events.map((ev) => (
              <div
                key={ev.id}
                className="flex items-start gap-2 rounded-lg p-2"
                style={{ background: 'var(--color-bg)' }}
              >
                <span className="text-xs font-medium px-1.5 py-0.5 rounded-full" style={{ background: '#e0e7ff', color: '#3730a3' }}>
                  {ev.event_type}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                    {ev.event_label ?? ev.event_type}
                  </p>
                  {ev.event_detail && (
                    <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                      {ev.event_detail}
                    </p>
                  )}
                </div>
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  {new Date(ev.event_timestamp).toLocaleString('en-AU', { dateStyle: 'short', timeStyle: 'short' })}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No agent events linked to this transaction.</p>
        )}
      </div>
    </div>
  );
}

function MetaItem({ label, value, mono, linkTo }) {
  return (
    <div className="rounded-lg p-2" style={{ background: 'var(--color-bg)' }}>
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</p>
      {linkTo && value ? (
        <Link
          to={linkTo}
          className="text-xs font-medium mt-0.5 truncate block hover:underline"
          style={{
            color: 'var(--color-primary)',
            fontFamily: mono ? "'SF Mono', 'Fira Code', monospace" : undefined,
          }}
        >
          {value}
        </Link>
      ) : (
        <p
          className="text-xs font-medium mt-0.5 truncate"
          style={{
            color: 'var(--color-text)',
            fontFamily: mono ? "'SF Mono', 'Fira Code', monospace" : undefined,
          }}
        >
          {value ?? '—'}
        </p>
      )}
    </div>
  );
}
