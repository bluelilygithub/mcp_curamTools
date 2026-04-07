/**
 * BarChart — reusable Recharts bar chart.
 *
 * Props:
 *   data        — array of objects, e.g. [{ name: 'Jan', value: 12 }]
 *   dataKey     — key(s) to plot. String for single bar, string[] for grouped.
 *   colors      — array of hex colours (cycles through for grouped bars)
 *   horizontal  — flip to horizontal layout (default: false = vertical)
 *   title       — optional heading
 *   height      — chart height in px (default 220)
 *   labelKey    — which key to use as axis label (default 'name')
 *   showValues  — show value labels on bars (default false)
 *   formatValue — function to format displayed values (default: n => n)
 */
import {
  BarChart as ReBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
} from 'recharts';

const DEFAULT_COLORS = [
  '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#3b82f6',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#84cc16',
];

const tooltipStyle = {
  background: 'var(--color-surface, #1e293b)',
  border: '1px solid var(--color-border, #334155)',
  borderRadius: 8,
  color: 'var(--color-text, #f1f5f9)',
  fontSize: 12,
};

export default function BarChart({
  data = [],
  dataKey = 'value',
  colors = DEFAULT_COLORS,
  horizontal = false,
  title,
  height = 220,
  labelKey = 'name',
  showValues = false,
  formatValue = (n) => n,
}) {
  if (!data.length) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 13, color: 'var(--color-muted)' }}>No data</span>
      </div>
    );
  }

  const keys  = Array.isArray(dataKey) ? dataKey : [dataKey];
  const multi = keys.length > 1;

  const xProps = horizontal
    ? { type: 'number', dataKey: keys[0], tickFormatter: formatValue }
    : { type: 'category', dataKey: labelKey, tick: { fontSize: 11, fill: 'var(--color-muted)' }, interval: 0 };

  const yProps = horizontal
    ? { type: 'category', dataKey: labelKey, width: 110, tick: { fontSize: 11, fill: 'var(--color-muted)' } }
    : { type: 'number', tickFormatter: formatValue, tick: { fontSize: 11, fill: 'var(--color-muted)' } };

  return (
    <div>
      {title && (
        <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {title}
        </p>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <ReBarChart
          data={data}
          layout={horizontal ? 'vertical' : 'horizontal'}
          margin={{ top: 4, right: 8, bottom: 4, left: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border, #334155)" opacity={0.5} />
          {horizontal ? <XAxis {...xProps} /> : <XAxis {...xProps} />}
          {horizontal ? <YAxis {...yProps} /> : <YAxis {...yProps} />}
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(val) => [formatValue(val)]}
            cursor={{ fill: 'rgba(99,102,241,0.08)' }}
          />
          {keys.map((key, ki) => (
            <Bar key={key} dataKey={key} fill={colors[ki % colors.length]} radius={[3, 3, 0, 0]} maxBarSize={48}>
              {!multi && data.map((_, i) => (
                <Cell key={i} fill={colors[i % colors.length]} />
              ))}
              {showValues && (
                <LabelList dataKey={key} position={horizontal ? 'right' : 'top'} style={{ fontSize: 10, fill: 'var(--color-text)' }} formatter={formatValue} />
              )}
            </Bar>
          ))}
        </ReBarChart>
      </ResponsiveContainer>
    </div>
  );
}
