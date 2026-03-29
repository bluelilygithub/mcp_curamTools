/**
 * AdminMcpResourcesPage — register MCP resources and manage resource-level permissions.
 * Two sections: Resources table (top) + Permissions table (bottom, filterable by resource URI).
 */
import { useState, useEffect, useCallback } from 'react';
import api from '../../api/client';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import InlineBanner from '../../components/ui/InlineBanner';
import EmptyState from '../../components/ui/EmptyState';
import { useIcon } from '../../providers/IconProvider';

const FIELD = 'w-full px-3 py-2.5 rounded-xl border text-sm outline-none';
const FIELD_STYLE = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const LABEL = 'block text-xs font-semibold uppercase tracking-wider mb-1.5';
const LABEL_STYLE = { color: 'var(--color-muted)' };

const EMPTY_RES_FORM = { serverId: '', uri: '', name: '', description: '' };
const EMPTY_PERM_FORM = { resourceUri: '', subjectType: 'role', userId: '', roleName: '', permission: 'allow' };

function PermissionPill({ permission }) {
  const isAllow = permission === 'allow';
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs font-medium"
      style={isAllow
        ? { background: '#dcfce7', color: '#166534' }
        : { background: '#fee2e2', color: '#991b1b' }}
    >
      {isAllow ? 'Allow' : 'Deny'}
    </span>
  );
}

export default function AdminMcpResourcesPage() {
  const getIcon = useIcon();

  // Servers (for dropdowns)
  const [servers, setServers] = useState([]);

  // Resources
  const [resources, setResources] = useState([]);
  const [resourcesLoading, setResourcesLoading] = useState(true);
  const [resourceError, setResourceError] = useState('');
  const [resFormOpen, setResFormOpen] = useState(false);
  const [resForm, setResForm] = useState(EMPTY_RES_FORM);
  const [resFormLoading, setResFormLoading] = useState(false);
  const [resDeleteConfirm, setResDeleteConfirm] = useState(null);

  // Permissions
  const [permissions, setPermissions] = useState([]);
  const [permsLoading, setPermsLoading] = useState(true);
  const [permError, setPermError] = useState('');
  const [filterUri, setFilterUri] = useState('');
  const [permFormOpen, setPermFormOpen] = useState(false);
  const [permForm, setPermForm] = useState(EMPTY_PERM_FORM);
  const [permFormLoading, setPermFormLoading] = useState(false);
  const [permDeleteConfirm, setPermDeleteConfirm] = useState(null);

  async function loadServers() {
    try {
      setServers(await api.get('/admin/mcp-servers'));
    } catch {
      // non-fatal — servers dropdown just stays empty
    }
  }

  async function loadResources() {
    try {
      setResources(await api.get('/admin/mcp-resources'));
    } catch (e) {
      setResourceError(e.message);
    } finally {
      setResourcesLoading(false);
    }
  }

  const loadPermissions = useCallback(async () => {
    try {
      const query = filterUri ? `?resourceUri=${encodeURIComponent(filterUri)}` : '';
      setPermissions(await api.get(`/admin/mcp-resources/permissions${query}`));
    } catch (e) {
      setPermError(e.message);
    } finally {
      setPermsLoading(false);
    }
  }, [filterUri]);

  useEffect(() => {
    loadServers();
    loadResources();
  }, []);

  useEffect(() => {
    setPermsLoading(true);
    loadPermissions();
  }, [loadPermissions]);

  // ── Resources ──────────────────────────────────────────────────────────────

  async function handleRegisterResource(e) {
    e.preventDefault();
    setResFormLoading(true);
    setResourceError('');
    try {
      await api.post('/admin/mcp-resources', {
        serverId: resForm.serverId,
        uri: resForm.uri,
        name: resForm.name,
        description: resForm.description || null,
      });
      setResFormOpen(false);
      setResForm(EMPTY_RES_FORM);
      loadResources();
    } catch (e) {
      setResourceError(e.message);
    } finally {
      setResFormLoading(false);
    }
  }

  async function handleDeleteResource(id) {
    try {
      await api.delete(`/admin/mcp-resources/${id}`);
      setResDeleteConfirm(null);
      loadResources();
    } catch (e) {
      setResourceError(e.message);
    }
  }

  // ── Permissions ────────────────────────────────────────────────────────────

  async function handleGrantPermission(e) {
    e.preventDefault();
    setPermFormLoading(true);
    setPermError('');
    try {
      const body = {
        resourceUri: permForm.resourceUri,
        permission: permForm.permission,
      };
      if (permForm.subjectType === 'user') {
        body.userId = permForm.userId;
      } else {
        body.roleName = permForm.roleName;
      }
      await api.post('/admin/mcp-resources/permissions', body);
      setPermFormOpen(false);
      setPermForm(EMPTY_PERM_FORM);
      loadPermissions();
    } catch (e) {
      setPermError(e.message);
    } finally {
      setPermFormLoading(false);
    }
  }

  async function handleRevokePermission(id) {
    try {
      await api.delete(`/admin/mcp-resources/permissions/${id}`);
      setPermDeleteConfirm(null);
      loadPermissions();
    } catch (e) {
      setPermError(e.message);
    }
  }

  function openPermFormForResource(uri) {
    setPermForm({ ...EMPTY_PERM_FORM, resourceUri: uri });
    setPermFormOpen(true);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-10">

      {/* ── Resources section ─────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>MCP Resources</h1>
            <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
              Register resource URIs exposed by connected MCP servers.
            </p>
          </div>
          <Button variant="primary" onClick={() => setResFormOpen(true)}>
            {getIcon('plus', { size: 14 })} Register resource
          </Button>
        </div>

        {resourceError && <InlineBanner type="error" message={resourceError} onDismiss={() => setResourceError('')} className="mb-4" />}

        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
          {resourcesLoading ? (
            <div className="p-8 text-center text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</div>
          ) : resources.length === 0 ? (
            <EmptyState icon="layers" message="No resources registered." hint="Register a resource URI to apply permissions." />
          ) : (
            <table className="w-full" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
                  {['URI', 'Name', 'Server', 'Description', 'Actions'].map((col) => (
                    <th key={col} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {resources.map((r) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td className="px-4 py-3 text-sm font-mono" style={{ color: 'var(--color-text)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.uri}
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--color-text)' }}>{r.name}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--color-muted)' }}>{r.server_name}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--color-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.description || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 items-center">
                        <Button variant="icon" onClick={() => openPermFormForResource(r.uri)} title="Add permission">
                          {getIcon('shield', { size: 14 })}
                        </Button>
                        {resDeleteConfirm === r.id ? (
                          <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-text)' }}>
                            Delete?{' '}
                            <button onClick={() => handleDeleteResource(r.id)} className="text-red-600 hover:opacity-70 font-semibold">Yes</button>
                            {' / '}
                            <button onClick={() => setResDeleteConfirm(null)} className="hover:opacity-70">No</button>
                          </span>
                        ) : (
                          <Button variant="icon" onClick={() => setResDeleteConfirm(r.id)} title="Delete resource">
                            {getIcon('trash', { size: 14 })}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* ── Permissions section ────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Resource Permissions</h2>
            <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
              Grant or deny access to specific resource URIs by user or role.
            </p>
          </div>
          <Button variant="primary" onClick={() => { setPermForm(EMPTY_PERM_FORM); setPermFormOpen(true); }}>
            {getIcon('plus', { size: 14 })} Grant permission
          </Button>
        </div>

        {permError && <InlineBanner type="error" message={permError} onDismiss={() => setPermError('')} className="mb-4" />}

        {/* URI filter */}
        <div className="mb-4 max-w-xs">
          <select
            value={filterUri}
            onChange={(e) => setFilterUri(e.target.value)}
            className={FIELD} style={FIELD_STYLE}
          >
            <option value="">All resources</option>
            {resources.map((r) => (
              <option key={r.id} value={r.uri}>{r.uri}</option>
            ))}
          </select>
        </div>

        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
          {permsLoading ? (
            <div className="p-8 text-center text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</div>
          ) : permissions.length === 0 ? (
            <EmptyState icon="shield" message="No permissions set." hint="Grant a permission to control resource access." />
          ) : (
            <table className="w-full" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
                  {['Resource URI', 'Subject', 'Permission', 'Actions'].map((col) => (
                    <th key={col} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {permissions.map((p) => (
                  <tr key={p.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td className="px-4 py-3 text-sm font-mono" style={{ color: 'var(--color-text)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.resource_uri}
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--color-text)' }}>
                      {p.role_name ? (
                        <span>
                          <span className="text-xs font-semibold uppercase tracking-wider mr-1" style={{ color: 'var(--color-muted)' }}>role</span>
                          {p.role_name}
                        </span>
                      ) : (
                        <span>
                          <span className="text-xs font-semibold uppercase tracking-wider mr-1" style={{ color: 'var(--color-muted)' }}>user</span>
                          <span className="font-mono text-xs">{p.user_id}</span>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3"><PermissionPill permission={p.permission} /></td>
                    <td className="px-4 py-3">
                      {permDeleteConfirm === p.id ? (
                        <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-text)' }}>
                          Revoke?{' '}
                          <button onClick={() => handleRevokePermission(p.id)} className="text-red-600 hover:opacity-70 font-semibold">Yes</button>
                          {' / '}
                          <button onClick={() => setPermDeleteConfirm(null)} className="hover:opacity-70">No</button>
                        </span>
                      ) : (
                        <Button variant="icon" onClick={() => setPermDeleteConfirm(p.id)} title="Revoke permission">
                          {getIcon('trash', { size: 14 })}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* ── Register resource modal ────────────────────────────────────────── */}
      <Modal open={resFormOpen} onClose={() => { setResFormOpen(false); setResForm(EMPTY_RES_FORM); }} title="Register resource" maxWidth="max-w-md">
        <form onSubmit={handleRegisterResource} className="space-y-4">
          <div>
            <label className={LABEL} style={LABEL_STYLE}>MCP Server</label>
            <select
              required value={resForm.serverId}
              onChange={(e) => setResForm((f) => ({ ...f, serverId: e.target.value }))}
              className={FIELD} style={FIELD_STYLE}
            >
              <option value="">Select a server…</option>
              {servers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL} style={LABEL_STYLE}>Resource URI</label>
            <input
              type="text" required value={resForm.uri}
              onChange={(e) => setResForm((f) => ({ ...f, uri: e.target.value }))}
              placeholder="e.g. ads://campaigns/all"
              className={FIELD} style={FIELD_STYLE}
            />
          </div>
          <div>
            <label className={LABEL} style={LABEL_STYLE}>Display name</label>
            <input
              type="text" required value={resForm.name}
              onChange={(e) => setResForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. All Campaigns"
              className={FIELD} style={FIELD_STYLE}
            />
          </div>
          <div>
            <label className={LABEL} style={LABEL_STYLE}>Description (optional)</label>
            <input
              type="text" value={resForm.description}
              onChange={(e) => setResForm((f) => ({ ...f, description: e.target.value }))}
              className={FIELD} style={FIELD_STYLE}
            />
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="secondary" type="button" onClick={() => { setResFormOpen(false); setResForm(EMPTY_RES_FORM); }}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={resFormLoading}>
              {resFormLoading ? 'Registering…' : 'Register'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ── Grant permission modal ─────────────────────────────────────────── */}
      <Modal open={permFormOpen} onClose={() => { setPermFormOpen(false); setPermForm(EMPTY_PERM_FORM); }} title="Grant permission" maxWidth="max-w-md">
        <form onSubmit={handleGrantPermission} className="space-y-4">
          <div>
            <label className={LABEL} style={LABEL_STYLE}>Resource URI</label>
            <select
              required value={permForm.resourceUri}
              onChange={(e) => setPermForm((f) => ({ ...f, resourceUri: e.target.value }))}
              className={FIELD} style={FIELD_STYLE}
            >
              <option value="">Select a resource…</option>
              {resources.map((r) => (
                <option key={r.id} value={r.uri}>{r.uri} — {r.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL} style={LABEL_STYLE}>Subject type</label>
            <div className="flex gap-3">
              {['role', 'user'].map((t) => (
                <label key={t} className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
                  <input
                    type="radio" name="subjectType" value={t}
                    checked={permForm.subjectType === t}
                    onChange={() => setPermForm((f) => ({ ...f, subjectType: t, userId: '', roleName: '' }))}
                  />
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </label>
              ))}
            </div>
          </div>
          {permForm.subjectType === 'role' ? (
            <div>
              <label className={LABEL} style={LABEL_STYLE}>Role name</label>
              <input
                type="text" required value={permForm.roleName}
                onChange={(e) => setPermForm((f) => ({ ...f, roleName: e.target.value }))}
                placeholder="e.g. org_member"
                className={FIELD} style={FIELD_STYLE}
              />
            </div>
          ) : (
            <div>
              <label className={LABEL} style={LABEL_STYLE}>User ID</label>
              <input
                type="text" required value={permForm.userId}
                onChange={(e) => setPermForm((f) => ({ ...f, userId: e.target.value }))}
                placeholder="UUID"
                className={FIELD} style={FIELD_STYLE}
              />
            </div>
          )}
          <div>
            <label className={LABEL} style={LABEL_STYLE}>Permission</label>
            <select
              value={permForm.permission}
              onChange={(e) => setPermForm((f) => ({ ...f, permission: e.target.value }))}
              className={FIELD} style={FIELD_STYLE}
            >
              <option value="allow">Allow</option>
              <option value="deny">Deny</option>
            </select>
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="secondary" type="button" onClick={() => { setPermFormOpen(false); setPermForm(EMPTY_PERM_FORM); }}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={permFormLoading}>
              {permFormLoading ? 'Granting…' : 'Grant'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
