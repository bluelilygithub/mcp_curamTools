import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIcon } from '../../providers/IconProvider';
import api from '../../api/client';
import Button from '../../components/ui/Button';
import InlineBanner from '../../components/ui/InlineBanner';

const fmtTs = (s) => {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-AU', { dateStyle: 'short', timeStyle: 'short' });
};

const fmtTokens = (t) => {
  if (!t) return '—';
  const total = (t.input_tokens ?? t.input ?? 0) + (t.output_tokens ?? t.output ?? 0);
  return total.toLocaleString('en-AU');
};

const fmtCost = (n) =>
  n != null ? `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}` : '—';

export default function DecisionLogPage() {
  const getIcon = useIcon();
  const navigate = useNavigate();
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedRun, setExpandedRun] = useState(null);
  const [viewMode, setViewMode] = useState('cards'); // 'cards' | 'plain'
  const [confirmEmpty, setConfirmEmpty] = useState(false);

  const fetchRuns = () => {
    setLoading(true);
    api.get('/demo/runs?slug=demo-document-analyzer&limit=50')
      .then((data) => {
        setRuns(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  };

  useEffect(() => { fetchRuns(); }, []);

  const handleEmpty = async () => {
    try {
      await api.delete('/demo/runs');
      setRuns([]);
      setConfirmEmpty(false);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleExport = () => {
    // Trigger download via hidden link
    const a = document.createElement('a');
    a.href = '/api/demo/runs/export';
    a.download = 'demo-runs.json';
    a.click();
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center gap-2" style={{ color: 'var(--color-muted)' }}>
        {getIcon('loader', { size: 16 })}
        <span className="text-sm">Loading decision log…</span>
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
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
            Decision Log
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
            Chronological record of all document analysis runs and the decisions made at each step.
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          {/* New Document */}
          <Button
            variant="primary"
            onClick={() => navigate('/demo/run/demo-document-analyzer')}
          >
            {getIcon('plus', { size: 14 })} New Document
          </Button>

          {/* View mode toggle */}
          <button
            onClick={() => setViewMode(viewMode === 'cards' ? 'plain' : 'cards')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-opacity hover:opacity-70"
            style={{
              borderColor: 'var(--color-border)',
              color: 'var(--color-muted)',
            }}
          >
            {getIcon(viewMode === 'cards' ? 'file-text' : 'layers', { size: 12 })}
            {viewMode === 'cards' ? 'Plain text' : 'Cards'}
          </button>

          {/* Export */}
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-opacity hover:opacity-70"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
          >
            {getIcon('download', { size: 12 })}
            Export
          </button>

          {/* Empty */}
          {confirmEmpty ? (
            <div className="flex items-center gap-1">
              <Button variant="danger" onClick={handleEmpty}>Confirm</Button>
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
              Empty
            </button>
          )}
        </div>
      </div>

      {error && <InlineBanner type="error" message={error} onDismiss={() => setError('')} />}

      {runs.length === 0 ? (
        <div className="rounded-xl p-8 text-center" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No runs recorded yet.</p>
        </div>
      ) : viewMode === 'plain' ? (
        <PlainTextView runs={runs} />
      ) : (
        <div className="space-y-3">
          {runs.map((run) => (
            <RunCard
              key={run.id}
              run={run}
              expanded={expandedRun === run.id}
              onToggle={() => setExpandedRun(expandedRun === run.id ? null : run.id)}
              getIcon={getIcon}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PlainTextView({ runs }) {
  const lines = runs.flatMap((run) => {
    const out = [
      `=== Run ${run.id} ===`,
      `Status:   ${run.status}`,
      `File:     ${run.file_name ?? '—'}`,
      `Type:     ${run.document_type ?? '—'}`,
      `Run at:   ${fmtTs(run.run_at)}`,
      `Tokens:   ${fmtTokens(run.tokens_used ?? run)}`,
      `Cost:     ${fmtCost(run.cost_aud)}`,
      `Completed: ${fmtTs(run.completed_at)}`,
      '',
    ];
    return out;
  });

  return (
    <pre
      className="rounded-xl p-4 text-xs leading-relaxed overflow-x-auto whitespace-pre-wrap"
      style={{
        background: 'var(--color-bg)',
        color: 'var(--color-text)',
        border: '1px solid var(--color-border)',
        fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
      }}
    >
      {lines.join('\n')}
    </pre>
  );
}

function RunCard({ run, expanded, onToggle, getIcon }) {
  const statusColor = {
    complete: { bg: '#dcfce7', color: '#166534' },
    error:    { bg: '#fee2e2', color: '#991b1b' },
    running:  { bg: '#fef3c7', color: '#92400e' },
  }[run.status] ?? { bg: 'var(--color-bg)', color: 'var(--color-muted)' };
  const s3 = run.s3 ?? null;

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
              {run.file_name ?? 'Document'}
            </p>
            <span
              className="text-xs font-medium px-2 py-0.5 rounded-full"
              style={{ background: statusColor.bg, color: statusColor.color }}
            >
              {run.status}
            </span>
            {s3?.url && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#dcfce7', color: '#166534' }}>
                S3 ✓
              </span>
            )}
          </div>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
            {fmtTs(run.run_at)} · {run.document_type ?? '—'}
          </p>
        </div>

        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
          {expanded ? 'Hide details' : 'View details'}
        </span>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ borderTop: '1px solid var(--color-border)' }}>
          <RunDetail run={run} getIcon={getIcon} />
        </div>
      )}
    </div>
  );
}

function RunDetail({ run, getIcon }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/demo/runs/${run.id}`)
      .then((row) => {
        setDetail(row);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [run.id]);

  if (loading) {
    return (
      <div className="p-4 flex items-center gap-2" style={{ color: 'var(--color-muted)' }}>
        {getIcon('loader', { size: 14 })}
        <span className="text-xs">Loading details…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <p className="text-xs" style={{ color: '#dc2626' }}>{error}</p>
      </div>
    );
  }

  const result = detail?.result ?? {};
  const data   = result.data ?? {};
  const trace  = data.trace ?? [];
  const model  = data.model ?? '—';
  const tokensUsed = result.tokensUsed ?? detail?.tokens_used;
  const costAud    = result.costAud ?? detail?.cost_aud;
  const s3         = data.s3 ?? run.s3 ?? null;

  // Build the decision log entries
  const logEntries = [];

  // 1. Model decision
  logEntries.push({
    type: 'decision',
    icon: 'cpu',
    label: 'Model Selection',
    detail: `Model: ${model}`,
    timestamp: trace[0]?.timestamp ?? run.run_at,
  });

  // 2. Trace steps
  for (const step of trace) {
    const stepMeta = {
      input_sanitisation:    { icon: 'shield',    label: 'Input Sanitisation' },
      deterministic_rules:   { icon: 'zap',       label: 'Deterministic Rules' },
      probabilistic_analysis:{ icon: 'bot',       label: 'Probabilistic Analysis' },
      review_action:         { icon: 'user',      label: 'Review Action' },
    };
    const meta = stepMeta[step.step] ?? { icon: 'circle', label: step.step };

    let detailText = '';
    if (step.step === 'input_sanitisation') {
      detailText = `${step.label ?? step.result} · ${step.file_name ?? ''}`;
    } else if (step.step === 'deterministic_rules') {
      detailText = `${step.rules_evaluated} rules evaluated · ${step.rules_matched} matched`;
    } else if (step.step === 'probabilistic_analysis') {
      detailText = `Model: ${step.model} · ${step.findings_count} findings`;
    } else if (step.step === 'review_action') {
      detailText = `${step.finding_label} → ${step.decision}${step.reviewed_by ? ` · ${step.reviewed_by}` : ''}${step.comment ? ` · "${step.comment}"` : ''}`;
    }

    logEntries.push({
      type: 'step',
      icon: meta.icon,
      label: meta.label,
      detail: detailText,
      timestamp: step.timestamp,
    });
  }

  // 3. S3 save decision (if present)
  if (s3?.url) {
    logEntries.push({
      type: 'decision',
      icon: 'archive',
      label: 'S3 Storage',
      detail: `Saved to ${s3.storageKey}`,
      timestamp: trace[trace.length - 1]?.timestamp ?? run.completed_at,
      link: s3.url,
    });
  } else if (data.file_data) {
    logEntries.push({
      type: 'decision',
      icon: 'archive',
      label: 'File Storage Decision',
      detail: 'File available for S3 storage (Save to AWS toggle in results)',
      timestamp: trace[trace.length - 1]?.timestamp ?? run.completed_at,
    });
  }

  // 4. Certificate decision (if all resolved)
  const allFindings = data.all_findings ?? [];
  const pendingCount = allFindings.filter((f) => f.status === 'pending_review').length;
  if (allFindings.length > 0 && pendingCount === 0) {
    logEntries.push({
      type: 'decision',
      icon: 'check-circle',
      label: 'Certificate Ready',
      detail: 'All findings reviewed — compliance certificate can be generated',
      timestamp: run.completed_at,
    });
  }

  return (
    <div className="p-4 space-y-4">
      {/* Run metadata */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetaItem label="Document" value={data.file_name ?? '—'} />
        <MetaItem label="Type" value={data.document_type ?? '—'} />
        <MetaItem label="Tokens" value={fmtTokens(tokensUsed)} />
        <MetaItem label="Cost" value={fmtCost(costAud)} />
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
              {entry.link && (
                <a
                  href={entry.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs mt-1 inline-block underline"
                  style={{ color: 'var(--color-primary)' }}
                >
                  Open file →
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetaItem({ label, value }) {
  return (
    <div className="rounded-lg p-2" style={{ background: 'var(--color-bg)' }}>
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</p>
      <p className="text-sm font-medium mt-0.5" style={{ color: 'var(--color-text)' }}>{value}</p>
    </div>
  );
}
