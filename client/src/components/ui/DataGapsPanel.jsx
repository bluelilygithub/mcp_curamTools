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
        <div style={{ marginTop: 8 }}>
          <p style={{ fontSize: 11, color: '#b45309', margin: '0 0 6px', fontFamily: 'inherit' }}>
            {silent.length} missing-data issue{silent.length > 1 ? 's were' : ' was'} detected by the platform but not disclosed by the agent.
          </p>
          <div style={{ display: 'grid', gap: 6 }}>
            {silent.map((gap, index) => (
              <div key={`${gap.source}-${index}`} style={{
                border: '1px solid #d9770640',
                background: '#d9770610',
                borderRadius: 8,
                padding: '8px 10px',
              }}>
                <p style={{ fontSize: 12, color: '#92400e', margin: 0, fontFamily: 'inherit' }}>
                  <span style={{ fontFamily: 'var(--font-mono, monospace)', marginRight: 6 }}>{gap.source}:</span>
                  {gap.message}
                </p>
                {gap.action && (
                  <p style={{ fontSize: 11, color: '#92400e', margin: '4px 0 0', fontFamily: 'inherit' }}>
                    Fix: {gap.action}
                  </p>
                )}
                {Array.isArray(gap.details) && gap.details.length > 0 && (
                  <div style={{ marginTop: 6, display: 'grid', gap: 4 }}>
                    {gap.details.slice(0, 5).map((detail, detailIndex) => (
                      <div key={detailIndex} style={{ fontSize: 11, color: '#92400e', fontFamily: 'inherit' }}>
                        <strong>{detail.label ?? detail.promptText ?? `Issue ${detailIndex + 1}`}</strong>
                        {detail.category && <span> · {detail.category}</span>}
                        {detail.issue && <div>Issue: {detail.issue}</div>}
                        {detail.fix && <div>Suggested fix: {detail.fix}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
