/**
 * Anomaly Investigator — open-ended hypothesis-driven investigation page.
 *
 * Input: freeform anomaly description + optional date range.
 * Output: Investigation Log / Dead Ends / Open Threads — no conclusion section.
 * The agent writes the log; the human draws the conclusion.
 */
import { useState, useEffect } from 'react';
import api from '../../api/client';
import MarkdownRenderer from '../../components/ui/MarkdownRenderer';
import InlineBanner from '../../components/ui/InlineBanner';
import BoundsWarningPanel from '../../components/ui/BoundsWarningPanel';
import { fmtDate } from '../../utils/date';
import { exportText, exportPdf } from '../../utils/exportService';

const AGENT_SLUG = 'anomaly-investigator';

function isoDate(d) { return d.toISOString().slice(0, 10); }

const inputStyle = {
  padding: '0.4rem 0.6rem',
  borderRadius: '0.5rem',
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg)',
  color: 'var(--color-text)',
  fontSize: '0.875rem',
  outline: 'none',
  fontFamily: 'inherit',
};

const btnPrimary = (disabled) => ({
  padding: '0.45rem 1.1rem', fontSize: '0.875rem', fontWeight: 600,
  fontFamily: 'inherit', borderRadius: '0.5rem', border: 'none',
  background: disabled ? 'var(--color-border)' : 'var(--color-primary)',
  color: '#fff', cursor: disabled ? 'not-allowed' : 'pointer',
});

// ── Progress stream display ───────────────────────────────────────────────────

function InvestigationProgress({ lines }) {
  return (
    <div
      className="rounded-xl border p-4 mb-4"
      style={{ borderColor: 'var(--color-primary)', background: 'var(--color-surface)' }}
    >
      <style>{`@keyframes _ai_pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
      <div className="flex items-center gap-2 mb-3">
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: 'var(--color-primary)',
          animation: '_ai_pulse 1.4s ease-in-out infinite',
        }} />
        <p className="text-xs font-semibold" style={{ color: 'var(--color-primary)' }}>
          Investigating — following evidence across Ads, GA4, and CRM
        </p>
      </div>
      {lines.length > 0 && (
        <div className="space-y-1">
          {lines.slice(-6).map((l, i) => (
            <p key={i} className="text-xs" style={{ color: 'var(--color-muted)', fontFamily: 'monospace' }}>
              › {l}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── History ───────────────────────────────────────────────────────────────────

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
        <div
          key={r.id}
          className="rounded-xl border p-3 flex items-start justify-between gap-3"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
        >
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>
              {r.result?.anomalyDescription ?? 'Investigation'}
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
              {fmtDate(r.run_at)}
              {r.result?.startDate && r.result?.endDate
                ? ` · ${fmtDate(r.result.startDate)} – ${fmtDate(r.result.endDate)}`
                : ''}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span
              className="text-xs font-semibold rounded px-2 py-0.5"
              style={{
                background: r.status === 'complete' ? '#dcfce7' : r.status === 'needs_review' ? '#fef9c3' : '#fee2e2',
                color:      r.status === 'complete' ? '#15803d' : r.status === 'needs_review' ? '#854d0e' : '#b91c1c',
              }}
            >
              {r.status}
            </span>
            {(r.status === 'complete' || r.status === 'needs_review') && r.result && (
              <button
                onClick={() => onLoad(r.result)}
                className="text-xs rounded px-2.5 py-1 font-medium"
                style={{
                  background: 'none',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-muted)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
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

export default function AnomalyInvestigatorPage() {
  const today = isoDate(new Date());
  const thirtyDaysAgo = isoDate(new Date(Date.now() - 30 * 86_400_000));

  const [anomalyDescription, setAnomalyDescription] = useState('');
  const [useRange,           setUseRange]           = useState(false);
  const [startDate,          setStartDate]          = useState(thirtyDaysAgo);
  const [endDate,            setEndDate]            = useState(today);
  const [running,            setRunning]            = useState(false);
  const [progress,           setProgress]           = useState([]);
  const [error,              setError]              = useState('');
  const [result,             setResult]             = useState(null);
  const [activeTab,          setActiveTab]          = useState('investigate');

  // Warn before leaving mid-run
  useEffect(() => {
    const handler = (e) => { if (running) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [running]);

  async function handleRun() {
    if (!anomalyDescription.trim()) {
      setError('Describe the anomaly before running.');
      return;
    }
    if (useRange && new Date(startDate) > new Date(endDate)) {
      setError('Start date must be before end date.');
      return;
    }

    setRunning(true);
    setProgress([]);
    setError('');
    setResult(null);

    const body = { anomalyDescription: anomalyDescription.trim() };
    if (useRange) {
      body.startDate = startDate;
      body.endDate   = endDate;
    }

    try {
      const res     = await api.stream(`/agents/${AGENT_SLUG}/run`, body);
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
          if (raw === '[DONE]') {
            setRunning(false);
            if (resultReceived) setActiveTab('investigate');
            return;
          }
          try {
            const msg = JSON.parse(raw);
            if (msg.type === 'progress') {
              setProgress((p) => [...p, msg.text]);
            } else if (msg.type === 'result') {
              resultReceived = true;
              setResult(msg.data);
            } else if (msg.type === 'error') {
              setError(msg.error);
            }
          } catch {
            // ignore malformed SSE lines
          }
        }
      }

      if (!resultReceived) {
        setError('Investigation ended without a result — check server logs.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  }

  const summary    = result?.summary ?? '';
  const boundsFail = result?.boundsFailed ?? [];

  const tabBtn = (tab, label) => (
    <button
      key={tab}
      onClick={() => setActiveTab(tab)}
      style={{
        padding: '0.35rem 0.85rem', fontSize: '0.8rem', fontWeight: 500,
        fontFamily: 'inherit', borderRadius: '0.5rem', cursor: 'pointer', border: 'none',
        background: activeTab === tab ? 'var(--color-primary)' : 'transparent',
        color:      activeTab === tab ? '#fff' : 'var(--color-muted)',
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="p-5 max-w-5xl mx-auto" style={{ fontFamily: 'inherit' }}>

      {/* Header */}
      <div className="mb-5">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
          Anomaly Investigator
        </h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
          Hypothesis-driven investigation across Google Ads, GA4, and CRM. No conclusions — the agent writes the log, you draw the verdict.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4">
        {tabBtn('investigate', 'Investigate')}
        {tabBtn('history',     'History')}
      </div>

      {/* ── Investigate tab ─────────────────────────────────────────────────── */}
      {activeTab === 'investigate' && (
        <div>
          {/* Input panel */}
          <div
            className="rounded-2xl border p-5 mb-4"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
          >
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text)' }}>
              Describe the anomaly
            </label>
            <textarea
              value={anomalyDescription}
              onChange={(e) => setAnomalyDescription(e.target.value)}
              placeholder="e.g. CTR dropped ~30% over the last 7 days across all campaigns. Conversions held flat but cost per click rose. Started around May 25."
              rows={4}
              style={{
                ...inputStyle,
                width: '100%',
                resize: 'vertical',
                lineHeight: 1.6,
                padding: '0.6rem 0.75rem',
              }}
              disabled={running}
            />

            {/* Optional date range */}
            <div className="mt-3 flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-muted)' }}>
                <input
                  type="checkbox"
                  checked={useRange}
                  onChange={(e) => setUseRange(e.target.checked)}
                  disabled={running}
                  style={{ accentColor: 'var(--color-primary)' }}
                />
                Set date range
              </label>
              {useRange && (
                <>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs" style={{ color: 'var(--color-muted)' }}>From</span>
                    <input
                      type="date" value={startDate} max={endDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      style={{ ...inputStyle, fontSize: '0.8rem' }}
                      disabled={running}
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs" style={{ color: 'var(--color-muted)' }}>To</span>
                    <input
                      type="date" value={endDate} min={startDate} max={today}
                      onChange={(e) => setEndDate(e.target.value)}
                      style={{ ...inputStyle, fontSize: '0.8rem' }}
                      disabled={running}
                    />
                  </div>
                </>
              )}
              {!useRange && (
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  Default: last 30 days (agent infers specific window from your description)
                </span>
              )}
            </div>

            <div className="mt-4">
              <button onClick={handleRun} disabled={running} style={btnPrimary(running)}>
                {running ? 'Investigating…' : 'Investigate'}
              </button>
            </div>
          </div>

          {error && (
            <InlineBanner type="error" message={error} onDismiss={() => setError('')} className="mb-4" />
          )}

          {running && <InvestigationProgress lines={progress} />}

          {/* Result */}
          {summary && !running && (
            <div
              className="rounded-2xl border p-5"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
            >
              {boundsFail.length > 0 && (
                <BoundsWarningPanel boundsFailed={boundsFail} />
              )}

              <MarkdownRenderer text={summary} />

              <div className="mt-4 flex items-center gap-2 flex-wrap">
                <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>Export:</span>
                <button
                  onClick={() => exportText({
                    content:  `Anomaly Investigation\n${result?.anomalyDescription ?? ''}\n\n${summary}`,
                    filename: `anomaly-investigation-${isoDate(new Date())}.txt`,
                  })}
                  style={{
                    padding: '0.3rem 0.75rem', fontSize: '0.75rem', fontWeight: 500,
                    fontFamily: 'inherit', borderRadius: '0.5rem', cursor: 'pointer',
                    border: '1px solid var(--color-border)',
                    background: 'transparent', color: 'var(--color-muted)',
                  }}
                >
                  Text
                </button>
                <button
                  onClick={async () => {
                    await exportPdf({
                      content:  summary,
                      title:    `Anomaly Investigation · ${isoDate(new Date())}`,
                      filename: `anomaly-investigation-${isoDate(new Date())}.pdf`,
                    });
                  }}
                  style={{
                    padding: '0.3rem 0.75rem', fontSize: '0.75rem', fontWeight: 500,
                    fontFamily: 'inherit', borderRadius: '0.5rem', cursor: 'pointer',
                    border: '1px solid var(--color-border)',
                    background: 'transparent', color: 'var(--color-muted)',
                  }}
                >
                  PDF
                </button>
              </div>
            </div>
          )}

          {!summary && !running && !error && (
            <div
              className="rounded-2xl border p-8 text-center"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
            >
              <p style={{ color: 'var(--color-muted)', fontSize: '0.875rem' }}>
                Describe the anomaly above and click <strong>Investigate</strong>. The agent will pull initial data,
                form hypotheses from what it finds, and follow the evidence — stopping when confident or when hypotheses are exhausted.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── History tab ─────────────────────────────────────────────────────── */}
      {activeTab === 'history' && (
        <div
          className="rounded-2xl border p-4"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
        >
          <RunHistory
            onLoad={(r) => {
              setResult(r);
              if (r.anomalyDescription) setAnomalyDescription(r.anomalyDescription);
              setActiveTab('investigate');
            }}
          />
        </div>
      )}
    </div>
  );
}
