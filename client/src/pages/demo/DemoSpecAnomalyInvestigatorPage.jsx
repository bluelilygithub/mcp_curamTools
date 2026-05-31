/**
 * Demo Spec Anomaly Investigator page.
 *
 * Upload a hydraulic spec PDF + optional concern.
 * Three-tab output: Investigation Log | Dead Ends | Open Threads.
 * Sections parsed client-side from agent markdown output.
 * Text export only — no compliance certificate.
 */
import { useState, useRef, useEffect } from 'react';
import api from '../../api/client';
import MarkdownRenderer from '../../components/ui/MarkdownRenderer';
import InlineBanner from '../../components/ui/InlineBanner';
import BoundsWarningPanel from '../../components/ui/BoundsWarningPanel';
import MicButton from '../../components/ui/MicButton';
import ProcessingModal from '../../components/shared/ProcessingModal';
import { exportText } from '../../utils/exportService';
import { fmtDate } from '../../utils/date';

const AGENT_SLUG  = 'demo-spec-anomaly-investigator';
const MAX_FILE_MB = 10;
const MAX_BYTES   = MAX_FILE_MB * 1024 * 1024;

function isoDate(d) { return d.toISOString().slice(0, 10); }

const fmtCost   = (n) => n != null ? `A$${Number(n).toFixed(4)}` : null;
const fmtTokens = (n) => n != null ? Number(n).toLocaleString() : null;

// ── Parse markdown into three sections ───────────────────────────────────────

function parseSections(summary) {
  const sections = { log: '', deadEnds: '', openThreads: '' };
  if (!summary) return sections;

  const logMatch        = summary.match(/## Investigation Log([\s\S]*?)(?=## Dead Ends|## Open Threads|$)/);
  const deadEndsMatch   = summary.match(/## Dead Ends([\s\S]*?)(?=## Open Threads|$)/);
  const openThreadsMatch = summary.match(/## Open Threads([\s\S]*?)$/);

  if (logMatch)         sections.log         = logMatch[1].trim();
  if (deadEndsMatch)    sections.deadEnds    = deadEndsMatch[1].trim();
  if (openThreadsMatch) sections.openThreads = openThreadsMatch[1].trim();

  return sections;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const inputStyle = {
  padding: '0.4rem 0.6rem', borderRadius: '0.5rem',
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg)', color: 'var(--color-text)',
  fontSize: '0.875rem', outline: 'none', fontFamily: 'inherit',
};

const btnPrimary = (disabled) => ({
  padding: '0.45rem 1.1rem', fontSize: '0.875rem', fontWeight: 600,
  fontFamily: 'inherit', borderRadius: '0.5rem', border: 'none',
  background: disabled ? 'var(--color-border)' : 'var(--color-primary)',
  color: '#fff', cursor: disabled ? 'not-allowed' : 'pointer',
});

const btnGhost = {
  padding: '0.3rem 0.75rem', fontSize: '0.75rem', fontWeight: 500,
  fontFamily: 'inherit', borderRadius: '0.5rem', cursor: 'pointer',
  border: '1px solid var(--color-border)',
  background: 'transparent', color: 'var(--color-muted)',
};

// ── File drop zone ────────────────────────────────────────────────────────────

function FileDropZone({ file, onFile, disabled }) {
  const inputRef    = useRef(null);
  const [dragging, setDragging] = useState(false);

  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onFile(f);
  }

  return (
    <div
      onClick={() => !disabled && inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      style={{
        border: `2px dashed ${dragging ? 'var(--color-primary)' : 'var(--color-border)'}`,
        borderRadius: '0.75rem',
        padding: '1.5rem',
        textAlign: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: dragging ? 'rgba(var(--color-primary-rgb, 0,0,0),0.04)' : 'var(--color-bg)',
        transition: 'border-color 0.15s',
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        style={{ display: 'none' }}
        disabled={disabled}
        onChange={(e) => { if (e.target.files?.[0]) onFile(e.target.files[0]); }}
      />
      {file ? (
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{file.name}</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
            {(file.size / 1024 / 1024).toFixed(2)} MB · Click to replace
          </p>
        </div>
      ) : (
        <div>
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
            Drop a PDF here or click to browse
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
            Hydraulic specification documents only · Max {MAX_FILE_MB} MB
          </p>
        </div>
      )}
    </div>
  );
}

// ── Progress display ──────────────────────────────────────────────────────────

function InvestigationProgress({ lines }) {
  return (
    <div className="rounded-xl border p-4 mb-4"
      style={{ borderColor: 'var(--color-primary)', background: 'var(--color-surface)' }}>
      <style>{`@keyframes _dsai_pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
      <div className="flex items-center gap-2 mb-2">
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: 'var(--color-primary)',
          animation: '_dsai_pulse 1.4s ease-in-out infinite',
        }} />
        <p className="text-xs font-semibold" style={{ color: 'var(--color-primary)' }}>
          Investigating specification…
        </p>
      </div>
      {lines.length > 0 && (
        <div className="space-y-0.5">
          {lines.slice(-5).map((l, i) => (
            <p key={i} className="text-xs" style={{ color: 'var(--color-muted)', fontFamily: 'monospace' }}>
              › {l}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Three-tab result display ──────────────────────────────────────────────────

function ResultTabs({ summary, boundsFailed }) {
  const [activeTab, setActiveTab] = useState('log');
  const sections   = parseSections(summary);

  const tabs = [
    { key: 'log',         label: 'Investigation Log', content: sections.log,         missing: !sections.log },
    { key: 'deadEnds',    label: 'Dead Ends',          content: sections.deadEnds,    missing: !sections.deadEnds },
    { key: 'openThreads', label: 'Open Threads',       content: sections.openThreads, missing: !sections.openThreads },
  ];

  const tabBtn = (key, label, missing) => (
    <button
      key={key}
      onClick={() => setActiveTab(key)}
      style={{
        padding: '0.35rem 0.85rem', fontSize: '0.8rem', fontWeight: 500,
        fontFamily: 'inherit', borderRadius: '0.5rem', cursor: 'pointer', border: 'none',
        background: activeTab === key ? 'var(--color-primary)' : 'transparent',
        color:      activeTab === key ? '#fff' : missing ? '#b91c1c' : 'var(--color-muted)',
      }}
    >
      {label}{missing ? ' ⚠' : ''}
    </button>
  );

  const active = tabs.find((t) => t.key === activeTab);

  return (
    <div>
      {boundsFailed?.length > 0 && <BoundsWarningPanel boundsFailed={boundsFailed} />}

      <div className="flex items-center gap-1 mb-4">
        {tabs.map((t) => tabBtn(t.key, t.label, t.missing))}
      </div>

      <div className="rounded-xl border p-4"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', minHeight: 120 }}>
        {active?.missing ? (
          <BoundsWarningPanel boundsFailed={[{
            tool: 'output-structure',
            message: `Section "${active.label}" was not produced by the agent. The investigation may have terminated early or the output format was not followed.`,
          }]} />
        ) : (
          <MarkdownRenderer text={active?.content ?? ''} />
        )}
      </div>
    </div>
  );
}

// ── Run history ───────────────────────────────────────────────────────────────

function RunHistory({ onLoad }) {
  const [rows,     setRows]     = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [fetchErr, setFetchErr] = useState('');

  useEffect(() => {
    api.get(`/agents/${AGENT_SLUG}/history`)
      .then(setRows)
      .catch((e) => setFetchErr(e.message || 'Failed to load history'))
      .finally(() => setLoading(false));
  }, []);

  if (loading)  return <p className="text-sm py-4" style={{ color: 'var(--color-muted)' }}>Loading…</p>;
  if (fetchErr) return <p className="text-sm py-4" style={{ color: '#b91c1c' }}>Error: {fetchErr}</p>;
  if (!rows.length) return <p className="text-sm py-4" style={{ color: 'var(--color-muted)' }}>No investigations yet.</p>;

  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.id} className="rounded-xl border p-3 flex items-start justify-between gap-3"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>
              {r.result?.fileName ?? 'Investigation'}
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
              {fmtDate(r.run_at)}
              {r.result?.costAud ? `  ·  ${fmtCost(r.result.costAud)}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs font-semibold rounded px-2 py-0.5" style={{
              background: r.status === 'complete' ? '#dcfce7' : r.status === 'needs_review' ? '#fef9c3' : '#fee2e2',
              color:      r.status === 'complete' ? '#15803d' : r.status === 'needs_review' ? '#854d0e' : '#b91c1c',
            }}>
              {r.status}
            </span>
            {(r.status === 'complete' || r.status === 'needs_review') && r.result && (
              <button onClick={() => onLoad(r.result)} style={{ ...btnGhost, fontFamily: 'inherit' }}>
                Load
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DemoSpecAnomalyInvestigatorPage() {
  const [file,             setFile]            = useState(null);
  const [fileError,        setFileError]       = useState('');
  const [concern,          setConcern]         = useState('');
  const [partialTranscript, setPartialTranscript] = useState('');
  const [running,          setRunning]         = useState(false);
  const [progress,         setProgress]        = useState([]);
  const [error,            setError]           = useState('');
  const [result,           setResult]          = useState(null);
  const [activeTab,        setActiveTab]       = useState('investigate');

  const abortRef = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (running) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [running]);

  function handleFile(f) {
    setFileError('');
    if (!f.type.includes('pdf')) { setFileError('Only PDF files are accepted.'); return; }
    if (f.size > MAX_BYTES) { setFileError(`File exceeds ${MAX_FILE_MB} MB limit.`); return; }
    setFile(f);
  }

  async function handleRun() {
    if (!file) { setError('Upload a specification PDF before running.'); return; }

    setRunning(true);
    setProgress([]);
    setError('');
    setResult(null);
    abortRef.current = new AbortController();

    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const token = (await import('../../stores/authStore')).default.getState().token;
      const res   = await fetch(`/api/agents/${AGENT_SLUG}/run`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body:   JSON.stringify({
          fileData:       base64,
          mimeType:       'application/pdf',
          fileName:       file.name,
          freeformConcern: concern.trim() || '',
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }

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
          if (raw === '[DONE]') { setRunning(false); return; }
          try {
            const msg = JSON.parse(raw);
            if (msg.type === 'progress') setProgress((p) => [...p, msg.text]);
            else if (msg.type === 'result') { resultReceived = true; setResult(msg.data); }
            else if (msg.type === 'error')  setError(msg.error);
          } catch { /* ignore */ }
        }
      }

      if (!resultReceived) setError('Investigation ended without a result — check server logs.');
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message);
    } finally {
      setRunning(false);
    }
  }

  const summary     = result?.summary ?? '';
  const boundsFail  = result?.boundsFailed ?? [];
  const cost        = fmtCost(result?.costAud);
  const tokens      = result?.tokensUsed;

  const tabBtn = (tab, label) => (
    <button key={tab} onClick={() => setActiveTab(tab)} style={{
      padding: '0.35rem 0.85rem', fontSize: '0.8rem', fontWeight: 500,
      fontFamily: 'inherit', borderRadius: '0.5rem', cursor: 'pointer', border: 'none',
      background: activeTab === tab ? 'var(--color-primary)' : 'transparent',
      color:      activeTab === tab ? '#fff' : 'var(--color-muted)',
    }}>{label}</button>
  );

  return (
    <div className="p-5 max-w-4xl mx-auto" style={{ fontFamily: 'inherit' }}>

      {/* Header */}
      <div className="mb-5">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
          Spec Anomaly Investigator
        </h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
          Upload a hydraulic specification PDF. Agent investigates for likely problems — before Spec Validator runs.
        </p>
      </div>

      {/* Page tabs */}
      <div className="flex items-center gap-1 mb-4">
        {tabBtn('investigate', 'Investigate')}
        {tabBtn('history',     'History')}
      </div>

      {/* ── Investigate ─────────────────────────────────────────────────────── */}
      {activeTab === 'investigate' && (
        <div>
          <div className="rounded-2xl border p-5 mb-4"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>

            {/* File upload */}
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text)' }}>
              Specification document
            </label>
            <FileDropZone file={file} onFile={handleFile} disabled={running} />
            {fileError && (
              <p className="text-xs mt-1" style={{ color: '#dc2626' }}>{fileError}</p>
            )}

            {/* Optional concern */}
            <label className="block text-sm font-medium mt-4 mb-2" style={{ color: 'var(--color-text)' }}>
              Describe your concern <span style={{ fontWeight: 400, color: 'var(--color-muted)' }}>(optional)</span>
            </label>
            <div style={{ position: 'relative' }}>
              <textarea
                value={concern + partialTranscript}
                onChange={(e) => setConcern(e.target.value)}
                placeholder="Leave blank to let the agent investigate freely — or describe a specific concern, e.g. 'Velocities in segments CW-04 and CW-05 seem high for the pipe sizes stated.'"
                rows={3}
                disabled={running}
                style={{
                  ...inputStyle,
                  width: '100%', resize: 'vertical',
                  lineHeight: 1.6,
                  padding: '0.6rem 2.5rem 0.6rem 0.75rem',
                }}
              />
              <div style={{ position: 'absolute', top: 6, right: 6 }}>
                <MicButton
                  onResult={(t) => {
                    setConcern((prev) => (prev.trim() ? prev.trim() + ' ' : '') + t);
                    setPartialTranscript('');
                  }}
                  onPartial={(t) => setPartialTranscript(t ? ' ' + t : '')}
                  size={15}
                />
              </div>
            </div>

            {/* Run button */}
            <div className="mt-4 flex items-center gap-3">
              <button onClick={handleRun} disabled={running || !file} style={btnPrimary(running || !file)}>
                {running ? 'Investigating…' : 'Investigate'}
              </button>
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                Budget cap A$1.50 · Uses org default model
              </span>
            </div>
          </div>

          {error && <InlineBanner type="error" message={error} onDismiss={() => setError('')} className="mb-4" />}
          {running && <InvestigationProgress lines={progress} />}

          {/* Result */}
          {summary && !running && (
            <div className="rounded-2xl border p-5"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>

              <ResultTabs summary={summary} boundsFailed={boundsFail} />

              {/* Metadata + export */}
              <div className="mt-4 pt-4 flex items-center justify-between flex-wrap gap-3"
                style={{ borderTop: '1px solid var(--color-border)' }}>
                <p className="text-xs" style={{ color: 'var(--color-muted)', fontFamily: 'monospace' }}>
                  {[
                    tokens?.input  != null ? `↑ ${fmtTokens(tokens.input)} in`  : null,
                    tokens?.output != null ? `↓ ${fmtTokens(tokens.output)} out` : null,
                    cost,
                    result?.model,
                  ].filter(Boolean).join('  ·  ')}
                </p>
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>Export:</span>
                  <button
                    onClick={() => exportText({
                      content:  `Spec Anomaly Investigation\nFile: ${result?.fileName ?? file?.name ?? ''}\n\n${summary}`,
                      filename: `spec-investigation-${isoDate(new Date())}.txt`,
                    })}
                    style={btnGhost}
                  >
                    Text
                  </button>
                </div>
              </div>
            </div>
          )}

          {!summary && !running && !error && (
            <div className="rounded-2xl border p-8 text-center"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
              <p style={{ color: 'var(--color-muted)', fontSize: '0.875rem' }}>
                Upload a specification PDF and click <strong>Investigate</strong>.
                The agent reads the document, forms hypotheses from what it finds, and stops when confident or hypotheses are exhausted.
              </p>
              <p className="mt-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                This agent investigates for likely problems before formal validation.
                Run <strong>Spec Validator</strong> after for definitive compliance calculations.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── History ──────────────────────────────────────────────────────────── */}
      {activeTab === 'history' && (
        <div className="rounded-2xl border p-4"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <RunHistory
            onLoad={(r) => {
              setResult(r);
              setActiveTab('investigate');
            }}
          />
        </div>
      )}

      {/* Processing modal */}
      <ProcessingModal
        isOpen={running}
        title="Investigating specification…"
        estimatedDuration="Typically 1–2 minutes depending on document complexity."
        onCancel={() => { abortRef.current?.abort(); setRunning(false); }}
        cancelConfirmMessage="Cancel this investigation? The document will need to be resubmitted."
      />
    </div>
  );
}
