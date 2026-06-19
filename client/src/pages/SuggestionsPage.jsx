import { useCallback, useEffect, useMemo, useState } from 'react';
import { useIcon } from '../providers/IconProvider';
import api from '../api/client';
import { useToast } from '../components/ui/Toast';

const CATEGORIES = ['rule', 'skill', 'automation', 'source', 'alert', 'other'];
const STATUSES = ['new', 'opened', 'ignore', 'apply', 'learn'];

const FIELD = 'w-full px-3 py-2.5 rounded-xl border text-sm outline-none';
const FIELD_STYLE = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };

const STATUS_STYLE = {
  new: { bg: 'var(--color-primary)', color: '#fff' },
  opened: { bg: 'var(--color-surface)', color: 'var(--color-text)', border: 'var(--color-border)' },
  ignore: { bg: 'var(--color-bg)', color: 'var(--color-muted)', border: 'var(--color-border)' },
  apply: { bg: '#dcfce7', color: '#166534', border: '#86efac' },
  learn: { bg: '#fef3c7', color: '#b45309', border: '#fde68a' },
};

function formatWhen(iso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function labelize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function FilterChip({ active, onClick, children, count }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-2.5 py-1 rounded-lg text-xs font-medium border transition-opacity hover:opacity-70"
      style={{
        background: active ? 'var(--color-primary)' : 'var(--color-surface)',
        color: active ? '#fff' : 'var(--color-muted)',
        borderColor: active ? 'var(--color-primary)' : 'var(--color-border)',
      }}
    >
      {children}
      {count != null && count > 0 ? ` (${count})` : ''}
    </button>
  );
}

function SuggestionCard({ item, onStatusChange, onDelete, updating }) {
  const [expanded, setExpanded] = useState(false);
  const statusStyle = STATUS_STYLE[item.status] || STATUS_STYLE.opened;

  return (
    <div
      className="rounded-xl border p-4 space-y-3"
      style={{
        borderColor: 'var(--color-border)',
        background: item.status === 'ignore' ? 'var(--color-bg)' : 'var(--color-surface)',
        opacity: item.status === 'ignore' ? 0.75 : 1,
      }}
    >
      <div className="flex flex-wrap items-start gap-2 justify-between">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
              {labelize(item.category)}
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border" style={{ background: statusStyle.bg, color: statusStyle.color, borderColor: statusStyle.border || statusStyle.bg }}>
              {labelize(item.status)}
            </span>
          </div>
          <h3 className="text-sm font-semibold leading-snug" style={{ color: 'var(--color-text)', textDecoration: item.status === 'ignore' ? 'line-through' : 'none' }}>
            {item.title}
          </h3>
        </div>
        <button type="button" onClick={() => onDelete(item.id)} disabled={updating} className="p-1.5 rounded-lg hover:opacity-60" style={{ color: 'var(--color-muted)' }} title="Delete">×</button>
      </div>
      <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--color-muted)' }}>
        {expanded || item.body.length <= 280 ? item.body : `${item.body.slice(0, 280)}…`}
      </p>
      {item.body.length > 280 && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="text-xs hover:opacity-70" style={{ color: 'var(--color-primary)' }}>
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
      {item.context && <p className="text-xs font-mono break-all" style={{ color: 'var(--color-muted)' }}>{item.context}</p>}
      {item.source && <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>via {item.source}</p>}
      <div className="flex flex-wrap items-center gap-2 justify-between pt-1">
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{formatWhen(item.created_at)}</p>
        <div className="flex flex-wrap gap-1.5">
          {STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              disabled={updating || item.status === status}
              onClick={() => onStatusChange(item.id, status)}
              className="px-2 py-1 rounded-md text-[11px] border transition-opacity hover:opacity-70 disabled:opacity-40"
              style={{
                background: item.status === status ? (STATUS_STYLE[status]?.bg || 'var(--color-primary)') : 'transparent',
                color: item.status === status ? (STATUS_STYLE[status]?.color || '#fff') : 'var(--color-muted)',
                borderColor: 'var(--color-border)',
              }}
            >
              {labelize(status)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function SuggestionsPage() {
  const getIcon = useIcon();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [updatingId, setUpdatingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ category: 'other', title: '', body: '', context: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (categoryFilter !== 'all') params.set('category', categoryFilter);
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (search.trim()) params.set('q', search.trim());
    const qs = params.toString();

    const [listData, metaData] = await Promise.all([
      api.get(`/suggestions${qs ? `?${qs}` : ''}`),
      api.get('/suggestions/meta'),
    ]);
    setItems(listData.suggestions ?? []);
    setMeta(metaData);
    window.dispatchEvent(new CustomEvent('mcptools:suggestions-changed'));
  }, [categoryFilter, statusFilter, search]);

  useEffect(() => {
    setLoading(true);
    load().catch((err) => showToast(err.message || 'Failed to load suggestions', 'error')).finally(() => setLoading(false));
  }, [load, showToast]);

  const statusCounts = meta?.statusCounts ?? {};
  const categoryCounts = meta?.categoryCounts ?? {};
  const emptyMessage = useMemo(() => {
    if (categoryFilter !== 'all' || statusFilter !== 'all' || search.trim()) return 'No suggestions match your filters.';
    return 'Nothing here yet. Agents and services will add suggestions when they find anomalies or improvements.';
  }, [categoryFilter, statusFilter, search]);

  const handleStatusChange = async (id, status) => {
    setUpdatingId(id);
    try {
      await api.patch(`/suggestions/${id}`, { status });
      await load();
      showToast(`Marked as ${labelize(status)}`, 'success');
    } catch (err) {
      showToast(err.message || 'Update failed', 'error');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this suggestion?')) return;
    setUpdatingId(id);
    try {
      await api.delete(`/suggestions/${id}`);
      await load();
      showToast('Suggestion deleted', 'success');
    } catch (err) {
      showToast(err.message || 'Delete failed', 'error');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) {
      showToast('Title is required', 'error');
      return;
    }
    setSaving(true);
    try {
      await api.post('/suggestions', {
        category: form.category,
        title: form.title.trim(),
        body: form.body.trim(),
        context: form.context.trim() || null,
      });
      setForm({ category: 'other', title: '', body: '', context: '' });
      setShowForm(false);
      await load();
      showToast('Suggestion added', 'success');
    } catch (err) {
      showToast(err.message || 'Create failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--color-surface)', color: 'var(--color-primary)' }}>
            {getIcon('inbox', { size: 18 })}
          </div>
          <div>
            <h1 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Suggestions</h1>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Agent and service findings — triage rules, skills, automations, alerts</p>
          </div>
        </div>
        <button type="button" onClick={() => setShowForm((v) => !v)} className="px-3.5 py-1.5 rounded-lg text-sm font-medium hover:opacity-70" style={{ background: 'var(--color-primary)', color: '#fff' }}>
          {showForm ? 'Cancel' : 'Add manually'}
        </button>
      </div>

      <div className="rounded-2xl border p-4 space-y-2" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--color-muted)' }}>
          Findings from startup checks, personal memory, scheduled agents, and coding sessions land here. Use status to triage: Apply, Learn, or Ignore.
        </p>
        {meta && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{meta.total} total · {statusCounts.new ?? 0} new</p>}
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="rounded-2xl border p-6 space-y-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>New suggestion</h2>
          <label className="block space-y-1">
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Category</span>
            <select className={FIELD} style={FIELD_STYLE} value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{labelize(c)}</option>)}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Title</span>
            <input className={FIELD} style={FIELD_STYLE} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Details</span>
            <textarea className={`${FIELD} min-h-[100px]`} style={FIELD_STYLE} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Context (optional)</span>
            <input className={FIELD} style={FIELD_STYLE} value={form.context} onChange={(e) => setForm((f) => ({ ...f, context: e.target.value }))} />
          </label>
          <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50" style={{ background: 'var(--color-primary)', color: '#fff' }}>
            {saving ? 'Saving…' : 'Save suggestion'}
          </button>
        </form>
      )}

      <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className={FIELD} style={FIELD_STYLE} />

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Category</p>
        <div className="flex flex-wrap gap-2">
          <FilterChip active={categoryFilter === 'all'} onClick={() => setCategoryFilter('all')} count={meta?.total}>All</FilterChip>
          {CATEGORIES.map((c) => (
            <FilterChip key={c} active={categoryFilter === c} onClick={() => setCategoryFilter(c)} count={categoryCounts[c]}>{labelize(c)}</FilterChip>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Status</p>
        <div className="flex flex-wrap gap-2">
          <FilterChip active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} count={meta?.total}>All</FilterChip>
          {STATUSES.map((s) => (
            <FilterChip key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)} count={statusCounts[s]}>{labelize(s)}</FilterChip>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{emptyMessage}</p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <SuggestionCard key={item.id} item={item} onStatusChange={handleStatusChange} onDelete={handleDelete} updating={updatingId === item.id} />
          ))}
        </div>
      )}
    </div>
  );
}
