/**
 * VelocityDashboard — charts + narrative for the Lead Velocity agent.
 *
 * Props:
 *   result        — SSE result payload { summary, data: { charts }, startDate, endDate }
 *   startDate     — ISO date string (from page-level range picker)
 *   endDate       — ISO date string
 *   onAskQuestion — (questionText: string) => void — fires the conversation tab
 *   history       — array of past velocity runs (from API)
 *   onLoadHistory — (resultPayload) => void — restores a past run into view
 */
import { useState, useRef } from 'react';
import BarChart    from '../../../components/charts/BarChart';
import HeatmapGrid from '../../../components/charts/HeatmapGrid';
import ScatterPlot from '../../../components/charts/ScatterPlot';
import MarkdownRenderer from '../../../components/ui/MarkdownRenderer';
import MicButton   from '../../../components/ui/MicButton';
import ReadAloudButton from '../../../components/ui/ReadAloudButton';
import { exportPdf, exportText } from '../../../utils/exportService';
import { fmtDate } from '../../../utils/date';

// ── Info tooltip ──────────────────────────────────────────────────────────────

function InfoTooltip({ text }) {
  const [show, setShow] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', marginLeft: 5 }}>
      <span
        role="img"
        aria-label="info"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        style={{
          cursor: 'help',
          userSelect: 'none',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 15,
          height: 15,
          borderRadius: '50%',
          border: '1.5px solid var(--color-muted)',
          color: 'var(--color-muted)',
          fontSize: 9,
          fontWeight: 700,
          fontStyle: 'italic',
          lineHeight: 1,
          fontFamily: 'Georgia, serif',
          flexShrink: 0,
        }}
      >
        i
      </span>
      {show && (
        <span
          style={{
            position: 'absolute',
            left: '130%',
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 8,
            padding: '10px 14px',
            fontSize: 12,
            color: 'var(--color-text)',
            lineHeight: 1.55,
            width: 280,
            zIndex: 200,
            boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
            whiteSpace: 'normal',
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ title, tooltip, children }) {
  return (
    <div
      className="rounded-xl border p-4 mb-4"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <p style={{
          fontSize: 11, fontWeight: 700, color: 'var(--color-muted)',
          textTransform: 'uppercase', letterSpacing: '0.07em', margin: 0,
        }}>
          {title}
        </p>
        {tooltip && <InfoTooltip text={tooltip} />}
      </div>
      {children}
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent, tooltip }) {
  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: 'var(--color-bg)',
        border: `1px solid ${accent ? 'var(--color-primary)' : 'var(--color-border)'}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
        <p style={{ fontSize: 11, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
          {label}
        </p>
        {tooltip && <InfoTooltip text={tooltip} />}
      </div>
      <p style={{ fontSize: 22, fontWeight: 700, color: accent ? 'var(--color-primary)' : 'var(--color-text)', lineHeight: 1, margin: 0 }}>
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
          <tr style={{ background: 'var(--color-bg)' }}>
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
                <span className="text-xs font-medium rounded px-2 py-0.5" style={{ background: 'var(--color-surface)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>
                  {lead.status || '—'}
                </span>
              </td>
              <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-text)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
          <tr style={{ background: 'var(--color-bg)' }}>
            {['Campaign', 'Leads', 'Avg 1st Resp', 'Avg Touchpoints', 'Avg Days Close', 'Conv %'].map((h) => (
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
              <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-text)' }}>{row.avgDaysToFirstResp != null ? `${row.avgDaysToFirstResp}d` : '—'}</td>
              <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-text)' }}>{row.avgTouchpoints ?? '—'}</td>
              <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-text)' }}>{row.avgDaysToClose != null ? `${row.avgDaysToClose}d` : '—'}</td>
              <td className="px-3 py-2 text-xs font-semibold" style={{ color: (row.conversionRate ?? 0) >= 30 ? '#10b981' : '#f59e0b' }}>
                {row.conversionRate != null ? `${row.conversionRate}%` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Run history table ─────────────────────────────────────────────────────────

function RunHistoryTable({ history, onLoad }) {
  if (!history) return <p className="text-sm py-2" style={{ color: 'var(--color-muted)' }}>Loading…</p>;
  if (!history.length) return <p className="text-sm py-2" style={{ color: 'var(--color-muted)' }}>No previous velocity analyses.</p>;
  return (
    <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ background: 'var(--color-bg)' }}>
          {['Run date', 'Period', 'Status', ''].map((h) => (
            <th key={h} className="px-3 py-2 text-left text-xs font-semibold" style={{ color: 'var(--color-muted)', borderBottom: '1px solid var(--color-border)' }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {history.map((r) => (
          <tr key={r.id} style={{ borderTop: '1px solid var(--color-border)' }}>
            <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-muted)' }}>{fmtDate(r.run_at)}</td>
            <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-text)' }}>
              {r.result?.startDate && r.result?.endDate
                ? `${fmtDate(r.result.startDate)} – ${fmtDate(r.result.endDate)}`
                : '—'}
            </td>
            <td className="px-3 py-2">
              <span className="text-xs font-semibold rounded px-2 py-0.5" style={{
                background: r.status === 'complete' ? '#dcfce7' : r.status === 'error' ? '#fee2e2' : '#fef9c3',
                color:      r.status === 'complete' ? '#15803d' : r.status === 'error' ? '#b91c1c' : '#854d0e',
              }}>{r.status}</span>
            </td>
            <td className="px-3 py-2 text-right">
              {r.status === 'complete' && r.result && (
                <button
                  onClick={() => onLoad(r.result)}
                  className="text-xs rounded px-2.5 py-1 font-medium"
                  style={{ background: 'none', border: '1px solid var(--color-border)', color: 'var(--color-muted)', cursor: 'pointer' }}
                >
                  Load
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Preset questions ──────────────────────────────────────────────────────────

const PRESET_QUESTIONS = [
  { label: 'Campaigns with fewest touchpoints', q: 'Which ad campaigns produce leads that convert with the fewest follow-up touchpoints? Compare average touchpoints and days-to-close by campaign, ranked from most efficient to least.' },
  { label: 'Stale leads — no follow-up', q: 'Show me all leads in an open status (new, contacted, or emailed) with no follow-up in more than 7 days. How many are there and what is the total potential value at risk?' },
  { label: 'Response time vs conversion', q: 'Does responding to leads faster lead to higher conversion rates? Compare conversion rates for same-day, next-day, and later response time buckets.' },
  { label: 'Fastest converting lead sources', q: 'Which enquiry sources (website, phone, email, chatbot, facebook) produce leads that convert fastest and with fewest touchpoints?' },
  { label: 'Why are we losing 70% of enquiries?', q: 'Based on the velocity and follow-up data, what are the main reasons we are not converting more than 30% of online enquiries? What specific process failures are visible in the data?' },
  { label: 'Training opportunities by sales rep', q: 'Based on follow-up patterns — response times, touchpoint counts, action types — where are the most significant training opportunities for the sales team?' },
];

// ── Export helpers ────────────────────────────────────────────────────────────

async function handleExportPdf(summary, startDate, endDate) {
  const period = `${startDate ?? ''} to ${endDate ?? ''}`;
  await exportPdf({
    content:  summary,
    title:    `Lead Velocity Report · ${period}`,
    filename: `velocity-report-${startDate ?? 'na'}-${endDate ?? 'na'}.pdf`,
  });
}

function handleExportText(summary, startDate, endDate) {
  const period = `${startDate ?? ''} to ${endDate ?? ''}`;
  exportText({
    content:  `Lead Velocity Report — ${period}\n\n${summary}`,
    filename: `velocity-report-${startDate ?? 'na'}-${endDate ?? 'na'}.txt`,
  });
}

// ── Main dashboard ────────────────────────────────────────────────────────────

export default function VelocityDashboard({ result, startDate, endDate, onAskQuestion, history, onLoadHistory }) {
  const [followUpText, setFollowUpText] = useState('');
  const [exporting, setExporting]       = useState(false);
  const [exportErr, setExportErr]       = useState('');
  const [historyOpen, setHistoryOpen]   = useState(false);

  const charts  = result?.data?.charts;
  const summary = result?.summary ?? '';
  const stats   = charts?.summary_stats;

  // Use dates from result if available (may differ from current picker)
  const reportStart = result?.data?.startDate ?? result?.startDate ?? startDate;
  const reportEnd   = result?.data?.endDate   ?? result?.endDate   ?? endDate;

  function submitFollowUp() {
    const q = followUpText.trim();
    if (!q) return;
    setFollowUpText('');
    if (onAskQuestion) onAskQuestion(q);
  }

  function handleKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); submitFollowUp(); }
  }

  async function doPdfExport() {
    setExporting(true);
    setExportErr('');
    try { await handleExportPdf(summary, reportStart, reportEnd); }
    catch (e) { setExportErr(e.message || 'PDF export failed'); }
    finally { setExporting(false); }
  }

  const btnStyle = {
    padding: '0.3rem 0.75rem', fontSize: '0.75rem', fontWeight: 500,
    fontFamily: 'inherit', borderRadius: '0.5rem', cursor: 'pointer',
    border: '1px solid var(--color-border)', background: 'transparent',
    color: 'var(--color-muted)',
  };

  return (
    <div>
      {/* ── Date range header ───────────────────────────────────────────── */}
      {(reportStart || reportEnd) && (
        <div
          className="rounded-xl px-4 py-2 mb-4 flex items-center gap-2"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
        >
          <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>Reporting period:</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)' }}>
            {reportStart ? new Date(reportStart).toLocaleDateString('en-AU') : '?'}
            {' – '}
            {reportEnd ? new Date(reportEnd).toLocaleDateString('en-AU') : '?'}
          </span>
          {stats?.total != null && (
            <>
              <span style={{ fontSize: 12, color: 'var(--color-border)' }}>·</span>
              <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>{stats.total} enquiries analysed</span>
            </>
          )}
        </div>
      )}

      {/* ── Stat cards ─────────────────────────────────────────────────── */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <StatCard
            label="Total Enquiries" value={stats.total}
            tooltip="Total inbound leads received in this date range."
          />
          <StatCard
            label="Conversion Rate" value={stats.conversionRate != null ? `${stats.conversionRate}%` : '—'}
            accent
            tooltip="Percentage of enquiries that reached 'Completed & Warrantied' or 'Invoiced & Assigned' status. Industry benchmark varies; internal target is >30%."
          />
          <StatCard
            label="Avg Days to Close"
            value={stats.avgDaysToClose != null ? `${stats.avgDaysToClose}d` : '—'}
            tooltip="Average number of days from enquiry submission to the last known contact or completion date. Lower is better."
          />
          <StatCard
            label="Avg Touchpoints" value={stats.avgTouchpoints}
            tooltip="Average number of formal follow-up activities logged per lead (progress_details rows). Does not count status changes that were not formally logged."
          />
          <StatCard
            label="Avg First Response"
            value={stats.avgFirstResponse != null ? `${stats.avgFirstResponse}d` : '—'}
            tooltip="Average days from enquiry submission to the first scheduled next_event follow-up date. Uses contacted_date as fallback when no follow-up was scheduled. Measures how quickly the team plans action on a new lead."
          />
          <StatCard
            label="Never Contacted" value={stats.neverContacted}
            sub="still 'new', no activity"
            tooltip="Leads still in 'New Enquiry' status with no progress activity and no contacted_date recorded. These are genuinely untouched leads — highest priority to action."
          />
          <StatCard
            label="Contacted (Unmeasured)" value={stats.contactedUnmeasured}
            sub="status changed, not logged"
            tooltip="Leads whose status progressed beyond 'new' (the operator marked them contacted) but no formal activity row was logged in progress_details. This is a data quality gap — activity happened but wasn't recorded, which limits velocity analysis accuracy."
          />
          <StatCard
            label="Stale Open Leads" value={stats.staleCount}
            sub="open, 7+ days no contact"
            tooltip="Leads in an open status (new/contacted/emailed) where the last known contact was more than 7 days ago. These represent revenue at risk of being lost."
          />
          <StatCard
            label="No Next Step Planned" value={stats.noNextStepLeads}
            sub={stats.noNextStepRows != null ? `${stats.noNextStepRows} activity rows affected` : undefined}
            tooltip="Leads where an operator logged a CRM activity but did not schedule a next_event follow-up date. The lead was worked but left with no planned next action — a direct process failure. Each instance is a training opportunity."
          />
          {stats.leadsWithTouchpoints > 0 && (
            <StatCard
              label="No Notes Logged"
              value={stats.noNotesCount}
              sub={stats.leadsWithTouchpoints != null ? `of ${stats.leadsWithTouchpoints} leads with activity` : undefined}
              tooltip="Leads where the operator logged touchpoints but left every note field blank. Notes are an indicator of engagement depth — a blank note suggests a brief or low-quality interaction was not recorded for future reference."
            />
          )}
        </div>
      )}

      {/* ── Charts missing warning ──────────────────────────────────────── */}
      {summary && !charts && (
        <div
          className="rounded-xl p-4 mb-4"
          style={{ background: '#fef9c3', border: '1px solid #fde047' }}
        >
          <p className="text-sm m-0" style={{ color: '#92400e' }}>
            <strong>Note:</strong> Narrative loaded but chart data is unavailable for this run. Try re-running the velocity analysis, or load a different run from history below.
          </p>
        </div>
      )}

      {/* ── Charts (all guarded — charts is null if run returned no data) ── */}
      {charts && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <Section
              title="Lead Status Funnel"
              tooltip="How enquiries are distributed across pipeline stages. A large 'New Enquiry' bar means leads are sitting untouched. 'Contacted (unmeasured)' or low 'Completed' numbers reveal process gaps."
            >
              <BarChart data={charts.statusFunnel || []} dataKey="value" labelKey="label" horizontal height={200} />
            </Section>

            <Section
              title="Touchpoints to Convert"
              tooltip="How many follow-up activities were formally logged per lead. The '0' bar includes two distinct groups: leads with no evidence of any contact (see 'Never Contacted' stat) AND leads whose status was updated by the operator but who had no activity logged in the CRM (see 'Contacted Unmeasured' stat). A high '0' bar does not mean those leads were abandoned — it means contact was not recorded here. Use 'Never Contacted' and 'Contacted Unmeasured' stats to separate the two groups."
            >
              <BarChart data={charts.touchpointDistribution || []} dataKey="value" height={200} />
            </Section>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <Section
              title="First Response Time"
              tooltip={`How quickly leads receive their first logged contact after enquiry. "Contacted (unmeasured)" = operator updated the status but did not log an activity row — the contact happened but we cannot measure the timing. "No response" = lead is still 'new' with no evidence of contact at all. Same-day and next-day responses typically correlate with higher conversion rates.`}
            >
              <BarChart data={charts.responseTimeBuckets || []} dataKey="value" height={200} />
            </Section>

            <Section
              title="Follow-up Action Mix"
              tooltip="Types of follow-up activities logged across all leads. An over-reliance on one action type (e.g. Phone only) may indicate a narrow follow-up strategy. Appointment and Invoice actions are strong conversion signals."
            >
              <BarChart data={charts.actionMix || []} dataKey="value" horizontal height={200} />
            </Section>
          </div>

          {charts.noteEngagement && charts.noteEngagement.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <Section
                title="Note Engagement Depth"
                tooltip="For leads with at least one logged touchpoint, how many characters were written in the note fields across all their activity rows. Longer notes suggest more substantive interactions were recorded. 'No notes' means the operator logged the touchpoint but left every note blank. 'Detailed (250+)' means enough was written to infer meaningful engagement."
              >
                <BarChart data={charts.noteEngagement} dataKey="value" horizontal height={180} />
              </Section>
            </div>
          )}

          <Section
            title="Lead Velocity by Campaign"
            tooltip="For each campaign: how fast the first response is, how many touchpoints are needed, how long it takes to close, and what percentage convert. Campaigns with high touchpoints but low conversion may need creative or landing page review."
          >
            <CampaignTable data={charts.velocityByCampaign} />
          </Section>

          <Section
            title="Follow-up Schedule Heatmap"
            tooltip="Shows which days and hours the team schedules their next follow-up events. Dark squares = many follow-ups planned at that time. Blank areas mean no follow-ups are being scheduled then. Note: only rows where a next follow-up date was set are counted — rows with no next step planned are excluded and tracked separately."
          >
            <HeatmapGrid data={charts.heatmapData || []} />
          </Section>

          {(charts.scatterData?.length > 0) && (
            <Section
              title="Touchpoints vs Days to Close — Converted Leads"
              tooltip="Each dot is a converted lead. X = number of follow-up contacts logged, Y = days from enquiry to close. Dots clustered bottom-left convert fast with few contacts. Dots top-right take many contacts over a long time. Look for whether fewer or more touchpoints predict faster close."
            >
              <ScatterPlot
                data={charts.scatterData}
                xLabel="Touchpoints"
                yLabel="Days to close"
                height={220}
              />
            </Section>
          )}

          <Section
            title="Stale & At-Risk Leads"
            tooltip="Leads in an open pipeline status (new/contacted/emailed) where the last known contact is more than 7 days ago, or genuinely untouched new leads older than 3 days. Days shown in orange = 8–14 days. Red = 15+ days. These represent direct lost-revenue risk."
          >
            <StaleTable leads={charts.staleLeads} />
          </Section>
        </>
      )}

      {/* ── Narrative + export ──────────────────────────────────────────── */}
      {summary && (
        <div className="rounded-xl border p-5 mb-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', margin: 0 }}>
              Analysis Narrative
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <ReadAloudButton text={summary} size={14} />
              <span style={{ fontSize: '0.72rem', color: 'var(--color-muted)' }}>Export:</span>
              <button onClick={() => handleExportText(summary, reportStart, reportEnd)} style={btnStyle}>Text</button>
              <button onClick={doPdfExport} disabled={exporting} style={{ ...btnStyle, opacity: exporting ? 0.5 : 1 }}>
                {exporting ? 'Generating…' : 'PDF'}
              </button>
              {exportErr && <span style={{ fontSize: '0.7rem', color: '#dc2626' }}>{exportErr}</span>}
            </div>
          </div>
          <MarkdownRenderer text={summary} />
        </div>
      )}

      {/* ── Follow-up question input ─────────────────────────────────────── */}
      <div className="rounded-xl border mb-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', margin: 0 }}>
            Ask a follow-up question
          </p>
          <InfoTooltip text="Type or dictate a question. Click Ask (or Ctrl+Enter) to open the Conversation tab with your question pre-filled. The conversation agent has access to all CRM data including progress_details." />
        </div>

        {/* Preset chips */}
        <div className="flex flex-wrap gap-1.5 px-4 py-3">
          {PRESET_QUESTIONS.map((pq) => (
            <button
              key={pq.label}
              onClick={() => setFollowUpText(pq.q)}
              style={{
                padding: '0.3rem 0.7rem', fontSize: '0.72rem', fontWeight: 500,
                fontFamily: 'inherit', borderRadius: '0.4rem', cursor: 'pointer',
                border: '1px solid var(--color-primary)', background: 'transparent',
                color: 'var(--color-primary)',
              }}
            >
              {pq.label}
            </button>
          ))}
        </div>

        {/* Textarea + mic + send */}
        <textarea
          value={followUpText}
          onChange={(e) => setFollowUpText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your question, or click a chip above, or use the mic…"
          rows={3}
          className="w-full px-4 py-3 text-sm outline-none resize-none"
          style={{
            background: 'var(--color-bg)',
            color: 'var(--color-text)',
            borderTop: '1px solid var(--color-border)',
            borderBottom: '1px solid var(--color-border)',
            fontFamily: 'inherit',
          }}
        />

        <div className="flex items-center justify-between px-4 py-2" style={{ background: 'var(--color-surface)' }}>
          <div className="flex items-center gap-1">
            <MicButton
              onResult={(t) => setFollowUpText((q) => {
                const base = q.replace(/\s*\[.*?\]$/, '').trim();
                return base ? base + ' ' + t : t;
              })}
              onPartial={(t) => setFollowUpText((q) => {
                const base = q.replace(/\s*\[.*?\]$/, '').trim();
                return base ? base + ' [' + t + ']' : '[' + t + ']';
              })}
            />
            <span className="text-xs ml-1" style={{ color: 'var(--color-muted)' }}>Ctrl+Enter to send</span>
          </div>
          <button
            onClick={submitFollowUp}
            disabled={!followUpText.trim()}
            style={{
              padding: '0.35rem 0.9rem', fontSize: '0.8rem', fontWeight: 600,
              fontFamily: 'inherit', borderRadius: '0.5rem', border: 'none',
              background: followUpText.trim() ? 'var(--color-primary)' : 'var(--color-border)',
              color: '#fff', cursor: followUpText.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            Ask
          </button>
        </div>
      </div>

      {/* ── History panel ────────────────────────────────────────────────── */}
      <div className="rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', overflow: 'hidden' }}>
        <button
          onClick={() => setHistoryOpen((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3"
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', margin: 0 }}>
            Previous Velocity Analyses
          </p>
          <span style={{ fontSize: 14, color: 'var(--color-muted)', transform: historyOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
            ▾
          </span>
        </button>
        {historyOpen && (
          <div style={{ borderTop: '1px solid var(--color-border)', padding: '0 16px 16px' }}>
            <RunHistoryTable history={history} onLoad={(r) => { if (onLoadHistory) onLoadHistory(r); }} />
          </div>
        )}
      </div>
    </div>
  );
}
