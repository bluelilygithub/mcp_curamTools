/**
 * StrategicReviewCard — campaign strategy validation card.
 *
 * User enters free-form strategic observations. The agent validates each one
 * against live data and returns verdicts, evidence, and counter-proposals.
 *
 * Controlled expand/collapse — parent owns open state for accordion behaviour.
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
const fmtDay = (s) => {
  if (!s) return '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
};

const STATUS_COLOR = { complete: '#16a34a', error: '#dc2626', running: '#d97706' };

const SLUG = 'google-ads-strategic-review';

const PLACEHOLDER =
  `Enter your strategic observations — one per line. Examples:\n` +
  `• Our mobile traffic has poor conversion rates compared to desktop\n` +
  `• The brand campaign is spending too much relative to its conversions\n` +
  `• Weekend performance is weaker than weekdays\n` +
  `• We are wasting budget on irrelevant search terms`;

export default function StrategicReviewCard({ startDate, endDate, expanded, onToggle, onContinueInConversation }) {
  const [observations, setObservations] = useState('');
  const [lastRun,      setLastRun]      = useState(null);
  const [running,      setRunning]      = useState(false);
  const [lines,        setLines]        = useState([]);
  const [result,       setResult]       = useState(null);
  const [error,        setError]        = useState('');
  const [copied,       setCopied]       = useState(false);

  useEffect(() => { loadLastRun(); }, []);

  async function loadLastRun() {
    try {
      const rows = await api.get(`/agents/${SLUG}/history`);
      const latest = rows?.find((r) => r.status === 'complete');
      if (latest) {
        setLastRun(latest);
        setResult(latest.result ?? null);
      }
    } catch { /* non-fatal */ }
  }

  async function handleRun() {
    if (!observations.trim()) {
      setError('Enter at least one observation before running.');
      return;
    }
    setRunning(true);
    setLines([]);
    setError('');

    try {
      const res = await api.stream(`/agents/${SLUG}/run`, { startDate, endDate, observations });
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
          if (raw === '[DONE]') { setRunning(false); loadLastRun(); return; }
          try {
            const msg = JSON.parse(raw);
            if (msg.type === 'progress') setLines((l) => [...l, msg.text]);
            else if (msg.type === 'result') { setResult(msg.data); if (onToggle && !expanded) onToggle(); }
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

  function handleCopy() {
    navigator.clipboard.writeText(result?.summary ?? '').then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const summary        = result?.summary ?? '';
  const summarySnippet = summary.replace(/#{1,3}\s/g, '').slice(0, 140).trim();
  const status         = running ? 'running' : (lastRun?.status ?? null);
  const runCost        = result?.costAud ?? lastRun?.result?.costAud ?? null;
  const hasResult      = !!result;

  const actionBtnStyle = {
    fontSize: 11, padding: '3px 10px', borderRadius: 6, fontFamily: 'inherit',
    border: '1px solid var(--color-border)', background: 'transparent',
    color: 'var(--color-muted)', cursor: 'pointer',
  };

  const textareaStyle = {
    width: '100%', boxSizing: 'border-box',
    padding: '10px 12px', borderRadius: 8,
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg)', color: 'var(--color-text)',
    fontSize: 13, fontFamily: 'inherit', lineHeight: 1.6,
    resize: 'vertical', outline: 'none',
  };

  return (
    <div style={{
      borderRadius: 16, border: '1px solid var(--color-border)',
      background: 'var(--color-surface)', overflow: 'hidden', fontFamily: 'inherit',
    }}>
      {/* ── Header (always visible) ─────────────────────────────────────── */}
      <div style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>

          {/* Toggle area */}
          <button
            onClick={onToggle}
            style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
              <span style={{ fontSize: 13, color: 'var(--color-muted)', lineHeight: 1 }}>
                {expanded ? '▼' : '▶'}
              </span>
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', margin: 0, fontFamily: 'inherit' }}>
                Strategic Review
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
                : 'Validate your campaign hypotheses against live data. Enter observations below.'
              }
            </p>
          </button>

          <Button variant="primary" onClick={handleRun} disabled={running || !observations.trim()}
            style={{ flexShrink: 0, fontSize: 12, padding: '5px 14px' }}>
            {running ? 'Running…' : 'Run now'}
          </Button>
        </div>

        {/* Observations textarea — always visible */}
        <div style={{ marginTop: 12, marginLeft: 21 }}>
          <textarea
            rows={4}
            value={observations}
            onChange={(e) => setObservations(e.target.value)}
            placeholder={PLACEHOLDER}
            style={textareaStyle}
          />
        </div>

        {/* Progress */}
        {running && (
          <div style={{ marginTop: 10 }}>
            <style>{`@keyframes _strat_slide{0%{left:-45%}100%{left:110%}}`}</style>
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
                animation: '_strat_slide 1.4s ease-in-out infinite',
              }} />
            </div>
          </div>
        )}

        {error && <p style={{ fontSize: 11, color: '#dc2626', marginTop: 6, marginLeft: 21, fontFamily: 'inherit' }}>{error}</p>}

        {/* Last run meta — collapsed only */}
        {!expanded && lastRun && !running && (
          <p style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 6, marginLeft: 21, fontFamily: 'inherit' }}>
            {result?.startDate && result?.endDate
              ? <>{fmtDay(result.startDate)} – {fmtDay(result.endDate)}</>
              : <>Run {fmtDate(lastRun.run_at)}</>
            }
            {runCost != null && <span> · {fmtAud(runCost)}</span>}
          </p>
        )}
      </div>

      {/* ── Expanded body ───────────────────────────────────────────────── */}
      {expanded && hasResult && (
        <div style={{ borderTop: '1px solid var(--color-border)', padding: '16px' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <button onClick={handleCopy} style={actionBtnStyle}>{copied ? 'Copied!' : 'Copy'}</button>
            {onContinueInConversation && (
              <button
                onClick={() => {
                  const seed = `Here are my strategic observations from a recent review:\n\n${observations}\n\nThe analysis returned:\n\n${summary}`;
                  onContinueInConversation(seed);
                }}
                style={{ ...actionBtnStyle, color: 'var(--color-primary)', borderColor: 'var(--color-primary)' }}
              >
                Continue in Conversation
              </button>
            )}
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-muted)', fontFamily: 'inherit' }}>
              {result?.startDate && result?.endDate
                ? <>{fmtDay(result.startDate)} – {fmtDay(result.endDate)}</>
                : lastRun?.run_at ? <>Run {fmtDate(lastRun.run_at)}</> : null
              }
              {runCost != null && <span> · {fmtAud(runCost)}</span>}
            </span>
          </div>
          <MarkdownRenderer text={summary} />
        </div>
      )}

      {expanded && !hasResult && !running && (
        <div style={{ borderTop: '1px solid var(--color-border)', padding: '24px 16px', textAlign: 'center' }}>
          <p style={{ fontSize: 13, color: 'var(--color-muted)', fontFamily: 'inherit' }}>
            Enter your observations above and click "Run now" to validate them against your data.
          </p>
        </div>
      )}
    </div>
  );
}
