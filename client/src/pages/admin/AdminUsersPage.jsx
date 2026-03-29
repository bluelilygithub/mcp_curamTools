/**
 * AdminUsersPage — member list, invite flow, role and status management.
 */
import { useState, useEffect } from 'react';
import api from '../../api/client';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import InlineBanner from '../../components/ui/InlineBanner';
import EmptyState from '../../components/ui/EmptyState';
import { useIcon } from '../../providers/IconProvider';

function RolePill({ role }) {
  const isAdmin = role === 'org_admin';
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs font-medium"
      style={
        isAdmin
          ? { background: '#fef3c7', color: '#92400e' }
          : { background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }
      }
    >
      {isAdmin ? 'Admin' : 'Member'}
    </span>
  );
}

function StatusPill({ active }) {
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs font-medium"
      style={
        active
          ? { background: '#dcfce7', color: '#166534' }
          : { background: '#fee2e2', color: '#991b1b' }
      }
    >
      {active ? 'Active' : 'Pending'}
    </span>
  );
}

export default function AdminUsersPage() {
  const getIcon = useIcon();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('org_member');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  async function load() {
    try {
      setUsers(await api.get('/admin/users'));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function handleInvite(e) {
    e.preventDefault();
    setInviteLoading(true);
    setInviteSuccess('');
    try {
      await api.post('/admin/users/invite', { email: inviteEmail, role: inviteRole });
      setInviteSuccess('Invitation sent.');
      setInviteEmail('');
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setInviteLoading(false);
    }
  }

  async function handleDelete(userId) {
    try {
      await api.delete(`/admin/users/${userId}`);
      setDeleteConfirm(null);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleResendInvite(userId) {
    try {
      await api.post(`/admin/users/${userId}/resend-invite`);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Users</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>Manage workspace members and invitations.</p>
        </div>
        <Button variant="primary" onClick={() => setInviteOpen(true)}>
          {getIcon('plus', { size: 14 })} Invite user
        </Button>
      </div>

      {error && <InlineBanner type="error" message={error} onDismiss={() => setError('')} className="mb-4" />}

      <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
        {loading ? (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</div>
        ) : users.length === 0 ? (
          <EmptyState icon="users" message="No users yet." hint="Invite your first team member." />
        ) : (
          <table className="w-full" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
                {['Email', 'Name', 'Role', 'Status', 'Actions'].map((col) => (
                  <th
                    key={col}
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--color-muted)' }}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const role = u.roles?.[0] ?? 'org_member';
                return (
                  <tr key={u.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--color-text)' }}>{u.email}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--color-text)' }}>
                      {[u.first_name, u.last_name].filter(Boolean).join(' ') || '—'}
                    </td>
                    <td className="px-4 py-3"><RolePill role={role} /></td>
                    <td className="px-4 py-3"><StatusPill active={u.is_active} /></td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {!u.is_active && (
                          <Button variant="icon" onClick={() => handleResendInvite(u.id)} title="Resend invite">
                            {getIcon('mail', { size: 14 })}
                          </Button>
                        )}
                        {deleteConfirm === u.id ? (
                          <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-text)' }}>
                            Delete?{' '}
                            <button onClick={() => handleDelete(u.id)} className="text-red-600 hover:opacity-70 font-semibold">Yes</button>
                            {' / '}
                            <button onClick={() => setDeleteConfirm(null)} className="hover:opacity-70">No</button>
                          </span>
                        ) : (
                          <Button variant="icon" onClick={() => setDeleteConfirm(u.id)} title="Delete user">
                            {getIcon('trash', { size: 14 })}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Invite modal */}
      <Modal open={inviteOpen} onClose={() => { setInviteOpen(false); setInviteSuccess(''); }} title="Invite user">
        {inviteSuccess && <InlineBanner type="neutral" message={inviteSuccess} />}
        <form onSubmit={handleInvite} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>
              Email address
            </label>
            <input
              type="email" required value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>
              Role
            </label>
            <select
              value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            >
              <option value="org_member">Member</option>
              <option value="org_admin">Admin</option>
            </select>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" type="button" onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={inviteLoading}>
              {inviteLoading ? 'Sending…' : 'Send invite'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
