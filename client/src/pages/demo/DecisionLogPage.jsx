/**
 * DecisionLogPage — Document History view.
 *
 * Shows a chronological list of all analysed documents (runs) with:
 *   - File name, date, status, findings summary
 *   - Expandable full details (findings, decisions, trace)
 *   - S3 download link if auto-saved
 *   - "New Document" button to navigate to the Document Analyzer
 */
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

const confidence_pct = (c) => `${Math.round((c ?? 0) * 100)}%`;

function statusPill(status) {
  const map = {
    complete:    { bg: '#dcfce7', color: '#166534', label: 'Complete' },
    error:       { bg: '#fee2e2', color: '#991b1b', label: 'Error' },
    running:     { bg: '#fef3c7', color: '#92400e', label: 'Running' },
    needs_review:{ bg: '#e0e7ff', color: '#3730a3', label: 'Needs review' },
  };
  return map[status] ?? { bg: 'var(--color-bg)', color: 'var(--color-muted)', label: status };
}

function confidenceColor(c) {
  if (c >= 0.9)  return '#16a34a';
  if (c >= 0.7)  return '#d97706';
  return '#dc2626';
}

// ── Run card ──────────────────────────────────────────────────────────────────

function RunCard({ run, expanded, onToggle, getIcon }) {
  const pill = statusPill(run.status);
  const s3   = run.s3; // { storageKey, url, expiresAt } or null

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
              style={{ background: pill.bg, color: pill.color }}
            >
              {pill.label}
            </span>
            {s3?.url && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#dcfce7', color: '#166534' }}>
                S3 ✓
              </span>
            )}
          </div>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
            {fmtTs(run.run_at)} · {run.document_type ?? '—'}
            {run.pending_review_count != null && ` · ${run.pending_review_count} pending`}
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

// ── Run detail (fetches full result) ──────────────────────────────────────────

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

  const allFindings    = data.all_findings ?? [];
  const detFindings    = data.deterministic_findings ?? [];
  const probFindings   = data.probabilistic_findings ?? [];
  const pendingCount   = allFindings.filter((f) => f.status === 'pending_review').length;

  return (
    <div className="p-4 space-y-4">
      {/* Run metadata */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetaItem label="Document" value={data.file_name ?? '—'} />
        <MetaItem label="Type" value={data.document_type ?? '—'} />
        <MetaItem label="Tokens" value={fmtTokens(tokensUsed)} />
        <MetaItem label="Cost" value={fmtCost(costAud)} />
      </div>

      {/* S3 link */}
      {s3?.url && (
        <div className="rounded-lg p-3 flex items-center gap-2" style={{ background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
          <span style={{ color: '#16a34a', flexShrink: 0 }}>{getIcon('archive', { size: 14 })}</span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium" style={{ color: '#166534' }}>Document saved to AWS S3</p>
            <p className="text-xs mt-0.5" style={{ color: '#6b7280' }}>{s3.storageKey}</p>
          </div>
          <a
            href={s3.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium px-3 py-1.5 rounded-lg shrink-0"
            style={{ background: '#16a34a', color: '#fff' }}
          >
            Open file →
          </a>
        </div>
      )}

      {/* Summary */}
      {result.summary && (
        <div className="rounded-lg p-3" style={{ background: 'var(--color-bg)' }}>
          <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>Summary</p>
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>{result.summary}</p>
        </div>
      )}

      {/* Findings summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <MetaItem label="Deterministic" value={detFindings.length.toString()} />
        <MetaItem label="Probabilistic" value={probFindings.length.toString()} />
        <MetaItem label="Pending review" value={pendingCount.toString()} />
        <MetaItem label="Model" value={model} />
      </div>

      {/* All findings */}
      {allFindings.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
            Findings ({allFindings.length})
          </p>
          {allFindings.map((f) => (
            <FindingCard key={f.finding_id} finding={f} getIcon={getIcon} />
          ))}
        </div>
      )}

      {/* Decision trace */}
      {trace.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
            Decision Trace
          </p>
          <DecisionTrace trace={trace} getIcon={getIcon} />
        </div>
      )}
    </div>
  );
}

// ── Finding card (compact, read-only) ─────────────────────────────────────────

function FindingCard({ finding, getIcon }) {
  const isDet   = finding.stage === 'deterministic';
  const conf    = finding.confidence ?? 1.0;
  const isLow   = !isDet && conf < 0.7;
  const isCross = finding.also_flagged_deterministic || finding.also_flagged_probabilistic;
  const pill    = statusPill(finding.status);

  return (
    <div
      className="rounded-lg p-3 space-y-1.5"
      style={{
        background: 'var(--color-bg)',
        border: `1px solid ${isCross ? '#fbbf24' : 'var(--color-border)'}`,
      }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium px-1.5 py-0.5 rounded-full" style={{ background: isDet ? '#eff6ff' : '#faf5ff', color: isDet ? '#1d4ed8' : '#7c3aed' }}>
          {isDet ? 'Deterministic' : 'Probabilistic'}
        </span>
        {isCross && (
          <span className="text-xs font-medium px-1.5 py-0.5 rounded-full" style={{ background: '#fffbeb', color: '#92400e' }}>
            Both stages
          </span>
        )}
        {isLow && (
          <span className="text-xs font-medium px-1.5 py-0.5 rounded-full" style={{ background: '#fef2f2', color: '#991b1b' }}>
            Low confidence
          </span>
        )}
        <span className="text-xs font-medium px-1.5 py-0.5 rounded-full" style={{ background: pill.bg, color: pill.color }}>
          {pill.label}
        </span>
      </div>
      <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{finding.label}</p>
      {!isDet && (
        <p className="text-xs font-mono" style={{ color: confidenceColor(conf) }}>
          {confidence_pct(conf)} confidence
        </p>
      )}
      {finding.description && (
        <p className="text-xs" style={{ color: 'var(--color-text)' }}>{finding.description}</p>
      )}
      {finding.excerpt && (
        <p className="text-xs italic" style={{ color: 'var(--color-muted)' }}>"{finding.excerpt}"</p>
      )}
      {finding.action && (
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}><strong>Action:</strong> {finding.action}</p>
      )}
      {finding.status !== 'pending_review' && finding.reviewed_by && (
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          {pill.label} by {finding.reviewed_by} · {fmtTs(finding.reviewed_at)}
          {finding.comment && ` · "${finding.comment}"`}
        </p>
      )}
    </div>
  );
}

// ── Decision trace ────────────────────────────────────────────────────────────

function DecisionTrace({ trace, getIcon }) {
  if (!trace?.length) return null;

  const stepMeta = {
    input_sanitisation:    { icon: 'shield', label: 'Input Sanitisation' },
    deterministic_rules:   { icon: 'zap',    label: 'Deterministic Rules' },
    probabilistic_analysis:{ icon: 'cpu',    label: 'Probabilistic Analysis' },
    review_action:         { icon: 'user',   label: 'Review Action' },
  };

  return (
    <div className="rounded-lg p-3" style={{ background: 'var(--color-bg)' }}>
      <div className="space-y-0">
        {trace.map((step, i) => {
          const meta  = stepMeta[step.step] ?? { icon: 'circle', label: step.step };
          const isLast = i === trace.length - 1;

          return (
            <div key={i} className="flex gap-3">
              <div className="flex flex-col items-center" style={{ width: 24, flexShrink: 0 }}>
                <div
                  className="flex items-center justify-center rounded-full"
                  style={{ width: 24, height: 24, background: 'var(--color-surface)', border: '2px solid var(--color-border)', flexShrink: 0 }}
                >
                  <span style={{ color: 'var(--color-primary)' }}>{getIcon(meta.icon, { size: 10 })}</span>
                </div>
                {!isLast && <div style={{ width: 2, flex: 1, background: 'var(--color-border)', minHeight: 16 }} />}
              </div>
              <div className="pb-3 min-w-0 flex-1">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{meta.label}</p>
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{fmtTs(step.timestamp)}</p>
                </div>
                {step.step === 'input_sanitisation' && (
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{step.label ?? step.result} · {step.file_name}</p>
                )}
                {step.step === 'deterministic_rules' && (
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{step.rules_evaluated} rules evaluated · {step.rules_matched} matched</p>
                )}
                {step.step === 'probabilistic_analysis' && (
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>Model: {step.model} · {step.findings_count} findings</p>
                )}
                {step.step === 'review_action' && (
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                    <strong>{step.finding_label}</strong> → {step.decision}
                    {step.reviewed_by && ` · ${step.reviewed_by}`}
                    {step.comment && ` · "${step.comment}"`}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── MetaItem ──────────────────────────────────────────────────────────────────

function MetaItem({ label, value }) {
  return (
    <div className="rounded-lg p-2" style={{ background: 'var(--color-bg)' }}>
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</p>
      <p className="text-sm font-medium mt-0.5" style={{ color: 'var(--color-text)' }}>{value}</p>
    </div>
  );
}

// ── Page shell ────────────────────────────────────────────────────────────────

export default function DecisionLogPage() {
  const getIcon = useIcon();
  const navigate = useNavigate();
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedRun, setExpandedRun] = useState(null);

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

  if (loading) {
    return (
      <div className="p-8 flex items-center gap-2" style={{ color: 'var(--color-muted)' }}>
        {getIcon('loader', { size: 16 })}
        <span className="text-sm">Loading document history…</span>
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
            Document History
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
            All analysed documents — review findings, decisions, and download from S3.
          </p>
        </div>

        {/* New Document button */}
        <Button
          variant="primary"
          onClick={() => navigate('/demo/run/demo-document-analyzer')}
        >
          {getIcon('plus', { size: 14 })} New Document
        </Button>
      </div>

      {error && <InlineBanner type="error" message={error} onDismiss={() => setError('')} />}

      {runs.length === 0 ? (
        <div className="rounded-xl p-8 text-center" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No documents analysed yet.</p>
          <button
            onClick={() => navigate('/demo/run/demo-document-analyzer')}
            className="mt-3 text-sm font-medium px-4 py-2 rounded-lg"
            style={{ background: 'var(--color-primary)', color: '#fff', cursor: 'pointer' }}
          >
            Analyse your first document
          </button>
        </div>
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
