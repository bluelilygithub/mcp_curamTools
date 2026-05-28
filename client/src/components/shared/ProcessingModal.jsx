'use strict';
import { useState, useEffect, useRef } from 'react';
import { useIcon } from '../../providers/IconProvider';

/**
 * ProcessingModal — full-screen overlay for agent runs.
 *
 * Props:
 *   isOpen              boolean  Parent controls visibility.
 *   stages              Array<{ id, label, description, status }> — optional.
 *                       Omit for a simple spinner; provide for step-by-step tracking.
 *   title               string   Heading. Default "Processing…"
 *   estimatedDuration   string   e.g. "Typical processing time: 3–5 minutes."
 *   onCancel            function Called after user confirms. Omit to hide cancel button.
 *   cancelConfirmMessage string  Confirmation text before cancelling.
 */
export default function ProcessingModal({
  stages,
  title = 'Processing…',
  estimatedDuration,
  onCancel,
  cancelConfirmMessage,
  isOpen,
}) {
  const getIcon = useIcon();
  const [tick, setTick]                           = useState(0);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [stageDurations, setStageDurations]       = useState({});

  const intervalRef   = useRef(null);
  const stageStartRef = useRef({});
  const prevStagesRef = useRef([]);

  // Drive live elapsed counters with a 1 s tick.
  useEffect(() => {
    if (isOpen) {
      stageStartRef.current = {};
      prevStagesRef.current = [];
      setTick(0);
      setShowCancelConfirm(false);
      setStageDurations({});
      intervalRef.current = setInterval(() => setTick((n) => n + 1), 1000);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [isOpen]);

  // Warn the browser before the user navigates or closes the tab while processing.
  useEffect(() => {
    if (!isOpen) return;
    const handle = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handle);
    return () => window.removeEventListener('beforeunload', handle);
  }, [isOpen]);

  // Track per-stage elapsed and completion times.
  useEffect(() => {
    if (!isOpen || !stages?.length) return;
    const now = Date.now();
    stages.forEach((s) => {
      const prev = prevStagesRef.current.find((p) => p.id === s.id);
      if (s.status === 'active' && (!prev || prev.status !== 'active')) {
        stageStartRef.current[s.id] = now;
      }
      if (s.status === 'complete' && (!prev || prev.status !== 'complete')) {
        const started = stageStartRef.current[s.id];
        if (started) {
          setStageDurations((d) => ({ ...d, [s.id]: Math.round((now - started) / 1000) }));
        }
      }
    });
    prevStagesRef.current = stages;
  }, [stages, isOpen]);

  if (!isOpen) return null;

  const fmt = (s) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`);
  const stageElapsed = (id) => {
    const started = stageStartRef.current[id];
    return started ? Math.max(0, Math.floor((Date.now() - started) / 1000)) : 0;
  };

  const hasStages = Array.isArray(stages) && stages.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
    >
      <div
        className="rounded-2xl p-6 w-full max-w-md space-y-5"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
      >
        {/* Header */}
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            {title}
          </p>
          {estimatedDuration && (
            <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
              {estimatedDuration}
            </p>
          )}
        </div>

        {/* Stage list — only when stages are provided */}
        {hasStages && (
          <div className="space-y-4">
            {stages.map((s) => (
              <div key={s.id} className="flex items-start gap-3">
                <div className="shrink-0 mt-0.5">
                  {s.status === 'complete' && (
                    <span style={{ color: '#16a34a' }}>
                      {getIcon('check-circle', { size: 16 })}
                    </span>
                  )}
                  {s.status === 'active' && (
                    <span className="animate-spin inline-block" style={{ color: 'var(--color-primary)' }}>
                      {getIcon('loader', { size: 16 })}
                    </span>
                  )}
                  {s.status === 'pending' && (
                    <div
                      style={{
                        width: 16, height: 16, borderRadius: '50%',
                        border: '2px solid var(--color-border)', flexShrink: 0,
                      }}
                    />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p
                      className="text-sm font-medium"
                      style={{ color: s.status === 'pending' ? 'var(--color-muted)' : 'var(--color-text)' }}
                    >
                      {s.label}
                    </p>
                    {s.status === 'complete' && stageDurations[s.id] != null && (
                      <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                        {fmt(stageDurations[s.id])}
                      </span>
                    )}
                    {s.status === 'active' && (
                      <span className="text-xs tabular-nums" style={{ color: 'var(--color-muted)' }}>
                        {fmt(stageElapsed(s.id))}
                      </span>
                    )}
                  </div>
                  {s.description && s.status !== 'pending' && (
                    <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                      {s.description}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Simple spinner — shown when no stages provided */}
        {!hasStages && (
          <div className="flex items-center gap-3">
            <span className="animate-spin inline-block shrink-0" style={{ color: 'var(--color-primary)' }}>
              {getIcon('loader', { size: 20 })}
            </span>
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
              This may take a minute — results will appear when complete.
            </p>
          </div>
        )}

        {/* Stay-on-page warning */}
        <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
          Please stay on this page — navigating away will interrupt processing and results will be lost.
        </p>

        {/* Cancel — only shown when onCancel is provided */}
        {onCancel && !showCancelConfirm && (
          <button
            onClick={() => setShowCancelConfirm(true)}
            className="text-xs rounded-xl px-3 py-1.5 hover:opacity-70"
            style={{
              background: 'var(--color-bg)', color: 'var(--color-muted)',
              border: '1px solid var(--color-border)', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        )}
        {onCancel && showCancelConfirm && (
          <div className="space-y-2">
            <p className="text-xs" style={{ color: 'var(--color-text)' }}>
              {cancelConfirmMessage}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={onCancel}
                className="text-xs rounded-xl px-3 py-1.5 hover:opacity-80"
                style={{ background: '#fee2e2', color: '#991b1b', cursor: 'pointer' }}
              >
                Confirm cancel
              </button>
              <button
                onClick={() => setShowCancelConfirm(false)}
                className="text-xs rounded-xl px-3 py-1.5 hover:opacity-70"
                style={{
                  background: 'var(--color-bg)', color: 'var(--color-muted)',
                  border: '1px solid var(--color-border)', cursor: 'pointer',
                }}
              >
                Keep waiting
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
