/**
 * DiamondPlate Data — CRM lead intelligence tool.
 *
 * Analyses WordPress CRM enquiries cross-referenced with GA4 traffic and
 * landing page data. Covers channel attribution, device breakdown, search
 * term conversion, and not-interested reason analysis.
 *
 * Date filter: D · W · M · Qtr · Year · Custom
 */
import { useState, useEffect } from 'react';
import api from '../../api/client';
import MarkdownRenderer from '../../components/ui/MarkdownRenderer';
import InlineBanner from '../../components/ui/InlineBanner';
import ConversationView from './GoogleAdsMonitor/ConversationView';
import { fmtDate } from '../../utils/date';

const AGENT_SLUG = 'diamondplate-data';

// ── Date helpers ──────────────────────────────────────────────────────────────

function isoDate(d) { return d.toISOString().slice(0, 10); }

function startOfWeek() {
  const d   = new Date();
  const day = d.getDay();                   // 0 = Sun
  const diff = day === 0 ? 6 : day - 1;    // days back to Monday
  d.setDate(d.getDate() - diff);
  return isoDate(d);
}

function startOfMonth() {
  const d = new Date();
  return isoDate(new Date(d.getFullYear(), d.getMonth(), 1));
}

function startOfQuarter() {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3);
  return isoDate(new Date(d.getFullYear(), q * 3, 1));
}

function startOfYear() {
  return `${new Date().getFullYear()}-01-01`;
}

const PRESETS = [
  { label: 'D',      key: 'd',      getRange: () => ({ start: isoDate(new Date()), end: isoDate(new Date()) }) },
  { label: 'W',      key: 'w',      getRange: () => ({ start: startOfWeek(),        end: isoDate(new Date()) }) },
  { label: 'M',      key: 'm',      getRange: () => ({ start: startOfMonth(),       end: isoDate(new Date()) }) },
  { label: 'Qtr',    key: 'qtr',    getRange: () => ({ start: startOfQuarter(),     end: isoDate(new Date()) }) },
  { label: 'Year',   key: 'year',   getRange: () => ({ start: startOfYear(),        end: isoDate(new Date()) }) },
  { label: 'Custom', key: 'custom', getRange: null },
];

const DEFAULT_PRESET = PRESETS.find((p) => p.key === 'm');

// ── Styles ────────────────────────────────────────────────────────────────────

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

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ lines }) {
  return (
    <div
      className="rounded-xl border p-4 mb-4"
      style={{ borderColor: 'var(--color-primary)', background: 'var(--color-surface)' }}
    >
      <style>{`@keyframes _dp_slide { 0%{left:-45%} 100%{left:110%} }`}</style>
      <p className="text-xs font-medium mb-2" style={{ color: 'var(--color-text)' }}>
        Analysing lead data — this typically takes 30–60 seconds.
        <span style={{ color: 'var(--color-muted)' }}> Please don't navigate away.</span>
      </p>
      <div style={{ position: 'relative', height: 4, borderRadius: 2, overflow: 'hidden', background: 'var(--color-border)' }}>
        <div style={{
          position: 'absolute', top: 0, height: '100%', width: '45%',
          background: 'var(--color-primary)', borderRadius: 2,
          animation: '_dp_slide 1.4s ease-in-out infinite',
        }} />
      </div>
      {lines.length > 0 && (
        <div className="mt-3 space-y-0.5">
          {lines.slice(-4).map((l, i) => (
            <p key={i} className="text-xs" style={{ color: 'var(--color-muted)' }}>
              <span style={{ color: 'var(--color-primary)', marginRight: 6 }}>›</span>{l}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Run history list ──────────────────────────────────────────────────────────

function RunHistory({ onLoad }) {
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchErr, setFetchErr] = useState('');

  useEffect(() => {
    api.get(`/agents/${AGENT_SLUG}/history`)
      .then(setRows)
      .catch((e) => setFetchErr(e.message || 'Failed to load history'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-sm py-4" style={{ color: 'var(--color-muted)' }}>Loading history…</p>;
  if (fetchErr) return <p className="text-sm py-4" style={{ color: '#b91c1c' }}>Error: {fetchErr}</p>;
  if (!rows.length) return <p className="text-sm py-4" style={{ color: 'var(--color-muted)' }}>No runs yet.</p>;

  return (
    <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ background: 'var(--color-surface)' }}>
          {['Date', 'Period', 'Status', ''].map((h) => (
            <th key={h} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider"
              style={{ color: 'var(--color-muted)', borderBottom: '1px solid var(--color-border)' }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} style={{ borderTop: '1px solid var(--color-border)' }}>
            <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-muted)' }}>
              {fmtDate(r.run_at)}
            </td>
            <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-text)' }}>
              {r.result?.startDate && r.result?.endDate
                ? `${fmtDate(r.result.startDate)} – ${fmtDate(r.result.endDate)}`
                : '—'}
            </td>
            <td className="px-3 py-2">
              <span
                className="text-xs font-semibold rounded px-2 py-0.5"
                style={{
                  background: r.status === 'complete' ? '#dcfce7' : r.status === 'error' ? '#fee2e2' : '#fef9c3',
                  color:      r.status === 'complete' ? '#15803d' : r.status === 'error' ? '#b91c1c' : '#854d0e',
                }}
              >
                {r.status}
              </span>
            </td>
            <td className="px-3 py-2 text-right">
              {r.status === 'complete' && r.result && (
                <button
                  onClick={() => onLoad(r.result)}
                  className="text-xs rounded px-2.5 py-1 font-medium"
                  style={{
                    background: 'none',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-muted)',
                    cursor: 'pointer',
                  }}
                >
                  Load
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DiamondPlateDataPage() {
  const initialRange = DEFAULT_PRESET.getRange();
  const [startDate,    setStartDate]    = useState(initialRange.start);
  const [endDate,      setEndDate]      = useState(initialRange.end);
  const [activePreset, setActivePreset] = useState(DEFAULT_PRESET.key);
  const [running,          setRunning]          = useState(false);
  const [progress,         setProgress]         = useState([]);
  const [error,            setError]            = useState('');
  const [runError,         setRunError]         = useState('');
  const [result,           setResult]           = useState(null);
  const [activeTab,        setActiveTab]        = useState('report');
  const [conversationSeed, setConversationSeed] = useState('');

  // Warn before leaving mid-run
  useEffect(() => {
    const handler = (e) => { if (running) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [running]);

  // Load most recent completed run on mount
  useEffect(() => {
    api.get(`/agents/${AGENT_SLUG}/history`)
      .then((rows) => {
        const latest = rows?.find((r) => r.status === 'complete');
        if (latest?.result && !result) setResult(latest.result);
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function applyPreset(preset) {
    setActivePreset(preset.key);
    if (preset.getRange) {
      const { start, end } = preset.getRange();
      setStartDate(start);
      setEndDate(end);
    }
  }

  function onDateChange(field, value) {
    setActivePreset('custom');
    if (field === 'start') setStartDate(value);
    else setEndDate(value);
  }

  async function handleRun() {
    if (new Date(startDate) > new Date(endDate)) {
      setError('Start date must be before end date.');
      return;
    }
    setRunning(true);
    setProgress([]);
    setError('');
    setRunError('');

    try {
      const res     = await api.stream(`/agents/${AGENT_SLUG}/run`, { startDate, endDate });
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let resultReceived = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.warn('[DiamondPlate] stream closed by server. resultReceived:', resultReceived, 'buffer remainder:', buffer);
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') {
            console.log('[DiamondPlate] [DONE] received. resultReceived:', resultReceived);
            setRunning(false);
            setActiveTab('report');
            return;
          }
          try {
            const msg = JSON.parse(raw);
            console.log('[DiamondPlate] SSE msg type:', msg.type, msg.type === 'result' ? `summary length: ${msg.data?.summary?.length}` : msg.type === 'error' ? msg.error : '');
            if (msg.type === 'progress') {
              setProgress((p) => [...p, msg.text]);
            } else if (msg.type === 'result') {
              resultReceived = true;
              if (!msg.data?.summary) {
                console.error('[DiamondPlate] result received but summary is empty/missing. Full data keys:', Object.keys(msg.data || {}));
                setRunError('Run completed but the report summary was empty. Check the browser console and server logs.');
              }
              setResult(msg.data);
              setActiveTab('report');
            } else if (msg.type === 'error') {
              console.error('[DiamondPlate] server error event:', msg.error);
              setError(msg.error);
              setRunError(msg.error);
            }
          } catch (parseErr) {
            console.error('[DiamondPlate] failed to parse SSE line:', parseErr.message, '\nRaw (first 200):', raw.slice(0, 200));
          }
        }
      }

      // Stream closed without [DONE]
      if (!resultReceived) {
        const msg = 'Stream ended without a result. The run may have crashed on the server — check Railway logs.';
        console.error('[DiamondPlate]', msg);
        setRunError(msg);
      }
    } catch (err) {
      console.error('[DiamondPlate] stream error:', err.message);
      setError(err.message);
    } finally {
      setRunning(false);
    }
  }

  const summary = result?.summary ?? result?.result ?? '';

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
    <div className="p-5 max-w-7xl mx-auto" style={{ fontFamily: 'inherit' }}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
            DiamondPlate Data
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
            CRM lead intelligence — channel attribution, device breakdown, and conversion analysis.
          </p>
        </div>

        {/* Date controls — all on one row */}
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {/* Preset pills */}
          <div
            className="flex gap-0.5 rounded-lg p-1"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          >
            {PRESETS.map((p) => (
              <button
                key={p.key}
                onClick={() => applyPreset(p)}
                style={{
                  padding: '3px 9px', fontSize: 12, borderRadius: 6, border: 'none',
                  cursor: 'pointer', fontFamily: 'inherit',
                  background: activePreset === p.key ? 'var(--color-primary)' : 'transparent',
                  color:      activePreset === p.key ? '#fff' : 'var(--color-muted)',
                  fontWeight: activePreset === p.key ? 600 : 400,
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Date pickers */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>From</span>
            <input
              key={`start-${startDate}`}
              type="date"
              value={startDate}
              max={endDate}
              onChange={(e) => onDateChange('start', e.target.value)}
              style={{ ...inputStyle, fontSize: '0.8rem' }}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>To</span>
            <input
              key={`end-${endDate}`}
              type="date"
              value={endDate}
              min={startDate}
              max={isoDate(new Date())}
              onChange={(e) => onDateChange('end', e.target.value)}
              style={{ ...inputStyle, fontSize: '0.8rem' }}
            />
          </div>

          <button
            onClick={handleRun}
            disabled={running}
            style={{
              padding: '0.4rem 1rem', fontSize: '0.875rem', fontWeight: 600,
              fontFamily: 'inherit', borderRadius: '0.5rem', border: 'none',
              background: running ? 'var(--color-border)' : 'var(--color-primary)',
              color: '#fff', cursor: running ? 'not-allowed' : 'pointer',
            }}
          >
            {running ? 'Running…' : 'Run'}
          </button>
        </div>
      </div>

      {error && (
        <InlineBanner type="error" message={error} onDismiss={() => setError('')} className="mb-4" />
      )}

      {running && <ProgressBar lines={progress} />}

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 mb-4">
        {tabBtn('report',       'Report')}
        {tabBtn('conversation', 'Conversation')}
        {tabBtn('history',      'History')}
      </div>

      {/* ── Report ─────────────────────────────────────────────────────── */}
      {activeTab === 'report' && (
        <div
          className="rounded-2xl border p-5"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
        >
          {runError && !running && (
            <div
              className="rounded-xl p-4 mb-4"
              style={{ background: '#fee2e2', border: '1px solid #fca5a5' }}
            >
              <p className="text-sm font-semibold mb-1" style={{ color: '#b91c1c' }}>Run failed</p>
              <p className="text-sm" style={{ color: '#7f1d1d', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                {runError}
              </p>
            </div>
          )}
          {!summary && !runError && !running && (
            <p className="text-sm py-6 text-center" style={{ color: 'var(--color-muted)' }}>
              Select a date range and click <strong>Run</strong> to generate a lead intelligence report.
            </p>
          )}
          {summary && (
            <>
              <MarkdownRenderer text={summary} />
              <div className="mt-4 flex items-center justify-between flex-wrap gap-2">
                {/* Export buttons */}
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>Export:</span>
                  <button
                    onClick={() => {
                      const blob = new Blob([summary], { type: 'text/plain' });
                      const url  = URL.createObjectURL(blob);
                      const a    = document.createElement('a');
                      a.href     = url;
                      a.download = `diamondplate-report-${result?.startDate ?? startDate}-${result?.endDate ?? endDate}.txt`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                    }}
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
                    onClick={() => {
                      const escaped = summary
                        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                        .replace(/\n/g, '<br>');
                      const period = `${result?.startDate ?? startDate} – ${result?.endDate ?? endDate}`;
                      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>DiamondPlate Report · ${period}</title>
<style>body{font-family:Georgia,serif;max-width:800px;margin:0 auto;padding:24px;color:#111}
h1{font-size:18px;margin-bottom:4px}p.meta{font-size:12px;color:#666;margin-bottom:24px}
pre{white-space:pre-wrap;font-family:inherit;font-size:14px;line-height:1.7}
@media print{body{padding:0}}</style>
</head><body>
<h1>DiamondPlate Data Report</h1>
<p class="meta">${period} · Exported ${new Date().toLocaleString('en-AU')}</p>
<pre>${escaped}</pre>
</body></html>`;
                      const win = window.open('', '_blank');
                      if (!win) return;
                      win.document.write(html);
                      win.document.close();
                      win.focus();
                      setTimeout(() => win.print(), 400);
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

                {/* Discuss button */}
                <button
                  onClick={() => {
                    setConversationSeed(`Here is the DiamondPlate Data report for ${result?.startDate ?? startDate} to ${result?.endDate ?? endDate}:\n\n${summary}`);
                    setActiveTab('conversation');
                  }}
                  style={{
                    padding: '0.35rem 0.9rem', fontSize: '0.8rem', fontWeight: 500,
                    fontFamily: 'inherit', borderRadius: '0.5rem', cursor: 'pointer',
                    border: '1px solid var(--color-border)',
                    background: 'transparent', color: 'var(--color-muted)',
                  }}
                >
                  Discuss this report
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Conversation ───────────────────────────────────────────────── */}
      {activeTab === 'conversation' && (
        <ConversationView
          startDate={startDate}
          endDate={endDate}
          seedText={conversationSeed}
          onSeedConsumed={() => setConversationSeed('')}
          reportText={summary}
          reportTitle={`DiamondPlate Report · ${result?.startDate ?? startDate} – ${result?.endDate ?? endDate}`}
        />
      )}

      {/* ── History ────────────────────────────────────────────────────── */}
      {activeTab === 'history' && (
        <div
          className="rounded-2xl border p-4"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
        >
          <RunHistory
            onLoad={(r) => { setResult(r); setActiveTab('report'); }}
          />
        </div>
      )}
    </div>
  );
}
