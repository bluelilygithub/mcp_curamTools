/**
 * ReadAloudButton — reusable text-to-speech trigger.
 *
 * Props:
 *   text      (string) — the text to speak; stripped of markdown before synthesis
 *   size      (number) — icon size, default 16
 *   style     (object) — extra inline styles
 *   className (string)
 *
 * Renders nothing (null) when the browser doesn't support speechSynthesis.
 * Clicking while speaking stops playback (toggle behaviour).
 */
import { useIcon } from '../../providers/IconProvider';
import { useReadAloud } from '../../hooks/useReadAloud';

export default function ReadAloudButton({ text, size = 16, style = {}, className = '' }) {
  const getIcon = useIcon();
  const { speaking, supported, speak, stop } = useReadAloud();

  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={() => speaking ? stop() : speak(text)}
      title={speaking ? 'Stop reading' : 'Read aloud'}
      disabled={!text?.trim()}
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 6,
        borderRadius: '50%',
        border: 'none',
        cursor: text?.trim() ? 'pointer' : 'default',
        transition: 'background 0.2s',
        background: speaking ? 'var(--color-primary)' : 'transparent',
        color: speaking ? '#fff' : 'var(--color-muted)',
        opacity: text?.trim() ? 1 : 0.4,
        ...style,
      }}
    >
      {getIcon('volume', { size })}
    </button>
  );
}
