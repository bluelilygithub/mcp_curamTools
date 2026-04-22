/**
 * AgentDashboardCard — self-contained card for a Google Ads sub-agent.
 *
 * Controlled expand/collapse — parent owns the open state for accordion behaviour.
 *
 * Props:
 *   slug                     — agent slug e.g. 'google-ads-change-audit'
 *   title                    — display name
 *   description              — one-line description shown in the card header
 *   startDate                — ISO date string from the parent page's date range
 *   endDate                  — ISO date string from the parent page's date range
 *   expanded                 — controlled: whether this card is open
 *   onToggle                 — controlled: called when the user clicks expand/collapse
 *   onContinueInConversation — optional: called with a seed string to open the Conversation tab
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

export default function AgentDashboardCard({ slug, title, description, startDate, endDate, expanded, onToggle, onContinueInConversation, prerequisiteSlug, prerequisiteTitle }) {
  const [runs,           setRuns]           = useState([]);   // all complete runs, newest first
  const [runIndex,       setRunIndex]       = useState(0);    // 0 = most recent
  const [running,        setRunning]        = useState(false);
  const [lines,          setLines]          = useState([]);
  const [error,          setError]          = useState('');
  const [copied,         setCopied]         = useState(false);
  const [emailModal,     setEmailModal]     = useState(false);
  const [emailTo,        setEmailTo]        = useState('');
  const [emailSending,   setEmailSending]   = useState(false);
  const [emailError,     setEmailError]     = useState('');
  const [recentRunModal, setRecentRunModal] = useState(false);
  const [recentRunMeta,  setRecentRunMeta]  = useState(null); // { hoursAgo, sameRange }
  const [prereqModal,    setPrereqModal]    = useState(false);
  const [prereqMeta,     setPrereqMeta]     = useState(null); // { state: 'none'|'old', daysAgo }

  useEffect(() => { loadHistory(); }, [slug]);

  async function loadHistory() {
    try {
      const rows = await api.get(`/agents/${slug}/history`);
      const complete = (rows ?? []).filter((r) => r.status === 'complete');
      setRuns(complete);
      setRunIndex(0);
    } catch { /* non-fatal */ }
  }

  // Derived from whichever run is currently selected
  const currentRun = runs[runIndex] ?? null;
  const result     = currentRun?.result ?? null;
  const summary    = result?.summary ?? '';

  async function handleRunClick() {
    // 1. Prerequisite check — does a required prior report exist?
    if (prerequisiteSlug) {
      try {
        const prereqRows = await api.get(`/agents/${prerequisiteSlug}/history`);
        const latestPrereq = (prereqRows ?? []).find((r) => r.status === 'complete');
        if (!latestPrereq) {
          setPrereqMeta({ state: 'none' });
          setPrereqModal(true);
          return;
        }
        const prereqDaysAgo = (Date.now() - new Date(latestPrereq.run_at).getTime()) / 86_400_000;
        if (prereqDaysAgo > 7) {
          setPrereqMeta({ state: 'old', daysAgo: Math.round(prereqDaysAgo) });
          setPrereqModal(true);
          return;
        }
      } catch { /* non-fatal — proceed */ }
    }

    // 2. Recent-run check
    if (!runs.length) { handleRun(); return; }
    const latest    = runs[0];
    const hoursAgo  = (Date.now() - new Date(latest.run_at).getTime()) / 3_600_000;
    const sameRange = latest.result?.startDate === startDate && latest.result?.endDate === endDate;
    if (hoursAgo < 6 || sameRange) {
      setRecentRunMeta({ hoursAgo, sameRange });
      setRecentRunModal(true);
    } else {
      handleRun();
    }
  }

  async function handleRun() {
    setRecentRunModal(false);
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
            await loadHistory();
            return;
          }
          try {
            const msg = JSON.parse(raw);
            if (msg.type === 'progress') setLines((l) => [...l, msg.text]);
            else if (msg.type === 'result') { if (onToggle && !expanded) onToggle(); }
            else if (msg.type === 'error')  setError(msg.error);
          } catch { /* ignore malformed */ }
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
    navigator.clipboard.writeText(summary).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handlePrint() { printContent(title, summary); }

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

  function handleKeywordExport() {
    const keywords = new Map(); // lowercased text → { keyword, matchType }

    let section = null;
    for (const line of summary.split('\n')) {
      const t = line.trim();

      // Section detection
      if (/^#{1,3}\s*2\.|keyword opportunity table/i.test(t)) { section = 'opportunity'; continue; }
      if (/^#{1,3}\s*3\.|competitor keyword gap/i.test(t))    { section = 'gaps';        continue; }
      if (/^#{1,3}\s*4\.|quick wins/i.test(t))                { section = null;          continue; }

      if (!section || !t.startsWith('|')) continue;

      const cols = t.split('|').map((c) => c.trim()).filter(Boolean);

      if (section === 'opportunity' && cols.length >= 6) {
        if (/^(-+|Priority)$/i.test(cols[0]) || cols[1] === 'Keyword') continue;
        const kw        = cols[1].replace(/\[HIGH PRIORITY\]/gi, '').trim();
        const matchType = cols[5].toUpperCase().trim();
        if (kw && !/^-+$/.test(kw) && matchType !== 'MATCH TYPE') {
          keywords.set(kw.toLowerCase(), { keyword: kw, matchType });
        }
      }

      if (section === 'gaps' && cols.length >= 5) {
        if (/^(-+|Keyword)$/i.test(cols[0])) continue;
        const kw        = cols[0].trim();
        const matchType = cols[4].toUpperCase().trim();
        if (kw && !/^-+$/.test(kw) && matchType !== 'MATCH TYPE' && !keywords.has(kw.toLowerCase())) {
          keywords.set(kw.toLowerCase(), { keyword: kw, matchType });
        }
      }
    }

    if (keywords.size === 0) {
      alert('No keywords found in the report to export. Ensure the report has been run successfully.');
      return;
    }

    const lines = [];
    for (const { keyword, matchType } of keywords.values()) {
      if (matchType === 'PHRASE')      lines.push(`"${keyword}"`);
      else if (matchType === 'EXACT')  lines.push(`[${keyword}]`);
      else                             lines.push(keyword); // BROAD
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `keywords-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleDiscuss() {
    if (!onContinueInConversation || !summary) return;
    const dateLabel = result?.startDate && result?.endDate
      ? `${fmtDay(result.startDate)} – ${fmtDay(result.endDate)}`
      : currentRun?.run_at ? `run ${fmtDate(currentRun.run_at)}` : '';
    const seed = `I'd like to discuss the ${title} report${dateLabel ? ` (${dateLabel})` : ''}:\n\n${summary}`;
    onContinueInConversation(seed);
  }

  const summarySnippet = summary.replace(/#{1,3}\s/g, '').slice(0, 140).trim();
  const status         = running ? 'running' : (currentRun?.status ?? null);
  const runCost        = result?.costAud ?? null;
  const hasResult      = !!result;
  const totalRuns      = runs.length;

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
    <div style={{
      borderRadius: 16, border: '1px solid var(--color-border)',
      background: 'var(--color-surface)', overflow: 'hidden', fontFamily: 'inherit',
    }}>
      {/* ── Header (always visible) ─────────────────────────────────────── */}
      <div style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>

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

          <Button variant="primary" onClick={handleRunClick} disabled={running}
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

        {/* Collapsed meta */}
        {!expanded && currentRun && !running && (
          <p style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 6, marginLeft: 21, fontFamily: 'inherit' }}>
            {result?.startDate && result?.endDate
              ? <>{fmtDay(result.startDate)} – {fmtDay(result.endDate)}</>
              : <>Run {fmtDate(currentRun.run_at)}</>
            }
            {runCost != null && <span> · {fmtAud(runCost)}</span>}
            {totalRuns > 1 && <span> · {totalRuns} runs</span>}
          </p>
        )}
      </div>

      {/* ── Expanded body ───────────────────────────────────────────────── */}
      {expanded && hasResult && (
        <div style={{ borderTop: '1px solid var(--color-border)', padding: '16px' }}>

          {/* Action bar */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <button onClick={handleCopy} style={actionBtnStyle}>{copied ? 'Copied!' : 'Copy'}</button>
            <button onClick={handlePrint} style={actionBtnStyle}>Print / PDF</button>
            <button onClick={() => { setEmailModal(true); setEmailError(''); }} style={actionBtnStyle}>Email</button>
            {onContinueInConversation && (
              <button onClick={handleDiscuss}
                style={{ ...actionBtnStyle, color: 'var(--color-primary)', borderColor: 'var(--color-primary)' }}>
                Discuss
              </button>
            )}
            {slug === 'keyword-opportunity' && (
              <button onClick={handleKeywordExport} style={actionBtnStyle}>Export Keywords</button>
            )}

            {/* History navigation */}
            {totalRuns > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <button
                  onClick={() => setRunIndex((i) => Math.min(i + 1, totalRuns - 1))}
                  disabled={runIndex >= totalRuns - 1}
                  style={{ ...navBtnStyle, opacity: runIndex >= totalRuns - 1 ? 0.35 : 1 }}
                >‹</button>
                <span style={{ fontSize: 11, color: 'var(--color-muted)', whiteSpace: 'nowrap' }}>
                  {runIndex + 1} / {totalRuns}
                </span>
                <button
                  onClick={() => setRunIndex((i) => Math.max(i - 1, 0))}
                  disabled={runIndex === 0}
                  style={{ ...navBtnStyle, opacity: runIndex === 0 ? 0.35 : 1 }}
                >›</button>
              </div>
            )}

            {/* Date + cost — right-aligned */}
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-muted)', fontFamily: 'inherit' }}>
              {result?.startDate && result?.endDate
                ? <>{fmtDay(result.startDate)} – {fmtDay(result.endDate)}</>
                : currentRun?.run_at ? <>Run {fmtDate(currentRun.run_at)}</> : null
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
            No results yet — click "Run now" to generate this report.
          </p>
        </div>
      )}

      {/* ── Prerequisite warning modal ──────────────────────────────────── */}
      {prereqModal && prereqMeta && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.45)',
        }} onClick={() => setPrereqModal(false)}>
          <div style={{
            background: 'var(--color-surface)', border: '1px solid var(--color-border)',
            borderRadius: 16, padding: 24, width: 420, fontFamily: 'inherit',
          }} onClick={(e) => e.stopPropagation()}>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', marginBottom: 8 }}>
              {prereqMeta.state === 'none' ? 'Run the diagnostic first' : 'Diagnostic report is outdated'}
            </p>
            <p style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 16, lineHeight: 1.55 }}>
              {prereqMeta.state === 'none'
                ? `The ${title} reads the ${prerequisiteTitle ?? 'prerequisite report'} as its primary input — findings, warranty errors, asset ratings, and copy issues are taken directly from that report rather than re-diagnosed. No ${prerequisiteTitle ?? 'prerequisite'} run was found for this account. Run that report first to get accurate, specific recommendations.`
                : `The ${title} reads the ${prerequisiteTitle ?? 'prerequisite report'} as its primary input. The last ${prerequisiteTitle ?? 'prerequisite'} run was ${prereqMeta.daysAgo} day${prereqMeta.daysAgo === 1 ? '' : 's'} ago — recommendations may reference stale findings. Consider running an updated ${prerequisiteTitle ?? 'diagnostic'} first.`
              }
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="secondary" onClick={() => setPrereqModal(false)}>
                {prereqMeta.state === 'none' ? 'Cancel — run diagnostic first' : 'Cancel — update diagnostic first'}
              </Button>
              <Button variant="primary" onClick={() => { setPrereqModal(false); handleRun(); }}>
                Run anyway
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Recent-run warning modal ────────────────────────────────────── */}
      {recentRunModal && recentRunMeta && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.45)',
        }} onClick={() => setRecentRunModal(false)}>
          <div style={{
            background: 'var(--color-surface)', border: '1px solid var(--color-border)',
            borderRadius: 16, padding: 24, width: 400, fontFamily: 'inherit',
          }} onClick={(e) => e.stopPropagation()}>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', marginBottom: 8 }}>
              Report already available
            </p>
            <p style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 16, lineHeight: 1.55 }}>
              {recentRunMeta.sameRange
                ? `A ${title} report for this exact date range is already in history.`
                : `A ${title} report was run ${recentRunMeta.hoursAgo < 1
                    ? 'less than an hour ago'
                    : `${Math.round(recentRunMeta.hoursAgo)} hour${Math.round(recentRunMeta.hoursAgo) === 1 ? '' : 's'} ago`}.`
              }
              {' '}Google Ads data is 24-hour delayed — running again is unlikely to surface new insights.
              Review the existing report first, or run if the period has changed.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="primary" onClick={() => {
                setRecentRunModal(false);
                setRunIndex(0);
                if (!expanded && onToggle) onToggle();
              }}>
                View existing report
              </Button>
              <Button variant="secondary" onClick={handleRun}>Run anyway</Button>
            </div>
          </div>
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
