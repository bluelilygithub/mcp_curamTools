import { useState, useEffect } from 'react';
import api from '../../api/client';
import { useIcon } from '../../providers/IconProvider';
import { useToast } from '../../components/ui/Toast';

function AdminUsersPage() {
  const [users, setUsers]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [resendUser, setResendUser] = useState(null);
  const [deleteUser, setDeleteUser] = useState(null);
  const getIcon = useIcon();
  const { showToast } = useToast();

  const fetchUsers = () => {
    setLoading(true);
    api.get('/admin/users')
      .then(data => setUsers(Array.isArray(data) ? data : []))
      .catch(() => showToast('Failed to load users', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchUsers(); }, []);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Users</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
            Manage workspace members and invitations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchUsers}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:opacity-60 transition-opacity"
            style={{ color: 'var(--color-muted)' }}
            title="Refresh"
          >
            {getIcon('refresh-cw', { size: 15 })}
          </button>
          <button
            onClick={() => setShowInvite(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-80"
            style={{ background: 'var(--color-primary)' }}
          >
            {getIcon('plus', { size: 14 })}
            Invite User
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="flex gap-1.5">
            {[0, 150, 300].map(delay => (
              <span
                key={delay}
                className="w-2 h-2 rounded-full animate-bounce"
                style={{ background: 'var(--color-primary)', animationDelay: `${delay}ms` }}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
          {users.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No users found.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
                  {['Email', 'Name', 'Role', 'Status', 'Joined', ''].map(col => (
                    <th
                      key={col}
                      className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider"
                      style={{ color: 'var(--color-muted)' }}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((u, i) => {
                  const role = u.roles?.[0] ?? 'org_member';
                  return (
                    <tr
                      key={u.id}
                      style={{
                        borderBottom: i < users.length - 1 ? '1px solid var(--color-border)' : 'none',
                        background: 'var(--color-bg)',
                      }}
                    >
                      <td className="px-4 py-3" style={{ color: 'var(--color-text)' }}>{u.email}</td>
                      <td className="px-4 py-3" style={{ color: 'var(--color-text)' }}>
                        {[u.first_name, u.last_name].filter(Boolean).join(' ') || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="px-2 py-0.5 rounded-full text-xs font-medium"
                          style={
                            role === 'org_admin'
                              ? { background: 'rgba(var(--color-primary-rgb),0.12)', color: 'var(--color-primary)', border: '1px solid var(--color-border)' }
                              : { background: 'var(--color-surface)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }
                          }
                        >
                          {role === 'org_admin' ? 'Admin' : 'Member'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="px-2 py-0.5 rounded-full text-xs font-medium"
                          style={{
                            background: u.is_active ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)',
                            color: u.is_active ? '#16a34a' : '#d97706',
                          }}
                        >
                          {u.is_active ? 'Active' : 'Pending'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-muted)' }}>
                        {new Date(u.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-3">
                          {!u.is_active && (
                            <button
                              onClick={() => setResendUser(u)}
                              className="text-xs px-2 py-1 rounded-lg hover:opacity-70 transition-opacity"
                              style={{ color: 'var(--color-muted)' }}
                            >
                              Resend Invite
                            </button>
                          )}
                          <button
                            onClick={() => setDeleteUser(u)}
                            className="text-xs px-2 py-1 rounded-lg hover:opacity-70 transition-opacity"
                            style={{ color: '#ef4444' }}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {showInvite && (
        <InviteModal
          onClose={() => setShowInvite(false)}
          onInvited={() => { fetchUsers(); setShowInvite(false); }}
        />
      )}

      {resendUser && (
        <ResendModal
          user={resendUser}
          onClose={() => setResendUser(null)}
        />
      )}

      {deleteUser && (
        <DeleteModal
          user={deleteUser}
          onClose={() => setDeleteUser(null)}
          onDeleted={() => { fetchUsers(); setDeleteUser(null); }}
        />
      )}
    </div>
  );
}

function InviteModal({ onClose, onInvited }) {
  const [email, setEmail]     = useState('');
  const [role, setRole]       = useState('org_member');
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState(null);
  const [error, setError]     = useState('');
  const { showToast } = useToast();
  const getIcon = useIcon();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api.post('/admin/users/invite', { email, role });
      setResult(data);
      showToast(`Invitation created for ${email}`, 'success');
    } catch (err) {
      setError(err.message || 'Invite failed');
    } finally {
      setLoading(false);
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(result.activationUrl);
    showToast('Link copied to clipboard', 'success');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-md rounded-2xl border p-6 space-y-4"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            Invite User
          </h2>
          <button
            onClick={onClose}
            className="opacity-50 hover:opacity-100 transition-opacity"
            style={{ color: 'var(--color-muted)' }}
          >
            {getIcon('x', { size: 16 })}
          </button>
        </div>

        {!result ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
                placeholder="colleague@example.com"
                className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>
                Role
              </label>
              <select
                value={role}
                onChange={e => setRole(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                <option value="org_member">Member</option>
                <option value="org_admin">Admin</option>
              </select>
            </div>

            {error && <p className="text-xs text-red-500">{error}</p>}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 rounded-xl text-sm border transition-opacity hover:opacity-70"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-80 disabled:opacity-50"
                style={{ background: 'var(--color-primary)' }}
              >
                {loading ? 'Creating…' : 'Create Invitation'}
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                style={{ background: 'rgba(34,197,94,0.12)', color: '#16a34a' }}
              >
                {getIcon('mail', { size: 15 })}
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  Invitation sent
                </p>
                <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
                  Activation email delivered to <strong>{result.email}</strong>.
                  Link expires {new Date(result.expiresAt).toLocaleString()}.
                </p>
              </div>
            </div>

            <details className="text-xs" style={{ color: 'var(--color-muted)' }}>
              <summary className="cursor-pointer hover:opacity-70 select-none">
                Copy link manually (if email doesn't arrive)
              </summary>
              <div className="mt-2 space-y-2">
                <div
                  className="rounded-xl border p-3 font-mono break-all"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                >
                  {result.activationUrl}
                </div>
                <button
                  onClick={copyLink}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-opacity hover:opacity-70"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
                >
                  {getIcon('copy', { size: 12 })}
                  Copy link
                </button>
              </div>
            </details>

            <button
              onClick={onInvited}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-80"
              style={{ background: 'var(--color-primary)' }}
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ResendModal({ user, onClose }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState(null);
  const [error, setError]     = useState('');
  const { showToast } = useToast();
  const getIcon = useIcon();

  const handleResend = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.post(`/admin/users/${user.id}/resend-invite`, {});
      setResult(data);
      showToast('New invitation link generated', 'success');
    } catch (err) {
      setError(err.message || 'Failed to resend invitation');
    } finally {
      setLoading(false);
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(result.activationUrl);
    showToast('Link copied to clipboard', 'success');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-md rounded-2xl border p-6 space-y-4"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            Resend Invitation
          </h2>
          <button
            onClick={onClose}
            className="opacity-50 hover:opacity-100 transition-opacity"
            style={{ color: 'var(--color-muted)' }}
          >
            {getIcon('x', { size: 16 })}
          </button>
        </div>

        {!result ? (
          <div className="space-y-4">
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
              Generate a new 48-hour activation link for{' '}
              <span style={{ color: 'var(--color-text)', fontWeight: 600 }}>{user.email}</span>.
              Any previously sent link will be invalidated.
            </p>

            {error && <p className="text-xs" style={{ color: '#ef4444' }}>{error}</p>}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 rounded-xl text-sm border transition-opacity hover:opacity-70"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleResend}
                disabled={loading}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-80 disabled:opacity-50"
                style={{ background: 'var(--color-primary)' }}
              >
                {loading ? 'Generating…' : 'Generate New Link'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                style={{ background: 'rgba(34,197,94,0.12)', color: '#16a34a' }}
              >
                {getIcon('mail', { size: 15 })}
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  Invitation resent
                </p>
                <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
                  New activation email delivered to <strong>{result.email}</strong>.
                  Link expires {new Date(result.expiresAt).toLocaleString()}.
                </p>
              </div>
            </div>

            <details className="text-xs" style={{ color: 'var(--color-muted)' }}>
              <summary className="cursor-pointer hover:opacity-70 select-none">
                Copy link manually (if email doesn't arrive)
              </summary>
              <div className="mt-2 space-y-2">
                <div
                  className="rounded-xl border p-3 font-mono break-all"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                >
                  {result.activationUrl}
                </div>
                <button
                  onClick={copyLink}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-opacity hover:opacity-70"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
                >
                  {getIcon('copy', { size: 12 })}
                  Copy link
                </button>
              </div>
            </details>

            <button
              onClick={onClose}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-80"
              style={{ background: 'var(--color-primary)' }}
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function DeleteModal({ user, onClose, onDeleted }) {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const { showToast } = useToast();
  const getIcon = useIcon();

  const handleDelete = async () => {
    setLoading(true);
    setError('');
    try {
      await api.delete(`/admin/users/${user.id}`);
      showToast(`${user.email} removed`, 'success');
      onDeleted();
    } catch (err) {
      setError(err.message || 'Failed to delete user');
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-sm rounded-2xl border p-6 space-y-4"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            Remove User
          </h2>
          <button
            onClick={onClose}
            className="opacity-50 hover:opacity-100 transition-opacity"
            style={{ color: 'var(--color-muted)' }}
          >
            {getIcon('x', { size: 16 })}
          </button>
        </div>

        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          Remove <span style={{ color: 'var(--color-text)', fontWeight: 600 }}>{user.email}</span> from the workspace? This cannot be undone.
        </p>

        {error && <p className="text-xs" style={{ color: '#ef4444' }}>{error}</p>}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm border transition-opacity hover:opacity-70"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-80 disabled:opacity-50"
            style={{ background: '#ef4444' }}
          >
            {loading ? 'Removing…' : 'Remove User'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default AdminUsersPage;
