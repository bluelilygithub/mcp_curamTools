import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../api/client';
import MarkdownRenderer from '../../components/ui/MarkdownRenderer';
import { exportPdf, exportText } from '../../utils/exportService';
import { fmtDate } from '../../utils/date';

const AGENT_SLUG = 'not-interested-report';

const cardStyle = {
  background:   'var(--color-surface)',
  borderColor:  'var(--color-border)',
  borderRadius: '1rem',
  border:       '1px solid var(--color-border)',
  padding:      '1.25rem',
};

function ProgressLog({ lines }) {
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [lines]);
  if (!lines.length) return null;
  return (
    <div style={{ ...cardStyle, borderColor: 'var(--color-primary)', marginBottom: '1rem' }}>
      <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-primary)' }}>Running…</p>
      <div className="space-y-1">
        {lines.map((line, i) => (
          <p key={i} className="text-xs font-mono" style={{ color: 'var(--color-muted)' }}>{line}</p>
        ))}
      </div>
      <div ref={endRef} />
    </div>
  );
}

function HistoryRun({ run, onSelect, isSelected }) {
  const summary = typeof run.summary === 'string' ? run.summary : '';
  const preview = summary.slice(0, 120).replace(/[#*`]/g, '');
  return (
    <button
      onClick={() => onSelect(run)}
      style={{
        ...cardStyle,
        width:        '100%',
        textAlign:    'left',
        cursor:       'pointer',
        borderColor:  isSelected ? 'var(--color-primary)' : 'var(--color-border)',
        opacity:      isSelected ? 1 : 0.8,
      }}
    >
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs font-semibold" style={{ color: 'var(--color-primary)' }}>
          {fmtDate(run.run_at)}
        </span>
        <span
          className="text-xs px-2 py-0.5 rounded-full"
          style={{
            background: run.status === 'success' ? 'var(--color-success-bg, #dcfce7)' : 'var(--color-error-bg, #fee2e2)',
            color:      run.status === 'success' ? 'var(--color-success, #166534)'    : 'var(--color-error, #991b1b)',
          }}
        >
          {run.status}
        </span>
      </div>
      {preview && (
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          {preview}{summary.length > 120 ? '…' : ''}
        </p>
      )}
    </button>
  );
}

export default function NotInterestedReportPage() {
  const [running,       setRunning]       = useState(false);
  const [progressLines, setProgressLines] = useState([]);
  const [reportText,    setReportText]    = useState('');
  const [history,       setHistory]       = useState([]);
  const [selectedRun,   setSelectedRun]   = useState(null);
  const [error,         setError]         = useState('');
  const [exporting,     setExporting]     = useState(false);
  const abortRef = useRef(null);

  const loadHistory = useCallback(async () => {
    try {
      const res = await api.get(`/agents/${AGENT_SLUG}/history`);
      const rows = res.data ?? [];
      setHistory(rows);
      if (rows.length > 0 && !selectedRun) {
        const first = rows[0];
        const text = typeof first.summary === 'string' ? first.summary : '';
        setReportText(text);
        setSelectedRun(first);
      }
    } catch (_e) {
      // history is non-critical
    }
  }, [selectedRun]);

  useEffect(() => { loadHistory(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function selectRun(run) {
    setSelectedRun(run);
    const text = typeof run.summary === 'string' ? run.summary : '';
    setReportText(text);
  }

  async function runReport() {
    setRunning(true);
    setProgressLines([]);
    setReportText('');
    setError('');

    try {
      const response = await fetch('/api/agents/not-interested-report/run', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const msg = await response.text();
        throw new Error(msg || `HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const dec    = new TextDecoder();
      abortRef.current = reader;
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') break;
          try {
            const ev = JSON.parse(raw);
            if (ev.type === 'progress') setProgressLines((p) => [...p, ev.text]);
            if (ev.type === 'result')   setReportText(typeof ev.data === 'string' ? ev.data : JSON.stringify(ev.data));
            if (ev.type === 'error')    setError(ev.error ?? 'Unknown error');
          } catch (_) { /* skip malformed */ }
        }
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
      loadHistory();
    }
  }

  async function handleExportPdf() {
    if (!reportText) return;
    setExporting(true);
    try {
      await exportPdf({
        content:  reportText,
        title:    'Not Interested Report',
        filename: `not-interested-report-${new Date().toISOString().slice(0, 10)}.pdf`,
      });
    } catch (_e) {
      exportText({ content: reportText, filename: 'not-interested-report.txt' });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
            Not Interested Report
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
            Diagnoses why wrong-product and wrong-location leads are reaching the sales team.
            Separates ads targeting problems from sales qualification failures.
          </p>
        </div>
        <button
          onClick={runReport}
          disabled={running}
          style={{
            background:   running ? 'var(--color-muted)' : 'var(--color-primary)',
            color:        '#fff',
            border:       'none',
            borderRadius: '0.5rem',
            padding:      '0.5rem 1.25rem',
            fontWeight:   600,
            fontSize:     '0.875rem',
            cursor:       running ? 'not-allowed' : 'pointer',
            whiteSpace:   'nowrap',
            flexShrink:   0,
          }}
        >
          {running ? 'Running…' : 'Run Analysis'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{ ...cardStyle, borderColor: 'var(--color-error, #ef4444)', color: 'var(--color-error, #ef4444)' }}>
          <p className="text-sm font-semibold">Error</p>
          <p className="text-sm">{error}</p>
        </div>
      )}

      {/* Progress log */}
      <ProgressLog lines={progressLines} />

      {/* Main content — report + history side-by-side */}
      <div className="flex gap-4 items-start">

        {/* Report output */}
        <div className="flex-1 min-w-0">
          {reportText ? (
            <div style={cardStyle}>
              <div className="flex justify-between items-center mb-4">
                <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  {selectedRun ? `Run: ${fmtDate(selectedRun.run_at)}` : 'Latest Report'}
                </p>
                <button
                  onClick={handleExportPdf}
                  disabled={exporting}
                  style={{
                    background:   'transparent',
                    border:       '1px solid var(--color-border)',
                    borderRadius: '0.4rem',
                    padding:      '0.3rem 0.75rem',
                    fontSize:     '0.75rem',
                    cursor:       exporting ? 'not-allowed' : 'pointer',
                    color:        'var(--color-muted)',
                  }}
                >
                  {exporting ? 'Exporting…' : 'Export PDF'}
                </button>
              </div>
              <MarkdownRenderer content={reportText} />
            </div>
          ) : (
            !running && (
              <div style={{ ...cardStyle, textAlign: 'center', padding: '3rem' }}>
                <p style={{ color: 'var(--color-muted)', fontSize: '0.875rem' }}>
                  No report yet. Click "Run Analysis" to generate the first one.
                </p>
              </div>
            )
          )}
        </div>

        {/* History sidebar */}
        {history.length > 0 && (
          <div className="w-64 flex-shrink-0 space-y-2">
            <p className="text-xs font-semibold" style={{ color: 'var(--color-muted)' }}>
              Previous runs
            </p>
            {history.map((run) => (
              <HistoryRun
                key={run.id}
                run={run}
                onSelect={selectRun}
                isSelected={selectedRun?.id === run.id}
              />
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
