import { useState, useRef, useCallback } from 'react';
import api from '../../api/client';
import { useIcon } from '../../providers/IconProvider';
import { exportPdf } from '../../utils/exportService';
import useAuthStore from '../../stores/authStore';
import MarkdownRenderer from '../../components/ui/MarkdownRenderer';
import ProcessingModal from '../../components/shared/ProcessingModal';

const LOW_CONFIDENCE = 0.7;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtTs = (s) =>
  s ? new Date(s).toLocaleString('en-AU', { dateStyle: 'short', timeStyle: 'short' }) : '—';

function confidenceColor(c) {
  if (c >= 0.9) return '#16a34a';
  if (c >= LOW_CONFIDENCE) return '#d97706';
  return '#dc2626';
}

function checkStatusStyle(s) {
  if (s === 'PASS')    return { bg: '#dcfce7', color: '#166534', label: 'PASS' };
  if (s === 'FAIL')    return { bg: '#fee2e2', color: '#991b1b', label: 'FAIL' };
  if (s === 'WARNING') return { bg: '#fef3c7', color: '#92400e', label: 'WARNING' };
  return { bg: 'var(--color-surface)', color: 'var(--color-muted)', label: s ?? '—' };
}

function reviewPill(status) {
  const map = {
    pending_review: { bg: '#fef3c7', color: '#92400e', label: 'Pending review' },
    approved:       { bg: '#dcfce7', color: '#166534', label: 'Approved' },
    rejected:       { bg: '#fee2e2', color: '#991b1b', label: 'Rejected' },
    resubmit:       { bg: '#e0e7ff', color: '#3730a3', label: 'Resubmit' },
  };
  return map[status] ?? map.pending_review;
}

// ── SSE helper ────────────────────────────────────────────────────────────────

async function streamRun(slug, body, onProgress, onResult, onError) {
  try {
    const res    = await api.stream(`/agents/${slug}/run`, body);
    const reader = res.body.getReader();
    const dec    = new TextDecoder();
    let buffer = '';
    let resultReceived = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += dec.decode(value, { stream: true });
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
          else if (msg.type === 'error') onError(msg.error ?? 'Agent error');
        } catch { /* malformed SSE line */ }
      }
    }
    if (!resultReceived) onError('Stream ended without a result — check server logs.');
  } catch (err) {
    onError(err.message);
  }
}

// ── Stage progress ────────────────────────────────────────────────────────────

const INITIAL_STAGES = [
  { key: 'stage1', name: 'Extracting claims',    status: 'pending', detail: null },
  { key: 'stage2', name: 'Running calculations', status: 'pending', detail: null },
  { key: 'stage3', name: 'Synthesising findings', status: 'pending', detail: null },
];

const STAGE_DESCRIPTIONS = {
  stage1: 'Claude is reading the PDF and extracting pipe segments, flow rates, and pressure values',
  stage2: 'Python is running Hazen-Williams, velocity, and pressure budget checks',
  stage3: 'Claude is synthesising findings with plain-language explanations and remediation steps',
};

function advanceStages(stages, msg) {
  const lower = msg.toLowerCase();
  return stages.map((s) => {
    if (s.status === 'complete') return s;
    if (s.key === 'stage1') {
      if (lower.includes('stage 1: extracting')) return { ...s, status: 'active' };
      if (lower.includes('stage 1 complete'))    return { ...s, status: 'complete' };
    }
    if (s.key === 'stage2') {
      if (lower.includes('stage 2: running'))    return { ...s, status: 'active' };
      if (lower.includes('stage 2 complete'))    return { ...s, status: 'complete' };
    }
    if (s.key === 'stage3') {
      if (lower.includes('stage 3: synth'))      return { ...s, status: 'active' };
      if (lower.includes('validation complete')) return { ...s, status: 'complete' };
    }
    return s;
  });
}

function finaliseStages(stages, runData) {
  const trace = runData.trace ?? [];
  const ext   = trace.find((t) => t.step === 'pdf_extraction');
  const pyc   = trace.find((t) => t.step === 'python_calculation');
  const syn   = trace.find((t) => t.step === 'synthesis');
  const libs  = runData.library_versions ?? {};

  return stages.map((s) => {
    if (s.key === 'stage1') return {
      ...s, status: 'complete',
      detail: ext
        ? `${ext.segments_extracted ?? '?'} segments · model: ${ext.model ?? '—'} · ${(ext.tokens_input ?? 0) + (ext.tokens_output ?? 0)} tokens`
        : null,
    };
    if (s.key === 'stage2') return {
      ...s, status: 'complete',
      detail: pyc
        ? `${pyc.checks_run ?? '?'} checks · ${pyc.execution_time_ms ?? '?'}ms · fluids ${libs.fluids ?? '?'} / numpy ${libs.numpy ?? '?'} / py ${libs.python ?? '?'}`
        : null,
    };
    if (s.key === 'stage3') return {
      ...s, status: 'complete',
      detail: syn
        ? `${(syn.deterministic_count ?? 0) + (syn.probabilistic_count ?? 0)} findings · ${syn.model ?? '—'} · ${(syn.tokens_input ?? 0) + (syn.tokens_output ?? 0)} tokens`
        : null,
    };
    return { ...s, status: 'complete' };
  });
}

// ── Working display ───────────────────────────────────────────────────────────

function WorkingDisplay({ working }) {
  if (!working || Object.keys(working).length === 0) return null;
  return (
    <div
      className="rounded-xl p-3 overflow-x-auto space-y-1"
      style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', fontFamily: 'var(--font-mono, monospace)' }}
    >
      {Object.entries(working).map(([k, v]) => (
        <div key={k} className="flex gap-2 text-xs" style={{ color: 'var(--color-text)' }}>
          <span className="shrink-0 font-medium" style={{ color: 'var(--color-muted)', minWidth: 200 }}>{k}</span>
          <span>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Deterministic finding card ────────────────────────────────────────────────

function DetFindingCard({ finding, runId, onUpdated, getIcon, expanded, onToggleWorking }) {
  const [comment, setComment]         = useState('');
  const [submitting, setSubmitting]   = useState(false);
  const [reviewError, setReviewError] = useState('');

  const cs     = checkStatusStyle(finding.check_status);
  const pill   = reviewPill(finding.status);
  const isCross = finding.also_flagged_probabilistic;
  const isAutoApproved = finding.check_status === 'PASS';

  const submit = async (status) => {
    if (isCross && status === 'approved' && !comment.trim()) {
      setReviewError('Comment required before approving this finding.');
      return;
    }
    setSubmitting(true);
    setReviewError('');
    try {
      await api.patch(`/demo/runs/${runId}/review/${finding.finding_id}`, {
        status,
        comment: comment.trim() || undefined,
      });
      onUpdated();
    } catch (err) {
      setReviewError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="rounded-xl p-4 space-y-3"
      style={{
        background: 'var(--color-surface)',
        border: `1px solid ${isCross ? '#fbbf24' : 'var(--color-border)'}`,
      }}
    >
      {/* Badge row */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#eff6ff', color: '#1d4ed8' }}>
            Deterministic
          </span>
          <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: cs.bg, color: cs.color }}>
            {cs.label}
          </span>
          {isCross && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#fffbeb', color: '#92400e' }}>
              Also flagged probabilistically
            </span>
          )}
        </div>
        <span className="text-xs font-medium px-2 py-0.5 rounded-full shrink-0" style={{ background: pill.bg, color: pill.color }}>
          {pill.label}
        </span>
      </div>

      {/* Label */}
      <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{finding.label}</p>

      {/* Stated / Calculated / Discrepancy */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg p-2 text-xs" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
          <p className="mb-0.5" style={{ color: 'var(--color-muted)' }}>Stated</p>
          <p className="font-mono font-medium" style={{ color: 'var(--color-text)' }}>
            {finding.stated_value != null ? `${finding.stated_value} ${finding.unit ?? ''}`.trim() : '—'}
          </p>
        </div>
        <div className="rounded-lg p-2 text-xs" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
          <p className="mb-0.5" style={{ color: 'var(--color-muted)' }}>Calculated</p>
          <p className="font-mono font-medium" style={{ color: cs.color }}>
            {finding.calculated_value != null
              ? `${Number(finding.calculated_value).toFixed(3)} ${finding.unit ?? ''}`.trim()
              : '—'}
          </p>
        </div>
        <div className="rounded-lg p-2 text-xs" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
          <p className="mb-0.5" style={{ color: 'var(--color-muted)' }}>Discrepancy</p>
          <p className="font-mono font-medium" style={{ color: cs.color }}>
            {finding.discrepancy_pct != null
              ? `${finding.discrepancy_pct > 0 ? '+' : ''}${finding.discrepancy_pct.toFixed(1)}%`
              : '—'}
          </p>
        </div>
      </div>

      {/* Plain language / remediation from Stage 3 */}
      {finding.plain_language_explanation && (
        <p className="text-xs" style={{ color: 'var(--color-text)' }}>{finding.plain_language_explanation}</p>
      )}
      {finding.likely_cause && (
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          <strong>Likely cause:</strong> {finding.likely_cause}
        </p>
      )}
      {finding.remediation && (
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          <strong>Remediation:</strong> {finding.remediation}
        </p>
      )}
      {finding.standard_reference && (
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{finding.standard_reference}</p>
      )}

      {/* Working toggle */}
      <button
        onClick={() => onToggleWorking(finding.finding_id)}
        className="text-xs flex items-center gap-1 hover:opacity-70"
        style={{ color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        {getIcon(expanded ? 'chevron-up' : 'chevron-down', { size: 12 })}
        {expanded ? 'Hide working' : 'Show working'}
      </button>

      {expanded && <WorkingDisplay working={finding.working} />}

      {/* Rejected — permanent banner */}
      {finding.status === 'rejected' && (
        <div
          className="rounded-xl px-4 py-2.5 flex items-center gap-2.5 text-xs"
          style={{ background: '#fff1f2', border: '1px solid #fca5a5', color: '#991b1b' }}
        >
          {getIcon('x-circle', { size: 14 })}
          This finding has been rejected. A new document submission is required to obtain a certificate.
        </div>
      )}

      {/* Auto-approved (PASS) */}
      {isAutoApproved && (
        <p className="text-xs" style={{ color: '#166534' }}>Auto-approved — no discrepancy found.</p>
      )}

      {/* Resolved (non-PASS, non-rejected) */}
      {!isAutoApproved && finding.status !== 'pending_review' && finding.status !== 'rejected' && finding.status !== 'resubmit' && finding.reviewed_by && (
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          {pill.label} by {finding.reviewed_by} · {fmtTs(finding.reviewed_at)}
          {finding.comment && ` · "${finding.comment}"`}
        </p>
      )}

      {/* Review controls — FAIL / WARNING pending_review */}
      {finding.status === 'pending_review' && !isAutoApproved && runId && (
        <>
          <textarea
            rows={2}
            placeholder={isCross ? 'Comment required before approving (cross-stage overlap)…' : 'Add a comment (required to reject or request resubmission)…'}
            value={comment}
            onChange={(e) => { setComment(e.target.value); setReviewError(''); }}
            className="w-full text-xs rounded-lg p-2 resize-none"
            style={{ border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontFamily: 'inherit', outline: 'none' }}
          />
          {!comment.trim() && (
            <p className="text-xs" style={{ color: '#dc2626' }}>A comment is required to reject or request resubmission</p>
          )}
          {reviewError && <p className="text-xs" style={{ color: '#dc2626' }}>{reviewError}</p>}
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => submit('approved')} disabled={submitting || (isCross && !comment.trim())}
              className="text-xs font-medium px-3 py-1.5 rounded-lg hover:opacity-80"
              style={{ background: '#dcfce7', color: '#166534', cursor: (submitting || (isCross && !comment.trim())) ? 'not-allowed' : 'pointer', opacity: (isCross && !comment.trim()) ? 0.5 : 1 }}>
              Approve
            </button>
            <button onClick={() => submit('rejected')} disabled={submitting || !comment.trim()}
              className="text-xs font-medium px-3 py-1.5 rounded-lg hover:opacity-80"
              style={{ background: '#fee2e2', color: '#991b1b', cursor: (submitting || !comment.trim()) ? 'not-allowed' : 'pointer', opacity: !comment.trim() ? 0.5 : 1 }}>
              Reject
            </button>
            <button onClick={() => submit('resubmit')} disabled={submitting || !comment.trim()}
              className="text-xs font-medium px-3 py-1.5 rounded-lg hover:opacity-70"
              style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)', cursor: (submitting || !comment.trim()) ? 'not-allowed' : 'pointer', opacity: !comment.trim() ? 0.5 : 1 }}>
              Resubmit
            </button>
          </div>
        </>
      )}

      {/* Resubmit state */}
      {finding.status === 'resubmit' && runId && (
        <>
          {finding.comment && (
            <div className="rounded-lg px-3 py-2" style={{ background: '#ede9fe', border: '1px solid #c4b5fd' }}>
              <p className="text-xs font-semibold mb-0.5" style={{ color: '#5b21b6' }}>Reviewer note</p>
              <p className="text-xs" style={{ color: '#3730a3' }}>{finding.comment}</p>
            </div>
          )}
          <textarea
            rows={2}
            placeholder={isCross ? 'Comment required before approving (cross-stage overlap)…' : 'Add a comment (required to reject)…'}
            value={comment}
            onChange={(e) => { setComment(e.target.value); setReviewError(''); }}
            className="w-full text-xs rounded-lg p-2 resize-none"
            style={{ border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontFamily: 'inherit', outline: 'none' }}
          />
          {!comment.trim() && (
            <p className="text-xs" style={{ color: '#dc2626' }}>A comment is required to reject</p>
          )}
          {reviewError && <p className="text-xs" style={{ color: '#dc2626' }}>{reviewError}</p>}
          <div className="flex items-center gap-2">
            <button onClick={() => submit('approved')} disabled={submitting || (isCross && !comment.trim())}
              className="text-xs font-medium px-3 py-1.5 rounded-lg hover:opacity-80"
              style={{ background: '#dcfce7', color: '#166534', cursor: (submitting || (isCross && !comment.trim())) ? 'not-allowed' : 'pointer', opacity: (isCross && !comment.trim()) ? 0.5 : 1 }}>
              Approve
            </button>
            <button onClick={() => submit('rejected')} disabled={submitting || !comment.trim()}
              className="text-xs font-medium px-3 py-1.5 rounded-lg hover:opacity-80"
              style={{ background: '#fee2e2', color: '#991b1b', cursor: (submitting || !comment.trim()) ? 'not-allowed' : 'pointer', opacity: !comment.trim() ? 0.5 : 1 }}>
              Reject
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Probabilistic finding card ────────────────────────────────────────────────

function ProbFindingCard({ finding, runId, onUpdated, getIcon }) {
  const [comment, setComment]         = useState('');
  const [submitting, setSubmitting]   = useState(false);
  const [reviewError, setReviewError] = useState('');

  const conf    = finding.confidence ?? 0.5;
  const isLow   = conf < LOW_CONFIDENCE;
  const isCross = !!(finding.also_flagged_deterministic);
  const pill    = reviewPill(finding.status);

  const submit = async (status) => {
    if (isCross && status === 'approved' && !comment.trim()) {
      setReviewError('Comment required before approving this finding.');
      return;
    }
    setSubmitting(true);
    setReviewError('');
    try {
      await api.patch(`/demo/runs/${runId}/review/${finding.finding_id}`, {
        status,
        comment: comment.trim() || undefined,
      });
      onUpdated();
    } catch (err) {
      setReviewError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="rounded-xl p-4 space-y-3"
      style={{
        background: 'var(--color-surface)',
        border: `1px solid ${isCross ? '#fbbf24' : 'var(--color-border)'}`,
      }}
    >
      {/* Badge row */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#faf5ff', color: '#7c3aed' }}>
            Probabilistic
          </span>
          {isCross && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#fffbeb', color: '#92400e' }}>
              Also flagged deterministically
            </span>
          )}
          {isLow && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#fef2f2', color: '#991b1b' }}>
              Low confidence — Engineering Lead validation required
            </span>
          )}
        </div>
        <span className="text-xs font-medium px-2 py-0.5 rounded-full shrink-0" style={{ background: pill.bg, color: pill.color }}>
          {pill.label}
        </span>
      </div>

      {/* Label + confidence */}
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{finding.label}</p>
        <span className="text-xs font-mono" style={{ color: confidenceColor(conf) }}>
          {Math.round(conf * 100)}%
        </span>
      </div>

      {finding.description && (
        <p className="text-xs" style={{ color: 'var(--color-text)' }}>{finding.description}</p>
      )}
      {finding.remediation && (
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          <strong>Remediation:</strong> {finding.remediation}
        </p>
      )}

      {/* Rejected — permanent banner */}
      {finding.status === 'rejected' && (
        <div
          className="rounded-xl px-4 py-2.5 flex items-center gap-2.5 text-xs"
          style={{ background: '#fff1f2', border: '1px solid #fca5a5', color: '#991b1b' }}
        >
          {getIcon('x-circle', { size: 14 })}
          This finding has been rejected. A new document submission is required to obtain a certificate.
        </div>
      )}

      {/* Resolved (non-rejected) */}
      {finding.status !== 'pending_review' && finding.status !== 'rejected' && finding.status !== 'resubmit' && finding.reviewed_by && (
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          {pill.label} by {finding.reviewed_by} · {fmtTs(finding.reviewed_at)}
          {finding.comment && ` · "${finding.comment}"`}
        </p>
      )}

      {/* Review controls */}
      {(finding.status === 'pending_review' || finding.status === 'resubmit') && runId && finding.status !== 'rejected' && (
        <>
          {finding.status === 'resubmit' && finding.comment && (
            <div className="rounded-lg px-3 py-2" style={{ background: '#ede9fe', border: '1px solid #c4b5fd' }}>
              <p className="text-xs font-semibold mb-0.5" style={{ color: '#5b21b6' }}>Reviewer note</p>
              <p className="text-xs" style={{ color: '#3730a3' }}>{finding.comment}</p>
            </div>
          )}
          <textarea
            rows={2}
            placeholder={isCross ? 'Comment required before approving (cross-stage overlap)…' : 'Add a comment (required to reject or request resubmission)…'}
            value={comment}
            onChange={(e) => { setComment(e.target.value); setReviewError(''); }}
            className="w-full text-xs rounded-lg p-2 resize-none"
            style={{ border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontFamily: 'inherit', outline: 'none' }}
          />
          {!comment.trim() && (
            <p className="text-xs" style={{ color: '#dc2626' }}>
              {finding.status === 'resubmit' ? 'A comment is required to reject' : 'A comment is required to reject or request resubmission'}
            </p>
          )}
          {reviewError && <p className="text-xs" style={{ color: '#dc2626' }}>{reviewError}</p>}
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => submit('approved')} disabled={submitting || (isCross && !comment.trim())}
              className="text-xs font-medium px-3 py-1.5 rounded-lg hover:opacity-80"
              style={{ background: '#dcfce7', color: '#166534', cursor: (submitting || (isCross && !comment.trim())) ? 'not-allowed' : 'pointer', opacity: (isCross && !comment.trim()) ? 0.5 : 1 }}>
              Approve
            </button>
            <button onClick={() => submit('rejected')} disabled={submitting || !comment.trim()}
              className="text-xs font-medium px-3 py-1.5 rounded-lg hover:opacity-80"
              style={{ background: '#fee2e2', color: '#991b1b', cursor: (submitting || !comment.trim()) ? 'not-allowed' : 'pointer', opacity: !comment.trim() ? 0.5 : 1 }}>
              Reject
            </button>
            {finding.status !== 'resubmit' && (
              <button onClick={() => submit('resubmit')} disabled={submitting || !comment.trim()}
                className="text-xs font-medium px-3 py-1.5 rounded-lg hover:opacity-70"
                style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)', cursor: (submitting || !comment.trim()) ? 'not-allowed' : 'pointer', opacity: !comment.trim() ? 0.5 : 1 }}>
                Resubmit
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Certificate HTML ──────────────────────────────────────────────────────────

function buildCertificateHtml(runData, orgName) {
  const det   = runData.deterministic_findings ?? [];
  const prob  = runData.probabilistic_findings ?? [];
  const all   = runData.all_findings ?? [];
  const libs  = runData.library_versions ?? {};
  const model = runData.model ?? '—';
  const trace = runData.trace ?? [];
  const pyc   = trace.find((t) => t.step === 'python_calculation') ?? {};

  const failDet = det.filter((f) => f.check_status === 'FAIL');
  const warnDet = det.filter((f) => f.check_status === 'WARNING');
  const passDet = det.filter((f) => f.check_status === 'PASS');

  const fmtWorking = (working) => {
    if (!working || Object.keys(working).length === 0) return '<em>No working available</em>';
    return Object.entries(working)
      .map(([k, v]) =>
        `<tr><td style="padding:3px 8px;font-weight:600;color:#374151;min-width:220px;font-family:monospace;">${k}</td>` +
        `<td style="padding:3px 8px;font-family:monospace;">${typeof v === 'object' ? JSON.stringify(v) : String(v)}</td></tr>`
      ).join('');
  };

  const failWorkings = failDet.map((f) => `
    <div style="margin-bottom:20px;">
      <h4 style="font-size:12px;font-weight:bold;margin-bottom:6px;">${f.label}</h4>
      <p style="font-size:11px;color:#374151;margin:0 0 4px;">
        Stated: ${f.stated_value ?? '—'} ${f.unit ?? ''} &nbsp;|&nbsp;
        Calculated: ${f.calculated_value != null ? Number(f.calculated_value).toFixed(3) : '—'} ${f.unit ?? ''} &nbsp;|&nbsp;
        Discrepancy: ${f.discrepancy_pct != null ? f.discrepancy_pct.toFixed(1) + '%' : '—'}
      </p>
      ${f.plain_language_explanation ? `<p style="font-size:11px;color:#374151;margin:0 0 4px;">${f.plain_language_explanation}</p>` : ''}
      ${f.remediation ? `<p style="font-size:11px;color:#6b7280;margin:0 0 4px;"><strong>Remediation:</strong> ${f.remediation}</p>` : ''}
      <table style="font-size:11px;border-collapse:collapse;width:100%;background:#f9fafb;margin-top:4px;">
        ${fmtWorking(f.working)}
      </table>
    </div>`).join('');

  const findingRows = all.map((f) => {
    const p = reviewPill(f.status);
    return `<tr>
      <td style="padding:5px 8px;border:1px solid #e5e7eb;font-size:11px;">${f.segment_ref ?? f.label}</td>
      <td style="padding:5px 8px;border:1px solid #e5e7eb;font-size:11px;">${f.stage}</td>
      <td style="padding:5px 8px;border:1px solid #e5e7eb;font-size:11px;">${f.check_status ?? `${Math.round((f.confidence ?? 0) * 100)}% conf`}</td>
      <td style="padding:5px 8px;border:1px solid #e5e7eb;font-size:11px;color:${p.color};">${p.label}</td>
      <td style="padding:5px 8px;border:1px solid #e5e7eb;font-size:11px;">${f.reviewed_by ?? '—'}</td>
      <td style="padding:5px 8px;border:1px solid #e5e7eb;font-size:11px;">${fmtTs(f.reviewed_at)}</td>
      <td style="padding:5px 8px;border:1px solid #e5e7eb;font-size:11px;">${f.comment ?? '—'}</td>
    </tr>`;
  }).join('');

  return `
<div style="font-family:Georgia,serif;max-width:920px;margin:0 auto;padding:40px;">
  <div style="text-align:center;margin-bottom:32px;">
    <h1 style="font-size:20px;font-weight:bold;margin:0;">Hydraulic Specification Compliance Certificate</h1>
    <p style="font-size:12px;color:#6b7280;margin-top:4px;">Generated ${new Date().toLocaleString('en-AU')}</p>
  </div>

  <table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:12px;">
    <tr><td style="padding:6px 8px;font-weight:bold;width:210px;">Organisation</td><td style="padding:6px 8px;">${orgName}</td></tr>
    <tr style="background:#f9fafb;"><td style="padding:6px 8px;font-weight:bold;">Document</td><td style="padding:6px 8px;">${runData.file_name ?? '—'}</td></tr>
    <tr><td style="padding:6px 8px;font-weight:bold;">SHA-256</td><td style="padding:6px 8px;font-family:monospace;font-size:11px;">${runData.file_hash ?? '—'}</td></tr>
    <tr style="background:#f9fafb;"><td style="padding:6px 8px;font-weight:bold;">Run Date</td><td style="padding:6px 8px;">${new Date().toLocaleString('en-AU')}</td></tr>
    <tr><td style="padding:6px 8px;font-weight:bold;">Model (Extraction / Synthesis)</td><td style="padding:6px 8px;">${model}</td></tr>
    <tr style="background:#f9fafb;"><td style="padding:6px 8px;font-weight:bold;">Python Libraries</td><td style="padding:6px 8px;font-family:monospace;">fluids ${libs.fluids ?? '?'} &nbsp;·&nbsp; numpy ${libs.numpy ?? '?'} &nbsp;·&nbsp; Python ${libs.python ?? '?'}</td></tr>
    <tr><td style="padding:6px 8px;font-weight:bold;">Checks Run</td><td style="padding:6px 8px;">${det.length} deterministic (${passDet.length} PASS · ${warnDet.length} WARNING · ${failDet.length} FAIL) + ${prob.length} probabilistic</td></tr>
    <tr style="background:#f9fafb;"><td style="padding:6px 8px;font-weight:bold;">Total Findings</td><td style="padding:6px 8px;">${all.length}</td></tr>
  </table>

  <h2 style="font-size:14px;font-weight:bold;margin-bottom:8px;">Findings and Review Decisions</h2>
  <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
    <thead>
      <tr style="background:#f3f4f6;">
        <th style="padding:6px 8px;border:1px solid #e5e7eb;text-align:left;font-size:11px;">Segment / Label</th>
        <th style="padding:6px 8px;border:1px solid #e5e7eb;text-align:left;font-size:11px;">Stage</th>
        <th style="padding:6px 8px;border:1px solid #e5e7eb;text-align:left;font-size:11px;">Python / Conf</th>
        <th style="padding:6px 8px;border:1px solid #e5e7eb;text-align:left;font-size:11px;">Decision</th>
        <th style="padding:6px 8px;border:1px solid #e5e7eb;text-align:left;font-size:11px;">Reviewer</th>
        <th style="padding:6px 8px;border:1px solid #e5e7eb;text-align:left;font-size:11px;">Reviewed At</th>
        <th style="padding:6px 8px;border:1px solid #e5e7eb;text-align:left;font-size:11px;">Comment</th>
      </tr>
    </thead>
    <tbody>${findingRows}</tbody>
  </table>

  ${failDet.length > 0 ? `
  <h2 style="font-size:14px;font-weight:bold;margin-bottom:12px;">Calculation Working — FAIL Findings</h2>
  ${failWorkings}` : ''}

  <div style="border-top:2px solid #111827;padding-top:16px;font-size:11px;color:#374151;margin-top:24px;">
    <p><strong>Statement of Calculation Method:</strong> Deterministic calculations performed by Python hydraulic engine (fluids ${libs.fluids ?? '?'} / numpy ${libs.numpy ?? '?'}). AI was not used for quantitative verification. Claude AI was used for document extraction and plain-language synthesis only.</p>
    <p style="margin-top:8px;color:#6b7280;">This certificate was generated by the Curam Engineering Spec Validator. It records the outcomes of deterministic hydraulic calculations and the human review decisions made by the engineering team. It does not constitute legal advice.</p>
  </div>
</div>`;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SpecValidator({ slug = 'demo-spec-validator' }) {
  const getIcon  = useIcon();
  const { user } = useAuthStore();

  const [file, setFile]               = useState(null);
  const [dragging, setDragging]       = useState(false);
  const [running, setRunning]         = useState(false);
  const [stages, setStages]           = useState(INITIAL_STAGES);
  const [progressTail, setProgressTail] = useState('');
  const [runResult, setRunResult]     = useState(null);
  const [runId, setRunId]             = useState(null);
  const [error, setError]             = useState('');
  const [certLoading, setCertLoading] = useState(false);
  const [certError, setCertError]     = useState('');
  const [viewLoading, setViewLoading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [emailOpen, setEmailOpen]     = useState(false);
  const [emailTo, setEmailTo]         = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailError, setEmailError]   = useState('');
  const [emailSent, setEmailSent]     = useState(false);
  const [expandedWorking, setExpandedWorking] = useState(new Set());
  const [followUpOpen, setFollowUpOpen]       = useState(false);
  const [followUpQuestion, setFollowUpQuestion] = useState('');
  const [followUpHistory, setFollowUpHistory]   = useState([]);
  const [followUpLoading, setFollowUpLoading]   = useState(false);
  const [followUpError, setFollowUpError]       = useState('');
  const fileInputRef  = useRef(null);
  const cancelledRef  = useRef(false);

  // ── Cancel ─────────────────────────────────────────────────────────────────

  const handleCancel = () => {
    cancelledRef.current = true;
    setRunning(false);
    setStages(INITIAL_STAGES);
    setProgressTail('');
  };

  // ── File handling ──────────────────────────────────────────────────────────

  const acceptFile = (f) => {
    if (f.type !== 'application/pdf') {
      setError('PDF files only. The Spec Validator processes hydraulic calculation documents.');
      return;
    }
    if (f.size > MAX_FILE_BYTES) {
      setError('File exceeds 10 MB limit.');
      return;
    }
    setError('');
    setFile(f);
    setRunResult(null);
    setRunId(null);
    setStages(INITIAL_STAGES);
    setProgressTail('');
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
    if (!file || running) return;
    cancelledRef.current = false;
    setRunning(true);
    setError('');
    setRunResult(null);
    setRunId(null);
    setStages(INITIAL_STAGES);
    setProgressTail('');
    setCertError('');
    setExpandedWorking(new Set());
    setFollowUpHistory([]);
    setFollowUpOpen(false);
    setFollowUpQuestion('');

    const fileData = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = (e) => resolve(e.target.result.split(',')[1]);
      reader.onerror = () => reject(new Error('Failed to read file.'));
      reader.readAsDataURL(file);
    }).catch((err) => { setError(err.message); setRunning(false); return null; });
    if (!fileData) return;

    await streamRun(
      slug,
      { fileData, mimeType: file.type, fileName: file.name },
      (text) => {
        setProgressTail(text);
        setStages((prev) => advanceStages(prev, text));
      },
      async (data) => {
        if (cancelledRef.current) return;
        const innerData = data?.data ?? data;
        setStages((prev) => finaliseStages(prev, innerData));
        setRunResult(innerData);
        setFollowUpHistory(innerData.follow_up_history ?? []);
        try {
          const runs = await api.get(`/demo/runs?slug=${slug}&limit=1`);
          if (runs[0]?.id) setRunId(runs[0].id);
        } catch { /* non-fatal */ }
      },
      (err) => setError(err),
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

  // ── Working toggle ─────────────────────────────────────────────────────────

  const toggleWorking = (findingId) => {
    setExpandedWorking((prev) => {
      const next = new Set(prev);
      if (next.has(findingId)) next.delete(findingId); else next.add(findingId);
      return next;
    });
  };

  // ── Certificate ────────────────────────────────────────────────────────────

  const handleCertificate = async () => {
    setCertLoading(true);
    setCertError('');
    try {
      const orgName = user?.orgName ?? 'Curam Engineering';
      const html    = buildCertificateHtml(runResult, orgName);
      const safe    = (runResult?.file_name ?? 'document')
        .replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]/gi, '_').slice(0, 40);
      await exportPdf({
        content:     html,
        contentType: 'html',
        title:       `Hydraulic Compliance Certificate — ${runResult?.file_name ?? 'Document'}`,
        filename:    `cert-hydraulic-${safe}-${Date.now()}.pdf`,
      });
    } catch (err) {
      setCertError(err.message);
    } finally {
      setCertLoading(false);
    }
  };

  // ── Preview certificate ────────────────────────────────────────────────────

  const handleViewCertificate = () => {
    setViewLoading(true);
    try {
      const orgName = user?.orgName ?? 'Curam Engineering';
      const html    = buildCertificateHtml(runResult, orgName);
      const blob    = new Blob([html], { type: 'text/html' });
      const url     = URL.createObjectURL(blob);
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
      const html    = buildCertificateHtml(runResult, orgName);
      const safe    = (runResult?.file_name ?? 'document')
        .replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]/gi, '_').slice(0, 40);
      await api.post(`/demo/runs/${runId}/email-certificate`, {
        to:       emailTo.trim(),
        html,
        title:    `Hydraulic Compliance Certificate — ${runResult?.file_name ?? 'Document'}`,
        filename: `cert-hydraulic-${safe}.pdf`,
      });
      setEmailSent(true);
      setEmailOpen(false);
    } catch (err) {
      setEmailError(err.message);
    } finally {
      setEmailSending(false);
    }
  };

  // ── Download original file ────────────────────────────────────────────────

  const handleDownload = async () => {
    if (!runId) return;
    setDownloadError('');
    try {
      const { blob, filename } = await api.downloadBlob(`/demo/runs/${runId}/download`);
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href     = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setDownloadError(err.message);
    }
  };

  // ── Derived state ──────────────────────────────────────────────────────────

  const allFindings   = runResult?.all_findings ?? [];
  const detFindings   = runResult?.deterministic_findings ?? [];
  const probFindings  = runResult?.probabilistic_findings ?? [];
  const pendingCount  = allFindings.filter((f) => f.status === 'pending_review').length;
  const rejectedCount = allFindings.filter((f) => f.status === 'rejected').length;
  const resubmitCount = allFindings.filter((f) => f.status === 'resubmit').length;
  const allApproved   = allFindings.length > 0 && pendingCount === 0 && rejectedCount === 0 && resubmitCount === 0;
  const failCount     = detFindings.filter((f) => f.check_status === 'FAIL').length;
  const warnCount     = detFindings.filter((f) => f.check_status === 'WARNING').length;
  const passCount     = detFindings.filter((f) => f.check_status === 'PASS').length;
  const decisionLogPath = slug === 'demo-spec-validator' ? '/demo/decision-log' : '/tools/spec-validator/log';

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Spec Validator</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
          Upload a hydraulic services calculation document — deterministic Python verification of pipe velocities, pressure drops, and system pressure budgets against AS/NZS 3500.1.
        </p>
      </div>

      {/* Upload zone — hidden while result is showing */}
      {!runResult && (
        <>
          <div
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onClick={() => !running && fileInputRef.current?.click()}
            className="rounded-xl flex flex-col items-center justify-center gap-3"
            style={{
              border: `2px dashed ${dragging ? 'var(--color-primary)' : 'var(--color-border)'}`,
              background: dragging ? 'rgba(var(--color-primary-rgb),0.04)' : 'var(--color-surface)',
              minHeight: 160,
              padding: '2rem',
              cursor: running ? 'default' : 'pointer',
            }}
          >
            <span style={{ color: 'var(--color-primary)' }}>{getIcon('upload', { size: 28 })}</span>
            {file ? (
              <div className="text-center">
                <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{file.name}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                  {(file.size / 1024).toFixed(0)} KB · PDF
                </p>
              </div>
            ) : (
              <div className="text-center">
                <p className="text-sm" style={{ color: 'var(--color-text)' }}>Drop a PDF or click to browse</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>PDF only · max 10 MB</p>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept="application/pdf"
              onChange={(e) => { if (e.target.files[0]) acceptFile(e.target.files[0]); }}
            />
          </div>

          {file && (
            <div className="flex items-center gap-2 pb-safe">
              <button
                onClick={handleRun}
                disabled={running}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
                style={{
                  background: running ? 'var(--color-muted)' : 'var(--color-primary)',
                  color: '#fff',
                  cursor: running ? 'not-allowed' : 'pointer',
                }}
              >
                {running ? 'Validating…' : 'Validate Document'}
              </button>
              {!running && (
                <button
                  onClick={() => { setFile(null); setError(''); }}
                  className="text-xs px-3 py-2.5 rounded-xl hover:opacity-70"
                  style={{ border: '1px solid var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-surface)', cursor: 'pointer' }}
                >
                  Clear
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* Error banner — persistent, not toast */}
      {error && (
        <div
          className="rounded-xl px-4 py-2.5 flex items-center gap-2.5 text-xs"
          style={{ background: '#fff1f2', border: '1px solid #fca5a5', color: '#991b1b' }}
        >
          {getIcon('alert-circle', { size: 14 })}
          {error}
        </div>
      )}

      <ProcessingModal
        isOpen={running}
        stages={stages.map((s) => ({
          id: s.key,
          label: s.name,
          description: s.detail || (s.status === 'active' && progressTail ? `→ ${progressTail}` : STAGE_DESCRIPTIONS[s.key]),
          status: s.status,
        }))}
        estimatedDuration="Typical processing time: 3–5 minutes."
        cancelConfirmMessage="Cancel this run? The document will need to be resubmitted."
        onCancel={handleCancel}
      />

      {/* Results */}
      {runResult && (
        <>
          {/* Re-validate link */}
          <button
            onClick={() => {
              setRunResult(null);
              setRunId(null);
              setStages(INITIAL_STAGES);
              setProgressTail('');
              setError('');
              setExpandedWorking(new Set());
              setFollowUpHistory([]);
              setFollowUpOpen(false);
              setFollowUpQuestion('');
            }}
            className="text-xs hover:opacity-70"
            style={{ color: 'var(--color-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            ← Validate another document
          </button>

          {/* Review summary bar — sticky */}
          <div
            className="rounded-xl px-4 py-3 flex items-center justify-between gap-4 flex-wrap"
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              position: 'sticky',
              top: 0,
              zIndex: 10,
            }}
          >
            <div className="flex items-center gap-3 flex-wrap text-xs">
              <span style={{ color: 'var(--color-muted)' }}>
                <strong style={{ color: 'var(--color-text)' }}>{allFindings.length}</strong> findings
              </span>
              {passCount > 0 && (
                <span className="px-2 py-0.5 rounded-full" style={{ background: '#dcfce7', color: '#166534' }}>
                  {passCount} PASS
                </span>
              )}
              {warnCount > 0 && (
                <span className="px-2 py-0.5 rounded-full" style={{ background: '#fef3c7', color: '#92400e' }}>
                  {warnCount} WARNING
                </span>
              )}
              {failCount > 0 && (
                <span className="px-2 py-0.5 rounded-full" style={{ background: '#fee2e2', color: '#991b1b' }}>
                  {failCount} FAIL
                </span>
              )}
              {probFindings.length > 0 && (
                <span className="px-2 py-0.5 rounded-full" style={{ background: '#faf5ff', color: '#7c3aed' }}>
                  {probFindings.length} probabilistic
                </span>
              )}
              <span style={{ color: pendingCount > 0 ? '#d97706' : 'var(--color-muted)' }}>
                {pendingCount > 0 ? `${pendingCount} pending review` : 'All reviewed'}
              </span>
              {rejectedCount > 0 && (
                <span style={{ color: '#dc2626' }}>· {rejectedCount} rejected — certificate blocked</span>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {allApproved ? (
                <span className="text-xs font-medium px-2 py-1 rounded-full" style={{ background: '#dcfce7', color: '#166534' }}>
                  Ready to export
                </span>
              ) : rejectedCount > 0 ? (
                <span className="text-xs font-medium px-2 py-1 rounded-full" style={{ background: '#fee2e2', color: '#991b1b' }}>
                  Certificate blocked
                </span>
              ) : (
                <span className="text-xs font-medium px-2 py-1 rounded-full" style={{ background: '#fef3c7', color: '#92400e' }}>
                  {pendingCount} pending
                </span>
              )}
              <button
                onClick={handleCertificate}
                disabled={!allApproved || certLoading}
                className="text-xs font-medium px-3 py-1.5 rounded-lg hover:opacity-80"
                style={
                  !allApproved || certLoading
                    ? { background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)', cursor: 'not-allowed' }
                    : { background: 'var(--color-primary)', color: '#fff', cursor: 'pointer' }
                }
              >
                {certLoading ? 'Generating…' : 'Export Certificate'}
              </button>
              {allApproved && (
                <div className="flex items-center gap-1">
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
          </div>

          {/* Email certificate — inline form */}
          {emailOpen && allApproved && (
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

          {certError && (
            <p className="text-xs" style={{ color: '#dc2626' }}>{certError}</p>
          )}

          {!runId && (
            <p className="text-xs" style={{ color: '#d97706' }}>
              Run ID not confirmed — review actions require the server to save the run.
            </p>
          )}

          {/* ── Findings panel ─────────────────────────────────────────────── */}
          <div className="space-y-6">

            {/* Deterministic */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                  Deterministic Findings — {detFindings.length} check{detFindings.length !== 1 ? 's' : ''}
                </p>
                <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: '#eff6ff', color: '#1d4ed8' }}>
                  confidence 1.0
                </span>
              </div>
              {detFindings.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No deterministic checks were run.</p>
              ) : (
                detFindings.map((f) => (
                  <DetFindingCard
                    key={f.finding_id}
                    finding={f}
                    runId={runId}
                    onUpdated={refreshRun}
                    getIcon={getIcon}
                    expanded={expandedWorking.has(f.finding_id)}
                    onToggleWorking={toggleWorking}
                  />
                ))
              )}
            </div>

            {/* Probabilistic */}
            {probFindings.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                  Probabilistic Findings — {probFindings.length} finding{probFindings.length !== 1 ? 's' : ''}
                </p>
                {probFindings.map((f) => (
                  <ProbFindingCard
                    key={f.finding_id}
                    finding={f}
                    runId={runId}
                    onUpdated={refreshRun}
                    getIcon={getIcon}
                  />
                ))}
              </div>
            )}
          </div>

          {/* ── Follow-up Q&A ──────────────────────────────────────────────── */}
          <div className="rounded-xl p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            {followUpHistory.map((item, i) => (
              <div key={i} className="space-y-3 mb-4">
                <div className="rounded-xl p-4" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                  <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>
                    Follow-up question #{i + 1}
                  </p>
                  <p className="text-sm" style={{ color: 'var(--color-text)' }}>{item.question}</p>
                </div>
                <div className="rounded-xl p-4" style={{ background: '#f0f9ff', border: '1px solid #bae6fd' }}>
                  <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: '#0369a1' }}>Answer</p>
                  <MarkdownRenderer text={item.answer} />
                  {item.model && (
                    <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>Model: {item.model}</p>
                  )}
                </div>
              </div>
            ))}

            {!followUpOpen ? (
              <button
                onClick={() => setFollowUpOpen(true)}
                className="w-full py-2 rounded-xl text-sm font-medium hover:opacity-80"
                style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px dashed var(--color-border)', cursor: 'pointer' }}
              >
                Discuss these findings →
              </button>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                    Ask about the findings
                  </p>
                  <button
                    onClick={() => { setFollowUpOpen(false); setFollowUpQuestion(''); setFollowUpError(''); }}
                    className="text-xs hover:opacity-70"
                    style={{ color: 'var(--color-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                </div>
                <textarea
                  rows={3}
                  placeholder="Ask about a discrepancy or remediation — e.g. What pipe size would bring CW-04 into compliance?"
                  value={followUpQuestion}
                  onChange={(e) => { setFollowUpQuestion(e.target.value); setFollowUpError(''); }}
                  className="w-full text-sm rounded-xl p-3 resize-none"
                  style={{ border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontFamily: 'inherit', outline: 'none' }}
                />
                <button
                  onClick={async () => {
                    if (!followUpQuestion.trim() || !runId) return;
                    setFollowUpLoading(true);
                    setFollowUpError('');
                    try {
                      const res = await api.post(`/demo/runs/${runId}/follow-up`, {
                        question:  followUpQuestion.trim(),
                        agentSlug: slug,
                      });
                      setFollowUpHistory((prev) => [
                        ...prev,
                        { question: followUpQuestion.trim(), answer: res.answer, model: res.model },
                      ]);
                      setFollowUpQuestion('');
                      setFollowUpOpen(false);
                    } catch (err) {
                      setFollowUpError(err.message);
                    } finally {
                      setFollowUpLoading(false);
                    }
                  }}
                  disabled={followUpLoading || !followUpQuestion.trim() || !runId}
                  className="w-full py-2 rounded-xl text-sm font-semibold"
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
              </div>
            )}
          </div>

          {/* Original file download */}
          <div className="rounded-xl p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
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
          </div>

          {/* Decision log link */}
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            <a href={decisionLogPath} style={{ color: 'var(--color-primary)' }}>View decision log →</a>
          </p>
        </>
      )}
    </div>
  );
}
