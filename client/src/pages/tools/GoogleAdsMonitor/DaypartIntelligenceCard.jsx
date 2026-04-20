/**
 * DaypartIntelligenceCard — chart-focused accordion card for the Daypart Intelligence agent.
 *
 * Renders heatmaps (enquiry volume + paid-only, day x hour) and bar charts
 * (enquiries and close rate by day-of-week and hour-of-day).
 */
import { useState, useEffect } from 'react';
import api from '../../../api/client';
import Button from '../../../components/ui/Button';
import MarkdownRenderer from '../../../components/ui/MarkdownRenderer';
import HeatmapGrid from '../../../components/charts/HeatmapGrid';
import BarChart from '../../../components/charts/BarChart';

const SLUG = 'daypart-intelligence';

const fmtDate = (s) => {
  if (!s) return '—';
  try { return new Date(s).toLocaleString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return s; }
};
const fmtDay = (s) => {
  if (!s) return '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
};
const fmtAud = (n) => `$${Number(n ?? 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS_COLOR = { complete: '#16a34a', error: '#dc2626', running: '#d97706' };

const sectionLabel = (text) => (
  <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
    {text}
  </p>
);

const chartPanel = (children) => (
  <div style={{
    borderRadius: 10, border: '1px solid var(--color-border)',
    background: 'var(--color-bg)', padding: '14px 16px',
  }}>
    {children}
  </div>
);

export default function DaypartIntelligenceCard({ startDate, endDate, expanded, onToggle, onContinueInConversation }) {
  const [runs,         setRuns]         = useState([]);
  const [runIndex,     setRunIndex]     = useState(0);
  const [running,      setRunning]      = useState(false);
  const [lines,        setLines]        = useState([]);
  const [error,        setError]        = useState('');
  const [copied,       setCopied]       = useState(false);

  useEffect(() => { loadHistory(); }, []);

  async function loadHistory() {
    try {
      const rows = await api.get(`/agents/${SLUG}/history`);
      const complete = (rows ?? []).filter((r) => r.status === 'complete');
      setRuns(complete);
      setRunIndex(0);
    } catch { /* non-fatal */ }
  }

  const currentRun = runs[runIndex] ?? null;
  const result     = currentRun?.result ?? null;
  const summary    = result?.summary ?? '';
  const charts     = result?.data?.charts ?? null;
  const stats      = charts?.summary_stats ?? null;

  async function handleRun() {
    setRunning(true);
    setLines([]);
    setError('');

    try {
      const res = await api.stream(`/agents/${SLUG}/run`, { startDate, endDate });
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n');
        buffer = parts.pop();

        for (const line of parts) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') { setRunning(false); await loadHistory(); return; }
          try {
            const msg = JSON.parse(raw);
            if (msg.type === 'progress') setLines((l) => [...l, msg.text]);
            else if (msg.type === 'result') { if (onToggle && !expanded) onToggle(); }
            else if (msg.type === 'error')  setError(msg.error);
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
      loadHistory();
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(summary).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  function handleDiscuss() {
    if (!onContinueInConversation || !summary) return;
    const dateLabel = result?.startDate && result?.endDate
      ? `${fmtDay(result.startDate)} - ${fmtDay(result.endDate)}`
      : currentRun?.run_at ? `run ${fmtDate(currentRun.run_at)}` : '';
    onContinueInConversation(`I'd like to discuss the Daypart Intelligence report${dateLabel ? ` (${dateLabel})` : ''}:\n\n${summary}`);
  }

  const summarySnippet = summary.replace(/#{1,3}\s/g, '').slice(0, 140).trim();
  const status    = running ? 'running' : (currentRun?.status ?? null);
  const runCost   = result?.costAud ?? null;
  const hasResult = !!result;
  const totalRuns = runs.length;

  const actionBtnStyle = {
    fontSize: 11, padding: '3px 10px', borderRadius: 6, fontFamily: 'inherit',
    border: '1px solid var(--color-border)', background: 'transparent',
    color: 'var(--color-muted)', cursor: 'pointer',
  };
  const navBtnStyle = {
    fontSize: 13, lineHeight: 1, padding: '2px 6px', borderRadius: 4, fontFamily: 'inherit',
    border: '1px solid var(--color-border)', background: 'transparent',
    color: 'var(--color-muted)', cursor: 'pointer',
  };

  return (
    <div style={{ borderRadius: 16, border: '1px solid var(--color-border)', background: 'var(--color-surface)', overflow: 'hidden', fontFamily: 'inherit' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>

          <button onClick={onToggle} style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
              <span style={{ fontSize: 13, color: 'var(--color-muted)', lineHeight: 1 }}>{expanded ? '▼' : '▶'}</span>
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', margin: 0, fontFamily: 'inherit' }}>
                Daypart Intelligence
              </p>
              {status && (
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 99,
                  background: `${STATUS_COLOR[status]}20`, color: STATUS_COLOR[status],
                  fontFamily: 'inherit', textTransform: 'uppercase', letterSpacing: '0.04em',
                }}>
                  {status}
                </span>
              )}
            </div>
            <p style={{ fontSize: 12, color: 'var(--color-muted)', margin: '0 0 0 21px', fontFamily: 'inherit' }}>
              {!expanded && summarySnippet
                ? <>{summarySnippet}{summary.length > 140 ? '…' : ''}</>
                : 'Enquiry volume and close rate by day-of-week and hour-of-day. Minimum 90-day window for reliable patterns.'
              }
            </p>
          </button>

          <Button variant="primary" onClick={handleRun} disabled={running}
            style={{ flexShrink: 0, fontSize: 12, padding: '5px 14px' }}>
            {running ? 'Running…' : 'Run now'}
          </Button>
        </div>

        {running && (
          <div style={{ marginTop: 10 }}>
            <style>{`@keyframes _dp_slide{0%{left:-45%}100%{left:110%}}`}</style>
            {lines.length > 0 && (
              <p style={{ fontSize: 11, color: 'var(--color-muted)', marginBottom: 6, fontFamily: 'inherit' }}>
                <span style={{ color: 'var(--color-primary)', marginRight: 4 }}>›</span>
                {lines[lines.length - 1]}
              </p>
            )}
            <div style={{ position: 'relative', height: 3, borderRadius: 2, overflow: 'hidden', background: 'var(--color-border)' }}>
              <div style={{
                position: 'absolute', top: 0, height: '100%', width: '45%',
                background: 'var(--color-primary)', borderRadius: 2,
                animation: '_dp_slide 1.4s ease-in-out infinite',
              }} />
            </div>
          </div>
        )}

        {error && <p style={{ fontSize: 11, color: '#dc2626', marginTop: 6, fontFamily: 'inherit' }}>{error}</p>}

        {!expanded && currentRun && !running && (
          <p style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 6, marginLeft: 21, fontFamily: 'inherit' }}>
            {result?.startDate && result?.endDate
              ? <>{fmtDay(result.startDate)} – {fmtDay(result.endDate)}</>
              : <>Run {fmtDate(currentRun.run_at)}</>
            }
            {runCost != null && <span> · {fmtAud(runCost)}</span>}
            {stats && <span> · {stats.totalEnquiries} enquiries, {stats.totalPaid} paid</span>}
            {totalRuns > 1 && <span> · {totalRuns} runs</span>}
          </p>
        )}
      </div>

      {/* ── Expanded body ───────────────────────────────────────────────────── */}
      {expanded && hasResult && (
        <div style={{ borderTop: '1px solid var(--color-border)', padding: '16px' }}>

          {/* Action bar */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <button onClick={handleCopy} style={actionBtnStyle}>{copied ? 'Copied!' : 'Copy'}</button>
            {onContinueInConversation && (
              <button onClick={handleDiscuss}
                style={{ ...actionBtnStyle, color: 'var(--color-primary)', borderColor: 'var(--color-primary)' }}>
                Discuss
              </button>
            )}
            {totalRuns > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <button onClick={() => setRunIndex((i) => Math.min(i + 1, totalRuns - 1))} disabled={runIndex >= totalRuns - 1}
                  style={{ ...navBtnStyle, opacity: runIndex >= totalRuns - 1 ? 0.35 : 1 }}>‹</button>
                <span style={{ fontSize: 11, color: 'var(--color-muted)', whiteSpace: 'nowrap' }}>
                  {runIndex + 1} / {totalRuns}
                </span>
                <button onClick={() => setRunIndex((i) => Math.max(i - 1, 0))} disabled={runIndex === 0}
                  style={{ ...navBtnStyle, opacity: runIndex === 0 ? 0.35 : 1 }}>›</button>
              </div>
            )}
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-muted)', fontFamily: 'inherit' }}>
              {result?.startDate && result?.endDate
                ? <>{fmtDay(result.startDate)} – {fmtDay(result.endDate)}</>
                : currentRun?.run_at ? <>Run {fmtDate(currentRun.run_at)}</> : null
              }
              {runCost != null && <span> · {fmtAud(runCost)}</span>}
            </span>
          </div>

          {/* Stats strip */}
          {stats && (
            <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
              {[
                { label: 'Total enquiries', value: stats.totalEnquiries },
                { label: 'Paid (cpc)',      value: stats.totalPaid },
                { label: 'Organic/other',   value: stats.totalOrganic },
                { label: 'Close rate',      value: stats.overallCloseRate != null ? `${stats.overallCloseRate}%` : '—' },
              ].map(({ label, value }) => (
                <div key={label} style={{ flex: '0 0 auto' }}>
                  <p style={{ fontSize: 10, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 2px' }}>{label}</p>
                  <p style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text)', margin: 0, fontFamily: 'inherit' }}>{value}</p>
                </div>
              ))}
            </div>
          )}

          {charts && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Row 1: Heatmaps */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {chartPanel(
                  <>
                    {sectionLabel('All enquiries — day × hour')}
                    <HeatmapGrid data={charts.enquiryHeatmap} />
                  </>
                )}
                {chartPanel(
                  <>
                    {sectionLabel('Paid (cpc) enquiries — day × hour')}
                    <HeatmapGrid data={charts.paidHeatmap} />
                  </>
                )}
              </div>

              {/* Row 2: Enquiry volume by day */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {chartPanel(
                  <>
                    {sectionLabel('Enquiries by day of week')}
                    <BarChart data={charts.enquiryByDay} dataKey="value" height={180}
                      formatValue={(v) => String(Math.round(v))} />
                  </>
                )}
                {chartPanel(
                  <>
                    {sectionLabel('Paid enquiries by day of week')}
                    <BarChart data={charts.paidByDay} dataKey="value" height={180}
                      colors={['#10b981']}
                      formatValue={(v) => String(Math.round(v))} />
                  </>
                )}
              </div>

              {/* Row 3: Close rate by day */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {chartPanel(
                  <>
                    {sectionLabel('Close rate by day (all channels)')}
                    <BarChart
                      data={charts.closeRateByDay.map((d) => ({ ...d, displayRate: d.rate ?? 0 }))}
                      dataKey="displayRate"
                      height={180}
                      colors={['#6366f1']}
                      formatValue={(v) => `${v}%`}
                    />
                  </>
                )}
                {chartPanel(
                  <>
                    {sectionLabel('Close rate by day (paid only)')}
                    <BarChart
                      data={charts.paidCloseRateByDay.map((d) => ({ ...d, displayRate: d.rate ?? 0 }))}
                      dataKey="displayRate"
                      height={180}
                      colors={['#f59e0b']}
                      formatValue={(v) => `${v}%`}
                    />
                  </>
                )}
              </div>

              {/* Row 4: By hour (horizontal, all 24 hours) */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {chartPanel(
                  <>
                    {sectionLabel('Enquiries by hour of day')}
                    <BarChart
                      data={charts.enquiryByHour}
                      dataKey="value"
                      horizontal
                      height={340}
                      formatValue={(v) => String(Math.round(v))}
                    />
                  </>
                )}
                {chartPanel(
                  <>
                    {sectionLabel('Close rate by hour (all channels)')}
                    <BarChart
                      data={charts.closeRateByHour.map((d) => ({ ...d, displayRate: d.rate ?? 0 }))}
                      dataKey="displayRate"
                      horizontal
                      height={340}
                      colors={['#6366f1']}
                      formatValue={(v) => `${v}%`}
                    />
                  </>
                )}
              </div>

            </div>
          )}

          {/* Claude narrative */}
          {summary && (
            <div style={{ marginTop: 20 }}>
              <MarkdownRenderer text={summary} />
            </div>
          )}
        </div>
      )}

      {expanded && !hasResult && !running && (
        <div style={{ borderTop: '1px solid var(--color-border)', padding: '24px 16px', textAlign: 'center' }}>
          <p style={{ fontSize: 13, color: 'var(--color-muted)', fontFamily: 'inherit' }}>
            No results yet — click "Run now" to analyse enquiry timing patterns.
          </p>
        </div>
      )}
    </div>
  );
}
