/**
 * GoogleAdsMonitorPage — Google Ads performance analysis tool.
 *
 * Three panels:
 *   1. Run panel — date range selector, Run Now button, SSE progress
 *   2. Results panel — Summary (markdown), Campaign table, Chart, Search terms, Suggestions
 *   3. Settings panel — operator config (thresholds, schedule, lookback)
 *
 * History panel — past runs with status, cost, date
 */
import { useState, useEffect, useRef } from 'react';
import api from '../../api/client';
import Button from '../../components/ui/Button';
import InlineBanner from '../../components/ui/InlineBanner';
import MarkdownRenderer from '../../components/ui/MarkdownRenderer';
import LineChart from '../../components/charts/LineChart';
import CampaignPerformanceTable from './GoogleAdsMonitor/CampaignPerformanceTable';
import SearchTermsTable from './GoogleAdsMonitor/SearchTermsTable';
import AISuggestionsPanel from './GoogleAdsMonitor/AISuggestionsPanel';

const AGENT_SLUG = 'google-ads-monitor';

const DAY_PRESETS = [
  { label: '7d',  days: 7 },
  { label: '14d', days: 14 },
  { label: '30d', days: 30 },
  { label: '60d', days: 60 },
  { label: '90d', days: 90 },
];

const fi = {
  padding: '0.4rem 0.6rem', borderRadius: '0.5rem',
  border: '1px solid var(--color-border)', background: 'var(--color-bg)',
  color: 'var(--color-text)', fontSize: '0.8rem', outline: 'none',
};

function Section({ title, children }) {
  return (
    <div className="rounded-2xl border overflow-hidden mb-4"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
      <div className="px-4 py-2.5 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
          {title}
        </p>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export default function GoogleAdsMonitorPage() {
  const [days,       setDays]       = useState(30);
  const [running,    setRunning]    = useState(false);
  const [progress,   setProgress]   = useState([]);
  const [error,      setError]      = useState('');
  const [result,     setResult]     = useState(null);   // latest run result payload
  const [history,    setHistory]    = useState([]);
  const [config,     setConfig]     = useState(null);
  const [savingCfg,  setSavingCfg]  = useState(false);
  const [cfgSuccess, setCfgSuccess] = useState('');
  const [activeTab,  setActiveTab]  = useState('results'); // 'results' | 'history' | 'settings'
  const abortRef = useRef(null);

  // ── Load history + config on mount ───────────────────────────────────────

  useEffect(() => {
    loadHistory();
    loadConfig();
  }, []);

  async function loadHistory() {
    try {
      const rows = await api.get(`/agents/${AGENT_SLUG}/history`);
      setHistory(rows);
      // Pre-populate result from most recent completed run
      const latest = rows.find((r) => r.status === 'complete');
      if (latest?.result && !result) setResult(latest.result);
    } catch {
      // non-fatal
    }
  }

  async function loadConfig() {
    try {
      const cfg = await api.get(`/agent-configs/${AGENT_SLUG}`);
      setConfig(cfg);
    } catch {
      // use defaults
    }
  }

  // ── Run ───────────────────────────────────────────────────────────────────

  async function handleRun() {
    setRunning(true);
    setProgress([]);
    setError('');

    try {
      const res = await api.stream(`/agents/${AGENT_SLUG}/run`, { days });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      abortRef.current = reader;

      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') { setRunning(false); loadHistory(); return; }
          try {
            const msg = JSON.parse(raw);
            if (msg.type === 'progress') {
              setProgress((p) => [...p, msg.text]);
            } else if (msg.type === 'result') {
              setResult(msg.data);
              setActiveTab('results');
            } else if (msg.type === 'error') {
              setError(msg.error);
            }
          } catch {
            // ignore malformed line
          }
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
      loadHistory();
    }
  }

  // ── Save config ───────────────────────────────────────────────────────────

  async function handleSaveConfig() {
    setSavingCfg(true);
    try {
      const updated = await api.put(`/agent-configs/${AGENT_SLUG}`, config);
      setConfig(updated);
      setCfgSuccess('Settings saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingCfg(false);
    }
  }

  // ── Derived data ──────────────────────────────────────────────────────────

  const campaigns   = result?.data?.get_campaign_performance ?? [];
  const dailyData   = result?.data?.get_daily_performance    ?? [];
  const searchTerms = result?.data?.get_search_terms         ?? [];
  const suggestions = result?.suggestions                    ?? [];
  const summary     = result?.summary                        ?? '';

  // ── Render ────────────────────────────────────────────────────────────────

  const tabStyle = (tab) => ({
    padding: '0.4rem 0.9rem', fontSize: '0.8rem', fontWeight: 500,
    borderRadius: '0.5rem', cursor: 'pointer', border: 'none',
    background: activeTab === tab ? 'var(--color-primary)' : 'transparent',
    color: activeTab === tab ? '#fff' : 'var(--color-muted)',
  });

  return (
    <div className="p-5 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
            Google Ads Monitor
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
            AI-powered campaign analysis, search intent, and budget pacing.
          </p>
        </div>

        {/* Date range + run */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1 rounded-lg p-1" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            {DAY_PRESETS.map((p) => (
              <button
                key={p.days}
                onClick={() => setDays(p.days)}
                style={{
                  padding: '3px 10px', fontSize: 12, borderRadius: 6, border: 'none', cursor: 'pointer',
                  background: days === p.days ? 'var(--color-primary)' : 'transparent',
                  color: days === p.days ? '#fff' : 'var(--color-muted)',
                  fontWeight: days === p.days ? 600 : 400,
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <Button variant="primary" onClick={handleRun} disabled={running}>
            {running ? 'Running…' : 'Run now'}
          </Button>
        </div>
      </div>

      {error && <InlineBanner type="error" message={error} onDismiss={() => setError('')} className="mb-4" />}

      {/* Progress */}
      {running && progress.length > 0 && (
        <div className="rounded-xl border px-4 py-3 mb-4 space-y-1"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          {progress.map((p, i) => (
            <p key={i} className="text-xs" style={{ color: 'var(--color-muted)' }}>
              <span style={{ color: 'var(--color-primary)', marginRight: 6 }}>›</span>{p}
            </p>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4">
        {['results', 'history', 'settings'].map((t) => (
          <button key={t} style={tabStyle(t)} onClick={() => setActiveTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* ── Results tab ─────────────────────────────────────────────────── */}
      {activeTab === 'results' && (
        <>
          {!result && !running && (
            <div className="rounded-2xl border p-10 text-center text-sm"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
              No results yet. Click "Run now" to analyse your account.
            </div>
          )}

          {result && (
            <>
              {summary && (
                <Section title="Summary">
                  <MarkdownRenderer content={summary} />
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
                    leftFormat={(v) => `$${Number(v).toFixed(0)}`}
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
                <p className="text-xs text-right mt-2" style={{ color: 'var(--color-muted)' }}>
                  Run cost: A${Number(result.costAud).toFixed(4)}
                  {result.tokensUsed?.input != null && (
                    <span> · {(result.tokensUsed.input + result.tokensUsed.output).toLocaleString()} tokens</span>
                  )}
                </p>
              )}
            </>
          )}
        </>
      )}

      {/* ── History tab ─────────────────────────────────────────────────── */}
      {activeTab === 'history' && (
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
          {history.length === 0 ? (
            <div className="p-8 text-center text-sm" style={{ color: 'var(--color-muted)' }}>No runs yet.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--color-surface)' }}>
                  {['Date', 'Status', 'Cost', 'Tokens', ''].map((h) => (
                    <th key={h} style={{
                      padding: '8px 14px', textAlign: h === '' ? 'right' : 'left',
                      fontSize: 11, fontWeight: 600, color: 'var(--color-muted)',
                      textTransform: 'uppercase', letterSpacing: '0.05em',
                      borderBottom: '1px solid var(--color-border)',
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
                    <tr key={run.id} style={{ background: 'var(--color-bg)', borderBottom: '1px solid var(--color-border)' }}>
                      <td style={{ padding: '8px 14px', fontSize: 12, color: 'var(--color-muted)' }}>
                        {new Date(run.run_at).toLocaleString()}
                      </td>
                      <td style={{ padding: '8px 14px' }}>
                        <span className="text-xs font-semibold" style={{ color: statusColor }}>
                          {run.status}
                        </span>
                      </td>
                      <td style={{ padding: '8px 14px', fontSize: 12, color: 'var(--color-text)' }}>
                        {run.result?.costAud != null ? `A$${Number(run.result.costAud).toFixed(4)}` : '—'}
                      </td>
                      <td style={{ padding: '8px 14px', fontSize: 12, color: 'var(--color-muted)' }}>
                        {tokens != null ? tokens.toLocaleString() : '—'}
                      </td>
                      <td style={{ padding: '8px 14px', textAlign: 'right' }}>
                        {run.status === 'complete' && run.result && (
                          <button
                            onClick={() => { setResult(run.result); setActiveTab('results'); }}
                            style={{ fontSize: 11, color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer' }}
                          >
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

      {/* ── Settings tab ─────────────────────────────────────────────────── */}
      {activeTab === 'settings' && config && (
        <div className="rounded-2xl border p-5 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          {cfgSuccess && <InlineBanner type="neutral" message={cfgSuccess} onDismiss={() => setCfgSuccess('')} />}

          <div className="grid grid-cols-2 gap-4">
            {[
              { key: 'lookback_days',             label: 'Default lookback (days)', type: 'number' },
              { key: 'ctr_low_threshold',         label: 'Low CTR threshold (decimal)', type: 'number', step: 0.001 },
              { key: 'wasted_clicks_threshold',   label: 'Wasted clicks min', type: 'number' },
              { key: 'impressions_ctr_threshold', label: 'Impressions floor (ad copy check)', type: 'number' },
              { key: 'max_suggestions',           label: 'Max recommendations', type: 'number' },
              { key: 'schedule',                  label: 'Cron schedule (UTC)', type: 'text' },
            ].map(({ key, label, type, step }) => (
              <div key={key}>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>
                  {label}
                </label>
                <input
                  type={type}
                  step={step}
                  style={fi}
                  value={config[key] ?? ''}
                  onChange={(e) => setConfig((c) => ({
                    ...c,
                    [key]: type === 'number' ? (step ? parseFloat(e.target.value) : parseInt(e.target.value)) : e.target.value,
                  }))}
                />
              </div>
            ))}
          </div>

          <div className="pt-1">
            <Button variant="primary" onClick={handleSaveConfig} disabled={savingCfg}>
              {savingCfg ? 'Saving…' : 'Save settings'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
