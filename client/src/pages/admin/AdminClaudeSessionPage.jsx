/**
 * AdminClaudeSessionPage — visual tracker for Claude Code usage windows.
 *
 * Two gauges calculated purely from configured start time + current clock:
 *   1. 5-hour daily window — how far through the current session
 *   2. Weekly window       — how far through the ISO week (Mon–Sun)
 *
 * No Claude Code API data available — this is time-based only.
 * Gauges refresh every 30 seconds automatically.
 */
import { useState, useEffect, useCallback } from 'react';
import api from '../../api/client';
import Button from '../../components/ui/Button';
import InlineBanner from '../../components/ui/InlineBanner';

const SESSION_HOURS = 5;
const SESSION_MINS  = SESSION_HOURS * 60;
const WEEK_DAYS     = 7;

// ── SVG Donut Gauge ───────────────────────────────────────────────────────

function gaugeColor(pct) {
  if (pct >= 0.85) return '#ef4444'; // red
  if (pct >= 0.65) return '#f59e0b'; // amber
  return '#22c55e';                  // green
}

function DonutGauge({ pct, label, sublabel, size = 160 }) {
  const r     = 46;
  const cx    = 50;
  const cy    = 50;
  const circ  = 2 * Math.PI * r;
  const fill  = Math.min(Math.max(pct, 0), 1);
  const color = gaugeColor(fill);

  return (
    <div className="flex flex-col items-center gap-3">
      <svg width={size} height={size} viewBox="0 0 100 100">
        {/* Track */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          strokeWidth="10"
          style={{ stroke: 'var(--color-border)' }}
        />
        {/* Progress arc — starts at 12 o'clock */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          strokeWidth="10"
          stroke={color}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - fill)}
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: 'stroke-dashoffset 0.6s ease, stroke 0.4s ease' }}
        />
        {/* Centre percentage */}
        <text
          x="50" y="47"
          textAnchor="middle"
          fontSize="16"
          fontWeight="700"
          fill={color}
        >
          {Math.round(fill * 100)}%
        </text>
        <text
          x="50" y="60"
          textAnchor="middle"
          fontSize="7"
          fill="var(--color-muted)"
        >
          used
        </text>
      </svg>
      <div className="text-center space-y-0.5">
        <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{label}</p>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{sublabel}</p>
      </div>
    </div>
  );
}

// ── Time calculation helpers ──────────────────────────────────────────────

function parseHHMM(str) {
  const [h, m] = (str ?? '06:00').split(':').map(Number);
  return { h: h || 0, m: m || 0 };
}

function fmt12(date) {
  const h    = date.getHours();
  const m    = date.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12  = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')}${ampm}`;
}

function fmtDuration(mins) {
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${mins}m`;
}

function computeWindows(cfg) {
  const timeStr    = (typeof cfg === 'object' && cfg !== null) ? (cfg.daily_start ?? '06:00') : (cfg ?? '06:00');
  const now        = new Date();
  const { h, m }  = parseHHMM(timeStr);
  const windowMs   = SESSION_MINS * 60_000;

  // First window anchor for today
  const firstStart = new Date(now);
  firstStart.setHours(h, m, 0, 0);

  // 5-hour window — find which window we're currently in
  let pct5h, sessionLabel, sessionSub;

  if (now < firstStart) {
    const minsUntil = Math.ceil((firstStart - now) / 60_000);
    pct5h        = 0;
    sessionLabel = `Starts in ${fmtDuration(minsUntil)}`;
    sessionSub   = `First session begins at ${fmt12(firstStart)}`;
  } else {
    const elapsed      = now - firstStart;
    const winIdx       = Math.floor(elapsed / windowMs);
    const winStart     = new Date(firstStart.getTime() + winIdx * windowMs);
    const winEnd       = new Date(winStart.getTime() + windowMs);
    const elapsedInWin = now - winStart;

    pct5h = elapsedInWin / windowMs;

    const minsLeft = Math.ceil((winEnd - now) / 60_000);
    sessionLabel   = `${fmtDuration(minsLeft)} remaining`;
    sessionSub     = `Window ${winIdx + 1} · Resets at ${fmt12(winEnd)}`;
  }

  // Weekly window — days elapsed since configured start day
  const DAY_NAMES  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const startDay   = (typeof cfg === 'object' && cfg !== null) ? (cfg.weekly_start_day ?? 1) : 1;
  const dow        = (now.getDay() - startDay + 7) % 7; // 0 = it's the start day
  const dayFrac    = (now.getHours() * 60 + now.getMinutes()) / (24 * 60);
  const pctWeek    = (dow + dayFrac) / WEEK_DAYS;
  const daysLeft   = WEEK_DAYS - dow - 1;
  const weekDay    = DAY_NAMES[now.getDay()];
  const startName  = DAY_NAMES[startDay];
  const weekLabel  = daysLeft > 0 ? `${daysLeft}d remaining` : 'Last day of week';
  const weekSub    = `${weekDay} — day ${dow + 1} of 7 (resets ${startName})`;

  return { pct5h, sessionLabel, sessionSub, pctWeek, weekLabel, weekSub };
}

// ── Page ──────────────────────────────────────────────────────────────────

const DAY_OPTIONS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

export default function AdminClaudeSessionPage() {
  const [config,     setConfig]     = useState(null);
  const [windows,    setWindows]    = useState(null);
  const [start,      setStart]      = useState('06:00');
  const [weeklyDay,  setWeeklyDay]  = useState(1);
  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [success,    setSuccess]    = useState('');
  const [error,      setError]      = useState('');

  const refresh = useCallback((cfg) => {
    setWindows(computeWindows(cfg));
  }, []);

  useEffect(() => {
    api.get('/admin/claude-session-config')
      .then((cfg) => {
        setConfig(cfg);
        setStart(cfg.daily_start ?? '06:00');
        setWeeklyDay(cfg.weekly_start_day ?? 1);
        refresh(cfg);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [refresh]);

  // Refresh gauges every 30s
  useEffect(() => {
    if (!config) return;
    const id = setInterval(() => refresh(config), 30_000);
    return () => clearInterval(id);
  }, [config, refresh]);

  function livePreview(newStart, newWeeklyDay) {
    setWindows(computeWindows({ daily_start: newStart, weekly_start_day: newWeeklyDay }));
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setSuccess('');
    setError('');
    try {
      const updated = await api.put('/admin/claude-session-config', { daily_start: start, weekly_start_day: weeklyDay });
      setConfig(updated);
      refresh(updated);
      setSuccess('Saved. Gauges updated.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Claude Code Sessions</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
          Track your position within Claude Code's 5-hour and weekly usage windows.
          Gauges are time-based — they refresh every 30 seconds.
        </p>
      </div>

      {error   && <InlineBanner type="error"   message={error}   onDismiss={() => setError('')} />}
      {success && <InlineBanner type="neutral" message={success} onDismiss={() => setSuccess('')} />}

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>
      ) : (
        <>
          {/* Gauges */}
          <section
            className="rounded-2xl border p-8"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
          >
            <div className="flex flex-wrap justify-around gap-10">
              {windows && (
                <>
                  <DonutGauge
                    pct={windows.pct5h}
                    label={windows.sessionLabel}
                    sublabel={windows.sessionSub}
                  />
                  <DonutGauge
                    pct={windows.pctWeek}
                    label={windows.weekLabel}
                    sublabel={windows.weekSub}
                  />
                </>
              )}
            </div>

            {/* Legend */}
            <div className="mt-8 flex flex-wrap justify-center gap-6 text-xs" style={{ color: 'var(--color-muted)' }}>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: '#22c55e' }} />
                Under 65%
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: '#f59e0b' }} />
                65–85%
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: '#ef4444' }} />
                Over 85%
              </span>
            </div>
          </section>

          {/* Info cards */}
          <div className="grid grid-cols-2 gap-4">
            <div
              className="rounded-2xl border p-5 space-y-1"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
            >
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                5-hour window
              </p>
              <p className="text-sm" style={{ color: 'var(--color-text)' }}>
                Starts from your <strong>first message</strong> of the session — not from when you hit the limit.
              </p>
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                e.g. start 6:00am → limit window closes 11:00am
              </p>
            </div>
            <div
              className="rounded-2xl border p-5 space-y-1"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
            >
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                Weekly cap
              </p>
              <p className="text-sm" style={{ color: 'var(--color-text)' }}>
                Separate to the 5-hour window. Exhausting it means waiting for the 7-day reset — the 5-hour reset won't restore access.
              </p>
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                Check current status: <code style={{ fontFamily: 'var(--font-mono)' }}>/usage</code> in Claude Code terminal
              </p>
            </div>
          </div>

          {/* Settings */}
          <section
            className="rounded-2xl border p-6 space-y-4"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
          >
            <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
              Session configuration
            </h2>
            <form onSubmit={save} className="space-y-4">
              <div className="space-y-1">
                <label className="block text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                  Daily session start time
                </label>
                <input
                  type="time"
                  value={start}
                  onChange={(e) => {
                    setStart(e.target.value);
                    livePreview(e.target.value, weeklyDay);
                  }}
                  className="rounded-xl px-3 py-2 text-sm outline-none"
                  style={{ border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
                />
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  Time you typically start your first Claude Code session. The 5-hour gauge counts from here.
                </p>
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                  Weekly window resets on
                </label>
                <select
                  value={weeklyDay}
                  onChange={(e) => {
                    const d = Number(e.target.value);
                    setWeeklyDay(d);
                    livePreview(start, d);
                  }}
                  className="rounded-xl px-3 py-2 text-sm outline-none"
                  style={{ border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
                >
                  {DAY_OPTIONS.map(({ value, label }) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  Day your Claude Code weekly cap resets. Drives the weekly gauge.
                </p>
              </div>
              <div className="flex justify-end">
                <Button type="submit" variant="primary" disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </form>
          </section>
        </>
      )}
    </div>
  );
}
