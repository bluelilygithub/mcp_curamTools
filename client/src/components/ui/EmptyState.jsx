/**
 * EmptyState — centred column; icon 32px; text-sm message; text-xs hint.
 */
import { useIcon } from '../../providers/IconProvider';

export default function EmptyState({ icon = 'layers', message, hint }) {
  const getIcon = useIcon();

  return (
    <div className="flex flex-col items-center justify-center h-full gap-2 py-12">
      <span style={{ color: 'var(--color-muted)' }}>
        {getIcon(icon, { size: 32 })}
      </span>
      {message && (
        <p className="text-sm" style={{ color: 'var(--color-text)' }}>
          {message}
        </p>
      )}
      {hint && (
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          {hint}
        </p>
      )}
    </div>
  );
}
