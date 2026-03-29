/**
 * InlineBanner — persistent contextual warnings inside content areas.
 * Three tiers: error, warning, neutral.
 * Not a toast — persists until condition clears or user dismisses.
 */
export default function InlineBanner({ type = 'neutral', message, onDismiss }) {
  const styles = {
    error: {
      background: '#fff1f2',
      borderColor: '#fca5a5',
      color: '#991b1b',
    },
    warning: {
      background: '#fffbeb',
      borderColor: '#fde68a',
      color: '#78350f',
    },
    neutral: {
      background: 'var(--color-surface)',
      borderColor: 'var(--color-border)',
      color: 'var(--color-text)',
    },
  };

  const s = styles[type] ?? styles.neutral;

  return (
    <div
      className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl border text-xs"
      style={s}
      role={type === 'error' ? 'alert' : 'status'}
    >
      <span className="flex-1">{message}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="shrink-0 hover:opacity-70 transition-all leading-none"
          aria-label="Dismiss"
          style={{ color: s.color, opacity: 0.6 }}
        >
          ×
        </button>
      )}
    </div>
  );
}
