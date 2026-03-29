/**
 * AdminDepartmentsPage — create and manage organisation departments.
 * Departments group users for display and reporting. Membership is assigned
 * per-user via the Manage modal on the Users page.
 */
import { useState, useEffect } from 'react';
import api from '../../api/client';
import Button from '../../components/ui/Button';
import InlineBanner from '../../components/ui/InlineBanner';

const COLORS = [
  '#6366f1', '#0ea5e9', '#10b981', '#f59e0b',
  '#ef4444', '#8b5cf6', '#ec4899', '#64748b',
];

const EMPTY = { name: '', description: '', color: '#6366f1' };

function ColorPicker({ value, onChange }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className="w-6 h-6 rounded-full transition-all"
          style={{
            background: c,
            border: value === c ? '3px solid var(--color-text)' : '2px solid transparent',
            outline: value === c ? '2px solid var(--color-bg)' : 'none',
            outlineOffset: '-1px',
            cursor: 'pointer',
          }}
        />
      ))}
    </div>
  );
}

const fi = {
  width: '100%', padding: '0.5rem 0.75rem', borderRadius: '0.75rem',
  border: '1px solid var(--color-border)', background: 'var(--color-bg)',
  color: 'var(--color-text)', fontSize: '0.875rem', outline: 'none', boxSizing: 'border-box',
};

export default function AdminDepartmentsPage() {
  const [departments, setDepartments] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [success,     setSuccess]     = useState('');
  const [editingId,   setEditingId]   = useState(null); // 'new' | id | null
  const [form,        setForm]        = useState(EMPTY);
  const [saving,      setSaving]      = useState(false);

  const load = async () => {
    try {
      setDepartments(await api.get('/admin/departments'));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  function openAdd() { setForm({ ...EMPTY }); setEditingId('new'); }
  function openEdit(d) { setForm({ name: d.name, description: d.description || '', color: d.color }); setEditingId(d.id); }
  function cancelEdit() { setEditingId(null); setForm(EMPTY); }

  async function handleSave() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editingId === 'new') {
        await api.post('/admin/departments', form);
        setSuccess('Department created.');
      } else {
        await api.put(`/admin/departments/${editingId}`, form);
        setSuccess('Department updated.');
      }
      cancelEdit();
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this department? Members will be unassigned.')) return;
    try {
      await api.delete(`/admin/departments/${id}`);
      setSuccess('Department deleted.');
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Departments</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
            Group users into teams or divisions. Assign members via the Users page.
          </p>
        </div>
        <Button variant="primary" onClick={openAdd} disabled={saving}>+ Add department</Button>
      </div>

      {error   && <InlineBanner type="error"   message={error}   onDismiss={() => setError('')}   className="mb-4" />}
      {success && <InlineBanner type="neutral" message={success} onDismiss={() => setSuccess('')} className="mb-4" />}

      {/* Add / Edit form */}
      {editingId && (
        <div
          className="rounded-2xl border p-5 mb-5 space-y-4"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-primary)' }}
        >
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-primary)' }}>
            {editingId === 'new' ? 'New department' : 'Edit department'}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Name *</label>
              <input style={fi} placeholder="e.g. Marketing"
                value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Description</label>
              <input style={fi} placeholder="Optional — what this department does"
                value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium mb-2" style={{ color: 'var(--color-muted)' }}>Colour</label>
              <ColorPicker value={form.color} onChange={(c) => setForm((f) => ({ ...f, color: c }))} />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button variant="primary" onClick={handleSave} disabled={saving || !form.name.trim()}>
              {saving ? 'Saving…' : editingId === 'new' ? 'Create' : 'Save changes'}
            </Button>
            <Button variant="secondary" onClick={cancelEdit}>Cancel</Button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="p-8 text-center text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</div>
      ) : departments.length === 0 ? (
        <div className="rounded-2xl border p-10 text-center text-sm"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
          No departments yet. Add one to start grouping users.
        </div>
      ) : (
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
          {departments.map((d, i) => (
            <div
              key={d.id}
              className="flex items-center gap-3 px-4 py-3"
              style={{
                background:   'var(--color-surface)',
                borderBottom: i < departments.length - 1 ? '1px solid var(--color-border)' : 'none',
              }}
            >
              {/* Color dot */}
              <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: d.color }} />

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{d.name}</p>
                {d.description && (
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{d.description}</p>
                )}
              </div>

              <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-muted)' }}>
                {d.member_count} {d.member_count === 1 ? 'member' : 'members'}
              </span>

              <div className="flex gap-1.5 flex-shrink-0">
                <button onClick={() => openEdit(d)}
                  className="text-xs px-2.5 py-1 rounded-lg border transition-opacity hover:opacity-70"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'transparent', cursor: 'pointer' }}>
                  Edit
                </button>
                <button onClick={() => handleDelete(d.id)}
                  className="text-xs px-2.5 py-1 rounded-lg border transition-opacity hover:opacity-70"
                  style={{ borderColor: '#fca5a5', color: '#991b1b', background: 'transparent', cursor: 'pointer' }}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
