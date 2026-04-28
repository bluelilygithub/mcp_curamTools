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
import {
  BarChart as ReBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from 'recharts';

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
  { label: '7d',  key: '7d',  getRange: () => ({ start: daysAgo(7),  end: isoDate(new Date()) }) },
  { label: '14d', key: '14d', getRange: () => ({ start: daysAgo(14), end: isoDate(new Date()) }) },
  { label: '30d', key: '30d', getRange: () => ({ start: daysAgo(30), end: isoDate(new Date()) }) },
  { label: '60d', key: '60d', getRange: () => ({ start: daysAgo(60), end: isoDate(new Date()) }) },
  { label: '90d', key: '90d', getRange: () => ({ start: daysAgo(90), end: isoDate(new Date()) }) },
];

const inputStyle = {
  padding: '0.4rem 0.6rem', borderRadius: '0.5rem',
  border: '1px solid var(--color-border)', background: 'var(--color-bg)',
  color: 'var(--color-text)', fontSize: '0.8rem', outline: 'none',
  fontFamily: 'inherit',
};

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

// ── ROI Section ───────────────────────────────────────────────────────────────

const TOOLTIP_STYLE = {
  background:   'var(--color-surface, #1e293b)',
  border:       '1px solid var(--color-border, #334155)',
  borderRadius: 8,
  color:        'var(--color-text, #f1f5f9)',
  fontSize:     12,
  fontFamily:   'inherit',
};

const INDUSTRY_ROAS  = 3.5;
const TARGET_ROAS    = 5.56; // 50000 / 9000 (ads + mgmt)

function fmtMonthLabel(m) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [y, mo] = m.split('-');
  return `${months[parseInt(mo, 10) - 1]} '${y.slice(2)}`;
}

function roasBarColor(roas) {
  if (roas === null) return 'var(--color-border)';
  if (roas >= TARGET_ROAS)   return '#10b981';
  if (roas >= INDUSTRY_ROAS) return '#f59e0b';
  return '#ef4444';
}

function RoiSection({ roiData, loading, error }) {
  if (loading) {
    return (
      <div style={{ ...cardStyle, textAlign: 'center', padding: '32px', color: 'var(--color-muted)', fontSize: 13 }}>
        Loading ROI data…
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ ...cardStyle, borderLeft: '3px solid #ef4444' }}>
        <p style={{ fontSize: 13, color: '#ef4444', fontFamily: 'inherit' }}>
          ROI data error: {error}
        </p>
      </div>
    );
  }
  if (!roiData) return null;

  const { monthly = [], totals = {}, meta = {} } = roiData;
  const chartData = monthly.map((m) => ({ ...m, label: fmtMonthLabel(m.month) }));

  const roasChartData = chartData.map((m) => ({
    label:        m.label,
    roas:         m.roas,
    industryRoas: INDUSTRY_ROAS,
    targetRoas:   TARGET_ROAS,
  }));

  const noRevenue = !meta.wordpressAvailable || totals.revenue === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>

      {/* Section header */}
      <div style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: 10, marginBottom: 2 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text)', fontFamily: 'inherit', margin: 0 }}>
          ROI &amp; Value for Money
        </h2>
        <p style={{ fontSize: 12, color: 'var(--color-muted)', marginTop: 4, fontFamily: 'inherit' }}>
          Total investment (ad spend + $1,500/mo management) vs actual CRM revenue vs industry benchmark.
          Industry: Car Detailing AU Google Ads avg 3–5× ROAS (3.5× conservative). Target: $50k/mo revenue.
        </p>
      </div>

      {/* WordPress unavailable warning */}
      {!meta.wordpressAvailable && (
        <div style={{ ...cardStyle, borderLeft: '3px solid #f59e0b', background: 'rgba(245,158,11,0.06)', padding: '12px 16px' }}>
          <p style={{ fontSize: 13, color: '#d97706', fontFamily: 'inherit' }}>
            WordPress CRM not connected — revenue data unavailable. Cost and ROAS bars reflect ad spend only.
            Connect the WordPress MCP server in Admin › MCP Servers to show actual revenue.
          </p>
        </div>
      )}

      {/* KPI tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <KpiTile
          label="Total Investment"
          value={fmtAud(totals.totalCost)}
          sub={`Ad spend $${Math.round(totals.adSpend).toLocaleString('en-AU')} + mgmt $${Math.round(totals.mgmtFee).toLocaleString('en-AU')}`}
          accent="var(--color-primary)"
        />
        <KpiTile
          label="Actual Revenue (CRM)"
          value={noRevenue ? 'No data' : fmtAud(totals.revenue)}
          sub={noRevenue ? 'final_value not available' : `${meta.months} months of enquiries`}
          accent={noRevenue ? 'var(--color-border)' : '#10b981'}
        />
        <KpiTile
          label="Actual ROAS"
          value={totals.periodRoas != null ? `${totals.periodRoas}×` : '—'}
          sub={`Industry avg: ${INDUSTRY_ROAS}× | Target: ${TARGET_ROAS}×`}
          accent={
            totals.periodRoas == null     ? undefined
            : totals.periodRoas >= TARGET_ROAS   ? '#10b981'
            : totals.periodRoas >= INDUSTRY_ROAS ? '#f59e0b'
            : '#ef4444'
          }
        />
        <KpiTile
          label="Net Return"
          value={totals.revenue > 0 ? fmtAud(totals.netReturn) : '—'}
          sub="Revenue minus total investment"
          accent={totals.revenue > 0 ? (totals.netReturn > 0 ? '#10b981' : '#ef4444') : 'var(--color-border)'}
        />
        <KpiTile
          label="vs $50k/mo Target"
          value={
            totals.revenue > 0
              ? `${totals.revenueGap >= 0 ? '+' : ''}${fmtAud(totals.revenueGap)}`
              : '—'
          }
          sub={`Target: ${fmtAud(50000 * meta.months)} over ${meta.months} months`}
          accent={totals.revenue > 0 ? (totals.revenueGap >= 0 ? '#10b981' : '#ef4444') : 'var(--color-border)'}
        />
        <KpiTile
          label="Industry Benchmark Rev"
          value={fmtAud(totals.totalCost * INDUSTRY_ROAS)}
          sub={`${INDUSTRY_ROAS}× of total cost — industry expectation`}
          accent="#6366f1"
        />
      </div>

      {/* Revenue vs Investment chart */}
      <div style={cardStyle}>
        <p style={sectionHeadStyle}>Monthly Revenue vs Investment</p>
        <p style={{ ...subStyle, marginBottom: 10 }}>
          Stacked bars show total monthly investment (ad spend + management fee).
          Revenue bar shows actual CRM final_value for enquiries in that month.
          Industry benchmark revenue = 3.5× total cost. Target = $50,000/mo.
        </p>
        <Legend items={[
          { color: '#6366f1', label: 'Ad Spend' },
          { color: '#8b5cf6', label: 'Management Fee ($1,500/mo)' },
          { color: '#10b981', label: 'Actual Revenue (CRM)' },
        ]} />
        <ResponsiveContainer width="100%" height={260}>
          <ReBarChart
            data={chartData}
            margin={{ top: 8, right: 80, bottom: 4, left: 8 }}
            barGap={6}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" opacity={0.5} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--color-muted)', fontFamily: 'inherit' }} />
            <YAxis
              tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
              tick={{ fontSize: 11, fill: 'var(--color-muted)', fontFamily: 'inherit' }}
              width={48}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(val, name) => [`$${Math.round(val).toLocaleString('en-AU')}`, name]}
            />
            {/* Stacked investment bars */}
            <Bar dataKey="adSpend"  stackId="cost" fill="#6366f1" name="Ad Spend"         maxBarSize={48} />
            <Bar dataKey="mgmtFee"  stackId="cost" fill="#8b5cf6" name="Management Fee"   maxBarSize={48} radius={[3,3,0,0]} />
            {/* Revenue bar — separate group */}
            <Bar dataKey="revenue"  fill="#10b981"  name="Actual Revenue"                 maxBarSize={48} radius={[3,3,0,0]} />
            {/* Reference lines */}
            <ReferenceLine
              y={50000}
              stroke="#f59e0b"
              strokeDasharray="6 3"
              strokeWidth={1.5}
              label={{ value: 'Target $50k', position: 'right', fontSize: 11, fill: '#f59e0b', fontFamily: 'inherit' }}
            />
          </ReBarChart>
        </ResponsiveContainer>
        {noRevenue && (
          <p style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 6, fontFamily: 'inherit' }}>
            Revenue bars are $0 — WordPress CRM final_value data not available for this period.
          </p>
        )}
      </div>

      {/* ROAS comparison chart */}
      <div style={cardStyle}>
        <p style={sectionHeadStyle}>Monthly ROAS vs Benchmarks</p>
        <p style={{ ...subStyle, marginBottom: 10 }}>
          Return on total investment (revenue ÷ total cost including management fee).
          Green = above target ({TARGET_ROAS}×). Amber = above industry average ({INDUSTRY_ROAS}×). Red = below industry average.
        </p>
        <Legend items={[
          { color: '#10b981', label: `Above target (≥${TARGET_ROAS}×)` },
          { color: '#f59e0b', label: `Above industry avg (${INDUSTRY_ROAS}–${TARGET_ROAS}×)` },
          { color: '#ef4444', label: `Below industry avg (<${INDUSTRY_ROAS}×)` },
          { color: '#f59e0b', label: `Industry benchmark line (${INDUSTRY_ROAS}×)` },
          { color: '#10b981', label: `Target line (~${TARGET_ROAS}×)` },
        ]} />
        <ResponsiveContainer width="100%" height={220}>
          <ReBarChart data={roasChartData} margin={{ top: 8, right: 80, bottom: 4, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" opacity={0.5} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--color-muted)', fontFamily: 'inherit' }} />
            <YAxis
              tickFormatter={(v) => `${v}×`}
              tick={{ fontSize: 11, fill: 'var(--color-muted)', fontFamily: 'inherit' }}
              width={36}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(val, name) => {
                if (name === 'roas') return [`${val !== null ? val + '×' : 'No data'}`, 'Actual ROAS'];
                return [null, null]; // hide benchmark keys from tooltip
              }}
            />
            <Bar dataKey="roas" name="roas" maxBarSize={48} radius={[3,3,0,0]}>
              {roasChartData.map((entry, i) => (
                <Cell key={i} fill={roasBarColor(entry.roas)} />
              ))}
            </Bar>
            <ReferenceLine
              y={INDUSTRY_ROAS}
              stroke="#f59e0b"
              strokeDasharray="6 3"
              strokeWidth={1.5}
              label={{ value: `Industry ${INDUSTRY_ROAS}×`, position: 'right', fontSize: 11, fill: '#f59e0b', fontFamily: 'inherit' }}
            />
            <ReferenceLine
              y={TARGET_ROAS}
              stroke="#10b981"
              strokeDasharray="6 3"
              strokeWidth={1.5}
              label={{ value: `Target ${TARGET_ROAS}×`, position: 'right', fontSize: 11, fill: '#10b981', fontFamily: 'inherit' }}
            />
          </ReBarChart>
        </ResponsiveContainer>
        {noRevenue && (
          <p style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 6, fontFamily: 'inherit' }}>
            ROAS bars unavailable — requires revenue data from WordPress CRM.
          </p>
        )}
      </div>

      {/* Methodology note */}
      <div style={{ ...cardStyle, background: 'rgba(99,102,241,0.04)', borderLeft: '3px solid #6366f1', padding: '12px 16px' }}>
        <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)', fontFamily: 'inherit', marginBottom: 4 }}>Methodology</p>
        <p style={{ fontSize: 12, color: 'var(--color-muted)', lineHeight: 1.6, fontFamily: 'inherit' }}>
          <strong>Investment:</strong> Google Ads spend (actual) + $1,500/mo management fee (prorated for partial months). &nbsp;
          <strong>Revenue:</strong> Sum of <code>final_value</code> on <code>clientenquiry</code> CRM records, dated by <code>invoiced_date</code> → <code>completion_date</code> → enquiry date (first available).
          Enquiries submitted up to 180 days before the range start are included so older jobs invoiced within the period are captured.
          Only records with a revenue date within the selected range and a recorded <code>final_value</code> are counted. &nbsp;
          <strong>Industry benchmark:</strong> Car Detailing / Auto Detailing AU, Google Ads average 3–5× ROAS (WordStream).
          3.5× used as the conservative lower bound.
        </p>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CampaignDashboardPage() {
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [roiData,     setRoiData]     = useState(null);
  const [roiLoading,  setRoiLoading]  = useState(true);
  const [roiError,    setRoiError]    = useState(null);
  const [activePreset, setActivePreset] = useState('90d');
  const [startDate,   setStartDate]   = useState(daysAgo(90));
  const [endDate,     setEndDate]     = useState(isoDate(new Date()));

  function applyPreset(preset) {
    setActivePreset(preset.key);
    const { start, end } = preset.getRange();
    setStartDate(start);
    setEndDate(end);
  }

  function onDateChange(field, value) {
    setActivePreset(null);
    if (field === 'start') setStartDate(value);
    else setEndDate(value);
  }

  const load = useCallback(async (sd, ed) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.get(`/dashboard/campaign-performance?startDate=${sd}&endDate=${ed}`);
      setData(result);
    } catch (e) {
      setError(e.message ?? 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRoi = useCallback(async (sd, ed) => {
    setRoiLoading(true);
    setRoiError(null);
    try {
      const result = await api.get(`/dashboard/roi-analysis?startDate=${sd}&endDate=${ed}`);
      setRoiData(result);
    } catch (e) {
      setRoiError(e.message ?? 'Failed to load ROI data');
    } finally {
      setRoiLoading(false);
    }
  }, []);

  useEffect(() => { load(startDate, endDate);    }, [load,    startDate, endDate]);
  useEffect(() => { loadRoi(startDate, endDate); }, [loadRoi, startDate, endDate]);

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
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', fontFamily: 'inherit', margin: 0 }}>
          Campaign Performance Dashboard
        </h1>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          {/* Preset buttons */}
          <div style={{ display: 'flex', gap: 1, borderRadius: 8, padding: 4, background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            {PRESETS.map((p) => (
              <button
                key={p.key}
                onClick={() => applyPreset(p)}
                style={{
                  padding: '3px 10px',
                  borderRadius: 6,
                  border: 'none',
                  background: activePreset === p.key ? 'var(--color-primary)' : 'transparent',
                  color: activePreset === p.key ? '#fff' : 'var(--color-muted)',
                  fontSize: 12,
                  fontWeight: activePreset === p.key ? 600 : 400,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
              }}
            >
              {p.label}
            </button>
          ))}
          </div>
          {/* Custom date pickers */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--color-muted)', fontFamily: 'inherit' }}>From</span>
              <input
                key={`start-${startDate}`}
                type="date"
                value={startDate}
                max={endDate}
                onChange={(e) => onDateChange('start', e.target.value)}
                style={inputStyle}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--color-muted)', fontFamily: 'inherit' }}>To</span>
              <input
                key={`end-${endDate}`}
                type="date"
                value={endDate}
                min={startDate}
                max={isoDate(new Date())}
                onChange={(e) => onDateChange('end', e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>
        </div>
      </div>

      <ContextBanner dateRange={{ start: startDate, end: endDate }} />

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
              sub={`${fmtDate(startDate)} – ${fmtDate(endDate)} · $7,500/mo budget`}
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

      {/* ── ROI Analysis section — always shown, loads independently ────── */}
      <div style={{ marginTop: 24, borderTop: '1px solid var(--color-border)', paddingTop: 24 }}>
        <RoiSection roiData={roiData} loading={roiLoading} error={roiError} />
      </div>
    </div>
  );
}
