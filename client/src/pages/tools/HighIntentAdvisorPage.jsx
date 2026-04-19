import { useState, useEffect, useCallback } from 'react';
import api from '../../api/client';
import EmptyState from '../../components/ui/EmptyState';
import { useIcon } from '../../providers/IconProvider';

const PRIORITY_ORDER = ['high', 'medium', 'low'];

const PRIORITY_DOT = {
  high:   'bg-red-500',
  medium: 'bg-amber-400',
  low:    'bg-gray-400',
};

const STATUS_PILL = {
  acted_on:  'bg-green-100 text-green-800',
  dismissed: 'border text-xs px-2 py-0.5 rounded-full',
  monitoring: 'bg-amber-100 text-amber-800',
};

function truncate(str, n) {
  if (!str) return '';
  return str.length > n ? str.slice(0, n) + '…' : str;
}

function MetricRow({ metrics }) {
  if (!metrics || Object.keys(metrics).length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs" style={{ color: 'var(--color-muted)' }}>
      {Object.entries(metrics).map(([k, v]) => (
        <span key={k}>{k}: {String(v)}</span>
      ))}
    </div>
  );
}

function SuggestionCard({ suggestion, onActedOn, onDismiss }) {
  const getIcon = useIcon();
  const [dismissing, setDismissing]   = useState(false);
  const [actingOn, setActingOn]       = useState(false);
  const [userAction, setUserAction]   = useState('');
  const [userReason, setUserReason]   = useState('');
  const [busy, setBusy]               = useState(false);

  async function handleActedOnConfirm() {
    setBusy(true);
    await onActedOn(suggestion.id, userAction);
    setBusy(false);
  }

  async function handleDismissConfirm() {
    setBusy(true);
    await onDismiss(suggestion.id, userReason);
    setBusy(false);
  }

  return (
    <div
      className="rounded-2xl border p-5 space-y-3"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
    >
      {/* Top row */}
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className="rounded-full px-2 py-0.5 text-xs font-medium"
          style={{
            background: 'rgba(var(--color-primary-rgb), 0.1)',
            color: 'var(--color-primary)',
          }}
        >
          {suggestion.category.replace(/_/g, ' ')}
        </span>
        <span className={`inline-block w-2 h-2 rounded-full ${PRIORITY_DOT[suggestion.priority]}`} />
        <span className="text-xs ml-auto" style={{ color: 'var(--color-muted)' }}>
          {new Date(suggestion.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
        </span>
      </div>

      {/* Suggestion text */}
      <p className="font-medium text-sm" style={{ color: 'var(--color-text)' }}>
        {suggestion.suggestion_text}
      </p>

      {/* Rationale */}
      <div className="flex items-start gap-1.5 text-xs" style={{ color: 'var(--color-muted)' }}>
        <span className="mt-0.5 shrink-0">{getIcon('info', { size: 13 })}</span>
        <span>{suggestion.rationale}</span>
      </div>

      {/* Baseline metrics */}
      <MetricRow metrics={suggestion.baseline_metrics} />

      {/* Agent outcome notes (from Phase 1 review) */}
      {suggestion.outcome_notes && (
        <p className="text-xs italic" style={{ color: 'var(--color-muted)' }}>
          Agent note: {suggestion.outcome_notes}
        </p>
      )}

      {/* Action row */}
      <div className="flex items-center gap-3 pt-1 flex-wrap">
        {!actingOn && !dismissing ? (
          <>
            <button
              onClick={() => setActingOn(true)}
              disabled={busy}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
              style={{
                borderColor: 'var(--color-primary)',
                color: 'var(--color-primary)',
              }}
            >
              Mark acted on
            </button>
            <button
              onClick={() => setDismissing(true)}
              disabled={busy}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={{ color: 'var(--color-muted)' }}
            >
              Dismiss
            </button>
          </>
        ) : actingOn ? (
          <div className="w-full space-y-2">
            <textarea
              rows={2}
              placeholder="What action did you take? (optional)"
              value={userAction}
              onChange={(e) => setUserAction(e.target.value)}
              className="w-full text-xs rounded-lg border p-2 resize-none"
              style={{
                borderColor: 'var(--color-border)',
                background: 'var(--color-bg)',
                color: 'var(--color-text)',
              }}
            />
            <div className="flex items-center gap-2 text-xs">
              <button
                onClick={handleActedOnConfirm}
                disabled={busy}
                className="px-3 py-1 rounded-lg font-medium border transition-colors"
                style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
              >
                Confirm
              </button>
              <button
                onClick={() => { setActingOn(false); setUserAction(''); }}
                disabled={busy}
                className="px-2 py-1 rounded"
                style={{ color: 'var(--color-muted)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="w-full space-y-2">
            <textarea
              rows={2}
              placeholder="Why are you dismissing this? (optional)"
              value={userReason}
              onChange={(e) => setUserReason(e.target.value)}
              className="w-full text-xs rounded-lg border p-2 resize-none"
              style={{
                borderColor: 'var(--color-border)',
                background: 'var(--color-bg)',
                color: 'var(--color-text)',
              }}
            />
            <div className="flex items-center gap-2 text-xs">
              <span style={{ color: 'var(--color-muted)' }}>Dismiss?</span>
              <button
                onClick={handleDismissConfirm}
                disabled={busy}
                className="px-2 py-1 rounded font-medium"
                style={{ color: 'var(--color-error, #dc2626)' }}
              >
                Yes
              </button>
              <button
                onClick={() => { setDismissing(false); setUserReason(''); }}
                disabled={busy}
                className="px-2 py-1 rounded"
                style={{ color: 'var(--color-muted)' }}
              >
                No
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ActiveTab({ suggestions, onActedOn, onDismiss }) {
  if (suggestions.length === 0) {
    return (
      <EmptyState
        icon="check-circle"
        message="No active suggestions"
        hint="Run the advisor to generate new suggestions."
      />
    );
  }

  const grouped = PRIORITY_ORDER.reduce((acc, p) => {
    const items = suggestions.filter((s) => s.priority === p);
    if (items.length > 0) acc.push({ priority: p, items });
    return acc;
  }, []);

  return (
    <div className="space-y-6">
      {grouped.map(({ priority, items }) => (
        <div key={priority}>
          <p
            className="text-xs font-semibold uppercase tracking-wider mb-3"
            style={{ color: 'var(--color-muted)' }}
          >
            {priority} priority
          </p>
          <div className="space-y-4">
            {items.map((s) => (
              <SuggestionCard
                key={s.id}
                suggestion={s}
                onActedOn={onActedOn}
                onDismiss={onDismiss}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function HistoryTab({ history }) {
  if (history.length === 0) {
    return (
      <EmptyState
        icon="clock"
        message="No history yet"
        hint="Acted on or dismissed suggestions will appear here."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
            {['Date', 'Category', 'Priority', 'Suggestion', 'Status', 'Outcome notes'].map((h) => (
              <th
                key={h}
                className="text-left py-2 px-3 text-xs font-semibold uppercase tracking-wider"
                style={{ color: 'var(--color-muted)' }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {history.map((s) => (
            <tr
              key={s.id}
              style={{ borderBottom: '1px solid var(--color-border)' }}
            >
              <td className="py-2 px-3 text-xs whitespace-nowrap" style={{ color: 'var(--color-muted)' }}>
                {new Date(s.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
              </td>
              <td className="py-2 px-3 text-xs" style={{ color: 'var(--color-text)' }}>
                {s.category.replace(/_/g, ' ')}
              </td>
              <td className="py-2 px-3 text-xs">
                <span className="flex items-center gap-1.5">
                  <span className={`inline-block w-2 h-2 rounded-full ${PRIORITY_DOT[s.priority]}`} />
                  {s.priority}
                </span>
              </td>
              <td
                className="py-2 px-3 text-xs max-w-xs"
                title={s.suggestion_text}
                style={{ color: 'var(--color-text)' }}
              >
                {truncate(s.suggestion_text, 80)}
              </td>
              <td className="py-2 px-3">
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_PILL[s.status] ?? ''}`}
                  style={s.status === 'dismissed' ? { borderColor: 'var(--color-border)', color: 'var(--color-muted)' } : {}}
                >
                  {s.status.replace(/_/g, ' ')}
                </span>
              </td>
              <td className="py-2 px-3 text-xs max-w-xs" style={{ color: 'var(--color-muted)' }}>
                {s.outcome_notes ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function HighIntentAdvisorPage() {
  const [activeTab, setActiveTab]       = useState('active');
  const [suggestions, setSuggestions]   = useState([]);
  const [history, setHistory]           = useState([]);
  const [loading, setLoading]           = useState(false);
  const [running, setRunning]           = useState(false);
  const [progress, setProgress]         = useState([]);
  const [toast, setToast]               = useState('');

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  }, []);

  const loadSuggestions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/agents/high-intent-advisor/suggestions');
      setSuggestions(Array.isArray(data) ? data : []);
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const data = await api.get('/agents/high-intent-advisor/suggestions/history');
      setHistory(Array.isArray(data) ? data : []);
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    loadSuggestions();
    loadHistory();
  }, [loadSuggestions, loadHistory]);

  async function handleRun() {
    setRunning(true);
    setProgress([]);
    try {
      const res    = await api.stream('/agents/high-intent-advisor/run', {});
      const reader = res.body.getReader();
      const dec    = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') break;
          try {
            const msg = JSON.parse(raw);
            if (msg.type === 'progress') setProgress((p) => [...p, msg.text]);
            if (msg.type === 'result') showToast('Run complete.');
            if (msg.type === 'error') showToast(`Error: ${msg.error}`);
          } catch { /* ignore parse errors */ }
        }
      }

      await loadSuggestions();
      await loadHistory();
    } catch (err) {
      showToast('Run failed: ' + err.message);
    } finally {
      setRunning(false);
      setProgress([]);
    }
  }

  async function handleActedOn(id, userAction) {
    try {
      await api.patch(`/agents/high-intent-advisor/suggestions/${id}`, {
        status: 'acted_on',
        acted_on_at: new Date().toISOString(),
        user_action: userAction || null,
      });
      await loadSuggestions();
      await loadHistory();
      showToast('Marked as acted on.');
    } catch {
      showToast('Failed to update suggestion.');
    }
  }

  async function handleDismiss(id, userReason) {
    try {
      await api.patch(`/agents/high-intent-advisor/suggestions/${id}`, {
        status: 'dismissed',
        user_reason: userReason || null,
      });
      await loadSuggestions();
      await loadHistory();
      showToast('Suggestion dismissed.');
    } catch {
      showToast('Failed to dismiss suggestion.');
    }
  }

  const tabs = [
    { id: 'active', label: 'Active Suggestions' },
    { id: 'history', label: 'Suggestion History' },
  ];

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
            High Intent Advisor
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
            Daily suggestions for attracting high-intent customers based on your ad, analytics, and CRM data.
          </p>
        </div>
        <button
          onClick={handleRun}
          disabled={running}
          className="shrink-0 px-4 py-2 rounded-xl text-sm font-medium transition-opacity disabled:opacity-60"
          style={{ background: 'var(--color-primary)', color: '#fff' }}
        >
          {running ? 'Running…' : 'Run Advisor'}
        </button>
      </div>

      {/* Progress log */}
      {running && progress.length > 0 && (
        <div
          className="rounded-xl border p-4 space-y-1 text-xs font-mono"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
        >
          {progress.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className="rounded-xl px-4 py-3 text-sm font-medium"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
        >
          {toast}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b" style={{ borderColor: 'var(--color-border)' }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className="px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors"
            style={{
              borderColor: activeTab === t.id ? 'var(--color-primary)' : 'transparent',
              color: activeTab === t.id ? 'var(--color-primary)' : 'var(--color-muted)',
            }}
          >
            {t.label}
            {t.id === 'active' && suggestions.length > 0 && (
              <span
                className="ml-1.5 text-xs rounded-full px-1.5 py-0.5"
                style={{ background: 'rgba(var(--color-primary-rgb),0.1)', color: 'var(--color-primary)' }}
              >
                {suggestions.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {loading ? (
          <EmptyState icon="loader" message="Loading suggestions…" />
        ) : activeTab === 'active' ? (
          <ActiveTab
            suggestions={suggestions}
            onActedOn={handleActedOn}
            onDismiss={handleDismiss}
          />
        ) : (
          <HistoryTab history={history} />
        )}
      </div>
    </div>
  );
}
