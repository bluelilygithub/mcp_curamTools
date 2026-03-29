/**
 * AdminUsersPage — manage workspace members, roles, and invitations.
 *
 * Modals:
 *   InviteModal  — invite a new user; shows activation link on success
 *   ResendModal  — regenerate an invite link for a pending user
 *   ManageModal  — edit profile, toggle org_admin role, delete user
 */
import { useState, useEffect } from 'react';
import api from '../../api/client';
import { useIcon } from '../../providers/IconProvider';
import { useToast } from '../../components/ui/Toast';
import useAuthStore from '../../stores/authStore';

// ── Helpers ──────────────────────────────────────────────────────────────────

function RoleBadge({ isAdmin }) {
  return (
    <span
      className="px-2 py-0.5 rounded-full text-xs font-medium"
      style={
        isAdmin
          ? { background: 'rgba(var(--color-primary-rgb),0.12)', color: 'var(--color-primary)', border: '1px solid var(--color-border)' }
          : { background: 'var(--color-surface)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }
      }
    >
      {isAdmin ? 'Admin' : 'Member'}
    </span>
  );
}

function StatusBadge({ isActive }) {
  return (
    <span
      className="px-2 py-0.5 rounded-full text-xs font-medium"
      style={{
        background: isActive ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)',
        color:      isActive ? '#16a34a'               : '#d97706',
      }}
    >
      {isActive ? 'Active' : 'Pending'}
    </span>
  );
}

const inputStyle = {
  width: '100%', padding: '0.625rem 0.75rem', borderRadius: '0.75rem',
  border: '1px solid var(--color-border)', background: 'var(--color-bg)',
  color: 'var(--color-text)', fontSize: '0.875rem', outline: 'none', boxSizing: 'border-box',
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

// ── InviteModal ───────────────────────────────────────────────────────────────

function InviteModal({ onClose, onInvited }) {
  const [email,   setEmail]   = useState('');
  const [role,    setRole]    = useState('org_member');
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState(null);
  const [error,   setError]   = useState('');
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
    <ModalShell onClose={onClose} title="Invite User">
      {!result ? (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>
              Email Address
            </label>
            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              required autoFocus placeholder="colleague@example.com" style={inputStyle}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>
              Role
            </label>
            <select value={role} onChange={(e) => setRole(e.target.value)} style={inputStyle}>
              <option value="org_member">Member</option>
              <option value="org_admin">Admin</option>
            </select>
          </div>
          {error && <p className="text-xs" style={{ color: '#ef4444' }}>{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-sm border transition-opacity hover:opacity-70"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'transparent', cursor: 'pointer' }}>
              Cancel
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-80 disabled:opacity-50"
              style={{ background: 'var(--color-primary)', border: 'none', cursor: 'pointer' }}>
              {loading ? 'Creating…' : 'Create Invitation'}
            </button>
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5"
              style={{ background: 'rgba(34,197,94,0.12)', color: '#16a34a' }}>
              {getIcon('mail', { size: 15 })}
            </div>
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Invitation sent</p>
              <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
                Activation email delivered to <strong>{result.email}</strong>.{' '}
                Link expires {new Date(result.expiresAt).toLocaleString()}.
              </p>
            </div>
          </div>
          <details className="text-xs" style={{ color: 'var(--color-muted)' }}>
            <summary className="cursor-pointer hover:opacity-70 select-none">
              Copy link manually (if email doesn't arrive)
            </summary>
            <div className="mt-2 space-y-2">
              <div className="rounded-xl border p-3 font-mono break-all"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                {result.activationUrl}
              </div>
              <button onClick={copyLink}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-opacity hover:opacity-70"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'transparent', cursor: 'pointer' }}>
                {getIcon('copy', { size: 12 })} Copy link
              </button>
            </div>
          </details>
          <button onClick={onInvited}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-80"
            style={{ background: 'var(--color-primary)', border: 'none', cursor: 'pointer' }}>
            Done
          </button>
        </div>
      )}
    </ModalShell>
  );
}

// ── ResendModal ───────────────────────────────────────────────────────────────

function ResendModal({ user, onClose }) {
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState(null);
  const [error,   setError]   = useState('');
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
    <ModalShell onClose={onClose} title="Resend Invitation">
      {!result ? (
        <div className="space-y-4">
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
            Generate a new 48-hour activation link for{' '}
            <span style={{ color: 'var(--color-text)', fontWeight: 600 }}>{user.email}</span>.
            Any previously sent link will be invalidated.
          </p>
          {error && <p className="text-xs" style={{ color: '#ef4444' }}>{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-sm border transition-opacity hover:opacity-70"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'transparent', cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={handleResend} disabled={loading}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-80 disabled:opacity-50"
              style={{ background: 'var(--color-primary)', border: 'none', cursor: 'pointer' }}>
              {loading ? 'Generating…' : 'Generate New Link'}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5"
              style={{ background: 'rgba(34,197,94,0.12)', color: '#16a34a' }}>
              {getIcon('mail', { size: 15 })}
            </div>
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Invitation resent</p>
              <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
                New activation email delivered to <strong>{result.email}</strong>.{' '}
                Link expires {new Date(result.expiresAt).toLocaleString()}.
              </p>
            </div>
          </div>
          <details className="text-xs" style={{ color: 'var(--color-muted)' }}>
            <summary className="cursor-pointer hover:opacity-70 select-none">
              Copy link manually (if email doesn't arrive)
            </summary>
            <div className="mt-2 space-y-2">
              <div className="rounded-xl border p-3 font-mono break-all"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                {result.activationUrl}
              </div>
              <button onClick={copyLink}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-opacity hover:opacity-70"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'transparent', cursor: 'pointer' }}>
                {getIcon('copy', { size: 12 })} Copy link
              </button>
            </div>
          </details>
          <button onClick={onClose}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-80"
            style={{ background: 'var(--color-primary)', border: 'none', cursor: 'pointer' }}>
            Done
          </button>
        </div>
      )}
    </ModalShell>
  );
}

// ── ManageModal ───────────────────────────────────────────────────────────────

function ManageModal({ user, onClose, onSaved, onDeleted }) {
  const currentUser = useAuthStore((s) => s.user);
  const { showToast } = useToast();
  const isSelf = currentUser?.id === user.id;

  // Org role (admin/member toggle)
  const [isAdmin,       setIsAdmin]       = useState(false);
  const [roleLoading,   setRoleLoading]   = useState(true);
  const [roleWorking,   setRoleWorking]   = useState(false);

  // Departments
  const [allDepts,      setAllDepts]      = useState([]);
  const [userDeptIds,   setUserDeptIds]   = useState([]);
  const [deptSaving,    setDeptSaving]    = useState(false);

  // Custom org roles
  const [allOrgRoles,   setAllOrgRoles]   = useState([]);
  const [userRoleNames, setUserRoleNames] = useState([]);
  const [orgRoleSaving, setOrgRoleSaving] = useState(false);

  // Default model
  const [models,        setModels]        = useState([]);
  const [defaultModel,  setDefaultModel]  = useState(user.default_model_id || '');
  const [modelSaving,   setModelSaving]   = useState(false);

  // Profile
  const [firstName,     setFirstName]     = useState(user.first_name || '');
  const [lastName,      setLastName]      = useState(user.last_name  || '');
  const [phone,         setPhone]         = useState(user.phone       || '');
  const [isActive,      setIsActive]      = useState(user.is_active);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError,  setProfileError]  = useState('');

  // Delete
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting,      setDeleting]      = useState(false);

  useEffect(() => {
    Promise.all([
      api.get(`/admin/users/${user.id}/roles`),
      api.get(`/admin/users/${user.id}/departments`),
      api.get(`/admin/users/${user.id}/org-roles`),
      api.get('/admin/departments'),
      api.get('/admin/org-roles'),
      api.get('/admin/models'),
    ]).then(([roles, userDepts, userOrgRoles, depts, orgRoles, modelList]) => {
      setIsAdmin(roles.some((r) => r.role_name === 'org_admin' && r.scope_type === 'global'));
      setUserDeptIds(userDepts.map((d) => d.id));
      setUserRoleNames(userOrgRoles);
      setAllDepts(depts);
      setAllOrgRoles(orgRoles);
      setModels(modelList.filter((m) => m.enabled));
    }).catch(() => showToast('Failed to load user data', 'error'))
      .finally(() => setRoleLoading(false));
  }, [user.id]);

  const toggleDept = (id) => {
    setUserDeptIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const saveDepts = async () => {
    setDeptSaving(true);
    try {
      await api.put(`/admin/users/${user.id}/departments`, { departmentIds: userDeptIds });
      showToast('Departments updated', 'success');
      onSaved();
    } catch (e) {
      showToast(e.message || 'Failed to update departments', 'error');
    } finally {
      setDeptSaving(false);
    }
  };

  const toggleOrgRole = (name) => {
    setUserRoleNames((prev) => prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]);
  };

  const saveOrgRoles = async () => {
    setOrgRoleSaving(true);
    try {
      await api.put(`/admin/users/${user.id}/org-roles`, { roleNames: userRoleNames });
      showToast('Roles updated', 'success');
      onSaved();
    } catch (e) {
      showToast(e.message || 'Failed to update roles', 'error');
    } finally {
      setOrgRoleSaving(false);
    }
  };

  const saveDefaultModel = async () => {
    setModelSaving(true);
    try {
      await api.put(`/admin/users/${user.id}`, {
        firstName, lastName, phone, isActive,
        defaultModelId: defaultModel || null,
      });
      showToast('Default model updated', 'success');
      onSaved();
    } catch (e) {
      showToast(e.message || 'Failed to update model', 'error');
    } finally {
      setModelSaving(false);
    }
  };

  const toggleAdmin = async () => {
    if (isSelf) { showToast('You cannot change your own admin role', 'error'); return; }
    setRoleWorking(true);
    try {
      const endpoint = isAdmin ? 'revoke-role' : 'grant-role';
      await api.post(`/admin/users/${user.id}/${endpoint}`, { roleName: 'org_admin', scopeType: 'global' });
      setIsAdmin(!isAdmin);
      showToast(isAdmin ? 'Admin role removed' : 'Admin role granted', 'success');
      onSaved();
    } catch (err) {
      showToast(err.message || 'Failed to update role', 'error');
    } finally {
      setRoleWorking(false);
    }
  };

  const handleProfileSave = async () => {
    setProfileSaving(true);
    setProfileError('');
    try {
      await api.put(`/admin/users/${user.id}`, {
        firstName, lastName, phone, isActive,
      });
      showToast('Profile updated', 'success');
      onSaved();
    } catch (err) {
      setProfileError(err.message || 'Failed to save profile');
    } finally {
      setProfileSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/admin/users/${user.id}`);
      showToast(`${user.email} removed`, 'success');
      onDeleted();
    } catch (err) {
      showToast(err.message || 'Failed to remove user', 'error');
      setDeleting(false);
    }
  };

  return (
    <ModalShell onClose={onClose} title="Manage User" subtitle={user.email}>
      <div className="space-y-5">

        {/* ── Organisation role ─────────────────────────────────────────── */}
        <section>
          <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>
            Organisation Role
          </p>
          <div
            className="flex items-center justify-between px-3 py-2.5 rounded-xl border"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
          >
            <div>
              <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                {roleLoading ? '…' : isAdmin ? 'Administrator' : 'Member'}
              </p>
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                {isAdmin ? 'Full access to this admin panel' : 'Standard organisation member'}
              </p>
            </div>
            <button
              onClick={toggleAdmin}
              disabled={roleWorking || roleLoading || isSelf}
              title={isSelf ? 'You cannot change your own admin role' : undefined}
              className="text-xs px-2 py-1 rounded-lg transition-opacity hover:opacity-70 disabled:opacity-30"
              style={{
                color:      isAdmin ? '#ef4444' : 'var(--color-primary)',
                background: 'transparent', border: 'none', cursor: 'pointer',
              }}
            >
              {roleWorking ? '…' : isAdmin ? 'Remove admin' : 'Make admin'}
            </button>
          </div>
        </section>

        {/* ── Departments ───────────────────────────────────────────────── */}
        <section>
          <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>
            Departments
          </p>
          {roleLoading ? (
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Loading…</p>
          ) : allDepts.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              No departments configured.{' '}
              <span style={{ color: 'var(--color-primary)' }}>Add them on the Departments page.</span>
            </p>
          ) : (
            <div className="space-y-1.5">
              {allDepts.map((d) => (
                <label
                  key={d.id}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-xl border cursor-pointer"
                  style={{
                    borderColor: userDeptIds.includes(d.id) ? 'var(--color-primary)' : 'var(--color-border)',
                    background:  userDeptIds.includes(d.id) ? 'rgba(var(--color-primary-rgb,99,102,241),0.06)' : 'var(--color-bg)',
                  }}
                >
                  <input type="checkbox" checked={userDeptIds.includes(d.id)}
                    onChange={() => toggleDept(d.id)} className="accent-[var(--color-primary)]" />
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: d.color }} />
                  <span className="text-xs font-medium flex-1" style={{ color: 'var(--color-text)' }}>{d.name}</span>
                </label>
              ))}
              <button onClick={saveDepts} disabled={deptSaving}
                className="mt-2 text-xs px-3 py-1.5 rounded-lg transition-opacity hover:opacity-80 disabled:opacity-40"
                style={{ background: 'var(--color-primary)', color: '#fff', border: 'none', cursor: 'pointer' }}>
                {deptSaving ? 'Saving…' : 'Save departments'}
              </button>
            </div>
          )}
        </section>

        {/* ── Custom roles ───────────────────────────────────────────────── */}
        <section>
          <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>
            Custom Roles
          </p>
          {roleLoading ? (
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Loading…</p>
          ) : allOrgRoles.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              No custom roles configured.{' '}
              <span style={{ color: 'var(--color-primary)' }}>Add them on the Roles page.</span>
            </p>
          ) : (
            <div className="space-y-1.5">
              {allOrgRoles.map((r) => (
                <label
                  key={r.id}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-xl border cursor-pointer"
                  style={{
                    borderColor: userRoleNames.includes(r.name) ? 'var(--color-primary)' : 'var(--color-border)',
                    background:  userRoleNames.includes(r.name) ? 'rgba(var(--color-primary-rgb,99,102,241),0.06)' : 'var(--color-bg)',
                  }}
                >
                  <input type="checkbox" checked={userRoleNames.includes(r.name)}
                    onChange={() => toggleOrgRole(r.name)} className="accent-[var(--color-primary)]" />
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: r.color }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>{r.label}</p>
                    {r.description && (
                      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{r.description}</p>
                    )}
                  </div>
                  <span className="text-xs font-mono" style={{ color: 'var(--color-muted)' }}>{r.name}</span>
                </label>
              ))}
              <button onClick={saveOrgRoles} disabled={orgRoleSaving}
                className="mt-2 text-xs px-3 py-1.5 rounded-lg transition-opacity hover:opacity-80 disabled:opacity-40"
                style={{ background: 'var(--color-primary)', color: '#fff', border: 'none', cursor: 'pointer' }}>
                {orgRoleSaving ? 'Saving…' : 'Save roles'}
              </button>
            </div>
          )}
        </section>

        {/* ── Default model ──────────────────────────────────────────────── */}
        <section>
          <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>
            Default AI Model
          </p>
          <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>
            Pre-selects this model when the user opens a tool. They can still change it per session.
          </p>
          <div className="flex gap-2">
            <select
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
              style={{ ...inputStyle, flex: 1 }}
            >
              <option value="">— No preference (use tool default) —</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            <button onClick={saveDefaultModel} disabled={modelSaving}
              className="text-xs px-3 py-1.5 rounded-xl transition-opacity hover:opacity-80 disabled:opacity-40 flex-shrink-0"
              style={{ background: 'var(--color-primary)', color: '#fff', border: 'none', cursor: 'pointer' }}>
              {modelSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </section>

        {/* ── Profile ───────────────────────────────────────────────────── */}
        <section>
          <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>
            Profile
          </p>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>First name</label>
                <input value={firstName} onChange={(e) => setFirstName(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Last name</label>
                <input value={lastName} onChange={(e) => setLastName(e.target.value)} style={inputStyle} />
              </div>
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Phone</label>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle} />
            </div>

            {/* Active toggle */}
            <div className="flex items-center justify-between px-3 py-2.5 rounded-xl border"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
              <div>
                <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Account active</p>
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  {isActive ? 'User can log in' : 'Login is blocked'}
                </p>
              </div>
              <button
                onClick={() => setIsActive((a) => !a)}
                disabled={isSelf}
                title={isSelf ? 'You cannot deactivate your own account' : undefined}
                className="relative inline-flex h-5 w-9 rounded-full transition-all disabled:opacity-40"
                style={{ background: isActive ? 'var(--color-primary)' : 'var(--color-border)', border: 'none', cursor: 'pointer' }}
              >
                <span className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full transition-all"
                  style={{ background: '#fff', transform: isActive ? 'translateX(16px)' : 'translateX(0)' }} />
              </button>
            </div>

            {profileError && <p className="text-xs" style={{ color: '#ef4444' }}>{profileError}</p>}

            <button
              onClick={handleProfileSave}
              disabled={profileSaving}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-80 disabled:opacity-50"
              style={{ background: 'var(--color-primary)', border: 'none', cursor: 'pointer' }}
            >
              {profileSaving ? 'Saving…' : 'Save Profile'}
            </button>
          </div>
        </section>

        {/* ── Danger zone ───────────────────────────────────────────────── */}
        {!isSelf && (
          <section>
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: '#ef4444', opacity: 0.7 }}>
              Danger Zone
            </p>
            {!deleteConfirm ? (
              <button
                onClick={() => setDeleteConfirm(true)}
                className="w-full py-2.5 rounded-xl text-sm font-medium transition-opacity hover:opacity-80"
                style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)', cursor: 'pointer' }}
              >
                Remove user from workspace
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  This will permanently remove <strong style={{ color: 'var(--color-text)' }}>{user.email}</strong> and cannot be undone.
                </p>
                <div className="flex gap-2">
                  <button onClick={() => setDeleteConfirm(false)}
                    className="flex-1 py-2 rounded-xl text-sm border transition-opacity hover:opacity-70"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'transparent', cursor: 'pointer' }}>
                    Cancel
                  </button>
                  <button onClick={handleDelete} disabled={deleting}
                    className="flex-1 py-2 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-80 disabled:opacity-50"
                    style={{ background: '#ef4444', border: 'none', cursor: 'pointer' }}>
                    {deleting ? 'Removing…' : 'Confirm Remove'}
                  </button>
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </ModalShell>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminUsersPage() {
  const [users,      setUsers]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [manageUser, setManageUser] = useState(null);
  const [resendUser, setResendUser] = useState(null);
  const getIcon = useIcon();
  const { showToast } = useToast();

  const fetchUsers = () => {
    setLoading(true);
    api.get('/admin/users')
      .then((data) => setUsers(Array.isArray(data) ? data : []))
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
            style={{ color: 'var(--color-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
            title="Refresh"
          >
            {getIcon('refresh-cw', { size: 15 })}
          </button>
          <button
            onClick={() => setShowInvite(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-80"
            style={{ background: 'var(--color-primary)', border: 'none', cursor: 'pointer' }}
          >
            {getIcon('plus', { size: 14 })}
            Invite User
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
          {users.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No users found.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
                  {['Email', 'Name', 'Role', 'Status', 'Joined', ''].map((col) => (
                    <th key={col}
                      className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider"
                      style={{ color: 'var(--color-muted)' }}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((u, i) => {
                  const isAdmin = u.roles?.includes('org_admin') ?? false;
                  return (
                    <tr key={u.id} style={{
                      borderBottom: i < users.length - 1 ? '1px solid var(--color-border)' : 'none',
                      background: 'var(--color-bg)',
                    }}>
                      <td className="px-4 py-3" style={{ color: 'var(--color-text)' }}>{u.email}</td>
                      <td className="px-4 py-3" style={{ color: 'var(--color-text)' }}>
                        {[u.first_name, u.last_name].filter(Boolean).join(' ') || '—'}
                      </td>
                      <td className="px-4 py-3"><RoleBadge isAdmin={isAdmin} /></td>
                      <td className="px-4 py-3"><StatusBadge isActive={u.is_active} /></td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-muted)' }}>
                        {new Date(u.created_at).toLocaleDateString('en-AU')}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {!u.is_active && (
                            <button
                              onClick={() => setResendUser(u)}
                              className="text-xs px-2 py-1 rounded-lg hover:opacity-70 transition-opacity"
                              style={{ color: 'var(--color-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>
                              Resend Invite
                            </button>
                          )}
                          <button
                            onClick={() => setManageUser(u)}
                            className="text-xs px-2 py-1 rounded-lg hover:opacity-70 transition-opacity"
                            style={{ color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer' }}>
                            Manage
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
        <ResendModal user={resendUser} onClose={() => setResendUser(null)} />
      )}

      {manageUser && (
        <ManageModal
          user={manageUser}
          onClose={() => setManageUser(null)}
          onSaved={() => { fetchUsers(); }}
          onDeleted={() => { fetchUsers(); setManageUser(null); }}
        />
      )}
    </div>
  );
}
