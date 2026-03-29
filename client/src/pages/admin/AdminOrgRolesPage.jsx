/**
 * AdminOrgRolesPage — create and manage custom organisation roles.
 *
 * Org roles are free-form role names stored in the org_roles table.
 * When assigned to a user they create a row in user_roles (scope_type='global'),
 * making them compatible with requireRole() checks and resource_permissions.
 *
 * Role name (slug) is auto-derived from the label on creation and is immutable
 * thereafter — it is used as the role_name key in user_roles and resource_permissions.
 */
import { useState, useEffect } from 'react';
import api from '../../api/client';
import Button from '../../components/ui/Button';
import InlineBanner from '../../components/ui/InlineBanner';

const COLORS = [
  '#6366f1', '#0ea5e9', '#10b981', '#f59e0b',
  '#ef4444', '#8b5cf6', '#ec4899', '#64748b',
];

const EMPTY = { name: '', label: '', description: '', color: '#6366f1' };

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

function toSlug(label) {
  return label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export default function AdminOrgRolesPage() {
  const [roles,     setRoles]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [success,   setSuccess]   = useState('');
  const [editingId, setEditingId] = useState(null); // 'new' | id | null
  const [form,      setForm]      = useState(EMPTY);
  const [saving,    setSaving]    = useState(false);

  const load = async () => {
    try {
      setRoles(await api.get('/admin/org-roles'));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  function openAdd() { setForm({ ...EMPTY }); setEditingId('new'); }
  function openEdit(r) {
    setForm({ name: r.name, label: r.label, description: r.description || '', color: r.color });
    setEditingId(r.id);
  }
  function cancelEdit() { setEditingId(null); setForm(EMPTY); }

  async function handleSave() {
    if (!form.label.trim()) return;
    setSaving(true);
    try {
      if (editingId === 'new') {
        await api.post('/admin/org-roles', { ...form, name: toSlug(form.label) });
        setSuccess('Role created.');
      } else {
        await api.put(`/admin/org-roles/${editingId}`, form);
        setSuccess('Role updated.');
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
    if (!window.confirm('Delete this role? All user assignments will be removed.')) return;
    try {
      await api.delete(`/admin/org-roles/${id}`);
      setSuccess('Role deleted.');
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Organisation Roles</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
            Define custom roles beyond Admin / Member. Assign them to users via the Users page.
            Role names are used in access control and can be referenced in MCP resource permissions.
          </p>
        </div>
        <Button variant="primary" onClick={openAdd} disabled={saving}>+ Add role</Button>
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
            {editingId === 'new' ? 'New role' : 'Edit role'}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>
                Display label *
              </label>
              <input style={fi} placeholder="e.g. Campaign Manager"
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />
              {editingId === 'new' && form.label && (
                <p className="text-xs mt-1 font-mono" style={{ color: 'var(--color-muted)' }}>
                  Role ID: <strong>{toSlug(form.label)}</strong> (auto-generated, immutable after creation)
                </p>
              )}
              {editingId !== 'new' && (
                <p className="text-xs mt-1 font-mono" style={{ color: 'var(--color-muted)' }}>
                  Role ID: <strong>{form.name}</strong> (immutable)
                </p>
              )}
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Description</label>
              <input style={fi} placeholder="What this role allows or represents"
                value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium mb-2" style={{ color: 'var(--color-muted)' }}>Colour</label>
              <ColorPicker value={form.color} onChange={(c) => setForm((f) => ({ ...f, color: c }))} />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button variant="primary" onClick={handleSave} disabled={saving || !form.label.trim()}>
              {saving ? 'Saving…' : editingId === 'new' ? 'Create role' : 'Save changes'}
            </Button>
            <Button variant="secondary" onClick={cancelEdit}>Cancel</Button>
          </div>
        </div>
      )}

      {/* System roles info */}
      <div className="rounded-xl border px-4 py-3 mb-4 flex gap-3"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        <div className="flex-1">
          <p className="text-xs font-semibold mb-1" style={{ color: 'var(--color-text)' }}>System roles (built-in)</p>
          <div className="flex gap-2">
            {['org_admin', 'org_member'].map((r) => (
              <span key={r} className="text-xs font-mono px-2 py-0.5 rounded-md"
                style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
                {r}
              </span>
            ))}
          </div>
        </div>
        <p className="text-xs self-center" style={{ color: 'var(--color-muted)' }}>
          Built-in — cannot be edited here
        </p>
      </div>

      {/* List */}
      {loading ? (
        <div className="p-8 text-center text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</div>
      ) : roles.length === 0 ? (
        <div className="rounded-2xl border p-10 text-center text-sm"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
          No custom roles yet. Create one to extend the default Admin / Member access model.
        </div>
      ) : (
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
          {roles.map((r, i) => (
            <div
              key={r.id}
              className="flex items-center gap-3 px-4 py-3"
              style={{
                background:   'var(--color-surface)',
                borderBottom: i < roles.length - 1 ? '1px solid var(--color-border)' : 'none',
              }}
            >
              <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: r.color }} />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{r.label}</p>
                  <span className="text-xs font-mono px-1.5 py-0.5 rounded"
                    style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
                    {r.name}
                  </span>
                </div>
                {r.description && (
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{r.description}</p>
                )}
              </div>

              <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-muted)' }}>
                {r.member_count} {r.member_count === 1 ? 'user' : 'users'}
              </span>

              <div className="flex gap-1.5 flex-shrink-0">
                <button onClick={() => openEdit(r)}
                  className="text-xs px-2.5 py-1 rounded-lg border transition-opacity hover:opacity-70"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'transparent', cursor: 'pointer' }}>
                  Edit
                </button>
                <button onClick={() => handleDelete(r.id)}
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
