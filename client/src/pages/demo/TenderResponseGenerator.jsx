import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import useAuthStore from '../../stores/authStore';
import { useIcon } from '../../providers/IconProvider';
import ProcessingModal from '../../components/shared/ProcessingModal';
import MicButton from '../../components/ui/MicButton';
import MarkdownRenderer from '../../components/ui/MarkdownRenderer';
import { exportPdf, fetchPdfBlob } from '../../utils/exportService';

const MAX_FILE_BYTES = 20 * 1024 * 1024;

const REVIEW_FILTERS = [
  { id: 'all',       label: 'All' },
  { id: 'pending',   label: 'Pending' },
  { id: 'edited',    label: 'Edited' },
  { id: 'approved',  label: 'Approved' },
  { id: 'rejected',  label: 'Rejected' },
  { id: 'blocked',   label: 'Blocked' },
];

/** Client-side Markdown pack — one section per requirement (demo export, not a formal submission). */
function buildTenderDraftPackMd(requirements, extraction) {
  const sorted = [...requirements].sort((a, b) =>
    String(a.requirement_id ?? '').localeCompare(String(b.requirement_id ?? ''), undefined, { numeric: true })
  );
  const lines = [
    '# Tender response draft pack (demo export)',
    '',
    `_Not a submission-ready Word/PDF — copy into your volume template or send to BD for layout._`,
    '',
  ];
  if (extraction?.document_title) lines.push(`**Tender:** ${extraction.document_title}`, '');
  if (extraction?.organisation) lines.push(`**Issuer:** ${extraction.organisation}`, '');
  if (extraction?.tender_reference) lines.push(`**Reference:** ${extraction.tender_reference}`, '');
  lines.push('---', '');

  for (const req of sorted) {
    const st = req.status ?? 'pending';
    lines.push(`## ${req.requirement_id} · ${req.category ?? '—'} · **${st}**`, '');
    lines.push(`**Requirement:** ${req.requirement_text ?? ''}`, '');
    if (req.match_rationale) lines.push(`*Matcher:* ${req.match_rationale}`, '');
    if (req.evidence_ids?.length) lines.push(`*Evidence IDs:* ${req.evidence_ids.join(', ')}`, '');
    if (req.blocker_reason) lines.push(`*Blocker:* ${req.blocker_reason}`, '');
    if (req.comment && st === 'rejected') lines.push(`*Reviewer comment:* ${req.comment}`, '');
    const body = (req.edited_text && String(req.edited_text).trim())
      ? req.edited_text
      : (req.draft_response && String(req.draft_response).trim() ? req.draft_response : null);
    if (body) {
      lines.push('### Response draft', '', body, '');
    } else if (st !== 'rejected') {
      lines.push('_No draft text for this row._', '');
    }
    lines.push('---', '');
  }
  return lines.join('\n');
}

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtTs = (s) =>
  s ? new Date(s).toLocaleString('en-AU', { dateStyle: 'short', timeStyle: 'short' }) : '—';

function matchStatusStyle(status) {
  if (status === 'STRONG')  return { bg: '#dcfce7', color: '#166534', label: 'STRONG' };
  if (status === 'PARTIAL') return { bg: '#fef3c7', color: '#92400e', label: 'PARTIAL' };
  return { bg: '#fee2e2', color: '#991b1b', label: 'NONE' };
}

function reviewPill(status) {
  const map = {
    pending:  { bg: '#fef3c7', color: '#92400e', label: 'Pending review' },
    approved: { bg: '#dcfce7', color: '#166534', label: 'Approved' },
    edited:   { bg: '#eff6ff', color: '#1d4ed8', label: 'Edited' },
    rejected: { bg: '#fee2e2', color: '#991b1b', label: 'Rejected' },
    blocked:  { bg: '#f1f5f9', color: '#64748b', label: 'Blocked' },
  };
  return map[status] ?? map.pending;
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
          else if (msg.type === 'error')  onError(msg.error ?? 'Agent error');
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
  { key: 'stage1', name: 'Extracting requirements', status: 'pending', detail: null },
  { key: 'stage2', name: 'Running compliance check', status: 'pending', detail: null },
  { key: 'stage3', name: 'Generating draft responses', status: 'pending', detail: null },
];

const STAGE_DESCRIPTIONS = {
  stage1: 'Claude is reading the RFT PDF and extracting every mandatory gate and evaluation criterion',
  stage2: 'Python is running deterministic compliance checks against the pre-loaded evidence pack',
  stage3: 'Claude is writing first-draft response paragraphs grounded in your evidence records',
};

function advanceStages(stages, msg) {
  const lower = msg.toLowerCase();
  return stages.map((s) => {
    if (s.status === 'complete') return s;
    if (s.key === 'stage1') {
      if (lower.includes('stage 1: extract')) return { ...s, status: 'active' };
      if (lower.includes('stage 1 complete')) return { ...s, status: 'complete' };
    }
    if (s.key === 'stage2') {
      if (lower.includes('stage 2: retriev') || lower.includes('stage 2: running')) return { ...s, status: 'active' };
      if (lower.includes('stage 2 complete')) return { ...s, status: 'complete' };
    }
    if (s.key === 'stage3') {
      if (lower.includes('stage 3: generat')) return { ...s, status: 'active' };
      if (lower.includes('stage 3 complete')) return { ...s, status: 'complete' };
    }
    return s;
  });
}

function finaliseStages(stages, runData) {
  const trace = runData.trace ?? [];
  const ext   = trace.find((t) => t.step === 'rft_extraction');
  const comp  = trace.find((t) => t.step === 'compliance_check');
  const draft = trace.find((t) => t.step === 'draft_generation');

  return stages.map((s) => {
    if (s.key === 'stage1') return {
      ...s, status: 'complete',
      detail: ext
        ? `${ext.requirements_total ?? '?'} requirements · ${ext.image_pages ?? '?'} pages · ${ext.model ?? '—'}`
        : null,
    };
    if (s.key === 'stage2') return {
      ...s, status: 'complete',
      detail: comp
        ? `${comp.strong ?? 0} strong · ${comp.partial ?? 0} partial · ${comp.blockers ?? 0} blockers · ${comp.execution_time_ms ?? '?'}ms`
        : null,
    };
    if (s.key === 'stage3') return {
      ...s, status: 'complete',
      detail: draft
        ? `${draft.drafts_generated ?? '?'} drafts · ${draft.model ?? '—'}`
        : null,
    };
    return { ...s, status: 'complete' };
  });
}

// ── Requirement card ──────────────────────────────────────────────────────────

function RequirementCard({ req, runId, onUpdated, getIcon }) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [editMode, setEditMode]     = useState(false);
  const [editedText, setEditedText] = useState('');
  const [comment, setComment]       = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState('');

  const ms   = matchStatusStyle(req.match_status);
  const pill = reviewPill(req.status);
  const micSupported =
    typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  const isBlocked  = req.status === 'blocked';
  /** `edited` is revisable — only `approved` / `rejected` hide the action bar. */
  const isTerminalReview = ['approved', 'rejected'].includes(req.status);
  const isReviewed       = ['approved', 'edited', 'rejected'].includes(req.status);

  const displayDraft =
    req.status === 'approved' && req.edited_text?.trim()
      ? req.edited_text
      : req.status === 'edited'
        ? (req.edited_text ?? '')
        : (req.draft_response ?? '');

  const canApprove =
    req.status === 'edited'
      ? !!(req.edited_text?.trim())
      : !!req.draft_response;

  const submit = async (status) => {
    if (!runId) {
      setReviewError('Run ID is missing. Reload this page or open the run from history, then try again.');
      return;
    }
    setSubmitting(true);
    setReviewError('');
    try {
      await api.patch(
        `/demo/runs/${runId}/tender-review/${encodeURIComponent(req.requirement_id)}`,
        {
        status,
        comment:     comment.trim() || undefined,
        ...(status === 'edited' ? { edited_text: editedText.trim() } : {}),
        }
      );
      setEditMode(false);
      setRejectOpen(false);
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
        border: `1px solid ${req.blocker_level === 'AMBER' ? '#fbbf24' : 'var(--color-border)'}`,
        opacity: isBlocked ? 0.7 : 1,
      }}
    >
      {/* Badge row */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="text-xs font-mono px-2 py-0.5 rounded"
            style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
          >
            {req.requirement_id}
          </span>
          <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#eff6ff', color: '#1d4ed8' }}>
            {req.category}
          </span>
          <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: ms.bg, color: ms.color }}>
            {ms.label}
          </span>
          {req.blocker && (
            <span
              className="text-xs font-medium px-2 py-0.5 rounded-full"
              style={{
                background: req.blocker_level === 'RED' ? '#fee2e2' : '#fef3c7',
                color:      req.blocker_level === 'RED' ? '#991b1b' : '#92400e',
              }}
            >
              {req.blocker_level} BLOCKER
            </span>
          )}
          {req.is_mandatory && (
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#f1f5f9', color: '#475569' }}>
              Mandatory gate
            </span>
          )}
          {req.evaluation_weight != null && (
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#f1f5f9', color: '#475569' }}>
              {req.evaluation_weight}%
            </span>
          )}
        </div>
        <span className="text-xs font-medium px-2 py-0.5 rounded-full shrink-0" style={{ background: pill.bg, color: pill.color }}>
          {pill.label}
        </span>
      </div>

      {/* Requirement text */}
      <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{req.requirement_text}</p>

      {/* Blocker notice */}
      {req.blocker && req.blocker_reason && (
        <div
          className="rounded-lg p-3 text-xs"
          style={{
            background: req.blocker_level === 'RED' ? '#fee2e2' : '#fef3c7',
            color:      req.blocker_level === 'RED' ? '#991b1b' : '#92400e',
          }}
        >
          <strong>{req.blocker_level} blocker:</strong> {req.blocker_reason}
        </div>
      )}

      {/* Evidence IDs */}
      {req.evidence_ids?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {req.evidence_ids.map((id) => (
            <span
              key={id}
              className="text-xs font-mono px-2 py-0.5 rounded"
              style={{ background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }}
            >
              {id}
            </span>
          ))}
        </div>
      )}

      {/* Match rationale */}
      {req.match_rationale && (
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{req.match_rationale}</p>
      )}

      {/* No-evidence notice — unblocked requirement with no draft */}
      {!isBlocked && !req.draft_response && !req.edited_text && req.status === 'pending' && !editMode && (
        <div
          className="rounded-lg px-3 py-2 text-xs"
          style={{ background: '#fef9c3', border: '1px solid #fde047', color: '#713f12' }}
        >
          No evidence match — manual response required. Use <strong>Write</strong> to author a response.
        </div>
      )}

      {/* Draft response — also when Write opened (no AI draft yet) */}
      {!isBlocked && (req.draft_response || req.edited_text || editMode) && (
        <div className="space-y-2">
          <p
            className="text-xs font-medium"
            style={{ color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}
          >
            Draft Response
          </p>

          {editMode ? (
            <div
              className="rounded-lg overflow-hidden"
              style={{ border: '1px solid var(--color-border)', background: 'var(--color-bg)' }}
            >
              <textarea
                value={editedText}
                onChange={(e) => setEditedText(e.target.value)}
                rows={6}
                className="w-full p-3 text-sm outline-none"
                style={{
                  background: 'var(--color-bg)',
                  border: 'none',
                  color: 'var(--color-text)',
                  resize: 'vertical',
                  lineHeight: 1.6,
                }}
                placeholder={
                  req.draft_response || req.edited_text
                    ? 'Enter your edited draft (Markdown: **bold**, lists, ## headings)…'
                    : 'Author your response (Markdown: **bold**, lists, ## headings). Cite evidence only where you have a record ID.'
                }
              />
              {micSupported && (
                <div
                  className="flex items-center justify-end gap-2 px-2 py-1.5"
                  style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-surface)' }}
                >
                  <MicButton
                    onResult={(t) => setEditedText((q) => {
                      const base = q.replace(/\s*\[.*?\]$/, '').trim();
                      return base ? `${base} ${t}` : t;
                    })}
                    onPartial={(t) => setEditedText((q) => {
                      const base = q.replace(/\s*\[.*?\]$/, '').trim();
                      return base ? `${base} [${t}]` : `[${t}]`;
                    })}
                  />
                </div>
              )}
            </div>
          ) : (
            <div
              className="rounded-lg p-3 text-sm"
              style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', lineHeight: 1.6, color: 'var(--color-text)' }}
            >
              <MarkdownRenderer text={displayDraft} />
            </div>
          )}

          {/* Original draft on hover after edit */}
          {((req.status === 'edited' || (req.status === 'approved' && req.edited_text?.trim()))
            && req.original_draft
            && req.original_draft !== (req.edited_text ?? '')
            && !editMode) && (
            <details>
              <summary className="text-xs cursor-pointer" style={{ color: 'var(--color-muted)' }}>
                Show original draft
              </summary>
              <div
                className="mt-2 rounded-lg p-3 text-xs"
                style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-muted)', lineHeight: 1.6 }}
              >
                <MarkdownRenderer text={req.original_draft ?? ''} />
              </div>
            </details>
          )}

          {req.confidence && !editMode && (
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Confidence:{' '}
              <strong
                style={{
                  color: req.confidence === 'HIGH'   ? '#16a34a'
                       : req.confidence === 'MEDIUM' ? '#d97706' : '#dc2626',
                }}
              >
                {req.confidence}
              </strong>
              {req.draft_notes ? ` · ${req.draft_notes}` : ''}
            </p>
          )}
        </div>
      )}

      {/* Reviewer comment (post-review) */}
      {isReviewed && req.comment && (
        <div className="rounded-lg p-3 text-xs" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
          <p className="font-medium mb-0.5" style={{ color: 'var(--color-muted)' }}>Reviewer comment</p>
          <p style={{ color: 'var(--color-text)' }}>{req.comment}</p>
          {req.reviewed_by && (
            <p className="mt-1" style={{ color: 'var(--color-muted)' }}>
              {req.reviewed_by} · {fmtTs(req.reviewed_at)}
            </p>
          )}
        </div>
      )}

      {/* Review error */}
      {reviewError && (
        <p className="text-xs" style={{ color: '#dc2626' }}>{reviewError}</p>
      )}

      {/* Review actions — pending first pass, or edited (revise / finalise approve / reject) */}
      {!isBlocked && !isTerminalReview && (
        <div className="space-y-2">
          {editMode ? (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                disabled={submitting || !editedText.trim()}
                onClick={() => submit('edited')}
                className="px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{
                  background: '#eff6ff', color: '#1d4ed8', border: 'none',
                  cursor: (submitting || !editedText.trim()) ? 'not-allowed' : 'pointer',
                }}
              >
                Save edit
              </button>
              <button
                onClick={() => { setEditMode(false); setEditedText(''); }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)', cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          ) : rejectOpen ? (
            <div className="space-y-2">
              <input
                type="text"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Reason for rejection (required)"
                className="w-full rounded-lg px-3 py-2 text-sm"
                style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              />
              <div className="flex gap-2">
                <button
                  disabled={submitting || !comment.trim()}
                  onClick={() => submit('rejected')}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium"
                  style={{
                    background: '#fee2e2', color: '#991b1b', border: 'none',
                    cursor: (submitting || !comment.trim()) ? 'not-allowed' : 'pointer',
                  }}
                >
                  Confirm rejection
                </button>
                <button
                  onClick={() => { setRejectOpen(false); setComment(''); }}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium"
                  style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)', cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                disabled={submitting || !canApprove}
                onClick={() => submit('approved')}
                className="px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{
                  background: canApprove ? '#dcfce7' : 'var(--color-bg)',
                  color:      canApprove ? '#166534' : 'var(--color-muted)',
                  border:     canApprove ? 'none' : '1px solid var(--color-border)',
                  cursor:     (submitting || !canApprove) ? 'not-allowed' : 'pointer',
                  opacity:    canApprove ? 1 : 0.5,
                }}
                title={
                  !canApprove
                    ? (req.status === 'edited'
                      ? 'Edited text is empty — add content before approving'
                      : 'No draft to approve — write a response first')
                    : undefined
                }
              >
                Approve
              </button>
              <button
                disabled={submitting}
                onClick={() => {
                  setEditedText(
                    req.status === 'edited'
                      ? (req.edited_text ?? '')
                      : (req.draft_response ?? '')
                  );
                  setEditMode(true);
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{ background: '#eff6ff', color: '#1d4ed8', border: 'none', cursor: submitting ? 'not-allowed' : 'pointer' }}
              >
                {req.draft_response || req.status === 'edited' ? 'Edit' : 'Write'}
              </button>
              <button
                disabled={submitting}
                onClick={() => setRejectOpen(true)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)', cursor: submitting ? 'not-allowed' : 'pointer' }}
              >
                Reject
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TenderResponseGenerator() {
  const getIcon                           = useIcon();
  const { user }                          = useAuthStore();
  const [searchParams, setSearchParams]   = useSearchParams();
  const fileInputRef                      = useRef(null);

  // Evidence pack
  const [evidenceFiles, setEvidenceFiles]     = useState([]);
  const [evidenceLoading, setEvidenceLoading] = useState(true);

  // Upload state
  const [file, setFile]       = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [runError, setRunError] = useState('');

  // Run state
  const [running, setRunning]       = useState(false);
  const [stages, setStages]         = useState(INITIAL_STAGES);
  const [progressTail, setProgressTail] = useState('');

  // Result state
  const [runId, setRunId]         = useState(searchParams.get('runId') ?? null);
  const [runData, setRunData]     = useState(null);
  const [loadingRun, setLoadingRun] = useState(false);
  const [reviewFilter, setReviewFilter] = useState('all');
  const [pdfExportLoading, setPdfExportLoading] = useState(false);
  const [viewPdfLoading, setViewPdfLoading]     = useState(false);
  const [pdfExportError, setPdfExportError]     = useState('');
  const [draftEmailOpen, setDraftEmailOpen]     = useState(false);
  const [draftEmailTo, setDraftEmailTo]           = useState('');
  const [draftEmailSending, setDraftEmailSending] = useState(false);
  const [draftEmailError, setDraftEmailError]   = useState('');
  const [draftEmailSent, setDraftEmailSent]     = useState(false);

  // History
  const [history, setHistory] = useState([]);

  useEffect(() => {
    api.get('/demo/tender-evidence')
      .then((data) => setEvidenceFiles(data.files ?? []))
      .catch(() => {})
      .finally(() => setEvidenceLoading(false));
  }, []);

  const fetchHistory = useCallback(() => {
    api.get('/demo/runs?slug=demo-tender-response&limit=10')
      .then(setHistory)
      .catch(() => {});
  }, []);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const loadRun = useCallback((id) => {
    setLoadingRun(true);
    api.get(`/demo/runs/${id}`)
      .then((row) => {
        setRunData(row.result ?? {});
        setRunId(String(id));
        setSearchParams({ runId: id }, { replace: true });
      })
      .catch((err) => setRunError(err.message))
      .finally(() => setLoadingRun(false));
  }, [setSearchParams]);

  useEffect(() => {
    if (runId && !runData && !loadingRun) loadRun(runId);
  }, [runId, runData, loadingRun, loadRun]);

  const handleRefresh = () => { if (runId) loadRun(runId); };

  const handleFile = (f) => {
    if (!f) return;
    if (f.type !== 'application/pdf') { setRunError('Only PDF files are supported.'); return; }
    if (f.size > MAX_FILE_BYTES) { setRunError('File too large (max 20 MB).'); return; }
    setFile(f);
    setRunError('');
  };

  const handleRun = async () => {
    if (!file) return;
    setRunning(true);
    setRunError('');
    setStages(INITIAL_STAGES);
    setRunData(null);
    setProgressTail('');

    const arrayBuf = await file.arrayBuffer();
    const base64   = btoa(String.fromCharCode(...new Uint8Array(arrayBuf)));

    streamRun(
      'demo-tender-response',
      { fileData: base64, mimeType: file.type, fileName: file.name },
      (msg) => {
        setProgressTail(msg);
        setStages((s) => advanceStages(s, msg));
      },
      (data) => {
        setRunning(false);
        const id = data?.runId ?? data?.id;
        const resultData = data?.data ? data : null;
        setRunData(resultData);
        if (id) {
          setRunId(String(id));
          setSearchParams({ runId: id }, { replace: true });
        }
        if (data?.data) setStages((s) => finaliseStages(s, data.data));
        fetchHistory();
      },
      (err) => {
        setRunning(false);
        setRunError(err);
      }
    );
  };

  // Derive display data
  const resultData   = runData?.data ?? {};
  const requirements = resultData.requirements ?? [];
  const summary      = resultData.compliance_summary ?? {};
  const extraction   = resultData.extraction_summary ?? {};
  const trace        = resultData.trace ?? [];
  const pendingCount = requirements.filter((r) => r.status === 'pending').length;

  const hitlStats = useMemo(() => {
    const c = { pending: 0, edited: 0, approved: 0, rejected: 0, blocked: 0 };
    for (const r of requirements) {
      const s = r.status ?? 'pending';
      if (s in c) c[s] += 1;
      else c.pending += 1;
    }
    const actionable = requirements.length - c.blocked;
    const addressed  = c.approved + c.edited + c.rejected;
    const pct        = actionable > 0 ? Math.round((addressed / actionable) * 100) : 0;
    return { ...c, actionable, addressed, pct };
  }, [requirements]);

  const filteredRequirements = useMemo(() => {
    if (reviewFilter === 'all') return requirements;
    return requirements.filter((r) => (r.status ?? 'pending') === reviewFilter);
  }, [requirements, reviewFilter]);

  const extractionModel = trace.find((t) => t.step === 'model_selection')?.model ?? null;
  const synthesisModel  = trace.find((t) => t.step === 'synthesis_model_selection')?.model ?? null;

  const hasResult = requirements.length > 0;

  const exportSlug = runId ? String(runId).replace(/-/g, '').slice(0, 10) : 'run';

  const pdfBusy = pdfExportLoading || viewPdfLoading || draftEmailSending;

  const handleViewDraftPdf = async () => {
    setViewPdfLoading(true);
    setPdfExportError('');
    try {
      const md    = buildTenderDraftPackMd(requirements, extraction);
      const title = extraction.document_title?.slice(0, 200) ?? 'Tender response draft pack';
      const blob  = await fetchPdfBlob({
        content:     md,
        contentType: 'markdown',
        title,
        filename: `preview-${exportSlug}.pdf`,
      });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 120000);
    } catch (e) {
      setPdfExportError(e.message ?? 'PDF preview failed');
    } finally {
      setViewPdfLoading(false);
    }
  };

  const handleSendDraftEmail = async () => {
    if (!runId || !draftEmailTo.trim()) return;
    setDraftEmailSending(true);
    setDraftEmailError('');
    setDraftEmailSent(false);
    try {
      const md    = buildTenderDraftPackMd(requirements, extraction);
      const title = extraction.document_title?.slice(0, 200) ?? 'Tender response draft pack';
      await api.post(`/demo/runs/${runId}/email-tender-draft`, {
        to:       draftEmailTo.trim(),
        markdown: md,
        title,
        filename: `tender-response-${exportSlug}.pdf`,
      });
      setDraftEmailSent(true);
      setDraftEmailOpen(false);
    } catch (e) {
      setDraftEmailError(e.message ?? 'Failed to send');
    } finally {
      setDraftEmailSending(false);
    }
  };

  const handleExportPdf = async () => {
    setPdfExportLoading(true);
    setPdfExportError('');
    try {
      const md = buildTenderDraftPackMd(requirements, extraction);
      await exportPdf({
        content:     md,
        contentType: 'markdown',
        title:       extraction.document_title?.slice(0, 200) ?? 'Tender response draft pack',
        filename:    `tender-response-${exportSlug}.pdf`,
      });
    } catch (e) {
      setPdfExportError(e.message ?? 'PDF export failed');
    } finally {
      setPdfExportLoading(false);
    }
  };

  const handleExportMarkdown = () => {
    const md = buildTenderDraftPackMd(requirements, extraction);
    downloadTextFile(`tender-draft-pack-${exportSlug}.md`, md);
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
          Tender Response Generator
        </h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
          Upload an RFT PDF — extract requirements, check them against your evidence pack, then review{' '}
          <strong>per-requirement</strong> drafts. <strong>Open</strong> or <strong>download</strong> the draft pack as PDF (same server pipeline as other demos), <strong>email</strong> the PDF to a colleague, or export <strong>Markdown</strong> for paste-up. This demo does not generate native Word (<span className="font-mono">.docx</span>) or a bound submission volume.
        </p>
      </div>

      {/* Evidence pack browser */}
      <div className="rounded-xl p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-2 mb-3">
          {getIcon('database', { size: 16 })}
          <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            Pre-loaded Evidence Pack
          </p>
        </div>
        {evidenceLoading ? (
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Loading evidence pack…</p>
        ) : evidenceFiles.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Evidence pack not available (S3 not configured or no files found).
          </p>
        ) : (
          <div className="space-y-1">
            {evidenceFiles.map((f) => {
              const name = f.key.split('/').pop() ?? f.key;
              return (
                <div key={f.key} className="flex items-center justify-between gap-3 text-xs" style={{ color: 'var(--color-muted)' }}>
                  <span className="font-mono truncate min-w-0" title={f.key}>
                    {f.downloadUrl ? (
                      <a
                        href={f.downloadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 hover:underline"
                        style={{ color: 'var(--color-primary)' }}
                      >
                        {name}
                        <span className="shrink-0" aria-hidden>{getIcon('external-link', { size: 12 })}</span>
                      </a>
                    ) : (
                      name
                    )}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    {f.size != null && <span>{(f.size / 1024).toFixed(1)} KB</span>}
                    {f.downloadUrl && (
                      <a
                        href={f.downloadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-sans font-medium hover:underline"
                        style={{ color: 'var(--color-primary)' }}
                      >
                        Open
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Upload zone — only when no result */}
      {!hasResult && !running && (
        <>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
            onClick={() => fileInputRef.current?.click()}
            className="rounded-xl p-10 text-center cursor-pointer"
            style={{
              border: `2px dashed ${dragOver ? 'var(--color-primary)' : 'var(--color-border)'}`,
              background: dragOver ? 'var(--color-surface)' : 'var(--color-bg)',
              transition: 'border-color 0.15s',
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <div style={{ margin: '0 auto 8px', width: 24, height: 24, color: 'var(--color-muted)' }}>
              {getIcon('upload', { size: 24 })}
            </div>
            {file ? (
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{file.name}</p>
            ) : (
              <>
                <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                  Drop RFT PDF here or click to browse
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>PDF only · max 20 MB</p>
              </>
            )}
          </div>

          {runError && (
            <div className="rounded-lg p-3 text-sm" style={{ background: '#fee2e2', color: '#991b1b' }}>
              {runError}
            </div>
          )}

          {file && (
            <button
              onClick={handleRun}
              className="w-full py-3 rounded-xl text-sm font-semibold"
              style={{ background: 'var(--color-primary)', color: '#fff', border: 'none', cursor: 'pointer' }}
            >
              Analyse RFT
            </button>
          )}
        </>
      )}

      {/* Processing modal */}
      <ProcessingModal
        isOpen={running}
        stages={stages.map((s) => ({
          id:          s.key,
          label:       s.name,
          description: s.detail || (s.status === 'active' && progressTail ? `→ ${progressTail}` : STAGE_DESCRIPTIONS[s.key]),
          status:      s.status,
        }))}
        estimatedDuration="Typical processing time: 30–90 seconds."
      />

      {/* Run error after completion */}
      {runError && hasResult && (
        <div className="rounded-lg p-3 text-sm" style={{ background: '#fee2e2', color: '#991b1b' }}>
          {runError}
        </div>
      )}

      {/* ── Results ──────────────────────────────────────────────────────────── */}
      {hasResult && (
        <div className="space-y-6">

          {/* Run summary */}
          <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  {extraction.document_title ?? 'Tender Analysis Complete'}
                </p>
                {(extraction.organisation || extraction.tender_reference) && (
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                    {[extraction.organisation, extraction.tender_reference].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-2 items-stretch sm:items-end">
                <div className="flex flex-wrap gap-2 justify-end items-center">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={handleViewDraftPdf}
                      disabled={pdfBusy}
                      title="Open PDF preview (new tab)"
                      className="rounded-lg p-2 transition-colors"
                      style={{
                        background: 'var(--color-bg)',
                        color:      'var(--color-text)',
                        border:     '1px solid var(--color-border)',
                        cursor:     pdfBusy ? 'not-allowed' : 'pointer',
                        lineHeight: 0,
                      }}
                    >
                      {getIcon('eye', { size: 16 })}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDraftEmailOpen((o) => !o);
                        setDraftEmailSent(false);
                        setDraftEmailError('');
                        if (!draftEmailTo && user?.email) setDraftEmailTo(user.email);
                      }}
                      title={draftEmailSent ? 'Draft pack sent' : 'Email draft pack (PDF)'}
                      className="rounded-lg p-2 transition-colors"
                      style={{
                        background: 'var(--color-bg)',
                        color:      draftEmailSent ? '#16a34a' : 'var(--color-text)',
                        border:     `1px solid ${draftEmailSent ? '#16a34a' : 'var(--color-border)'}`,
                        cursor:     'pointer',
                        lineHeight: 0,
                      }}
                    >
                      {getIcon('mail', { size: 16 })}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={handleExportPdf}
                    disabled={pdfBusy}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
                    style={{
                      background: pdfBusy ? 'var(--color-bg)' : '#1d4ed8',
                      color:      pdfBusy ? 'var(--color-muted)' : '#fff',
                      border:     'none',
                      cursor:     pdfBusy ? 'not-allowed' : 'pointer',
                    }}
                    title="Server-rendered PDF (same pipeline as compliance certificates)"
                  >
                    {getIcon('download', { size: 14 })}
                    {pdfExportLoading ? 'Building PDF…' : 'Download PDF'}
                  </button>
                  <button
                    type="button"
                    onClick={handleExportMarkdown}
                    disabled={pdfBusy}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
                    style={{
                      background: 'var(--color-bg)',
                      color:      'var(--color-text)',
                      border:     '1px solid var(--color-border)',
                      cursor:     pdfBusy ? 'not-allowed' : 'pointer',
                    }}
                    title="Raw Markdown for git, diff, or paste into Word"
                  >
                    {getIcon('file-text', { size: 14 })}
                    Markdown
                  </button>
                  <button
                    onClick={handleRefresh}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium"
                    style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)', cursor: 'pointer' }}
                  >
                    Refresh
                  </button>
                  <button
                    onClick={() => {
                      setRunData(null);
                      setFile(null);
                      setRunId(null);
                      setReviewFilter('all');
                      setPdfExportError('');
                      setDraftEmailOpen(false);
                      setDraftEmailTo('');
                      setDraftEmailError('');
                      setDraftEmailSent(false);
                      setSearchParams({}, { replace: true });
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium"
                    style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)', cursor: 'pointer' }}
                  >
                    New run
                  </button>
                </div>
                {draftEmailOpen && (
                  <div className="rounded-xl p-4 space-y-3 w-full max-w-md ml-auto" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                    <p className="text-xs font-semibold uppercase tracking-wider m-0" style={{ color: 'var(--color-muted)' }}>
                      Email draft pack (PDF)
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="email"
                        placeholder="recipient@example.com"
                        value={draftEmailTo}
                        onChange={(e) => { setDraftEmailTo(e.target.value); setDraftEmailError(''); }}
                        className="flex-1 min-w-[12rem] text-sm rounded-lg px-3 py-2"
                        style={{ border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontFamily: 'inherit', outline: 'none' }}
                      />
                      <button
                        type="button"
                        onClick={handleSendDraftEmail}
                        disabled={draftEmailSending || !draftEmailTo.trim() || !runId}
                        className="text-sm font-medium px-4 py-2 rounded-lg transition-colors shrink-0"
                        style={
                          draftEmailSending || !draftEmailTo.trim() || !runId
                            ? { background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)', cursor: 'not-allowed' }
                            : { background: 'var(--color-primary)', color: '#fff', cursor: 'pointer', border: 'none' }
                        }
                      >
                        {draftEmailSending ? 'Sending…' : 'Send'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDraftEmailOpen(false)}
                        className="text-xs shrink-0"
                        style={{ color: 'var(--color-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
                      >
                        Cancel
                      </button>
                    </div>
                    {!runId && (
                      <p className="text-xs m-0" style={{ color: '#d97706' }}>Run ID not available — reload this run from history or re-run the agent so email can attach to your org run.</p>
                    )}
                    {draftEmailError && <p className="text-xs m-0" style={{ color: '#dc2626' }}>{draftEmailError}</p>}
                  </div>
                )}
                {pdfExportError && (
                  <p className="text-xs text-right m-0" style={{ color: '#dc2626' }}>{pdfExportError}</p>
                )}
              </div>
            </div>

            {/* Coverage stats */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {[
                { label: 'Requirements',   value: extraction.requirements_total  ?? 0 },
                { label: 'Mandatory gates', value: extraction.mandatory_gate_count ?? 0 },
                { label: 'Strong match',   value: summary.strong   ?? 0, color: '#16a34a' },
                { label: 'Partial',        value: summary.partial  ?? 0, color: '#d97706' },
                { label: 'Blockers',       value: summary.blockers ?? 0, color: (summary.blockers ?? 0) > 0 ? '#dc2626' : undefined },
              ].map(({ label, value, color }) => (
                <div key={label} className="rounded-lg p-3 text-center" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                  <p className="text-xl font-bold" style={{ color: color ?? 'var(--color-text)' }}>{value}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{label}</p>
                </div>
              ))}
            </div>

            {/* Two-model display */}
            {(extractionModel || synthesisModel) && (
              <div className="flex gap-2 flex-wrap">
                {extractionModel && (
                  <span className="text-xs px-2 py-1 rounded" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>
                    Extraction: {extractionModel}
                  </span>
                )}
                {synthesisModel && (
                  <span className="text-xs px-2 py-1 rounded" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>
                    Drafting: {synthesisModel}
                    {synthesisModel !== extractionModel && (
                      <span style={{ color: '#16a34a', marginLeft: 4 }}>↓ switched</span>
                    )}
                  </span>
                )}
              </div>
            )}

            <div
              className="rounded-lg p-3 text-xs space-y-2"
              style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
            >
              <p className="font-semibold" style={{ color: 'var(--color-text)' }}>What happens next</p>
              <ul className="list-disc pl-4 space-y-1 m-0">
                <li>Review decisions are saved on <strong>this run</strong> only. There is no merge into your branded Word templates — use <strong>Download PDF</strong>, <strong>preview</strong>, or <strong>email</strong> for one review-ready file, then hand to BD for layout.</li>
                <li>Use the <strong>eye</strong> icon to open a PDF preview in a new tab (<code className="font-mono">fetchPdfBlob</code> + same <code className="font-mono">/api/export/pdf</code> render as download). Use <strong>Download PDF</strong> or <strong>mail</strong> to send the same PDF via email (<code className="font-mono">POST /api/demo/runs/:runId/email-tender-draft</code>, same markdown→PDF path as export). Use <strong>Markdown</strong> for raw text, version control, or opening in Word manually.</li>
                <li>Rows in <strong>Edited</strong> still show Approve / Reject until you finalise — use <strong>Approve</strong> when the text is ready to stand as your answer.</li>
              </ul>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                <span>Pending <strong style={{ color: '#d97706' }}>{hitlStats.pending}</strong></span>
                <span>Edited <strong style={{ color: '#1d4ed8' }}>{hitlStats.edited}</strong></span>
                <span>Approved <strong style={{ color: '#166534' }}>{hitlStats.approved}</strong></span>
                <span>Rejected <strong style={{ color: '#991b1b' }}>{hitlStats.rejected}</strong></span>
                <span>Blocked <strong style={{ color: '#64748b' }}>{hitlStats.blocked}</strong></span>
              </div>
              {hitlStats.actionable > 0 ? (
                <div className="space-y-1">
                  <div className="flex justify-between text-xs" style={{ color: 'var(--color-muted)' }}>
                    <span>Reviewed (approve / edit / reject) vs actionable</span>
                    <span>{hitlStats.addressed} / {hitlStats.actionable} · {hitlStats.pct}%</span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
                    <div
                      className="h-full rounded-full transition-[width] duration-300"
                      style={{ width: `${hitlStats.pct}%`, background: 'var(--color-primary)' }}
                    />
                  </div>
                </div>
              ) : (
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Every requirement is blocked — resolve evidence gaps outside this UI, then run again.</p>
              )}
              {hitlStats.edited > 0 && (
                <p className="text-xs" style={{ color: '#92400e' }}>
                  {hitlStats.edited} item{hitlStats.edited !== 1 ? 's' : ''} in <strong>Edited</strong> — click <strong>Approve</strong> when you are ready to finalise, or keep editing.
                </p>
              )}
              {pendingCount > 0 && (
                <p className="text-sm font-medium m-0" style={{ color: '#d97706' }}>
                  {pendingCount} requirement{pendingCount !== 1 ? 's' : ''} still <strong>Pending</strong> (no decision yet).
                </p>
              )}
              {pendingCount === 0 && hitlStats.actionable > 0 && hitlStats.edited === 0 && (
                <p className="text-sm font-medium m-0" style={{ color: '#16a34a' }}>
                  Every actionable requirement has left <strong>Pending</strong> — export or finalise any <strong>Edited</strong> rows, then use <strong>New run</strong> for another RFT.
                </p>
              )}
            </div>
          </div>

          {/* Loading indicator for existing run */}
          {loadingRun && (
            <div className="flex items-center gap-2" style={{ color: 'var(--color-muted)' }}>
              {getIcon('loader', { size: 14 })}
              <span className="text-sm">Loading run…</span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium shrink-0" style={{ color: 'var(--color-muted)' }}>Filter by review status</span>
            {REVIEW_FILTERS.map(({ id, label }) => {
              const count = id === 'all'
                ? requirements.length
                : (hitlStats[id] ?? 0);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setReviewFilter(id)}
                  className="px-3 py-1 rounded-full text-xs font-medium"
                  style={{
                    background: reviewFilter === id ? 'var(--color-primary)' : 'var(--color-bg)',
                    color: reviewFilter === id ? '#fff' : 'var(--color-text)',
                    border: `1px solid ${reviewFilter === id ? 'var(--color-primary)' : 'var(--color-border)'}`,
                    cursor: 'pointer',
                  }}
                >
                  {label}
                  {' '}
                  <span style={{ opacity: 0.85 }}>({count})</span>
                </button>
              );
            })}
          </div>

          {filteredRequirements.length === 0 ? (
            <p className="text-sm text-center py-6" style={{ color: 'var(--color-muted)' }}>
              No requirements match filter &quot;{REVIEW_FILTERS.find((f) => f.id === reviewFilter)?.label ?? reviewFilter}&quot;.
            </p>
          ) : (
            <div className="space-y-4">
              {filteredRequirements.map((req) => (
                <RequirementCard
                  key={req.requirement_id}
                  req={req}
                  runId={runId}
                  onUpdated={handleRefresh}
                  getIcon={getIcon}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Run history */}
      {history.length > 0 && (
        <div className="rounded-xl p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <p className="text-sm font-medium mb-3" style={{ color: 'var(--color-text)' }}>Previous runs</p>
          <div className="space-y-1">
            {history.map((run) => (
              <button
                key={run.id}
                onClick={() => loadRun(run.id)}
                className="w-full flex items-center justify-between rounded-lg px-3 py-2 text-xs"
                style={{
                  background: String(run.id) === runId ? 'var(--color-bg)' : 'transparent',
                  border: `1px solid ${String(run.id) === runId ? 'var(--color-border)' : 'transparent'}`,
                  cursor: 'pointer',
                  textAlign: 'left',
                  color: 'var(--color-text)',
                }}
              >
                <span>Tender analysis · {fmtTs(run.run_at)}</span>
                <span style={{ color: run.status === 'complete' ? '#16a34a' : '#dc2626' }}>
                  {run.status}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
