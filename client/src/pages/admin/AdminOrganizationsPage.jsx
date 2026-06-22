/**
 * AdminOrganizationsPage — list, create, edit, and delete organisations.
 *
 * Endpoints:
 *   GET    /api/admin/organizations      → [{ id, name, org_type, description, created_at, user_count }]
 *   POST   /api/admin/organizations    ← { name, orgType, description? }
 *   PUT    /api/admin/organizations/:id ← { name, orgType, description? }
 *   DELETE /api/admin/organizations/:id
 */
import { useState, useEffect } from 'react';
import api from '../../api/client';
import { fmtDate } from '../../utils/date';
import { useIcon } from '../../providers/IconProvider';
import { useToast } from '../../components/ui/Toast';

// ── Helpers ──────────────────────────────────────────────────────────────────

const ORG_TYPE_OPTIONS = [
  { value: 'internal', label: 'Internal (Diamond Plate)' },
  { value: 'demo', label: 'Engineering client' },
];

function orgTypeLabel(type) {
  return ORG_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;
}

function OrgTypeBadge({ type }) {
  const isDemo = type === 'demo';
  return (
    <span
      className="px-2 py-0.5 rounded-full text-xs font-medium"
      style={
        isDemo
          ? { background: 'rgba(245,158,11,0.12)', color: '#d97706' }
          : { background: 'var(--color-surface)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }
      }
    >
      {orgTypeLabel(type)}
    </span>
  );
}

const inputStyle = {
  width: '100%', padding: '0.625rem 0.75rem', borderRadius: '0.75rem',
  border: '1px solid var(--color-border)', background: 'var(--color-bg)',
  color: 'var(--color-text)', fontSize: '0.875rem', outline: 'none', boxSizing: 'border-box',
};

const textareaStyle = {
  ...inputStyle,
  minHeight: '4.5rem',
  resize: 'vertical',
  fontFamily: 'inherit',
};

function ModalShell({ onClose, title, subtitle, children, maxWidth = 'max-w-md' }) {
  const getIcon = useIcon();
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className={`w-full ${maxWidth} rounded-2xl border p-6 space-y-4 max-h-[90vh] overflow-y-auto`}
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{title}</h2>
            {subtitle && <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="opacity-50 hover:opacity-100 transition-opacity flex-shrink-0 ml-3"
            style={{ color: 'var(--color-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            {getIcon('x', { size: 16 })}
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── OrgFormModal (create + edit) ─────────────────────────────────────────────

function OrgFormModal({ org, onClose, onSaved }) {
  const isEdit = Boolean(org);
  const [name, setName] = useState(org?.name ?? '');
  const [orgType, setOrgType] = useState(org?.org_type ?? 'internal');
  const [description, setDescription] = useState(org?.description ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { showToast } = useToast();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const payload = { name, orgType, description };
    try {
      if (isEdit) {
        await api.put(`/admin/organizations/${org.id}`, payload);
        showToast(`Organisation "${name}" updated`, 'success');
      } else {
        await api.post('/admin/organizations', payload);
        showToast(`Organisation "${name}" created`, 'success');
      }
      onSaved();
    } catch (err) {
      setError(err.message || `Failed to ${isEdit ? 'update' : 'create'} organisation`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalShell
      onClose={onClose}
      title={isEdit ? 'Edit Organisation' : 'New Organisation'}
      subtitle={isEdit ? `ID ${org.id}` : 'Type controls which app shell users see after login.'}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            placeholder="Curam Engineering"
            style={inputStyle}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>
            App shell
          </label>
          <select value={orgType} onChange={(e) => setOrgType(e.target.value)} style={inputStyle}>
            {ORG_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <p className="text-xs mt-1.5" style={{ color: 'var(--color-muted)' }}>
            Internal → Diamond Plate tools. Engineering client → demo dashboard and assigned agents.
          </p>
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>
            Purpose / notes
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Sales demo for AEC prospects — tender + spec agents only"
            style={textareaStyle}
          />
        </div>
        {error && <p className="text-xs" style={{ color: '#ef4444' }}>{error}</p>}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm border transition-opacity hover:opacity-70"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'transparent', cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-80 disabled:opacity-50"
            style={{ background: 'var(--color-primary)', border: 'none', cursor: 'pointer' }}
          >
            {loading ? (isEdit ? 'Saving…' : 'Creating…') : (isEdit ? 'Save Changes' : 'Create Organisation')}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ── Delete confirm ───────────────────────────────────────────────────────────

function DeleteOrgModal({ org, onClose, onDeleted }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { showToast } = useToast();
  const userCount = org.user_count ?? 0;

  const handleDelete = async () => {
    setError('');
    setLoading(true);
    try {
      await api.delete(`/admin/organizations/${org.id}`);
      showToast(`Organisation "${org.name}" deleted`, 'success');
      onDeleted();
    } catch (err) {
      setError(err.message || 'Failed to delete organisation');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalShell onClose={onClose} title="Delete organisation?" maxWidth="max-w-lg">
      <p className="text-sm" style={{ color: 'var(--color-text)' }}>
        Permanently delete <strong>{org.name}</strong>? This removes all users, agent runs, and settings for this org.
      </p>
      {userCount > 0 && (
        <p className="text-xs rounded-lg px-3 py-2" style={{ background: 'rgba(239,68,68,0.08)', color: '#b91c1c' }}>
          {userCount} user{userCount === 1 ? '' : 's'} will lose access. This cannot be undone.
        </p>
      )}
      {error && <p className="text-xs" style={{ color: '#ef4444' }}>{error}</p>}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 py-2.5 rounded-xl text-sm border transition-opacity hover:opacity-70"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'transparent', cursor: 'pointer' }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={loading}
          className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-80 disabled:opacity-50"
          style={{ background: '#dc2626', border: 'none', cursor: 'pointer' }}
        >
          {loading ? 'Deleting…' : 'Delete permanently'}
        </button>
      </div>
    </ModalShell>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminOrganizationsPage() {
  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // null | 'create' | { mode: 'edit'|'delete', org }
  const getIcon = useIcon();
  const { showToast } = useToast();

  const fetchOrgs = () => {
    setLoading(true);
    api.get('/admin/organizations')
      .then((data) => setOrgs(Array.isArray(data) ? data : []))
      .catch(() => showToast('Failed to load organisations', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchOrgs(); }, []);

  const closeModal = () => setModal(null);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Organisations</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
            Manage orgs, app shell type, and operator notes. Type controls UI routing; use purpose for why each org exists.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchOrgs}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:opacity-60 transition-opacity"
            style={{ color: 'var(--color-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
            title="Refresh"
          >
            {getIcon('refresh-cw', { size: 15 })}
          </button>
          <button
            onClick={() => setModal('create')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-80"
            style={{ background: 'var(--color-primary)', border: 'none', cursor: 'pointer' }}
          >
            {getIcon('plus', { size: 14 })}
            New Organisation
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="flex gap-1.5">
            {[0, 150, 300].map((delay) => (
              <span key={delay} className="w-2 h-2 rounded-full animate-bounce"
                style={{ background: 'var(--color-primary)', animationDelay: `${delay}ms` }} />
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
          {orgs.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No organisations found.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
                  {['Name', 'App shell', 'Purpose', 'Users', 'Created', ''].map((col) => (
                    <th key={col || 'actions'}
                      className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider"
                      style={{ color: 'var(--color-muted)' }}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orgs.map((org, i) => (
                  <tr
                    key={org.id}
                    style={{
                      borderBottom: i < orgs.length - 1 ? '1px solid var(--color-border)' : 'none',
                      background: 'var(--color-bg)',
                    }}
                  >
                    <td className="px-4 py-3 font-medium" style={{ color: 'var(--color-text)' }}>
                      {org.name}
                    </td>
                    <td className="px-4 py-3">
                      <OrgTypeBadge type={org.org_type} />
                    </td>
                    <td className="px-4 py-3 text-xs max-w-xs truncate" style={{ color: 'var(--color-muted)' }}
                      title={org.description || undefined}>
                      {org.description || '—'}
                    </td>
                    <td className="px-4 py-3 text-xs tabular-nums" style={{ color: 'var(--color-muted)' }}>
                      {org.user_count ?? 0}
                    </td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: 'var(--color-muted)' }}>
                      {fmtDate(org.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setModal({ mode: 'edit', org })}
                          className="p-1.5 rounded-lg hover:opacity-70 transition-opacity"
                          style={{ color: 'var(--color-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
                          title="Edit"
                        >
                          {getIcon('edit', { size: 15 })}
                        </button>
                        <button
                          type="button"
                          onClick={() => setModal({ mode: 'delete', org })}
                          className="p-1.5 rounded-lg hover:opacity-70 transition-opacity"
                          style={{ color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer' }}
                          title="Delete"
                        >
                          {getIcon('trash', { size: 15 })}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {modal === 'create' && (
        <OrgFormModal onClose={closeModal} onSaved={() => { fetchOrgs(); closeModal(); }} />
      )}
      {modal?.mode === 'edit' && (
        <OrgFormModal org={modal.org} onClose={closeModal} onSaved={() => { fetchOrgs(); closeModal(); }} />
      )}
      {modal?.mode === 'delete' && (
        <DeleteOrgModal org={modal.org} onClose={closeModal} onDeleted={() => { fetchOrgs(); closeModal(); }} />
      )}
    </div>
  );
}
