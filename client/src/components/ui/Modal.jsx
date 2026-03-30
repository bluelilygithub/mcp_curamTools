/**
 * Modal — z-50; backdrop click + Escape + × close.
 * Panel: rounded-2xl.
 * ConfirmModal variant: type-to-confirm input for high-stakes destructive operations.
 */
import { useEffect, useRef, useState } from 'react';
import Button from './Button';

export default function Modal({ open, onClose, title, children, maxWidth = 'max-w-sm' }) {
  // Escape key dismiss
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onMouseDown={(e) => {
        // Backdrop click
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`relative w-full ${maxWidth} rounded-2xl border flex flex-col`}
        style={{
          background: 'var(--color-surface)',
          borderColor: 'var(--color-border)',
          maxHeight: '90vh',
        }}
      >
        {/* Header — fixed, never scrolls */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
          <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
            {title}
          </h2>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded-lg hover:opacity-70 transition-all text-lg leading-none"
            style={{ color: 'var(--color-muted)' }}
            aria-label="Close modal"
          >
            ×
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto px-6 pb-6 space-y-4">
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * ConfirmModal — requires user to type a confirmation string before proceeding.
 * Use only for high-stakes destructive operations.
 */
export function ConfirmModal({ open, onClose, onConfirm, title, message, confirmText, danger = false }) {
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setInputValue('');
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const matches = confirmText ? inputValue === confirmText : true;

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="text-sm" style={{ color: 'var(--color-text)' }}>{message}</p>

      {confirmText && (
        <div>
          <p className="text-xs mb-1.5" style={{ color: 'var(--color-muted)' }}>
            Type <strong>{confirmText}</strong> to confirm:
          </p>
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
            style={{
              background: 'var(--color-bg)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text)',
            }}
          />
        </div>
      )}

      <div className="flex gap-2 justify-end pt-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button
          variant={danger ? 'danger' : 'primary'}
          onClick={() => { onConfirm(); onClose(); }}
          disabled={!matches}
        >
          Confirm
        </Button>
      </div>
    </Modal>
  );
}
