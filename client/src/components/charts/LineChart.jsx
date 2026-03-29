/**
 * LineChart — generic zero-dependency SVG dual-axis line chart.
 * Platform primitive for time-series data visualisation.
 *
 * Props:
 *   data        {array}    — array of objects
 *   xKey        {string}   — key for x-axis values (e.g. 'date')
 *   leftKey     {string}   — key for left-axis series
 *   rightKey    {string}   — key for right-axis series
 *   leftLabel   {string}   — y-axis label for left series
 *   rightLabel  {string}   — y-axis label for right series
 *   leftFormat  {function} — formatter for left-axis values (tooltip + axis)
 *   rightFormat {function} — formatter for right-axis values (tooltip + axis)
 *   leftColor   {string}   — CSS colour for left series line
 *   rightColor  {string}   — CSS colour for right series line
 */
import { useState } from 'react';

const DEFAULT_LEFT_COLOR = 'var(--color-primary)';
const DEFAULT_RIGHT_COLOR = '#6C8EBF';
const PADDING = { top: 20, right: 48, bottom: 40, left: 56 };

function minMax(values) {
  const clean = values.filter((v) => v != null && !isNaN(v));
  if (!clean.length) return { min: 0, max: 1 };
  return { min: Math.min(...clean), max: Math.max(...clean) };
}

function toPoints(data, key, xScale, yScale, padLeft, padTop, height, innerH) {
  return data.map((d, i) => {
    const x = padLeft + i * xScale;
    const v = d[key] ?? 0;
    const y = padTop + innerH - (v - yScale.min) / (yScale.max - yScale.min || 1) * innerH;
    return [x, y];
  });
}

export default function LineChart({
  data = [],
  xKey = 'x',
  leftKey = 'left',
  rightKey = 'right',
  leftLabel = '',
  rightLabel = '',
  leftFormat = (v) => v,
  rightFormat = (v) => v,
  leftColor = DEFAULT_LEFT_COLOR,
  rightColor = DEFAULT_RIGHT_COLOR,
  height: chartHeight = 220,
}) {
  const [tooltip, setTooltip] = useState(null);

  if (!data.length) {
    return (
      <div
        style={{ height: chartHeight, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}
      >
        <span style={{ color: 'var(--color-muted)' }}>No data</span>
      </div>
    );
  }

  const leftValues = data.map((d) => d[leftKey]);
  const rightValues = data.map((d) => d[rightKey]);
  const leftScale = minMax(leftValues);
  const rightScale = minMax(rightValues);

  const svgWidth = '100%';
  const svgHeight = chartHeight;

  const innerW = 600 - PADDING.left - PADDING.right; // reference width (viewBox)
  const innerH = chartHeight - PADDING.top - PADDING.bottom;
  const xStep = data.length > 1 ? innerW / (data.length - 1) : 0;

  const leftPts = toPoints(data, leftKey, xStep, leftScale, PADDING.left, PADDING.top, chartHeight, innerH);
  const rightPts = toPoints(data, rightKey, xStep, rightScale, PADDING.left, PADDING.top, chartHeight, innerH);

  const polyline = (pts) => pts.map((p) => p.join(',')).join(' ');

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg
        viewBox={`0 0 600 ${chartHeight}`}
        style={{ width: '100%', height: chartHeight, display: 'block', overflow: 'visible' }}
      >
        {/* Gridlines */}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = PADDING.top + (1 - t) * innerH;
          return (
            <line
              key={t}
              x1={PADDING.left} y1={y}
              x2={600 - PADDING.right} y2={y}
              stroke="var(--color-border)"
              strokeWidth={1}
              strokeDasharray="4,4"
            />
          );
        })}

        {/* Left axis labels */}
        {[0, 0.5, 1].map((t) => {
          const v = leftScale.min + t * (leftScale.max - leftScale.min);
          const y = PADDING.top + (1 - t) * innerH;
          return (
            <text key={t} x={PADDING.left - 6} y={y + 4} textAnchor="end" fontSize={10} fill="var(--color-muted)">
              {leftFormat(v)}
            </text>
          );
        })}

        {/* Right axis labels */}
        {[0, 0.5, 1].map((t) => {
          const v = rightScale.min + t * (rightScale.max - rightScale.min);
          const y = PADDING.top + (1 - t) * innerH;
          return (
            <text key={t} x={600 - PADDING.right + 6} y={y + 4} textAnchor="start" fontSize={10} fill="var(--color-muted)">
              {rightFormat(v)}
            </text>
          );
        })}

        {/* X axis labels */}
        {data.map((d, i) => {
          const x = PADDING.left + i * xStep;
          const label = String(d[xKey] ?? '');
          // Show every Nth label to avoid crowding
          const step = Math.max(1, Math.round(data.length / 6));
          if (i % step !== 0 && i !== data.length - 1) return null;
          return (
            <text key={i} x={x} y={chartHeight - 8} textAnchor="middle" fontSize={10} fill="var(--color-muted)">
              {label.length > 8 ? label.slice(0, 8) : label}
            </text>
          );
        })}

        {/* Right series line */}
        {rightKey && rightPts.length > 1 && (
          <polyline
            points={polyline(rightPts)}
            fill="none"
            stroke={rightColor}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Left series line */}
        {leftPts.length > 1 && (
          <polyline
            points={polyline(leftPts)}
            fill="none"
            stroke={leftColor}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Hover targets */}
        {data.map((d, i) => {
          const x = PADDING.left + i * xStep;
          return (
            <rect
              key={i}
              x={x - xStep / 2}
              y={PADDING.top}
              width={xStep || 20}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setTooltip({ i, x, d })}
              onMouseLeave={() => setTooltip(null)}
              style={{ cursor: 'crosshair' }}
            />
          );
        })}

        {/* Tooltip vertical line */}
        {tooltip && (
          <line
            x1={tooltip.x} y1={PADDING.top}
            x2={tooltip.x} y2={PADDING.top + innerH}
            stroke="var(--color-muted)"
            strokeWidth={1}
            strokeDasharray="4,2"
          />
        )}
      </svg>

      {/* Tooltip box */}
      {tooltip && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: `calc(${((tooltip.x) / 600) * 100}% + 8px)`,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 8,
            padding: '6px 10px',
            fontSize: 12,
            color: 'var(--color-text)',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 10,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 2 }}>{String(tooltip.d[xKey] ?? '')}</div>
          {leftKey && (
            <div style={{ color: leftColor }}>
              {leftLabel || leftKey}: {leftFormat(tooltip.d[leftKey])}
            </div>
          )}
          {rightKey && (
            <div style={{ color: rightColor }}>
              {rightLabel || rightKey}: {rightFormat(tooltip.d[rightKey])}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
