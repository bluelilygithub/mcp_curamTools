/**
 * SearchTermsTable — renders the get_search_terms tool result.
 * Buckets terms into: Converting / Wasted Spend / Ad Copy Opportunity / Standard.
 */
export default function SearchTermsTable({ terms = [] }) {
  if (!terms.length) return null;

  const fmt = (n) => `$${Number(n ?? 0).toFixed(2)}`;
  const pct = (n) => `${(Number(n ?? 0) * 100).toFixed(1)}%`;

  const converting  = terms.filter((t) => t.conversions > 0);
  const wasted      = terms.filter((t) => t.conversions === 0 && t.clicks >= 5);
  const adCopy      = terms.filter((t) => t.impressions >= 100 && t.ctr < 0.03 && t.conversions === 0 && t.clicks < 5);
  const standard    = terms.filter((t) => !converting.includes(t) && !wasted.includes(t) && !adCopy.includes(t));

  const headerStyle = {
    fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
    padding: '6px 10px', borderBottom: '1px solid var(--color-border)',
  };
  const rowStyle = {
    fontSize: 12, padding: '5px 10px', borderBottom: '1px solid var(--color-border)',
    color: 'var(--color-text)',
  };

  function BucketTable({ title, color, rows, columns }) {
    if (!rows.length) return null;
    return (
      <div className="mb-4">
        <p className="text-xs font-semibold mb-1" style={{ color }}>{title} ({rows.length})</p>
        <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ background: 'var(--color-surface)' }}>
              <tr>
                <th style={{ ...headerStyle, textAlign: 'left' }}>Term</th>
                {columns.map((c) => (
                  <th key={c.key} style={{ ...headerStyle, textAlign: 'right' }}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((t, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? 'var(--color-bg)' : 'var(--color-surface)' }}>
                  <td style={{ ...rowStyle, fontFamily: 'monospace', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.term}
                  </td>
                  {columns.map((c) => (
                    <td key={c.key} style={{ ...rowStyle, textAlign: 'right' }}>
                      {c.format ? c.format(t[c.key]) : t[c.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div>
      <BucketTable
        title="Converting terms"
        color="#16a34a"
        rows={converting}
        columns={[
          { key: 'clicks', label: 'Clicks' },
          { key: 'conversions', label: 'Conv.', format: (v) => v?.toFixed(1) },
          { key: 'cost', label: 'Cost', format: fmt },
          { key: 'ctr', label: 'CTR', format: pct },
        ]}
      />
      <BucketTable
        title="Wasted spend candidates"
        color="#dc2626"
        rows={wasted}
        columns={[
          { key: 'clicks', label: 'Clicks' },
          { key: 'impressions', label: 'Impressions' },
          { key: 'cost', label: 'Cost', format: fmt },
          { key: 'ctr', label: 'CTR', format: pct },
        ]}
      />
      <BucketTable
        title="Ad copy opportunities"
        color="#d97706"
        rows={adCopy}
        columns={[
          { key: 'impressions', label: 'Impressions' },
          { key: 'clicks', label: 'Clicks' },
          { key: 'ctr', label: 'CTR', format: pct },
          { key: 'cost', label: 'Cost', format: fmt },
        ]}
      />
      <BucketTable
        title="Standard"
        color="var(--color-muted)"
        rows={standard}
        columns={[
          { key: 'impressions', label: 'Impressions' },
          { key: 'clicks', label: 'Clicks' },
          { key: 'ctr', label: 'CTR', format: pct },
          { key: 'cost', label: 'Cost', format: fmt },
        ]}
      />
    </div>
  );
}
