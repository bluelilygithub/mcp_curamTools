/**
 * AdminMcpServersPage — register, connect/disconnect, and delete MCP servers.
 */
import { useState, useEffect } from 'react';
import api from '../../api/client';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import InlineBanner from '../../components/ui/InlineBanner';
import EmptyState from '../../components/ui/EmptyState';
import { useIcon } from '../../providers/IconProvider';

function ToolRunner({ tool, serverId }) {
  const [argsJson, setArgsJson] = useState(() => {
    const props = tool.inputSchema?.properties ?? {};
    const required = tool.inputSchema?.required ?? [];
    if (required.length === 0 && Object.keys(props).length === 0) return '{}';
    const example = {};
    for (const key of required) {
      const p = props[key];
      example[key] = p?.type === 'number' ? 1 : '';
    }
    return JSON.stringify(example, null, 2);
  });
  const [result, setResult] = useState(null);
  const [callError, setCallError] = useState('');
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    setResult(null);
    setCallError('');
    try {
      let args = {};
      if (argsJson.trim()) args = JSON.parse(argsJson);
      const data = await api.post(`/admin/mcp-servers/${serverId}/call`, { toolName: tool.name, args });
      const text = data?.content?.[0]?.text ?? JSON.stringify(data, null, 2);
      setResult(text);
    } catch (e) {
      setCallError(e.message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <li className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
      <div className="px-4 py-3" style={{ background: 'var(--color-surface)' }}>
        <div className="text-sm font-semibold font-mono" style={{ color: 'var(--color-text)' }}>{tool.name}</div>
        {tool.description && <div className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{tool.description}</div>}
      </div>
      <div className="px-4 py-3 space-y-2" style={{ background: 'var(--color-bg)' }}>
        <textarea
          rows={3}
          value={argsJson}
          onChange={(e) => setArgsJson(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border text-xs outline-none"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', fontFamily: 'monospace', resize: 'vertical' }}
          placeholder="{}"
        />
        <div className="flex items-center gap-2">
          <Button variant="primary" onClick={run} disabled={running}>
            {running ? 'Running…' : 'Call tool'}
          </Button>
          {callError && <span className="text-xs text-red-500">{callError}</span>}
        </div>
        {result && (
          <pre className="text-xs rounded-xl p-3 overflow-auto" style={{ background: 'var(--color-surface)', color: 'var(--color-text)', maxHeight: 200, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {result}
          </pre>
        )}
      </div>
    </li>
  );
}

const STATUS_STYLES = {
  connected:    { background: '#dcfce7', color: '#166534' },
  connecting:   { background: '#fef9c3', color: '#854d0e' },
  error:        { background: '#fee2e2', color: '#991b1b' },
  registered:   { background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' },
  disconnected: { background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' },
};

function StatusPill({ status }) {
  const label = status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown';
  return (
    <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={STATUS_STYLES[status] ?? STATUS_STYLES.registered}>
      {label}
    </span>
  );
}

const FIELD = 'w-full px-3 py-2.5 rounded-xl border text-sm outline-none';
const FIELD_STYLE = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const LABEL = 'block text-xs font-semibold uppercase tracking-wider mb-1.5';
const LABEL_STYLE = { color: 'var(--color-muted)' };

const EMPTY_FORM = { name: '', transportType: 'sse', endpointUrl: '', configJson: '' };

export default function AdminMcpServersPage() {
  const getIcon = useIcon();
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [registerOpen, setRegisterOpen] = useState(false);
  const [editServer, setEditServer] = useState(null); // server being edited
  const [form, setForm] = useState(EMPTY_FORM);
  const [formLoading, setFormLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState({});
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [toolsModal, setToolsModal] = useState(null); // { serverName, tools[] }

  async function load() {
    try {
      setServers(await api.get('/admin/mcp-servers'));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  function setAction(id, val) {
    setActionLoading((prev) => ({ ...prev, [id]: val }));
  }

  function openEdit(s) {
    setEditServer(s);
    setForm({
      name: s.name,
      transportType: s.transport_type,
      endpointUrl: s.endpoint_url || '',
      configJson: s.config && Object.keys(s.config).length ? JSON.stringify(s.config, null, 2) : '',
    });
  }

  function closeEdit() {
    setEditServer(null);
    setForm(EMPTY_FORM);
  }

  async function handleRegister(e) {
    e.preventDefault();
    setFormLoading(true);
    setError('');
    try {
      let config = {};
      if (form.configJson.trim()) {
        config = JSON.parse(form.configJson);
      }
      await api.post('/admin/mcp-servers', {
        name: form.name,
        transportType: form.transportType,
        endpointUrl: form.endpointUrl || null,
        config,
      });
      setRegisterOpen(false);
      setForm(EMPTY_FORM);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setFormLoading(false);
    }
  }

  async function handleEdit(e) {
    e.preventDefault();
    setFormLoading(true);
    setError('');
    try {
      let config = {};
      if (form.configJson.trim()) {
        config = JSON.parse(form.configJson);
      }
      await api.put(`/admin/mcp-servers/${editServer.id}`, {
        name: form.name,
        transportType: form.transportType,
        endpointUrl: form.endpointUrl || null,
        config,
      });
      closeEdit();
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setFormLoading(false);
    }
  }

  async function handleConnect(id) {
    setAction(id, 'connect');
    try {
      await api.post(`/admin/mcp-servers/${id}/connect`);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setAction(id, null);
    }
  }

  async function handleDisconnect(id) {
    setAction(id, 'disconnect');
    try {
      await api.post(`/admin/mcp-servers/${id}/disconnect`);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setAction(id, null);
    }
  }

  async function handleDiscoverTools(s) {
    setAction(s.id, 'tools');
    setError('');
    try {
      const tools = await api.get(`/admin/mcp-servers/${s.id}/tools`);
      setToolsModal({ serverName: s.name, serverId: s.id, tools });
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setAction(s.id, null);
    }
  }

  async function handleDelete(id) {
    try {
      await api.delete(`/admin/mcp-servers/${id}`);
      setDeleteConfirm(null);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>MCP Servers</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
            Register and manage remote MCP server connections.
          </p>
        </div>
        <Button variant="primary" onClick={() => setRegisterOpen(true)}>
          {getIcon('plus', { size: 14 })} Register server
        </Button>
      </div>

      {error && <InlineBanner type="error" message={error} onDismiss={() => setError('')} className="mb-4" />}

      <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
        {loading ? (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</div>
        ) : servers.length === 0 ? (
          <EmptyState icon="server" message="No MCP servers registered." hint="Register a server to start connecting agents." />
        ) : (
          <table className="w-full" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
                {['Name', 'Transport', 'Endpoint', 'Status', 'Actions'].map((col) => (
                  <th key={col} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {servers.map((s) => {
                const busy = actionLoading[s.id];
                const isConnected = s.connection_status === 'connected';
                return (
                  <tr key={s.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td className="px-4 py-3 text-sm font-medium" style={{ color: 'var(--color-text)' }}>{s.name}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--color-muted)' }}>{s.transport_type}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--color-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.endpoint_url || '—'}
                    </td>
                    <td className="px-4 py-3"><StatusPill status={s.connection_status} /></td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 items-center">
                        {isConnected ? (
                          <Button variant="secondary" onClick={() => handleDisconnect(s.id)} disabled={!!busy}>
                            {busy === 'disconnect' ? getIcon('loading', { size: 14 }) : getIcon('toggle-on', { size: 14 })}
                            {' '}Disconnect
                          </Button>
                        ) : (
                          <Button variant="primary" onClick={() => handleConnect(s.id)} disabled={!!busy}>
                            {busy === 'connect' ? getIcon('loading', { size: 14 }) : getIcon('toggle-off', { size: 14 })}
                            {' '}Connect
                          </Button>
                        )}
                        {isConnected && (
                          <Button variant="secondary" onClick={() => handleDiscoverTools(s)} disabled={!!busy} title="Discover tools">
                            {busy === 'tools' ? getIcon('loading', { size: 14 }) : getIcon('search', { size: 14 })}
                            {' '}Tools
                          </Button>
                        )}
                        <Button variant="icon" onClick={() => openEdit(s)} title="Edit server">
                          {getIcon('edit', { size: 14 })}
                        </Button>
                        {deleteConfirm === s.id ? (
                          <span className="flex items-center gap-1 text-xs ml-1" style={{ color: 'var(--color-text)' }}>
                            Delete?{' '}
                            <button onClick={() => handleDelete(s.id)} className="text-red-600 hover:opacity-70 font-semibold">Yes</button>
                            {' / '}
                            <button onClick={() => setDeleteConfirm(null)} className="hover:opacity-70">No</button>
                          </span>
                        ) : (
                          <Button variant="icon" onClick={() => setDeleteConfirm(s.id)} title="Delete server">
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

      {/* Tools modal */}
      {toolsModal && (
        <Modal open onClose={() => setToolsModal(null)} title={`Tools — ${toolsModal.serverName}`} maxWidth="max-w-xl">
          {toolsModal.tools.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No tools returned by this server.</p>
          ) : (
            <ul className="space-y-4">
              {toolsModal.tools.map((t) => (
                <ToolRunner key={t.name} tool={t} serverId={toolsModal.serverId} />
              ))}
            </ul>
          )}
          <div className="flex justify-end pt-4">
            <Button variant="secondary" onClick={() => setToolsModal(null)}>Close</Button>
          </div>
        </Modal>
      )}

      {/* Edit modal */}
      <Modal open={!!editServer} onClose={closeEdit} title={`Edit — ${editServer?.name ?? ''}`} maxWidth="max-w-md">
        <form onSubmit={handleEdit} className="space-y-4">
          <div>
            <label className={LABEL} style={LABEL_STYLE}>Name</label>
            <input
              type="text" required value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className={FIELD} style={FIELD_STYLE}
            />
          </div>
          <div>
            <label className={LABEL} style={LABEL_STYLE}>Transport type</label>
            <select
              value={form.transportType}
              onChange={(e) => setForm((f) => ({ ...f, transportType: e.target.value }))}
              className={FIELD} style={FIELD_STYLE}
            >
              <option value="sse">SSE (HTTP)</option>
              <option value="stdio">Stdio (subprocess)</option>
            </select>
          </div>
          {form.transportType === 'sse' && (
            <div>
              <label className={LABEL} style={LABEL_STYLE}>Endpoint URL</label>
              <input
                type="url" value={form.endpointUrl}
                onChange={(e) => setForm((f) => ({ ...f, endpointUrl: e.target.value }))}
                placeholder="https://…/sse"
                className={FIELD} style={FIELD_STYLE}
              />
            </div>
          )}
          {form.transportType === 'stdio' && (
            <div>
              <label className={LABEL} style={LABEL_STYLE}>Config JSON</label>
              <textarea
                rows={4} value={form.configJson}
                onChange={(e) => setForm((f) => ({ ...f, configJson: e.target.value }))}
                placeholder={'{"command": "node", "args": ["server/mcp-servers/wordpress.js"]}'}
                className={FIELD} style={{ ...FIELD_STYLE, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
              />
              <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Valid JSON. Use "command" and "args" keys.</p>
            </div>
          )}
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="secondary" type="button" onClick={closeEdit}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={formLoading}>
              {formLoading ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Register modal */}
      <Modal open={registerOpen} onClose={() => { setRegisterOpen(false); setForm(EMPTY_FORM); }} title="Register MCP server" maxWidth="max-w-md">
        <form onSubmit={handleRegister} className="space-y-4">
          <div>
            <label className={LABEL} style={LABEL_STYLE}>Name</label>
            <input
              type="text" required value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Google Ads MCP"
              className={FIELD} style={FIELD_STYLE}
            />
          </div>
          <div>
            <label className={LABEL} style={LABEL_STYLE}>Transport type</label>
            <select
              value={form.transportType}
              onChange={(e) => setForm((f) => ({ ...f, transportType: e.target.value }))}
              className={FIELD} style={FIELD_STYLE}
            >
              <option value="sse">SSE (HTTP)</option>
              <option value="stdio">Stdio (subprocess)</option>
            </select>
          </div>
          {form.transportType === 'sse' && (
            <div>
              <label className={LABEL} style={LABEL_STYLE}>Endpoint URL</label>
              <input
                type="url" value={form.endpointUrl}
                onChange={(e) => setForm((f) => ({ ...f, endpointUrl: e.target.value }))}
                placeholder="https://…/sse"
                className={FIELD} style={FIELD_STYLE}
              />
            </div>
          )}
          {form.transportType === 'stdio' && (
            <div>
              <label className={LABEL} style={LABEL_STYLE}>Config JSON (optional)</label>
              <textarea
                rows={3} value={form.configJson}
                onChange={(e) => setForm((f) => ({ ...f, configJson: e.target.value }))}
                placeholder={'{"command": "node", "args": ["server.js"]}'}
                className={FIELD} style={{ ...FIELD_STYLE, resize: 'vertical' }}
              />
              <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Valid JSON. Use "command" and "args" keys.</p>
            </div>
          )}
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="secondary" type="button" onClick={() => { setRegisterOpen(false); setForm(EMPTY_FORM); }}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={formLoading}>
              {formLoading ? 'Registering…' : 'Register'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
