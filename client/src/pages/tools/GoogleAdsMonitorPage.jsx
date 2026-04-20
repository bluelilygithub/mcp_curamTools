/**
 * GoogleAdsMonitorPage — Google Ads performance analysis tool.
 */
import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../../api/client';
import useAuthStore from '../../stores/authStore';
import Button from '../../components/ui/Button';
import InlineBanner from '../../components/ui/InlineBanner';
import MarkdownRenderer from '../../components/ui/MarkdownRenderer';
import LineChart from '../../components/charts/LineChart';
import CampaignPerformanceTable from './GoogleAdsMonitor/CampaignPerformanceTable';
import SearchTermsTable from './GoogleAdsMonitor/SearchTermsTable';
import AISuggestionsPanel from './GoogleAdsMonitor/AISuggestionsPanel';
import AgentDashboardCard from './GoogleAdsMonitor/AgentDashboardCard';
import StrategicReviewCard from './GoogleAdsMonitor/StrategicReviewCard';
import DaypartIntelligenceCard from './GoogleAdsMonitor/DaypartIntelligenceCard';
import AiVisibilityTab from './GoogleAdsMonitor/AiVisibilityTab';

const AGENT_SLUG = 'google-ads-monitor';

// ── Formatting helpers ────────────────────────────────────────────────────────

/** Integer with commas, no decimals */
const fmtNum = (n) => Math.round(n ?? 0).toLocaleString('en-AU');
/** AUD currency — 2 decimal places */
const fmtAud = (n) => `$${Number(n ?? 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** YYYY-MM-DD → DD/MM/YYYY */
const fmtDate = (s) => {
  if (!s) return '—';
  if (s.includes('T') || s.includes(' ')) return new Date(s).toLocaleString('en-AU');
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
};

// ── Date helpers ──────────────────────────────────────────────────────────────

function isoDate(d) { return d.toISOString().slice(0, 10); }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return isoDate(d); }
function startOfMonth() { const d = new Date(); return isoDate(new Date(d.getFullYear(), d.getMonth(), 1)); }

const PRESETS = [
  { label: 'Today', key: 'today', getRange: () => ({ start: isoDate(new Date()), end: isoDate(new Date()) }) },
  { label: 'Month', key: 'month', getRange: () => ({ start: startOfMonth(),      end: isoDate(new Date()) }) },
  { label: '7d',    key: '7d',    getRange: () => ({ start: daysAgo(7),          end: isoDate(new Date()) }) },
  { label: '14d',   key: '14d',   getRange: () => ({ start: daysAgo(14),         end: isoDate(new Date()) }) },
  { label: '30d',   key: '30d',   getRange: () => ({ start: daysAgo(30),         end: isoDate(new Date()) }) },
  { label: '60d',   key: '60d',   getRange: () => ({ start: daysAgo(60),         end: isoDate(new Date()) }) },
  { label: '90d',   key: '90d',   getRange: () => ({ start: daysAgo(90),         end: isoDate(new Date()) }) },
];

// ── Shared styles ─────────────────────────────────────────────────────────────

const inputStyle = {
  padding: '0.4rem 0.6rem', borderRadius: '0.5rem',
  border: '1px solid var(--color-border)', background: 'var(--color-bg)',
  color: 'var(--color-text)', fontSize: '0.875rem', outline: 'none',
  fontFamily: 'inherit',
};

function Section({ title, action, children }) {
  return (
    <div className="rounded-2xl border overflow-hidden mb-4"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
      <div className="px-4 py-2.5 border-b flex items-center justify-between"
        style={{ borderColor: 'var(--color-border)' }}>
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
          {title}
        </p>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// ── Animated progress bar ─────────────────────────────────────────────────────

function ProgressBar({ lines }) {
  return (
    <div className="rounded-xl border p-4 mb-4"
      style={{ borderColor: 'var(--color-primary)', background: 'var(--color-surface)' }}>
      <style>{`
        @keyframes _ads_slide { 0%{left:-45%} 100%{left:110%} }
      `}</style>
      <p className="text-xs font-medium mb-2" style={{ color: 'var(--color-text)' }}>
        Analysis in progress — this typically takes 60–90 seconds.
        <span style={{ color: 'var(--color-muted)' }}> Please don't navigate away.</span>
      </p>
      <div style={{ position: 'relative', height: 4, borderRadius: 2, overflow: 'hidden', background: 'var(--color-border)' }}>
        <div style={{
          position: 'absolute', top: 0, height: '100%', width: '45%',
          background: 'var(--color-primary)', borderRadius: 2,
          animation: '_ads_slide 1.4s ease-in-out infinite',
        }} />
      </div>
      {lines.length > 0 && (
        <div className="mt-3 space-y-0.5">
          {lines.slice(-5).map((l, i) => (
            <p key={i} className="text-xs" style={{ color: 'var(--color-muted)', fontFamily: 'inherit' }}>
              <span style={{ color: 'var(--color-primary)', marginRight: 6 }}>›</span>{l}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Email modal ───────────────────────────────────────────────────────────────

function EmailModal({ onClose, onSend, defaultEmail, sending }) {
  const [to, setTo] = useState(defaultEmail);
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.45)',
    }} onClick={onClose}>
      <div style={{
        background: 'var(--color-surface)', border: '1px solid var(--color-border)',
        borderRadius: 16, padding: 24, width: 360, fontFamily: 'inherit',
      }} onClick={(e) => e.stopPropagation()}>
        <p className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text)' }}>Email report</p>
        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Send to</label>
        <input
          type="email"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="recipient@example.com"
          style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', marginBottom: 16 }}
        />
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => onSend(to)} disabled={sending || !to}>
            {sending ? 'Sending…' : 'Send report'}
          </Button>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

// ── All-agents history tab ────────────────────────────────────────────────────

const ALL_AGENT_SLUGS = [
  { slug: 'google-ads-monitor',       label: 'Google Ads Monitor' },
  { slug: 'google-ads-change-impact', label: 'Change Impact' },
  { slug: 'google-ads-change-audit',  label: 'Change Audit' },
  { slug: 'ads-attribution-summary',  label: 'Attribution Summary' },
  { slug: 'ads-bounce-analysis',      label: 'Bounce Analysis' },
  { slug: 'search-term-intelligence', label: 'Search Term Intelligence' },
  { slug: 'auction-insights',         label: 'Auction Insights' },
  { slug: 'competitor-keyword-intel', label: 'Competitor Keywords' },
  { slug: 'google-ads-strategic-review', label: 'Strategic Review' },
];

function AllAgentsHistory({ onDiscuss }) {
  const [grouped,    setGrouped]    = useState({});   // { slug: [run, …] }
  const [loading,    setLoading]    = useState(true);
  const [openSlug,   setOpenSlug]   = useState(null);
  const [openRunId,  setOpenRunId]  = useState(null);

  useEffect(() => {
    async function load() {
      const results = {};
      await Promise.all(
        ALL_AGENT_SLUGS.map(async ({ slug }) => {
          try {
            const rows = await api.get(`/agents/${slug}/history`);
            results[slug] = (rows ?? []).filter((r) => r.status === 'complete');
          } catch { results[slug] = []; }
        })
      );
      setGrouped(results);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', fontSize: 13, color: 'var(--color-muted)', fontFamily: 'inherit' }}>
        Loading history…
      </div>
    );
  }

  const totalRuns = Object.values(grouped).reduce((s, rows) => s + rows.length, 0);
  if (totalRuns === 0) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', fontSize: 13, color: 'var(--color-muted)', fontFamily: 'inherit' }}>
        No completed runs yet.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {ALL_AGENT_SLUGS.map(({ slug, label }) => {
        const runs = grouped[slug] ?? [];
        if (runs.length === 0) return null;
        const isOpen = openSlug === slug;

        return (
          <div key={slug} style={{
            borderRadius: 14, border: '1px solid var(--color-border)',
            background: 'var(--color-surface)', overflow: 'hidden', fontFamily: 'inherit',
          }}>
            {/* Group header */}
            <button
              onClick={() => setOpenSlug(isOpen ? null : slug)}
              style={{
                width: '100%', textAlign: 'left', background: 'none', border: 'none',
                cursor: 'pointer', padding: '12px 16px',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>{isOpen ? '▼' : '▶'}</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', flex: 1 }}>{label}</span>
              <span style={{ fontSize: 11, color: 'var(--color-muted)' }}>{runs.length} run{runs.length !== 1 ? 's' : ''}</span>
            </button>

            {/* Run list */}
            {isOpen && (
              <div style={{ borderTop: '1px solid var(--color-border)' }}>
                {runs.map((run) => {
                  const dateLabel = run.result?.startDate && run.result?.endDate
                    ? `${fmtDate(run.result.startDate)} – ${fmtDate(run.result.endDate)}`
                    : fmtDate(run.run_at);
                  const tokens = run.result?.tokensUsed
                    ? (run.result.tokensUsed.input ?? 0) + (run.result.tokensUsed.output ?? 0)
                    : null;
                  const isRunOpen = openRunId === run.id;
                  const summary   = run.result?.summary ?? '';

                  return (
                    <div key={run.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      {/* Run row */}
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '9px 16px', background: 'var(--color-bg)',
                      }}>
                        <button
                          onClick={() => setOpenRunId(isRunOpen ? null : run.id)}
                          style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                        >
                          <span style={{ fontSize: 13, color: 'var(--color-text)', fontFamily: 'inherit' }}>{dateLabel}</span>
                          {run.result?.costAud != null && (
                            <span style={{ fontSize: 11, color: 'var(--color-muted)', marginLeft: 10, fontFamily: 'inherit' }}>
                              {fmtAud(run.result.costAud)}
                            </span>
                          )}
                          {tokens != null && (
                            <span style={{ fontSize: 11, color: 'var(--color-muted)', marginLeft: 8, fontFamily: 'inherit' }}>
                              · {fmtNum(tokens)} tok
                            </span>
                          )}
                        </button>
                        {onDiscuss && summary && (
                          <button
                            onClick={() => {
                              const seed = `I'd like to discuss the ${label} report (${dateLabel}):\n\n${summary}`;
                              onDiscuss(seed);
                            }}
                            style={{
                              fontSize: 11, padding: '2px 9px', borderRadius: 6, fontFamily: 'inherit',
                              border: '1px solid var(--color-primary)', background: 'transparent',
                              color: 'var(--color-primary)', cursor: 'pointer', flexShrink: 0,
                            }}
                          >
                            Discuss
                          </button>
                        )}
                        <button
                          onClick={() => setOpenRunId(isRunOpen ? null : run.id)}
                          style={{
                            fontSize: 11, padding: '2px 9px', borderRadius: 6, fontFamily: 'inherit',
                            border: '1px solid var(--color-border)', background: 'transparent',
                            color: 'var(--color-muted)', cursor: 'pointer', flexShrink: 0,
                          }}
                        >
                          {isRunOpen ? 'Hide' : 'View'}
                        </button>
                      </div>

                      {/* Expanded summary */}
                      {isRunOpen && summary && (
                        <div style={{ padding: '16px', borderTop: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
                          <MarkdownRenderer text={summary} />
                        </div>
                      )}
                    </div>
                  );
                })}

              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const VALID_TABS = ['dashboard', 'ai-visibility', 'history', 'settings'];

export default function GoogleAdsMonitorPage() {
  const { user }   = useAuthStore();
  const location   = useLocation();

  // Initialise tab from ?tab= query param so sidebar deep-links work
  const initialTab = (() => {
    const t = new URLSearchParams(location.search).get('tab');
    return VALID_TABS.includes(t) ? t : 'dashboard';
  })();

  const [startDate,  setStartDate]  = useState(daysAgo(30));
  const [endDate,    setEndDate]    = useState(isoDate(new Date()));
  const [running,    setRunning]    = useState(false);
  const [progress,   setProgress]   = useState([]);
  const [error,      setError]      = useState('');
  const [result,     setResult]     = useState(null);
  const [history,    setHistory]    = useState([]);
  const [config,     setConfig]     = useState(null);
  const [savingCfg,  setSavingCfg]  = useState(false);
  const [cfgSuccess, setCfgSuccess] = useState('');
  const [activeTab,  setActiveTab]  = useState(initialTab);
  const [openCard,   setOpenCard]   = useState(null);
  const [emailModal, setEmailModal] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [monitorCopied, setMonitorCopied] = useState(false);

  // Warn before leaving while a run is in progress
  useEffect(() => {
    const handler = (e) => { if (running) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [running]);

  useEffect(() => { loadHistory(); loadConfig(); }, []);

  async function loadHistory() {
    try {
      const rows = await api.get(`/agents/${AGENT_SLUG}/history`);
      setHistory(rows);
      if (!result) {
        const latest = rows.find((r) => r.status === 'complete');
        if (latest?.result) setResult(latest.result);
      }
    } catch { /* non-fatal */ }
  }

  async function loadConfig() {
    try { setConfig(await api.get(`/agent-configs/${AGENT_SLUG}`)); } catch { /* use defaults */ }
  }

  // ── Preset quick-select ───────────────────────────────────────────────────

  const [activePreset, setActivePreset] = useState('30d');

  function applyPreset(preset) {
    setActivePreset(preset.key);
    const { start, end } = preset.getRange();
    setStartDate(start);
    setEndDate(end);
  }

  function onDateChange(field, value) {
    setActivePreset(null); // custom range — deselect preset
    if (field === 'start') setStartDate(value);
    else setEndDate(value);
  }

  // ── Run ───────────────────────────────────────────────────────────────────

  async function handleRun() {
    if (new Date(startDate) > new Date(endDate)) {
      setError('Start date must be before end date.');
      return;
    }
    setRunning(true);
    setProgress([]);
    setError('');

    try {
      const res = await api.stream(`/agents/${AGENT_SLUG}/run`, { startDate, endDate });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') { setRunning(false); loadHistory(); return; }
          try {
            const msg = JSON.parse(raw);
            if (msg.type === 'progress') setProgress((p) => [...p, msg.text]);
            else if (msg.type === 'result') { setResult(msg.data); setActiveTab('dashboard'); setOpenCard('monitor'); }
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

  // ── Export CSV ────────────────────────────────────────────────────────────

  function exportCSV() {
    if (!result) return;
    const campaigns = result.data?.get_campaign_performance ?? [];
    const terms     = result.data?.get_search_terms         ?? [];

    const rows = [
      ['CAMPAIGN PERFORMANCE'],
      ['Campaign', 'Budget (AUD)', 'Impressions', 'Clicks', 'CTR', 'Cost (AUD)', 'Conversions', 'CPA (AUD)', 'Avg CPC (AUD)'],
      ...campaigns.map((c) => {
        const cpa = c.conversions > 0 ? (c.cost / c.conversions).toFixed(2) : '';
        return [c.name, c.budget.toFixed(2), c.impressions, c.clicks,
          (c.ctr * 100).toFixed(1) + '%', c.cost.toFixed(2), c.conversions.toFixed(1), cpa, c.avgCpc.toFixed(2)];
      }),
      [],
      ['SEARCH TERMS'],
      ['Term', 'Impressions', 'Clicks', 'CTR', 'Cost (AUD)', 'Conversions'],
      ...terms.map((t) => [t.term, t.impressions, t.clicks,
        (t.ctr * 100).toFixed(1) + '%', t.cost.toFixed(2), t.conversions.toFixed(1)]),
    ];

    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `ads-report-${startDate}-${endDate}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  // ── Email ─────────────────────────────────────────────────────────────────

  async function handleEmail(to) {
    setEmailSending(true);
    try {
      await api.post(`/agents/${AGENT_SLUG}/email`, { to, result, startDate, endDate });
      setEmailModal(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setEmailSending(false);
    }
  }

  // ── Save config ───────────────────────────────────────────────────────────

  async function handleSaveConfig() {
    setSavingCfg(true);
    try {
      setConfig(await api.put(`/agent-configs/${AGENT_SLUG}`, config));
      setCfgSuccess('Settings saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingCfg(false);
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const campaigns   = result?.data?.get_campaign_performance ?? [];
  const dailyData   = result?.data?.get_daily_performance    ?? [];
  const searchTerms = result?.data?.get_search_terms         ?? [];
  const suggestions = result?.suggestions                    ?? [];
  const summary     = result?.summary                        ?? '';

  const tabBtn = (tab, label) => (
    <button key={tab} onClick={() => setActiveTab(tab)} style={{
      padding: '0.35rem 0.85rem', fontSize: '0.8rem', fontWeight: 500, fontFamily: 'inherit',
      borderRadius: '0.5rem', cursor: 'pointer', border: 'none',
      background: activeTab === tab ? 'var(--color-primary)' : 'transparent',
      color: activeTab === tab ? '#fff' : 'var(--color-muted)',
    }}>{label}</button>
  );

  const hasResult = !!result;

  const actionBtnStyle = {
    fontSize: 11, padding: '3px 10px', borderRadius: 6, fontFamily: 'inherit',
    border: '1px solid var(--color-border)', background: 'transparent',
    color: 'var(--color-muted)', cursor: 'pointer',
  };

  function toggleCard(slug) {
    setOpenCard((current) => current === slug ? null : slug);
  }

  function handleMonitorCopy() {
    navigator.clipboard.writeText(summary).then(() => {
      setMonitorCopied(true);
      setTimeout(() => setMonitorCopied(false), 2000);
    });
  }

  return (
    <div className="p-5 max-w-7xl mx-auto" style={{ fontFamily: 'inherit' }}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)', fontFamily: 'inherit' }}>
            Google Ads Monitor
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)', fontFamily: 'inherit' }}>
            AI-powered campaign analysis, search intent, and budget pacing.
          </p>
        </div>

        {/* Date controls */}
        <div className="flex flex-col gap-2 items-end">
          {/* Quick presets */}
          <div className="flex gap-1 rounded-lg p-1" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            {PRESETS.map((p) => (
              <button key={p.key} onClick={() => applyPreset(p)} style={{
                padding: '3px 10px', fontSize: 12, borderRadius: 6, border: 'none', cursor: 'pointer',
                fontFamily: 'inherit',
                background: activePreset === p.key ? 'var(--color-primary)' : 'transparent',
                color: activePreset === p.key ? '#fff' : 'var(--color-muted)',
                fontWeight: activePreset === p.key ? 600 : 400,
              }}>{p.label}</button>
            ))}
          </div>

          {/* Date pickers */}
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <div className="flex items-center gap-1.5">
              <span className="text-xs" style={{ color: 'var(--color-muted)', fontFamily: 'inherit' }}>From</span>
              <input key={`start-${startDate}`} type="date" value={startDate} max={endDate}
                onChange={(e) => onDateChange('start', e.target.value)}
                style={{ ...inputStyle, fontSize: '0.8rem' }} />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs" style={{ color: 'var(--color-muted)', fontFamily: 'inherit' }}>To</span>
              <input key={`end-${endDate}`} type="date" value={endDate} min={startDate} max={isoDate(new Date())}
                onChange={(e) => onDateChange('end', e.target.value)}
                style={{ ...inputStyle, fontSize: '0.8rem' }} />
            </div>
          </div>
        </div>
      </div>

      {error && <InlineBanner type="error" message={error} onDismiss={() => setError('')} className="mb-4" />}

      {running && <ProgressBar lines={progress} />}

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 mb-4 flex-wrap">
        {tabBtn('dashboard',    'Dashboard')}
        {tabBtn('ai-visibility','AI Visibility')}
        {tabBtn('history',      'History')}
        {tabBtn('settings',     'Settings')}
      </div>

      {/* ── Dashboard ──────────────────────────────────────────────────── */}
      {activeTab === 'dashboard' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* ── Google Ads Monitor — main analysis card ─────────────────── */}
          <div style={{
            borderRadius: 16, border: '1px solid var(--color-border)',
            background: 'var(--color-surface)', overflow: 'hidden', fontFamily: 'inherit',
          }}>
            {/* Header */}
            <div style={{ padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <button
                  onClick={() => toggleCard('monitor')}
                  style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span style={{ fontSize: 13, color: 'var(--color-muted)', lineHeight: 1 }}>
                      {openCard === 'monitor' ? '▼' : '▶'}
                    </span>
                    <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', margin: 0, fontFamily: 'inherit' }}>
                      Google Ads Monitor
                    </p>
                    {running && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 99,
                        background: '#d9770620', color: '#d97706',
                        fontFamily: 'inherit', textTransform: 'uppercase', letterSpacing: '0.04em',
                      }}>running</span>
                    )}
                    {!running && hasResult && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 99,
                        background: '#16a34a20', color: '#16a34a',
                        fontFamily: 'inherit', textTransform: 'uppercase', letterSpacing: '0.04em',
                      }}>complete</span>
                    )}
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--color-muted)', margin: '0 0 0 21px', fontFamily: 'inherit' }}>
                    {openCard !== 'monitor' && summary
                      ? <>{summary.replace(/#{1,3}\s/g, '').slice(0, 140).trim()}{summary.length > 140 ? '…' : ''}</>
                      : 'AI-powered campaign analysis, search intent, and budget pacing.'
                    }
                  </p>
                </button>
                <Button variant="primary" onClick={handleRun} disabled={running}
                  style={{ flexShrink: 0, fontSize: 12, padding: '5px 14px' }}>
                  {running ? 'Running…' : 'Run now'}
                </Button>
              </div>
            </div>

            {/* Expanded body */}
            {openCard === 'monitor' && (
              <div style={{ borderTop: '1px solid var(--color-border)', padding: '16px' }}>
                {!hasResult && !running && (
                  <p style={{ fontSize: 13, color: 'var(--color-muted)', textAlign: 'center', padding: '12px 0', fontFamily: 'inherit' }}>
                    No results yet — select a date range and click "Run now".
                  </p>
                )}
                {hasResult && (
                  <>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                      <button onClick={handleMonitorCopy} style={actionBtnStyle}>{monitorCopied ? 'Copied!' : 'Copy'}</button>
                      <button onClick={exportCSV} style={actionBtnStyle}>Export CSV</button>
                      <button onClick={() => window.print()} style={actionBtnStyle}>Print / PDF</button>
                      <button onClick={() => setEmailModal(true)} style={actionBtnStyle}>Email</button>
                      {result.costAud != null && (
                        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-muted)', fontFamily: 'inherit', alignSelf: 'center' }}>
                          Run cost: A${Number(result.costAud).toFixed(4)}
                        </span>
                      )}
                    </div>
                    {summary && <MarkdownRenderer text={summary} />}
                    {campaigns.length > 0 && (
                      <div className="mt-4">
                        <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>Campaign Performance</p>
                        <CampaignPerformanceTable campaigns={campaigns} />
                      </div>
                    )}
                    {dailyData.length > 1 && (
                      <div className="mt-4">
                        <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>Spend & Conversions Trend</p>
                        <LineChart
                          data={dailyData} xKey="date" leftKey="cost" rightKey="conversions"
                          leftLabel="Spend (AUD)" rightLabel="Conversions"
                          leftFormat={(v) => `$${Math.round(v).toLocaleString('en-AU')}`}
                          rightFormat={(v) => Number(v).toFixed(1)}
                          leftColor="var(--color-primary)" rightColor="#10b981"
                        />
                      </div>
                    )}
                    {searchTerms.length > 0 && (
                      <div className="mt-4">
                        <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>Search Terms</p>
                        <SearchTermsTable terms={searchTerms} />
                      </div>
                    )}
                    {suggestions.length > 0 && (
                      <div className="mt-4">
                        <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>Recommendations ({suggestions.length})</p>
                        <AISuggestionsPanel suggestions={suggestions} />
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* ── Daypart Intelligence ─────────────────────────────────────── */}
          <DaypartIntelligenceCard
            startDate={startDate}
            endDate={endDate}
            expanded={openCard === 'daypart-intelligence'}
            onToggle={() => toggleCard('daypart-intelligence')}
            onContinueInConversation={null}
          />

          {/* ── Sub-agent cards ──────────────────────────────────────────── */}
          {[
            { slug: 'cost-per-booked-job',       title: 'Cost Per Booked Job', description: 'True campaign ROI — cross-references Ads spend with CRM close rates to reveal cost per booked job vs Google Ads reported CPA.' },
            { slug: 'google-ads-change-impact',  title: 'Change Impact',       description: 'Identifies what changed and narrates the performance effect of each change.' },
            { slug: 'google-ads-change-audit',   title: 'Change Audit',        description: 'Before/after metric comparison per change. Scores each change as Positive, Neutral, or Negative.' },
            { slug: 'ads-attribution-summary',   title: 'Attribution Summary', description: 'Connects ad spend, GA4 traffic, and WordPress enquiries — shows which campaigns are generating actual leads.' },
            { slug: 'ads-bounce-analysis',       title: 'Bounce Analysis',     description: 'Paid keywords that sent traffic to high-bounce landing pages, broken down by device.' },
            { slug: 'search-term-intelligence',  title: 'Search Term Intelligence', description: 'Cross-references Ads search terms with CRM lead outcomes — surfaces terms that bounce and terms that generate not-interested leads.' },
            { slug: 'auction-insights',          title: 'Auction Insights',    description: 'Which competitors are bidding in the same auctions — impression share, top-of-page rate, and where Diamond Plate is losing visibility.' },
            { slug: 'competitor-keyword-intel',  title: 'Competitor Keywords', description: 'Keyword gaps for Diamond Plate Australia — what competitors are targeting that we are not. Requires Standard API access.' },
          ].map(({ slug, title, description }) => (
            <AgentDashboardCard
              key={slug}
              slug={slug}
              title={title}
              description={description}
              startDate={startDate}
              endDate={endDate}
              expanded={openCard === slug}
              onToggle={() => toggleCard(slug)}
              />
          ))}

          {/* ── Strategic Review ─────────────────────────────────────────── */}
          <StrategicReviewCard
            startDate={startDate}
            endDate={endDate}
            expanded={openCard === 'google-ads-strategic-review'}
            onToggle={() => toggleCard('google-ads-strategic-review')}
          />
        </div>
      )}

      {/* ── AI Visibility ───────────────────────────────────────────────── */}
      {activeTab === 'ai-visibility' && (
        <AiVisibilityTab />
      )}

      {/* ── History ────────────────────────────────────────────────────── */}
      {activeTab === 'history' && (
        <AllAgentsHistory onDiscuss={null} />
      )}

      {/* ── Settings ───────────────────────────────────────────────────── */}
      {activeTab === 'settings' && config && (
        <div className="space-y-4" style={{ fontFamily: 'inherit' }}>
          {cfgSuccess && <InlineBanner type="neutral" message={cfgSuccess} onDismiss={() => setCfgSuccess('')} />}

          {/* Helper components */}
          {(() => {
            const fieldStyle = { ...inputStyle, width: '100%', boxSizing: 'border-box' };
            const sectionHd  = (label) => (
              <p className="text-xs font-semibold uppercase tracking-wider mb-3"
                style={{ color: 'var(--color-muted)' }}>{label}</p>
            );
            const numField = (key, label, step) => (
              <div key={key}>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>{label}</label>
                <input type="number" step={step} style={fieldStyle} value={config[key] ?? ''}
                  onChange={(e) => setConfig((c) => ({ ...c, [key]: step ? parseFloat(e.target.value) : parseInt(e.target.value) }))} />
              </div>
            );
            const txtField = (key, label, placeholder = '') => (
              <div key={key}>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>{label}</label>
                <input type="text" style={fieldStyle} value={config[key] ?? ''} placeholder={placeholder}
                  onChange={(e) => setConfig((c) => ({ ...c, [key]: e.target.value }))} />
              </div>
            );
            const areaField = (key, label, placeholder = '', rows = 4) => (
              <div key={key}>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>{label}</label>
                <textarea rows={rows} style={{ ...fieldStyle, resize: 'vertical' }} value={config[key] ?? ''} placeholder={placeholder}
                  onChange={(e) => setConfig((c) => ({ ...c, [key]: e.target.value }))} />
              </div>
            );

            return (
              <>
                {/* Business context */}
                <div className="rounded-2xl border p-5" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                  {sectionHd('Business Context')}
                  <div className="grid grid-cols-2 gap-4">
                    {numField('target_cpa',     'Target CPA (AUD)',          0.01)}
                    {numField('monthly_budget', 'Monthly budget (AUD)',      0.01)}
                    {txtField('brand_keywords', 'Brand keywords (comma-separated)', 'diamond plate, diamondplate')}
                    {txtField('report_email',   'Default report email',      'you@example.com')}
                  </div>
                </div>

                {/* Analysis thresholds */}
                <div className="rounded-2xl border p-5" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                  {sectionHd('Analysis Thresholds')}
                  <div className="grid grid-cols-2 gap-4">
                    {numField('lookback_days',             'Default lookback (days)')}
                    {numField('ctr_low_threshold',         'Low CTR threshold (e.g. 0.03 = 3%)',  0.001)}
                    {numField('wasted_clicks_threshold',   'Wasted clicks minimum')}
                    {numField('impressions_ctr_threshold', 'Impressions floor (ad copy check)')}
                    {numField('max_suggestions',           'Max recommendations')}
                    {numField('bounce_rate_threshold',     'Bounce rate flag threshold (0–1)',     0.01)}
                  </div>
                </div>

                {/* Competitor intelligence */}
                <div className="rounded-2xl border p-5" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                  {sectionHd('Competitor Intelligence')}
                  <div className="space-y-4">
                    {areaField(
                      'competitor_urls',
                      'Competitor URLs (one per line)',
                      'https://ceramicpro.com.au\nhttps://gtechniq.com/en-au\nhttps://gyeonquartz.com.au',
                      5
                    )}
                    <div className="grid grid-cols-2 gap-4">
                      {numField('min_search_volume', 'Minimum monthly search volume')}
                    </div>
                  </div>
                </div>

                {/* Schedule */}
                <div className="rounded-2xl border p-5" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                  {sectionHd('Schedule')}
                  {txtField('schedule', 'Cron schedule (UTC)', '0 6,18 * * *')}
                </div>

                <Button variant="primary" onClick={handleSaveConfig} disabled={savingCfg}>
                  {savingCfg ? 'Saving…' : 'Save settings'}
                </Button>
              </>
            );
          })()}
        </div>
      )}

      {/* ── Email modal ─────────────────────────────────────────────────── */}
      {emailModal && (
        <EmailModal
          defaultEmail={config?.report_email || user?.email || ''}
          sending={emailSending}
          onClose={() => setEmailModal(false)}
          onSend={handleEmail}
        />
      )}
    </div>
  );
}
