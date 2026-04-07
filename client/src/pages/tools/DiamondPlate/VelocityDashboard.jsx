/**
 * VelocityDashboard — charts + narrative for the Lead Velocity agent result.
 *
 * Receives:
 *   result        — full SSE result payload from lead-velocity agent
 *   onAskQuestion — (questionText) => void — fires the conversation tab with a preset question
 */
import BarChart    from '../../../components/charts/BarChart';
import HeatmapGrid from '../../../components/charts/HeatmapGrid';
import ScatterPlot from '../../../components/charts/ScatterPlot';
import MarkdownRenderer from '../../../components/ui/MarkdownRenderer';

const PRESET_QUESTIONS = [
  {
    label: 'Which campaigns convert with fewest touchpoints?',
    q: 'Which ad campaigns produce leads that convert with the fewest follow-up touchpoints? Compare average touchpoints and days-to-close by campaign and rank them from most efficient to least.',
  },
  {
    label: 'Show me stale leads with no follow-up',
    q: 'Show me all leads that are in an open status (new, contacted, or emailed) and have had no follow-up activity for more than 7 days. How many are there and what is the total potential value at risk?',
  },
  {
    label: 'Response time vs conversion — is there a link?',
    q: 'Does responding to leads faster lead to higher conversion rates in our data? Compare conversion rates for same-day, next-day, and later response times.',
  },
  {
    label: 'Which lead sources convert fastest?',
    q: 'Which enquiry sources (website, phone, email, chatbot, facebook) produce leads that convert the fastest and with the fewest touchpoints?',
  },
  {
    label: 'Why are we losing 70% of enquiries?',
    q: 'Based on the velocity and follow-up data, what are the main reasons we are not converting more than 30% of online enquiries? What specific process failures are visible in the data?',
  },
  {
    label: 'Training opportunities — who needs support?',
    q: 'Based on follow-up patterns — response times, touchpoint counts, action types used — where are the most significant training opportunities? Which behaviours, if changed, would have the highest impact on conversion?',
  },
];

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }) {
  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: 'var(--color-bg)',
        border: `1px solid ${accent ? 'var(--color-primary)' : 'var(--color-border)'}`,
      }}
    >
      <p style={{ fontSize: 11, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
        {label}
      </p>
      <p style={{ fontSize: 22, fontWeight: 700, color: accent ? 'var(--color-primary)' : 'var(--color-text)', lineHeight: 1 }}>
        {value ?? '—'}
      </p>
      {sub && <p style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 4 }}>{sub}</p>}
    </div>
  );
}

// ── Stale leads table ─────────────────────────────────────────────────────────

function StaleTable({ leads }) {
  if (!leads?.length) return <p style={{ fontSize: 13, color: 'var(--color-muted)' }}>No stale leads detected.</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--color-surface)' }}>
            {['ID', 'Date', 'Status', 'Campaign', 'Days since contact', 'Touchpoints'].map((h) => (
              <th key={h} className="px-3 py-2 text-left text-xs font-semibold" style={{ color: 'var(--color-muted)', borderBottom: '1px solid var(--color-border)' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => (
            <tr key={lead.id} style={{ borderTop: '1px solid var(--color-border)' }}>
              <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-muted)' }}>{lead.id}</td>
              <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-text)' }}>
                {lead.date ? new Date(lead.date).toLocaleDateString('en-AU') : '—'}
              </td>
              <td className="px-3 py-2">
                <span
                  className="text-xs font-medium rounded px-2 py-0.5"
                  style={{ background: 'var(--color-surface)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
                >
                  {lead.status || '—'}
                </span>
              </td>
              <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-text)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {lead.campaign || '—'}
              </td>
              <td className="px-3 py-2 text-xs font-semibold" style={{ color: lead.daysSinceLast > 14 ? '#ef4444' : '#f59e0b' }}>
                {lead.daysSinceLast} days
              </td>
              <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-text)' }}>{lead.touchpoints}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Campaign velocity table ───────────────────────────────────────────────────

function CampaignTable({ data }) {
  if (!data?.length) return <p style={{ fontSize: 13, color: 'var(--color-muted)' }}>No campaign data.</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--color-surface)' }}>
            {['Campaign', 'Leads', 'Avg 1st Resp', 'Avg Touchpoints', 'Avg Days to Close', 'Conv. Rate'].map((h) => (
              <th key={h} className="px-3 py-2 text-left text-xs font-semibold" style={{ color: 'var(--color-muted)', borderBottom: '1px solid var(--color-border)' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.campaign} style={{ borderTop: '1px solid var(--color-border)' }}>
              <td className="px-3 py-2 text-xs font-medium" style={{ color: 'var(--color-text)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {row.campaign}
              </td>
              <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-muted)' }}>{row.total}</td>
              <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-text)' }}>
                {row.avgDaysToFirstResp !== null ? `${row.avgDaysToFirstResp}d` : '—'}
              </td>
              <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-text)' }}>
                {row.avgTouchpoints !== null ? row.avgTouchpoints : '—'}
              </td>
              <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-text)' }}>
                {row.avgDaysToClose !== null ? `${row.avgDaysToClose}d` : '—'}
              </td>
              <td className="px-3 py-2 text-xs font-semibold" style={{ color: (row.conversionRate ?? 0) >= 30 ? '#10b981' : '#f59e0b' }}>
                {row.conversionRate !== null ? `${row.conversionRate}%` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main dashboard ────────────────────────────────────────────────────────────

export default function VelocityDashboard({ result, onAskQuestion }) {
  const charts  = result?.data?.charts;
  const summary = result?.summary ?? '';
  const stats   = charts?.summary_stats;

  const section = (title, children) => (
    <div
      className="rounded-xl border p-4 mb-4"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
    >
      <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
        {title}
      </p>
      {children}
    </div>
  );

  return (
    <div>
      {/* ── Stat cards ─────────────────────────────────────────────────── */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <StatCard label="Total Enquiries" value={stats.total} />
          <StatCard label="Conversion Rate" value={stats.conversionRate != null ? `${stats.conversionRate}%` : '—'} accent={true} />
          <StatCard label="Avg Days to Close" value={stats.avgDaysToClose != null ? `${stats.avgDaysToClose}d` : '—'} />
          <StatCard label="Avg Touchpoints" value={stats.avgTouchpoints} />
          <StatCard label="Avg First Response" value={stats.avgFirstResponse != null ? `${stats.avgFirstResponse}d` : '—'} />
          <StatCard label="Zero Follow-up" value={stats.zeroFollowUp} sub="leads never contacted" />
          <StatCard label="Stale Leads" value={stats.staleCount} sub="open, 7+ days silent" />
          <StatCard label="Converted" value={stats.won} />
        </div>
      )}

      {/* ── Charts row 1: Status funnel + Touchpoint distribution ──────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {section('Lead Status Funnel',
          <BarChart
            data={charts?.statusFunnel || []}
            dataKey="value"
            labelKey="label"
            horizontal={true}
            height={200}
          />
        )}
        {section('Touchpoints to Convert',
          <BarChart
            data={charts?.touchpointDistribution || []}
            dataKey="value"
            height={200}
          />
        )}
      </div>

      {/* ── Charts row 2: Response time + Action mix ────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {section('First Response Time',
          <BarChart
            data={charts?.responseTimeBuckets || []}
            dataKey="value"
            height={200}
          />
        )}
        {section('Follow-up Action Mix',
          <BarChart
            data={charts?.actionMix || []}
            dataKey="value"
            horizontal={true}
            height={200}
          />
        )}
      </div>

      {/* ── Campaign velocity table ─────────────────────────────────────── */}
      {section('Lead Velocity by Campaign',
        <CampaignTable data={charts?.velocityByCampaign} />
      )}

      {/* ── Activity heatmap ────────────────────────────────────────────── */}
      {section('Activity Heatmap — When follow-ups are logged',
        <HeatmapGrid data={charts?.heatmapData || []} />
      )}

      {/* ── Scatter: touchpoints vs days to close ───────────────────────── */}
      {(charts?.scatterData?.length > 0) && section('Touchpoints vs Days to Close (converted leads)',
        <ScatterPlot
          data={charts.scatterData}
          xLabel="Touchpoints"
          yLabel="Days to close"
          height={220}
        />
      )}

      {/* ── Stale leads table ───────────────────────────────────────────── */}
      {section('Stale & At-Risk Leads',
        <StaleTable leads={charts?.staleLeads} />
      )}

      {/* ── Narrative report ────────────────────────────────────────────── */}
      {summary && (
        <div
          className="rounded-xl border p-5 mb-4"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
        >
          <MarkdownRenderer text={summary} />
        </div>
      )}

      {/* ── Preset questions ────────────────────────────────────────────── */}
      <div
        className="rounded-xl border p-4"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      >
        <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
          Ask a follow-up question
        </p>
        <div className="flex flex-wrap gap-2">
          {PRESET_QUESTIONS.map((pq) => (
            <button
              key={pq.label}
              onClick={() => onAskQuestion && onAskQuestion(pq.q)}
              style={{
                padding: '0.35rem 0.75rem',
                fontSize: '0.75rem',
                fontWeight: 500,
                fontFamily: 'inherit',
                borderRadius: '0.5rem',
                cursor: 'pointer',
                border: '1px solid var(--color-primary)',
                background: 'transparent',
                color: 'var(--color-primary)',
              }}
            >
              {pq.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
