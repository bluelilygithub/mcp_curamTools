/**
 * CampaignDashboardPage — Management view of Google Ads performance.
 * Shows 90-day charts for management review: spend, conversions, impression
 * share, search terms, and budget pacing.
 *
 * Data: fetched from GET /api/dashboard/campaign-performance
 * Charts: BarChart (Recharts), LineChart (SVG)
 */
import { useState, useEffect, useCallback } from 'react';
import api from '../../api/client';
import LineChart from '../../components/charts/LineChart';
import BarChart from '../../components/charts/BarChart';

// ── Formatters ────────────────────────────────────────────────────────────────

const fmtAud  = (n) => `$${Number(n ?? 0).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const fmtAud2 = (n) => `$${Number(n ?? 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct  = (n) => `${(Number(n ?? 0) * 100).toFixed(1)}%`;
const fmtNum  = (n) => Math.round(n ?? 0).toLocaleString('en-AU');
const fmtDate = (s) => { if (!s) return '—'; const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };

// Shorten long campaign names for chart labels
const shorten = (s, max = 22) => s && s.length > max ? s.slice(0, max - 1) + '…' : (s ?? '');

// ── Date helpers ──────────────────────────────────────────────────────────────

function isoDate(d) { return d.toISOString().slice(0, 10); }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return isoDate(d); }

const PRESETS = [
  { label: '30d', days: 30 },
  { label: '60d', days: 60 },
  { label: '90d', days: 90 },
];

// ── Monthly aggregation for daily data ───────────────────────────────────────

function aggregateByMonth(daily) {
  const map = {};
  for (const row of daily) {
    const month = row.date?.slice(0, 7) ?? '';
    if (!month) continue;
    if (!map[month]) map[month] = { month, cost: 0, conversions: 0, clicks: 0, impressions: 0 };
    map[month].cost        += row.cost        ?? 0;
    map[month].conversions += row.conversions ?? 0;
    map[month].clicks      += row.clicks      ?? 0;
    map[month].impressions += row.impressions ?? 0;
  }
  return Object.values(map).sort((a, b) => a.month.localeCompare(b.month));
}

// ── Styles ────────────────────────────────────────────────────────────────────

const cardStyle = {
  background:   'var(--color-surface)',
  border:       '1px solid var(--color-border)',
  borderRadius: 16,
  padding:      '20px 20px 16px',
  fontFamily:   'inherit',
};

const labelStyle = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.07em',
  color: 'var(--color-muted)',
  marginBottom: 4,
  fontFamily: 'inherit',
};

const statStyle = {
  fontSize: 28,
  fontWeight: 700,
  color: 'var(--color-text)',
  fontFamily: 'inherit',
  lineHeight: 1.2,
};

const subStyle = {
  fontSize: 12,
  color: 'var(--color-muted)',
  marginTop: 2,
  fontFamily: 'inherit',
};

const sectionHeadStyle = {
  fontSize: 13,
  fontWeight: 700,
  color: 'var(--color-text)',
  marginBottom: 12,
  fontFamily: 'inherit',
};

// ── KPI Tile ─────────────────────────────────────────────────────────────────

function KpiTile({ label, value, sub, accent }) {
  return (
    <div style={{ ...cardStyle, borderLeft: accent ? `3px solid ${accent}` : undefined }}>
      <p style={labelStyle}>{label}</p>
      <p style={statStyle}>{value}</p>
      {sub && <p style={subStyle}>{sub}</p>}
    </div>
  );
}

// ── Section card ──────────────────────────────────────────────────────────────

function Card({ title, children, fullWidth }) {
  return (
    <div style={{ ...cardStyle, gridColumn: fullWidth ? '1 / -1' : undefined }}>
      {title && <p style={sectionHeadStyle}>{title}</p>}
      {children}
    </div>
  );
}

// ── Legend ────────────────────────────────────────────────────────────────────

function Legend({ items }) {
  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
      {items.map(({ color, label }) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--color-muted)', fontFamily: 'inherit' }}>
          <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: color }} />
          {label}
        </div>
      ))}
    </div>
  );
}

// ── Context banner ────────────────────────────────────────────────────────────

function ContextBanner({ dateRange }) {
  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 12,
      padding: '12px 18px',
      fontSize: 13,
      color: 'var(--color-muted)',
      fontFamily: 'inherit',
      marginBottom: 20,
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      flexWrap: 'wrap',
    }}>
      <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>Campaign Performance Dashboard</span>
      <span>AU market · $7,500/mo ad spend · avg $50,000/mo revenue · ~6.7× ROAS</span>
      {dateRange && (
        <span style={{ marginLeft: 'auto', fontSize: 12 }}>
          {fmtDate(dateRange.start)} — {fmtDate(dateRange.end)}
        </span>
      )}
    </div>
  );
}

// ── Algorithm sensitivity note ────────────────────────────────────────────────

function AlgorithmNote() {
  return (
    <div style={{
      ...cardStyle,
      borderLeft: '3px solid #f59e0b',
      background: 'rgba(245,158,11,0.06)',
    }}>
      <p style={{ ...sectionHeadStyle, color: '#d97706' }}>Algorithm Sensitivity — Management Note</p>
      <p style={{ fontSize: 13, color: 'var(--color-text)', lineHeight: 1.6, fontFamily: 'inherit' }}>
        Some campaigns and search terms may appear to have a high cost-per-conversion or low CTR in isolation.
        These are intentional. Previous attempts to tighten location targeting or add negative keywords disrupted
        the Google algorithm — which treats these "loss-leader" impressions as positive engagement signals.
        Optimisation decisions should be weighed against the risk of resetting algorithmic trust built over time.
        The current 6.7× ROAS demonstrates the account is performing strongly at a system level.
      </p>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CampaignDashboardPage() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [days,    setDays]    = useState(90);

  const load = useCallback(async (d) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.get(`/dashboard/campaign-performance?days=${d}`);
      setData(result);
    } catch (e) {
      setError(e.message ?? 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(days); }, [load, days]);

  // ── Derived data ────────────────────────────────────────────────────────────

  const campaigns     = data?.campaigns       ?? [];
  const daily         = data?.dailyPerformance ?? [];
  const searchTerms   = data?.searchTerms      ?? [];
  const budgetPacing  = data?.budgetPacing     ?? [];
  const impressionShare = data?.impressionShare ?? [];

  // KPI totals
  const totalSpend       = campaigns.reduce((s, c) => s + (c.cost        ?? 0), 0);
  const totalConversions = campaigns.reduce((s, c) => s + (c.conversions ?? 0), 0);
  const avgCpa           = totalConversions > 0 ? totalSpend / totalConversions : 0;
  const avgCtr           = campaigns.length > 0
    ? campaigns.reduce((s, c) => s + (c.ctr ?? 0), 0) / campaigns.length
    : 0;

  // Date range from daily data
  const dateRange = daily.length > 0
    ? { start: daily[0].date, end: daily[daily.length - 1].date }
    : null;

  // Daily chart data — thin out if >60 points to avoid crowding
  const dailyChartData = daily.map((d) => ({
    date:        d.date?.slice(5) ?? '', // MM-DD
    cost:        d.cost        ?? 0,
    conversions: d.conversions ?? 0,
  }));

  // Monthly summary for ROAS context
  const monthly = aggregateByMonth(daily);

  // Campaign chart data — sorted by cost desc
  const campaignsBySpend = [...campaigns]
    .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0))
    .map((c) => ({ name: shorten(c.name), value: c.cost ?? 0 }));

  const campaignsByConv = [...campaigns]
    .sort((a, b) => (b.conversions ?? 0) - (a.conversions ?? 0))
    .map((c) => ({ name: shorten(c.name), value: Math.round(c.conversions ?? 0) }));

  const campaignsByCpa = [...campaigns]
    .filter((c) => (c.conversions ?? 0) > 0)
    .sort((a, b) => ((b.cost ?? 0) / (b.conversions ?? 1)) - ((a.cost ?? 0) / (a.conversions ?? 1)))
    .map((c) => ({ name: shorten(c.name), value: Math.round((c.cost ?? 0) / (c.conversions ?? 1)) }));

  const campaignsByCtr = [...campaigns]
    .sort((a, b) => (a.ctr ?? 0) - (b.ctr ?? 0))
    .map((c) => ({ name: shorten(c.name), value: parseFloat(((c.ctr ?? 0) * 100).toFixed(2)) }));

  // Impression share — convert fractions to percentages
  const isData = impressionShare.map((row) => ({
    name:         shorten(row.campaign),
    'IS %':       parseFloat(((row.impressionShare ?? 0) * 100).toFixed(1)),
    'Lost: Rank': parseFloat(((row.lostToRank      ?? 0) * 100).toFixed(1)),
    'Lost: Budget': parseFloat(((row.lostToBudget  ?? 0) * 100).toFixed(1)),
  }));

  // Budget pacing
  const pacingData = budgetPacing
    .filter((p) => (p.monthlyBudget ?? 0) > 0)
    .sort((a, b) => (b.spentToDate ?? 0) - (a.spentToDate ?? 0))
    .map((p) => ({
      name:    shorten(p.name),
      Budget:  Math.round(p.monthlyBudget ?? 0),
      Spent:   Math.round(p.spentToDate   ?? 0),
    }));

  // Top converting search terms (top 15 by conversions)
  const topTerms = [...searchTerms]
    .filter((t) => (t.conversions ?? 0) > 0)
    .sort((a, b) => (b.conversions ?? 0) - (a.conversions ?? 0))
    .slice(0, 15)
    .map((t) => ({
      name:  shorten(t.term, 30),
      value: Math.round(t.conversions ?? 0),
    }));

  // Monthly ROAS chart (cost vs assumed revenue $50k/mo avg)
  const monthlyRoas = monthly.map((m) => ({
    month:    m.month?.slice(0, 7) ?? '',
    Spend:    Math.round(m.cost ?? 0),
    Revenue:  50000, // static benchmark — user's stated avg
  }));

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '24px', maxWidth: 1200, margin: '0 auto', fontFamily: 'inherit' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', fontFamily: 'inherit', margin: 0 }}>
          Campaign Performance Dashboard
        </h1>
        <div style={{ display: 'flex', gap: 6 }}>
          {PRESETS.map((p) => (
            <button
              key={p.days}
              onClick={() => setDays(p.days)}
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                border: '1px solid var(--color-border)',
                background: days === p.days ? 'var(--color-primary)' : 'var(--color-surface)',
                color: days === p.days ? '#fff' : 'var(--color-text)',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <ContextBanner dateRange={dateRange} />

      {/* Loading / error states */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--color-muted)', fontSize: 14, fontFamily: 'inherit' }}>
          Loading data…
        </div>
      )}

      {error && (
        <div style={{
          background: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: 12,
          padding: '14px 18px',
          color: '#ef4444',
          fontSize: 13,
          fontFamily: 'inherit',
          marginBottom: 20,
        }}>
          Error loading data: {error}
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* ── KPI tiles ──────────────────────────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
            <KpiTile
              label="Total Ad Spend"
              value={fmtAud(totalSpend)}
              sub={`${days} days · $7,500/mo budget`}
              accent="var(--color-primary)"
            />
            <KpiTile
              label="Total Conversions"
              value={fmtNum(totalConversions)}
              sub="Tracked conversions (leads/enquiries)"
            />
            <KpiTile
              label="Avg Cost per Conversion"
              value={fmtAud2(avgCpa)}
              sub="All campaigns combined"
              accent={avgCpa > 200 ? '#ef4444' : avgCpa > 120 ? '#f59e0b' : '#10b981'}
            />
            <KpiTile
              label="Avg Click-Through Rate"
              value={fmtPct(avgCtr)}
              sub="Across all active campaigns"
            />
            <KpiTile
              label="Revenue Context"
              value="~$50,000/mo"
              sub="Avg revenue · 6.7× ROAS on ad spend"
              accent="#10b981"
            />
          </div>

          {/* ── Daily trend ────────────────────────────────────────────────── */}
          <Card title="Daily Spend vs Conversions" fullWidth>
            <p style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 12, fontFamily: 'inherit' }}>
              Daily ad spend (AUD, left axis) against conversion count (right axis). Correlate spend spikes with conversion responses.
            </p>
            <Legend items={[
              { color: 'var(--color-primary)', label: 'Daily Spend (AUD)' },
              { color: '#10b981',              label: 'Conversions' },
            ]} />
            <LineChart
              data={dailyChartData}
              xKey="date"
              leftKey="cost"
              rightKey="conversions"
              leftLabel="Spend"
              rightLabel="Conversions"
              leftFormat={(v) => fmtAud(v)}
              rightFormat={(v) => fmtNum(v)}
              leftColor="var(--color-primary)"
              rightColor="#10b981"
              height={220}
            />
          </Card>

          {/* ── Two-column: Campaign spend + conversions ────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
            <Card title="Ad Spend by Campaign">
              <p style={{ ...subStyle, marginBottom: 10 }}>Total spend over period, highest first.</p>
              <BarChart
                data={campaignsBySpend}
                dataKey="value"
                horizontal={true}
                labelKey="name"
                formatValue={(v) => fmtAud(v)}
                height={Math.max(180, campaignsBySpend.length * 32)}
                colors={['var(--color-primary)']}
              />
            </Card>

            <Card title="Conversions by Campaign">
              <p style={{ ...subStyle, marginBottom: 10 }}>Total tracked conversions, highest first.</p>
              <BarChart
                data={campaignsByConv}
                dataKey="value"
                horizontal={true}
                labelKey="name"
                formatValue={(v) => String(v)}
                height={Math.max(180, campaignsByConv.length * 32)}
                colors={['#10b981']}
              />
            </Card>
          </div>

          {/* ── Two-column: CPA + CTR ───────────────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
            <Card title="Cost per Conversion by Campaign">
              <p style={{ ...subStyle, marginBottom: 10 }}>
                Highest CPA first — campaigns with no conversions excluded.
                Some high-CPA campaigns provide algorithm signals; see note below.
              </p>
              <BarChart
                data={campaignsByCpa}
                dataKey="value"
                horizontal={true}
                labelKey="name"
                formatValue={(v) => `$${v}`}
                height={Math.max(180, campaignsByCpa.length * 32)}
                colors={['#f59e0b']}
              />
            </Card>

            <Card title="Click-Through Rate by Campaign">
              <p style={{ ...subStyle, marginBottom: 10 }}>Lowest CTR first — highlights campaigns needing copy review.</p>
              <BarChart
                data={campaignsByCtr}
                dataKey="value"
                horizontal={true}
                labelKey="name"
                formatValue={(v) => `${v}%`}
                height={Math.max(180, campaignsByCtr.length * 32)}
                colors={['#6366f1']}
              />
            </Card>
          </div>

          {/* ── Impression share (full width) ──────────────────────────────── */}
          {isData.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <Card title="Impression Share by Campaign" fullWidth>
                <p style={{ ...subStyle, marginBottom: 10 }}>
                  IS% = share of eligible impressions captured. Lost to Rank = outbid. Lost to Budget = budget exhausted before auction.
                  AU small-population market inherently limits available impressions.
                </p>
                <Legend items={[
                  { color: '#10b981', label: 'Impression Share %' },
                  { color: '#f59e0b', label: 'Lost to Rank %' },
                  { color: '#ef4444', label: 'Lost to Budget %' },
                ]} />
                <BarChart
                  data={isData}
                  dataKey={['IS %', 'Lost: Rank', 'Lost: Budget']}
                  horizontal={true}
                  labelKey="name"
                  formatValue={(v) => `${v}%`}
                  height={Math.max(200, isData.length * 42)}
                  colors={['#10b981', '#f59e0b', '#ef4444']}
                />
              </Card>
            </div>
          )}

          {/* ── Budget pacing + search terms ───────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
            {pacingData.length > 0 && (
              <Card title="Budget Pacing — Current Month">
                <p style={{ ...subStyle, marginBottom: 10 }}>Monthly budget vs spend-to-date. Campaigns over 90% spent risk running out before month end.</p>
                <Legend items={[
                  { color: '#6366f1', label: 'Monthly Budget' },
                  { color: '#10b981', label: 'Spent to Date' },
                ]} />
                <BarChart
                  data={pacingData}
                  dataKey={['Budget', 'Spent']}
                  horizontal={true}
                  labelKey="name"
                  formatValue={(v) => fmtAud(v)}
                  height={Math.max(180, pacingData.length * 42)}
                  colors={['#6366f1', '#10b981']}
                />
              </Card>
            )}

            {topTerms.length > 0 && (
              <Card title="Top Converting Search Terms">
                <p style={{ ...subStyle, marginBottom: 10 }}>Terms that directly generated conversions. These are your highest-value trigger phrases.</p>
                <BarChart
                  data={topTerms}
                  dataKey="value"
                  horizontal={true}
                  labelKey="name"
                  formatValue={(v) => String(v)}
                  height={Math.max(220, topTerms.length * 28)}
                  colors={['#10b981']}
                />
              </Card>
            )}
          </div>

          {/* ── Monthly spend vs revenue benchmark ────────────────────────── */}
          {monthlyRoas.length > 1 && (
            <div style={{ marginTop: 12 }}>
              <Card title="Monthly Spend vs Revenue Benchmark" fullWidth>
                <p style={{ ...subStyle, marginBottom: 10 }}>
                  Ad spend each month (actual) vs $50,000 average revenue benchmark (stated).
                  Spend should remain well below the benchmark to maintain positive ROAS.
                </p>
                <Legend items={[
                  { color: 'var(--color-primary)', label: 'Ad Spend (AUD)' },
                  { color: '#10b981',              label: 'Revenue Benchmark (AUD)' },
                ]} />
                <LineChart
                  data={monthlyRoas}
                  xKey="month"
                  leftKey="Spend"
                  rightKey="Revenue"
                  leftLabel="Spend"
                  rightLabel="Revenue"
                  leftFormat={(v) => fmtAud(v)}
                  rightFormat={(v) => fmtAud(v)}
                  leftColor="var(--color-primary)"
                  rightColor="#10b981"
                  height={180}
                />
              </Card>
            </div>
          )}

          {/* ── Algorithm note ─────────────────────────────────────────────── */}
          <div style={{ marginTop: 12 }}>
            <AlgorithmNote />
          </div>
        </>
      )}
    </div>
  );
}
