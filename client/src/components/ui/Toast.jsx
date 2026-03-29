/**
 * Toast — fixed bottom-5 right-5 z-[9999].
 * Coloured dot precedes message. Auto-dismiss 3000ms. × close button.
 * Success uses var(--color-primary) (branded). Warning: #f59e0b. Error: #ef4444.
 *
 * Usage via ToastContext:
 *   const { showToast } = useToast();
 *   showToast('Saved!', 'success');
 *   showToast('Something failed', 'error');
 */
import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';

const DOT_COLOURS = {
  success: 'var(--color-primary)',
  warning: '#f59e0b',
  error: '#ef4444',
  info: 'var(--color-muted)',
};

function ToastItem({ id, message, type, onDismiss }) {
  useEffect(() => {
    const t = setTimeout(() => onDismiss(id), 3000);
    return () => clearTimeout(t);
  }, [id, onDismiss]);

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg text-sm animate-fade-in"
      style={{
        minWidth: 220,
        maxWidth: 360,
        background: 'var(--color-surface)',
        borderColor: 'var(--color-border)',
        color: 'var(--color-text)',
      }}
      role="alert"
    >
      {/* Coloured dot */}
      <span
        className="shrink-0 w-1.5 h-1.5 rounded-full"
        style={{ background: DOT_COLOURS[type] ?? DOT_COLOURS.info }}
      />

      <span className="flex-1">{message}</span>

      <button
        onClick={() => onDismiss(id)}
        className="shrink-0 text-sm leading-none hover:opacity-80 transition-all"
        style={{ opacity: 0.4, color: 'var(--color-text)' }}
        aria-label="Close"
      >
        ×
      </button>
    </div>
  );
}

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const seq = useRef(0);

  const showToast = useCallback((message, type = 'info') => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, message, type }]);
  }, []);

  const dismiss = useCallback((id) => {
    setToasts((t) => t.filter((toast) => toast.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} {...t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
