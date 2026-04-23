import { useState, useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker, Tooltip } from 'react-leaflet';
import api from '../../../api/client';
import MarkdownRenderer from '../../../components/ui/MarkdownRenderer';
import InlineBanner from '../../../components/ui/InlineBanner';

const AGENT_SLUG = 'geo-heatmap';
const AU_CENTER  = [-27.0, 133.8];
const AU_ZOOM    = 4;

// Scale marker radius: 3px–20px proportional to count (log scale)
function markerRadius(count, maxCount) {
  if (!count || !maxCount) return 4;
  const norm = Math.log(count + 1) / Math.log(maxCount + 1);
  return 4 + norm * 16;
}

// Progress bar identical to the parent page pattern
function ProgressBar({ lines }) {
  return (
    <div
      className="rounded-xl border p-4 mb-4"
      style={{ borderColor: 'var(--color-primary)', background: 'var(--color-surface)' }}
    >
      <style>{`@keyframes _gh_slide { 0%{left:-45%} 100%{left:110%} }`}</style>
      <p className="text-xs font-medium mb-2" style={{ color: 'var(--color-text)' }}>
        Geocoding and analysing leads — first run geocodes all unique suburbs (may take 1–3 min).
        <span style={{ color: 'var(--color-muted)' }}> Subsequent runs use cached coordinates.</span>
      </p>
      <div style={{ position: 'relative', height: 4, borderRadius: 2, overflow: 'hidden', background: 'var(--color-border)' }}>
        <div style={{
          position: 'absolute', top: 0, height: '100%', width: '45%',
          background: 'var(--color-primary)', borderRadius: 2,
          animation: '_gh_slide 1.4s ease-in-out infinite',
        }} />
      </div>
      {lines.length > 0 && (
        <div className="mt-3 space-y-0.5">
          {lines.slice(-4).map((l, i) => (
            <p key={i} className="text-xs" style={{ color: 'var(--color-muted)' }}>
              <span style={{ color: 'var(--color-primary)', marginRight: 6 }}>›</span>{l}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export default function GeoHeatmapTab({ startDate, endDate }) {
  const [running,    setRunning]    = useState(false);
  const [progress,   setProgress]   = useState([]);
  const [error,      setError]      = useState('');
  const [result,     setResult]     = useState(null);
  const [dataset,    setDataset]    = useState('notInterested'); // 'notInterested' | 'active'
  const [fullscreen, setFullscreen] = useState(false);

  // Auto-load most recent run
  useEffect(() => {
    api.get(`/agents/${AGENT_SLUG}/history`)
      .then((rows) => {
        const latest = rows?.find((r) => r.status === 'complete');
        if (latest?.result) setResult(latest.result);
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleRun() {
    setRunning(true);
    setProgress([]);
    setError('');

    try {
      const res     = await api.stream(`/agents/${AGENT_SLUG}/run`, { startDate, endDate });
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let resultReceived = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') { setRunning(false); return; }
          try {
            const msg = JSON.parse(raw);
            if (msg.type === 'progress')      setProgress((p) => [...p, msg.text]);
            else if (msg.type === 'result')  { resultReceived = true; setResult(msg.data); }
            else if (msg.type === 'error')     setError(msg.error);
          } catch { /* ignore parse errors */ }
        }
      }
      if (!resultReceived) setError('Run ended without a result — check server logs.');
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  }

  const locations     = result?.data?.locations ?? [];
  const activeDataset = dataset === 'notInterested'
    ? locations.filter((l) => l.notInterested > 0)
    : locations.filter((l) => l.active > 0);

  const maxCount = activeDataset.length
    ? Math.max(...activeDataset.map((l) => dataset === 'notInterested' ? l.notInterested : l.active))
    : 1;

  const niColor  = '#ef4444'; // red for not-interested
  const actColor = '#22c55e'; // green for active

  return (
    <div>
      {/* Run button row */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={handleRun}
          disabled={running}
          style={{
            padding: '0.4rem 1rem', fontSize: '0.875rem', fontWeight: 600,
            fontFamily: 'inherit', borderRadius: '0.5rem', border: 'none',
            background: running ? 'var(--color-border)' : 'var(--color-primary)',
            color: '#fff', cursor: running ? 'not-allowed' : 'pointer',
          }}
        >
          {running ? 'Running…' : 'Run Geo Heatmap'}
        </button>
        <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>
          Uses date range above · First run geocodes all suburbs (~1–3 min)
        </span>
      </div>

      {error && <InlineBanner type="error" message={error} onDismiss={() => setError('')} className="mb-4" />}
      {running && <ProgressBar lines={progress} />}

      {result && !running && (
        <>
          {/* Summary pills */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <span
              className="text-xs font-semibold rounded-full px-3 py-1"
              style={{ background: '#fee2e2', color: '#b91c1c' }}
            >
              {result.data?.notInterestedTotal} not interested
            </span>
            <span
              className="text-xs font-semibold rounded-full px-3 py-1"
              style={{ background: '#dcfce7', color: '#15803d' }}
            >
              {result.data?.activeTotal} active
            </span>
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
              {result.data?.geocodedCount} locations geocoded
              {result.data?.skippedCount > 0 && ` · ${result.data?.skippedCount} skipped (no suburb/postcode)`}
            </span>
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
              {result.startDate} – {result.endDate}
            </span>
          </div>

          {/* Toggle */}
          <div
            className="flex gap-0.5 rounded-lg p-1 mb-4 w-fit"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          >
            {[
              { key: 'notInterested', label: 'Not Interested', color: niColor },
              { key: 'active',        label: 'Active Leads',   color: actColor },
            ].map((opt) => (
              <button
                key={opt.key}
                onClick={() => setDataset(opt.key)}
                style={{
                  padding: '4px 12px', fontSize: 12, borderRadius: 6, border: 'none',
                  cursor: 'pointer', fontFamily: 'inherit',
                  background: dataset === opt.key ? opt.color : 'transparent',
                  color:      dataset === opt.key ? '#fff' : 'var(--color-muted)',
                  fontWeight: dataset === opt.key ? 600 : 400,
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Map */}
          <div
            style={fullscreen ? {
              position: 'fixed', inset: 0, zIndex: 9999,
              background: 'var(--color-bg)',
              display: 'flex', flexDirection: 'column',
            } : { position: 'relative', marginBottom: '1.5rem' }}
          >
            {/* Fullscreen toggle button */}
            <button
              onClick={() => setFullscreen((v) => !v)}
              title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              style={{
                position: 'absolute', top: 8, right: 8, zIndex: 1000,
                width: 32, height: 32, borderRadius: 6, border: '1px solid var(--color-border)',
                background: 'var(--color-surface)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--color-text)',
              }}
            >
              {fullscreen
                ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>
                : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 8V5a2 2 0 0 1 2-2h3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M21 16v3a2 2 0 0 1-2 2h-3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/></svg>
              }
            </button>
            <div
              className={fullscreen ? '' : 'rounded-xl overflow-hidden'}
              style={{
                border: '1px solid var(--color-border)',
                height: fullscreen ? '100%' : 480,
                flex: fullscreen ? 1 : undefined,
              }}
            >
            <MapContainer
              center={AU_CENTER}
              zoom={AU_ZOOM}
              style={{ height: '100%', width: '100%' }}
              scrollWheelZoom
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
                url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
                subdomains="abcd"
                maxZoom={19}
              />
              {activeDataset.map((loc, i) => {
                const count  = dataset === 'notInterested' ? loc.notInterested : loc.active;
                const color  = dataset === 'notInterested' ? niColor : actColor;
                const radius = markerRadius(count, maxCount);
                return (
                  <CircleMarker
                    key={i}
                    center={[loc.lat, loc.lng]}
                    radius={radius}
                    pathOptions={{
                      color,
                      fillColor:   color,
                      fillOpacity: 0.55,
                      weight:      1,
                    }}
                  >
                    <Tooltip>
                      <strong>{loc.suburb ? loc.suburb.replace(/\b\w/g, c => c.toUpperCase()) : loc.postcode}</strong>
                      {loc.suburb && loc.postcode && <span> ({loc.postcode})</span>}
                      <br />
                      {dataset === 'notInterested'
                        ? `${count} not interested`
                        : `${count} active`}
                    </Tooltip>
                  </CircleMarker>
                );
              })}
            </MapContainer>
            </div>
          </div>

          {/* AI Observations */}
          {result.summary && (
            <div
              className="rounded-2xl border p-5"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
            >
              <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text)' }}>
                Geographic Observations
              </h3>
              <MarkdownRenderer text={result.summary} />
            </div>
          )}
        </>
      )}

      {!result && !running && (
        <div
          className="rounded-2xl border p-8 text-center"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
        >
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
            Click <strong>Run Geo Heatmap</strong> to map lead locations for the selected date range.
          </p>
        </div>
      )}
    </div>
  );
}
