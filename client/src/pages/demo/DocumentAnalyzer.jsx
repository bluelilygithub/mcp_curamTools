import { useState, useRef, useCallback, useEffect } from 'react';
import api from '../../api/client';
import { useIcon } from '../../providers/IconProvider';
import { exportPdf } from '../../utils/exportService';
import useAuthStore from '../../stores/authStore';
import MarkdownRenderer from '../../components/ui/MarkdownRenderer';
import MicButton from '../../components/ui/MicButton';

const SLUG = 'demo-document-analyzer';
const LOW_CONFIDENCE = 0.7;

// ── Formatting helpers ────────────────────────────────────────────────────────

const fmtCost = (n) =>
  n != null ? `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}` : '—';

const fmtTokens = (t) => {
  if (!t) return '—';
  const total = (t.input_tokens ?? t.input ?? 0) + (t.output_tokens ?? t.output ?? 0);
  return total.toLocaleString('en-AU');
};

const fmtTs = (s) => {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-AU', { dateStyle: 'short', timeStyle: 'short' });
};

const confidence_pct = (c) => `${Math.round((c ?? 0) * 100)}%`;

// ── Colour helpers ────────────────────────────────────────────────────────────

function confidenceColor(c) {
  if (c >= 0.9)  return '#16a34a';
  if (c >= LOW_CONFIDENCE) return '#d97706';
  return '#dc2626';
}

function statusPill(status) {
  const map = {
    pending_review: { bg: '#fef3c7', color: '#92400e', label: 'Pending review' },
    approved:       { bg: '#dcfce7', color: '#166534', label: 'Approved' },
    rejected:       { bg: '#fee2e2', color: '#991b1b', label: 'Rejected' },
    resubmit:       { bg: '#e0e7ff', color: '#3730a3', label: 'Resubmit' },
  };
  return map[status] ?? map.pending_review;
}

// ── SSE streaming helper ──────────────────────────────────────────────────────

async function streamRun(body, onProgress, onResult, onError) {
  try {
    const res     = await api.stream(`/agents/${SLUG}/run`, body);
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let resultReceived = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') return;
        try {
          const msg = JSON.parse(raw);
          if (msg.type === 'progress') onProgress(msg.text);
          else if (msg.type === 'result') { resultReceived = true; onResult(msg.data); }
          else if (msg.type === 'error')  onError(msg.error ?? 'Agent error');
        } catch { /* malformed SSE line */ }
      }
    }
    if (!resultReceived) onError('Stream ended without a result — check server logs.');
  } catch (err) {
    onError(err.message);
  }
}

// ── Subcomponents ─────────────────────────────────────────────────────────────

function SanitisationCard({ sanitisation, getIcon }) {
  const ok = sanitisation?.result === 'clean';
  return (
    <div
      className="rounded-xl p-4 flex items-start gap-3"
      style={{
        background: ok ? '#f0fdf4' : '#fff7ed',
        border: `1px solid ${ok ? '#bbf7d0' : '#fed7aa'}`,
      }}
    >
      <span style={{ color: ok ? '#16a34a' : '#d97706', flexShrink: 0, marginTop: 2 }}>
        {getIcon(ok ? 'shield-check' : 'alert-triangle', { size: 16 })}
      </span>
      <div>
        <p className="text-sm font-medium" style={{ color: ok ? '#166534' : '#92400e' }}>
          {sanitisation?.label ?? (ok ? 'Input sanitised: clean' : 'Input flagged')}
        </p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
          SHA-256: <span className="font-mono">{sanitisation?.file_hash?.slice(0, 16)}…</span>
          &nbsp;·&nbsp;{sanitisation?.file_name}
        </p>
      </div>
    </div>
  );
}

function FindingCard({ finding, getIcon, compact = false }) {
  const conf    = finding.confidence ?? 1.0;
  const isDet   = finding.stage === 'deterministic';
  const isLow   = !isDet && conf < LOW_CONFIDENCE;
  const isCross = finding.also_flagged_deterministic || finding.also_flagged_probabilistic;
  const pill    = statusPill(finding.status);

  return (
    <div
      className="rounded-xl p-4 space-y-2"
      style={{
        background:  'var(--color-surface)',
        border:      `1px solid ${isCross ? '#fbbf24' : 'var(--color-border)'}`,
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="text-xs font-medium px-2 py-0.5 rounded-full"
            style={{ background: isDet ? '#eff6ff' : '#faf5ff', color: isDet ? '#1d4ed8' : '#7c3aed' }}
          >
            {isDet ? 'Deterministic' : 'Probabilistic'}
          </span>
          {isCross && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#fffbeb', color: '#92400e' }}>
              Both stages flagged
            </span>
          )}
          {isLow && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#fef2f2', color: '#991b1b' }}>
              Low confidence
            </span>
          )}
        </div>
        <span
          className="text-xs font-medium px-2 py-0.5 rounded-full shrink-0"
          style={{ background: pill.bg, color: pill.color }}
        >
          {pill.label}
        </span>
      </div>

      {/* Label + confidence */}
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{finding.label}</p>
        {!isDet && (
          <span className="text-xs font-mono" style={{ color: confidenceColor(conf) }}>
            {confidence_pct(conf)}
          </span>
        )}
      </div>

      {/* Content */}
      {isDet ? (
        <div className="space-y-1">
          {(finding.matched_text ?? []).map((excerpt, i) => (
            <p key={i} className="text-xs px-2 py-1 rounded" style={{ background: 'var(--color-bg)', color: 'var(--color-text)', fontFamily: 'var(--font-mono, monospace)' }}>
              …{excerpt}…
            </p>
          ))}
        </div>
      ) : (
        <div className="space-y-1">
          {finding.description && (
            <p className="text-xs" style={{ color: 'var(--color-text)' }}>{finding.description}</p>
          )}
          {finding.excerpt && (
            <p className="text-xs px-2 py-1 rounded italic" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }}>
              "{finding.excerpt}"
            </p>
          )}
          {!compact && finding.reasoning && (
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              <strong>Reasoning:</strong> {finding.reasoning}
            </p>
          )}
        </div>
      )}

      {/* Action */}
      {finding.action && (
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          <strong>Action:</strong> {finding.action}
        </p>
      )}

      {/* Review outcome */}
      {finding.status !== 'pending_review' && finding.reviewed_by && (
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          {pill.label} by {finding.reviewed_by} · {fmtTs(finding.reviewed_at)}
          {finding.comment && ` · "${finding.comment}"`}
        </p>
      )}
    </div>
  );
}

function ReviewItem({ finding, runId, onUpdated, getIcon, revisedAssessment }) {
  const [comment, setComment]         = useState('');
  const [showComment, setShowComment] = useState(false);
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState('');

  const isDet        = finding.stage === 'deterministic';
  const conf         = finding.confidence ?? 1.0;
  const isLow        = !isDet && conf < LOW_CONFIDENCE;
  const isCross      = finding.also_flagged_deterministic || finding.also_flagged_probabilistic;
  const needsComment = isLow || isCross;
  const isResubmit   = finding.status === 'resubmit';

  const submit = async (status) => {
    if (needsComment && status === 'approved' && !comment.trim()) {
      setShowComment(true);
      setError('Comment required before approving this finding.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await api.patch(`/demo/runs/${runId}/review/${finding.finding_id}`, { status, comment: comment.trim() || undefined });
      onUpdated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (finding.status !== 'pending_review' && !isResubmit) {
    return <FindingCard finding={finding} getIcon={getIcon} compact />;
  }

  const pill = statusPill(finding.status);

  return (
    <div
      className="rounded-xl p-4 space-y-3"
      style={{
        background: isResubmit ? '#faf5ff' : 'var(--color-surface)',
        border: `1px solid ${isCross ? '#fbbf24' : isResubmit ? '#c4b5fd' : 'var(--color-border)'}`,
      }}
    >
      {/* Badge row */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: isDet ? '#eff6ff' : '#faf5ff', color: isDet ? '#1d4ed8' : '#7c3aed' }}>
          {isDet ? 'Deterministic' : 'Probabilistic'}
        </span>
        {isResubmit && <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#e0e7ff', color: '#3730a3' }}>Flagged for re-examination</span>}
        {isCross && <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#fffbeb', color: '#92400e' }}>Both stages flagged</span>}
        {isLow && <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#fef2f2', color: '#991b1b' }}>Low confidence — Engineering Lead validation required</span>}
        {!isLow && !isCross && !isResubmit && <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: pill.bg, color: pill.color }}>{pill.label}</span>}
      </div>

      {/* Label + confidence */}
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{finding.label}</p>
        {!isDet && <span className="text-xs font-mono" style={{ color: confidenceColor(conf) }}>{confidence_pct(conf)}</span>}
      </div>

      {/* Excerpt / matched text */}
      {isDet
        ? (finding.matched_text ?? []).slice(0, 2).map((t, i) => (
            <p key={i} className="text-xs px-2 py-1 rounded" style={{ background: 'var(--color-bg)', color: 'var(--color-text)', fontFamily: 'var(--font-mono, monospace)' }}>…{t}…</p>
          ))
        : finding.excerpt && (
            <p className="text-xs px-2 py-1 rounded italic" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }}>"{finding.excerpt}"</p>
          )
      }

      {/* Action */}
      {finding.action && <p className="text-xs" style={{ color: 'var(--color-muted)' }}><strong>Action:</strong> {finding.action}</p>}

      {/* Reviewer's original comment (resubmit only) */}
      {isResubmit && finding.comment && (
        <div className="rounded-lg px-3 py-2" style={{ background: '#ede9fe', border: '1px solid #c4b5fd' }}>
          <p className="text-xs font-semibold mb-0.5" style={{ color: '#5b21b6' }}>Reviewer note</p>
          <p className="text-xs" style={{ color: '#3730a3' }}>{finding.comment}</p>
        </div>
      )}

      {/* Revised AI assessment (populated after re-examine) */}
      {revisedAssessment && (
        <div className="rounded-lg px-3 py-2 space-y-1" style={{ background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
          <p className="text-xs font-semibold" style={{ color: '#166534' }}>Revised AI assessment</p>
          <p className="text-xs" style={{ color: 'var(--color-text)' }}>{revisedAssessment.revised_assessment}</p>
          {(revisedAssessment.key_points ?? []).length > 0 && (
            <ul className="list-disc list-inside space-y-0.5">
              {revisedAssessment.key_points.map((pt, i) => (
                <li key={i} className="text-xs" style={{ color: 'var(--color-muted)' }}>{pt}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Comment box (not shown for resubmit — they already commented) */}
      {!isResubmit && (showComment || needsComment) && (
        <textarea
          rows={2}
          placeholder={needsComment ? 'Comment required before approving…' : 'Optional comment…'}
          value={comment}
          onChange={(e) => { setComment(e.target.value); setError(''); }}
          className="w-full text-xs rounded-lg p-2 resize-none"
          style={{ border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontFamily: 'inherit', outline: 'none' }}
        />
      )}

      {error && <p className="text-xs" style={{ color: '#dc2626' }}>{error}</p>}

      {/* Actions — resubmit findings only get Approve / Reject */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => submit('approved')}
          disabled={submitting}
          className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
          style={{ background: '#dcfce7', color: '#166534', cursor: submitting ? 'not-allowed' : 'pointer' }}
        >
          Approve
        </button>
        <button
          onClick={() => submit('rejected')}
          disabled={submitting}
          className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
          style={{ background: '#fee2e2', color: '#991b1b', cursor: submitting ? 'not-allowed' : 'pointer' }}
        >
          Reject
        </button>
        {!isResubmit && (
          <button
            onClick={() => submit('resubmit')}
            disabled={submitting}
            className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
            style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)', cursor: submitting ? 'not-allowed' : 'pointer' }}
          >
            Resubmit
          </button>
        )}
        {!isResubmit && !showComment && !needsComment && (
          <button
            onClick={() => setShowComment(true)}
            className="text-xs"
            style={{ color: 'var(--color-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            + Add comment
          </button>
        )}
      </div>
    </div>
  );
}

function DecisionTrace({ trace, getIcon }) {
  if (!trace?.length) return null;

  const stepMeta = {
    input_sanitisation:              { icon: 'shield', label: 'Input Sanitisation' },
    deterministic_rules:             { icon: 'zap',    label: 'Deterministic Rules' },
    probabilistic_analysis:          { icon: 'cpu',    label: 'Probabilistic Analysis' },
    review_action:                   { icon: 'user',   label: 'Review Action' },
  };

  return (
    <div className="space-y-0">
      {trace.map((step, i) => {
        const meta  = stepMeta[step.step] ?? { icon: 'circle', label: step.step };
        const isLast = i === trace.length - 1;

        return (
          <div key={i} className="flex gap-3">
            {/* Timeline spine */}
            <div className="flex flex-col items-center" style={{ width: 24, flexShrink: 0 }}>
              <div
                className="flex items-center justify-center rounded-full"
                style={{ width: 24, height: 24, background: 'var(--color-surface)', border: '2px solid var(--color-border)', flexShrink: 0 }}
              >
                <span style={{ color: 'var(--color-primary)' }}>{getIcon(meta.icon, { size: 10 })}</span>
              </div>
              {!isLast && <div style={{ width: 2, flex: 1, background: 'var(--color-border)', minHeight: 16 }} />}
            </div>

            {/* Content */}
            <div className="pb-4 min-w-0 flex-1">
              <div className="flex items-baseline gap-2 flex-wrap">
                <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{meta.label}</p>
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{fmtTs(step.timestamp)}</p>
              </div>

              {step.step === 'input_sanitisation' && (
                <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                  {step.label ?? step.result} · {step.file_name}
                </p>
              )}
              {step.step === 'deterministic_rules' && (
                <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                  {step.rules_evaluated} rules evaluated · {step.rules_matched} matched
                </p>
              )}
              {step.step === 'probabilistic_analysis' && (
                <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                  Model: {step.model} · {step.findings_count} findings
                </p>
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
  );
}

// ── Certificate builder ───────────────────────────────────────────────────────

function buildCertificateHtml(runData, orgName, tokensUsed, costAud) {
  const d = runData;
  const allFindings = d.all_findings ?? [];
  const detFindings = d.deterministic_findings ?? [];
  const probFindings = d.probabilistic_findings ?? [];

  const fmtFinding = (f) => {
    const conf = f.stage === 'deterministic' ? '1.00 (deterministic)' : confidence_pct(f.confidence ?? 0);
    const excerpt = f.stage === 'deterministic'
      ? (f.matched_text ?? []).slice(0, 1).join('; ')
      : (f.excerpt ?? '');
    return `<tr>
      <td style="padding:6px 8px;border:1px solid #e5e7eb;font-size:11px;">${f.label}</td>
      <td style="padding:6px 8px;border:1px solid #e5e7eb;font-size:11px;">${f.stage}</td>
      <td style="padding:6px 8px;border:1px solid #e5e7eb;font-size:11px;">${conf}</td>
      <td style="padding:6px 8px;border:1px solid #e5e7eb;font-size:11px;">${excerpt.slice(0, 120)}</td>
      <td style="padding:6px 8px;border:1px solid #e5e7eb;font-size:11px;color:${statusPill(f.status).color};">${statusPill(f.status).label}</td>
      <td style="padding:6px 8px;border:1px solid #e5e7eb;font-size:11px;">${f.reviewed_by ?? '—'}</td>
      <td style="padding:6px 8px;border:1px solid #e5e7eb;font-size:11px;">${fmtTs(f.reviewed_at)}</td>
      <td style="padding:6px 8px;border:1px solid #e5e7eb;font-size:11px;">${f.comment ?? '—'}</td>
    </tr>`;
  };

  const reviewActions = (d.trace ?? []).filter((t) => t.step === 'review_action');

  return `
<div style="font-family:Georgia,serif;max-width:900px;margin:0 auto;padding:40px;">
  <div style="text-align:center;margin-bottom:32px;">
    <h1 style="font-size:20px;font-weight:bold;margin:0;">Document Analysis Compliance Certificate</h1>
    <p style="font-size:12px;color:#6b7280;margin-top:4px;">Generated ${new Date().toLocaleString('en-AU')}</p>
  </div>

  <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
    <tr><td style="padding:6px 8px;font-size:12px;font-weight:bold;width:180px;">Client Organisation</td><td style="padding:6px 8px;font-size:12px;">${orgName}</td></tr>
    <tr style="background:#f9fafb;"><td style="padding:6px 8px;font-size:12px;font-weight:bold;">Document</td><td style="padding:6px 8px;font-size:12px;">${d.file_name}</td></tr>
    <tr><td style="padding:6px 8px;font-size:12px;font-weight:bold;">Document Type</td><td style="padding:6px 8px;font-size:12px;">${d.document_type ?? '—'}</td></tr>
    <tr style="background:#f9fafb;"><td style="padding:6px 8px;font-size:12px;font-weight:bold;">SHA-256 Hash</td><td style="padding:6px 8px;font-size:12px;font-family:monospace;">${d.file_hash}</td></tr>
    <tr><td style="padding:6px 8px;font-size:12px;font-weight:bold;">Processed At</td><td style="padding:6px 8px;font-size:12px;">${fmtTs(d.trace?.[0]?.timestamp)}</td></tr>
    <tr style="background:#f9fafb;"><td style="padding:6px 8px;font-size:12px;font-weight:bold;">Model Used</td><td style="padding:6px 8px;font-size:12px;">${d.model ?? '—'}</td></tr>
    <tr><td style="padding:6px 8px;font-size:12px;font-weight:bold;">Token Usage</td><td style="padding:6px 8px;font-size:12px;">${fmtTokens(tokensUsed)} tokens · ${fmtCost(costAud)}</td></tr>
    <tr style="background:#f9fafb;"><td style="padding:6px 8px;font-size:12px;font-weight:bold;">Deterministic Rules</td><td style="padding:6px 8px;font-size:12px;">7 evaluated · ${detFindings.length} matched</td></tr>
    <tr><td style="padding:6px 8px;font-size:12px;font-weight:bold;">Probabilistic Findings</td><td style="padding:6px 8px;font-size:12px;">${probFindings.length} identified</td></tr>
    <tr style="background:#f9fafb;"><td style="padding:6px 8px;font-size:12px;font-weight:bold;">Total Findings Reviewed</td><td style="padding:6px 8px;font-size:12px;">${allFindings.length}</td></tr>
    <tr><td style="padding:6px 8px;font-size:12px;font-weight:bold;">Review Actions</td><td style="padding:6px 8px;font-size:12px;">${reviewActions.length}</td></tr>
  </table>

  <h2 style="font-size:14px;font-weight:bold;margin-bottom:8px;">Findings and Review Decisions</h2>
  <table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:24px;">
    <thead>
      <tr style="background:#f3f4f6;">
        <th style="padding:6px 8px;border:1px solid #e5e7eb;text-align:left;">Finding</th>
        <th style="padding:6px 8px;border:1px solid #e5e7eb;text-align:left;">Stage</th>
        <th style="padding:6px 8px;border:1px solid #e5e7eb;text-align:left;">Confidence</th>
        <th style="padding:6px 8px;border:1px solid #e5e7eb;text-align:left;">Excerpt</th>
        <th style="padding:6px 8px;border:1px solid #e5e7eb;text-align:left;">Decision</th>
        <th style="padding:6px 8px;border:1px solid #e5e7eb;text-align:left;">Reviewer</th>
        <th style="padding:6px 8px;border:1px solid #e5e7eb;text-align:left;">Reviewed At</th>
        <th style="padding:6px 8px;border:1px solid #e5e7eb;text-align:left;">Comment</th>
      </tr>
    </thead>
    <tbody>${allFindings.map(fmtFinding).join('')}</tbody>
  </table>

  <div style="border-top:2px solid #111827;padding-top:16px;font-size:11px;color:#374151;">
    <p><strong>Statement of Ephemeral Processing:</strong> Document processed ephemerally. No source file retained after session. The SHA-256 hash above provides cryptographic proof of the document that was analysed without requiring file retention.</p>
    <p style="margin-top:8px;color:#6b7280;">This certificate was generated automatically by the Curam Engineering AI Document Analyzer. It records the AI-assisted analysis and the human review decisions made by the engineering team. It does not constitute legal advice.</p>
  </div>
</div>`;
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DocumentAnalyzer() {
  const getIcon  = useIcon();
  const { user } = useAuthStore();

  const [file, setFile]           = useState(null);
  const [dragging, setDragging]   = useState(false);
  const [running, setRunning]     = useState(false);
  const [progress, setProgress]   = useState([]);
  const [runResult, setRunResult] = useState(null);   // full resultPayload from SSE
  const [runId, setRunId]         = useState(null);
  const [error, setError]         = useState('');
  const [certLoading, setCertLoading] = useState(false);
  const [viewLoading, setViewLoading] = useState(false);
  const [certError, setCertError] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const [emailOpen, setEmailOpen]     = useState(false);
  const [emailTo, setEmailTo]         = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailError, setEmailError]   = useState('');
  const [emailSent, setEmailSent]     = useState(false);
  const [resubmitLoading, setResubmitLoading] = useState(false);
  const [resubmitError, setResubmitError] = useState('');
  const [resubmitResults, setResubmitResults] = useState({});  // { finding_id: { revised_assessment, key_points } }
  const [customPrompt, setCustomPrompt] = useState('');
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpQuestion, setFollowUpQuestion] = useState('');
  const [followUpHistory, setFollowUpHistory] = useState([]);  // array of { question, answer, model, timestamp }
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const [followUpError, setFollowUpError] = useState('');
  const [recentRuns, setRecentRuns] = useState([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const fileInputRef = useRef(null);

  // ── Load recent sessions on mount ─────────────────────────────────────────

  useEffect(() => {
    api.get('/demo/runs?slug=demo-document-analyzer&limit=10')
      .then((data) => { setRecentRuns(data); setRunsLoading(false); })
      .catch(() => setRunsLoading(false));
  }, []);

  // ── Load a prior session ───────────────────────────────────────────────────

  const handleLoadRun = async (id) => {
    try {
      const row = await api.get(`/demo/runs/${id}`);
      const data = row.result?.data ?? {};
      setRunResult(data);
      setRunId(id);
      setFollowUpHistory(data.follow_up_history ?? []);
      setFollowUpOpen(false);
      setFollowUpQuestion('');
      setFollowUpError('');
      setFile(null);
      setProgress([]);
      setError('');
    } catch (err) {
      setError(`Failed to load session: ${err.message}`);
    }
  };

  // ── File handling ──────────────────────────────────────────────────────────

  const acceptFile = (f) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(f.type)) {
      setError('Unsupported file type. Upload a PDF, JPEG, PNG, or WEBP.');
      return;
    }
    if (f.size > 9 * 1024 * 1024) {
      setError('File exceeds 9 MB limit.');
      return;
    }
    setError('');
    setFile(f);
    setRunResult(null);
    setRunId(null);
    setProgress([]);
  };

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) acceptFile(f);
  }, []);

  const onDragOver  = (e) => { e.preventDefault(); setDragging(true); };
  const onDragLeave = ()  => setDragging(false);

  // ── Run ────────────────────────────────────────────────────────────────────

  const handleRun = async () => {
    if (!file) return;
    setRunning(true);
    setError('');
    setProgress([]);
    setRunResult(null);
    setRunId(null);
    setCertError('');

    // Read file as base64
    const fileData = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = (e) => {
        // data URL is "data:<mime>;base64,<data>" — strip the prefix
        const base64 = e.target.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = () => reject(new Error('Failed to read file.'));
      reader.readAsDataURL(file);
    }).catch((err) => { setError(err.message); setRunning(false); return null; });

    if (!fileData) return;

    await streamRun(
      { fileData, mimeType: file.type, fileName: file.name, customPrompt },
      (text)   => setProgress((p) => [...p, text]),
      async (data) => {
        setRunResult(data);
        // Fetch runId from server — most recent run for this org/slug
        try {
          const runs = await api.get('/demo/runs?slug=demo-document-analyzer&limit=1');
          if (runs[0]?.id) setRunId(runs[0].id);
        } catch { /* non-fatal — review actions won't work without runId */ }
      },
      (err)    => setError(err),
    );
    setRunning(false);
  };

  // ── Review refresh ─────────────────────────────────────────────────────────

  const refreshRun = async () => {
    if (!runId) return;
    try {
      const row = await api.get(`/demo/runs/${runId}`);
      setRunResult(row.result?.data ?? row.result);
    } catch { /* non-fatal */ }
  };

  // ── Download original file ────────────────────────────────────────────────

  const handleDownload = async () => {
    if (!runId) return;
    setDownloadError('');
    try {
      const { blob, filename } = await api.downloadBlob(`/demo/runs/${runId}/download`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setDownloadError(err.message);
    }
  };

  // ── Certificate ────────────────────────────────────────────────────────────

  const handleCertificate = async () => {
    setCertLoading(true);
    setCertError('');
    try {
      const orgName = user?.orgName ?? 'Curam Engineering';
      const html    = buildCertificateHtml(
        runResult,
        orgName,
        runResult?.tokensUsed ?? runResult?.tokens_used,
        runResult?.costAud,
      );
      const safeFileName = (runResult?.file_name ?? 'document')
        .replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]/gi, '_').slice(0, 40);
      await exportPdf({
        content:     html,
        contentType: 'html',
        title:       `Compliance Certificate — ${runResult?.file_name ?? 'Document'}`,
        filename:    `certificate-${safeFileName}-${Date.now()}.pdf`,
      });
    } catch (err) {
      setCertError(err.message);
    } finally {
      setCertLoading(false);
    }
  };

  // ── Preview certificate (blob URL in new tab) ──────────────────────────────

  const handleViewCertificate = () => {
    setViewLoading(true);
    try {
      const orgName = user?.orgName ?? 'Curam Engineering';
      const html    = buildCertificateHtml(
        runResult,
        orgName,
        runResult?.tokensUsed ?? runResult?.tokens_used,
        runResult?.costAud,
      );
      const blob = new Blob([html], { type: 'text/html' });
      const url  = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } finally {
      setViewLoading(false);
    }
  };

  // ── Email certificate ─────────────────────────────────────────────────────

  const handleEmailCertificate = async () => {
    if (!runId || !emailTo.trim()) return;
    setEmailSending(true);
    setEmailError('');
    setEmailSent(false);
    try {
      const orgName = user?.orgName ?? 'Curam Engineering';
      const html    = buildCertificateHtml(
        runResult,
        orgName,
        runResult?.tokensUsed ?? runResult?.tokens_used,
        runResult?.costAud,
      );
      const safeFileName = (runResult?.file_name ?? 'document')
        .replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]/gi, '_').slice(0, 40);
      await api.post(`/demo/runs/${runId}/email-certificate`, {
        to:       emailTo.trim(),
        html,
        title:    `Compliance Certificate — ${runResult?.file_name ?? 'Document'}`,
        filename: `certificate-${safeFileName}.pdf`,
      });
      setEmailSent(true);
      setEmailOpen(false);
    } catch (err) {
      setEmailError(err.message);
    } finally {
      setEmailSending(false);
    }
  };

  // ── Resubmit ───────────────────────────────────────────────────────────────

  const handleResubmit = async () => {
    if (!runId) return;
    setResubmitLoading(true);
    setResubmitError('');
    try {
      const res = await api.post(`/demo/runs/${runId}/resubmit`, {});
      const map = {};
      for (const a of (res.findings ?? [])) map[a.finding_id] = a;
      setResubmitResults(map);
    } catch (err) {
      setResubmitError(err.message);
    } finally {
      setResubmitLoading(false);
    }
  };

  // ── Derived state ──────────────────────────────────────────────────────────

  const allFindings    = runResult?.all_findings ?? [];
  const detFindings    = runResult?.deterministic_findings ?? [];
  const probFindings   = runResult?.probabilistic_findings ?? [];
  const pendingCount   = allFindings.filter((f) => f.status === 'pending_review').length;
  const resubmitCount  = allFindings.filter((f) => f.status === 'resubmit').length;
  const hasResubmit    = resubmitCount > 0;
  const allResolved    = allFindings.length > 0 && pendingCount === 0 && resubmitCount === 0;
  const trace          = runResult?.trace ?? [];
  const model          = runResult?.model ?? '—';
  const costAud        = runResult?.costAud;
  const tokensUsed     = runResult?.tokensUsed;
  const s3Info         = runResult?.s3 ?? runResult?.data?.s3 ?? null;
  const s3Error        = s3Info?.error ?? null;
  const customResponse = runResult?.custom_response ?? runResult?.data?.custom_response ?? null;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Document Analyzer</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
            Upload an engineering document — contracts, specifications, scope of work, RFIs.
          </p>
        </div>
        {runResult && (
          <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--color-muted)' }}>
            <span>Model: <strong style={{ color: 'var(--color-text)' }}>{model}</strong></span>
            <span>Tokens: <strong style={{ color: 'var(--color-text)' }}>{fmtTokens(tokensUsed)}</strong></span>
            <span>Cost: <strong style={{ color: 'var(--color-text)' }}>{fmtCost(costAud)}</strong></span>
          </div>
        )}
      </div>

      {/* Upload zone */}
      {!running && !runResult && (
        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className="rounded-xl flex flex-col items-center justify-center gap-3 cursor-pointer transition-colors"
          style={{
            border: `2px dashed ${dragging ? 'var(--color-primary)' : 'var(--color-border)'}`,
            background: dragging ? 'rgba(var(--color-primary-rgb),0.04)' : 'var(--color-surface)',
            minHeight: 160,
            padding: '2rem',
          }}
        >
          <span style={{ color: 'var(--color-primary)' }}>{getIcon('upload', { size: 28 })}</span>
          {file ? (
            <div className="text-center">
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{file.name}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                {(file.size / 1024).toFixed(0)} KB · {file.type}
              </p>
            </div>
          ) : (
            <div className="text-center">
              <p className="text-sm" style={{ color: 'var(--color-text)' }}>Drop a file or click to browse</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>PDF, JPEG, PNG, WEBP · max 9 MB</p>
            </div>
          )}
          <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,image/jpeg,image/png,image/webp,image/gif" onChange={(e) => { if (e.target.files[0]) acceptFile(e.target.files[0]); }} />
        </div>
      )}

      {/* Custom prompt */}
      {!running && !runResult && file && (
        <div className="space-y-2">
          <label className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>
            Custom instructions (optional)
          </label>
          <div className="relative">
            <textarea
              rows={3}
              placeholder="e.g. Focus specifically on payment terms and liability caps…"
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              className="w-full text-sm rounded-xl p-3 resize-none"
              style={{
                border: '1px solid var(--color-border)',
                background: 'var(--color-surface)',
                color: 'var(--color-text)',
                fontFamily: 'inherit',
                outline: 'none',
                paddingRight: 36,
              }}
            />
            <div className="absolute" style={{ bottom: 8, right: 8 }}>
              <MicButton
                onResult={(t) => setCustomPrompt((prev) => {
                  const base = (prev ?? '').replace(/\s*\[.*?\]$/, '').trim();
                  return base ? base + ' ' + t : t;
                })}
                onPartial={(t) => setCustomPrompt((prev) => {
                  const base = (prev ?? '').replace(/\s*\[.*?\]$/, '').trim();
                  return base ? base + ' [' + t + ']' : '[' + t + ']';
                })}
                size={14}
              />
            </div>
          </div>
        </div>
      )}

      {/* Selected file + Analyze button */}
      {!running && !runResult && file && (
        <button
          onClick={handleRun}
          className="w-full py-2.5 rounded-xl text-sm font-semibold transition-colors"
          style={{ background: 'var(--color-primary)', color: '#fff', cursor: 'pointer' }}
        >
          Analyze Document
        </button>
      )}

      {/* Recent sessions browser */}
      {!running && !runResult && !runsLoading && recentRuns.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
            Recent Sessions
          </p>
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
            {recentRuns.map((run, i) => {
              const pending = run.pending_review_count ?? 0;
              return (
                <button
                  key={run.id}
                  onClick={() => handleLoadRun(run.id)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left transition-opacity hover:opacity-70"
                  style={{
                    background: 'var(--color-surface)',
                    borderTop: i > 0 ? '1px solid var(--color-border)' : 'none',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>
                      {run.file_name ?? 'Document'}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                      {fmtTs(run.run_at)}
                      {run.document_type ? ` · ${run.document_type}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {pending > 0 && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#fef3c7', color: '#92400e' }}>
                        {pending} pending
                      </span>
                    )}
                    {pending === 0 && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#dcfce7', color: '#166534' }}>
                        Reviewed
                      </span>
                    )}
                    <span style={{ color: 'var(--color-muted)' }}>{getIcon('chevron-right', { size: 14 })}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-xl p-3 text-sm" style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' }}>
          {error}
        </div>
      )}

      {/* Progress */}
      {running && (
        <div className="rounded-xl border p-4 space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-2 mb-2">
            <span style={{ color: 'var(--color-primary)' }}>{getIcon('loader', { size: 14 })}</span>
            <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Analysing document…</p>
          </div>
          {progress.map((msg, i) => (
            <p key={i} className="text-xs" style={{ color: 'var(--color-muted)' }}>→ {msg}</p>
          ))}
        </div>
      )}

      {/* Results */}
      {runResult && (
        <>
          {/* Sanitisation card — first thing shown */}
          {/* sanitisation may be at runResult.sanitisation (from DB fetch) or runResult.data.sanitisation (from SSE stream) */}
          <SanitisationCard sanitisation={runResult.sanitisation ?? runResult.data?.sanitisation} getIcon={getIcon} />

          {/* Re-analyze */}
          <button
            onClick={() => { setRunResult(null); setRunId(null); setProgress([]); setError(''); setFollowUpHistory([]); setFollowUpOpen(false); setFollowUpQuestion(''); }}
            className="text-xs"
            style={{ color: 'var(--color-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            ← Analyze another document
          </button>

          {/* Summary */}
          {runResult.summary && (
            <div className="rounded-xl p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>Summary</p>
              <MarkdownRenderer text={runResult.summary} />
            </div>
          )}

          {/* Custom response */}
          {customResponse && (
            <div className="rounded-xl p-4" style={{ background: '#fffbeb', border: '1px solid #fde68a' }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: '#92400e' }}>
                Response to your instructions
              </p>
              <MarkdownRenderer text={customResponse} />
            </div>
          )}

          {/* ── Follow-up Q&A section — immediately after LLM response ──────── */}
          {/* Follow-up history — all previous Q&A pairs */}
          {followUpHistory.map((item, i) => (
            <div key={i} className="space-y-3">
              {/* Question */}
              <div className="rounded-xl p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                    Follow-up question #{i + 1}
                  </p>
                  {item.timestamp && (
                    <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{fmtTs(item.timestamp)}</p>
                  )}
                </div>
                <p className="text-sm" style={{ color: 'var(--color-text)' }}>{item.question}</p>
              </div>
              {/* Answer */}
              <div className="rounded-xl p-4" style={{ background: '#f0f9ff', border: '1px solid #bae6fd' }}>
                <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: '#0369a1' }}>
                  Answer
                </p>
                <MarkdownRenderer text={item.answer} />
                {item.model && (
                  <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>
                    Model: {item.model}
                  </p>
                )}
              </div>
            </div>
          ))}

          {/* Follow-up input box */}
          <div className="rounded-xl p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            {!followUpOpen ? (
              <button
                onClick={() => setFollowUpOpen(true)}
                className="w-full py-2 rounded-xl text-sm font-medium transition-colors"
                style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px dashed var(--color-border)', cursor: 'pointer' }}
              >
                + Ask a follow-up question
              </button>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                    Follow-up question
                  </p>
                  <button
                    onClick={() => { setFollowUpOpen(false); setFollowUpQuestion(''); setFollowUpError(''); }}
                    className="text-xs"
                    style={{ color: 'var(--color-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                </div>

                <div className="relative">
                  <textarea
                    rows={3}
                    placeholder="Ask anything about the document — e.g. What are the key payment terms? Is there a dispute resolution clause?"
                    value={followUpQuestion}
                    onChange={(e) => { setFollowUpQuestion(e.target.value); setFollowUpError(''); }}
                    className="w-full text-sm rounded-xl p-3 resize-none"
                    style={{
                      border: '1px solid var(--color-border)',
                      background: 'var(--color-bg)',
                      color: 'var(--color-text)',
                      fontFamily: 'inherit',
                      outline: 'none',
                      paddingRight: 36,
                    }}
                  />
                  <div className="absolute" style={{ bottom: 8, right: 8 }}>
                    <MicButton
                      onResult={(t) => setFollowUpQuestion((prev) => {
                        const base = (prev ?? '').replace(/\s*\[.*?\]$/, '').trim();
                        return base ? base + ' ' + t : t;
                      })}
                      onPartial={(t) => setFollowUpQuestion((prev) => {
                        const base = (prev ?? '').replace(/\s*\[.*?\]$/, '').trim();
                        return base ? base + ' [' + t + ']' : '[' + t + ']';
                      })}
                      size={14}
                    />
                  </div>
                </div>

                <button
                  onClick={async () => {
                    if (!followUpQuestion.trim() || !runId) return;
                    setFollowUpLoading(true);
                    setFollowUpError('');
                    try {
                      const res = await api.post(`/demo/runs/${runId}/follow-up`, { question: followUpQuestion.trim() });
                      setFollowUpHistory((prev) => [...prev, { question: followUpQuestion.trim(), answer: res.answer, model: res.model }]);
                      setFollowUpQuestion('');
                      setFollowUpOpen(false);
                    } catch (err) {
                      setFollowUpError(err.message);
                    } finally {
                      setFollowUpLoading(false);
                    }
                  }}
                  disabled={followUpLoading || !followUpQuestion.trim() || !runId}
                  className="w-full py-2 rounded-xl text-sm font-semibold transition-colors"
                  style={
                    followUpLoading || !followUpQuestion.trim() || !runId
                      ? { background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)', cursor: 'not-allowed' }
                      : { background: 'var(--color-primary)', color: '#fff', cursor: 'pointer' }
                  }
                >
                  {followUpLoading ? 'Getting answer…' : 'Ask'}
                </button>

                {followUpError && (
                  <p className="text-xs" style={{ color: '#dc2626' }}>{followUpError}</p>
                )}

                {!runId && (
                  <p className="text-xs" style={{ color: '#d97706' }}>
                    Run ID not available — follow-up questions require the server to confirm the run was saved.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ── Findings and analysis details (bottom of page) ─────────────── */}
          <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '1rem 0' }} />

          {/* Two findings panels */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Deterministic panel */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                  Deterministic — {detFindings.length} finding{detFindings.length !== 1 ? 's' : ''}
                </p>
                <span
                  className="text-xs px-1.5 py-0.5 rounded-full"
                  style={{ background: '#eff6ff', color: '#1d4ed8' }}
                >
                  confidence 1.0
                </span>
              </div>
              {detFindings.length === 0
                ? <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No pattern matches found.</p>
                : detFindings.map((f) => <FindingCard key={f.finding_id} finding={f} getIcon={getIcon} />)
              }
            </div>

            {/* Probabilistic panel */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                  Probabilistic — {probFindings.length} finding{probFindings.length !== 1 ? 's' : ''}
                </p>
                {runResult.low_confidence_count > 0 && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: '#fef2f2', color: '#991b1b' }}>
                    {runResult.low_confidence_count} low confidence
                  </span>
                )}
              </div>
              {probFindings.length === 0
                ? <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No probabilistic findings.</p>
                : probFindings.map((f) => <FindingCard key={f.finding_id} finding={f} getIcon={getIcon} />)
              }
            </div>
          </div>

          {/* Review queue */}
          {allFindings.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                  Review Queue — {pendingCount} pending
                </p>
                {pendingCount === 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: '#dcfce7', color: '#166534' }}>
                    All resolved
                  </span>
                )}
              </div>

              {!runId && (
                <p className="text-xs" style={{ color: '#d97706' }}>
                  Run ID not available — review actions require the server to confirm the run was saved.
                </p>
              )}

              {allFindings.map((f) => (
                <ReviewItem
                  key={f.finding_id}
                  finding={f}
                  runId={runId}
                  onUpdated={refreshRun}
                  getIcon={getIcon}
                  revisedAssessment={resubmitResults[f.finding_id]}
                />
              ))}
            </div>
          )}

          {/* Decision trace */}
          {trace.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                Decision Trace
              </p>
              <div className="rounded-xl p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                <DecisionTrace trace={trace} getIcon={getIcon} />
              </div>
            </div>
          )}

          {/* Certificate / Resubmit card */}
          <div
            className="rounded-xl p-4 flex items-center justify-between gap-4"
            style={{
              background: hasResubmit && pendingCount === 0 ? '#faf5ff' : 'var(--color-surface)',
              border: `1px solid ${hasResubmit && pendingCount === 0 ? '#c4b5fd' : 'var(--color-border)'}`,
            }}
          >
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                {allResolved ? 'Compliance Certificate' : hasResubmit && pendingCount === 0 ? 'Findings Flagged for Re-examination' : 'Compliance Certificate'}
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                {pendingCount > 0
                  ? `${pendingCount} finding${pendingCount !== 1 ? 's' : ''} still pending review.`
                  : hasResubmit
                  ? `${resubmitCount} finding${resubmitCount !== 1 ? 's' : ''} flagged for re-examination — click to get a revised AI assessment, then approve or reject.`
                  : 'All findings reviewed — certificate ready to generate.'
                }
              </p>
              {resubmitError && <p className="text-xs mt-1" style={{ color: '#dc2626' }}>{resubmitError}</p>}
              {certError && <p className="text-xs mt-1" style={{ color: '#dc2626' }}>{certError}</p>}
            </div>
            {pendingCount === 0 && hasResubmit && (
              <button
                onClick={handleResubmit}
                disabled={resubmitLoading || !runId}
                className="shrink-0 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                style={
                  resubmitLoading || !runId
                    ? { background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)', cursor: 'not-allowed' }
                    : { background: '#7c3aed', color: '#fff', cursor: 'pointer' }
                }
              >
                {resubmitLoading ? 'Re-examining…' : 'Re-examine with AI'}
              </button>
            )}
            {allResolved && (
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={handleViewCertificate}
                  disabled={viewLoading}
                  title="Preview certificate"
                  className="rounded-lg p-2 transition-colors"
                  style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)', cursor: viewLoading ? 'not-allowed' : 'pointer', lineHeight: 0 }}
                >
                  {getIcon('eye', { size: 16 })}
                </button>
                <button
                  onClick={handleCertificate}
                  disabled={certLoading}
                  title="Download PDF"
                  className="rounded-lg p-2 transition-colors"
                  style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)', cursor: certLoading ? 'not-allowed' : 'pointer', lineHeight: 0 }}
                >
                  {getIcon('download', { size: 16 })}
                </button>
                <button
                  onClick={() => { setEmailOpen((o) => !o); setEmailSent(false); setEmailError(''); if (!emailTo && user?.email) setEmailTo(user.email); }}
                  title={emailSent ? 'Certificate sent' : 'Email certificate'}
                  className="rounded-lg p-2 transition-colors"
                  style={{ background: 'var(--color-bg)', color: emailSent ? '#16a34a' : 'var(--color-text)', border: `1px solid ${emailSent ? '#16a34a' : 'var(--color-border)'}`, cursor: 'pointer', lineHeight: 0 }}
                >
                  {getIcon('mail', { size: 16 })}
                </button>
              </div>
            )}
          </div>

          {/* Email certificate — inline form */}
          {emailOpen && allResolved && (
            <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                Email Certificate
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="email"
                  placeholder="recipient@example.com"
                  value={emailTo}
                  onChange={(e) => { setEmailTo(e.target.value); setEmailError(''); }}
                  className="flex-1 text-sm rounded-lg px-3 py-2"
                  style={{ border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontFamily: 'inherit', outline: 'none' }}
                />
                <button
                  onClick={handleEmailCertificate}
                  disabled={emailSending || !emailTo.trim() || !runId}
                  className="text-sm font-medium px-4 py-2 rounded-lg transition-colors shrink-0"
                  style={
                    emailSending || !emailTo.trim() || !runId
                      ? { background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)', cursor: 'not-allowed' }
                      : { background: 'var(--color-primary)', color: '#fff', cursor: 'pointer' }
                  }
                >
                  {emailSending ? 'Sending…' : 'Send'}
                </button>
                <button
                  onClick={() => setEmailOpen(false)}
                  className="text-xs"
                  style={{ color: 'var(--color-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </div>
              {emailError && <p className="text-xs" style={{ color: '#dc2626' }}>{emailError}</p>}
            </div>
          )}

          {/* Original file download + S3 Storage */}
          <div className="rounded-xl p-4 flex items-center justify-between gap-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Original File</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                {runResult?.file_name ?? 'Document'}
              </p>
              {runId && (
                <button
                  onClick={handleDownload}
                  className="text-xs mt-1 inline-block underline bg-transparent border-none p-0 cursor-pointer"
                  style={{ color: 'var(--color-primary)' }}
                >
                  Download original file →
                </button>
              )}
              {downloadError && (
                <p className="text-xs mt-1" style={{ color: '#dc2626' }}>{downloadError}</p>
              )}
              {s3Info?.url && (
                <a
                  href={s3Info.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs mt-1 inline-block underline ml-3"
                  style={{ color: 'var(--color-primary)' }}
                >
                  Open from S3 →
                </a>
              )}
            </div>
            <div className="flex items-center gap-2">
              {s3Info?.url ? (
                <span className="text-xs font-medium px-3 py-1.5 rounded-full" style={{ background: '#dcfce7', color: '#166534' }}>
                  S3 saved ✓
                </span>
              ) : s3Error ? (
                <span className="text-xs font-medium px-3 py-1.5 rounded-full" style={{ background: '#fee2e2', color: '#991b1b' }}>
                  S3 error
                </span>
              ) : (
                <span className="text-xs font-medium px-3 py-1.5 rounded-full" style={{ background: '#fef3c7', color: '#92400e' }}>
                  S3 not configured
                </span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
