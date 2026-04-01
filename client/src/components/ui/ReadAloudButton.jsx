/**
 * ReadAloudButton — reusable text-to-speech trigger with pause/resume.
 *
 * Props:
 *   text      (string) — the text to speak; stripped of markdown before synthesis
 *   size      (number) — icon size, default 16
 *   style     (object) — extra inline styles on the wrapper
 *   className (string)
 *
 * Renders nothing (null) when the browser doesn't support speechSynthesis.
 *
 * Three states:
 *   Idle    — volume icon; click to speak
 *   Speaking — pause icon (primary bg); click to pause
 *   Paused  — play icon (amber bg); click to resume; stop button also visible
 */
import { useIcon } from '../../providers/IconProvider';
import { useReadAloud } from '../../hooks/useReadAloud';

export default function ReadAloudButton({ text, size = 16, style = {}, className = '' }) {
  const getIcon = useIcon();
  const { speaking, paused, supported, speak, resume, stop } = useReadAloud();

  if (!supported) return null;

  const hasText = !!text?.trim();

  // ── Paused state — show resume + stop ────────────────────────────────────────
  if (paused) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, ...style }} className={className}>
        <button
          type="button"
          onClick={resume}
          title="Resume reading"
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            padding: 6, borderRadius: '50%', border: 'none', cursor: 'pointer',
            transition: 'background 0.2s',
            background: '#d97706', color: '#fff',
          }}
        >
          {getIcon('play', { size })}
        </button>
        <button
          type="button"
          onClick={stop}
          title="Stop reading"
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            padding: 6, borderRadius: '50%', border: 'none', cursor: 'pointer',
            transition: 'background 0.2s',
            background: 'transparent', color: 'var(--color-muted)',
          }}
        >
          {getIcon('x', { size })}
        </button>
      </span>
    );
  }

  // ── Speaking state — show pause ───────────────────────────────────────────────
  if (speaking) {
    return (
      <button
        type="button"
        onClick={speak}
        title="Pause reading"
        className={className}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          padding: 6, borderRadius: '50%', border: 'none', cursor: 'pointer',
          transition: 'background 0.2s',
          background: 'var(--color-primary)', color: '#fff',
          ...style,
        }}
      >
        {getIcon('pause', { size })}
      </button>
    );
  }

  // ── Idle state — show volume ──────────────────────────────────────────────────
  return (
    <button
      type="button"
      onClick={() => speak(text)}
      title="Read aloud"
      disabled={!hasText}
      className={className}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        padding: 6, borderRadius: '50%', border: 'none',
        cursor: hasText ? 'pointer' : 'default',
        transition: 'background 0.2s',
        background: 'transparent', color: 'var(--color-muted)',
        opacity: hasText ? 1 : 0.4,
        ...style,
      }}
    >
      {getIcon('volume', { size })}
    </button>
  );
}
