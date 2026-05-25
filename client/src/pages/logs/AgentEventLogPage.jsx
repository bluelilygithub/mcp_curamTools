/**
 * AgentEventLogPage — Container 2: Agent-Specific Event Log.
 *
 * This is the declarable log viewer. When building a new agent:
 *   1. Call declareAgentFields(agentSlug, [...]) in the agent setup
 *   2. Use logger.step(eventType, label, detail, fields) during agent execution
 *   3. This page automatically picks up the field declarations and renders the correct columns
 *
 * The presentation, filtering, search, and export behaviour is inherited from the standard.
 * No per-agent UI code needed.
 *
 * Matches the presentation style of the existing DecisionLogPage.
 */
import { useEffect, useState, useCallback } from 'react';
import { useIcon } from '../../providers/IconProvider';
import { useLocation, useSearchParams, Link } from 'react-router-dom';
import api from '../../api/client';
import LogTable from '../../components/logs/LogTable';
import InlineBanner from '../../components/ui/InlineBanner';

const BASE_COLUMNS = [
  { key: 'event_timestamp', label: 'Timestamp', type: 'date' },
  { key: 'agent_slug',      label: 'Agent',     type: 'text' },
  { key: 'event_type',      label: 'Type',      type: 'badge' },
  { key: 'event_label',     label: 'Label',     type: 'text' },
  { key: 'event_detail',    label: 'Detail',    type: 'text' },
];

export default function AgentEventLogPage() {
  const getIcon = useIcon();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [agentFields, setAgentFields] = useState({}); // slug -> field declarations
  const [selectedAgent, setSelectedAgent] = useState('');

  const sessionFilter = searchParams.get('session_id') || '';

  // Fetch events
  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (selectedAgent) params.set('agent_slug', selectedAgent);
      if (sessionFilter) params.set('session_id', sessionFilter);
      const data = await api.get(`/logs/events?${params.toString()}`);
      setEvents(data.events ?? []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedAgent, sessionFilter]);

  // Fetch agent field declarations
  const fetchAgentFields = useCallback(async () => {
    try {
      const fields = await api.get('/logs/agent-fields');
      const map = {};
      for (const f of fields) {
        map[f.agent_slug] = f.fields;
      }
      setAgentFields(map);
    } catch (err) {
      console.error('Failed to load agent fields:', err.message);
    }
  }, []);

  useEffect(() => { fetchAgentFields(); }, [fetchAgentFields]);
  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  const handleExport = () => {
    const url = selectedAgent
      ? `/api/logs/events/export?agent_slug=${encodeURIComponent(selectedAgent)}`
      : '/api/logs/events/export';
    const a = document.createElement('a');
    a.href = url;
    a.download = 'agent-event-log.json';
    a.click();
  };

  // Build dynamic columns based on selected agent's field declarations
  const dynamicColumns = selectedAgent && agentFields[selectedAgent]
    ? agentFields[selectedAgent].map((f) => ({
        key: `fields.${f.key}`,
        label: f.label,
        type: f.type || 'text',
        options: f.options,
      }))
    : [];

  const columns = [...BASE_COLUMNS, ...dynamicColumns];

  // Resolve field values from the JSONB `fields` column
  const rowsWithFields = events.map((ev) => {
    const row = { ...ev };
    if (ev.fields && typeof ev.fields === 'object') {
      for (const key of Object.keys(ev.fields)) {
        row[`fields.${key}`] = ev.fields[key];
      }
    }
    return row;
  });

  const transactionLogPath = location.pathname.startsWith('/admin/')
    ? '/admin/monitoring/transactions'
    : '/demo/logs/transactions';

  const renderDetail = (ev) => (
    <EventDetail
      ev={ev}
      agentFields={agentFields[ev.agent_slug]}
      getIcon={getIcon}
      transactionLogPath={transactionLogPath}
    />
  );

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
          Agent Event Log
        </h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
          Per-agent event log with agent-specific metadata fields.
          Select an agent to see its declared fields as columns.
          Each event links back to a transaction via <code className="text-xs" style={{ background: 'var(--color-bg)', padding: '1px 4px', borderRadius: 3 }}>session_id</code>.
        </p>
      </div>

      {error && <InlineBanner type="error" message={error} onDismiss={() => setError('')} />}

      {/* Agent filter */}
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>
          Filter by agent:
        </label>
        <select
          value={selectedAgent}
          onChange={(e) => setSelectedAgent(e.target.value)}
          className="text-xs px-3 py-1.5 rounded-lg border outline-none"
          style={{
            background: 'var(--color-bg)',
            color: 'var(--color-text)',
            borderColor: 'var(--color-border)',
          }}
        >
          <option value="">All agents</option>
          {Object.keys(agentFields).map((slug) => (
            <option key={slug} value={slug}>{slug}</option>
          ))}
        </select>
      </div>

      <LogTable
        columns={columns}
        rows={rowsWithFields}
        loading={loading}
        onExport={handleExport}
        renderDetail={renderDetail}
        emptyMessage="No events recorded yet. Run an agent to see entries here."
      />
    </div>
  );
}

function EventDetail({ ev, agentFields, getIcon, transactionLogPath }) {
  return (
    <div className="p-4 space-y-3">
      {/* Core metadata */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetaItem label="Event ID" value={ev.id} mono />
        <MetaItem label="Session ID" value={ev.session_id} mono linkTo={`${transactionLogPath}?session_id=${ev.session_id}`} />
        <MetaItem label="Agent" value={ev.agent_slug} />
        <MetaItem label="Type" value={ev.event_type} />
      </div>

      {/* Label & Detail */}
      {ev.event_label && (
        <div className="rounded-lg p-2" style={{ background: 'var(--color-bg)' }}>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Label</p>
          <p className="text-sm font-medium mt-0.5" style={{ color: 'var(--color-text)' }}>{ev.event_label}</p>
        </div>
      )}
      {ev.event_detail && (
        <div className="rounded-lg p-2" style={{ background: 'var(--color-bg)' }}>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Detail</p>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-text)' }}>{ev.event_detail}</p>
        </div>
      )}

      {/* Agent-specific fields */}
      {ev.fields && Object.keys(ev.fields).length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>
            Agent Fields
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {Object.entries(ev.fields).map(([key, value]) => {
              const decl = agentFields?.find((f) => f.key === key);
              const label = decl?.label ?? key;
              return (
                <div key={key} className="rounded-lg p-2" style={{ background: 'var(--color-bg)' }}>
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</p>
                  <p className="text-xs font-medium mt-0.5" style={{ color: 'var(--color-text)' }}>
                    {value != null ? String(value) : '—'}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Link to transaction */}
      <div className="rounded-lg p-2" style={{ background: 'var(--color-bg)' }}>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Linked Transaction</p>
        <p className="text-xs font-medium mt-0.5" style={{ color: 'var(--color-primary)', fontFamily: "'SF Mono', 'Fira Code', monospace" }}>
          session_id: {ev.session_id}
        </p>
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
