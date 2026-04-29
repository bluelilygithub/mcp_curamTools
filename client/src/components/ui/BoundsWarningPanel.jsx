/**
 * BoundsWarningPanel — displays tool data integrity failures attached to a run.
 * Rendered when result.boundsFailed is present (status === 'needs_review').
 * Generic — no tool-specific logic.
 */
export default function BoundsWarningPanel({ boundsFailed }) {
  if (!boundsFailed?.length) return null;

  return (
    <div style={{
      margin: '12px 0',
      padding: '10px 14px',
      borderRadius: 10,
      background: '#d9770610',
      border: '1px solid #d9770640',
      fontFamily: 'inherit',
    }}>
      <p style={{
        fontSize: 12, fontWeight: 600, color: '#b45309', margin: '0 0 6px',
        fontFamily: 'inherit',
      }}>
        ⚠ Data integrity — {boundsFailed.length} issue{boundsFailed.length > 1 ? 's' : ''} flagged
      </p>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {boundsFailed.map((f, i) => (
          <li key={i} style={{ fontSize: 12, color: '#92400e', fontFamily: 'inherit', marginBottom: 2 }}>
            <span style={{ fontFamily: 'var(--font-mono, monospace)', marginRight: 6 }}>{f.tool}:</span>
            {f.message}
          </li>
        ))}
      </ul>
      <p style={{ fontSize: 11, color: '#b45309', margin: '6px 0 0', fontFamily: 'inherit' }}>
        AI analysis completed. Review flagged values before acting on this report.
      </p>
    </div>
  );
}
