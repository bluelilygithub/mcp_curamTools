/**
 * ScatterPlot — Recharts scatter chart for touchpoints vs days-to-close.
 *
 * Props:
 *   data    — array of { x, y, campaign? }
 *   xLabel  — x-axis label (default 'Touchpoints')
 *   yLabel  — y-axis label (default 'Days to close')
 *   title   — optional heading
 *   height  — chart height (default 220)
 */
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ZAxis,
} from 'recharts';

const tooltipStyle = {
  background: 'var(--color-surface, #1e293b)',
  border: '1px solid var(--color-border, #334155)',
  borderRadius: 8,
  color: 'var(--color-text, #f1f5f9)',
  fontSize: 12,
};

function CustomTooltip({ active, payload, xLabel, yLabel }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div style={{ ...tooltipStyle, padding: '8px 12px' }}>
      {d?.campaign && <p style={{ fontWeight: 600, marginBottom: 4 }}>{d.campaign}</p>}
      <p>{xLabel}: {d?.x}</p>
      <p>{yLabel}: {d?.y} days</p>
    </div>
  );
}

export default function ScatterPlot({
  data = [],
  xLabel = 'Touchpoints',
  yLabel = 'Days to close',
  title,
  height = 220,
}) {
  if (!data.length) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 13, color: 'var(--color-muted)' }}>No data</span>
      </div>
    );
  }

  const tickStyle = { fontSize: 11, fill: 'var(--color-muted)' };

  return (
    <div>
      {title && (
        <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {title}
        </p>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <ScatterChart margin={{ top: 4, right: 8, bottom: 16, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border, #334155)" opacity={0.5} />
          <XAxis
            type="number"
            dataKey="x"
            name={xLabel}
            tick={tickStyle}
            label={{ value: xLabel, position: 'insideBottom', offset: -8, style: { fontSize: 10, fill: 'var(--color-muted)' } }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name={yLabel}
            tick={tickStyle}
            label={{ value: yLabel, angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: 'var(--color-muted)' } }}
          />
          <ZAxis range={[30, 30]} />
          <Tooltip
            content={<CustomTooltip xLabel={xLabel} yLabel={yLabel} />}
            cursor={{ strokeDasharray: '3 3' }}
          />
          <Scatter data={data} fill="#6366f1" fillOpacity={0.7} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
