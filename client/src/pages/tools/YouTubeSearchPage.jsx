import { useState, useEffect, useCallback } from 'react';
import api from '../../api/client';

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseDuration(iso) {
  if (!iso) return null;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return iso;
  const h = parseInt(m[1] || 0);
  const min = parseInt(m[2] || 0);
  const s = parseInt(m[3] || 0);
  if (h > 0) return `${h}:${String(min).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${min}:${String(s).padStart(2, '0')}`;
}

function fmtViews(n) {
  if (!n) return null;
  const v = parseInt(n);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M views`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K views`;
  return `${v} views`;
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86_400_000);
  if (d < 1) return 'today';
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

const PUBLISHED_AFTER_OPTIONS = [
  { label: 'Any time',    key: '',        getIso: null },
  { label: 'Past hour',   key: 'hour',    getIso: () => new Date(Date.now() - 3_600_000).toISOString() },
  { label: 'Today',       key: 'today',   getIso: () => new Date(Date.now() - 86_400_000).toISOString() },
  { label: 'This week',   key: 'week',    getIso: () => new Date(Date.now() - 7 * 86_400_000).toISOString() },
  { label: 'This month',  key: 'month',   getIso: () => new Date(Date.now() - 30 * 86_400_000).toISOString() },
  { label: 'This year',   key: 'year',    getIso: () => new Date(Date.now() - 365 * 86_400_000).toISOString() },
];

const DURATION_OPTIONS = [
  { label: 'Any duration', value: 'any' },
  { label: 'Short (< 4 min)', value: 'short' },
  { label: 'Medium (4–20 min)', value: 'medium' },
  { label: 'Long (> 20 min)', value: 'long' },
];

const ORDER_OPTIONS = [
  { label: 'Relevance', value: 'relevance' },
  { label: 'Date', value: 'date' },
  { label: 'View count', value: 'viewCount' },
  { label: 'Rating', value: 'rating' },
];

// ── Styles ────────────────────────────────────────────────────────────────────

const selectStyle = {
  padding: '0.4rem 0.6rem',
  borderRadius: '0.5rem',
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg)',
  color: 'var(--color-text)',
  fontSize: '0.8rem',
  fontFamily: 'inherit',
  outline: 'none',
  cursor: 'pointer',
};

const btnBase = {
  fontFamily: 'inherit',
  borderRadius: '0.5rem',
  border: 'none',
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: '0.875rem',
};

// ── Video Card ────────────────────────────────────────────────────────────────

function VideoCard({ video, isFav, onPlay, onToggleFav }) {
  const dur = parseDuration(video.duration);
  const views = fmtViews(video.viewCount);
  const ago = timeAgo(video.publishedAt);

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: '0.75rem',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        cursor: 'pointer',
        transition: 'transform 0.15s, box-shadow 0.15s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.12)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}
    >
      {/* Thumbnail */}
      <div
        style={{ position: 'relative', aspectRatio: '16/9', background: '#000', overflow: 'hidden' }}
        onClick={() => onPlay(video)}
      >
        {video.thumbnail && (
          <img
            src={video.thumbnail}
            alt={video.title}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        )}
        {/* Play overlay */}
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.2)',
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: '50%', background: 'rgba(255,255,255,0.9)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#ef4444"><polygon points="5,3 19,12 5,21"/></svg>
          </div>
        </div>
        {/* Duration badge */}
        {dur && (
          <span style={{
            position: 'absolute', bottom: 6, right: 6,
            background: 'rgba(0,0,0,0.8)', color: '#fff',
            fontSize: '0.7rem', fontWeight: 600, padding: '1px 5px', borderRadius: 4,
          }}>
            {dur}
          </span>
        )}
      </div>

      {/* Info */}
      <div style={{ padding: '0.6rem 0.75rem', flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <p
          style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text)', lineHeight: 1.3, margin: 0 }}
          onClick={() => onPlay(video)}
          title={video.title}
        >
          {video.title.length > 80 ? video.title.slice(0, 80) + '…' : video.title}
        </p>
        <p style={{ fontSize: '0.7rem', color: 'var(--color-muted)', margin: 0 }}>{video.channel}</p>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
          <span style={{ fontSize: '0.65rem', color: 'var(--color-muted)' }}>
            {[views, ago].filter(Boolean).join(' · ')}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onToggleFav(video); }}
            title={isFav ? 'Remove from favourites' : 'Save to favourites'}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 2,
              color: isFav ? '#ef4444' : 'var(--color-muted)',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill={isFav ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Favourites Card (simpler list row) ────────────────────────────────────────

function FavCard({ fav, onPlay, onRemove }) {
  const dur = parseDuration(fav.duration);
  const views = fmtViews(fav.view_count);

  return (
    <div style={{
      display: 'flex', gap: '0.75rem', padding: '0.6rem',
      borderRadius: '0.5rem', border: '1px solid var(--color-border)',
      background: 'var(--color-surface)', alignItems: 'center',
    }}>
      <div
        onClick={() => onPlay({ id: fav.video_id, title: fav.title, channel: fav.channel, thumbnail: fav.thumbnail, duration: fav.duration, viewCount: fav.view_count, publishedAt: fav.published_at })}
        style={{ position: 'relative', flexShrink: 0, width: 112, height: 63, borderRadius: 6, overflow: 'hidden', background: '#000', cursor: 'pointer' }}
      >
        {fav.thumbnail && <img src={fav.thumbnail} alt={fav.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
        {dur && (
          <span style={{ position: 'absolute', bottom: 3, right: 4, background: 'rgba(0,0,0,0.8)', color: '#fff', fontSize: '0.65rem', fontWeight: 600, padding: '1px 4px', borderRadius: 3 }}>
            {dur}
          </span>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          onClick={() => onPlay({ id: fav.video_id, title: fav.title, channel: fav.channel, thumbnail: fav.thumbnail, duration: fav.duration, viewCount: fav.view_count, publishedAt: fav.published_at })}
          style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text)', margin: 0, cursor: 'pointer' }}
        >
          {fav.title.length > 90 ? fav.title.slice(0, 90) + '…' : fav.title}
        </p>
        <p style={{ fontSize: '0.7rem', color: 'var(--color-muted)', margin: '2px 0 0' }}>{fav.channel}{views ? ` · ${views}` : ''}</p>
      </div>
      <button
        onClick={() => onRemove(fav.video_id)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', color: 'var(--color-muted)', flexShrink: 0 }}
        title="Remove"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  );
}

// ── Video Modal ───────────────────────────────────────────────────────────────

function VideoModal({ video, isFav, onClose, onToggleFav }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--color-surface)',
          borderRadius: '1rem',
          overflow: 'hidden',
          width: '100%',
          maxWidth: 900,
          boxShadow: '0 25px 60px rgba(0,0,0,0.5)',
        }}
      >
        {/* Embed */}
        <div style={{ position: 'relative', aspectRatio: '16/9', background: '#000' }}>
          <iframe
            src={`https://www.youtube.com/embed/${video.id}?rel=0`}
            title={video.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }}
          />
        </div>

        {/* Info bar */}
        <div style={{ padding: '0.75rem 1rem', display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-text)', margin: 0, lineHeight: 1.3 }}>{video.title}</p>
            <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', margin: '3px 0 0' }}>
              {video.channel}{video.viewCount ? ` · ${fmtViews(video.viewCount)}` : ''}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
            <button
              onClick={() => onToggleFav(video)}
              title={isFav ? 'Remove from favourites' : 'Save to favourites'}
              style={{
                ...btnBase,
                padding: '0.35rem 0.75rem', fontSize: '0.75rem',
                background: isFav ? '#fee2e2' : 'var(--color-bg)',
                border: `1px solid ${isFav ? '#fca5a5' : 'var(--color-border)'}`,
                color: isFav ? '#ef4444' : 'var(--color-muted)',
              }}
            >
              {isFav ? '♥ Saved' : '♡ Save'}
            </button>
            <a
              href={`https://www.youtube.com/watch?v=${video.id}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                ...btnBase,
                padding: '0.35rem 0.75rem', fontSize: '0.75rem',
                background: '#ef4444', color: '#fff', textDecoration: 'none',
                display: 'inline-flex', alignItems: 'center',
              }}
            >
              Open on YouTube
            </a>
            <button
              onClick={onClose}
              style={{
                ...btnBase,
                padding: '0.35rem 0.75rem', fontSize: '0.75rem',
                background: 'var(--color-bg)', border: '1px solid var(--color-border)',
                color: 'var(--color-muted)',
              }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function YouTubeSearchPage() {
  const [tab, setTab] = useState('search');

  // Search state
  const [query, setQuery] = useState('');
  const [order, setOrder] = useState('relevance');
  const [duration, setDuration] = useState('any');
  const [publishedKey, setPublishedKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [videos, setVideos] = useState([]);
  const [totalResults, setTotalResults] = useState(0);

  // Favourites
  const [favs, setFavs] = useState([]);
  const [favSet, setFavSet] = useState(new Set());

  // History
  const [history, setHistory] = useState([]);

  // Modal
  const [activeVideo, setActiveVideo] = useState(null);

  // Load favs + history on mount
  useEffect(() => {
    loadFavs();
    loadHistory();
  }, []);

  function loadFavs() {
    api.get('/youtube/favourites')
      .then((rows) => {
        setFavs(rows);
        setFavSet(new Set(rows.map((r) => r.video_id)));
      })
      .catch(() => {});
  }

  function loadHistory() {
    api.get('/youtube/history')
      .then(setHistory)
      .catch(() => {});
  }

  async function handleSearch(e) {
    e?.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    setVideos([]);

    try {
      const pub = PUBLISHED_AFTER_OPTIONS.find((o) => o.key === publishedKey);
      const publishedAfter = pub?.getIso ? pub.getIso() : '';

      const params = new URLSearchParams({ q: query.trim(), order, duration });
      if (publishedAfter) params.set('publishedAfter', publishedAfter);

      const data = await api.get(`/youtube/search?${params}`);
      setVideos(data.videos ?? []);
      setTotalResults(data.totalResults ?? 0);
      loadHistory();
      setTab('search');
    } catch (err) {
      setError(err.message || 'Search failed');
    } finally {
      setLoading(false);
    }
  }

  const toggleFav = useCallback(async (video) => {
    const isFav = favSet.has(video.id);
    try {
      if (isFav) {
        await api.delete(`/youtube/favourites/${video.id}`);
        setFavSet((s) => { const n = new Set(s); n.delete(video.id); return n; });
        setFavs((f) => f.filter((x) => x.video_id !== video.id));
      } else {
        await api.post('/youtube/favourites', {
          videoId:     video.id,
          title:       video.title,
          channel:     video.channel,
          thumbnail:   video.thumbnail,
          duration:    video.duration,
          viewCount:   video.viewCount,
          publishedAt: video.publishedAt,
        });
        setFavSet((s) => new Set([...s, video.id]));
        loadFavs();
      }
    } catch (err) {
      console.error('[youtube/fav]', err.message);
    }
  }, [favSet]);

  async function deleteHistory(id) {
    await api.delete(`/youtube/history/${id}`).catch(() => {});
    setHistory((h) => h.filter((r) => r.id !== id));
  }

  async function replaySearch(row) {
    const filters = row.filters || {};
    const q = row.query;
    const ord = filters.order || 'relevance';
    const dur = filters.duration || 'any';

    setQuery(q);
    setOrder(ord);
    setDuration(dur);
    setPublishedKey('');
    setTab('search');
    setLoading(true);
    setError('');
    setVideos([]);

    try {
      const params = new URLSearchParams({ q, order: ord, duration: dur });
      const data = await api.get(`/youtube/search?${params}`);
      setVideos(data.videos ?? []);
      setTotalResults(data.totalResults ?? 0);
      loadHistory();
    } catch (err) {
      setError(err.message || 'Search failed');
    } finally {
      setLoading(false);
    }
  }

  const tabBtn = (key, label, badge) => (
    <button
      key={key}
      onClick={() => setTab(key)}
      style={{
        padding: '0.35rem 0.85rem', fontSize: '0.8rem', fontWeight: 500,
        fontFamily: 'inherit', borderRadius: '0.5rem', cursor: 'pointer', border: 'none',
        background: tab === key ? 'var(--color-primary)' : 'transparent',
        color:      tab === key ? '#fff' : 'var(--color-muted)',
        position: 'relative',
      }}
    >
      {label}
      {badge > 0 && (
        <span style={{
          marginLeft: 5, fontSize: '0.65rem', fontWeight: 700,
          background: tab === key ? 'rgba(255,255,255,0.3)' : 'var(--color-border)',
          padding: '0px 5px', borderRadius: 10, color: tab === key ? '#fff' : 'var(--color-muted)',
        }}>
          {badge}
        </span>
      )}
    </button>
  );

  return (
    <div className="p-5 max-w-7xl mx-auto" style={{ fontFamily: 'inherit' }}>

      {/* Header */}
      <div className="mb-5">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: 4 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="#ef4444"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>YouTube Search</h1>
        </div>
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          Search YouTube videos, save favourites, and replay past searches.
        </p>
      </div>

      {/* Search form */}
      <form onSubmit={handleSearch} style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {/* Topic input */}
          <div style={{ flex: '1 1 240px', minWidth: 200 }}>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search topic…"
              style={{
                width: '100%', padding: '0.5rem 0.75rem',
                borderRadius: '0.5rem', border: '2px solid var(--color-border)',
                background: 'var(--color-bg)', color: 'var(--color-text)',
                fontSize: '0.875rem', fontFamily: 'inherit', outline: 'none',
                boxSizing: 'border-box',
              }}
              onFocus={(e) => (e.target.style.borderColor = 'var(--color-primary)')}
              onBlur={(e) => (e.target.style.borderColor = 'var(--color-border)')}
            />
          </div>

          {/* Filters */}
          <select value={order} onChange={(e) => setOrder(e.target.value)} style={selectStyle}>
            {ORDER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>

          <select value={duration} onChange={(e) => setDuration(e.target.value)} style={selectStyle}>
            {DURATION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>

          <select value={publishedKey} onChange={(e) => setPublishedKey(e.target.value)} style={selectStyle}>
            {PUBLISHED_AFTER_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>

          <button
            type="submit"
            disabled={loading || !query.trim()}
            style={{
              ...btnBase,
              padding: '0.5rem 1.25rem',
              background: loading || !query.trim() ? 'var(--color-border)' : '#ef4444',
              color: '#fff',
              cursor: loading || !query.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>
      </form>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1rem' }}>
        {tabBtn('search', 'Results', videos.length)}
        {tabBtn('favourites', 'Favourites', favs.length)}
        {tabBtn('history', 'History', history.length)}
      </div>

      {/* Error */}
      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '0.75rem', padding: '0.75rem 1rem', marginBottom: '1rem' }}>
          <p style={{ fontSize: '0.875rem', color: '#b91c1c', margin: 0 }}>{error}</p>
        </div>
      )}

      {/* ── Search Results ────────────────────────────────────────────────── */}
      {tab === 'search' && (
        <div>
          {videos.length === 0 && !loading && (
            <div style={{
              textAlign: 'center', padding: '4rem 2rem',
              background: 'var(--color-surface)', border: '1px solid var(--color-border)',
              borderRadius: '1rem',
            }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="#d1d5db" style={{ margin: '0 auto 1rem' }}>
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z"/>
              </svg>
              <p style={{ color: 'var(--color-muted)', fontSize: '0.9rem' }}>
                Enter a topic above to search YouTube videos.
              </p>
            </div>
          )}

          {videos.length > 0 && (
            <>
              <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', marginBottom: '0.75rem' }}>
                Showing {videos.length} of ~{totalResults.toLocaleString()} results
              </p>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                gap: '1rem',
              }}>
                {videos.map((v) => (
                  <VideoCard
                    key={v.id}
                    video={v}
                    isFav={favSet.has(v.id)}
                    onPlay={setActiveVideo}
                    onToggleFav={toggleFav}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Favourites ────────────────────────────────────────────────────── */}
      {tab === 'favourites' && (
        <div>
          {favs.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: '4rem 2rem',
              background: 'var(--color-surface)', border: '1px solid var(--color-border)',
              borderRadius: '1rem',
            }}>
              <p style={{ color: 'var(--color-muted)', fontSize: '0.9rem' }}>
                No saved videos yet. Click the heart icon on any video to save it.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {favs.map((fav) => (
                <FavCard
                  key={fav.video_id}
                  fav={fav}
                  onPlay={setActiveVideo}
                  onRemove={async (videoId) => {
                    await api.delete(`/youtube/favourites/${videoId}`).catch(() => {});
                    setFavSet((s) => { const n = new Set(s); n.delete(videoId); return n; });
                    setFavs((f) => f.filter((x) => x.video_id !== videoId));
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── History ───────────────────────────────────────────────────────── */}
      {tab === 'history' && (
        <div
          style={{
            background: 'var(--color-surface)', border: '1px solid var(--color-border)',
            borderRadius: '1rem', overflow: 'hidden',
          }}
        >
          {history.length === 0 ? (
            <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-muted)', fontSize: '0.875rem' }}>
              No search history yet.
            </p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ background: 'var(--color-bg)' }}>
                  {['Query', 'Filters', 'Results', 'When', ''].map((h) => (
                    <th key={h} style={{
                      padding: '0.6rem 0.9rem', textAlign: 'left',
                      fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase',
                      letterSpacing: '0.06em', color: 'var(--color-muted)',
                      borderBottom: '1px solid var(--color-border)',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((row) => {
                  const f = row.filters || {};
                  const filterParts = [
                    f.order && f.order !== 'relevance' ? f.order : null,
                    f.duration && f.duration !== 'any' ? f.duration : null,
                    f.publishedAfter ? 'date filtered' : null,
                  ].filter(Boolean);
                  return (
                    <tr key={row.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                      <td style={{ padding: '0.6rem 0.9rem', color: 'var(--color-text)', fontWeight: 600 }}>
                        {row.query}
                      </td>
                      <td style={{ padding: '0.6rem 0.9rem', color: 'var(--color-muted)' }}>
                        {filterParts.length ? filterParts.join(', ') : '—'}
                      </td>
                      <td style={{ padding: '0.6rem 0.9rem', color: 'var(--color-muted)' }}>
                        {row.result_count}
                      </td>
                      <td style={{ padding: '0.6rem 0.9rem', color: 'var(--color-muted)', whiteSpace: 'nowrap' }}>
                        {timeAgo(row.created_at)}
                      </td>
                      <td style={{ padding: '0.6rem 0.9rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button
                          onClick={() => replaySearch(row)}
                          style={{
                            fontSize: '0.7rem', fontWeight: 600, padding: '2px 8px',
                            borderRadius: 5, border: '1px solid var(--color-primary)',
                            background: 'none', color: 'var(--color-primary)', cursor: 'pointer',
                            marginRight: 6, fontFamily: 'inherit',
                          }}
                        >
                          Re-run
                        </button>
                        <button
                          onClick={() => deleteHistory(row.id)}
                          style={{
                            fontSize: '0.7rem', padding: '2px 6px',
                            borderRadius: 5, border: '1px solid var(--color-border)',
                            background: 'none', color: 'var(--color-muted)', cursor: 'pointer',
                            fontFamily: 'inherit',
                          }}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Video Modal */}
      {activeVideo && (
        <VideoModal
          video={activeVideo}
          isFav={favSet.has(activeVideo.id)}
          onClose={() => setActiveVideo(null)}
          onToggleFav={(v) => { toggleFav(v); }}
        />
      )}
    </div>
  );
}
