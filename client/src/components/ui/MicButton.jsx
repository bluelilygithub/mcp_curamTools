/**
 * MicButton — reusable voice input trigger.
 *
 * Props:
 *   onResult  (fn)     — called with the final transcript string
 *   onPartial (fn)     — optional; called with interim transcript while speaking
 *   size      (number) — icon size, default 16
 *   style     (object) — extra inline styles
 *   className (string)
 *
 * Renders nothing (null) when the browser doesn't support SpeechRecognition.
 * Shows a pulsing red ring while listening.
 */
import { useIcon } from '../../providers/IconProvider';
import { useSpeechInput } from '../../hooks/useSpeechInput';

export default function MicButton({ onResult, onPartial, size = 16, style = {}, className = '' }) {
  const getIcon  = useIcon();
  const { listening, supported, start, stop } = useSpeechInput({ onResult, onPartial });

  if (!supported) return null;

  return (
    <>
      {listening && (
        <style>{`
          @keyframes _mic_pulse {
            0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.4); }
            50%       { box-shadow: 0 0 0 6px rgba(239,68,68,0); }
          }
        `}</style>
      )}
      <button
        type="button"
        onClick={listening ? stop : start}
        title={listening ? 'Stop listening' : 'Speak your question'}
        className={className}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 6,
          borderRadius: '50%',
          border: 'none',
          cursor: 'pointer',
          transition: 'background 0.2s',
          background: listening ? '#ef4444' : 'transparent',
          color: listening ? '#fff' : 'var(--color-muted)',
          animation: listening ? '_mic_pulse 1.2s ease-in-out infinite' : 'none',
          ...style,
        }}
      >
        {getIcon('mic', { size })}
      </button>
    </>
  );
}
