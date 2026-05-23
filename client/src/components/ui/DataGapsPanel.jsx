/**
 * DataGapsPanel — displays declared and platform-detected data gaps.
 * This is a trust signal, not a replacement for the report itself.
 */
export default function DataGapsPanel({ dataGaps = [], review = null }) {
  const confirmed = review?.confirmedGaps ?? [];
  const silent = review?.silentGaps ?? [];
  const missingSection = review && review.sectionPresent === false;

  if (!dataGaps.length && !confirmed.length && !silent.length && !missingSection) return null;

  return (
    <div style={{
      margin: '12px 0',
      padding: '10px 14px',
      borderRadius: 10,
      background: '#2563eb10',
      border: '1px solid #2563eb35',
      fontFamily: 'inherit',
    }}>
      <p style={{ fontSize: 12, fontWeight: 600, color: '#1d4ed8', margin: '0 0 6px', fontFamily: 'inherit' }}>
        Data gaps
      </p>

      {missingSection && (
        <p style={{ fontSize: 12, color: '#1e40af', margin: '0 0 6px', fontFamily: 'inherit' }}>
          Required Data Gaps section was missing from this output.
        </p>
      )}

      {dataGaps.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {dataGaps.map((gap, i) => (
            <li key={`${gap.source}-${i}`} style={{ fontSize: 12, color: '#1e40af', fontFamily: 'inherit', marginBottom: 2 }}>
              <span style={{ fontFamily: 'var(--font-mono, monospace)', marginRight: 6 }}>{gap.source}:</span>
              {gap.statement}
            </li>
          ))}
        </ul>
      )}

      {silent.length > 0 && (
        <p style={{ fontSize: 11, color: '#b45309', margin: '6px 0 0', fontFamily: 'inherit' }}>
          {silent.length} missing-data issue{silent.length > 1 ? 's were' : ' was'} detected by the platform but not disclosed by the agent.
        </p>
      )}
    </div>
  );
}
