/**
 * HeatmapGrid — activity heatmap, day × hour.
 *
 * Props:
 *   data    — array of { day: 'Mon', hour: 0-23, count: number }
 *   title   — optional heading
 *
 * Renders a 7-row × 24-column grid. Colour intensity scales from the max count.
 * Only shows business-relevant hour labels (6am, 9am, 12pm, 3pm, 6pm, 9pm).
 */

const HOUR_LABELS = { 0: '12am', 6: '6am', 9: '9am', 12: '12pm', 15: '3pm', 18: '6pm', 21: '9pm' };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function heatColour(count, max) {
  if (!max || count === 0) return 'rgba(99,102,241,0.05)';
  const intensity = count / max;
  // indigo-based: low → translucent, high → solid
  const alpha = 0.12 + intensity * 0.85;
  return `rgba(99,102,241,${alpha.toFixed(2)})`;
}

export default function HeatmapGrid({ data = [], title }) {
  if (!data.length) {
    return (
      <p style={{ fontSize: 13, color: 'var(--color-muted)', padding: '1rem 0' }}>No activity data</p>
    );
  }

  // Build lookup: day → hour → count
  const grid = {};
  let maxCount = 0;
  for (const { day, hour, count } of data) {
    if (!grid[day]) grid[day] = {};
    grid[day][hour] = count;
    if (count > maxCount) maxCount = count;
  }

  const cellSize = 18; // px
  const labelW   = 36; // day label column width

  return (
    <div>
      {title && (
        <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {title}
        </p>
      )}

      {/* Hour header */}
      <div style={{ display: 'flex', marginLeft: labelW, marginBottom: 2 }}>
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} style={{ width: cellSize, flexShrink: 0, textAlign: 'center', fontSize: 9, color: 'var(--color-muted)' }}>
            {HOUR_LABELS[h] ?? ''}
          </div>
        ))}
      </div>

      {/* Day rows */}
      {DAYS.map((day) => (
        <div key={day} style={{ display: 'flex', alignItems: 'center', marginBottom: 2 }}>
          <div style={{ width: labelW, flexShrink: 0, fontSize: 10, color: 'var(--color-muted)', textAlign: 'right', paddingRight: 6 }}>
            {day}
          </div>
          {Array.from({ length: 24 }, (_, h) => {
            const count = (grid[day] && grid[day][h]) || 0;
            return (
              <div
                key={h}
                title={`${day} ${h}:00 — ${count} ${count === 1 ? 'activity' : 'activities'}`}
                style={{
                  width:        cellSize,
                  height:       cellSize,
                  flexShrink:   0,
                  borderRadius: 3,
                  background:   heatColour(count, maxCount),
                  border:       '1px solid var(--color-border, #334155)',
                  cursor:       count > 0 ? 'help' : 'default',
                }}
              />
            );
          })}
        </div>
      ))}

      {/* Legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8, marginLeft: labelW }}>
        <span style={{ fontSize: 10, color: 'var(--color-muted)' }}>Less</span>
        {[0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => (
          <div key={t} style={{ width: 12, height: 12, borderRadius: 2, background: heatColour(t * maxCount, maxCount), border: '1px solid var(--color-border)' }} />
        ))}
        <span style={{ fontSize: 10, color: 'var(--color-muted)' }}>More</span>
      </div>
    </div>
  );
}
