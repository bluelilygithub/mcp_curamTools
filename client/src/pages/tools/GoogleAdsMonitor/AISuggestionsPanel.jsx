/**
 * AISuggestionsPanel — renders the extracted suggestions array from a run result.
 * Priority: high (red) / medium (amber) / low (muted).
 */
const PRIORITY = {
  high:   { label: 'High',   bg: '#fef2f2', border: '#fca5a5', text: '#991b1b', dot: '#ef4444' },
  medium: { label: 'Medium', bg: '#fffbeb', border: '#fcd34d', text: '#92400e', dot: '#f59e0b' },
  low:    { label: 'Low',    bg: 'var(--color-surface)', border: 'var(--color-border)', text: 'var(--color-muted)', dot: 'var(--color-muted)' },
};

export default function AISuggestionsPanel({ suggestions = [] }) {
  if (!suggestions.length) return null;

  return (
    <div className="space-y-2">
      {suggestions.map((s, i) => {
        const p = PRIORITY[s.priority] ?? PRIORITY.low;
        return (
          <div
            key={i}
            className="flex gap-3 rounded-xl px-4 py-3"
            style={{ background: p.bg, border: `1px solid ${p.border}` }}
          >
            <span
              className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5"
              style={{ background: p.dot }}
            />
            <div className="flex-1 min-w-0">
              <span
                className="text-xs font-semibold uppercase tracking-wider mr-2"
                style={{ color: p.text }}
              >
                {p.label}
              </span>
              <span className="text-sm" style={{ color: 'var(--color-text)' }}>{s.text}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
