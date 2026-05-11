'use strict';
import { useState, useEffect, useRef } from 'react';
import { useIcon } from '../../providers/IconProvider';

/**
 * ProcessingModal — full-screen overlay for multi-stage agent runs.
 *
 * Props:
 *   stages              Array<{ id, label, description, status }>
 *   estimatedDuration   string   e.g. "Typical processing time: 3–5 minutes."
 *   onCancel            function Called after user confirms cancellation.
 *   cancelConfirmMessage string  Confirmation prompt shown before cancelling.
 *   isOpen              boolean  Parent controls visibility.
 */
export default function ProcessingModal({
  stages,
  estimatedDuration,
  onCancel,
  cancelConfirmMessage,
  isOpen,
}) {
  const getIcon = useIcon();
  const [tick, setTick]                   = useState(0);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [stageDurations, setStageDurations]       = useState({});

  const intervalRef    = useRef(null);
  const stageStartRef  = useRef({});
  const prevStagesRef  = useRef([]);
  const openTimeRef    = useRef(null);

  // Start / stop the 1s tick that drives all live elapsed counters.
  useEffect(() => {
    if (isOpen) {
      openTimeRef.current   = Date.now();
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

  // Track per-stage start and completion times.
  useEffect(() => {
    if (!isOpen) return;
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
            Processing…
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
            {estimatedDuration}
          </p>
        </div>

        {/* Stage list */}
        <div className="space-y-4">
          {stages.map((s) => (
            <div key={s.id} className="flex items-start gap-3">
              {/* Status icon */}
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

              {/* Label + elapsed + description */}
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

        {/* Browser tab note */}
        <p className="text-xs italic" style={{ color: 'var(--color-muted)' }}>
          Processing continues if you switch browser tabs.
        </p>

        {/* Cancel flow */}
        {!showCancelConfirm ? (
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
        ) : (
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
