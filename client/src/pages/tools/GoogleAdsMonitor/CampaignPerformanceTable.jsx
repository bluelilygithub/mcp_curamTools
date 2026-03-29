/**
 * CampaignPerformanceTable — renders the get_campaign_performance tool result.
 */
export default function CampaignPerformanceTable({ campaigns = [] }) {
  if (!campaigns.length) return null;

  const fmt  = (n) => `$${Number(n ?? 0).toFixed(2)}`;
  const pct  = (n) => `${(Number(n ?? 0) * 100).toFixed(1)}%`;
  const num  = (n) => Number(n ?? 0).toLocaleString();

  const totalCost        = campaigns.reduce((s, c) => s + (c.cost        ?? 0), 0);
  const totalConversions = campaigns.reduce((s, c) => s + (c.conversions ?? 0), 0);
  const blendedCpa       = totalConversions > 0 ? totalCost / totalConversions : null;

  const th = {
    padding: '8px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600,
    color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.05em',
    borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap',
  };
  const thL = { ...th, textAlign: 'left' };
  const td  = {
    padding: '8px 12px', textAlign: 'right', fontSize: 13,
    color: 'var(--color-text)', borderBottom: '1px solid var(--color-border)',
    whiteSpace: 'nowrap',
  };
  const tdL = { ...td, textAlign: 'left', fontWeight: 500 };

  return (
    <div>
      {/* Summary strip */}
      <div className="flex gap-6 mb-3 flex-wrap">
        {[
          { label: 'Total spend', value: fmt(totalCost) },
          { label: 'Conversions', value: num(totalConversions) },
          { label: 'Blended CPA', value: blendedCpa != null ? fmt(blendedCpa) : '—' },
          { label: 'Campaigns', value: campaigns.length },
        ].map(({ label, value }) => (
          <div key={label}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</p>
            <p className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{value}</p>
          </div>
        ))}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--color-surface)' }}>
              <th style={thL}>Campaign</th>
              <th style={th}>Budget</th>
              <th style={th}>Impressions</th>
              <th style={th}>Clicks</th>
              <th style={th}>CTR</th>
              <th style={th}>Cost</th>
              <th style={th}>Conv.</th>
              <th style={th}>CPA</th>
              <th style={th}>Avg CPC</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => {
              const cpa = c.conversions > 0 ? c.cost / c.conversions : null;
              return (
                <tr key={c.id ?? c.name} style={{ background: 'var(--color-bg)' }}>
                  <td style={tdL}>{c.name}</td>
                  <td style={td}>{fmt(c.budget)}</td>
                  <td style={td}>{num(c.impressions)}</td>
                  <td style={td}>{num(c.clicks)}</td>
                  <td style={{
                    ...td,
                    color: c.ctr < 0.03 ? '#dc2626' : 'var(--color-text)',
                  }}>{pct(c.ctr)}</td>
                  <td style={td}>{fmt(c.cost)}</td>
                  <td style={td}>{c.conversions?.toFixed(1) ?? '—'}</td>
                  <td style={td}>{cpa != null ? fmt(cpa) : '—'}</td>
                  <td style={td}>{fmt(c.avgCpc)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
