/**
 * AgentDashboardCard — self-contained card for a Google Ads sub-agent.
 *
 * Controlled expand/collapse — parent owns the open state for accordion behaviour.
 *
 * Props:
 *   slug        — agent slug e.g. 'google-ads-change-audit'
 *   title       — display name
 *   description — one-line description shown in the card header
 *   startDate   — ISO date string from the parent page's date range
 *   endDate     — ISO date string from the parent page's date range
 *   expanded    — controlled: whether this card is open
 *   onToggle    — controlled: called when the user clicks expand/collapse
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

function printContent(title, text) {
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head>
    <title>${title}</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 800px; margin: 40px auto; color: #1e293b; line-height: 1.6; }
      h1 { font-size: 20px; margin-bottom: 4px; }
      h2, h3 { margin-top: 1.5em; }
      pre { background: #f8fafc; padding: 12px; border-radius: 6px; overflow-x: auto; }
      code { font-family: monospace; font-size: 0.9em; }
      table { border-collapse: collapse; width: 100%; }
      th, td { padding: 6px 10px; border: 1px solid #e2e8f0; text-align: left; }
      th { background: #f8fafc; }
    </style>
  </head><body>
    <h1>${title}</h1>
    <div>${text.replace(/### (.+)/g, '<h3>$1</h3>').replace(/## (.+)/g, '<h2>$1</h2>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>')}</div>
  </body></html>`);
  win.document.close();
  win.focus();
  win.print();
}

export default function AgentDashboardCard({ slug, title, description, startDate, endDate, expanded, onToggle }) {
  const [lastRun,      setLastRun]      = useState(null);
  const [running,      setRunning]      = useState(false);
  const [lines,        setLines]        = useState([]);
  const [result,       setResult]       = useState(null);
  const [error,        setError]        = useState('');
  const [copied,       setCopied]       = useState(false);
  const [emailModal,   setEmailModal]   = useState(false);
  const [emailTo,      setEmailTo]      = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailError,   setEmailError]   = useState('');

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

  function handlePrint() {
    printContent(title, result?.summary ?? '');
  }

  async function handleEmail() {
    if (!emailTo) return;
    setEmailSending(true);
    setEmailError('');
    try {
      await api.post(`/agents/${slug}/email`, { to: emailTo, result, startDate, endDate });
      setEmailModal(false);
    } catch (err) {
      setEmailError(err.message ?? 'Failed to send');
    } finally {
      setEmailSending(false);
    }
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

  return (
    <div style={{
      borderRadius: 16, border: '1px solid var(--color-border)',
      background: 'var(--color-surface)', overflow: 'hidden', fontFamily: 'inherit',
    }}>
      {/* ── Header (always visible) ─────────────────────────────────────── */}
      <div style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>

          {/* Toggle area — clicking title/description row toggles the card */}
          <button
            onClick={onToggle}
            style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
              <span style={{ fontSize: 13, color: 'var(--color-muted)', lineHeight: 1 }}>
                {expanded ? '▼' : '▶'}
              </span>
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', margin: 0, fontFamily: 'inherit' }}>
                {title}
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
                : description
              }
            </p>
          </button>

          <Button variant="primary" onClick={handleRun} disabled={running}
            style={{ flexShrink: 0, fontSize: 12, padding: '5px 14px' }}>
            {running ? 'Running…' : 'Run now'}
          </Button>
        </div>

        {/* Progress */}
        {running && (
          <div style={{ marginTop: 10 }}>
            <style>{`@keyframes _card_slide{0%{left:-45%}100%{left:110%}}`}</style>
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
                animation: '_card_slide 1.4s ease-in-out infinite',
              }} />
            </div>
          </div>
        )}

        {error && <p style={{ fontSize: 11, color: '#dc2626', marginTop: 6, fontFamily: 'inherit' }}>{error}</p>}

        {/* Last run meta — only shown when collapsed */}
        {!expanded && lastRun && !running && (
          <p style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 6, marginLeft: 21, fontFamily: 'inherit' }}>
            Last run: {fmtDate(lastRun.run_at)}
            {runCost != null && <span> · {fmtAud(runCost)}</span>}
          </p>
        )}
      </div>

      {/* ── Expanded body ───────────────────────────────────────────────── */}
      {expanded && hasResult && (
        <div style={{ borderTop: '1px solid var(--color-border)', padding: '16px' }}>
          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <button onClick={handleCopy} style={actionBtnStyle}>{copied ? 'Copied!' : 'Copy'}</button>
            <button onClick={handlePrint} style={actionBtnStyle}>Print / PDF</button>
            <button onClick={() => { setEmailModal(true); setEmailError(''); }} style={actionBtnStyle}>Email</button>
            {runCost != null && (
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-muted)', fontFamily: 'inherit' }}>
                Last run: {fmtDate(lastRun?.run_at)} · {fmtAud(runCost)}
              </span>
            )}
          </div>
          <MarkdownRenderer text={summary} />
        </div>
      )}

      {expanded && !hasResult && !running && (
        <div style={{ borderTop: '1px solid var(--color-border)', padding: '24px 16px', textAlign: 'center' }}>
          <p style={{ fontSize: 13, color: 'var(--color-muted)', fontFamily: 'inherit' }}>
            No results yet — click "Run now" to generate this report.
          </p>
        </div>
      )}

      {/* ── Email modal ─────────────────────────────────────────────────── */}
      {emailModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.45)',
        }} onClick={() => setEmailModal(false)}>
          <div style={{
            background: 'var(--color-surface)', border: '1px solid var(--color-border)',
            borderRadius: 16, padding: 24, width: 360, fontFamily: 'inherit',
          }} onClick={(e) => e.stopPropagation()}>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', marginBottom: 12 }}>
              Email — {title}
            </p>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--color-muted)', marginBottom: 4 }}>Send to</label>
            <input
              type="email" value={emailTo} onChange={(e) => setEmailTo(e.target.value)}
              placeholder="recipient@example.com"
              style={{
                width: '100%', boxSizing: 'border-box', padding: '8px 10px',
                borderRadius: 8, border: '1px solid var(--color-border)',
                background: 'var(--color-bg)', color: 'var(--color-text)',
                fontSize: 13, fontFamily: 'inherit', marginBottom: 12, outline: 'none',
              }}
            />
            {emailError && <p style={{ fontSize: 11, color: '#dc2626', marginBottom: 8 }}>{emailError}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="primary" onClick={handleEmail} disabled={emailSending || !emailTo}>
                {emailSending ? 'Sending…' : 'Send'}
              </Button>
              <Button variant="secondary" onClick={() => setEmailModal(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
