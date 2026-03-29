/**
 * AgentDashboardCard — self-contained card for a Google Ads sub-agent.
 *
 * Props:
 *   slug        — agent slug e.g. 'google-ads-change-audit'
 *   title       — display name
 *   description — one-line description shown in the card header
 *   startDate   — ISO date string from the parent page's date range
 *   endDate     — ISO date string from the parent page's date range
 */
import { useState, useEffect } from 'react';
import api from '../../../api/client';
import Button from '../../../components/ui/Button';
import MarkdownRenderer from '../../../components/ui/MarkdownRenderer';

const fmtAud  = (n) => `$${Number(n ?? 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (s) => {
  if (!s) return '—';
  try { return new Date(s).toLocaleString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return s; }
};

const STATUS_COLOR = { complete: '#16a34a', error: '#dc2626', running: '#d97706' };

export default function AgentDashboardCard({ slug, title, description, startDate, endDate }) {
  const [lastRun,  setLastRun]  = useState(null);
  const [running,  setRunning]  = useState(false);
  const [lines,    setLines]    = useState([]);
  const [result,   setResult]   = useState(null);
  const [error,    setError]    = useState('');
  const [expanded, setExpanded] = useState(false);

  useEffect(() => { loadLastRun(); }, [slug]);

  async function loadLastRun() {
    try {
      const rows = await api.get(`/agents/${slug}/history`);
      const latest = rows?.find((r) => r.status === 'complete');
      if (latest) {
        setLastRun(latest);
        setResult(latest.result ?? null);
      }
    } catch { /* non-fatal */ }
  }

  async function handleRun() {
    setRunning(true);
    setLines([]);
    setError('');

    try {
      const res = await api.stream(`/agents/${slug}/run`, { startDate, endDate });
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
          if (raw === '[DONE]') {
            setRunning(false);
            loadLastRun();
            return;
          }
          try {
            const msg = JSON.parse(raw);
            if (msg.type === 'progress') setLines((l) => [...l, msg.text]);
            else if (msg.type === 'result') { setResult(msg.data); setExpanded(true); }
            else if (msg.type === 'error')  setError(msg.error);
          } catch { /* ignore malformed */ }
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
      loadLastRun();
    }
  }

  const summary = result?.summary ?? '';
  const summarySnippet = summary.replace(/#{1,3}\s/g, '').slice(0, 160).trim();
  const status  = running ? 'running' : (lastRun?.status ?? null);
  const runCost = result?.costAud ?? lastRun?.result?.costAud ?? null;

  return (
    <div style={{
      borderRadius: 16, border: '1px solid var(--color-border)',
      background: 'var(--color-surface)', overflow: 'hidden',
      fontFamily: 'inherit',
    }}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ padding: '14px 16px', borderBottom: expanded ? '1px solid var(--color-border)' : 'none' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', margin: 0, fontFamily: 'inherit' }}>
                {title}
              </p>
              {status && (
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 99,
                  background: `${STATUS_COLOR[status]}20`,
                  color: STATUS_COLOR[status],
                  fontFamily: 'inherit', textTransform: 'uppercase', letterSpacing: '0.04em',
                }}>
                  {status}
                </span>
              )}
            </div>
            <p style={{ fontSize: 12, color: 'var(--color-muted)', margin: 0, fontFamily: 'inherit' }}>
              {description}
            </p>
          </div>
          <Button variant="primary" onClick={handleRun} disabled={running}
            style={{ flexShrink: 0, fontSize: 12, padding: '5px 14px' }}>
            {running ? 'Running…' : 'Run now'}
          </Button>
        </div>

        {/* Meta row */}
        {(lastRun || running) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
            {lastRun && !running && (
              <>
                <span style={{ fontSize: 11, color: 'var(--color-muted)', fontFamily: 'inherit' }}>
                  Last run: {fmtDate(lastRun.run_at)}
                </span>
                {runCost != null && (
                  <span style={{ fontSize: 11, color: 'var(--color-muted)', fontFamily: 'inherit' }}>
                    {fmtAud(runCost)}
                  </span>
                )}
                {summarySnippet && (
                  <span style={{ fontSize: 11, color: 'var(--color-text)', fontFamily: 'inherit', flex: 1, minWidth: 0 }}>
                    {summarySnippet}{summary.length > 160 ? '…' : ''}
                  </span>
                )}
              </>
            )}

            {running && lines.length > 0 && (
              <span style={{ fontSize: 11, color: 'var(--color-muted)', fontFamily: 'inherit', flex: 1 }}>
                <span style={{ color: 'var(--color-primary)', marginRight: 4 }}>›</span>
                {lines[lines.length - 1]}
              </span>
            )}
          </div>
        )}

        {/* Inline progress bar when running */}
        {running && (
          <div style={{ marginTop: 8 }}>
            <style>{`@keyframes _card_slide{0%{left:-45%}100%{left:110%}}`}</style>
            <div style={{ position: 'relative', height: 3, borderRadius: 2, overflow: 'hidden', background: 'var(--color-border)' }}>
              <div style={{
                position: 'absolute', top: 0, height: '100%', width: '45%',
                background: 'var(--color-primary)', borderRadius: 2,
                animation: '_card_slide 1.4s ease-in-out infinite',
              }} />
            </div>
          </div>
        )}

        {error && (
          <p style={{ fontSize: 11, color: '#dc2626', marginTop: 6, fontFamily: 'inherit' }}>{error}</p>
        )}

        {/* Expand/collapse toggle */}
        {result && !running && (
          <button onClick={() => setExpanded((e) => !e)} style={{
            marginTop: 8, fontSize: 11, color: 'var(--color-primary)', background: 'none',
            border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit',
          }}>
            {expanded ? '▲ Hide result' : '▼ View full result'}
          </button>
        )}
      </div>

      {/* ── Expanded result ─────────────────────────────────────────────── */}
      {expanded && result && (
        <div style={{ padding: '16px', borderTop: '1px solid var(--color-border)' }}>
          <MarkdownRenderer text={result.summary ?? ''} />
          {result.costAud != null && (
            <p style={{ fontSize: 11, color: 'var(--color-muted)', textAlign: 'right', marginTop: 8, fontFamily: 'inherit' }}>
              Run cost: A${Number(result.costAud).toFixed(4)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
