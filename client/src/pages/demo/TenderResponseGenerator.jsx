import { useState, useRef, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import { useIcon } from '../../providers/IconProvider';
import ProcessingModal from '../../components/shared/ProcessingModal';

const MAX_FILE_BYTES = 20 * 1024 * 1024;

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

  const isBlocked  = req.status === 'blocked';
  const isReviewed = ['approved', 'edited', 'rejected'].includes(req.status);

  const submit = async (status) => {
    setSubmitting(true);
    setReviewError('');
    try {
      await api.patch(`/demo/runs/${runId}/tender-review/${req.requirement_id}`, {
        status,
        comment:     comment.trim() || undefined,
        ...(status === 'edited' ? { edited_text: editedText.trim() } : {}),
      });
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
      {!isBlocked && !req.draft_response && !req.edited_text && req.status === 'pending' && (
        <div
          className="rounded-lg px-3 py-2 text-xs"
          style={{ background: '#fef9c3', border: '1px solid #fde047', color: '#713f12' }}
        >
          No evidence match — manual response required. Use <strong>Write</strong> to author a response.
        </div>
      )}

      {/* Draft response */}
      {!isBlocked && (req.draft_response || req.edited_text) && (
        <div className="space-y-2">
          <p
            className="text-xs font-medium"
            style={{ color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}
          >
            Draft Response
          </p>

          {editMode ? (
            <textarea
              value={editedText}
              onChange={(e) => setEditedText(e.target.value)}
              rows={6}
              className="w-full rounded-lg p-3 text-sm"
              style={{
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text)',
                resize: 'vertical',
                lineHeight: 1.6,
              }}
              placeholder="Enter your edited draft…"
            />
          ) : (
            <div
              className="rounded-lg p-3 text-sm"
              style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', lineHeight: 1.6, color: 'var(--color-text)' }}
            >
              {req.status === 'edited' ? req.edited_text : req.draft_response}
            </div>
          )}

          {/* Original draft on hover after edit */}
          {req.status === 'edited' && req.original_draft && req.original_draft !== req.edited_text && !editMode && (
            <details>
              <summary className="text-xs cursor-pointer" style={{ color: 'var(--color-muted)' }}>
                Show original draft
              </summary>
              <div
                className="mt-2 rounded-lg p-3 text-xs"
                style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-muted)', lineHeight: 1.6 }}
              >
                {req.original_draft}
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

      {/* Review actions — only for pending (non-blocked, non-reviewed) */}
      {!isBlocked && !isReviewed && (
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
                disabled={submitting || !req.draft_response}
                onClick={() => submit('approved')}
                className="px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{
                  background: req.draft_response ? '#dcfce7' : 'var(--color-bg)',
                  color:      req.draft_response ? '#166534' : 'var(--color-muted)',
                  border:     req.draft_response ? 'none' : '1px solid var(--color-border)',
                  cursor:     (submitting || !req.draft_response) ? 'not-allowed' : 'pointer',
                  opacity:    req.draft_response ? 1 : 0.5,
                }}
                title={!req.draft_response ? 'No draft to approve — write a response first' : undefined}
              >
                Approve
              </button>
              <button
                disabled={submitting}
                onClick={() => { setEditedText(req.draft_response ?? ''); setEditMode(true); }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{ background: '#eff6ff', color: '#1d4ed8', border: 'none', cursor: submitting ? 'not-allowed' : 'pointer' }}
              >
                {req.draft_response ? 'Edit' : 'Write'}
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

  const extractionModel = trace.find((t) => t.step === 'model_selection')?.model ?? null;
  const synthesisModel  = trace.find((t) => t.step === 'synthesis_model_selection')?.model ?? null;

  const hasResult = requirements.length > 0;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
          Tender Response Generator
        </h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
          Upload an RFT PDF — extract compliance requirements, verify against the evidence pack, and generate first-draft response paragraphs.
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
            {evidenceFiles.map((f) => (
              <div key={f.key} className="flex items-center justify-between text-xs" style={{ color: 'var(--color-muted)' }}>
                <span className="font-mono">{f.key.split('/').pop()}</span>
                {f.size != null && <span>{(f.size / 1024).toFixed(1)} KB</span>}
              </div>
            ))}
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
              <div className="flex gap-2">
                <button
                  onClick={handleRefresh}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium"
                  style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)', cursor: 'pointer' }}
                >
                  Refresh
                </button>
                <button
                  onClick={() => { setRunData(null); setFile(null); setRunId(null); setSearchParams({}, { replace: true }); }}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium"
                  style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)', cursor: 'pointer' }}
                >
                  New run
                </button>
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

            {pendingCount > 0 && (
              <p className="text-sm font-medium" style={{ color: '#d97706' }}>
                {pendingCount} draft{pendingCount !== 1 ? 's' : ''} awaiting review
              </p>
            )}
            {pendingCount === 0 && requirements.length > 0 && (
              <p className="text-sm font-medium" style={{ color: '#16a34a' }}>
                All requirements reviewed
              </p>
            )}
          </div>

          {/* Loading indicator for existing run */}
          {loadingRun && (
            <div className="flex items-center gap-2" style={{ color: 'var(--color-muted)' }}>
              {getIcon('loader', { size: 14 })}
              <span className="text-sm">Loading run…</span>
            </div>
          )}

          {/* Requirement cards */}
          <div className="space-y-4">
            {requirements.map((req) => (
              <RequirementCard
                key={req.requirement_id}
                req={req}
                runId={runId}
                onUpdated={handleRefresh}
                getIcon={getIcon}
              />
            ))}
          </div>
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
