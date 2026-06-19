/**
 * PersonalMemoryTab — browse, capture, search, and delete per-user memories.
 * Available to any authenticated org member (Settings > Memory).
 */
import { useState, useEffect, useCallback } from 'react';
import api from '../../api/client';
import Button from '../ui/Button';
import InlineBanner from '../ui/InlineBanner';
import EmptyState from '../ui/EmptyState';

const FIELD = 'w-full px-3 py-2.5 rounded-xl border text-sm outline-none';
const FIELD_STYLE = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const LABEL = 'block text-xs font-semibold uppercase tracking-wider mb-1.5';
const LABEL_STYLE = { color: 'var(--color-muted)' };

function Section({ title, children }) {
  return (
    <div className="rounded-2xl border p-6 space-y-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{title}</h2>
      {children}
    </div>
  );
}

function formatWhen(iso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function ThoughtRow({ thought, onDelete, deleting }) {
  const [expanded, setExpanded] = useState(false);
  const content = thought.content ?? '';
  const long = content.length > 220;
  const shown = expanded || !long ? content : `${content.slice(0, 220)}…`;

  return (
    <div
      className="rounded-xl border p-4 space-y-2"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm whitespace-pre-wrap flex-1" style={{ color: 'var(--color-text)' }}>
          {shown}
        </p>
        <button
          type="button"
          onClick={() => onDelete(thought.id)}
          disabled={deleting}
          className="text-xs px-2.5 py-1 rounded-lg border shrink-0 transition-opacity hover:opacity-70 disabled:opacity-40"
          style={{ borderColor: '#fca5a5', color: '#991b1b', background: 'transparent', cursor: 'pointer' }}
        >
          Delete
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: 'var(--color-muted)' }}>
        <span>{formatWhen(thought.created_at)}</span>
        {thought.similarity != null && (
          <span>match {thought.similarity}</span>
        )}
        {long && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="underline hover:opacity-70"
            style={{ color: 'var(--color-primary)' }}
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    </div>
  );
}

export default function PersonalMemoryTab() {
  const [thoughts, setThoughts] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [captureText, setCaptureText] = useState('');
  const [capturing, setCapturing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [banner, setBanner] = useState(null);

  const loadData = useCallback(async () => {
    const [listData, statsData] = await Promise.all([
      api.get('/personal-memory'),
      api.get('/personal-memory/stats'),
    ]);
    setThoughts(listData.thoughts ?? []);
    setStats(statsData);
  }, []);

  useEffect(() => {
    loadData()
      .catch((err) => setBanner({ type: 'error', text: err.message }))
      .finally(() => setLoading(false));
  }, [loadData]);

  async function handleCapture(e) {
    e.preventDefault();
    const content = captureText.trim();
    if (!content) return;

    setCapturing(true);
    setBanner(null);
    try {
      await api.post('/personal-memory', { content });
      setCaptureText('');
      setSearchResults(null);
      setSearchQuery('');
      await loadData();
      setBanner({ type: 'success', text: 'Memory saved.' });
    } catch (err) {
      setBanner({ type: 'error', text: err.message });
    } finally {
      setCapturing(false);
    }
  }

  async function handleSearch(e) {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }

    setSearching(true);
    setBanner(null);
    try {
      const data = await api.get(`/personal-memory/search?q=${encodeURIComponent(q)}`);
      setSearchResults(data.results ?? []);
    } catch (err) {
      setBanner({ type: 'error', text: err.message });
    } finally {
      setSearching(false);
    }
  }

  function clearSearch() {
    setSearchQuery('');
    setSearchResults(null);
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this memory? This cannot be undone.')) return;

    setDeletingId(id);
    setBanner(null);
    try {
      await api.delete(`/personal-memory/${id}`);
      setThoughts((prev) => prev.filter((t) => t.id !== id));
      setSearchResults((prev) => (prev ? prev.filter((t) => t.id !== id) : null));
      const statsData = await api.get('/personal-memory/stats');
      setStats(statsData);
      setBanner({ type: 'success', text: 'Memory deleted.' });
    } catch (err) {
      setBanner({ type: 'error', text: err.message });
    } finally {
      setDeletingId(null);
    }
  }

  const displayed = searchResults ?? thoughts;
  const inSearchMode = searchResults !== null;

  if (loading) {
    return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>;
  }

  return (
    <div className="space-y-6">
      {banner && (
        <InlineBanner
          type={banner.type === 'success' ? 'neutral' : 'error'}
          message={banner.text}
          onDismiss={() => setBanner(null)}
        />
      )}

      <Section title="About personal memory">
        <p className="text-sm leading-relaxed" style={{ color: 'var(--color-muted)' }}>
          Notes saved here are private to you within this organisation. The conversation agent can capture and recall them across sessions — other team members cannot see your memories.
        </p>
        {stats && (
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            {stats.total === 0
              ? 'No memories stored yet.'
              : `${stats.total} memor${stats.total === 1 ? 'y' : 'ies'} stored`}
            {stats.newest ? ` · latest ${formatWhen(stats.newest)}` : ''}
          </p>
        )}
      </Section>

      <Section title="Add a memory">
        <form onSubmit={handleCapture} className="space-y-3">
          <div>
            <label className={LABEL} style={LABEL_STYLE}>What should we remember?</label>
            <textarea
              value={captureText}
              onChange={(e) => setCaptureText(e.target.value)}
              rows={4}
              placeholder="e.g. I prefer weekly CPA reports, not daily."
              className={`${FIELD} resize-y min-h-[6rem]`}
              style={FIELD_STYLE}
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={capturing || !captureText.trim()}>
              {capturing ? 'Saving…' : 'Save memory'}
            </Button>
          </div>
        </form>
      </Section>

      <Section title="Search memories">
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by meaning, not just keywords…"
            className={`${FIELD} flex-1`}
            style={FIELD_STYLE}
          />
          <div className="flex gap-2 shrink-0">
            {inSearchMode && (
              <Button type="button" variant="secondary" onClick={clearSearch}>
                Clear
              </Button>
            )}
            <Button type="submit" variant="secondary" disabled={searching || !searchQuery.trim()}>
              {searching ? 'Searching…' : 'Search'}
            </Button>
          </div>
        </form>
      </Section>

      <Section title={inSearchMode ? 'Search results' : 'Recent memories'}>
        {displayed.length === 0 ? (
          <EmptyState
            icon="bookmark"
            message={inSearchMode ? 'No matching memories.' : 'No memories yet.'}
            hint={inSearchMode ? 'Try different wording — search is semantic.' : 'Add one above or ask the conversation agent to remember something.'}
          />
        ) : (
          <div className="space-y-3">
            {displayed.map((thought) => (
              <ThoughtRow
                key={thought.id}
                thought={thought}
                onDelete={handleDelete}
                deleting={deletingId === thought.id}
              />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
