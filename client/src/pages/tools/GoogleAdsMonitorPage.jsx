/**
 * GoogleAdsMonitorPage — Google Ads performance analysis tool.
 */
import { useState, useEffect, useRef } from 'react';
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

// ── Main page ─────────────────────────────────────────────────────────────────

export default function GoogleAdsMonitorPage() {
  const { user } = useAuthStore();

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
  const [activeTab,  setActiveTab]  = useState('results');
  const [emailModal, setEmailModal] = useState(false);
  const [emailSending, setEmailSending] = useState(false);

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
            else if (msg.type === 'result') { setResult(msg.data); setActiveTab('results'); }
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

  // Export/email buttons — shown alongside tab bar when there's a result
  const actionButtons = hasResult && !running ? (
    <div className="flex gap-1.5 ml-auto">
      <button onClick={exportCSV} style={{
        fontSize: 11, padding: '3px 10px', borderRadius: 6, fontFamily: 'inherit',
        border: '1px solid var(--color-border)', background: 'transparent',
        color: 'var(--color-muted)', cursor: 'pointer',
      }}>Export CSV</button>
      <button onClick={() => window.print()} style={{
        fontSize: 11, padding: '3px 10px', borderRadius: 6, fontFamily: 'inherit',
        border: '1px solid var(--color-border)', background: 'transparent',
        color: 'var(--color-muted)', cursor: 'pointer',
      }}>Print / PDF</button>
      <button onClick={() => setEmailModal(true)} style={{
        fontSize: 11, padding: '3px 10px', borderRadius: 6, fontFamily: 'inherit',
        border: '1px solid var(--color-border)', background: 'transparent',
        color: 'var(--color-muted)', cursor: 'pointer',
      }}>Email</button>
    </div>
  ) : null;

  return (
    <div className="p-5 max-w-5xl mx-auto" style={{ fontFamily: 'inherit' }}>

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

          {/* Date pickers + Run */}
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <div className="flex items-center gap-1.5">
              <span className="text-xs" style={{ color: 'var(--color-muted)', fontFamily: 'inherit' }}>From</span>
              <input type="date" value={startDate} max={endDate}
                onChange={(e) => onDateChange('start', e.target.value)}
                style={{ ...inputStyle, fontSize: '0.8rem' }} />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs" style={{ color: 'var(--color-muted)', fontFamily: 'inherit' }}>To</span>
              <input type="date" value={endDate} min={startDate} max={isoDate(new Date())}
                onChange={(e) => onDateChange('end', e.target.value)}
                style={{ ...inputStyle, fontSize: '0.8rem' }} />
            </div>
            <Button variant="primary" onClick={handleRun} disabled={running}>
              {running ? 'Running…' : 'Run now'}
            </Button>
          </div>
        </div>
      </div>

      {error && <InlineBanner type="error" message={error} onDismiss={() => setError('')} className="mb-4" />}

      {running && <ProgressBar lines={progress} />}

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 mb-4 flex-wrap">
        {tabBtn('results',   'Results')}
        {tabBtn('dashboard', 'Dashboard')}
        {tabBtn('history',   'History')}
        {tabBtn('settings',  'Settings')}
        {actionButtons}
      </div>

      {/* ── Results ────────────────────────────────────────────────────── */}
      {activeTab === 'results' && (
        <>
          {!hasResult && !running && (
            <div className="rounded-2xl border p-10 text-center text-sm"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', fontFamily: 'inherit' }}>
              No results yet. Select a date range and click "Run now" to analyse your account.
            </div>
          )}

          {hasResult && (
            <>
              {summary && (
                <Section title="Analysis">
                  <MarkdownRenderer text={summary} />
                </Section>
              )}

              {campaigns.length > 0 && (
                <Section title="Campaign Performance">
                  <CampaignPerformanceTable campaigns={campaigns} />
                </Section>
              )}

              {dailyData.length > 1 && (
                <Section title="Spend & Conversions Trend">
                  <LineChart
                    data={dailyData}
                    xKey="date"
                    leftKey="cost"
                    rightKey="conversions"
                    leftLabel="Spend (AUD)"
                    rightLabel="Conversions"
                    leftFormat={(v) => `$${Math.round(v).toLocaleString('en-AU')}`}
                    rightFormat={(v) => Number(v).toFixed(1)}
                    leftColor="var(--color-primary)"
                    rightColor="#10b981"
                  />
                </Section>
              )}

              {searchTerms.length > 0 && (
                <Section title="Search Terms">
                  <SearchTermsTable terms={searchTerms} />
                </Section>
              )}

              {suggestions.length > 0 && (
                <Section title={`Recommendations (${suggestions.length})`}>
                  <AISuggestionsPanel suggestions={suggestions} />
                </Section>
              )}

              {result.costAud != null && (
                <p className="text-xs text-right mt-2" style={{ color: 'var(--color-muted)', fontFamily: 'inherit' }}>
                  Run cost: A${Number(result.costAud).toFixed(4)}
                  {result.tokensUsed?.input != null && (
                    <span> · {fmtNum((result.tokensUsed.input ?? 0) + (result.tokensUsed.output ?? 0))} tokens</span>
                  )}
                </p>
              )}
            </>
          )}
        </>
      )}

      {/* ── Dashboard ──────────────────────────────────────────────────── */}
      {activeTab === 'dashboard' && (
        <div>
          <p className="text-xs mb-4" style={{ color: 'var(--color-muted)', fontFamily: 'inherit' }}>
            Related agents — run against the same date range selected above.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
            <AgentDashboardCard
              slug="google-ads-change-impact"
              title="Change Impact"
              description="Identifies what changed and narrates the performance effect of each change."
              startDate={startDate}
              endDate={endDate}
            />
            <AgentDashboardCard
              slug="google-ads-change-audit"
              title="Change Audit"
              description="Before/after metric comparison per change. Scores each change as Positive, Neutral, or Negative."
              startDate={startDate}
              endDate={endDate}
            />
          </div>
        </div>
      )}

      {/* ── History ────────────────────────────────────────────────────── */}
      {activeTab === 'history' && (
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
          {history.length === 0 ? (
            <div className="p-8 text-center text-sm" style={{ color: 'var(--color-muted)', fontFamily: 'inherit' }}>
              No runs yet.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'inherit' }}>
              <thead>
                <tr style={{ background: 'var(--color-surface)' }}>
                  {['Date', 'Status', 'Cost (AUD)', 'Tokens', ''].map((h) => (
                    <th key={h} style={{
                      padding: '8px 14px', textAlign: h === '' ? 'right' : 'left',
                      fontSize: 11, fontWeight: 600, color: 'var(--color-muted)',
                      textTransform: 'uppercase', letterSpacing: '0.05em',
                      borderBottom: '1px solid var(--color-border)', fontFamily: 'inherit',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((run) => {
                  const tokens = run.result?.tokensUsed
                    ? (run.result.tokensUsed.input ?? 0) + (run.result.tokensUsed.output ?? 0)
                    : null;
                  const statusColor = run.status === 'complete' ? '#16a34a' : run.status === 'error' ? '#dc2626' : '#d97706';
                  return (
                    <tr key={run.id} style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg)' }}>
                      <td style={{ padding: '8px 14px', fontSize: 13, color: 'var(--color-muted)', fontFamily: 'inherit' }}>
                        {fmtDate(run.run_at)}
                      </td>
                      <td style={{ padding: '8px 14px', fontFamily: 'inherit' }}>
                        <span className="text-xs font-semibold" style={{ color: statusColor }}>{run.status}</span>
                      </td>
                      <td style={{ padding: '8px 14px', fontSize: 13, color: 'var(--color-text)', fontFamily: 'inherit' }}>
                        {run.result?.costAud != null ? fmtAud(run.result.costAud) : '—'}
                      </td>
                      <td style={{ padding: '8px 14px', fontSize: 13, color: 'var(--color-muted)', fontFamily: 'inherit' }}>
                        {tokens != null ? fmtNum(tokens) : '—'}
                      </td>
                      <td style={{ padding: '8px 14px', textAlign: 'right' }}>
                        {run.status === 'complete' && run.result && (
                          <button onClick={() => { setResult(run.result); setActiveTab('results'); }}
                            style={{ fontSize: 11, color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                            View
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Settings ───────────────────────────────────────────────────── */}
      {activeTab === 'settings' && config && (
        <div className="rounded-2xl border p-5 space-y-4"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          {cfgSuccess && <InlineBanner type="neutral" message={cfgSuccess} onDismiss={() => setCfgSuccess('')} />}
          <div className="grid grid-cols-2 gap-4">
            {[
              { key: 'lookback_days',             label: 'Default lookback (days)',             type: 'number' },
              { key: 'ctr_low_threshold',         label: 'Low CTR threshold (e.g. 0.03 = 3%)', type: 'number', step: 0.001 },
              { key: 'wasted_clicks_threshold',   label: 'Wasted clicks minimum',               type: 'number' },
              { key: 'impressions_ctr_threshold', label: 'Impressions floor (ad copy check)',   type: 'number' },
              { key: 'max_suggestions',           label: 'Max recommendations',                 type: 'number' },
              { key: 'schedule',                  label: 'Cron schedule (UTC)',                 type: 'text' },
            ].map(({ key, label, type, step }) => (
              <div key={key}>
                <label className="block text-xs font-medium mb-1"
                  style={{ color: 'var(--color-muted)', fontFamily: 'inherit' }}>{label}</label>
                <input type={type} step={step} style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
                  value={config[key] ?? ''}
                  onChange={(e) => setConfig((c) => ({
                    ...c,
                    [key]: type === 'number'
                      ? (step ? parseFloat(e.target.value) : parseInt(e.target.value))
                      : e.target.value,
                  }))}
                />
              </div>
            ))}
          </div>
          <Button variant="primary" onClick={handleSaveConfig} disabled={savingCfg}>
            {savingCfg ? 'Saving…' : 'Save settings'}
          </Button>
        </div>
      )}

      {/* ── Email modal ─────────────────────────────────────────────────── */}
      {emailModal && (
        <EmailModal
          defaultEmail={user?.email ?? ''}
          sending={emailSending}
          onClose={() => setEmailModal(false)}
          onSend={handleEmail}
        />
      )}
    </div>
  );
}
